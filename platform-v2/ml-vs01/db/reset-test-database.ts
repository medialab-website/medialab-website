import pg from 'pg';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';
import { runSeed } from './seed.js';
import { EXPECTED_ROW_COUNTS } from './fixtures/identity-tenancy-fixtures.js';
import { CATALOG_EXPECTED_ROW_COUNTS } from './fixtures/current-catalog-price-fixtures.js';
import { CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS } from './fixtures/current-real-estate-catalog-seed.js';

const EXPECTED_RESET_ROW_COUNTS: Record<string, number> = {
  ...EXPECTED_ROW_COUNTS,
  ...CATALOG_EXPECTED_ROW_COUNTS
};
for (const [table, count] of Object.entries(CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS)) {
  EXPECTED_RESET_ROW_COUNTS[table] = (EXPECTED_RESET_ROW_COUNTS[table] ?? 0) + count;
}

export interface ResetTestDatabaseOptions {
  host?: string;
  port?: number;
  database?: string;
  confirm?: string;
  user?: string;
  runtimeUser?: string;
  password?: string;
}

export async function resetTestDatabase(options: ResetTestDatabaseOptions = {}): Promise<void> {
  const host = options.host || process.env.PGHOST || '/tmp/mlvs01-p02m03a-pg';
  const port = options.port || (process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 55432);
  const database = options.database || process.env.PGDATABASE || 'medialab_p02m03a_test';
  const confirm = options.confirm || process.env.CONFIRM_DATABASE || '';
  const user = options.user || process.env.PGUSER || 'medialab_p02m03a_test_owner';
  const runtimeUser = options.runtimeUser || process.env.PGRUNTIMEUSER || 'medialab_p02m03a_test_app';

  // Guard 1: Strict target database check
  if (database !== 'medialab_p02m03a_test') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Target database '${database}' is not the approved test database 'medialab_p02m03a_test'.`);
  }

  // Guard 2: Explicit confirmation check
  if (confirm !== 'medialab_p02m03a_test') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Missing or invalid confirmation '${confirm}'. Expected 'medialab_p02m03a_test'.`);
  }

  // Guard 3: Connection host & port check
  if (host !== '/tmp/mlvs01-p02m03a-pg') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Unapproved host '${host}'. Reset must use Unix socket '/tmp/mlvs01-p02m03a-pg'.`);
  }

  if (port !== 55432) {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Unapproved port ${port}. Must be 55432.`);
  }

  // Guard 4: Role check
  if (user !== 'medialab_p02m03a_test_owner') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Unapproved user '${user}'. Reset must use owner role 'medialab_p02m03a_test_owner'.`);
  }
  if (runtimeUser !== 'medialab_p02m03a_test_app') {
    throw new Error(`TEST_RESET_GUARD_FAILURE: Reset refused. Unapproved runtime role '${runtimeUser}'. Expected 'medialab_p02m03a_test_app'.`);
  }

  const client = new pg.Client({
    host,
    port,
    database: 'medialab_p02m03a_test',
    user,
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
    database: 'medialab_p02m03a_test',
    user,
    runtimeUser,
    host,
    port
  });

  // Rerun deterministic seed
  await runSeed({
    database: 'medialab_p02m03a_test',
    user,
    host,
    port
  });

  // Verify post-reset state
  const verifyClient = new pg.Client({
    host,
    port,
    database: 'medialab_p02m03a_test',
    user
  });

  await verifyClient.connect();

  try {
    // 1. Dynamic exact canonical migration ledger verification
    const canonicalFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const expectedLedger = canonicalFiles.map((filename) => {
      const content = fs.readFileSync(path.join(migrationsDir, filename));
      const sha256 = crypto.createHash('sha256').update(content).digest('hex').toLowerCase();
      return { filename, sha256 };
    });

    const ledgerRes = await verifyClient.query(
      'SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename ASC;'
    );

    if (ledgerRes.rows.length !== expectedLedger.length) {
      throw new Error(`TEST_RESET_GUARD_FAILURE: Migration ledger row count mismatch after reset. Expected ${expectedLedger.length}, got ${ledgerRes.rows.length}.`);
    }

    for (let i = 0; i < expectedLedger.length; i++) {
      if (
        ledgerRes.rows[i].filename !== expectedLedger[i].filename ||
        ledgerRes.rows[i].sha256 !== expectedLedger[i].sha256
      ) {
        throw new Error(
          `TEST_RESET_GUARD_FAILURE: Ledger mismatch for migration ${expectedLedger[i].filename}. Expected sha256 ${expectedLedger[i].sha256}, got filename=${ledgerRes.rows[i].filename} sha256=${ledgerRes.rows[i].sha256}.`
        );
      }
    }

    // 2. Row count verification
    for (const [table, expectedCount] of Object.entries(EXPECTED_RESET_ROW_COUNTS)) {
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
      console.log('Test database reset and seed completed successfully for medialab_p02m03a_test.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Test database reset FAILED: ${err.message || String(err)}`);
      process.exit(1);
    });
}
