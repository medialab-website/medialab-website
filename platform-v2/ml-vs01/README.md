# MediaLab Platform V2 — VS01 Repair Packet P01B-M01 Migration Engine

This workspace implements the TypeScript ordered-SQL migration engine and physical ledger for packet `ML-PLATFORM-V2-VS01-REPAIR-P01B-M01-MIGRATION-ENGINE-R01`.

## Active Boundaries

* Branch: `platform-v2-vs01-repair-p01b-r01`
* Worktree: dedicated bounded packet worktree
* Base Commit: `b179722abf34a71bd07eafb8013c34df8335620f`
* Root: `platform-v2/ml-vs01`
* Physical Ledger Table: `medialab_meta.schema_migrations`
* PostgreSQL Databases: `medialab_vs01_repair_p01a`, `medialab_vs01_repair_p01a_test`

## Package Commands

* Development Migration: `npm run migrate:dev`
* Test Migration: `npm run migrate:test`
* Machine Verification Gates: `npm run verify:all`
