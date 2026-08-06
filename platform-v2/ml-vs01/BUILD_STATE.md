# P02-M11-A Build State

- Packet: P02-M11-A — Media Cull Workspace and Selected-Media Evidence Foundation
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `ce949407b9c89b29d0e5ea6084b74c04c752e284`
- Base tree: `9331e52c5d5053f0fbbd9ea6825a3509d2fa15c4`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m11-a-media-cull-selection-foundation-r01`
- Migration: `db/migrations/0014_media_cull_workspace_selected_media_evidence_foundation.sql`
- Database: `medialab_p02m11a_test`
- Owner role: `medialab_p02m11a_test_owner`
- Restricted runtime role: `medialab_p02m11a_test_app`
- Socket and port: `/tmp/mlvs01-p02m11a-pg`, `55441`
- Disposable cluster data directory: `/tmp/mlvs01-p02m11a-data`
- Accepted predecessor migrations: 0001 through 0013, byte-identical
- Seed boundary: two permission definitions and permission-set associations only; no cull, selected-media, or operational rows
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Network/provider/real-media/Desktop/production/deployment activity: none
- Commit, push, remote branch, platform advancement, and main mutation: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
