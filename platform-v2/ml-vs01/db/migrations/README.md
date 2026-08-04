# Canonical Database Migrations Directory

This directory contains the canonical SQL migrations for MediaLab Platform V2.

## Migration Law & Engine Rules

1. **Filename Law**
   * Migration filenames must strictly match the regex pattern: `^[0-9]{4}_[a-z0-9_]+\.sql$`
   * Example: `0001_foundation.sql`
   * Duplicate four-digit numeric prefixes (e.g. `0001_a.sql` and `0001_b.sql`) are strictly prohibited and rejected before SQL execution.

2. **Deterministic Execution Order**
   * Migrations are discovered, validated, and executed in strict lexicographical order based on their four-digit numeric prefix.

3. **Exact-Byte Checksum Verification**
   * The migration engine computes a 64-character lowercase SHA-256 checksum from the exact file bytes of each `.sql` file.
   * Checksums are recorded in `medialab_meta.schema_migrations`.

4. **Immutability & Checksum-Drift Rejection**
   * Once applied, a migration file is immutable.
   * If an applied migration file's SHA-256 checksum changes, the migration engine fails closed and halts immediately without executing further SQL or modifying existing database objects/ledger records.

5. **Domain Migration Ownership**
   * Canonical `.sql` domain migration files are added only by their dedicated packets.
   * `0003_person_contacts_and_account_lifecycle.sql` is the bounded P02-M02-A additive migration for contact and account-lifecycle evidence.
   * `0004_current_catalog_and_price_snapshots.sql` is the bounded P02-M03-A additive migration for global catalog identity, effective prices, deterministic package brackets, immutable commercial snapshots, custom evidence, and provider mappings.
   * `0005_catalog_administration_lifecycle.sql` is the bounded P02-M03-B additive migration for draft/published authoring, independent archive visibility, attributable definition revision, and protected unused-draft deletion.
   * `0006_orders_and_immutable_commercial_evidence.sql` is the bounded P02-M04-A additive migration for canonical Orders, frozen parties and items, provider-neutral source references, command idempotency, append-only events, and related-Order evidence.
   * `0007_property_hub_foundation.sql` is the bounded P02-M04-B additive migration for property-centered engagement identity, immutable initial snapshot evidence, canonical Order associations, explicit participants, provider-neutral references, idempotency, and append-only Hub events.
   * `0008_scheduling_request_and_appointment_foundation.sql` is the bounded P02-M05-A additive migration for provider-neutral Scheduling Requests, requested and proposed windows, attributable customer acceptance, confirmed Appointments, participant assignment history, operational outcomes, supersession, idempotency, and append-only events.
   * Migrations `0001` through `0007` remain immutable predecessor inputs.

6. **Owner and Runtime Role Separation**
   * `PGUSER` identifies the dedicated migration owner used for migrations, seed, and reset.
   * `PGRUNTIMEUSER` identifies an existing restricted runtime role and must differ from the migration owner.
   * Migration SQL is deliberately environment-role-neutral; migrations `0003` through `0008` contain no environment-specific role names or grants.
   * `db/migrate.ts` is the canonical supported migration entrypoint. It validates that the owner and runtime roles both exist and differ.
   * Migration SQL, the runtime privilege policy, and the migration-ledger insert execute within the same database transaction without substituting environment-specific values into canonical migration bytes.
   * Raw manual execution of migration `0003` alone is safe but incomplete and is not a supported deployment path.
   * `db/migrate.ts` applies the exact runtime end-state: zero direct packet-table privileges, no credential-table reads, zero internal-helper execution, exactly seven public mutation APIs executable, and zero PUBLIC function execution.
   * Raw manual execution of migration `0004` alone is likewise incomplete. The canonical runner separately inventories ten P02-M03-A functions, reapplies zero direct table or sequence privileges, and grants the restricted runtime role only those ten functions plus the unchanged seven P02-M02-A APIs.
   * Raw manual execution of migration `0005` alone is likewise incomplete. The canonical runner separately inventories seven P02-M03-B runtime functions, keeps two new trigger helpers owner-only, and preserves all predecessor grants without changing predecessor API semantics.
   * Raw manual execution of migration `0006` alone is likewise incomplete. The canonical runner grants only `create_order` and `get_order_record` to the restricted runtime role, keeps all Order helpers owner-only, and preserves the preceding 24 runtime APIs unchanged.
   * Raw manual execution of migration `0007` alone is likewise incomplete. The canonical runner grants only `create_property_hub` and `get_property_hub_record` as new runtime APIs, keeps all Hub helpers owner-only, and preserves predecessor runtime APIs unchanged.
   * Raw manual execution of migration `0008` alone is likewise incomplete. The canonical runner grants only the eighteen controlled P02-M05-A scheduling and Appointment commands/projections, keeps all scheduling helpers owner-only, preserves predecessor runtime APIs unchanged, and grants no direct table or sequence authority.

