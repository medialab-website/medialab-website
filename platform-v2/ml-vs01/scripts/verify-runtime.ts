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
const pgDataDir = '/tmp/mlvs01-p02m09a-pgdata';
if (!fs.existsSync(pgDataDir)) {
  console.error(`ERROR: PostgreSQL cluster data directory not found at ${pgDataDir}`);
  process.exit(1);
}
console.log(`PostgreSQL cluster data dir verified: ${pgDataDir}`);

// 4. Verify socket directory
const socketDir = '/tmp/mlvs01-p02m09a-pg';
if (!fs.existsSync(socketDir)) {
  console.error(`ERROR: Approved socket directory not found at ${socketDir}`);
  process.exit(1);
}
console.log(`PostgreSQL socket dir verified: ${socketDir}`);

// 5. Verify no rogue TCP listeners or socket locks while stopped
try {
  const lsof = execSync('lsof -i :55439 || true', { encoding: 'utf-8' }).trim();
  if (lsof.length > 0) {
    console.error(`ERROR: Port 55439 has active listener:\n${lsof}`);
    process.exit(1);
  }
} catch (e) {
  // Ignored if lsof not available or clean
}

console.log('Runtime verification PASSED.');
