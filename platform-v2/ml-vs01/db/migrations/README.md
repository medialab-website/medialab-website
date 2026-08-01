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
   * Canonical `.sql` domain migration files are owned and added by later dedicated migration packets (e.g. P01B-M02). No canonical `.sql` files are added in M01.
