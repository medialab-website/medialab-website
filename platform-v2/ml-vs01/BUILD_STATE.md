# P02-M15-A Build State

- Packet: P02-M15-A — Temporary Download Center & External Sharing Foundation
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `adca2a6e675b5bec84f8afad75ed6eae53476b88`
- Base tree: `b5fc2b05a46fdb058d8ca642c6de3581f8802c30`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m15-a-temporary-download-center-external-sharing-r01`
- Migration: `db/migrations/0018_temporary_download_center_external_sharing_foundation.sql`
- Database: `medialab_p02m15a_test`
- Owner role: `medialab_p02m15a_test_owner`
- Restricted runtime role: `medialab_p02m15a_test_app`
- Socket and port: `/tmp/mlvs01-p02m15a-pg`, `55443`
- Disposable cluster data directory: `/tmp/mlvs01-p02m15a-data`
- Accepted predecessor migrations: 0001 through 0017, byte-identical
- Seed boundary: four permission definitions and their accepted permission-set associations only; no Temporary Download Center, version, selection, item, event, current-state, activity-observation, credential, provider, or operational rows
- Snapshot boundary: an immutable center version records explicit `(publication_id, category_code)` selections and materializes the exact M14-A publication items and immutable media versions present at creation; later publication or media cannot enter automatically
- Lifecycle boundary: selection updates create sequential immutable versions without extending expiry; replacement creates a new center identity and preserves the old center; revocation preserves all historical evidence
- Policy boundary: current evaluation rechecks expiration, revocation, replacement, creator authority, source-publication state, and each source Order's current M14-A DOWNLOAD financial gate; `APPROVED_TERMS` is distinct from payment evidence
- Credential boundary: no bearer/public token, access code, public or signed URL, public page or API route, recipient account, download endpoint, or storage-access mechanism exists
- Activity boundary: append-only future-compatible OPEN/DOWNLOAD observations may be inserted only by the disposable migration-owner role for tests; the restricted runtime has no INSERT/UPDATE/DELETE authority and no writer API
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Network/provider/real-media/Desktop/production/deployment activity: none, except approved Packet 57 governance-source retrieval and frozen review-artifact transport through the connected Google Drive workspace
- Commit, push, remote branch, platform advancement, and main mutation: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
