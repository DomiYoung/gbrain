import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const dbUrl = 'postgresql://light@localhost:5432/gbrain_custom_clean';
const brainDir = '/Users/light/.hermes/gbrain-sources/domi-obsidian-brain-lite';
const repoMap: Record<string, string> = {
  'obsidian': brainDir,
  'domi-feishu-brain': '/Users/light/.hermes/gbrain-sources/domi-feishu-brain',
  'feishu': '/Users/light/.hermes/gbrain-sources/feishu',
  'feishu-essence-v2': '/Users/light/.hermes/gbrain-sources/feishu-essence-v2',
  'provenance': '/Users/light/.hermes/gbrain-sources/provenance',
  'tita': '/Users/light/.hermes/gbrain-sources/tita',
  'default': brainDir,
};

function psql(query: string): string {
  const q = query.replace(/'/g, "'\\''");
  return execSync(`psql -d gbrain_custom_clean -t -A -c '${q}'`, { encoding: 'utf-8' }).trim();
}

const TAKES_FENCE_BEGIN = '<!--- gbrain:takes:begin -->';
const TAKES_FENCE_END = '<!--- gbrain:takes:end -->';

function pageFilePath(sourceId: string, slug: string): string {
  const dir = repoMap[sourceId] || brainDir;
  return join(dir, `${slug}.md`);
}

function ensureFence(body: string): string {
  if (body.includes(TAKES_FENCE_BEGIN)) return body;
  return body + '\n\n' + TAKES_FENCE_BEGIN + '\n\n' + TAKES_FENCE_END + '\n';
}

function appendTakeToFence(body: string, claim: string, kind: string, holder: string, weight: number, rowNum: number): string {
  const beginIdx = body.indexOf(TAKES_FENCE_BEGIN);
  const endIdx = body.indexOf(TAKES_FENCE_END);
  
  if (beginIdx === -1 || endIdx === -1) {
    // No fence yet, create one
    const takeLine = `| ${rowNum} | ${claim.replace(/\|/g, '\\|')} | ${kind} | ${holder} | ${weight.toFixed(2)} | | | | |`;
    return body + '\n\n' + TAKES_FENCE_BEGIN + '\n\n| # | claim | kind | holder | weight | since_date | until_date | source |\n|---|-------|------|--------|--------|------------|------------|--------|\n' + takeLine + '\n\n' + TAKES_FENCE_END + '\n';
  }
  
  const header = '| # | claim | kind | holder | weight | since_date | until_date | source |\n|---|-------|------|--------|--------|------------|------------|--------|';
  const takeLine = `| ${rowNum} | ${claim.replace(/\|/g, '\\|')} | ${kind} | ${holder} | ${weight.toFixed(2)} | | | |`;
  
  // Check if header exists
  const betweenFences = body.substring(beginIdx + TAKES_FENCE_BEGIN.length, endIdx);
  if (!betweenFences.includes('| # |')) {
    // No header, add header + take
    const newBody = body.substring(0, beginIdx + TAKES_FENCE_BEGIN.length) + '\n\n' + header + '\n' + takeLine + '\n' + body.substring(endIdx);
    return newBody;
  }
  
  // Header exists, append take before end
  const newBody = body.substring(0, endIdx) + takeLine + '\n' + body.substring(endIdx);
  return newBody;
}

// Get pending proposals
const rows = psql(`SELECT id, source_id, page_slug, claim_text, kind, holder, weight FROM take_proposals WHERE status='pending' ORDER BY source_id, page_slug, id `);

if (!rows) {
  console.log('No pending proposals found.');
  process.exit(0);
}

const proposals = rows.split('\n').filter(r => r.trim()).map(r => {
  const parts = r.split('|');
  return {
    id: parseInt(parts[0]),
    sourceId: parts[1],
    slug: parts[2],
    claim: parts[3],
    kind: parts[4],
    holder: parts[5],
    weight: parseFloat(parts[6]),
  };
});

console.log(`Found ${proposals.length} pending proposals to promote...`);

let promoted = 0;
let errors = 0;

for (const p of proposals) {
  const path = pageFilePath(p.sourceId, p.slug);
  
  if (!existsSync(path)) {
    console.log(`SKIP: Page not found: ${path}`);
    errors++;
    continue;
  }
  
  try {
    let body = readFileSync(path, 'utf-8');
    
    // Count existing takes in fence to get next row_num
    const beginIdx = body.indexOf(TAKES_FENCE_BEGIN);
    const endIdx = body.indexOf(TAKES_FENCE_END);
    let rowNum = 1;
    
    if (beginIdx !== -1 && endIdx !== -1) {
      const fence = body.substring(beginIdx, endIdx);
      const lines = fence.split('\n').filter(l => l.startsWith('|') && !l.startsWith('| #') && !l.startsWith('|---'));
      const nums = lines.map(l => {
        const m = l.match(/^\|\s*(\d+)\s*\|/);
        return m ? parseInt(m[1]) : 0;
      }).filter(n => n > 0);
      rowNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    }
    
    body = ensureFence(body);
    body = appendTakeToFence(body, p.claim, p.kind, p.holder, p.weight, rowNum);
    
    writeFileSync(path, body, 'utf-8');
    
    // Update DB
    const q1 = `UPDATE take_proposals SET status='accepted', acted_at=NOW(), acted_by='codex', promoted_row_num=${rowNum} WHERE id=${p.id}`;
    psql(q1);
    
    console.log(`OK: ${p.sourceId}/${p.slug} #${rowNum} - ${p.claim.substring(0, 50)}...`);
    promoted++;
  } catch (e: any) {
    console.log(`ERR: ${p.sourceId}/${p.slug}: ${e.message}`);
    errors++;
  }
}

console.log(`\nDone: ${promoted} promoted, ${errors} errors`);
