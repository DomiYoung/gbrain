# Default-source drift reversible repair plan

Generated: 20260617T011938Z

## Summary

| Metric | Count |
|---|---:|
| Dry-run drift candidates | 702 |
| Safe to move: no target row | 5 |
| Not safe without review: soft-deleted target collision | 189 |
| Not safe: active target collision | 508 |

## Artifacts

| Artifact | Path |
|---|---|
| Candidate CSV | `/Users/light/gbrain/tmp/default-source-drift-repair/default_source_drift_dry_run_20260617T011938Z.csv` |
| Review SQL | `/Users/light/gbrain/tmp/default-source-drift-repair/default_source_drift_repair_20260617T011938Z.sql` |
| Rollback SQL | `/Users/light/gbrain/tmp/default-source-drift-repair/default_source_drift_rollback_20260617T011938Z.sql` |

## Backup command

```bash
pg_dump --format=custom --file=/Users/light/gbrain/tmp/default-source-drift-repair/gbrain_custom_clean_before_default_drift_20260617T011938Z.dump "$GBRAIN_DATABASE_URL"
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
entities/people/dontbesilent|default|domi-feishu-brain|active_target_collision|256100|248867|/Users/light/.hermes/gbrain-sources/domi-feishu-brain|
personal/family/lucky-health-record|default|domi-feishu-brain|active_target_collision|254952|248861|/Users/light/.hermes/gbrain-sources/domi-feishu-brain|
readme|default|domi-feishu-brain|active_target_collision|256097|235820|/Users/light/.hermes/gbrain-sources/domi-feishu-brain|
companies/anker-innovation|default|feishu-calendar-essence|active_target_collision|250239|252068|/Users/light/.hermes/gbrain-sources/feishu-calendar-essence|
meetings/2026-06-09-anker-ai-soil|default|feishu-calendar-essence|active_target_collision|250238|252065|/Users/light/.hermes/gbrain-sources/feishu-calendar-essence|
people/steven-yang|default|feishu-calendar-essence|active_target_collision|250241|252064|/Users/light/.hermes/gbrain-sources/feishu-calendar-essence|
people/william-sang|default|feishu-calendar-essence|active_target_collision|250240|252067|/Users/light/.hermes/gbrain-sources/feishu-calendar-essence|
personal/health/domi-health-record|default|feishu-calendar-essence|active_target_collision|250246|252066|/Users/light/.hermes/gbrain-sources/feishu-calendar-essence|
00_inbox/capture/2026-05-24_ai-shopping-engine-thoughts_grok|default|obsidian|active_target_collision|250548|251740|/Users/light/.hermes/gbrain-sources/domi-obsidian-brain-lite|
00_maps/root|default|obsidian|active_target_collision|250539|252036|/Users/light/.hermes/gbrain-sources/domi-obsidian-brain-lite|
```
