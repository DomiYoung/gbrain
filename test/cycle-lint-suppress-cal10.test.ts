/**
 * cal10 (carried patch, realign-748): `cycle.lint_suppress` is a
 * comma-separated list of `slug|rule` pairs naming lint findings the
 * operator has reviewed and acknowledged. The cycle's lint phase scans and
 * fixes exactly as upstream; a listed finding counts as suppressed instead
 * of remaining, so an acknowledged finding does not hold the phase at warn.
 * Unset, the phase result is byte-for-byte the upstream shape (no
 * `suppressed` detail keys, no summary suffix). A malformed stored value
 * (written with --force) fails open to upstream behavior; `config set`
 * refuses a malformed value via assertCycleConfigValue.
 *
 * Seam: runPhaseLint over a PGLite engine + temp brain dir, mirroring
 * test/cycle-lint-enabled-6369.test.ts. Fixtures: a no-frontmatter page
 * (rule `no-frontmatter`, unfixable) and the fenced page from #6369
 * (rule `code-fence-wrap`, fixable; held remaining via cycle.lint_fix=false).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { runPhaseLint } from '../src/core/cycle.ts';
import { assertCycleConfigValue } from '../src/core/cycle/config-guards.ts';
import { parseCycleLintSuppress } from '../src/core/cycle/lint-fix-setting.ts';

let engine: PGLiteEngine;
let brainDir: string;
const PLAIN = '# Plain\n\nBody text.\n';
const WRAPPED = '```markdown\n---\ntitle: Wrapped\ntype: note\ndate: 2026-01-01\n---\n\nBody.\n```\n';

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});
afterAll(async () => { await engine.disconnect(); });
beforeEach(async () => {
  await resetPgliteState(engine);
  brainDir = mkdtempSync(join(tmpdir(), 'cycle-lint-suppress-'));
  mkdirSync(join(brainDir, 'notes'), { recursive: true });
  writeFileSync(join(brainDir, 'notes', 'plain.md'), PLAIN);
});
const cleanup = () => { try { rmSync(brainDir, { recursive: true, force: true }); } catch { /* best effort */ } };
type Details = { issues?: number; suppressed?: number; lint_suppress_entries?: number };

describe('cycle.lint_suppress (cal10)', () => {
  test('unconfigured: warn, remaining counts the finding, no suppressed keys (upstream shape)', async () => {
    try {
      const result = await runPhaseLint(brainDir, false, engine);
      expect(result.status).toBe('warn');
      expect((result.details as Details).issues).toBe(1);
      expect((result.details as Details).suppressed).toBeUndefined();
      expect((result.details as Details).lint_suppress_entries).toBeUndefined();
      expect(result.summary).not.toContain('suppressed');
    } finally { cleanup(); }
  });

  test('the listed finding is suppressed: phase ok, suppressed=1, summary names it', async () => {
    try {
      await engine.setConfig('cycle.lint_suppress', 'notes/plain|no-frontmatter');
      const result = await runPhaseLint(brainDir, false, engine);
      expect(result.status).toBe('ok');
      expect((result.details as Details).suppressed).toBe(1);
      expect((result.details as Details).lint_suppress_entries).toBe(1);
      expect(result.summary).toContain('1 suppressed (acknowledged)');
    } finally { cleanup(); }
  });

  test('a wrong rule for the same slug suppresses nothing', async () => {
    try {
      await engine.setConfig('cycle.lint_suppress', 'notes/plain|empty-section');
      const result = await runPhaseLint(brainDir, false, engine);
      expect(result.status).toBe('warn');
      expect((result.details as Details).suppressed).toBe(0);
      expect(result.summary).not.toContain('suppressed (acknowledged)');
    } finally { cleanup(); }
  });

  test('one of two pages listed: suppressed=1 and the phase still warns on the other', async () => {
    try {
      writeFileSync(join(brainDir, 'notes', 'wrapped.md'), WRAPPED);
      await engine.setConfig('cycle.lint_fix', 'false');
      await engine.setConfig('cycle.lint_suppress', 'notes/plain|no-frontmatter');
      const result = await runPhaseLint(brainDir, false, engine);
      expect(result.status).toBe('warn');
      expect((result.details as Details).suppressed).toBe(1);
    } finally { cleanup(); }
  });

  test('both pages listed: phase ok with suppressed=3 (the fenced page fires two rules)', async () => {
    try {
      writeFileSync(join(brainDir, 'notes', 'wrapped.md'), WRAPPED);
      await engine.setConfig('cycle.lint_fix', 'false');
      await engine.setConfig('cycle.lint_suppress', 'notes/plain|no-frontmatter,notes/wrapped|code-fence-wrap,notes/wrapped|no-frontmatter');
      const result = await runPhaseLint(brainDir, false, engine);
      expect(result.status).toBe('ok');
      expect((result.details as Details).suppressed).toBe(3);
    } finally { cleanup(); }
  });

  test('a malformed stored value fails open: no valid entries means the upstream shape', async () => {
    try {
      await engine.setConfig('cycle.lint_suppress', 'not-a-pair');
      const result = await runPhaseLint(brainDir, false, engine);
      expect(result.status).toBe('warn');
      expect((result.details as Details).suppressed).toBeUndefined();
    } finally { cleanup(); }
  });

  test('config-set guard: valid pairs pass, malformed values are refused', () => {
    expect(parseCycleLintSuppress('notes/plain|no-frontmatter, concepts/x|empty-section')).toEqual(['notes/plain|no-frontmatter', 'concepts/x|empty-section']);
    expect(() => assertCycleConfigValue('cycle.lint_suppress', 'notes/plain|no-frontmatter')).not.toThrow();
    for (const bad of ['not-a-pair', 'a|b|c', '|no-frontmatter', 'has space|no-frontmatter', 'notes/plain|Bad_Rule', 'notes/plain|']) {
      expect(() => parseCycleLintSuppress(bad)).toThrow();
      expect(() => assertCycleConfigValue('cycle.lint_suppress', bad)).toThrow();
    }
  });
});
