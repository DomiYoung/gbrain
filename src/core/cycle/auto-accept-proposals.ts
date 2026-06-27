/**
 * v0.42.41.0-domi-auto-accept (2026-06-21) — auto-accept high-quality proposals.
 *
 * Bridges the gap between propose_takes (writes to take_proposals queue) and
 * grade_takes (reads from takes table). D17 design intentionally required
 * manual review via `gbrain takes propose --accept N`, but that CLI command
 * was never implemented, causing 600+ proposals to pile up with no path to
 * the canonical takes table.
 *
 * This phase provides configurable auto-accept:
 *   - Filters pending proposals by kind + weight threshold
 *   - Marks them accepted in take_proposals
 *   - Inserts into takes table with correct page_id + row_num
 *   - Preserves audit trail (proposals stay as history)
 *
 * Configuration:
 *   cycle:
 *     propose_takes:
 *       auto_accept:
 *         enabled: false          # default OFF (D17 compatibility)
 *         min_weight: 0.7         # only high-confidence proposals
 *         kind_filter: [bet]      # only gradeable predictions
 *
 * When to enable:
 *   - You trust the propose_takes extraction quality (F1 > 0.90)
 *   - You want Judge/Calibrate flywheel to scale without manual review
 *   - You have monitoring for bad accepts (via takes_scorecard)
 *
 * When NOT to enable:
 *   - First 100 proposals (cold-start tuning phase)
 *   - Brier score > 0.3 (extractor not calibrated)
 *   - You want full human review (original D17 intent)
 */

import type { BrainEngine } from '../engine.ts';
import type { OperationContext } from '../operations.ts';

export interface AutoAcceptConfig {
  enabled: boolean;
  min_weight: number;
  kind_filter: string[];
}

export interface AutoAcceptResult {
  accepted_count: number;
  pending_before: number;
  pending_after: number;
  summary: string;
}

/**
 * Auto-accept high-quality pending proposals and insert them into takes table.
 * 
 * This is a pure DB operation (no LLM calls) that runs after propose_takes
 * in the cycle. It's intentionally separate from propose_takes.ts so the
 * extraction phase stays hermetic for tests.
 */
export async function autoAcceptProposals(
  ctx: OperationContext,
  config: AutoAcceptConfig,
): Promise<AutoAcceptResult> {
  const { engine } = ctx;

  if (!config.enabled) {
    return {
      accepted_count: 0,
      pending_before: 0,
      pending_after: 0,
      summary: 'auto_accept disabled',
    };
  }

  // Count pending before
  const pendingBefore = await engine.executeRaw<{ count: number }>(
    `SELECT COUNT(*) as count FROM take_proposals WHERE status = 'pending'`,
    [],
  );

  const kindFilterClause = config.kind_filter.length > 0
    ? `AND tp.kind = ANY($2::text[])`
    : '';

  // Accept and insert in one atomic CTE transaction
  const result = await engine.executeRaw<{ accepted_count: number }>(
    `
    WITH high_quality_pending AS (
      SELECT tp.id, tp.source_id, tp.page_slug, tp.claim_text, tp.kind, 
             tp.holder, tp.weight, tp.domain, tp.proposed_at,
             p.id as page_id
      FROM take_proposals tp
      JOIN pages p ON p.source_id = tp.source_id AND p.slug = tp.page_slug
      WHERE tp.status = 'pending'
        AND tp.weight >= $1
        ${kindFilterClause}
        AND p.deleted_at IS NULL
    ),
    with_base_row AS (
      SELECT hq.*, COALESCE(MAX(t.row_num), 0) as max_existing_row
      FROM high_quality_pending hq
      LEFT JOIN takes t ON t.page_id = hq.page_id
      GROUP BY hq.id, hq.source_id, hq.page_slug, hq.claim_text, hq.kind, 
               hq.holder, hq.weight, hq.domain, hq.proposed_at, hq.page_id
    ),
    with_row_nums AS (
      SELECT *,
             max_existing_row + ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY id) as target_row_num
      FROM with_base_row
    ),
    mark_accepted AS (
      UPDATE take_proposals tp
      SET status = 'accepted', acted_at = NOW()
      FROM with_row_nums wrn
      WHERE tp.id = wrn.id
      RETURNING wrn.*
    ),
    inserted_takes AS (
      INSERT INTO takes (page_id, row_num, claim, kind, holder, weight, since_date, created_at)
      SELECT 
        page_id,
        target_row_num,
        claim_text,
        kind,
        holder,
        weight,
        TO_CHAR(proposed_at, 'YYYY-MM-DD'),
        NOW()
      FROM mark_accepted
      RETURNING id
    )
    SELECT COUNT(*) as accepted_count FROM inserted_takes
    `,
    config.kind_filter.length > 0
      ? [config.min_weight, config.kind_filter]
      : [config.min_weight],
  );

  // Count pending after
  const pendingAfter = await engine.executeRaw<{ count: number }>(
    `SELECT COUNT(*) as count FROM take_proposals WHERE status = 'pending'`,
    [],
  );

  const acceptedCount = result[0]?.accepted_count ?? 0;

  return {
    accepted_count: acceptedCount,
    pending_before: pendingBefore[0]?.count ?? 0,
    pending_after: pendingAfter[0]?.count ?? 0,
    summary: acceptedCount > 0
      ? `auto-accepted ${acceptedCount} proposals (weight >= ${config.min_weight}, kind = ${config.kind_filter.join('|')})`
      : 'no proposals met acceptance criteria',
  };
}
