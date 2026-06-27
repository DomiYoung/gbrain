#!/usr/bin/env python3
from __future__ import annotations

import csv
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
from collections import defaultdict
from typing import Any

WORKDIR = "/Users/light/gbrain"
OUT_DIR = pathlib.Path("/Users/light/gbrain/tmp/default-source-drift-repair")
OUT_DIR.mkdir(parents=True, exist_ok=True)

STAMP = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
CSV_PATH = OUT_DIR / f"default_source_drift_dry_run_{STAMP}.csv"
REPORT_PATH = OUT_DIR / f"default_source_drift_repair_plan_{STAMP}.md"
SQL_PATH = OUT_DIR / f"default_source_drift_repair_{STAMP}.sql"
ROLLBACK_PATH = OUT_DIR / f"default_source_drift_rollback_{STAMP}.sql"
BACKUP_PATH = OUT_DIR / f"gbrain_custom_clean_before_default_drift_{STAMP}.dump"
LATEST_PATH = OUT_DIR / "latest"


def get_db_url() -> str:
    cmd = 'source /Users/light/.hermes/scripts/gbrain_env.sh 2>/dev/null || true; printf %s "${GBRAIN_DATABASE_URL:-${DATABASE_URL:-}}"'
    out = subprocess.check_output(["bash", "-lc", cmd], text=True, cwd=WORKDIR)
    db_url = out.strip()
    if not db_url:
        raise SystemExit("missing GBRAIN_DATABASE_URL / DATABASE_URL")
    return db_url


def psql(db_url: str, sql: str) -> str:
    proc = subprocess.run(
        ["psql", db_url, "-X", "-v", "ON_ERROR_STOP=1", "-Atc", sql],
        text=True,
        cwd=WORKDIR,
        capture_output=True,
        check=True,
    )
    return proc.stdout


def shell_quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def slug_from_rel(rel: str) -> str:
    rel = rel.replace("\\", "/")
    rel = re.sub(r"\.(md|mdx)$", "", rel, flags=re.I)
    return rel.lower()


def list_source_files(root: str) -> list[str]:
    root_path = pathlib.Path(root)
    if not root_path.exists():
        return []
    slugs: set[str] = set()
    for path in root_path.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root_path).as_posix()
        if rel.startswith(".") or "/." in rel or rel.startswith("_"):
            continue
        if not rel.lower().endswith((".md", ".mdx")):
            continue
        slugs.add(slug_from_rel(rel))
    return sorted(slugs)


def batch_probe(db_url: str, source_id: str, slugs: list[str]) -> list[dict[str, str | None]]:
    rows: list[dict[str, str | None]] = []
    if not slugs:
        return rows
    for i in range(0, len(slugs), 120):
        chunk = slugs[i : i + 120]
        values_sql = ", ".join(f"({shell_quote(s)})" for s in chunk)
        sql = f"""
WITH candidates(slug) AS (VALUES {values_sql})
SELECT c.slug,
       p.source_id,
       p.id::text,
       CASE WHEN p.deleted_at IS NULL THEN 't' ELSE 'f' END,
       COALESCE(p.deleted_at::text, '')
FROM candidates c
LEFT JOIN pages p
  ON p.slug = c.slug
 AND p.source_id IN ('default', {shell_quote(source_id)})
ORDER BY c.slug, p.source_id NULLS FIRST;
"""
        out = psql(db_url, sql)
        for line in out.splitlines():
            if not line:
                continue
            parts = line.split("|", 4)
            if len(parts) != 5:
                continue
            slug, src, pid, is_live, deleted_at = parts
            rows.append(
                {
                    "slug": slug,
                    "source_id": src or None,
                    "page_id": pid or None,
                    "is_live": is_live == "t",
                    "deleted_at": deleted_at or None,
                }
            )
    return rows


