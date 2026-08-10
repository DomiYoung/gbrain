/**
 * Read-only Facts backlog audit.
 *
 * This command deliberately reports overlapping categories instead of inventing
 * a single disposition for every pending fact. The consolidation phase has
 * separate gates for bucket size, age, entity-page existence, embeddings, and
 * cosine clustering; an aggregate pending count cannot explain why a row was
 * skipped.
 *
 * Usage:
 *   gbrain facts audit --source-id obsidian --json
 *
 * The command performs SELECT-only queries and never mutates facts, takes, or
 * pages. It is host-only because thin clients do not own the canonical DB.
 */

import type { BrainEngine } from '../core/engine.ts';
import { isThinClient, loadConfig } from '../core/config.ts';
import { resolveSourceId } from '../core/source-resolver.ts';
import { runPhaseConsolidate } from '../core/cycle/phases/consolidate.ts';
import { withRefreshingLock, LockUnavailableError } from '../core/db-lock.ts';
import { embedBatch } from '../core/embedding.ts';

const MIN_FACTS_PER_BUCKET = 3;
const MIN_OLDEST_AGE_MS = 24 * 60 * 60 * 1000;
const TOP_ENTITY_LIMIT = 20;

interface AggregateRow {
  pending_total: number | string;
  no_entity_slug: number | string;
  missing_embedding: number | string;
  embedding_present_embedded_at_missing: number | string;
  embedding_missing_embedded_at_set: number | string;
  superseded: number | string;
  missing_source_session: number | string;
  missing_entity_page: number | string;
  oldest_pending_at: Date | string | null;
  age_lt_24h: number | string;
  age_1_to_7d: number | string;
  age_7_to_30d: number | string;
  age_gt_30d: number | string;
}

export interface FactsAuditBucket {
  entity_slug: string;
  count: number | string;
  oldest_pending_at: Date | string | null;
  page_exists: boolean | string;
  missing_embedding: number | string;
}

export interface FactsAuditTopEntity {
  entity_slug: string;
  count: number | string;
}

export interface MissingEntityGovernanceRow {
  entity_slug: string;
  pending_count: number | string;
  oldest_pending_at: Date | string | null;
  missing_embedding: number | string;
  sample_fact_ids: number[] | string[] | null;
}

export interface FactsAuditReport {
  schema_version: 1;
  source_id: string;
  generated_at: string;
  semantics: {
    pending: string;
    categories_overlap: true;
    candidate_rows_are_pre_cluster: true;
  };
  thresholds: {
    min_facts_per_bucket: number;
    min_oldest_age_hours: number;
  };
  pending_total: number;
  oldest_pending_at: string | null;
  age_buckets: {
    lt_24h: number;
    one_to_seven_days: number;
    seven_to_thirty_days: number;
    gt_30_days: number;
  };
  row_categories: {
    no_entity_slug: number;
    missing_embedding: number;
    embedding_present_embedded_at_missing: number;
    embedding_missing_embedded_at_set: number;
    superseded: number;
    missing_source_session: number;
    missing_entity_page: number;
  };
  bucket_summary: {
    total_buckets: number;
    buckets_below_minimum: number;
    buckets_meeting_count_gate: number;
    buckets_meeting_age_gate: number;
    buckets_candidate_by_size_and_age: number;
    rows_candidate_by_size_and_age: number;
    buckets_missing_entity_page: number;
    rows_missing_embedding_in_candidate_buckets: number;
  };
  top_entities: Array<{ entity_slug: string; count: number }>;
  next_step: string;
}

function asNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  return asDate(value)?.toISOString() ?? null;
}

