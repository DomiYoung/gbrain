/**
 * cal9 (carried patch, realign-748): patterns pages finalized through the
 * managed maintenance path never run the put_page provenance stamp, so they
 * landed without ingested_at / source_kind / ingested_via and, when the
 * child's staged frontmatter lacked it, without the owner posture
 * (visibility/readable_by) — surfacing as lint `missing-created` and as
 * posture-less pages. maintenanceStampFrontmatter therefore accepts an
 * optional `stamp`: absent-only backfill of the ingest keys (with
 * source_kind/ingested_via 'put_page', the local write shape) and of the
 * owner posture (private + member:<owner>). No stamp = upstream shape.
 *
 * Seam: the pure frontmatter function; the patterns call sites are covered
 * by the cycle-patterns suites.
 */
import { describe, expect, test } from 'bun:test';
import { maintenanceStampFrontmatter } from '../src/core/persistence/prepared-maintenance.ts';

const DATE = '2026-11-20';
const ISO = '2026-11-20T14:00:00.000Z';

describe('maintenanceStampFrontmatter cal9 stamp', () => {
  test('no stamp argument: upstream shape, no ingest or posture keys added', () => {
    const out = maintenanceStampFrontmatter({ title: 'X' }, DATE);
    expect(out.dream_generated).toBe(true);
    expect(out.dream_cycle_date).toBe(DATE);
    expect(out.ingested_at).toBeUndefined();
    expect(out.source_kind).toBeUndefined();
    expect(out.ingested_via).toBeUndefined();
    expect(out.visibility).toBeUndefined();
    expect(out.readable_by).toBeUndefined();
  });

  test('stamp with ingestedAt and ownerMember backfills all five keys', () => {
    const out = maintenanceStampFrontmatter({ title: 'X' }, DATE, undefined, undefined, undefined, { ingestedAt: ISO, ownerMember: 'domi' });
    expect(out.ingested_at).toBe(ISO);
    expect(out.source_kind).toBe('put_page');
    expect(out.ingested_via).toBe('put_page');
    expect(out.visibility).toBe('private');
    expect(out.readable_by).toEqual(['member:domi']);
  });

  test('absent-only: values the page already carries are never overwritten', () => {
    const fm = { ingested_at: '2026-11-19T06:20:52Z', source_kind: 'sync', ingested_via: 'sync', visibility: 'world', readable_by: ['world'] };
    const out = maintenanceStampFrontmatter(fm, DATE, undefined, undefined, undefined, { ingestedAt: ISO, ownerMember: 'domi' });
    expect(out.ingested_at).toBe('2026-11-19T06:20:52Z');
    expect(out.source_kind).toBe('sync');
    expect(out.ingested_via).toBe('sync');
    expect(out.visibility).toBe('world');
    expect(out.readable_by).toEqual(['world']);
  });

  test('ownerMember null (owner unconfigured): ingest keys land, posture does not (fail-closed)', () => {
    const out = maintenanceStampFrontmatter({ title: 'X' }, DATE, undefined, undefined, undefined, { ingestedAt: ISO, ownerMember: null });
    expect(out.ingested_at).toBe(ISO);
    expect(out.visibility).toBeUndefined();
    expect(out.readable_by).toBeUndefined();
  });

  test('stamp without ingestedAt: posture lands, ingest keys do not', () => {
    const out = maintenanceStampFrontmatter({ title: 'X' }, DATE, undefined, undefined, undefined, { ownerMember: 'domi' });
    expect(out.ingested_at).toBeUndefined();
    expect(out.source_kind).toBeUndefined();
    expect(out.visibility).toBe('private');
    expect(out.readable_by).toEqual(['member:domi']);
  });
});
