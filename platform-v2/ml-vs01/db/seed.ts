import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  ORGANIZATION_FIXTURE,
  PEOPLE_FIXTURES,
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  PERMISSION_FIXTURES,
  PERMISSION_SET_FIXTURE,
  PERMISSION_SET_PERMISSION_FIXTURES,
  MEMBERSHIP_PERMISSION_SET_FIXTURES,
  DEVELOPMENT_SESSION_FIXTURE
} from './fixtures/identity-tenancy-fixtures.js';
import { CATALOG_FIXTURE_TABLES } from './fixtures/current-catalog-price-fixtures.js';
import { CURRENT_REAL_ESTATE_CATALOG_TABLES } from './fixtures/current-real-estate-catalog-seed.js';
import { ORDER_FOUNDATION_FIXTURE_TABLES } from './fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_FOUNDATION_FIXTURE_TABLES } from './fixtures/property-hub-foundation-fixtures.js';
import { SCHEDULING_APPOINTMENT_FOUNDATION_FIXTURE_TABLES } from './fixtures/scheduling-appointment-foundation-fixtures.js';
import { JOB_SERVICE_WORKSTREAM_FOUNDATION_FIXTURE_TABLES } from './fixtures/job-service-workstream-foundation-fixtures.js';
import { MISSION_PLAN_FOUNDATION_FIXTURE_TABLES } from './fixtures/mission-plan-foundation-fixtures.js';
import { MEDIA_ASSET_FOUNDATION_FIXTURE_TABLES } from './fixtures/media-asset-identity-lineage-fixtures.js';
import { MEDIA_OPERATION_FOUNDATION_FIXTURE_TABLES } from './fixtures/durable-media-operations-reconciliation-fixtures.js';
import { MEDIA_CAPTURE_FOUNDATION_FIXTURE_TABLES } from './fixtures/capture-session-ingest-custody-fixtures.js';
import { MEDIA_CULL_FOUNDATION_FIXTURE_TABLES } from './fixtures/media-cull-workspace-selected-media-fixtures.js';

export interface SeedOptions {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  client?: pg.Client;
}

export interface SeedResult {
  inserted: number;
  verified: number;
}

const APPROVED_DATABASES = ['medialab_p02m11a_test'];

