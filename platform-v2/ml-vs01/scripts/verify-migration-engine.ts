import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

console.log('Running verify-migration-engine.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

let errors = false;

// 1. Missing migration engine files & tests
const requiredEngineFiles = [
  'db/migrate.ts',
  'db/migrations/README.md',
  'tests/migration-engine.test.ts'
];

for (const relPath of requiredEngineFiles) {
  const fullPath = path.join(baseDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`ERROR: Required migration engine file missing: ${relPath}`);
    errors = true;
  }
}

// 2. Canonical migration directory checks
const canonicalDir = path.join(baseDir, 'db/migrations');
if (fs.existsSync(canonicalDir)) {
  const files = fs.readdirSync(canonicalDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql'));

  if (sqlFiles.length > 0) {
    console.error(`ERROR: Canonical migration directory must contain ZERO .sql files during M01. Found: ${sqlFiles.join(', ')}`);
    errors = true;
  }

  // Check all non-README files or non-sql files for invalid naming if any exist
  for (const f of files) {
    if (f.endsWith('.sql')) {
      if (!/^[0-9]{4}_[a-z0-9_]+\.sql$/.test(f)) {
        console.error(`ERROR: Invalid canonical migration filename: ${f}`);
        errors = true;
      }
    }
  }
} else {
  console.error(`ERROR: Canonical migration directory db/migrations missing`);
  errors = true;
}

// 3. Package-lock hash verification
const lockPath = path.join(baseDir, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lockBytes = fs.readFileSync(lockPath);
  const lockHash = crypto.createHash('sha256').update(lockBytes).digest('hex').toLowerCase();
  const expectedHash = '11cc280ef7ff1c66638bc1cc3e85c750844f6041bcf338a5b59c55b0f79d9258';

  if (lockHash !== expectedHash) {
    console.error(`ERROR: package-lock.json SHA-256 changed! Expected: ${expectedHash}, Got: ${lockHash}`);
    errors = true;
  }
} else {
  console.error(`ERROR: package-lock.json missing`);
  errors = true;
}

// 4. Check that migration fixtures are isolated under tests/fixtures/migrations
function searchSqlFiles(dirPath: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;
  const list = fs.readdirSync(dirPath);
  for (const file of list) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(searchSqlFiles(filePath));
    } else if (file.endsWith('.sql')) {
      results.push(filePath);
    }
  }
  return results;
}

const allSqlFiles = searchSqlFiles(baseDir);
const allowedFixturePrefix = path.join(baseDir, 'tests/fixtures/migrations');

for (const sqlFile of allSqlFiles) {
  if (!sqlFile.startsWith(allowedFixturePrefix)) {
    console.error(`ERROR: SQL file outside isolated test-fixture directory: ${sqlFile}`);
    errors = true;
  }
}

if (errors) {
  console.error('Migration engine gate FAILED.');
  process.exit(1);
}

console.log('Migration engine gate PASSED.');
