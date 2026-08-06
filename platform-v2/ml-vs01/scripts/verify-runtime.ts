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
const pgDataDir = '/tmp/mlvs01-p02m12a-data';
if (!fs.existsSync(pgDataDir)) {
  console.error(`ERROR: PostgreSQL cluster data directory not found at ${pgDataDir}`);
  process.exit(1);
}
console.log(`PostgreSQL cluster data dir verified: ${pgDataDir}`);

// 4. Verify socket directory
const socketDir = '/tmp/mlvs01-p02m12a-pg';
if (!fs.existsSync(socketDir)) {
  console.error(`ERROR: Approved socket directory not found at ${socketDir}`);
  process.exit(1);
}
console.log(`PostgreSQL socket dir verified: ${socketDir}`);

// 5. Verify the packet-specific PostgreSQL listener is the only process on this packet port.
try {
  const lsof = execSync('lsof -i :55442 || true', { encoding: 'utf-8' }).trim();
  const lines = lsof.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2 || lines.slice(1).some((line) => !line.startsWith('postgres '))) {
    console.error(`ERROR: Port 55442 is not exclusively owned by packet PostgreSQL:\n${lsof}`);
    process.exit(1);
  }
  execSync('/Applications/Postgres.app/Contents/Versions/latest/bin/pg_isready -h /tmp/mlvs01-p02m12a-pg -p 55442 -d medialab_p02m12a_test', { encoding: 'utf-8' });
  console.log('Packet-specific PostgreSQL listener verified on socket and port 55442.');
} catch (e) {
  console.error(`ERROR: Failed to verify packet-specific PostgreSQL listener: ${e}`);
  process.exit(1);
}

console.log('Runtime verification PASSED.');
