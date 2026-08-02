import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { EXPECTED_ROW_COUNTS } from '../db/fixtures/identity-tenancy-fixtures.js';

const TEST_DB = 'medialab_vs01_repair_p01a_test';
const TEST_ROLE = 'medialab_vs01_repair_p01a_test';
const TEST_SOCKET = '/tmp/mlvs01-pg';
const TEST_PORT = 55432;

describe('P01C Test Database Reset Tooling Tests', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_ROLE
    });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  it('1. reset refuses development database targets under any flag/alias', async () => {
    await expect(
      resetTestDatabase({
        database: 'medialab_vs01_repair_p01a',
        confirm: 'medialab_vs01_repair_p01a',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('2. reset refuses missing or incorrect confirmation values', async () => {
    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: '',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);

    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: 'WRONG_CONFIRMATION',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('3. reset refuses TCP or external host connection targets', async () => {
    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: TEST_DB,
        host: '127.0.0.1',
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('4. reset removes deliberate disposable drift and reconstructs exact schema and fixtures', async () => {
    // Introduce deliberate disposable drift: create a dummy table in medialab_core
    await client.query('CREATE TABLE medialab_core.__disposable_test_drift (id int PRIMARY KEY);');
    const checkDriftBefore = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'medialab_core' AND table_name = '__disposable_test_drift';"
    );
    expect(checkDriftBefore.rows).toHaveLength(1);

    // Execute reset
    await resetTestDatabase({
      database: TEST_DB,
      confirm: TEST_DB,
      host: TEST_SOCKET,
      port: TEST_PORT,
      user: TEST_ROLE
    });

    // Verify disposable drift table is completely gone
    const checkDriftAfter = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'medialab_core' AND table_name = '__disposable_test_drift';"
    );
    expect(checkDriftAfter.rows).toHaveLength(0);

    // Verify single canonical migration ledger
    const ledgerRes = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations;');
    expect(ledgerRes.rows).toHaveLength(1);
    expect(ledgerRes.rows[0].filename).toBe('0001_identity_and_tenancy.sql');
    expect(ledgerRes.rows[0].sha256).toBe('29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31');

    // Verify row counts for all 9 domain tables
    for (const [table, expectedCount] of Object.entries(EXPECTED_ROW_COUNTS)) {
      const countRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM medialab_core.${table};`);
      expect(countRes.rows[0].cnt).toBe(expectedCount);
    }

    // Verify no extra views, sequences, routines, or triggers exist
    const viewsRes = await client.query(
      "SELECT table_name FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(viewsRes.rows).toHaveLength(0);

    const seqRes = await client.query(
      "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(seqRes.rows).toHaveLength(0);

    const routRes = await client.query(
      "SELECT routine_name FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(routRes.rows).toHaveLength(0);

    const trigRes = await client.query(
      "SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(trigRes.rows).toHaveLength(0);
  });
});
