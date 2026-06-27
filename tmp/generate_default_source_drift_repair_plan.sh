#!/usr/bin/env bash
set -euo pipefail

source /Users/light/.hermes/scripts/gbrain_env.sh 2>/dev/null || true
: "${GBRAIN_DATABASE_URL:?GBRAIN_DATABASE_URL is required}"

OUT_DIR="/Users/light/gbrain/tmp/default-source-drift-repair"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CSV="$OUT_DIR/default_source_drift_dry_run_${STAMP}.csv"
REPORT="$OUT_DIR/default_source_drift_repair_plan_${STAMP}.md"
SQL="$OUT_DIR/default_source_drift_repair_${STAMP}.sql"
ROLLBACK="$OUT_DIR/default_source_drift_rollback_${STAMP}.sql"
LATEST="$OUT_DIR/latest"

PSQL=(psql "$GBRAIN_DATABASE_URL" -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" -Atc "
CREATE TEMP TABLE tmp_drift_candidates AS
WITH source_files AS (
  SELECT
    s.id AS intended_source,
    s.local_path,
    lower(regexp_replace(rel.rel_path, '\\.(md|mdx)$', '', 'i')) AS slug
  FROM sources s
  CROSS JOIN LATERAL (
    SELECT replace(pg_ls_dir(s.local_path, true, false), '\\', '/') AS rel_path
  ) rel
  WHERE s.id <> 'default'
    AND s.local_path IS NOT NULL
    AND rel.rel_path ~* '\\.(md|mdx)$'
    AND split_part(rel.rel_path, '/', array_length(string_to_array(rel.rel_path, '/'), 1)) NOT LIKE '\\_%'
), drift AS (
  SELECT DISTINCT
    sf.slug,
    'default'::text AS current_source,
    sf.intended_source,
    sf.local_path,
    p_default.id AS default_page_id,
    p_target.id AS target_page_id,
    p_default.deleted_at AS default_deleted_at,
    p_target.deleted_at AS target_deleted_at,
    CASE
      WHEN p_target.id IS NULL THEN 'safe_to_move'
      WHEN p_target.deleted_at IS NOT NULL THEN 'target_soft_deleted_collision'
      ELSE 'active_target_collision'
    END AS collision_status
  FROM source_files sf
  JOIN pages p_default
    ON p_default.source_id = 'default'
   AND p_default.slug = sf.slug
   AND p_default.deleted_at IS NULL
  LEFT JOIN pages p_target
    ON p_target.source_id = sf.intended_source
   AND p_target.slug = sf.slug
  WHERE p_target.id IS NULL OR p_target.deleted_at IS NOT NULL
)
SELECT count(*) FROM drift;

\\copy (SELECT slug,current_source,intended_source,collision_status,default_page_id,target_page_id,local_path FROM tmp_drift_candidates ORDER BY intended_source, slug) TO :'CSV' CSV HEADER
" >/tmp/default_source_drift_count.txt

COUNT="$(cat /tmp/default_source_drift_count.txt | tail -1)"
SAFE_COUNT="$(${PSQL[@]} -Atc "WITH source_files AS (SELECT s.id AS intended_source, s.local_path, lower(regexp_replace(replace(pg_ls_dir(s.local_path, true, false), '\\', '/'), '\\.(md|mdx)$', '', 'i')) AS slug FROM sources s WHERE s.id <> 'default' AND s.local_path IS NOT NULL), drift AS (SELECT DISTINCT sf.slug, sf.intended_source, p_target.id AS target_page_id, p_target.deleted_at AS target_deleted_at FROM source_files sf JOIN pages p_default ON p_default.source_id='default' AND p_default.slug=sf.slug AND p_default.deleted_at IS NULL LEFT JOIN pages p_target ON p_target.source_id=sf.intended_source AND p_target.slug=sf.slug WHERE p_target.id IS NULL OR p_target.deleted_at IS NOT NULL) SELECT count(*) FROM drift WHERE target_page_id IS NULL;")"
SOFT_COLLISION_COUNT="$(${PSQL[@]} -Atc "WITH source_files AS (SELECT s.id AS intended_source, s.local_path, lower(regexp_replace(replace(pg_ls_dir(s.local_path, true, false), '\\', '/'), '\\.(md|mdx)$', '', 'i')) AS slug FROM sources s WHERE s.id <> 'default' AND s.local_path IS NOT NULL), drift AS (SELECT DISTINCT sf.slug, sf.intended_source, p_target.id AS target_page_id, p_target.deleted_at AS target_deleted_at FROM source_files sf JOIN pages p_default ON p_default.source_id='default' AND p_default.slug=sf.slug AND p_default.deleted_at IS NULL LEFT JOIN pages p_target ON p_target.source_id=sf.intended_source AND p_target.slug=sf.slug WHERE p_target.id IS NULL OR p_target.deleted_at IS NOT NULL) SELECT count(*) FROM drift WHERE target_page_id IS NOT NULL;")"
ACTIVE_COLLISIONS="$(${PSQL[@]} -Atc "WITH source_files AS (SELECT s.id AS intended_source, s.local_path, lower(regexp_replace(replace(pg_ls_dir(s.local_path, true, false), '\\', '/'), '\\.(md|mdx)$', '', 'i')) AS slug FROM sources s WHERE s.id <> 'default' AND s.local_path IS NOT NULL), active_collisions AS (SELECT DISTINCT sf.slug, sf.intended_source FROM source_files sf JOIN pages p_default ON p_default.source_id='default' AND p_default.slug=sf.slug AND p_default.deleted_at IS NULL JOIN pages p_target ON p_target.source_id=sf.intended_source AND p_target.slug=sf.slug AND p_target.deleted_at IS NULL) SELECT count(*) FROM active_collisions;")"

cat > "$SQL" <<SQL
-- Default-source drift repair SQL generated ${STAMP}
-- REVIEW REQUIRED. Do not execute until reviewer approves.
-- Backup first:
--   pg_dump --format=custom --file=/Users/light/gbrain/tmp/default-source-drift-repair/gbrain_custom_clean_before_default_drift_${STAMP}.dump "\$GBRAIN_DATABASE_URL"

BEGIN;

CREATE TEMP TABLE repair_candidates(slug text PRIMARY KEY, current_source text, intended_source text, collision_status text, default_page_id bigint, target_page_id bigint, local_path text);
\\copy repair_candidates(slug,current_source,intended_source,collision_status,default_page_id,target_page_id,local_path) FROM '$CSV' CSV HEADER

-- Invariants before mutation.
SELECT 'before_default_live_candidates' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON c.default_page_id = p.id WHERE p.source_id = 'default' AND p.deleted_at IS NULL;
SELECT 'before_target_active_collisions' AS check_name, count(*) FROM pages t JOIN repair_candidates c ON t.source_id = c.intended_source AND t.slug = c.slug AND t.deleted_at IS NULL;
SELECT 'before_soft_deleted_target_collisions' AS check_name, count(*) FROM pages t JOIN repair_candidates c ON t.id = c.target_page_id AND t.deleted_at IS NOT NULL;

-- Move only rows with no target row at all. Soft-deleted target collisions are excluded until reviewed.
UPDATE pages p
SET source_id = c.intended_source,
    updated_at = now()
FROM repair_candidates c
WHERE p.id = c.default_page_id
  AND c.collision_status = 'safe_to_move'
  AND NOT EXISTS (
    SELECT 1 FROM pages target
    WHERE target.source_id = c.intended_source
      AND target.slug = c.slug
  );

-- Invariants after mutation.
SELECT 'after_default_live_candidates' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON c.default_page_id = p.id WHERE p.source_id = 'default' AND p.deleted_at IS NULL AND c.collision_status = 'safe_to_move';
SELECT 'after_target_live_moved' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON c.default_page_id = p.id WHERE p.source_id = c.intended_source AND p.deleted_at IS NULL AND c.collision_status = 'safe_to_move';
SELECT 'after_active_collisions' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON p.source_id = c.intended_source AND p.slug = c.slug AND p.id <> c.default_page_id AND p.deleted_at IS NULL;

-- COMMIT only after invariant review.
ROLLBACK;
-- Replace ROLLBACK with COMMIT after reviewer approval and successful dry-run transaction review.
SQL

cat > "$ROLLBACK" <<SQL
-- Rollback SQL for default-source drift repair generated ${STAMP}
-- Use only if the approved repair transaction was committed and needs reversal.
BEGIN;
CREATE TEMP TABLE repair_candidates(slug text PRIMARY KEY, current_source text, intended_source text, collision_status text, default_page_id bigint, target_page_id bigint, local_path text);
\\copy repair_candidates(slug,current_source,intended_source,collision_status,default_page_id,target_page_id,local_path) FROM '$CSV' CSV HEADER

UPDATE pages p
SET source_id = 'default',
    updated_at = now()
FROM repair_candidates c
WHERE p.id = c.default_page_id
  AND c.collision_status = 'safe_to_move'
  AND p.source_id = c.intended_source
  AND p.slug = c.slug;

SELECT 'rollback_default_restored' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON c.default_page_id = p.id WHERE p.source_id = 'default' AND c.collision_status = 'safe_to_move';
ROLLBACK;
-- Replace ROLLBACK with COMMIT only after verifying rollback preview output.
SQL

{
  echo "# Default-source drift reversible repair plan"
  echo
  echo "Generated: ${STAMP}"
  echo
  echo "## Summary"
  echo
  echo "| Metric | Count |"
  echo "|---|---:|"
  echo "| Dry-run drift candidates | ${COUNT} |"
  echo "| Safe to move: no target row | ${SAFE_COUNT} |"
  echo "| Not safe without review: soft-deleted target collision | ${SOFT_COLLISION_COUNT} |"
  echo "| Not safe: active target collision | ${ACTIVE_COLLISIONS} |"
  echo
  echo "## Artifacts"
  echo
  echo "| Artifact | Path |"
  echo "|---|---|"
  echo "| Candidate CSV | \`${CSV}\` |"
  echo "| Review SQL | \`${SQL}\` |"
  echo "| Rollback SQL | \`${ROLLBACK}\` |"
  echo
  echo "## Backup command"
  echo
  echo '```bash'
  echo "pg_dump --format=custom --file=/Users/light/gbrain/tmp/default-source-drift-repair/gbrain_custom_clean_before_default_drift_${STAMP}.dump \"\$GBRAIN_DATABASE_URL\""
  echo '```'
  echo
  echo "## Execution guard"
  echo
  echo "The generated repair SQL ends with \`ROLLBACK\` by default. Reviewer must inspect CSV and invariant query output, then replace exactly one final \`ROLLBACK\` with \`COMMIT\` before any mutation is persisted."
  echo
  echo "## Collision policy"
  echo
  echo "| Collision status | Action |"
  echo "|---|---|"
  echo "| \`safe_to_move\` | Included in update block. |"
  echo "| \`target_soft_deleted_collision\` | Excluded from update; reviewer must decide restore/delete/merge policy. |"
  echo "| \`active_target_collision\` | Excluded from candidate CSV; count reported separately as unsafe. |"
  echo
  echo "## Sample candidates"
  echo
  echo '```text'
  head -n 11 "$CSV"
  echo '```'
} > "$REPORT"

rm -f "$LATEST"
ln -s "$REPORT" "$LATEST"

printf 'REPORT=%s\nCSV=%s\nSQL=%s\nROLLBACK=%s\nCOUNT=%s\nSAFE=%s\nSOFT_COLLISION=%s\nACTIVE_COLLISION=%s\n' "$REPORT" "$CSV" "$SQL" "$ROLLBACK" "$COUNT" "$SAFE_COUNT" "$SOFT_COLLISION_COUNT" "$ACTIVE_COLLISIONS"
