import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { fileURLToPath } from 'url';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  failed?: {
    filename: string;
    error: string;
  };
}

export interface MigrateOptions {
  migrationsDir: string;
  databaseUrl?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  schema?: string;
  client?: pg.Client;
}

export function validateMigrationFilenames(filenames: string[]): void {
  const filenameRegex = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
  const prefixes = new Set<string>();

  for (const name of filenames) {
    if (!filenameRegex.test(name)) {
      throw new Error(`Invalid migration filename format: '${name}'. Must match ^[0-9]{4}_[a-z0-9_]+\\.sql$`);
    }

    const prefix = name.substring(0, 4);
    if (prefixes.has(prefix)) {
      throw new Error(`Duplicate migration numeric prefix '${prefix}' detected in filename '${name}'`);
    }
    prefixes.add(prefix);
  }
}

function sanitizeIdentifier(ident: string): string {
  if (!/^[a-z0-9_]+$/.test(ident)) {
    throw new Error(`Invalid schema identifier '${ident}'. Must match ^[a-z0-9_]+$`);
  }
  return `"${ident}"`;
}

export async function runMigrations(options: MigrateOptions): Promise<MigrationResult> {
  const { migrationsDir } = options;

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migration directory not found: ${migrationsDir}`);
  }

  // 1. Read and validate filenames before any DB interaction
  const allEntries = fs.readdirSync(migrationsDir);
  const sqlFiles = allEntries.filter((f) => f.endsWith('.sql'));

  validateMigrationFilenames(sqlFiles);

  // 2. Sort lexicographically
  sqlFiles.sort((a, b) => a.localeCompare(b));

  // Validate and sanitize schema name
  const schemaName = options.schema || 'medialab_meta';
  const safeSchema = sanitizeIdentifier(schemaName);
  const safeTable = `${safeSchema}."schema_migrations"`;

  // 3. Connect to PostgreSQL if client not provided
  let client = options.client;
  let ownClient = false;

  if (!client) {
    ownClient = true;
    client = new pg.Client({
      host: options.host || process.env.PGHOST || '/tmp/mlvs01-pg',
      port: options.port || (process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 55432),
      database: options.database || process.env.PGDATABASE || 'medialab_vs01_repair_p01a',
      user: options.user || process.env.PGUSER || 'medialab_vs01_repair_p01a_app',
      password: options.password || process.env.PGPASSWORD || undefined
    });
    await client.connect();
  }

  const result: MigrationResult = {
    applied: [],
    skipped: []
  };

  try {
    // 4. Ensure ledger table exists and set search_path
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS ${safeSchema};
      SET search_path = ${safeSchema}, public;
      CREATE TABLE IF NOT EXISTS ${safeTable} (
        filename text PRIMARY KEY,
        sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    `);

    // 5. Query applied migrations
    const ledgerRes = await client.query<{ filename: string; sha256: string }>(
      `SELECT filename, sha256 FROM ${safeTable} ORDER BY filename ASC;`
    );

    const appliedLedger = new Map<string, string>();
    for (const row of ledgerRes.rows) {
      appliedLedger.set(row.filename, row.sha256);
    }

    // 6. Process migration files
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const fileBytes = fs.readFileSync(filePath);
      const fileSha256 = crypto.createHash('sha256').update(fileBytes).digest('hex').toLowerCase();

      if (appliedLedger.has(file)) {
        const appliedSha = appliedLedger.get(file)!;
        if (appliedSha !== fileSha256) {
          throw new Error(
            `Checksum drift detected for migration '${file}'. Applied SHA-256: ${appliedSha}, File SHA-256: ${fileSha256}`
          );
        }
        result.skipped.push(file);
      } else {
        // Apply migration in transaction
        const sqlContent = fileBytes.toString('utf-8');
        try {
          await client.query('BEGIN;');
          await client.query(`SET LOCAL search_path = ${safeSchema}, public;`);
          if (sqlContent.trim().length > 0) {
            await client.query(sqlContent);
          }
          await client.query(
            `INSERT INTO ${safeTable} (filename, sha256) VALUES ($1, $2);`,
            [file, fileSha256]
          );
          await client.query('COMMIT;');
          result.applied.push(file);
        } catch (err: any) {
          await client.query('ROLLBACK;');
          result.failed = {
            filename: file,
            error: err.message || String(err)
          };
          throw new Error(`Migration '${file}' failed: ${err.message || String(err)}`);
        }
      }
    }

    return result;
  } finally {
    if (ownClient && client) {
      await client.end();
    }
  }
}

// Path-safe CLI entrypoint detection
const currentPath = fileURLToPath(import.meta.url);
const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (scriptPath && currentPath === scriptPath) {
  const isTestDb = process.argv.includes('--test');
  const targetDb = isTestDb ? 'medialab_vs01_repair_p01a_test' : 'medialab_vs01_repair_p01a';
  const targetUser = isTestDb ? 'medialab_vs01_repair_p01a_test' : 'medialab_vs01_repair_p01a_app';

  const __dirname = path.dirname(currentPath);
  const migrationsDir = path.resolve(__dirname, 'migrations');

  runMigrations({
    migrationsDir,
    database: targetDb,
    user: targetUser
  })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      const failResult: MigrationResult = {
        applied: [],
        skipped: [],
        failed: {
          filename: 'unknown',
          error: err.message || String(err)
        }
      };
      console.log(JSON.stringify(failResult, null, 2));
      process.exit(1);
    });
}
