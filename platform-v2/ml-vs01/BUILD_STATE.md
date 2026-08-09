# P02-M15-E Build State

- Packet: P02-M15-E — Organization Records Dashboard & Audited Export Foundation
- Candidate state: uncommitted, unstaged, bounded nonproduction review candidate
- Base commit: `35ea18a5e94947e9b9ff90363eeb7c476ef370af`
- Base tree: `fcf5cb6d13c31fa6edbc212eab5575583068876e`
- Production/default `main` evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m15-e-organization-records-dashboard-audited-export-r01`
- Migration: `db/migrations/0022_organization_records_dashboard_audited_export_foundation.sql`
- Database: `medialab_p02m15e_test`
- Owner role: `medialab_p02m15e_test_owner`
- Restricted runtime role: `medialab_p02m15e_test_app`
- Socket and port: `/tmp/mlvs01-p02m15e-pg`, `55446`
- Disposable cluster data directory: `/tmp/mlvs01-p02m15e-data`
- Accepted predecessor migrations: `0001` through `0021`, byte-identical
- Dependency boundary: exact required dependencies remain Fastify `5.11.2` and pg `8.22.0`; `package-lock.json` remains immutable
- Classification boundary: organization funding requires matching immutable `BILLING_PARTY` and `COMMERCIAL_OWNER` organization evidence; matching personal payer/owner evidence is personal; every contradiction fails closed
- Privacy boundary: personal Orders are excluded by default; only the exact active personal commercial owner may share or revoke a non-financial summary through session-derived runtime commands
- Projection boundary: organization-funded rows expose only bounded Order/item/Appointment/settlement/total/existing financial-eligibility evidence; personal rows expose no financial, payment, settlement, media, storage, credential, provider, path, download, or Property Hub data
- Export boundary: owner-only snapshot creation freezes deterministic row order, canonical payload text, per-row visibility basis/share evidence, SHA-256 identities, and append-only audit history
- Preservation boundary: revocation stops future personal-summary visibility without deleting the share, audit history, or earlier sealed export membership/payloads
- Activation boundary: customer-facing dashboard/export runtime authority remains unavailable; no trusted-billing predicate or Milestone F capability exists
- Payment boundary: no transaction ledger, processor settlement, invoice state, paid state, Stripe state, or provider operation exists
- Media boundary: financial/records visibility creates no Property Hub, publication, media, credential, storage, or download authority
- Preserved account-recovery law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history
- Preserved deletion boundary: it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data
- Preserved deferral boundary: Actual profile/preferences reset behavior remains deferred until those models exist
- Commit, staging, push, retained remote branch, PR, `platform` advancement, `main` mutation, deployment, production, dual-run, cutover, and cleanup: none

Validation and frozen evidence identities are recorded outside the repository in the review package produced from this exact candidate.
