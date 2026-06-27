# GBrain Source Ownership Contract

## Purpose

This contract makes each GBrain source explicit: who owns it, what it stores, where writes are allowed, how it syncs, and how it retires. It is a governance layer on top of the existing `sources` table; it does not authorize destructive SQL by itself.

## Current Inventory Snapshot

Snapshot date: 2026-06-17.

| Source | Owner | Local path | Federated | Pages | Clone state | Data type | Write authority | Sync strategy | Retirement strategy |
|---|---|---|---:|---:|---|---|---|---|---|
| `default` | GBrain governance / migration owner | none | false | 766 | not-applicable | legacy mixed compiled pages, drift residue, governance pages | quarantine-only; new writes forbidden except emergency governance logs | no filesystem sync; audit and migrate out by policy | retire after page_count=0 or only approved governance pages remain; never use as ingestion fallback |
| `apple-notes-essence` | Apple Notes connector owner | `/Users/light/.hermes/gbrain-sources/apple-notes-essence` | true | 202 | corrupted | Apple Notes curated essence | connector-only writes; manual hotfixes require source id | repair local repo state, then source-scoped sync | archive only after raw exporter and transformed markdown are superseded |
| `domi-feishu-brain` | Feishu knowledge-base connector owner | `/Users/light/.hermes/gbrain-sources/domi-feishu-brain` | true | 17 | corrupted | Feishu canonical/wiki pages | connector-only writes; no generic capture writes | repair local repo state; sync with explicit `--source domi-feishu-brain` | merge into `feishu-essence-v2` or archive after duplicate slugs are resolved |
| `feishu-calendar-essence` | Feishu calendar connector owner | `/Users/light/.hermes/gbrain-sources/feishu-calendar-essence` | false | 5 | corrupted | calendar/meeting-derived entities and notes | calendar connector-only writes | repair local repo state; isolated source sync | archive after meeting facts are promoted into canonical sources |
| `feishu-essence-v2` | Feishu wiki/minutes connector owner | `/Users/light/.hermes/gbrain-sources/feishu-essence` | true | 1059 | corrupted | Feishu wiki, minutes, management docs | Feishu connector writes; manual writes only with explicit source id | fix `.gbrain-source` mismatch, repair repo, sync source-scoped | primary Feishu source; retire older Feishu sources into this only after collision review |
| `feishu-im-essence` | Feishu IM connector owner | `/Users/light/.hermes/gbrain-sources/feishu-im-essence` | true | 16 | corrupted | private/group chat essence | IM connector-only writes; high sensitivity | repair repo and sync with explicit source id | archive when retained facts are promoted and raw/private residue is expired |
| `feishu-project-management-base` | Feishu Base connector owner | `/Users/light/.hermes/gbrain-sources/feishu-project-management-base` | false | 140 | corrupted | project-management base rows | Base connector-only writes | repair repo and isolated sync | archive after WBS/TITA canonical crosswalk exists |
| `feishu-vc-essence` | Feishu VC connector owner | none | true | 0 | not-applicable | reserved VC source | no writes until local_path exists | no sync until path attached | remove or attach path before any ingestion |
| `obsidian` | Obsidian vault owner | `/Users/light/.hermes/gbrain-sources/domi-obsidian-brain-lite` | false | 1505 | healthy | personal vault canonical notes, maps, entities | Obsidian/vault writes only; use source-scoped writes | healthy source-scoped sync; drift fixes may target this | never retire without full vault replacement and backup |
| `provenance` | provenance/archive owner | `/Users/light/.hermes/archive/gbrain-sources-legacy/domi-provenance` | false | 286 | corrupted | raw provenance and legacy evidence | append-only provenance writes; no compiled truth writes | archive source; sync only for audit recovery | retire to cold archive after all referenced evidence has stable citations |
| `signals` | Hermes signals connector owner | `/Users/light/.hermes/gbrain-sources/hermes-signals` | false | 656 | corrupted | signal/radar/event pages | signals connector-only writes | repair repo; isolated sync to avoid search pollution | archive or TTL after signals are summarized into canonical pages |
| `tita` | TITA connector owner | `/Users/light/.hermes/gbrain-sources/tita-essence` | true | 1081 | corrupted | OKR, performance, task essence | TITA connector-only writes | fix `.gbrain-source` mismatch, repair repo, sync source-scoped | retire only after OKR history is exported and canonical rollups exist |
| `wbs-dashboard-essence` | WBS dashboard connector owner | `/Users/light/.hermes/gbrain-sources/wbs-dashboard-essence` | false | 5 | corrupted | WBS workflow/task essence | WBS connector-only writes | repair repo and isolated sync | archive after project-management base supersedes it |

## Invariants

