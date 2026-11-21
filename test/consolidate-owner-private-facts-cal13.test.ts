/**
 * cal13 (carried patch; governance-admin paradigm, follows cal7):
 * `cycle.consolidate.owner_private_facts` lets the consolidate phase treat
 * owner-private facts as candidates on a managed brain — only onto their
 * own entity page, only when that page is itself owner-private, and never
 * mixed into a cluster with world facts. Gate off (or anything but an
 * explicit stored `true`) is exactly upstream behavior: managed
 * consolidation sees world facts only.
 */
import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { BrainEngine } from '../src/core/engine.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import {
  ownerPrivateFactsEnabled,
  pageAllowsOwnerPrivateFacts,
  runPhaseConsolidate,
} from '../src/core/cycle/phases/consolidate.ts';
import { submitPageMutation } from '../src/core/persistence/page-mutations.ts';
import { managedBrain, settleManagedGitEffects } from './helpers/managed-brain.ts';
import { page } from './helpers/pinned-questions-fixture.ts';

const GATE = 'cycle.consolidate.owner_private_facts';
const SLUG = 'people/alice-example';
const PRIVATE_CLAIM = 'Alice Example keeps a private research journal.';
const WORLD_CLAIM = 'Alice Example lives in Oslo.';

async function seedFacts(
  engine: BrainEngine,
  rows: Array<{ text: string; day: string; visibility: string }>,
): Promise<void> {
  const [{ t }] = await engine.executeRaw<{ t: string }>("SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid = 'facts'::regclass AND attname = 'embedding'");
  const dim = Number(t.match(/\((\d+)\)/)![1]);
  const vec = '[' + Array.from({ length: dim }, (_, k) => (k % 7 === 0 ? 0.3 : 0.01)).join(',') + ']';
  for (const r of rows) {
    await engine.executeRaw(`INSERT INTO facts (source_id, entity_slug, fact, kind, source, visibility, confidence, valid_from, embedding, embedded_at, embedding_model, embedded_text_hash)
      VALUES ('default', $1, $2, 'event', 'cli:extract-conversation-facts:v1', $3, 1, $4::timestamptz, $5::vector, now(), 'openai:text-embedding-3-large', md5($2))`,
      [SLUG, r.text, r.visibility, `${r.day}T00:00:00Z`, vec]);
  }
}

const copies = (text: string, visibility: string) => [
  { text, day: '2025-03-01', visibility },
  { text, day: '2025-06-01', visibility },
  { text, day: '2025-09-01', visibility },
];

async function consolidatedCount(engine: BrainEngine): Promise<number> {
  const [{ n }] = await engine.executeRaw<{ n: number }>(
    `SELECT count(*)::int AS n FROM facts WHERE source_id = 'default' AND entity_slug = $1 AND consolidated_at IS NOT NULL`, [SLUG]);
  return n;
}

async function takeClaims(engine: BrainEngine): Promise<string[]> {
  const rows = await engine.executeRaw<{ claim: string }>(
    `SELECT claim FROM takes tk JOIN pages p ON p.id = tk.page_id WHERE p.slug = $1 AND tk.active = true ORDER BY tk.id`, [SLUG]);
  return rows.map(r => r.claim);
}

/** One managed-brain scenario: seed page + facts with the writer guard lifted, restore it, run the phase. */
async function scenario(opts: {
  pageExtra: string;
  rows: Array<{ text: string; day: string; visibility: string }>;
  gate?: string;
}) {
  let out!: { phase: Awaited<ReturnType<typeof runPhaseConsolidate>>; consolidated: number; claims: string[] };
  await managedBrain(async ({ engine, ctx }) => {
    await engine.executeRaw("INSERT INTO access_members (id) VALUES ('domi') ON CONFLICT DO NOTHING");
    await engine.setConfig('access.owner_member', 'domi');
    await engine.setConfig('cycle.consolidate.owner_evidence_reads', 'true');
    if (opts.gate !== undefined) await engine.setConfig(GATE, opts.gate);
    await submitPageMutation(ctx, { operation: 'put_page', params: { slug: SLUG, request_id: randomUUID(), content: page('person', 'Alice Example', 'Alice Example is a designer.', opts.pageExtra) } });
    await settleManagedGitEffects(engine);
    await engine.executeRaw('UPDATE persistence_brain SET enabled=false WHERE singleton=1');
    try { await seedFacts(engine, opts.rows); }
    finally { await engine.executeRaw('UPDATE persistence_brain SET enabled=true WHERE singleton=1'); }
    const phase = await runPhaseConsolidate(engine, { sourceId: 'default' });
    out = { phase, consolidated: await consolidatedCount(engine), claims: await takeClaims(engine) };
  });
  return out;
}

