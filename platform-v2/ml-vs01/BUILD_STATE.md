# P02-M15-D Build State

- Packet: P02-M15-D — Provider-Neutral File-Backed Delivery Adapter & Local Storage Proof
- Candidate state: uncommitted, unstaged, nonproduction review candidate
- Base commit: `0df5e053a4dde20f201629f7e3dedce1b9708909`
- Base tree: `cdd8503c7504f9f853d2ac70cefb07f8b971a160`
- Production/default main evidence: `b72c3f2115fe00c217a7cda2eca699c404c312f8`
- Local branch: `platform-v2-p02-m15-d-file-backed-delivery-local-storage-r01`
- Migration: `db/migrations/0021_provider_neutral_file_backed_disposable_delivery_foundation.sql`
- Database: `medialab_p02m15d_test`
- Owner role: `medialab_p02m15d_test_owner`
- Restricted runtime role: `medialab_p02m15d_test_app`
- Socket and port: `/tmp/mlvs01-p02m15d-pg`, `55445`
- Disposable cluster data directory: `/tmp/mlvs01-p02m15d-data`
- Controlled local delivery root: `/tmp/mlvs01-p02m15d-storage`
- Accepted predecessor migrations: 0001 through 0020, byte-identical
- Runtime dependency boundary: exact required dependencies remain Fastify `5.11.2` and pg `8.22.0`; `package-lock.json` is unchanged
- Authorization boundary: the internal resolver calls exactly one accepted M15-B DOWNLOAD gateway attempt for the exact current TDC item
- Storage boundary: the exact TDC media version resolves to exactly one canonical `media_storage_objects` record selected by server-owned provider and namespace
- Adapter boundary: only `LOCAL_FIXTURE` / `M15D_DELIVERY` descriptors may read bounded regular files under the controlled root after traversal, symlink, byte-size, and SHA-256 checks
- Browser boundary: request JSON remains credential ID, secret, exact item ID, and opaque event reference only; provider, namespace, object identifier, descriptor, and filesystem path never enter or leave the browser surface
- Response boundary: successful bytes are an attachment with safe MediaLab-derived filename, canonical content type, no-store and accepted M15-C security headers
- Network boundary: no provider SDK, HTTP client, signed URL, redirect, callback, or outbound network retrieval exists
- Operational boundary: no real credentials/media/provider, public deployment, payment, notification, Desktop change, production, dual-run, cutover, cleanup, or later-packet work exists
- Preserved recovery intent law: START_FRESH records recovery intent for the same Person and Identity while preserving existing history; it does not delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
- Commit, staging, push, remote branch, PR, platform advancement, main mutation, and deployment: none

Validation and frozen evidence identifiers are recorded outside the repository in the review package produced from this exact candidate.
