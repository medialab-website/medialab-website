# P02-M19-A Build State

- Controlling authority: owner-approved `P02-M19-A — Operations Console Mission Plans: Draft, Issue, Refresh & Offline Mission Plan`, owner-directed Mission Control simplification in the same bounded Work chat (superseding the R02 layout), and canonical R121.
- Candidate state: uncommitted, unstaged, bounded synthetic nonproduction layout-checkpoint candidate.
- Base Platform commit: `d0564348d423404c9cc759c1e25f19bb643c2ee5`.
- Base Platform tree: `89e24a6f393d843fbf1f2fd81bc96185ef02c667`.
- Observed production/default `main`: `28517e4d2131014cfdf090fa3aa40d6bcf7b6398`; observational only and unchanged.
- Branch: `platform-v2-p02-m19-a-operations-mission-plans-r01`.
- Database boundary: disposable `medialab_p02m17a_test`; restricted runtime `medialab_p02m17a_test_app`; ordinary request handling retains zero direct canonical-table DML and zero sequence authority.
- Migration boundary: accepted migrations `0001`–`0024` remain byte-identical. Additive `0025_operations_mission_plan_draft_controls.sql` adds staff-only permission-checked read projections for reload-safe Mission Plan controls and selected-order customer contact actions. It adds no table, column, constraint, trigger, canonical mutation, credential, provider, or production authority.
- Dependency boundary: byte-identical `package-lock.json`, SHA-256 `2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a`; no dependency addition or remediation.
- Listing flow: property package first by visible square-foot range, explicit à-la-carte path for special requests, compact inclusion disclosure, then grouped add-ons in owner-directed Video → Photo → Matterport → Zillow 3D Home → CubiCasa/floor-plan order. The assistance path opens an honest email draft and does not claim a durable request was recorded.
- Operator flow: Mission Control opens to Needs Attention with Today → Upcoming → Completed property-card views. A selected property uses one read-first page with customer actions, appointment, services, crew, and Google Maps. Scheduling and crew forms remain hidden until Set, Reschedule, Assign, or Edit is chosen. Mission Plan generation automatically includes ordered Workstreams and safe customer contacts, then presents weather, checklists, directions, priorities, access, and notes as collapsed sections.
- Brand/layout: repository MediaLab logo, charcoal `#121212` base, `#1e1e1e` surfaces and inputs, high-contrast light text, amber `#ffc107` active states, Inter/Roboto/system typography, desktop 36/64 master-detail split, and responsive single-pane fallback. Layout remains owner-reviewable and is not frozen.
- Canonical lifecycle law: all draft, selection, note, refresh, issue, supersede, and open-event writes use accepted migration `0010` restricted commands; issued versions remain immutable and sequential.
- Mission Plan law: self-contained HTML includes saved version/schema/hash, canonical appointment-local time and timezone, visibility-safe sections/contacts/notes, safe `mailto:`/`tel:` actions, selected Workstreams, and honest canonical weather status. Internal-only sections and protected material are excluded.
- Weather boundary: no weather provider, credential, network call, cost, or fabricated forecast. Unavailable evidence is explicit.
- Mission-use boundary: customer email and any canonical phone methods expose standard device actions; directions open an address-derived Google Maps URL without an API call or credential. Two-way route evidence, home-base routing, live weather, and offline sync are not fabricated. Saved Mission Plans can be downloaded for offline use.
- Contact identifier compatibility: browser validation accepts PostgreSQL-native UUID syntax for database-issued contact-method IDs while retaining strict canonical UUID validation for person, order, Mission Plan, Workstream, appointment, and version authorities.
- Evidence law: synthetic values and sanitized aggregates only; no real customer data, address, provider payload, credential, media, or raw session evidence.
- Explicit exclusions: Desktop changes, culling, handoff, editor workflows, returned-editor review, Quick Edit, payment, delivery, production deployment, `main`, provider integration, dual-run, and cutover.
- Prohibited actions before later owner disposition: no staging, commit, push, remote branch, PR, Platform/main advancement, deployment, production mutation, provider connection, or next-packet work.

## Preserved predecessor law

P02-M17-A and P02-M18-A remain GOVERNANCE_CLOSED at canonical Platform `d0564348d423404c9cc759c1e25f19bb643c2ee5`. Their listing/order, Operations Home, scheduling, assignment, replay, and authority decisions remain intact and are not reopened.

START_FRESH records recovery intent for the same Person and Identity while preserving existing history. It does not delete or rewrite memberships, contacts, orders, payments, historical evidence, or profile/preferences data. Actual profile/preferences reset behavior remains deferred until those models exist.
