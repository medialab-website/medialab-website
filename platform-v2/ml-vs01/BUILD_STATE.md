# P02-M17-A Build State

- Controlling authority: owner-approved `P02-M17-A — Internal Operations Console: New Listing & Order Confirmation`, exact packet `72_ML_PLATFORM_V2_P02_M17_A_INTERNAL_OPERATIONS_CONSOLE_NEW_LISTING_ORDER_CONFIRMATION_PACKET_R01.md`, activation record, continuous-candidate handoff, accepted AppSheet inspection, and R118 bootstrap chain.
- Candidate state: uncommitted, unstaged, bounded synthetic nonproduction review candidate.
- Base Platform commit: `2593991bf70e1b8fce4f49998c637c28b6b8decb`.
- Base Platform tree: `785511300f717cc8c623862e0066e8676aec1677`.
- Observed production/default `main`: `28517e4d2131014cfdf090fa3aa40d6bcf7b6398`; observational only and unchanged.
- Local workspace: `/private/tmp/mlvs01-p02m17a-operations-console-r01`.
- Local branch: `platform-v2-p02-m17-a-internal-operations-console-r01`.
- Database boundary: disposable `medialab_p02m17a_test`; restricted runtime `medialab_p02m17a_test_app`; owner role only for deterministic migration, reset, seed, session bootstrap, and test observation outside request handling.
- Socket/port: `/tmp/mlvs01-p02m17a-pg`, `55448`; loopback application `127.0.0.1:4317`.
- Migration boundary: accepted migrations remain exactly byte-identical `0001`–`0023`; migration `0024` remains absent.
- Dependency boundary: byte-identical `package-lock.json`, exact SHA-256 `2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a`; no dependency additions or version changes; `package.json` changes are script-only.
- Operator flow: Customer → Property → Services → Review → Create Listing → canonical Order Confirmation.
- Transaction law: one checked-out restricted-runtime connection encloses customer reconciliation, Property/Snapshot reconciliation, immutable commercial snapshots, Order creation, and in-transaction canonical readback; any pre-commit failure rolls back the complete path.
- Replay law: server-bound opaque submission identity, normalized full-request fingerprint, tenant-scoped deterministic commercial snapshot UUIDs, exact primary-key savepoint recovery, and accepted `create_order` idempotency determine replay/conflict behavior.
- Authority law: browser supplies no actor, organization, membership, party, UUID, source, provider identity, idempotency key, price, currency, or total; all six Order parties and all money authority are server/canonical-derived.
- Runtime law: business execution uses only accepted `SECURITY DEFINER` projections/commands; runtime and `PUBLIC` retain zero canonical-table DML; runtime retains zero sequence authority; `PUBLIC` retains zero function execution.
- Session law: the database session token remains server-only behind an opaque HttpOnly, SameSite Strict, path-scoped, bounded loopback cookie.
- Evidence law: only synthetic values and sanitized aggregate/receipt evidence may enter review artifacts; no real customer data, real address, credential, raw session evidence, provider payload, or unrestricted repository dump.
- Catalog finding: the accepted projection exposes five active package rows without package-composition versions. The bounded console fails those incomplete packages closed and offers the 21 rows that can be converted through the accepted immutable snapshot command; no custom-price or migration workaround is introduced.
- Explicit exclusions: no Upcoming Orders, scheduling, assignment, Mission Plan, Desktop, culling, editor handoff, returned-editor review, Quick Edit, delivery, payment collection, provider workflow, production, real data/media, dual-run, cutover, retirement, or cleanup.
- Prohibited actions: no staging, commit, push, remote branch, PR, Platform/main advancement, deployment, provider connection, production mutation, later packet, or scope repair outside the exact 24-path allowlist.

## Preserved predecessor lifecycle law

START_FRESH records recovery intent for the same Person and Identity while preserving existing history. It does not delete or recreate memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