export function summarizeFactsAudit(
  sourceId: string,
  aggregate: AggregateRow,
  buckets: FactsAuditBucket[],
  topEntities: FactsAuditTopEntity[],
  generatedAt = new Date(),
): FactsAuditReport {
  const cutoff = generatedAt.getTime() - MIN_OLDEST_AGE_MS;
  let bucketsBelowMinimum = 0;
  let bucketsMeetingCountGate = 0;
  let bucketsMeetingAgeGate = 0;
  let bucketsCandidateBySizeAndAge = 0;
  let rowsCandidateBySizeAndAge = 0;
  let bucketsMissingEntityPage = 0;
  let rowsMissingEmbeddingInCandidateBuckets = 0;

  for (const bucket of buckets) {
    const count = asNumber(bucket.count);
    const oldest = asDate(bucket.oldest_pending_at);
    const pageExists = bucket.page_exists === true || bucket.page_exists === 'true';
    if (count < MIN_FACTS_PER_BUCKET) {
      bucketsBelowMinimum += 1;
    } else {
      bucketsMeetingCountGate += 1;
      if (oldest && oldest.getTime() <= cutoff) {
        bucketsMeetingAgeGate += 1;
        bucketsCandidateBySizeAndAge += 1;
        rowsCandidateBySizeAndAge += count;
        rowsMissingEmbeddingInCandidateBuckets += asNumber(bucket.missing_embedding);
      }
    }
    if (!pageExists) bucketsMissingEntityPage += 1;
  }

  return {
    schema_version: 1,
    source_id: sourceId,
    generated_at: generatedAt.toISOString(),
    semantics: {
      pending: 'consolidated_at IS NULL AND expired_at IS NULL',
      categories_overlap: true,
      candidate_rows_are_pre_cluster: true,
    },
    thresholds: {
      min_facts_per_bucket: MIN_FACTS_PER_BUCKET,
      min_oldest_age_hours: MIN_OLDEST_AGE_MS / (60 * 60 * 1000),
    },
    pending_total: asNumber(aggregate.pending_total),
    oldest_pending_at: isoOrNull(aggregate.oldest_pending_at),
    age_buckets: {
      lt_24h: asNumber(aggregate.age_lt_24h),
      one_to_seven_days: asNumber(aggregate.age_1_to_7d),
      seven_to_thirty_days: asNumber(aggregate.age_7_to_30d),
      gt_30_days: asNumber(aggregate.age_gt_30d),
    },
    row_categories: {
      no_entity_slug: asNumber(aggregate.no_entity_slug),
      missing_embedding: asNumber(aggregate.missing_embedding),
      embedding_present_embedded_at_missing: asNumber(aggregate.embedding_present_embedded_at_missing),
      embedding_missing_embedded_at_set: asNumber(aggregate.embedding_missing_embedded_at_set),
      superseded: asNumber(aggregate.superseded),
      missing_source_session: asNumber(aggregate.missing_source_session),
      missing_entity_page: asNumber(aggregate.missing_entity_page),
    },
    bucket_summary: {
      total_buckets: buckets.length,
      buckets_below_minimum: bucketsBelowMinimum,
      buckets_meeting_count_gate: bucketsMeetingCountGate,
      buckets_meeting_age_gate: bucketsMeetingAgeGate,
      buckets_candidate_by_size_and_age: bucketsCandidateBySizeAndAge,
      rows_candidate_by_size_and_age: rowsCandidateBySizeAndAge,
      buckets_missing_entity_page: bucketsMissingEntityPage,
      rows_missing_embedding_in_candidate_buckets: rowsMissingEmbeddingInCandidateBuckets,
    },
    top_entities: topEntities
      .map((row) => ({ entity_slug: row.entity_slug, count: asNumber(row.count) }))
      .filter((row) => row.entity_slug.length > 0)
      .slice(0, TOP_ENTITY_LIMIT),
    next_step: 'Review category overlap and candidate buckets before any facts embedding backfill or consolidation write.',
  };
}

function parseFlags(args: string[]): {
  source: string | null;
  json: boolean;
  apply: boolean;
  yes: boolean;
  maxBuckets: number | null;
  limit: number | null;
  missingEntityReport: boolean;
} {
  let source: string | null = null;
  let json = false;
  let apply = false;
  let yes = false;
  let maxBuckets: number | null = null;
  let limit: number | null = null;
  let missingEntityReport = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--source' || arg === '--source-id') {
      source = args[++i] ?? null;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--yes') {
      yes = true;
    } else if (arg === '--max-buckets') {
      const parsed = Number(args[++i]);
      maxBuckets = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } else if (arg === '--limit') {
      const parsed = Number(args[++i]);
      limit = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } else if (arg === '--missing-entity-report') {
      missingEntityReport = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return { source, json, apply, yes, maxBuckets, limit, missingEntityReport };
}

