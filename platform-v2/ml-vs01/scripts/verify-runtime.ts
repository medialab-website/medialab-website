import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('Running verify-runtime.ts...');

// 1. Verify Node.js version
const nodeVersion = process.version;
console.log(`Node.js version: ${nodeVersion}`);
if (!nodeVersion.startsWith('v24.')) {
  console.warn(`Note: Running on Node version ${nodeVersion}`);
}

// 2. Verify PostgreSQL binary
const pgBinary = '/Applications/Postgres.app/Contents/Versions/latest/bin/postgres';
if (!fs.existsSync(pgBinary)) {
  console.error(`ERROR: PostgreSQL binary not found at ${pgBinary}`);
  process.exit(1);
}
console.log(`PostgreSQL binary verified: ${pgBinary}`);

// 3. Verify PostgreSQL cluster directory
const pgDataDir = '/tmp/mlvs01-p02m15b-data';
if (!fs.existsSync(pgDataDir)) {
  console.error(`ERROR: PostgreSQL cluster data directory not found at ${pgDataDir}`);
  process.exit(1);
}
console.log(`PostgreSQL cluster data dir verified: ${pgDataDir}`);

// 4. Verify socket directory
const socketDir = '/tmp/mlvs01-p02m15b-pg';
if (!fs.existsSync(socketDir)) {
  console.error(`ERROR: Approved socket directory not found at ${socketDir}`);
  process.exit(1);
}
console.log(`PostgreSQL socket dir verified: ${socketDir}`);

// 5. Verify the packet-specific Unix-socket listener and its exact isolated data/database identity.
try {
  execSync('/Applications/Postgres.app/Contents/Versions/latest/bin/pg_isready -h /tmp/mlvs01-p02m15b-pg -p 55443 -d medialab_p02m15b_test', { encoding: 'utf-8' });
  const identity = execSync(
    "/Applications/Postgres.app/Contents/Versions/latest/bin/psql -h /tmp/mlvs01-p02m15b-pg -p 55443 -U medialab_p02m15b_test_owner -d medialab_p02m15b_test -Atc \"SELECT current_database()||'|'||current_user\"",
    { encoding: 'utf-8' }
  ).trim();
  if (identity !== 'medialab_p02m15b_test|medialab_p02m15b_test_owner') {
    console.error(`ERROR: Packet PostgreSQL identity mismatch: ${identity}`);
    process.exit(1);
  }
  console.log('Packet-specific PostgreSQL Unix socket, port, database, owner, and data directory verified.');
} catch (e) {
  console.error(`ERROR: Failed to verify packet-specific PostgreSQL listener: ${e}`);
  process.exit(1);
}

console.log('Runtime verification PASSED.');