const OWNER_PRIVATE_PAGE = 'visibility: private\nreadable_by: ["member:domi"]\n';
const OTHER_READER_PAGE = 'visibility: private\nreadable_by: ["member:light"]\n';
const WORLD_PAGE = '';

describe('cal13 owner-private facts in managed consolidation', () => {
  test('gate off: private facts on an owner-private page are invisible, as upstream', async () => {
    const r = await scenario({ pageExtra: OWNER_PRIVATE_PAGE, rows: copies(PRIVATE_CLAIM, 'private') });
    expect(r.phase.details).toMatchObject({ owner_private_facts_gate: false, private_facts_consolidated: 0 });
    expect(r.consolidated).toBe(0);
    expect(r.claims).toEqual([]);
  }, 300_000);

  test('gate on: private facts consolidate onto their owner-private page', async () => {
    const r = await scenario({ pageExtra: OWNER_PRIVATE_PAGE, rows: copies(PRIVATE_CLAIM, 'private'), gate: 'true' });
    expect(r.phase.details).toMatchObject({ owner_private_facts_gate: true, private_facts_consolidated: 3, private_facts_posture_skipped: 0 });
    expect(r.consolidated).toBe(3);
    expect(r.claims).toEqual([PRIVATE_CLAIM]);
  }, 300_000);

  test('gate on: private facts never promote onto a world page', async () => {
    const r = await scenario({ pageExtra: WORLD_PAGE, rows: copies(PRIVATE_CLAIM, 'private'), gate: 'true' });
    expect(r.phase.details).toMatchObject({ owner_private_facts_gate: true, private_facts_consolidated: 0, private_facts_posture_skipped: 3 });
    expect(r.consolidated).toBe(0);
    expect(r.claims).toEqual([]);
  }, 300_000);

  test("gate on: a page whose readers exclude the owner is not touched", async () => {
    const r = await scenario({ pageExtra: OTHER_READER_PAGE, rows: copies(PRIVATE_CLAIM, 'private'), gate: 'true' });
    expect(r.phase.details).toMatchObject({ private_facts_consolidated: 0, private_facts_posture_skipped: 3 });
    expect(r.consolidated).toBe(0);
    expect(r.claims).toEqual([]);
  }, 300_000);

  test('gate on: world and private facts in one bucket never share a cluster', async () => {
    const rows = [
      { text: WORLD_CLAIM, day: '2025-03-01', visibility: 'world' },
      { text: WORLD_CLAIM, day: '2025-06-01', visibility: 'world' },
      { text: PRIVATE_CLAIM, day: '2025-03-01', visibility: 'private' },
      { text: PRIVATE_CLAIM, day: '2025-06-01', visibility: 'private' },
    ];
    const r = await scenario({ pageExtra: OWNER_PRIVATE_PAGE, rows, gate: 'true' });
    expect(r.consolidated).toBe(4);
    expect(r.claims).toEqual([WORLD_CLAIM, PRIVATE_CLAIM]);
    expect(r.phase.details).toMatchObject({ private_facts_consolidated: 2 });
  }, 300_000);
});

describe('cal13 gate + posture units', () => {
  test('ownerPrivateFactsEnabled opens only on an explicit true', async () => {
    const engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();
    try {
      expect(await ownerPrivateFactsEnabled(engine)).toBe(false);
      for (const raw of ['yes', '1', 'on', ' TRUE-ish ']) {
        await engine.setConfig(GATE, raw);
        expect(await ownerPrivateFactsEnabled(engine)).toBe(false);
      }
      await engine.setConfig(GATE, ' true ');
      expect(await ownerPrivateFactsEnabled(engine)).toBe(true);
    } finally { await engine.disconnect(); }
  }, 300_000);

  test('pageAllowsOwnerPrivateFacts posture matrix', () => {
    const P = pageAllowsOwnerPrivateFacts;
    expect(P({ frontmatter: { visibility: 'world' } }, 'domi')).toBe(false);
    expect(P({ frontmatter: {} }, 'domi')).toBe(false);
    expect(P({ frontmatter: { visibility: 'private' } }, 'domi')).toBe(true);
    expect(P({ frontmatter: { visibility: 'private', readable_by: ['member:domi'] } }, 'domi')).toBe(true);
    expect(P({ frontmatter: { visibility: 'private' }, page_readers: ['member:domi'] }, 'domi')).toBe(true);
    expect(P({ frontmatter: { visibility: 'private', readable_by: ['member:light'] } }, 'domi')).toBe(false);
    expect(P({ frontmatter: { visibility: 'private', readable_by: ['member:light', 'member:domi'] } }, 'domi')).toBe(true);
    expect(P({ frontmatter: { visibility: 'private' } }, null)).toBe(false);
  });
});