7. **Global Catalog and Commercial-Evidence Boundary**
   * Catalog products, package definitions, brackets, prices, and external mappings are global MediaLab-owned records and contain no organization ownership field.
   * Current selectable reads exclude retired, nonselectable, legacy, and custom evidence. Nonselectable current products may still be frozen package inclusions.
   * Price, package-version, bracket, mapping, and snapshot evidence is append-only. Catalog product deletion is rejected, and lifecycle changes remain attributable.
   * Commercial snapshots deep-copy product, package, bracket, adjustment, travel, provenance, acceptance, actor, and time facts. Custom commercial snapshots are physically separate and cannot be promoted through ordinary catalog creation.
   * Aryeo values are synthetic external-provider mappings only; canonical product identity remains a MediaLab-owned UUID.

8. **Catalog Administration Lifecycle Boundary**
   * Authoring state (`DRAFT` or `PUBLISHED`), commercial lifecycle (`ACTIVE`, `NONSELECTABLE`, or `RETIRED`), and administrative archive visibility are independent axes.
   * Drafts are nonselectable. Publication, definition revision, archive, unarchive, and deletion commands derive the actor from an ordinary session and require the internal `catalog.manage` permission.
   * `catalog.manage`, `catalog.snapshot_create`, and the P02-M03-B lifecycle APIs are internal MediaLab operator capabilities. Customer organization roles do not imply global catalog authority.
   * Only a never-published, nonselectable draft with zero protected references may be physically deleted. A durable append-only deletion event remains after the product row is removed.
   * `get_current_selectable_catalog(timestamptz)` and `get_current_catalog_package_inclusions(timestamptz)` are client-safe commercial projections, but database execution remains restricted to explicitly granted runtime roles and is never granted to `PUBLIC`.
   * Snapshot foreign keys preserve provenance and referential integrity. Frozen snapshot columns, not mutable catalog definitions, remain authoritative for historical commercial meaning.

9. **Canonical Current Catalog Seed Boundary**
   * The deterministic canonical seed records the approved public MediaLab real-estate catalog from `https://medialab.fyi/real-estate` as `PUBLIC_WEBSITE` evidence with stable MediaLab-owned codes, USD integer-cent prices, source labels, seed version, and seed effective date.
   * Matterport offerings preserve their overlapping public labels as manual-selection products and are not placed in an automatic bracket evaluator.
   * Enhanced Floor Plan and 3D Floor Plan group labels do not become invented base-price products.
   * Synthetic verification records remain labeled `SYNTHETIC_FIXTURE`, nonselectable, and separate from real current offerings.