def main() -> None:
    db_url = get_db_url()

    source_rows = psql(db_url, "SELECT id, local_path FROM sources WHERE id <> 'default' AND local_path IS NOT NULL ORDER BY id")
    sources: list[tuple[str, str]] = []
    for line in source_rows.splitlines():
        if not line:
            continue
        sid, local_path = line.split("|", 1)
        sources.append((sid, local_path))

    records: list[dict[str, str]] = []
    for source_id, root in sources:
        slugs = list_source_files(root)
        if not slugs:
            continue
        probe_rows = batch_probe(db_url, source_id, slugs)
        by_slug: dict[str, list[dict[str, str | None]]] = defaultdict(list)
        for row in probe_rows:
            by_slug[row["slug"]].append(row)
        for slug, items in by_slug.items():
            default = next((item for item in items if item["source_id"] == "default"), None)
            target = next((item for item in items if item["source_id"] == source_id), None)
            if not default or not default["page_id"]:
                continue
            if target and target["page_id"] and target["is_live"]:
                collision = "active_target_collision"
            elif target and target["page_id"] and not target["is_live"]:
                collision = "target_soft_deleted_collision"
            else:
                collision = "safe_to_move"
            records.append(
                {
                    "slug": slug,
                    "current_source": "default",
                    "intended_source": source_id,
                    "collision_status": collision,
                    "default_page_id": str(default["page_id"]),
                    "target_page_id": str(target["page_id"]) if target and target["page_id"] else "",
                    "local_path": root,
                    "target_deleted_at": str(target["deleted_at"]) if target and target["deleted_at"] else "",
                }
            )

    records.sort(key=lambda row: (row["intended_source"], row["slug"]))
    with CSV_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "slug",
                "current_source",
                "intended_source",
                "collision_status",
                "default_page_id",
                "target_page_id",
                "local_path",
                "target_deleted_at",
            ],
        )
        writer.writeheader()
        writer.writerows(records)

    safe = sum(1 for row in records if row["collision_status"] == "safe_to_move")
    soft = sum(1 for row in records if row["collision_status"] == "target_soft_deleted_collision")
    active = sum(1 for row in records if row["collision_status"] == "active_target_collision")

    sample_lines = [
        "|".join(
            [
                row["slug"],
                row["current_source"],
                row["intended_source"],
                row["collision_status"],
                row["default_page_id"],
                row["target_page_id"],
                row["local_path"],
                row["target_deleted_at"],
            ]
        )
        for row in records[:10]
    ]

    sql_text = f"""-- Default-source drift repair SQL generated {STAMP}
-- REVIEW REQUIRED. Do not execute until reviewer approves.
-- Backup first:
--   pg_dump --format=custom --file={BACKUP_PATH} \"$GBRAIN_DATABASE_URL\"

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
\\copy repair_candidates FROM {shell_quote(str(CSV_PATH))} CSV HEADER

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
"""

    rollback_text = f"""-- Rollback SQL for default-source drift repair generated {STAMP}
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
\\copy repair_candidates FROM {shell_quote(str(CSV_PATH))} CSV HEADER
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
"""

    report_text = f"""# Default-source drift reversible repair plan

Generated: {STAMP}

## Summary

| Metric | Count |
|---|---:|
| Dry-run drift candidates | {len(records)} |
| Safe to move: no target row | {safe} |
| Not safe without review: soft-deleted target collision | {soft} |
| Not safe: active target collision | {active} |

## Artifacts

| Artifact | Path |
|---|---|
| Candidate CSV | `{CSV_PATH}` |
| Review SQL | `{SQL_PATH}` |
| Rollback SQL | `{ROLLBACK_PATH}` |

## Backup command

```bash
pg_dump --format=custom --file={BACKUP_PATH} "$GBRAIN_DATABASE_URL"
```

## Execution guard

The generated repair SQL ends with `ROLLBACK` by default. Reviewer must inspect the CSV and invariant query output, then replace the final `ROLLBACK` with `COMMIT` before any mutation is persisted.

## Collision policy

| Collision status | Action |
|---|---|
| `safe_to_move` | Included in update block. |
| `target_soft_deleted_collision` | Excluded from update; reviewer must decide restore/delete/merge policy. |
| `active_target_collision` | Excluded from mutation; unsafe until target conflict is resolved. |

## Sample candidates

```text
slug|current_source|intended_source|collision_status|default_page_id|target_page_id|local_path|target_deleted_at
{os.linesep.join(sample_lines)}
```
"""

    SQL_PATH.write_text(sql_text)
    ROLLBACK_PATH.write_text(rollback_text)
    REPORT_PATH.write_text(report_text)
    if LATEST_PATH.exists() or LATEST_PATH.is_symlink():
        LATEST_PATH.unlink()
    LATEST_PATH.symlink_to(REPORT_PATH)

    print(json.dumps({
        "report": str(REPORT_PATH),
        "csv": str(CSV_PATH),
        "sql": str(SQL_PATH),
        "rollback": str(ROLLBACK_PATH),
        "total": len(records),
        "safe": safe,
        "soft": soft,
        "active": active,
    }, indent=2))


if __name__ == "__main__":
    main()
