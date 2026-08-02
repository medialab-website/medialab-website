import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

console.log('Running verify-foundation-closeout.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');
const worktreeRoot = path.resolve(baseDir, '../../');

let errors = false;

// 1. Original 14-path P01C allowlist definition
const ORIGINAL_14_ALLOWLIST = [
  'platform-v2/ml-vs01/BUILD_STATE.md',
  'platform-v2/ml-vs01/CHANGED_FILES.md',
  'platform-v2/ml-vs01/package.json',
  'platform-v2/ml-vs01/scripts/verify-migration-engine.ts',
  'platform-v2/ml-vs01/scripts/verify-identity-tenancy-schema.ts',
  'platform-v2/ml-vs01/tests/migration-engine.test.ts',
  'platform-v2/ml-vs01/tests/workspace-foundation.test.ts',
  'platform-v2/ml-vs01/tests/identity-tenancy-schema.test.ts',
  'platform-v2/ml-vs01/db/fixtures/identity-tenancy-fixtures.ts',
  'platform-v2/ml-vs01/db/seed.ts',
  'platform-v2/ml-vs01/db/reset-test-database.ts',
  'platform-v2/ml-vs01/scripts/verify-foundation-closeout.ts',
  'platform-v2/ml-vs01/tests/foundation-fixtures.test.ts',
  'platform-v2/ml-vs01/tests/test-database-reset.test.ts'
];

// 2. Direct inspection: platform-v2/ml-vs01/node_modules must NOT exist as file, directory, or symlink
const nodeModulesPath = path.join(baseDir, 'node_modules');
try {
  const stat = fs.lstatSync(nodeModulesPath);
  console.error(`ERROR: Unauthorized object found at node_modules path: ${nodeModulesPath} (isSymbolicLink: ${stat.isSymbolicLink()})`);
  errors = true;
} catch (err: any) {
  // Expected: ENOENT (path is completely absent)
  if (err.code !== 'ENOENT') {
    console.error(`ERROR: Unexpected error inspecting node_modules path: ${err.message}`);
    errors = true;
  }
}

// 3. Determine actual changed-path set from Git status
const gitStatusRaw = execSync('git status --porcelain -uall platform-v2/ml-vs01', {
  cwd: worktreeRoot,
  encoding: 'utf-8'
});

const actualChangedPaths: string[] = [];
const lines = gitStatusRaw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);

for (const line of lines) {
  const indexStatus = line[0];
  const gitPath = line.substring(3).trim();

  // Ensure candidate files are unstaged (index status column 0 must be ' ' or '?')
  if (indexStatus !== ' ' && indexStatus !== '?') {
    console.error(`ERROR: Staged changes detected in index for path '${gitPath}' (index status: '${indexStatus}')`);
    errors = true;
  }

  // Every changed path must be contained in the original 14-path P01C allowlist
  if (!ORIGINAL_14_ALLOWLIST.includes(gitPath)) {
    console.error(`ERROR: Changed file '${gitPath}' is outside the original 14-path allowlist.`);
    errors = true;
  }

  actualChangedPaths.push(gitPath);
}

// 4. Verify actual changed set matches CHANGED_FILES.md exactly
const changedFilesMdPath = path.join(baseDir, 'CHANGED_FILES.md');
if (!fs.existsSync(changedFilesMdPath)) {
  console.error(`ERROR: CHANGED_FILES.md missing at ${changedFilesMdPath}`);
  errors = true;
} else {
  const mdContent = fs.readFileSync(changedFilesMdPath, 'utf-8');

  // Verify every actual changed file is listed in CHANGED_FILES.md
  for (const changedPath of actualChangedPaths) {
    if (!mdContent.includes(changedPath)) {
      console.error(`ERROR: Actual changed path '${changedPath}' is missing from CHANGED_FILES.md`);
      errors = true;
    }
  }

  // Verify CHANGED_FILES.md does NOT list allowed-but-unchanged files
  for (const allowedPath of ORIGINAL_14_ALLOWLIST) {
    if (!actualChangedPaths.includes(allowedPath) && mdContent.includes(allowedPath)) {
      console.error(`ERROR: CHANGED_FILES.md lists allowed-but-unchanged path '${allowedPath}'`);
      errors = true;
    }
  }
}