10. **Order and Immutable Commercial-Evidence Boundary**
   * A canonical Order records one accepted commercial agreement with an immutable organization context, optional lane-appropriate Property snapshot, settlement declaration, currency, server-derived totals, source attribution, and accepted time.
   * Ordering person, customer, billing party, commercial owner, organization, and authorized actor are separate frozen role records. Active tenant membership and permission are validated server-side at creation and are not inferred from browser-supplied role claims.
   * Order items reference accepted catalog or custom commercial snapshots and deep-copy description, quantity, commercial unit, integer-cent amount, currency, source identity, and custom attribution. Catalog mutation cannot rewrite Order meaning.
   * External source identity is provider-neutral and globally unique. Actor-scoped idempotency keys use a server-computed request fingerprint and a transaction advisory lock so exact replay returns one Order while conflicting or failed requests leave no partial canonical evidence.
   * Orders, parties, items, source references, idempotency records, events, and relationships are immutable. Critical lifecycle evidence is append-only, and related Orders preserve correction, supplemental, replacement, customer-added-scope, or MediaLab-responsible-return work without reopening the original agreement.
   * `create_order` and `get_order_record` are the complete P02-M04-A runtime API inventory. Neither function trusts caller-supplied actor identity, and neither grants table DML or execution authority to `PUBLIC`.

11. **Property Hub Engagement Boundary**
   * A Property Hub is a distinct organization-owned engagement around exactly one canonical Property and its immutable initial Property snapshot. Multiple Hubs may preserve separate engagements for the same Property.
   * Hub Order links associate canonical Orders without mutating or flattening their parties, items, commercial snapshots, or related-Order evidence. The database requires every associated Order to share the Hub organization and Property.
   * The authenticated creator is recorded as the initial `HUB_MANAGER`; additional active organization memberships may be recorded as `HUB_MANAGER` or `HUB_PARTICIPANT`. Retrieval requires both `property_hub.read` and explicit Hub participation.
   * Hub external identity is provider-neutral and globally unique by provider, external record type, and external identifier. Actor-scoped creation idempotency is separate from Order idempotency and uses the same accepted request-fingerprint and advisory-lock pattern.
   * Hub identity, initial snapshot evidence, Order links, participant evidence, external references, idempotency records, and creation events are immutable. `PROPERTY_HUB_CREATED` is the sole foundation lifecycle event and `ESTABLISHED` is the sole foundation state.
   * `create_property_hub` and `get_property_hub_record` are the complete P02-M04-B runtime API inventory. Runtime roles have no direct Hub table or sequence DML, and `PUBLIC` has no Hub authority.

12. **Scheduling Request and Appointment Boundary**
   * A Scheduling Request is distinct from every requested or staff-proposed window, acceptance record, and confirmed Appointment. A database uniqueness constraint permits no more than one Appointment per request.
   * Customer commands derive the actor from an ordinary session and validate current Order-party evidence. Property Hub participation alone grants no scheduling mutation authority. Staff commands require the narrow `scheduling.staff.manage` permission.
   * Staff-recorded offline acceptance preserves both the staff recorder and asserted authorized customer, the accepted proposal, method, timestamp, and optional note; it never represents the staff session as customer authentication.
   * Every window and Appointment stores exact instants, explicit IANA timezone, and original local timestamps. Server-side validation reconstructs the instants with `AT TIME ZONE`, so browser, server, and database session timezone changes cannot silently alter meaning.
   * Appointments may be unassigned. Assignments record canonical Person, operational role, assigning actor, and time; separate immutable ending evidence records end/replacement actor, reason, and time.
   * Cancellation, no-show, inaccessible-property, unable-to-complete, weather-delay, and supersession are separate append-only events. No vague completion state is introduced.
   * Rescheduling creates a new Scheduling Request, proposal, attributable acceptance, and Appointment, then marks the original Appointment superseded with an explicit replacement link. Original time, assignments, notes, and events remain immutable.
   * Runtime roles receive EXECUTE only on the eighteen controlled scheduling APIs, receive no direct packet-table DML, and inherit no authority from caller-supplied actor identifiers. `PUBLIC` receives no table or function authority.

13. **Bearer Authority Boundary**
   * Ordinary mutation APIs derive their actor from an unexpired, unrevoked bearer session digest in `development_sessions`.
   * Account recovery uses a separate short-lived, single-use digest in `account_recovery_sessions`.
   * Raw bearer tokens are never stored in canonical tables or immutable evidence.

14. **Recovery Intent Boundary**
   * `START_FRESH` records recovery intent for the same Person and Identity while preserving existing history.
   * It does not currently delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data.
   * Actual profile/preferences reset behavior remains deferred until those models exist.
