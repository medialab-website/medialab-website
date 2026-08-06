# P02-M10-A Build State

- Packet: P02-M10-A — Capture Session, Ingest, and Custody Foundation
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `772b994412437cbb4f620b021552eae18dc72c11`
- Base tree: `b04aac3728b2ec77bd0231b7f5eceee6cc7178a5`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m10-a-capture-session-ingest-custody-r01`
- Migration: `db/migrations/0013_capture_session_ingest_custody_foundation.sql`
- Database: `medialab_p02m10a_test`
- Owner role: `medialab_p02m10a_test_owner`
- Restricted runtime role: `medialab_p02m10a_test_app`
- Socket and port: `/tmp/mlvs01-p02m10a-pg`, `55440`
- Disposable cluster data directory: `/tmp/mlvs01-p02m10a-data`
- Accepted predecessor migrations: 0001 through 0012, byte-identical
- Seed boundary: two permission definitions and permission-set associations only; no capture or media operational rows
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Network/provider/real-media/Desktop/production/deployment activity: none
- Commit, push, remote branch, platform advancement, and main mutation: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
