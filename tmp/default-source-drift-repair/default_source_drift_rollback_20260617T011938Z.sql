-- Rollback SQL for default-source drift repair generated 20260617T011938Z
BEGIN;
CREATE TEMP TABLE repair_candidates(
  slug text,
  current_source text,
  intended_source text,
  collision_status text,
  default_page_id bigint,
  target_page_id bigint,
  local_path text,
  target_deleted_at text
);
\copy repair_candidates FROM '/Users/light/gbrain/tmp/default-source-drift-repair/default_source_drift_dry_run_20260617T011938Z.csv' CSV HEADER
UPDATE pages p
SET source_id = 'default',
    updated_at = now()
FROM repair_candidates c
WHERE p.id = c.default_page_id
  AND c.collision_status = 'safe_to_move'
  AND p.source_id = c.intended_source
  AND p.slug = c.slug;
SELECT 'rollback_default_restored' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON p.id = c.default_page_id WHERE p.source_id = 'default' AND c.collision_status = 'safe_to_move';
ROLLBACK;
