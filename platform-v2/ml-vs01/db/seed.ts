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

const APPROVED_DATABASES = [
  'medialab_vs01_repair_p01a',
  'medialab_vs01_repair_p01a_test'
];

export async function runSeed(options: SeedOptions = {}): Promise<SeedResult> {
  const host = options.host || process.env.PGHOST || '/tmp/mlvs01-pg';
  const port = options.port || (process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 55432);
  const database = options.database || process.env.PGDATABASE || 'medialab_vs01_repair_p01a';
  const user = options.user || process.env.PGUSER ||
    (database === 'medialab_vs01_repair_p01a_test'
      ? 'medialab_vs01_repair_p01a_test_owner'
      : 'medialab_vs01_repair_p01a_owner');

  // Guard 1: Database name restriction
  if (!APPROVED_DATABASES.includes(database)) {
    throw new Error(`SEED_SAFETY_FAILURE: Unapproved database target '${database}'. Allowed: ${APPROVED_DATABASES.join(', ')}`);
  }

  // Guard 2: Host restriction (must be Unix socket /tmp/mlvs01-pg, no TCP/external)
  if (!host.startsWith('/tmp/mlvs01-pg')) {
    throw new Error(`SEED_SAFETY_FAILURE: Unapproved connection host '${host}'. Seed must use Unix socket '/tmp/mlvs01-pg'.`);
  }

  if (port !== 55432) {
    throw new Error(`SEED_SAFETY_FAILURE: Unapproved port ${port}. Must be 55432.`);
  }

  // Guard 3: User role validation
  const expectedUser = database === 'medialab_vs01_repair_p01a_test'
    ? 'medialab_vs01_repair_p01a_test_owner'
    : 'medialab_vs01_repair_p01a_owner';
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
        return actual.toISOString() === new Date(expected).toISOString();
      }
      if (typeof actual === 'boolean') {
        return Boolean(actual) === Boolean(expected);
      }
      return String(actual) === String(expected);
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
  const isTestDb = process.argv.includes('--test');
  const targetDb = process.env.PGDATABASE ||
    (isTestDb ? 'medialab_vs01_repair_p01a_test' : 'medialab_vs01_repair_p01a');
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
