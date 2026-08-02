import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';
import { EXPECTED_ROW_COUNTS } from './fixtures/identity-tenancy-fixtures.js';

export interface ResetTestDatabaseOptions {
  host?: string;
  port?: number;
  database?: string;
  confirm?: string;
  user?: string;
  password?: string;
}

export async function resetTestDatabase(options: ResetTestDatabaseOptions = {}): Promise<void> {
  const host = options.host || process.env.PGHOST || '/tmp/mlvs01-pg';
  const port = options.port || (process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 55432);
  const database = options.database || process.env.PGDATABASE || 'medialab_vs01_repair_p01a_test';
  const confirm = options.confirm || process.env.CONFIRM_DATABASE || '';
  const user = options.user || process.env.PGUSER || 'medialab_vs01_repair_p01a_test';

  // Guard 1: Strict target database check
  if (database !== 'medialab_vs01_repair_p01a_test') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Target database '${database}' is not the approved test database 'medialab_vs01_repair_p01a_test'.`);
  }

  // Guard 2: Explicit confirmation check
  if (confirm !== 'medialab_vs01_repair_p01a_test') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Missing or invalid confirmation '${confirm}'. Expected 'medialab_vs01_repair_p01a_test'.`);
  }

  // Guard 3: Connection host & port check
  if (!host.startsWith('/tmp/mlvs01-pg')) {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Unapproved host '${host}'. Reset must use Unix socket '/tmp/mlvs01-pg'.`);
  }

  if (port !== 55432) {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Unapproved port ${port}. Must be 55432.`);
  }

  // Guard 4: Role check
  if (user !== 'medialab_vs01_repair_p01a_test') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Unapproved user '${user}'. Reset must use role 'medialab_vs01_repair_p01a_test'.`);
  }

  const client = new pg.Client({
    host,
    port,
    database: 'medialab_vs01_repair_p01a_test',
    user: 'medialab_vs01_repair_p01a_test',
    password: options.password
  });

  await client.connect();

  try {
    // Drop ONLY medialab_core and medialab_meta schemas
    await client.query('DROP SCHEMA IF EXISTS medialab_core CASCADE;');
    await client.query('DROP SCHEMA IF EXISTS medialab_meta CASCADE;');
  } finally {
    await client.end();
  }

  // Rerun migration engine
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(__dirname, 'migrations');

  await runMigrations({
    migrationsDir,
    database: 'medialab_vs01_repair_p01a_test',
    user: 'medialab_vs01_repair_p01a_test',
    host,
    port
  });

  // Rerun deterministic seed
  await runSeed({
    database: 'medialab_vs01_repair_p01a_test',
    user: 'medialab_vs01_repair_p01a_test',
    host,
    port
  });

  // Verify post-reset state
  const verifyClient = new pg.Client({
    host,
    port,
    database: 'medialab_vs01_repair_p01a_test',
    user: 'medialab_vs01_repair_p01a_test'
  });

  await verifyClient.connect();

  try {
    // 1. Ledger verification
    const ledgerRes = await verifyClient.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations;');
    if (
      ledgerRes.rows.length !== 1 ||
      ledgerRes.rows[0].filename !== '0001_identity_and_tenancy.sql' ||
      ledgerRes.rows[0].sha256 !== '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'
    ) {
      throw new Error('TEST_RESET_GUARD_FAILURE: Ledger verification after reset failed.');
    }

    // 2. Row count verification
    for (const [table, expectedCount] of Object.entries(EXPECTED_ROW_COUNTS)) {
      const countRes = await verifyClient.query(`SELECT COUNT(*)::int AS cnt FROM medialab_core.${table};`);
      const count = countRes.rows[0].cnt;
      if (count !== expectedCount) {
        throw new Error(`TEST_RESET_GUARD_FAILURE: Reset count mismatch for table '${table}'. Expected ${expectedCount}, got ${count}.`);
      }
    }
  } finally {
    await verifyClient.end();
  }
}

// CLI entrypoint execution
const currentPath = fileURLToPath(import.meta.url);
const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (scriptPath && currentPath === scriptPath) {
  const confirmArg = process.argv.find(a => a.startsWith('--confirm='))?.split('=')[1] || '';

  resetTestDatabase({
    confirm: confirmArg
  })
    .then(() => {
      console.log('Test database reset and seed completed successfully for medialab_vs01_repair_p01a_test.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Test database reset FAILED: ${err.message || String(err)}`);
      process.exit(1);
    });
}