export async function runFactsAudit(engine: BrainEngine, args: string[]): Promise<void> {
  const flags = parseFlags(args.slice(args[0] === 'audit' ? 1 : 0));
  if (isThinClient(loadConfig())) {
    console.error('facts audit requires the canonical host engine; run it on the GBrain host, not a thin client.');
    process.exit(2);
  }

  const sourceId = await resolveSourceId(engine, flags.source);
  const generatedAt = new Date();

  if (flags.missingEntityReport) {
    const rows = await engine.executeRaw<MissingEntityGovernanceRow>(`
      SELECT
        f.entity_slug,
        COUNT(*)::int AS pending_count,
        MIN(f.valid_from) AS oldest_pending_at,
        COUNT(*) FILTER (WHERE f.embedding IS NULL)::int AS missing_embedding,
        ARRAY(
          SELECT f2.id
          FROM facts f2
          WHERE f2.source_id = f.source_id
            AND f2.entity_slug = f.entity_slug
            AND BTRIM(f2.entity_slug) <> ''
            AND f2.consolidated_at IS NULL
            AND f2.expired_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM pages p2
              WHERE p2.source_id = f2.source_id
                AND p2.slug = f2.entity_slug
                AND p2.deleted_at IS NULL
            )
          ORDER BY f2.id ASC
          LIMIT 10
        )::int[] AS sample_fact_ids
      FROM facts f
      WHERE f.source_id = $1
        AND f.consolidated_at IS NULL
        AND f.expired_at IS NULL
        AND f.entity_slug IS NOT NULL
        AND BTRIM(f.entity_slug) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM pages p
          WHERE p.source_id = f.source_id
            AND p.slug = f.entity_slug
            AND p.deleted_at IS NULL
        )
      GROUP BY f.source_id, f.entity_slug
      ORDER BY COUNT(*) DESC, f.entity_slug ASC
    `, [sourceId]);
    const report = {
      schema_version: 1,
      command: 'facts audit',
      mode: 'read-only',
      report: 'missing canonical entity pages',
      source_id: sourceId,
      generated_at: generatedAt.toISOString(),
      semantics: {
        pending: 'consolidated_at IS NULL AND expired_at IS NULL',
        page_missing: 'no non-deleted page with the same source_id and entity_slug',
        automatic_page_creation: false,
      },
      total_buckets: rows.length,
      total_pending_facts: rows.reduce((sum, row) => sum + asNumber(row.pending_count), 0),
      rows: rows.map((row) => ({
        entity_slug: row.entity_slug,
        pending_count: asNumber(row.pending_count),
        oldest_pending_at: isoOrNull(row.oldest_pending_at),
        missing_embedding: asNumber(row.missing_embedding),
        sample_fact_ids: (row.sample_fact_ids ?? []).map((id) => Number(id)).filter(Number.isInteger),
      })),
      next_step: 'Review entity_slug ownership and canonical mapping before any page creation or fact consolidation.',
    };
    if (flags.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    else console.log(JSON.stringify(report, null, 2));
    return;
  }

  const since24h = new Date(generatedAt.getTime() - MIN_OLDEST_AGE_MS).toISOString();
  const since7d = new Date(generatedAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(generatedAt.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const aggregateRows = await engine.executeRaw<AggregateRow>(`
    SELECT
      COUNT(*)::int AS pending_total,
      COUNT(*) FILTER (WHERE entity_slug IS NULL)::int AS no_entity_slug,
      COUNT(*) FILTER (WHERE embedding IS NULL)::int AS missing_embedding,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL AND embedded_at IS NULL)::int AS embedding_present_embedded_at_missing,
      COUNT(*) FILTER (WHERE embedding IS NULL AND embedded_at IS NOT NULL)::int AS embedding_missing_embedded_at_set,
      COUNT(*) FILTER (WHERE superseded_by IS NOT NULL)::int AS superseded,
      COUNT(*) FILTER (WHERE source_session IS NULL OR source_session = '')::int AS missing_source_session,
      COUNT(*) FILTER (WHERE entity_slug IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pages p
        WHERE p.source_id = facts.source_id
          AND p.slug = facts.entity_slug
          AND p.deleted_at IS NULL
      ))::int AS missing_entity_page,
      MIN(valid_from) AS oldest_pending_at,
      COUNT(*) FILTER (WHERE valid_from >= $2)::int AS age_lt_24h,
      COUNT(*) FILTER (WHERE valid_from < $2 AND valid_from >= $3)::int AS age_1_to_7d,
      COUNT(*) FILTER (WHERE valid_from < $3 AND valid_from >= $4)::int AS age_7_to_30d,
      COUNT(*) FILTER (WHERE valid_from < $4)::int AS age_gt_30d
    FROM facts
    WHERE source_id = $1
      AND consolidated_at IS NULL
      AND expired_at IS NULL
  `, [sourceId, since24h, since7d, since30d]);

  const buckets = await engine.executeRaw<FactsAuditBucket>(`
    SELECT
      f.entity_slug,
      COUNT(*)::int AS count,
      MIN(f.valid_from) AS oldest_pending_at,
      EXISTS (
        SELECT 1 FROM pages p
        WHERE p.source_id = f.source_id
          AND p.slug = f.entity_slug
          AND p.deleted_at IS NULL
      ) AS page_exists,
      COUNT(*) FILTER (WHERE f.embedding IS NULL)::int AS missing_embedding
    FROM facts f
    WHERE f.source_id = $1
      AND f.consolidated_at IS NULL
      AND f.expired_at IS NULL
      AND f.entity_slug IS NOT NULL
    GROUP BY f.source_id, f.entity_slug
    ORDER BY COUNT(*) DESC, f.entity_slug ASC
  `, [sourceId]);

  const topEntities = await engine.executeRaw<FactsAuditTopEntity>(`
    SELECT entity_slug, COUNT(*)::int AS count
    FROM facts
    WHERE source_id = $1
      AND consolidated_at IS NULL
      AND expired_at IS NULL
      AND entity_slug IS NOT NULL
    GROUP BY entity_slug
    ORDER BY COUNT(*) DESC, entity_slug ASC
    LIMIT ${TOP_ENTITY_LIMIT}
  `, [sourceId]);

  const report = summarizeFactsAudit(
    sourceId,
    aggregateRows[0] ?? {
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
    buckets,
    topEntities,
    generatedAt,
  );

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  printHumanReport(report);
}

/**
 * Bounded consolidation wrapper. The default is a dry-run; writes require
 * both --apply and --yes, plus an explicit --max-buckets cap. This keeps the
 * first repair action reversible in scope and prevents a full-brain cycle from
 * being mistaken for a small backlog repair.
 */
export async function runFactsConsolidate(engine: BrainEngine, args: string[]): Promise<void> {
  const flags = parseFlags(args.slice(args[0] === 'consolidate' ? 1 : 0));
  if (isThinClient(loadConfig())) {
    console.error('facts consolidate requires the canonical host engine; run it on the GBrain host.');
    process.exit(2);
  }
  if (flags.maxBuckets === null) {
    console.error('facts consolidate requires a positive --max-buckets cap.');
    process.exit(2);
  }
  if (flags.apply && !flags.yes) {
    console.error('facts consolidate writes require both --apply and --yes.');
    process.exit(2);
  }

  const sourceId = await resolveSourceId(engine, flags.source);
  let phase;
  try {
    // Reuse the broad cycle lock so this bounded command cannot race the
    // resident autopilot/global-maintenance worker. Dry-run also takes the
    // lock: its read snapshot must not be mistaken for an apply window.
    phase = await withRefreshingLock(engine, 'gbrain-cycle', () => runPhaseConsolidate(engine, {
      sourceId,
      maxBuckets: flags.maxBuckets!,
      dryRun: !flags.apply,
    }));
  } catch (error) {
    if (error instanceof LockUnavailableError) {
      const blocked = {
        schema_version: 1,
        command: 'facts consolidate',
        mode: 'blocked',
        source_id: sourceId,
        max_buckets: flags.maxBuckets,
        reason: 'cycle_already_running',
      };
      if (flags.json) process.stdout.write(JSON.stringify(blocked, null, 2) + '\n');
      else console.log(`Facts consolidate blocked: cycle already running for ${sourceId}.`);
      return;
    }
    throw error;
  }
  const receipt = {
    schema_version: 1,
    command: 'facts consolidate',
    mode: flags.apply ? 'apply' : 'dry-run',
    source_id: sourceId,
    max_buckets: flags.maxBuckets,
    phase,
  };
  if (flags.json) {
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
    return;
  }
  console.log(`Facts consolidate ${receipt.mode}: ${sourceId}, max buckets=${flags.maxBuckets}`);
  console.log(phase.summary);
  console.log(`facts_consolidated=${phase.details?.facts_consolidated ?? 0}, takes_written=${phase.details?.takes_written ?? 0}`);
}

/**
 * Bounded missing-embedding repair. This is intentionally separate from page
 * embedding: facts have their own vector column and must be updated through
 * BrainEngine.updateFactEmbedding, not a command-layer UPDATE statement.
 */
export async function runFactsEmbed(engine: BrainEngine, args: string[]): Promise<void> {
  const flags = parseFlags(args.slice(args[0] === 'embed' ? 1 : 0));
  if (isThinClient(loadConfig())) {
    console.error('facts embed requires the canonical host engine; run it on the GBrain host.');
    process.exit(2);
  }
  if (flags.limit === null) {
    console.error('facts embed requires a positive --limit cap.');
    process.exit(2);
  }
  if (flags.apply && !flags.yes) {
    console.error('facts embed writes require both --apply and --yes.');
    process.exit(2);
  }

  const sourceId = await resolveSourceId(engine, flags.source);
  const run = async () => {
    const rows = await engine.executeRaw<{ id: number; fact: string }>(`
      SELECT id, fact
      FROM facts
      WHERE source_id = $1
        AND expired_at IS NULL
        AND consolidated_at IS NULL
        AND embedding IS NULL
        AND entity_slug IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM pages p
          WHERE p.source_id = facts.source_id
            AND p.slug = facts.entity_slug
            AND p.deleted_at IS NULL
        )
      ORDER BY id ASC
      LIMIT $2
    `, [sourceId, flags.limit]);
    const ids = rows.map((row) => Number(row.id)).filter(Number.isInteger);
    if (!flags.apply || rows.length === 0) {
      return {
        schema_version: 1,
        command: 'facts embed',
        mode: 'dry-run',
        source_id: sourceId,
        limit: flags.limit,
        selected: rows.length,
        embedded: 0,
        readback_embedded: 0,
        failed: 0,
        fact_ids: ids,
      };
    }

    let vectors: Float32Array[];
    try {
      vectors = await embedBatch(rows.map((row) => row.fact), { maxRetries: 0 });
    } catch (error) {
      return {
        schema_version: 1,
        command: 'facts embed',
        mode: 'apply',
        source_id: sourceId,
        limit: flags.limit,
        selected: rows.length,
        embedded: 0,
        readback_embedded: 0,
        failed: rows.length,
        fact_ids: ids,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (vectors.length !== rows.length) {
      throw new Error(`Embedding provider returned ${vectors.length} vectors for ${rows.length} facts.`);
    }

    let embedded = 0;
    for (let i = 0; i < rows.length; i++) {
      if (await engine.updateFactEmbedding(ids[i], vectors[i])) embedded += 1;
    }
    const idList = ids.join(',');
    const readback = await engine.executeRaw<{ embedded: number | string }>(
      `SELECT COUNT(*)::int AS embedded FROM facts WHERE id IN (${idList}) AND embedding IS NOT NULL`,
    );
    return {
      schema_version: 1,
      command: 'facts embed',
      mode: 'apply',
      source_id: sourceId,
      limit: flags.limit,
      selected: rows.length,
      embedded,
      readback_embedded: asNumber(readback[0]?.embedded),
      failed: rows.length - embedded,
      fact_ids: ids,
    };
  };

  let receipt;
  try {
    receipt = await withRefreshingLock(engine, 'gbrain-cycle', () =>
      withRefreshingLock(engine, `facts-embedding:${sourceId}`, run));
  } catch (error) {
    if (error instanceof LockUnavailableError) {
      receipt = {
        schema_version: 1,
        command: 'facts embed',
        mode: 'blocked',
        source_id: sourceId,
        limit: flags.limit,
        reason: 'cycle_or_embedding_repair_already_running',
      };
    } else {
      throw error;
    }
  }
  if (flags.json) process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
  else console.log(JSON.stringify(receipt, null, 2));
}

function printHumanReport(report: FactsAuditReport): void {
  console.log(`Facts audit: ${report.source_id}`);
  console.log(`Pending: ${report.pending_total}`);
  console.log(`Oldest: ${report.oldest_pending_at ?? 'none'}`);
  console.log(`Age: <24h=${report.age_buckets.lt_24h}, 1-7d=${report.age_buckets.one_to_seven_days}, 7-30d=${report.age_buckets.seven_to_thirty_days}, >30d=${report.age_buckets.gt_30_days}`);
  console.log(`Rows: no-entity=${report.row_categories.no_entity_slug}, missing-embedding=${report.row_categories.missing_embedding}, missing-page=${report.row_categories.missing_entity_page}`);
  console.log(`Buckets: total=${report.bucket_summary.total_buckets}, below-min=${report.bucket_summary.buckets_below_minimum}, candidate=${report.bucket_summary.buckets_candidate_by_size_and_age}`);
  console.log(`Candidate rows before cosine clustering: ${report.bucket_summary.rows_candidate_by_size_and_age}`);
  console.log(`Next: ${report.next_step}`);
}

function printHelp(): void {
  console.log(`gbrain facts audit — read-only pending Facts classification

Usage:
  gbrain facts audit [--source-id <id>] [--json]
  gbrain facts audit --source-id <id> --missing-entity-report [--json]
  gbrain facts consolidate --source-id <id> --max-buckets <n> [--json]
  gbrain facts consolidate --source-id <id> --max-buckets <n> --apply --yes [--json]
  gbrain facts embed --source-id <id> --limit <n> [--json]
  gbrain facts embed --source-id <id> --limit <n> --apply --yes [--json]

The audit never writes facts, takes, pages, or embeddings. The missing-entity
report is read-only and never creates pages. Consolidate defaults
to dry-run; writes require --apply --yes and an explicit bucket cap. Categories
overlap; rows candidate by size/age still require entity-page and cosine checks.
`);
}
