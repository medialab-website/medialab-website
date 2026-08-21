# P02-M20-A Build State

- Controlling authority: owner-approved `P02-M20-A — Editorial Segment Foundation`, the approved selected-working-set/handoff/storage-lifecycle direction, and canonical R121.
- Candidate state: uncommitted, unstaged, bounded synthetic nonproduction candidate under active validation.
- Base Platform commit: `9bf956f1ba43cecd3acd412549b65b582bafa55b`.
- Base Platform tree: `ffaec955264a81c8a785b95b095a4d97d4a5a6c3`.
- Observed production/default `main`: `28517e4d2131014cfdf090fa3aa40d6bcf7b6398`; observational only and unchanged.
- Branch: `platform-v2-p02-m20-a-editorial-segment-foundation-r01`.
- Database boundary: isolated disposable `medialab_p02m16a_test`; owner `medialab_p02m16a_test_owner`; restricted runtime `medialab_p02m16a_test_app`.
- Migration boundary: accepted migrations `0001`–`0025` remain byte-identical. Additive `0026_editorial_segment_foundation.sql` adds immutable technical observations, nondestructive exact-tick segments, revisions, decisions, and current projections.
- Dependency boundary: byte-identical `package-lock.json`, SHA-256 `2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a`; no dependency change.
- Runtime boundary: seven new permission-checked SECURITY DEFINER APIs; no direct runtime table DML, no sequence authority, and no PUBLIC execution.
- Segment law: one ORIGINAL video version may own multiple independent or overlapping frame-aligned ranges; exact retry and concurrent same-request calls converge; corrections append new versions without changing source identity.
- Decision law: `SELECTED`, `REJECTED`, `UNSELECTED`, `APPROVED_UNUSED`, and `RESERVED` are attributable append-only events with explicit clear/correction and stale-generation rejection.
- Evidence law: bounded synthetic JSON only; secrets, URLs, absolute paths, media bytes, and unsafe names are rejected.
- Storage law preserved for later packets: one active SSD source copy; rejected clips produce no duplicates; deterministic production names are virtual by default; no silent full-copy fallback; cloud/archive/local-clearance operations require separately bounded authority.
- Non-effect boundary: no media was scanned, renamed, trimmed, copied, uploaded, archived, handed off, deleted, or otherwise contacted. No provider, credential, production database, deployment, payment, notification, or `main` action occurred.
- Prohibited before owner disposition: no staging, commit, push, remote branch, Platform fast-forward, deployment, production mutation, provider connection, real-media access, or next-packet work.

## Preserved predecessor law

P02-M17-A, P02-M18-A, and P02-M19-A remain `GOVERNANCE_CLOSED` at canonical Platform `9bf956f1ba43cecd3acd412549b65b582bafa55b`. Their Operations Console, scheduling, assignment, Mission Plan, replay, authority, and production-boundary decisions remain intact.

START_FRESH records recovery intent for the same Person and Identity while preserving existing history. It does not delete or rewrite memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
