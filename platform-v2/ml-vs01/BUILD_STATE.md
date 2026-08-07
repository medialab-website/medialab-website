# P02-M15-B Build State

- Packet: P02-M15-B — Temporary Download Center Access Credential & Gateway Foundation
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `e25d19af7a5897f79c6814cd74b91d4ce0b743fa`
- Base tree: `e3c69e6aeeb6f7cb743edbca31d403c1e3d6df88`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m15-b-tdc-access-credential-gateway-r01`
- Migration: `db/migrations/0019_temporary_download_center_access_credential_gateway_foundation.sql`
- Database: `medialab_p02m15b_test`
- Owner role: `medialab_p02m15b_test_owner`
- Restricted runtime role: `medialab_p02m15b_test_app`
- Socket and port: `/tmp/mlvs01-p02m15b-pg`, `55443`
- Disposable cluster data directory: `/tmp/mlvs01-p02m15b-data`
- Accepted predecessor migrations: 0001 through 0018, byte-identical
- Seed boundary: no credential, verifier, gateway attempt, or access-observation rows; synthetic secrets exist only in disposable test variables
- Credential boundary: issue and rotation generate 32 random bytes server-side, return the 64-character lowercase hexadecimal secret once, and persist only a SHA-256 verifier with immutable identity/lifecycle evidence
- Lifecycle boundary: rotation creates a sequential immutable generation, invalidates the predecessor immediately, preserves center expiration, and revocation preserves attributed history
- Gateway boundary: the only sessionless packet API requires restricted-runtime EXECUTE, exact secret possession, current credential generation, current M15-A policy eligibility, and an exact current item for DOWNLOAD
- Policy boundary: authenticated and anonymous evaluation reuse one owner-only M15-A current-policy helper covering center lifecycle/expiry, creator authority, publication state, PAY_NOW evidence, APPROVED_TERMS, and multi-Order locking
- Observation boundary: the gateway is the sole new trusted runtime writer and records bounded append-only OPEN/DOWNLOAD observations; the runtime retains zero direct table DML
- Disclosure boundary: anonymous denials are generic; history/read APIs omit usable secrets, verifier hashes, request fingerprints, URLs, paths, provider payloads, and bytes
- Public/provider boundary: no webpage, HTTP/API route, public/signed URL, storage adapter, file transfer, actual download, notification, payment, provider, customer, production, or deployment mechanism exists
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Commit, push, remote branch, platform advancement, and main mutation: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
