# P02-M15-C Build State

- Packet: P02-M15-C — Disposable Delivery Surface & Local Fixture Download Proof
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `9ff83290b3715ab6140676f1c03a0b9cd82abd52`
- Base tree: `89f2b4a4daefa6b36d6b1ef474277a446bc747a5`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m15-c-disposable-delivery-surface-local-fixture-r01`
- Migration: `db/migrations/0020_disposable_delivery_surface_local_fixture_foundation.sql`
- Database: `medialab_p02m15c_test`
- Owner role: `medialab_p02m15c_test_owner`
- Restricted runtime role: `medialab_p02m15c_test_app`
- Socket and port: `/tmp/mlvs01-p02m15c-pg`, `55444`
- Disposable cluster data directory: `/tmp/mlvs01-p02m15c-data`
- Accepted predecessor migrations: 0001 through 0019, byte-identical
- Runtime dependency boundary: Fastify `5.11.2` is the only new, exact-pinned runtime dependency
- Network boundary: the delivery server binds only to IPv4 loopback `127.0.0.1`; non-loopback hosts are rejected before resources are opened
- Credential boundary: the usable M15-B secret enters through the URL fragment, is removed immediately with `history.replaceState`, remains only in browser memory, and is sent only in same-origin POST bodies
- Shell boundary: `GET /d/:credentialId` is secretless and loads only the same-origin `/assets/disposable-delivery.js` asset under a deny-by-default CSP and no-store headers
- Manifest boundary: `get_temporary_download_center_delivery_manifest` reuses the exact M15-B OPEN gateway and projects only bounded expiry, stakeholder label, categories, item labels, ordinals, and item IDs
- Download boundary: every POST download attempt re-runs the exact M15-B DOWNLOAD gateway for one exact current-version item and returns only small deterministic synthetic fixture bytes
- Evidence boundary: OPEN and DOWNLOAD decisions retain M15-B idempotency, generic denial, policy reevaluation, and append-only observation behavior
- Disclosure boundary: no secret, verifier, organization/property/order/publication/media identity, provider payload, local/storage path, public/signed URL, real media, or executable provider command is returned
- Operational boundary: no provider operation, customer data, real recipient access, payment, notification, Desktop change, deployment, production, dual-run, cutover, cleanup, or later-packet work exists
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Commit, push, remote branch, platform advancement, and main mutation: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