export async function runSeed(options: SeedOptions = {}): Promise<SeedResult> {
  const host = options.host || process.env.PGHOST || '/tmp/mlvs01-p02m11a-pg';
  const port = options.port || (process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 55441);
  const database = options.database || process.env.PGDATABASE || 'medialab_p02m11a_test';
  const user = options.user || process.env.PGUSER || 'medialab_p02m11a_test_owner';

  // Guard 1: Database name restriction
  if (!APPROVED_DATABASES.includes(database)) {
    throw new Error(`SEED_SAFETY_FAILURE: Unapproved database target '${database}'. Allowed: ${APPROVED_DATABASES.join(', ')}`);
  }

  // Guard 2: Exact packet socket restriction, with no TCP or predecessor-cluster fallback
  if (host !== '/tmp/mlvs01-p02m11a-pg') {
    throw new Error(`SEED_SAFETY_FAILURE: Unapproved connection host '${host}'. Seed must use Unix socket '/tmp/mlvs01-p02m11a-pg'.`);
  }

  if (port !== 55441) {
    throw new Error(`SEED_SAFETY_FAILURE: Unapproved port ${port}. Must be 55441.`);
  }

  // Guard 3: User role validation
  const expectedUser = 'medialab_p02m11a_test_owner';
  if (user !== expectedUser) {
    throw new Error(`SEED_SAFETY_FAILURE: Role mismatch for database '${database}'. Expected role '${expectedUser}', got '${user}'.`);
  }

  let client = options.client;
  let ownClient = false;

  if (!client) {
    ownClient = true;
    client = new pg.Client({
      host,
      port,
      database,
      user,
      password: options.password
    });
    await client.connect();
  }

  let inserted = 0;
  let verified = 0;

  try {
    await client.query('BEGIN;');
    await client.query('SET LOCAL search_path = medialab_core, public;');

    // Helper to compare dates / nulls / primitives safely
    const isValueEqual = (actual: any, expected: any): boolean => {
      if (expected === null || expected === undefined) {
        return actual === null || actual === undefined;
      }
      if (actual instanceof Date) {
        if (typeof expected === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expected)) {
          return actual.toISOString().slice(0, 10) === expected;
        }
        return actual.toISOString() === new Date(expected).toISOString();
      }
      if (typeof actual === 'boolean') {
        return Boolean(actual) === Boolean(expected);
      }
      return String(actual) === String(expected);
    };

    const ensureFixtureRow = async (
      table: string,
      keys: readonly string[],
      row: Record<string, unknown>,
      countVerified = true
    ): Promise<void> => {
      const identifiers = [table, ...keys, ...Object.keys(row)];
      if (identifiers.some((identifier) => !/^[a-z_][a-z0-9_]*$/.test(identifier))) {
        throw new Error(`FIXTURE_CONFIGURATION_FAILURE: Unsafe fixture identifier for table '${table}'.`);
      }

      const where = keys.map((key, index) => `"${key}" = $${index + 1}`).join(' AND ');
      const keyValues = keys.map((key) => row[key]);
      const existing = await client!.query(
        `SELECT * FROM medialab_core."${table}" WHERE ${where};`,
        keyValues
      );

      if (existing.rows.length === 0) {
        const columns = Object.keys(row);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        await client!.query(
          `INSERT INTO medialab_core."${table}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${placeholders});`,
          columns.map((column) => row[column])
        );
        inserted++;
        return;
      }

      const actual = existing.rows[0];
      for (const [column, expected] of Object.entries(row)) {
        if (!isValueEqual(actual[column], expected)) {
          throw new Error(
            `FIXTURE_DIVERGENCE: Table '${table}' column '${column}' differs for key ${JSON.stringify(keyValues)}.`
          );
        }
      }
      if (countVerified) verified++;
    };

    // 1. Organizations
    {
      const org = ORGANIZATION_FIXTURE;
      const res = await client.query('SELECT * FROM medialab_core.organizations WHERE id = $1;', [org.id]);
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.organizations (id, name, created_at, updated_at)
           VALUES ($1, $2, $3, $4);`,
          [org.id, org.name, org.created_at, org.updated_at]
        );
        inserted++;
      } else {
        const row = res.rows[0];
        if (!isValueEqual(row.name, org.name)) {
          throw new Error(`FIXTURE_DIVERGENCE: Organization '${org.id}' name divergence. Expected '${org.name}', found '${row.name}'.`);
        }
        verified++;
      }
    }

    // 2. People
    for (const person of PEOPLE_FIXTURES) {
      const res = await client.query('SELECT * FROM medialab_core.people WHERE id = $1;', [person.id]);
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.people (id, display_name, email, title, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6);`,
          [person.id, person.display_name, person.email, person.title, person.created_at, person.updated_at]
        );
        inserted++;
      } else {
        const row = res.rows[0];
        if (
          !isValueEqual(row.display_name, person.display_name) ||
          !isValueEqual(row.email, person.email) ||
          !isValueEqual(row.title, person.title)
        ) {
          throw new Error(`FIXTURE_DIVERGENCE: Person '${person.id}' field divergence. Expected ${JSON.stringify(person)}, found ${JSON.stringify(row)}.`);
        }
        verified++;
      }
    }

    // 3. Identities
    for (const identity of IDENTITY_FIXTURES) {
      const res = await client.query('SELECT * FROM medialab_core.identities WHERE id = $1;', [identity.id]);
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, status, email_verified_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [identity.id, identity.person_id, identity.provider, identity.provider_subject, identity.status, identity.email_verified_at, identity.created_at]
        );
        inserted++;
      } else {
        const row = res.rows[0];
        if (
          !isValueEqual(row.person_id, identity.person_id) ||
          !isValueEqual(row.provider, identity.provider) ||
          !isValueEqual(row.provider_subject, identity.provider_subject) ||
          !isValueEqual(row.status, identity.status)
        ) {
          throw new Error(`FIXTURE_DIVERGENCE: Identity '${identity.id}' field divergence.`);
        }
        verified++;
      }
    }

    // 4. Memberships
    for (const mem of MEMBERSHIP_FIXTURES) {
      const res = await client.query('SELECT * FROM medialab_core.memberships WHERE id = $1;', [mem.id]);
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.memberships (id, organization_id, person_id, status, is_organization_admin, activated_at, suspended_at, suspension_reason, removed_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
          [mem.id, mem.organization_id, mem.person_id, mem.status, mem.is_organization_admin, mem.activated_at, mem.suspended_at, mem.suspension_reason, mem.removed_at, mem.created_at, mem.updated_at]
        );
        inserted++;
      } else {
        const row = res.rows[0];
        if (
          !isValueEqual(row.organization_id, mem.organization_id) ||
          !isValueEqual(row.person_id, mem.person_id) ||
          !isValueEqual(row.status, mem.status) ||
          !isValueEqual(row.is_organization_admin, mem.is_organization_admin)
        ) {
          throw new Error(`FIXTURE_DIVERGENCE: Membership '${mem.id}' field divergence.`);
        }
        verified++;
      }
    }

    // 5. Permissions
    for (const perm of PERMISSION_FIXTURES) {
      const res = await client.query('SELECT * FROM medialab_core.permissions WHERE id = $1;', [perm.id]);
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.permissions (id, code, description, is_active, created_at)
           VALUES ($1, $2, $3, $4, $5);`,
          [perm.id, perm.code, perm.description, perm.is_active, perm.created_at]
        );
        inserted++;
      } else {
        const row = res.rows[0];
        if (
          !isValueEqual(row.code, perm.code) ||
          !isValueEqual(row.description, perm.description) ||
          !isValueEqual(row.is_active, perm.is_active)
        ) {
          throw new Error(`FIXTURE_DIVERGENCE: Permission '${perm.id}' field divergence.`);
        }
        verified++;
      }
    }

    // 6. Permission Set
    {
      const set = PERMISSION_SET_FIXTURE;
      const res = await client.query('SELECT * FROM medialab_core.permission_sets WHERE id = $1;', [set.id]);
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.permission_sets (id, organization_id, name, is_member_specific, retired_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [set.id, set.organization_id, set.name, set.is_member_specific, set.retired_at, set.created_at, set.updated_at]
        );
        inserted++;
      } else {
        const row = res.rows[0];
        if (
          !isValueEqual(row.organization_id, set.organization_id) ||
          !isValueEqual(row.name, set.name) ||
          !isValueEqual(row.is_member_specific, set.is_member_specific)
        ) {
          throw new Error(`FIXTURE_DIVERGENCE: Permission set '${set.id}' field divergence.`);
        }
        verified++;
      }
    }

    // 7. Permission Set Permissions
    for (const link of PERMISSION_SET_PERMISSION_FIXTURES) {
      const res = await client.query(
        'SELECT * FROM medialab_core.permission_set_permissions WHERE permission_set_id = $1 AND permission_id = $2;',
        [link.permission_set_id, link.permission_id]
      );
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.permission_set_permissions (permission_set_id, permission_id, created_at)
           VALUES ($1, $2, $3);`,
          [link.permission_set_id, link.permission_id, link.created_at]
        );
        inserted++;
      } else {
        verified++;
      }
    }

    // 8. Membership Permission Sets
    for (const link of MEMBERSHIP_PERMISSION_SET_FIXTURES) {
      const res = await client.query(
        'SELECT * FROM medialab_core.membership_permission_sets WHERE membership_id = $1 AND permission_set_id = $2;',
        [link.membership_id, link.permission_set_id]
      );
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id, created_at)
           VALUES ($1, $2, $3, $4);`,
          [link.organization_id, link.membership_id, link.permission_set_id, link.created_at]
        );
        inserted++;
      } else {
        verified++;
      }
    }

    // 9. Development Sessions
    {
      const sess = DEVELOPMENT_SESSION_FIXTURE;
      const res = await client.query('SELECT * FROM medialab_core.development_sessions WHERE id = $1;', [sess.id]);
      if (res.rows.length === 0) {
        await client.query(
          `INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
           VALUES ($1, $2, $3, $4, $5, $6);`,
          [sess.id, sess.identity_id, sess.token_sha256, sess.issued_at, sess.expires_at, sess.revoked_at]
        );
        inserted++;
      } else {
        const row = res.rows[0];
        if (
          !isValueEqual(row.identity_id, sess.identity_id) ||
          !isValueEqual(row.token_sha256, sess.token_sha256)
        ) {
          throw new Error(`FIXTURE_DIVERGENCE: Development session '${sess.id}' field divergence.`);
        }
        verified++;
      }
    }

    // 10. Synthetic P02-M03-A catalog, immutable price evidence, and custom evidence
    for (const fixtureTable of CATALOG_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>
        );
      }
    }

    // 11. Canonical current MediaLab real-estate catalog from approved public website evidence
    for (const fixtureTable of CURRENT_REAL_ESTATE_CATALOG_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>
        );
      }
    }

    // 12. Synthetic provider-neutral Order and immutable commercial evidence foundation
    for (const fixtureTable of ORDER_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 13. Synthetic provider-neutral Property Hub engagement and authorization foundation
    for (const fixtureTable of PROPERTY_HUB_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 14. Minimum scheduling staff and read permissions; no Appointment records are pre-created
    for (const fixtureTable of SCHEDULING_APPOINTMENT_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 15. Minimum Job management and read permissions; no Jobs or Workstreams are pre-created
    for (const fixtureTable of JOB_SERVICE_WORKSTREAM_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 16. Minimum Mission Plan manage, read, and protected-envelope metadata permissions
    for (const fixtureTable of MISSION_PLAN_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 17. Minimum media asset manage and read permissions; no media evidence is pre-created
    for (const fixtureTable of MEDIA_ASSET_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 18. Minimum durable media operation manage/read permissions; no operation evidence is pre-created
    for (const fixtureTable of MEDIA_OPERATION_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 19. Minimum Capture Session manage/read permissions; no capture or custody evidence is pre-created
    for (const fixtureTable of MEDIA_CAPTURE_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    // 20. Minimum Media Cull manage/read permissions; no Cull Workspace evidence is pre-created
    for (const fixtureTable of MEDIA_CULL_FOUNDATION_FIXTURE_TABLES) {
      for (const fixtureRow of fixtureTable.rows) {
        await ensureFixtureRow(
          fixtureTable.table,
          fixtureTable.keys,
          fixtureRow as unknown as Record<string, unknown>,
          false
        );
      }
    }

    await client.query('COMMIT;');
    return { inserted, verified };
  } catch (err) {
    await client.query('ROLLBACK;');
    throw err;
  } finally {
    if (ownClient && client) {
      await client.end();
    }
  }
}

// Path-safe CLI entrypoint execution
const currentPath = fileURLToPath(import.meta.url);
const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (scriptPath && currentPath === scriptPath) {
  const targetDb = process.env.PGDATABASE || 'medialab_p02m11a_test';
  const targetUser = process.env.PGUSER;

  if (!targetUser) {
    console.error('Seed CLI requires PGUSER as the migration owner role.');
    process.exit(1);
  }

  runSeed({
    database: targetDb,
    user: targetUser
  })
    .then((result) => {
      console.log(`Seed completed successfully for '${targetDb}'. Inserted: ${result.inserted}, Verified: ${result.verified}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Seed FAILED: ${err.message || String(err)}`);
      process.exit(1);
    });
}
