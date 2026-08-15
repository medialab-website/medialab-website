import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { P02_M16_B_ALLOWLIST } from './p02-m16-b-changed-files.js';

console.log('Running verify-foundation-closeout.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');
const worktreeRoot = path.resolve(baseDir, '../../');

let errors = false;

// 1. P02-M16-B amended bounded changed-file maximum allowlist
const ALLOWLIST = [...P02_M16_B_ALLOWLIST];

// 2. Determine actual changed-path set from Git status
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

  // Every changed path must be contained in the allowlist
  if (!ALLOWLIST.includes(gitPath)) {
    console.error(`ERROR: Changed file '${gitPath}' is outside the amended P02-M16-B 50-path allowlist.`);
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
  for (const allowedPath of ALLOWLIST) {
    if (!actualChangedPaths.includes(allowedPath) && mdContent.includes(allowedPath)) {
      console.error(`ERROR: CHANGED_FILES.md lists allowed-but-unchanged path '${allowedPath}'`);
      errors = true;
    }
  }
}

// 5. Canonical Migration & Hash check
const migrationFile1 = path.join(baseDir, 'db/migrations/0001_identity_and_tenancy.sql');
if (!fs.existsSync(migrationFile1)) {
  console.error(`ERROR: Canonical migration missing at ${migrationFile1}`);
  errors = true;
} else {
  const migrationContent = fs.readFileSync(migrationFile1);
  const sha256 = crypto.createHash('sha256').update(migrationContent).digest('hex').toLowerCase();
  const expectedSha256 = '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31';
  if (sha256 !== expectedSha256) {
    console.error(`ERROR: Migration 0001 SHA256 mismatch. Expected ${expectedSha256}, got ${sha256}`);
    errors = true;
  }
}

const migrationFile2 = path.join(baseDir, 'db/migrations/0002_property_identity_and_snapshots.sql');
if (!fs.existsSync(migrationFile2)) {
  console.error(`ERROR: Canonical migration missing at ${migrationFile2}`);
  errors = true;
} else {
  const migrationContent = fs.readFileSync(migrationFile2);
  const sha256 = crypto.createHash('sha256').update(migrationContent).digest('hex').toLowerCase();
  const expectedSha256 = 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83';
  if (sha256 !== expectedSha256) {
    console.error(`ERROR: Migration 0002 SHA256 mismatch. Expected ${expectedSha256}, got ${sha256}`);
    errors = true;
  }
}

// 6. Package Lock & Dependency Manifest Check
const lockFile = path.join(baseDir, 'package-lock.json');
const lockContent = fs.readFileSync(lockFile);
const lockSha256 = crypto.createHash('sha256').update(lockContent).digest('hex').toLowerCase();
const expectedLockSha256 = '2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a';
if (lockSha256 !== expectedLockSha256) {
  console.error(`ERROR: package-lock.json SHA256 mismatch. Expected ${expectedLockSha256}, got ${lockSha256}`);
  errors = true;
}

// 7. Test Files Substantive Check
const testFiles = [
  'tests/migration-engine.test.ts',
  'tests/workspace-foundation.test.ts',
  'tests/identity-tenancy-schema.test.ts',
  'tests/property-snapshot-schema.test.ts',
  'tests/foundation-fixtures.test.ts',
  'tests/test-database-reset.test.ts',
  'tests/provider-neutral-file-backed-delivery.test.ts'
  ,'tests/organization-records-dashboard-audited-export-foundation.test.ts'
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
