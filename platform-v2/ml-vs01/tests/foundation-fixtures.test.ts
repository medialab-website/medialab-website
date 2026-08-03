import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runSeed } from '../db/seed.js';
import { resetTestDatabase } from '../db/reset-test-database.js';
import {
  ORGANIZATION_FIXTURE,
  PEOPLE_FIXTURES,
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  PERMISSION_FIXTURES,
  PERMISSION_SET_FIXTURE,
  PERMISSION_SET_PERMISSION_FIXTURES,
  MEMBERSHIP_PERMISSION_SET_FIXTURES,
  DEVELOPMENT_SESSION_FIXTURE,
  EXPECTED_ROW_COUNTS,
  BASE_CREATED_AT,
  IDENTITY_VERIFIED_AT,
  MEMBERSHIP_ACTIVATED_AT,
  SESSION_ISSUED_AT,
  SESSION_EXPIRES_AT
} from '../db/fixtures/identity-tenancy-fixtures.js';

const TEST_DB = 'medialab_p02m03a_test';
const TEST_ROLE = 'medialab_p02m03a_test_owner';
const TEST_SOCKET = '/tmp/mlvs01-p02m03a-pg';
const TEST_PORT = 55432;

describe('P01C Foundation Fixtures & Seed Tests', () => {
  let client: pg.Client;

  beforeAll(async () => {
    // Reset test database to ensure clean unseeded state prior to fixture tests
    await resetTestDatabase({
      database: TEST_DB,
      confirm: TEST_DB,
      host: TEST_SOCKET,
      port: TEST_PORT,
      user: TEST_ROLE
    });

    // Delete seeded fixture rows so first seed test inserts them cleanly
    const cleanupClient = new pg.Client({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_ROLE
    });
    await cleanupClient.connect();
    await cleanupClient.query('TRUNCATE medialab_core.organizations CASCADE; TRUNCATE medialab_core.people CASCADE; TRUNCATE medialab_core.permissions CASCADE;');
    await cleanupClient.end();

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

  it('1. verifies all fixture constants match the exact packet specification', () => {
    expect(ORGANIZATION_FIXTURE.id).toBe('6d91cee6-91c1-52ea-937a-77c1ddc51c63');
    expect(ORGANIZATION_FIXTURE.name).toBe('MediaLab Foundation Fixture');

    expect(PEOPLE_FIXTURES).toHaveLength(3);
    expect(PEOPLE_FIXTURES[0].id).toBe('034a2b54-4665-5917-90a6-ae40adb3c8aa');
    expect(PEOPLE_FIXTURES[0].email).toBe('owner@fixture.medialab.invalid');
    expect(PEOPLE_FIXTURES[1].id).toBe('d43d9499-efbd-5116-b561-67dd34d1df8d');
    expect(PEOPLE_FIXTURES[1].email).toBe('operator@fixture.medialab.invalid');
    expect(PEOPLE_FIXTURES[2].id).toBe('8fea1876-a25f-5dec-9a1e-c17caf0e5de5');
    expect(PEOPLE_FIXTURES[2].email).toBe('pending@fixture.medialab.invalid');

    expect(IDENTITY_FIXTURES).toHaveLength(2);
    expect(IDENTITY_FIXTURES[0].id).toBe('e69ced56-a63e-57bf-a6b5-26d5fe6cc5c5');
    expect(IDENTITY_FIXTURES[0].provider_subject).toBe('fixture-owner');
    expect(IDENTITY_FIXTURES[1].id).toBe('87c0043a-334f-548c-95d7-d53939ab054b');
    expect(IDENTITY_FIXTURES[1].provider_subject).toBe('fixture-operator');

    expect(MEMBERSHIP_FIXTURES).toHaveLength(3);
    expect(MEMBERSHIP_FIXTURES[0].id).toBe('d614e5c7-9d65-54da-8e08-2562ae2f1f48');
    expect(MEMBERSHIP_FIXTURES[0].is_organization_admin).toBe(true);

    expect(PERMISSION_FIXTURES).toHaveLength(3);
    expect(PERMISSION_FIXTURES[0].code).toBe('fixture.members_view');
    expect(PERMISSION_FIXTURES[1].code).toBe('fixture.members_manage');
    expect(PERMISSION_FIXTURES[2].code).toBe('fixture.foundation_inspect');

    expect(PERMISSION_SET_FIXTURE.id).toBe('a2f7dc02-5f3b-5763-aa57-eeb3474b1af4');
    expect(PERMISSION_SET_PERMISSION_FIXTURES).toHaveLength(3);
    expect(MEMBERSHIP_PERMISSION_SET_FIXTURES).toHaveLength(1);

    expect(DEVELOPMENT_SESSION_FIXTURE.id).toBe('ffb854e8-572f-5597-877a-1c6dbe8d6e00');
    expect(DEVELOPMENT_SESSION_FIXTURE.token_sha256).toBe('83d0260db72ad3bdecf848d45eca989ea869361b15545596286734a6c79a2668');

    expect(EXPECTED_ROW_COUNTS.organizations).toBe(1);
    expect(EXPECTED_ROW_COUNTS.people).toBe(3);
    expect(EXPECTED_ROW_COUNTS.identities).toBe(2);
    expect(EXPECTED_ROW_COUNTS.memberships).toBe(3);
    expect(EXPECTED_ROW_COUNTS.permissions).toBe(3);
    expect(EXPECTED_ROW_COUNTS.permission_sets).toBe(1);
    expect(EXPECTED_ROW_COUNTS.permission_set_permissions).toBe(3);
    expect(EXPECTED_ROW_COUNTS.membership_permission_sets).toBe(1);
    expect(EXPECTED_ROW_COUNTS.development_sessions).toBe(1);
  });

  it('2. seed inserts fixture rows and second seed is an idempotent no-op', async () => {
    // Run first seed
    const firstRes = await runSeed({
      database: TEST_DB,
      user: TEST_ROLE,
      host: TEST_SOCKET,
      port: TEST_PORT
    });

    expect(firstRes.inserted).toBeGreaterThan(0);

    // Run second seed (reseed)
    const secondRes = await runSeed({
      database: TEST_DB,
      user: TEST_ROLE,
      host: TEST_SOCKET,
      port: TEST_PORT
    });

    expect(secondRes.inserted).toBe(0);
    expect(secondRes.verified).toBe(207); // Foundation, synthetic packet evidence, and canonical current catalog.
  });

  it('3. seed rejects unapproved databases and unapproved hosts', async () => {
    await expect(
      runSeed({
        database: 'unapproved_db_target',
        user: TEST_ROLE,
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/SEED_SAFETY_FAILURE/);

    await expect(
      runSeed({
        database: TEST_DB,
        user: TEST_ROLE,
        host: '127.0.0.1',
        port: TEST_PORT
      })
    ).rejects.toThrow(/SEED_SAFETY_FAILURE/);
  });

  it('4. seed fails and rolls back when a fixture record is deliberately divergent', async () => {
    // Mutate a fixture row in database to create divergence
    await client.query(
      "UPDATE medialab_core.people SET display_name = 'DIVERGENT_NAME' WHERE id = '034a2b54-4665-5917-90a6-ae40adb3c8aa';"
    );

    await expect(
      runSeed({
        database: TEST_DB,
        user: TEST_ROLE,
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/FIXTURE_DIVERGENCE/);

    // Revert display name for clean state
    await client.query(
      "UPDATE medialab_core.people SET display_name = 'Foundation Owner' WHERE id = '034a2b54-4665-5917-90a6-ae40adb3c8aa';"
    );
  });

  it('5. seed preserves non-fixture rows without deleting or mutating them', async () => {
    const customPersonId = '11111111-2222-3333-4444-555555555555';
    await client.query(
      `INSERT INTO medialab_core.people (id, display_name, email, title)
       VALUES ($1, 'Non-Fixture Custom Person', 'custom@test.medialab.invalid', 'Custom');`,
      [customPersonId]
    );

    // Run seed
    const seedRes = await runSeed({
      database: TEST_DB,
      user: TEST_ROLE,
      host: TEST_SOCKET,
      port: TEST_PORT
    });

    expect(seedRes.inserted).toBe(0);

    // Check non-fixture person still exists
    const checkRes = await client.query('SELECT * FROM medialab_core.people WHERE id = $1;', [customPersonId]);
    expect(checkRes.rows).toHaveLength(1);
    expect(checkRes.rows[0].display_name).toBe('Non-Fixture Custom Person');

    // Person and contact history are permanent; clean the disposable database through its bounded reset tool.
    await resetTestDatabase({
      database: TEST_DB,
      confirm: TEST_DB,
      host: TEST_SOCKET,
      port: TEST_PORT,
      user: TEST_ROLE
    });
  });
});
