import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import pkg from 'pg';
const { Pool } = pkg;
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

describe('M02 Identity and Tenancy Schema', () => {
  const poolTest = new Pool({
    host: '/tmp/mlvs01-pg',
    port: 55432,
    database: 'medialab_vs01_repair_p01a_test',
    user: 'medialab_vs01_repair_p01a_test'
  });

  const poolDev = new Pool({
    host: '/tmp/mlvs01-pg',
    port: 55432,
    database: 'medialab_vs01_repair_p01a',
    user: 'medialab_vs01_repair_p01a_app'
  });

  beforeAll(async () => {
    // Let the tests run without clearing DB initially
  });

  afterAll(async () => {
    await poolTest.end();
    await poolDev.end();
  });

  it('1. Canonical migration scripts are path-independent and both databases are clean no-ops', async () => {
    const cwd = path.resolve(__dirname, '..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));

    expect(packageJson.scripts['migrate:dev']).toBe('tsx db/migrate.ts');
    expect(packageJson.scripts['migrate:test']).toBe('tsx db/migrate.ts --test');

    const migrationsDir = path.join(cwd, 'db/migrations');

    const outDev = await runMigrations({
      migrationsDir,
      database: 'medialab_vs01_repair_p01a',
      user: 'medialab_vs01_repair_p01a_app'
    });
    const outTest = await runMigrations({
      migrationsDir,
      database: 'medialab_vs01_repair_p01a_test',
      user: 'medialab_vs01_repair_p01a_test'
    });

    expect(outDev.applied).toEqual([]);
    expect(outDev.skipped).toEqual(['0001_identity_and_tenancy.sql', '0002_property_identity_and_snapshots.sql']);

    expect(outTest.applied).toEqual([]);
    expect(outTest.skipped).toEqual(['0001_identity_and_tenancy.sql', '0002_property_identity_and_snapshots.sql']);
  });

  const exactTableNames = [
    'development_sessions',
    'identities',
    'membership_permission_sets',
    'memberships',
    'organizations',
    'people',
    'permission_set_permissions',
    'permission_sets',
    'permissions'
  ].sort();

  for (const [env, pool] of Object.entries({ test: poolTest, dev: poolDev })) {
    describe(`Catalog Assertions (${env})`, () => {
      it('2. Exact medialab_core schema and owner', async () => {
        const resSchema = await pool.query(`
          SELECT nspname, pg_get_userbyid(nspowner) as owner 
          FROM pg_namespace WHERE nspname = 'medialab_core'
        `);
        expect(resSchema.rows).toHaveLength(1);
        const expectedOwner = env === 'test' ? 'medialab_vs01_repair_p01a_test' : 'medialab_vs01_repair_p01a_app';
        expect(resSchema.rows[0].owner).toBe(expectedOwner);
      });

      it('3. Original nine identity/tenancy table names and owners remain present', async () => {
        const resTables = await pool.query(`
          SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'medialab_core' ORDER BY tablename
        `);
        const tables = resTables.rows.map(r => r.tablename);
        for (const table of exactTableNames) {
          expect(tables).toContain(table);
        }

        const expectedOwner = env === 'test' ? 'medialab_vs01_repair_p01a_test' : 'medialab_vs01_repair_p01a_app';
        for (const row of resTables.rows) {
          expect(row.tableowner).toBe(expectedOwner);
        }
      });

      it('4. Exact allowed non-table object inventory', async () => {
        const resViews = await pool.query(`SELECT viewname FROM pg_views WHERE schemaname = 'medialab_core'`);
        expect(resViews.rows).toHaveLength(0);
        
        const resMatViews = await pool.query(`SELECT matviewname FROM pg_matviews WHERE schemaname = 'medialab_core'`);
        expect(resMatViews.rows).toHaveLength(0);

        const resSeqs = await pool.query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'medialab_core'`);
        expect(resSeqs.rows).toHaveLength(0);

        const resRoutines = await pool.query(`
          SELECT routine_name, routine_type
          FROM information_schema.routines
          WHERE routine_schema = 'medialab_core'
          ORDER BY routine_name
        `);
        expect(resRoutines.rows).toEqual([
          {
            routine_name: 'reject_property_snapshot_mutation',
            routine_type: 'FUNCTION'
          }
        ]);

        const resTriggers = await pool.query(`
          SELECT
            t.tgname AS trigger_name,
            c.relname AS table_name,
            p.proname AS function_name
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE NOT t.tgisinternal
            AND n.nspname = 'medialab_core'
          ORDER BY c.relname, t.tgname
        `);
        expect(resTriggers.rows).toEqual([
          {
            trigger_name: 'property_snapshots_immutability_guard',
            table_name: 'property_snapshots',
            function_name: 'reject_property_snapshot_mutation'
          }
        ]);
      });

      it('5. Exact column definitions', async () => {
        const resCols = await pool.query(`
          SELECT table_name, column_name, data_type, column_default, is_nullable
          FROM information_schema.columns 
          WHERE table_schema = 'medialab_core'
        `);
        
        const cols = resCols.rows;
        
        // Build expected columns map based on schema explicitly
        const expectedMap = {
          'people': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'display_name', type: 'text', nullable: 'NO', def: null },
            { col: 'email', type: 'text', nullable: 'NO', def: null },
            { col: 'title', type: 'text', nullable: 'YES', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'identities': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'person_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'provider', type: 'text', nullable: 'NO', def: null },
            { col: 'provider_subject', type: 'text', nullable: 'NO', def: null },
            { col: 'status', type: 'text', nullable: 'NO', def: "'ACTIVE'::text" },
            { col: 'email_verified_at', type: 'timestamp with time zone', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'organizations': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'name', type: 'text', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'memberships': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'organization_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'person_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'is_organization_admin', type: 'boolean', nullable: 'NO', def: 'false' },
            { col: 'status', type: 'text', nullable: 'NO', def: null },
            { col: 'activated_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'suspended_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'suspension_reason', type: 'text', nullable: 'YES', def: null },
            { col: 'removed_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'permissions': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'code', type: 'text', nullable: 'NO', def: null },
            { col: 'description', type: 'text', nullable: 'NO', def: null },
            { col: 'is_active', type: 'boolean', nullable: 'NO', def: 'true' },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'permission_sets': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'organization_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'name', type: 'text', nullable: 'NO', def: null },
            { col: 'is_member_specific', type: 'boolean', nullable: 'NO', def: 'false' },
            { col: 'retired_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'permission_set_permissions': [
            { col: 'permission_set_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'permission_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'membership_permission_sets': [
            { col: 'organization_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'membership_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'permission_set_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'development_sessions': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'identity_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'token_sha256', type: 'text', nullable: 'NO', def: null },
            { col: 'issued_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'expires_at', type: 'timestamp with time zone', nullable: 'NO', def: null },
            { col: 'revoked_at', type: 'timestamp with time zone', nullable: 'YES', def: null }
          ]
        };

        for (const [tableName, expectedCols] of Object.entries(expectedMap)) {
          const actualCols = cols.filter(c => c.table_name === tableName);
          expect(actualCols).toHaveLength(expectedCols.length);
          for (const expected of expectedCols) {
            const actual = actualCols.find(c => c.column_name === expected.col);
            expect(actual).toBeDefined();
            expect(actual!.data_type).toBe(expected.type);
            expect(actual!.is_nullable).toBe(expected.nullable);
            if (expected.def) {
              expect(actual!.column_default).toBe(expected.def);
            } else {
              expect(actual!.column_default).toBeNull();
            }
          }
        }
      });

      it('6. Primary keys, unique, checks, foreign keys', async () => {
        const resConstraints = await pool.query(`
          SELECT tc.table_name, tc.constraint_name, tc.constraint_type
          FROM information_schema.table_constraints tc
          WHERE tc.table_schema = 'medialab_core'
        `);
        const constraints = resConstraints.rows;
        
        // Every table must have a primary key
        for (const tableName of exactTableNames) {
          const hasPk = constraints.some(c => c.table_name === tableName && c.constraint_type === 'PRIMARY KEY');
          expect(hasPk).toBeTruthy();
        }

        // Checks explicitly
        const checks = constraints.filter(c => c.constraint_type === 'CHECK');
        expect(checks.length).toBeGreaterThan(0);

        const resFks = await pool.query(`
          SELECT tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table_name, ccu.column_name AS referenced_column_name, rc.update_rule, rc.delete_rule 
          FROM information_schema.referential_constraints rc
          JOIN information_schema.table_constraints tc ON rc.constraint_name = tc.constraint_name
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
          JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name
          WHERE tc.table_schema = 'medialab_core'
        `);
        expect(resFks.rows.length).toBeGreaterThan(0);
        for (const fk of resFks.rows) {
          expect(fk.delete_rule).toBe('RESTRICT');
        }
      });

      it('7. Privilege Assertions', async () => {
        // Assume using a standard low privilege app user for the dev db assertions
        // The dev db should have specific app roles. 
        // We will assert PUBLIC role privileges as requested.
        const resPrivs = await pool.query(`
          SELECT has_schema_privilege('public', 'medialab_core', 'USAGE') as usg,
                 has_schema_privilege('public', 'medialab_core', 'CREATE') as crt
        `);
        expect(resPrivs.rows[0].usg).toBe(false);
        expect(resPrivs.rows[0].crt).toBe(false);

        const checkPrivs = async (priv: string) => {
          for (const table of exactTableNames) {
            const p = await pool.query(`SELECT has_table_privilege('public', 'medialab_core.${table}', $1) as sel`, [priv]);
            if (p.rows[0].sel !== false) {
               throw new Error(`Table ${table} has PUBLIC ${priv} = true`);
            }
          }
        };

        await checkPrivs('SELECT');
        await checkPrivs('INSERT');
        await checkPrivs('UPDATE');
        await checkPrivs('DELETE');
        await checkPrivs('TRUNCATE');
        await checkPrivs('REFERENCES');
        await checkPrivs('TRIGGER');
        await checkPrivs('MAINTAIN');
      });
    });
  }

  describe('Domain Rules via Transactions', () => {
    let client: pkg.PoolClient;
    beforeAll(async () => {
      client = await poolTest.connect();
    });
    afterAll(() => {
      client.release();
    });

    async function expectDbError(sql: string, params: any[] = []) {
      await client.query('SAVEPOINT sp_test');
      await expect(client.query(sql, params)).rejects.toThrow();
      await client.query('ROLLBACK TO sp_test');
    }

    // Helper to wrap transactions safely
    async function runInTransaction(fn: () => Promise<void>) {
      await client.query('BEGIN');
      try {
        await fn();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('8. People domain constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        // person insertion without an identity succeeds;
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'Test', 'test@test.com')`, [pId]);
        
        const errId = crypto.randomUUID();
        // uppercase email is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'Test@test.com')`, [errId]);
        // leading/trailing whitespace email is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', ' test@test.com ')`, [errId]);
        // missing @ is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'testtest.com')`, [errId]);
        // multiple @ characters are rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't@@test.com')`, [errId]);
        // empty local part is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', '@test.com')`, [errId]);
        // empty domain part is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'test@')`, [errId]);
        // duplicate email is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'test@test.com')`, [errId]);
        // invalid display-name trimming, emptiness, and length are rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, ' T ', 't2@t.com')`, [errId]);
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, '', 't2@t.com')`, [errId]);
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, '${'a'.repeat(201)}', 't2@t.com')`, [errId]);
        // invalid title length is rejected
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email, title) VALUES ($1, 'T', 't3@t.com', '${'a'.repeat(201)}')`, [errId]);
        // updated_at < created_at is rejected.
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email, created_at, updated_at) VALUES ($1, 'T', 't2@t.com', now() + interval '1 hour', now())`, [errId]);
      });
    });

    it('9. Identities constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        const pId2 = crypto.randomUUID();
        const iId1 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com'), ($2, 'T2', 't2@t.com')`, [pId, pId2]);

        await client.query(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub1', now())`, [iId1, pId]);
        
        const errId = crypto.randomUUID();
        // duplicate (provider, provider_subject) is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub1', now())`, [errId, pId2]);
        // duplicate (person_id, provider) is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub2', now())`, [errId, pId]);
        // invalid provider is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'BAD', 'sub', now())`, [errId, pId2]);
        // invalid status is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, status, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub', 'BAD', now())`, [errId, pId2]);
        // empty, padded, and oversized provider subject is rejected.
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', '', now())`, [errId, pId2]);
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', ' sub ', now())`, [errId, pId2]);
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', '${'a'.repeat(300)}', now())`, [errId, pId2]);
      });
    });

    it('10. Organizations and permission sets constraints', async () => {
      await runInTransaction(async () => {
        const orgId1 = crypto.randomUUID();
        const orgId2 = crypto.randomUUID();
        
        // invalid organization name rules are rejected;
        await expectDbError(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, '')`, [orgId1]);
        await expectDbError(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, ' ')`, [orgId1]);
        await expectDbError(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, '${'a'.repeat(201)}')`, [orgId1]);
        
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org 1'), ($2, 'Org 2')`, [orgId1, orgId2]);

        const psId1 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [psId1, orgId1]);

        // duplicate permission-set name within one organization is rejected;
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [crypto.randomUUID(), orgId1]);
        // the same name in different organizations succeeds;
        await client.query(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [crypto.randomUUID(), orgId2]);
        // invalid permission-set name rules are rejected;
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, '')`, [crypto.randomUUID(), orgId1]);
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, ' ')`, [crypto.randomUUID(), orgId1]);
        // updated_at < created_at is rejected.
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name, created_at, updated_at) VALUES ($1, $2, 'Set x', now() + interval '1 day', now())`, [crypto.randomUUID(), orgId1]);
      });
    });

    it('11. Memberships constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        const oId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com')`, [pId]);
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'O')`, [oId]);

        const mId = crypto.randomUUID();
        
        // pending with any activation/suspension/removal value is rejected;
        await expectDbError(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status, activated_at) VALUES ($1, $2, $3, 'PENDING_ACTIVATION', now())`, [mId, oId, pId]);
        
        await client.query(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [mId, oId, pId]);

        // active without activation is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'ACTIVE' WHERE id = $1`, [mId]);
        // active with suspension data is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'ACTIVE', activated_at = now(), suspended_at = now(), suspension_reason = 'r' WHERE id = $1`, [mId]);
        // active with removal timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'ACTIVE', activated_at = now(), removed_at = now() WHERE id = $1`, [mId]);
        
        await client.query(`UPDATE medialab_core.memberships SET status = 'ACTIVE', activated_at = now() WHERE id = $1`, [mId]);

        // suspended without activation is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = 'r', activated_at = NULL WHERE id = $1`, [mId]);
        // suspended without suspension timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspension_reason = 'r' WHERE id = $1`, [mId]);
        // suspended without reason is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = NULL WHERE id = $1`, [mId]);
        // suspended with removal timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = 'r', removed_at = now() WHERE id = $1`, [mId]);
        // invalid suspension-reason trimming, emptiness, and length are rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = ' ' WHERE id = $1`, [mId]);

        await client.query(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = 'r' WHERE id = $1`, [mId]);

        // removed without removal timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'REMOVED', removed_at = NULL WHERE id = $1`, [mId]);
        
        await client.query(`UPDATE medialab_core.memberships SET status = 'REMOVED', removed_at = now() WHERE id = $1`, [mId]);

        // invalid status is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'BAD' WHERE id = $1`, [mId]);

        // duplicate organization/person membership is rejected;
        await expectDbError(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [crypto.randomUUID(), oId, pId]);

        // updated_at < created_at is rejected.
        await expectDbError(`UPDATE medialab_core.memberships SET updated_at = created_at - interval '1 hour' WHERE id = $1`, [mId]);
      });
    });

    it('12. Permissions and links constraints', async () => {
      await runInTransaction(async () => {
        const permId1 = crypto.randomUUID();
        // valid permission code succeeds;
        await client.query(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a.b', 'Desc')`, [permId1]);
        // uppercase code is rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'A.b', 'Desc')`, [crypto.randomUUID()]);
        // code without a dot is rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a', 'Desc')`, [crypto.randomUUID()]);
        // invalid segment forms are rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a..b', 'Desc')`, [crypto.randomUUID()]);
        // invalid description trimming, emptiness, and length are rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'c.d', ' ')`, [crypto.randomUUID()]);
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'c.d', '${'a'.repeat(501)}')`, [crypto.randomUUID()]);
        // duplicate permission code is rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a.b', 'Desc 2')`, [crypto.randomUUID()]);

        const orgId = crypto.randomUUID();
        const pId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'O')`, [orgId]);
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com')`, [pId]);
        
        const psId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [psId, orgId]);

        // permission_set_permissions link
        await client.query(`INSERT INTO medialab_core.permission_set_permissions (permission_set_id, permission_id) VALUES ($1, $2)`, [psId, permId1]);
        // duplicate permission-set/permission link is rejected;
        await expectDbError(`INSERT INTO medialab_core.permission_set_permissions (permission_set_id, permission_id) VALUES ($1, $2)`, [psId, permId1]);

        const mId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [mId, orgId, pId]);

        const orgId2 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'O2')`, [orgId2]);
        const mId2 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [mId2, orgId2, pId]);

        // matching-organization assignment succeeds.
        await client.query(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId, mId, psId]);
        
        // duplicate membership/permission-set link is rejected;
        await expectDbError(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId, mId, psId]);

        // cross-organization assignment is rejected by the composite foreign keys;
        await expectDbError(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId, mId2, psId]);
        await expectDbError(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId2, mId, psId]);
      });
    });

    it('13. Development sessions constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        const iId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com')`, [pId]);
        await client.query(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub', now())`, [iId, pId]);

        const sId = crypto.randomUUID();
        const validHash = 'a'.repeat(64);
        // valid session succeeds;
        await client.query(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [sId, iId, validHash]);

        const errId = crypto.randomUUID();
        // short hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, 'a'.repeat(63)]);
        // uppercase hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, 'A'.repeat(64)]);
        // non-hex hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, 'g'.repeat(64)]);
        // duplicate hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, validHash]);
        // expires_at = issued_at is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now())`, [errId, iId, 'b'.repeat(64)]);
        // expires_at < issued_at is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() - interval '1 hour')`, [errId, iId, 'b'.repeat(64)]);
        // revoked_at < issued_at is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at, revoked_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour', now() - interval '1 hour')`, [errId, iId, 'b'.repeat(64)]);
        // valid revoked timestamp succeeds.
        await client.query(`UPDATE medialab_core.development_sessions SET revoked_at = now() WHERE id = $1`, [sId]);
      });
    });

  });

  it('14. Domain table row count assertions in both databases', async () => {
    const expectedCounts: Record<string, number> = {
      organizations: 1,
      people: 3,
      identities: 2,
      memberships: 3,
      permissions: 3,
      permission_sets: 1,
      permission_set_permissions: 3,
      membership_permission_sets: 1,
      development_sessions: 1
    };

    for (const [env, pool] of Object.entries({ test: poolTest, dev: poolDev })) {
      for (const table of exactTableNames) {
        const res = await pool.query(`SELECT count(*)::int as count FROM medialab_core.${table}`);
        const cnt = res.rows[0].count;
        const exp = expectedCounts[table] || 0;
        expect(cnt, `Table ${table} in ${env} has ${cnt} rows, expected exact ${exp}`).toBe(exp);
      }
    }
  });
});
