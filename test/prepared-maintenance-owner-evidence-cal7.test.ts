/**
 * cal7 (carried patch, realign-748): `cycle.consolidate.owner_evidence_reads`
 * gates an owner caller-access record for the two consolidation evidence
 * snapshot reads in persistence/prepared-maintenance.ts. The cycle's empty
 * caller identity makes owner-private entity pages structurally unreadable
 * to those reads (every cluster fails page_not_found); the record is
 * assembled at the read point from upstream's own functions and relaxes
 * only the privacy part — the member part (readable_by/folder rules) is
 * unchanged and lineage stays off, so ownerReadsRestricted never applies.
 *
 * This suite pins the gate/helper contract: default off, only an explicit
 * stored `true` opens it, and every failure mode (owner unset, ill-formed,
 * missing or disabled member) falls back to null = today's behavior. The
 * end-to-end proof (a private entity page's cluster actually consolidates,
 * a page whose readers exclude the owner still does not) is the switch
 * acceptance's scoped `dream --phase consolidate` run, as on 734.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { ownerEvidenceAccess } from '../src/core/persistence/prepared-maintenance.ts';

let engine: PGLiteEngine;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});
afterAll(async () => { await engine.disconnect(); });
beforeEach(async () => {
  await resetPgliteState(engine);
  await engine.executeRaw("INSERT INTO access_members (id) VALUES ('domi')");
  await engine.setConfig('access.owner_member', 'domi');
});

describe('ownerEvidenceAccess (cal7)', () => {
  test('gate unset: null (today\u2019s behavior)', async () => {
    expect(await ownerEvidenceAccess(engine)).toBeNull();
  });

  test('gate not explicitly true: null', async () => {
    for (const raw of ['false', 'yes', '1', 'on', '']) {
      await engine.setConfig('cycle.consolidate.owner_evidence_reads', raw);
      expect(await ownerEvidenceAccess(engine)).toBeNull();
    }
  });

  test('gate true with a live owner: the owner record, member part intact, lineage off', async () => {
    await engine.setConfig('cycle.consolidate.owner_evidence_reads', 'true');
    const access = await ownerEvidenceAccess(engine);
    expect(access).not.toBeNull();
    expect(access!.owner).toBe(true);
    expect(access!.hidePrivate).toBe(false);
    expect(access!.lineage).toBe(false);
    expect(access!.ownerReadsRestricted).toBe(false);
    expect(access!.identity).toContain('member:domi');
    expect(access!.privateReadableSources).toEqual([]);
    expect(access!.privateFactSources).toEqual([]);
    expect(access!.labelledOnly).toBe(false);
  });

  test('gate true but owner_member unset: null', async () => {
    await engine.setConfig('cycle.consolidate.owner_evidence_reads', 'true');
    await engine.setConfig('access.owner_member', '');
    expect(await ownerEvidenceAccess(engine)).toBeNull();
  });

  test('gate true but the owner member does not exist: null', async () => {
    await engine.setConfig('cycle.consolidate.owner_evidence_reads', 'true');
    await engine.setConfig('access.owner_member', 'ghost');
    expect(await ownerEvidenceAccess(engine)).toBeNull();
  });

  test('gate true but the owner member is disabled: null (liveness re-checked per read)', async () => {
    await engine.setConfig('cycle.consolidate.owner_evidence_reads', 'true');
    await engine.executeRaw("UPDATE access_members SET disabled_at = now() WHERE id = 'domi'");
    expect(await ownerEvidenceAccess(engine)).toBeNull();
  });
});
