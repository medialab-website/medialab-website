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
   * Migrations `0001` and `0002` remain immutable release inputs.

6. **Owner and Runtime Role Separation**
   * `PGUSER` identifies the dedicated migration owner used for migrations, seed, and reset.
   * `PGRUNTIMEUSER` identifies an existing restricted runtime role and must differ from the migration owner.
   * Migration SQL is deliberately environment-role-neutral; migration `0003` contains no environment-specific role names or grants.
   * `db/migrate.ts` is the canonical supported migration entrypoint. It validates that the owner and runtime roles both exist and differ.
   * Migration SQL, the runtime privilege policy, and the migration-ledger insert execute within the same database transaction without substituting environment-specific values into canonical migration bytes.
   * Raw manual execution of migration `0003` alone is safe but incomplete and is not a supported deployment path.
   * `db/migrate.ts` applies the exact runtime end-state: zero direct packet-table privileges, no credential-table reads, zero internal-helper execution, exactly seven public mutation APIs executable, and zero PUBLIC function execution.

7. **Bearer Authority Boundary**
   * Ordinary mutation APIs derive their actor from an unexpired, unrevoked bearer session digest in `development_sessions`.
   * Account recovery uses a separate short-lived, single-use digest in `account_recovery_sessions`.
   * Raw bearer tokens are never stored in canonical tables or immutable evidence.

8. **Recovery Intent Boundary**
   * `START_FRESH` records recovery intent for the same Person and Identity while preserving existing history.
   * It does not currently delete memberships, contacts, orders, payments, historical evidence, or profile/preferences data.
   * Actual profile/preferences reset behavior remains deferred until those models exist.
