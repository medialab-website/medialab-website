# P02-M12-A Build State

- Packet: P02-M12-A — Editor Handoff and Returned-Media Intake Foundation
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `8d266b9dffb0a9cd5d1392883f756d107b4e9b97`
- Base tree: `47cc720f463f13804fb8b463b956a16430470176`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m12-a-editor-handoff-returned-media-intake-r01`
- Migration: `db/migrations/0015_editor_handoff_returned_media_intake_foundation.sql`
- Database: `medialab_p02m12a_test`
- Owner role: `medialab_p02m12a_test_owner`
- Restricted runtime role: `medialab_p02m12a_test_app`
- Socket and port: `/tmp/mlvs01-p02m12a-pg`, `55442`
- Disposable cluster data directory: `/tmp/mlvs01-p02m12a-data`
- Accepted predecessor migrations: 0001 through 0014, byte-identical
- Seed boundary: two permission definitions and permission-set associations only; no handoff, return-intake, returned-media, provider, or operational rows
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Network/provider/real-media/Desktop/production/deployment activity: none
- Commit, push, remote branch, platform advancement, and main mutation: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
