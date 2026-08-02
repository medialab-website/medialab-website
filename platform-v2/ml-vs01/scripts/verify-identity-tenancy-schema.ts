import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

console.log('Running verify-identity-tenancy-schema.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');

let errors = false;

// 1. Required files
const requiredFiles = [
  'db/migrations/0001_identity_and_tenancy.sql',
  'scripts/verify-identity-tenancy-schema.ts',
  'tests/identity-tenancy-schema.test.ts',
  'db/fixtures/identity-tenancy-fixtures.ts',
  'db/seed.ts',
  'db/reset-test-database.ts'
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(baseDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`ERROR: Required foundation file missing: ${relPath}`);
    errors = true;
  }
}

// 2. Canonical migration 0001 SHA256 check
const migrationsDir = path.join(baseDir, 'db/migrations');
const migrationContent = fs.readFileSync(path.join(migrationsDir, '0001_identity_and_tenancy.sql'));
const sha256 = crypto.createHash('sha256').update(migrationContent).digest('hex').toLowerCase();
const expectedSha256 = '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31';
if (sha256 !== expectedSha256) {
  console.error(`ERROR: Canonical migration 0001 SHA256 mismatch. Expected: ${expectedSha256}, Actual: ${sha256}`);
  errors = true;
}

// 3. Reject prohibited patterns (Fastify, UI, HTTP, unapproved code)
const prohibitedPatterns = [
  'src/api',
  'src/auth',
  'src/ui',
  'ui',
  'components',
  'fastify',
  'openapi'
];

for (const relPath of prohibitedPatterns) {
  const fullPath = path.join(baseDir, relPath);
  if (fs.existsSync(fullPath)) {
    console.error(`ERROR: Prohibited artifact detected: ${relPath}`);
    errors = true;
  }
}

// 4. Test file substantive check
const testFile = path.join(baseDir, 'tests/identity-tenancy-schema.test.ts');
if (fs.existsSync(testFile)) {
  const content = fs.readFileSync(testFile, 'utf8');
  if (content.includes('.skip(') || content.includes('.todo(')) {
    console.error(`ERROR: Test file contains skipped or todo tests.`);
    errors = true;
  }
  if (!content.includes('expect(')) {
    console.error(`ERROR: Test file does not contain expect assertions.`);
    errors = true;
  }
  if (!content.includes('.query(')) {
    console.error(`ERROR: Test file does not contain database queries.`);
    errors = true;
  }
}

// 5. Check package-lock.json hasn't been modified
const lockFile = path.join(baseDir, 'package-lock.json');
const lockContent = fs.readFileSync(lockFile);
const lockSha256 = crypto.createHash('sha256').update(lockContent).digest('hex').toLowerCase();
const expectedLockSha256 = '11cc280ef7ff1c66638bc1cc3e85c750844f6041bcf338a5b59c55b0f79d9258';
if (lockSha256 !== expectedLockSha256) {
  console.error(`ERROR: package-lock.json SHA256 mismatch. Expected: ${expectedLockSha256}, Actual: ${lockSha256}`);
  errors = true;
}

if (errors) {
  console.error('Identity/Tenancy verification FAILED.');
  process.exit(1);
}

console.log('Identity/Tenancy verification PASSED.');
