# P02-M14-A Build State

- Packet: P02-M14-A — Publication and Delivery Entitlement Foundation
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `eec11fa02c3f1e869f6d69cdc0c9a55e9992fb0c`
- Base tree: `bd04badc4017879c8136bab02fbe1e46b1c23f70`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m14-a-publication-delivery-entitlement-r01`
- Migration: `db/migrations/0017_publication_delivery_entitlement_foundation.sql`
- Database: `medialab_p02m14a_test`
- Owner role: `medialab_p02m14a_test_owner`
- Restricted runtime role: `medialab_p02m14a_test_app`
- Socket and port: `/tmp/mlvs01-p02m14a-pg`, `55443`
- Disposable cluster data directory: `/tmp/mlvs01-p02m14a-data`
- Accepted predecessor migrations: 0001 through 0016, byte-identical
- Seed boundary: six permission definitions and their permission-set associations only; no publication, publication item, lifecycle, financial eligibility, entitlement evaluation, grant, revocation, invalidation, provider, or operational rows
- Publication boundary: exact immutable final-source versions and deterministic placements only; no byte movement, rendering, transformation, provider publication, URLs, external identifiers, or remote side effects
- Delivery boundary: authenticated authority, bounded financial-eligibility evidence, PREVIEW/DOWNLOAD evaluations, grant lifecycle, invalidation, and access re-evaluation only; no settlement ledger, payment mutation, download execution, notification, or delivery-provider operation
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Network/provider/real-media/Desktop/production/deployment activity: none, except approved Packet 55 governance-source retrieval and frozen review-artifact transport through the connected Google Drive workspace
- Commit, push, remote branch, platform advancement, and main mutation: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
