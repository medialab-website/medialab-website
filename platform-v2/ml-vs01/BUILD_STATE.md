# P02-M18-A Build State

- Controlling authority: owner-approved `P02-M18-A — Operations Home, Upcoming Work, Scheduling & Assignment`, packet `73_ML_PLATFORM_V2_P02_M18_A_OPERATIONS_HOME_UPCOMING_SCHEDULING_ASSIGNMENT_PACKET_R01.md`, and R120 bootstrap.
- Candidate state: uncommitted, unstaged, bounded synthetic nonproduction review candidate.
- Base Platform commit: `2fa5a404ec76e185d259c4d32a7b60fe79038921`.
- Base Platform tree: `1953075a94e82ccb4c3e7847dd7139c77a3d145c`.
- Observed production/default `main`: `28517e4d2131014cfdf090fa3aa40d6bcf7b6398`; observational only and unchanged.
- Branch: `platform-v2-p02-m18-a-operations-home-scheduling-assignment-r01`.
- Database boundary: disposable `medialab_p02m17a_test`; restricted runtime `medialab_p02m17a_test_app`; owner role remains confined to deterministic setup, migration, seed, session bootstrap, and observation outside request handling.
- Loopback boundary: database socket `/tmp/mlvs01-p02m17a-pg`, port `55448`; application `127.0.0.1:4317`.
- Migration boundary: accepted migrations `0001`–`0023` remain unchanged; additive `0024_operations_home_scheduling_assignment_console.sql` contains one internal helper and three permission-checked entry projections only. It adds no table, column, constraint, trigger, catalog, credential, provider, or production authority.
- Dependency boundary: byte-identical `package-lock.json`, SHA-256 `2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a`; no dependency addition or remediation.
- Operator flow: Operations → Today / Upcoming / Needs Attention → Listing / Order / Job context → Scheduling / Appointment → Crew Assignment / Replacement.
- M17 navigation: canonical order confirmation links directly into the matching operational context.
- Initialization law: one replay-safe transaction establishes the canonical Property Hub, Scheduling Request, Job, and one Service Workstream per Order Item when absent.
- Mutation law: all scheduling, confirmation, cancellation, rescheduling, job linking, assignment, and replacement changes use accepted `SECURITY DEFINER` canonical commands. Runtime retains zero canonical-table DML and zero sequence authority; `PUBLIC` retains zero function execution.
- Attention law: bounded codes are derived from canonical evidence, not mutable AppSheet-style status strings.
- Session law: actor and organization authority remain server-bound; database tokens remain behind the opaque HttpOnly, SameSite Strict, loopback cookie.
- Evidence law: synthetic values and sanitized aggregates only; no real customer data, address, provider payload, credential, media, or raw session evidence.
- Explicit exclusions: Mission Plans, Desktop, culling, editor handoff/review, Quick Edit, payment, providers, production deployment, `main`, AppSheet cutover, catalog repair, dependency remediation, and unrelated cleanup.
- Prohibited actions: no staging, commit, push, remote branch, PR, Platform/main advancement, deployment, provider connection, production mutation, cutover, or later-packet work before owner acceptance.

## Preserved predecessor law

P02-M17-A remains GOVERNANCE_CLOSED at `2fa5a404ec76e185d259c4d32a7b60fe79038921`. Its listing/order transaction, authority boundary, replay behavior, and canonical confirmation remain intact; M18-A adds the next operational surface without reopening M17-A product discovery.

START_FRESH records recovery intent for the same Person and Identity while preserving existing history. It does not delete or rewrite memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