// 5. Canonical Migration & Hash check
const migrationFile = path.join(baseDir, 'db/migrations/0001_identity_and_tenancy.sql');
if (!fs.existsSync(migrationFile)) {
  console.error(`ERROR: Canonical migration missing at ${migrationFile}`);
  errors = true;
} else {
  const migrationContent = fs.readFileSync(migrationFile);
  const sha256 = crypto.createHash('sha256').update(migrationContent).digest('hex').toLowerCase();
  const expectedSha256 = '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31';
  if (sha256 !== expectedSha256) {
    console.error(`ERROR: Migration SHA256 mismatch. Expected ${expectedSha256}, got ${sha256}`);
    errors = true;
  }
}

// Ensure no migration 0002 or later
const migrationsDir = path.join(baseDir, 'db/migrations');
const migrations = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
if (migrations.length !== 1 || migrations[0] !== '0001_identity_and_tenancy.sql') {
  console.error(`ERROR: Additional migration found in ${migrationsDir}: ${migrations.join(', ')}`);
  errors = true;
}

// 6. Package Lock & Dependency Manifest Check
const lockFile = path.join(baseDir, 'package-lock.json');
const lockContent = fs.readFileSync(lockFile);
const lockSha256 = crypto.createHash('sha256').update(lockContent).digest('hex').toLowerCase();
const expectedLockSha256 = '11cc280ef7ff1c66638bc1cc3e85c750844f6041bcf338a5b59c55b0f79d9258';
if (lockSha256 !== expectedLockSha256) {
  console.error(`ERROR: package-lock.json SHA256 mismatch. Expected ${expectedLockSha256}, got ${lockSha256}`);
  errors = true;
}

// 7. Fixture Contract & Safety Check
const fixtureFile = path.join(baseDir, 'db/fixtures/identity-tenancy-fixtures.ts');
if (fs.existsSync(fixtureFile)) {
  const content = fs.readFileSync(fixtureFile, 'utf-8');
  if (content.includes('password') || content.includes('secret') || content.includes('api_key') || content.includes('token_raw')) {
    console.error(`ERROR: Fixture file contains prohibited secret/password terms.`);
    errors = true;
  }
  if (!content.includes('medialab.invalid')) {
    console.error(`ERROR: Synthetic fixture emails must use .medialab.invalid domain.`);
    errors = true;
  }
}

// 8. Reset Safety Check
const resetFile = path.join(baseDir, 'db/reset-test-database.ts');
if (fs.existsSync(resetFile)) {
  const content = fs.readFileSync(resetFile, 'utf-8');
  if (content.includes('DROP DATABASE')) {
    console.error(`ERROR: reset-test-database.ts must never use DROP DATABASE.`);
    errors = true;
  }
  if (!content.includes('medialab_vs01_repair_p01a_test')) {
    console.error(`ERROR: reset-test-database.ts must explicitly mandate test database name.`);
    errors = true;
  }
}

// 9. Test Files Substantive Check
const testFiles = [
  'tests/migration-engine.test.ts',
  'tests/workspace-foundation.test.ts',
  'tests/identity-tenancy-schema.test.ts',
  'tests/foundation-fixtures.test.ts',
  'tests/test-database-reset.test.ts'
];

for (const tf of testFiles) {
  const fullPath = path.join(baseDir, tf);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    if (content.includes('.skip(') || content.includes('.todo(')) {
      console.error(`ERROR: Test file '${tf}' contains skipped or todo tests.`);
      errors = true;
    }
    if (!content.includes('expect(')) {
      console.error(`ERROR: Test file '${tf}' does not contain expect assertions.`);
      errors = true;
    }
  }
}

if (errors) {
  console.error('Foundation Closeout Verification FAILED.');
  process.exit(1);
}

console.log('Foundation Closeout Verification PASSED. All gates satisfied.');
