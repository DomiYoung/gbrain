import { describe, expect, test } from 'bun:test';
import { summarizeFactsAudit } from '../src/commands/facts-audit.ts';

describe('summarizeFactsAudit', () => {
  test('keeps row categories overlapping and reports candidate buckets conservatively', () => {
    const generatedAt = new Date('2026-08-10T12:00:00.000Z');
    const report = summarizeFactsAudit(
      'obsidian',
      {
        pending_total: '10',
        no_entity_slug: '2',
        missing_embedding: '4',
        embedding_present_embedded_at_missing: '5',
        embedding_missing_embedded_at_set: '0',
        superseded: '1',
        missing_source_session: '3',
        missing_entity_page: '2',
        oldest_pending_at: '2026-07-01T00:00:00.000Z',
        age_lt_24h: '2',
        age_1_to_7d: '3',
        age_7_to_30d: '1',
        age_gt_30d: '4',
      },
      [
        {
          entity_slug: 'people/alice',
          count: '4',
          oldest_pending_at: '2026-08-01T00:00:00.000Z',
          page_exists: true,
          missing_embedding: '1',
        },
        {
          entity_slug: 'people/bob',
          count: '2',
          oldest_pending_at: '2026-08-01T00:00:00.000Z',
          page_exists: 'false',
          missing_embedding: '2',
        },
        {
          entity_slug: 'people/carol',
          count: '3',
          oldest_pending_at: '2026-08-10T11:30:00.000Z',
          page_exists: true,
          missing_embedding: '0',
        },
      ],
      [{ entity_slug: 'people/alice', count: '4' }],
      generatedAt,
    );

    expect(report.pending_total).toBe(10);
    expect(report.oldest_pending_at).toBe('2026-07-01T00:00:00.000Z');
    expect(report.semantics.categories_overlap).toBe(true);
    expect(report.row_categories.missing_embedding).toBe(4);
    expect(report.bucket_summary.total_buckets).toBe(3);
    expect(report.bucket_summary.buckets_below_minimum).toBe(1);
    expect(report.bucket_summary.buckets_candidate_by_size_and_age).toBe(1);
    expect(report.bucket_summary.rows_candidate_by_size_and_age).toBe(4);
    expect(report.bucket_summary.rows_missing_embedding_in_candidate_buckets).toBe(1);
  });

  test('handles empty pending baseline without fabricating dates or buckets', () => {
    const generatedAt = new Date('2026-08-10T12:00:00.000Z');
    const report = summarizeFactsAudit(
      'obsidian',
      {
        pending_total: 0,
        no_entity_slug: 0,
        missing_embedding: 0,
        embedding_present_embedded_at_missing: 0,
        embedding_missing_embedded_at_set: 0,
        superseded: 0,
        missing_source_session: 0,
        missing_entity_page: 0,
        oldest_pending_at: null,
        age_lt_24h: 0,
        age_1_to_7d: 0,
        age_7_to_30d: 0,
        age_gt_30d: 0,
      },
      [],
      [],
      generatedAt,
    );

    expect(report.pending_total).toBe(0);
    expect(report.oldest_pending_at).toBeNull();
    expect(report.bucket_summary.total_buckets).toBe(0);
    expect(report.top_entities).toEqual([]);
  });
});