| Invariant | Enforcement |
|---|---|
| Every non-retired source must have exactly one accountable owner. | Keep this contract updated with source creation/removal. |
| Every writable source must have a valid `local_path` and a matching `.gbrain-source`. | Block connector writes if `local_path` is null or dotfile value differs from `sources.id`. |
| No generic ingestion may write to `default`. | Require explicit `--source`, `GBRAIN_SOURCE`, `.gbrain-source`, or local_path resolver match. |
| Federated sources must be curated enough for default recall. | Raw/high-noise sources stay `federated=false` until summarized. |
| Destructive drift repair is never implicit. | Generate dry-run CSV + rollback SQL first; reviewer replaces `ROLLBACK` with `COMMIT` only after inspection. |

## Default Source Retirement Strategy

`default` is now a quarantine source, not an active source.

| Phase | Gate | Allowed action | Rollback |
|---|---|---|---|
| 0. Freeze | Contract merged | Stop new writes to `default`; fail or warn on unresolved writes that would fall back to `default`. | Re-enable fallback only by explicit config flag during incident response. |
| 1. Classify | Drift candidates exported | Assign each default page to intended source by slug/path/type. | Keep CSV snapshot and no mutations. |
| 2. Safe moves | No active or soft-deleted target collision | Move only `safe_to_move` rows with source-scoped dependency updates in one transaction. | Transaction rollback SQL generated from original page ids/source ids. |
| 3. Collision review | Active and soft-deleted target collisions grouped | For each slug collision: choose keep-target, merge-default-into-target, restore soft-deleted target, or preserve as forked slug. | Per-slug rollback plan before mutation. |
| 4. Residue decision | Remaining default pages are governance-only or unmapped | Either create a dedicated `governance` source or keep a tiny non-federated default quarantine. | Do not delete pages until backup restore is tested. |
| 5. Retire | `default` page_count is 0 or approved governance residue only | Set default fallback off operationally; alerts on page_count increase. | Re-point fallback temporarily and restore from dump if resolver regression appears. |

Current drift evidence: `/Users/light/gbrain/tmp/default-source-drift-repair/default_source_drift_repair_plan_20260617T011938Z.md` reports 702 dry-run candidates: 5 safe moves, 189 soft-deleted target collisions, and 508 active target collisions. Therefore only the 5 safe moves are eligible for first mutation after review; the 697 collisions require manual merge policy.

## Drift Repair Order

| Priority | Scope | Why first | Action |
|---:|---|---|---|
| 1 | Source metadata hygiene | Prevents new drift while old drift is reviewed. | Fix `.gbrain-source` mismatches: `feishu-essence` should resolve to `feishu-essence-v2`; `tita-essence` should resolve to `tita`. Attach or remove empty `feishu-vc-essence`. |
| 2 | Repo clone health | Sync and rollback depend on readable source checkouts. | Repair corrupted local repos or mark them archive-only before any write pipeline runs. |
| 3 | Resolver guard | Stops silent default fallback. | Add operational guard: unresolved writes fail unless explicitly allowed for `default` governance writes. |
| 4 | Safe default moves | Lowest data risk. | Apply reviewed SQL only for `safe_to_move` rows, with backup and rollback ready. |
| 5 | Soft-deleted collisions | Recoverable but policy-sensitive. | Decide restore/delete/merge per slug; preserve deleted target evidence before any overwrite. |
| 6 | Active collisions | Highest semantic risk. | Diff both pages, merge content explicitly, then retire or rename duplicate. No bulk SQL. |
| 7 | Federation review | Prevents search pollution. | Re-evaluate federated=true on Feishu/TITA/Apple sources after clone health and type coverage are stable. |

## Rollback Requirements

Before any source_id mutation:

1. Create a database dump with `pg_dump --format=custom` against the active `GBRAIN_DATABASE_URL`.
2. Export candidate CSV containing page id, slug, current source, intended source, collision status, and target page id.
3. Generate rollback SQL that restores original `pages.source_id` and dependent source-scoped rows.
4. Keep mutation SQL ending in `ROLLBACK` until a reviewer explicitly switches it to `COMMIT`.
5. After any committed batch, verify counts by source and run a slug collision query for changed slugs.

## Suggested Config Additions

The `sources` table currently stores operational fields but not the whole governance contract. Add a declarative registry file or config block shaped like this:

```yaml
sources:
  default:
    owner: gbrain-governance
    lifecycle: quarantine
    write_policy: deny-new-writes
    sync_policy: none
    retirement_policy: migrate-safe-first-review-collisions
  obsidian:
    owner: obsidian-vault
    lifecycle: active
    write_policy: vault-only
    sync_policy: explicit-source-sync
    retirement_policy: never-without-full-vault-replacement
```

Minimum fields: `owner`, `data_type`, `write_policy`, `sync_policy`, `retirement_policy`, `federated_expected`, and `sensitivity`.

## Open Follow-ups

| Follow-up | Owner profile | Reason |
|---|---|---|
| Implement resolver guard for default fallback writes | CTO/Codex coding task | Requires code change and tests. |
| Repair corrupted source checkouts and dotfile mismatches | Codex ops task | Required before reliable sync. |
| Review 697 default-source collisions | Manager + Codex execution | Requires semantic merge choices, not bulk SQL. |
| Add machine-readable source registry config | CTO/Codex coding task | Turns this contract into enforceable policy. |
