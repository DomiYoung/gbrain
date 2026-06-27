-- Default-source drift repair SQL generated 20260617T011938Z
-- REVIEW REQUIRED. Do not execute until reviewer approves.
-- Backup first:
--   pg_dump --format=custom --file=/Users/light/gbrain/tmp/default-source-drift-repair/gbrain_custom_clean_before_default_drift_20260617T011938Z.dump "$GBRAIN_DATABASE_URL"

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

-- Invariants before mutation.
SELECT 'before_default_live_candidates' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON c.default_page_id = p.id WHERE p.source_id = 'default' AND p.deleted_at IS NULL;
SELECT 'before_safe_candidates' AS check_name, count(*) FROM repair_candidates WHERE collision_status = 'safe_to_move';
SELECT 'before_soft_deleted_target_collisions' AS check_name, count(*) FROM repair_candidates WHERE collision_status = 'target_soft_deleted_collision';
SELECT 'before_active_target_collisions' AS check_name, count(*) FROM repair_candidates WHERE collision_status = 'active_target_collision';

-- Move only rows with no live target row.
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
      AND target.deleted_at IS NULL
  );

-- Invariants after mutation.
SELECT 'after_default_live_safe_candidates' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON c.default_page_id = p.id WHERE p.source_id = 'default' AND p.deleted_at IS NULL AND c.collision_status = 'safe_to_move';
SELECT 'after_moved_to_intended_source' AS check_name, count(*) FROM pages p JOIN repair_candidates c ON p.id = c.default_page_id WHERE p.source_id = c.intended_source AND p.deleted_at IS NULL AND c.collision_status = 'safe_to_move';
SELECT 'after_active_target_collisions' AS check_name, count(*) FROM repair_candidates WHERE collision_status = 'active_target_collision';

ROLLBACK;
-- Replace ROLLBACK with COMMIT after reviewer approval and successful dry-run review.
