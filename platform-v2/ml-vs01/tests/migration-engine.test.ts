import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { runMigrations, validateMigrationFilenames } from '../db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Migration Engine Substantive Behavior', () => {
  let client: pg.Client;
  const fixturesDir = path.resolve(__dirname, 'fixtures/migrations');

  beforeAll(async () => {
    client = new pg.Client({
      host: '/tmp/mlvs01-p02m04a-pg',
      port: 55432,
      database: 'medialab_p02m04a_test',
      user: 'medialab_p02m04a_test_owner'
    });
    await client.connect();
  });

  afterAll(async () => {
    // Drop any remaining disposable test schemas
    await client.query('DROP SCHEMA IF EXISTS test_schema_valid CASCADE;');
    await client.query('DROP SCHEMA IF EXISTS test_schema_noop CASCADE;');
    await client.query('DROP SCHEMA IF EXISTS test_schema_drift CASCADE;');
    await client.query('DROP SCHEMA IF EXISTS test_schema_fail CASCADE;');
    await client.end();
  });

  it('1 & 2. applies valid migration fixtures in deterministic order and verifies exact SHA-256 checksums', async () => {
    const isolatedSchema = 'test_schema_valid';
    await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);

    try {
      const validDir = path.join(fixturesDir, 'valid');
      const res = await runMigrations({
        migrationsDir: validDir,
        schema: isolatedSchema,
        client
      });

      expect(res.applied).toEqual(['0001_create_temp_table.sql', '0002_insert_temp_data.sql']);
      expect(res.skipped).toEqual([]);

      const ledgerRes = await client.query(`SELECT filename, sha256 FROM "${isolatedSchema}"."schema_migrations" ORDER BY filename ASC;`);
      expect(ledgerRes.rows.length).toBe(2);

      const file1Bytes = fs.readFileSync(path.join(validDir, '0001_create_temp_table.sql'));
      const expectedSha1 = crypto.createHash('sha256').update(file1Bytes).digest('hex').toLowerCase();

      expect(ledgerRes.rows[0].filename).toBe('0001_create_temp_table.sql');
      expect(ledgerRes.rows[0].sha256).toBe(expectedSha1);

      // Verify SQL effects occurred in isolated schema
      const dataRes = await client.query(`SELECT * FROM "${isolatedSchema}"."temp_test_table_0001";`);
      expect(dataRes.rows.length).toBe(1);
      expect(dataRes.rows[0].val).toBe('hello');
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);
    }
  });

  it('3. second identical run is a clean no-op', async () => {
    const isolatedSchema = 'test_schema_noop';
    await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);

    try {
      const validDir = path.join(fixturesDir, 'valid');
      await runMigrations({ migrationsDir: validDir, schema: isolatedSchema, client });

      const secondRun = await runMigrations({ migrationsDir: validDir, schema: isolatedSchema, client });
      expect(secondRun.applied).toEqual([]);
      expect(secondRun.skipped).toEqual(['0001_create_temp_table.sql', '0002_insert_temp_data.sql']);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);
    }
  });

  it('4 & 5. rejects checksum drift without altering existing objects, timestamps, or ledger rows', async () => {
    const isolatedSchema = 'test_schema_drift';
    await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);

    try {
      const validDir = path.join(fixturesDir, 'valid');
      await runMigrations({ migrationsDir: validDir, schema: isolatedSchema, client });

      // Capture complete ledger row immediately before rejected run
      const initialRowRes = await client.query(
        `SELECT filename, sha256, applied_at FROM "${isolatedSchema}"."schema_migrations" WHERE filename = '0001_create_temp_table.sql';`
      );
      const initialRow = initialRowRes.rows[0];

      // Deliberately update isolated ledger checksum to simulate drift
      const fakeSha = '0000000000000000000000000000000000000000000000000000000000000000';
      await client.query(
        `UPDATE "${isolatedSchema}"."schema_migrations" SET sha256 = '${fakeSha}' WHERE filename = '0001_create_temp_table.sql';`
      );

      const driftedRowRes = await client.query(
        `SELECT filename, sha256, applied_at FROM "${isolatedSchema}"."schema_migrations" WHERE filename = '0001_create_temp_table.sql';`
      );
      const driftedRow = driftedRowRes.rows[0];

      // Assert migration engine rejects checksum drift
      await expect(runMigrations({ migrationsDir: validDir, schema: isolatedSchema, client })).rejects.toThrow(/Checksum drift detected/);

      // Query row after rejection and assert filename, sha256, and applied_at remain unchanged by rejected run
      const postRunRowRes = await client.query(
        `SELECT filename, sha256, applied_at FROM "${isolatedSchema}"."schema_migrations" WHERE filename = '0001_create_temp_table.sql';`
      );
      const postRunRow = postRunRowRes.rows[0];

      expect(postRunRow.filename).toBe(driftedRow.filename);
      expect(postRunRow.sha256).toBe(driftedRow.sha256);
      expect(new Date(postRunRow.applied_at).getTime()).toBe(new Date(driftedRow.applied_at).getTime());

      // Assert existing SQL object and data are unchanged
      const dataRes = await client.query(`SELECT * FROM "${isolatedSchema}"."temp_test_table_0001";`);
      expect(dataRes.rows.length).toBe(1);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);
    }
  });

  it('6 & 7. failing migration rolls back SQL effects and creates no ledger row for failed migration', async () => {
    const isolatedSchema = 'test_schema_fail';
    await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);

    try {
      const failingDir = path.join(fixturesDir, 'failing');

      await expect(runMigrations({ migrationsDir: failingDir, schema: isolatedSchema, client })).rejects.toThrow(/Migration '0002_bad.sql' failed/);

      const ledgerRes = await client.query(`SELECT filename FROM "${isolatedSchema}"."schema_migrations";`);
      expect(ledgerRes.rows.map((r) => r.filename)).toEqual(['0001_good.sql']);

      // Direct rollback assertion: object created by failed migration 0002_bad.sql (temp_fail_test_0002) MUST NOT exist
      const failedTableRes = await client.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = '${isolatedSchema}' AND tablename = 'temp_fail_test_0002';`
      );
      expect(failedTableRes.rows.length).toBe(0);

      // Previously successful migration 0001_good.sql remains applied and its table exists
      const goodTableRes = await client.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = '${isolatedSchema}' AND tablename = 'temp_fail_test';`
      );
      expect(goodTableRes.rows.length).toBe(1);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${isolatedSchema}" CASCADE;`);
    }
  });

  it('8. rejects invalid filenames before database interaction', async () => {
    const invalidDir = path.join(fixturesDir, 'invalid_filename');

    let queryCalled = false;
    const fakeClient = {
      query: async () => {
        queryCalled = true;
        throw new Error('Database query executed unexpectedly');
      }
    } as any;

    await expect(runMigrations({ migrationsDir: invalidDir, client: fakeClient })).rejects.toThrow(/Invalid migration filename format/);
    expect(queryCalled, 'No database query must be executed when filename is invalid').toBe(false);
  });

  it('9. rejects duplicate numeric prefixes before database interaction', async () => {
    const dupDir = path.join(fixturesDir, 'duplicate_prefix');

    let queryCalled = false;
    const fakeClient = {
      query: async () => {
        queryCalled = true;
        throw new Error('Database query executed unexpectedly');
      }
    } as any;

    await expect(runMigrations({ migrationsDir: dupDir, client: fakeClient })).rejects.toThrow(/Duplicate migration numeric prefix/);
    expect(queryCalled, 'No database query must be executed when duplicate numeric prefix exists').toBe(false);
  });

  it('10. canonical migration command uses db/migrations and loads canonical inventory', () => {
    const canonicalDir = path.resolve(__dirname, '../db/migrations');
    const canonicalFiles = fs.readdirSync(canonicalDir).filter((f) => f.endsWith('.sql')).sort();
    expect(canonicalFiles).toEqual([
      '0001_identity_and_tenancy.sql',
      '0002_property_identity_and_snapshots.sql',
      '0003_person_contacts_and_account_lifecycle.sql',
      '0004_current_catalog_and_price_snapshots.sql',
      '0005_catalog_administration_lifecycle.sql',
      '0006_orders_and_immutable_commercial_evidence.sql',
      '0007_property_hub_foundation.sql',
      '0008_scheduling_request_and_appointment_foundation.sql'
    ]);
  });

  it('11. verifies canonical test database contains ledger rows and domain tables', async () => {
    const devRes = await client.query('SELECT COUNT(*)::int AS cnt, MAX(filename) AS fname FROM medialab_meta.schema_migrations;');
    expect(devRes.rows[0].cnt).toBe(8);
    expect(devRes.rows[0].fname).toBe('0008_scheduling_request_and_appointment_foundation.sql');

    const tablesRes = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'medialab_core' ORDER BY tablename;"
    );
    const tables = tablesRes.rows.map(r => r.tablename);
    expect(tables).toContain('properties');
    expect(tables).toContain('property_snapshots');
    expect(tables).toContain('orders');
    expect(tables).toContain('order_items');
    expect(tables).toContain('property_hubs');
    expect(tables).toContain('property_hub_orders');
    expect(tables).toContain('scheduling_requests');
    expect(tables).toContain('appointments');
  });
});
