import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync, execSync } from 'child_process';
import { P02_M16_E_ALLOWLIST } from './p02-m16-e-changed-files.js';
import { P02_M16_C_ALLOWLIST } from './p02-m16-c-changed-files.js';
import {
  P02_M17_A_ALLOWLIST,
  P02_M17_A_BASE_COMMIT,
  P02_M17_A_BASE_TREE,
  P02_M17_A_BRANCH,
  P02_M17_A_MAIN_COMMIT,
  P02_M17_A_PACKAGE_LOCK_SHA256,
  P02_M17_A_TEST_PATHS,
  compareExactPathSets,
  readCandidateStatus,
  readChangedFilesInventory,
  validateCandidateStatus,
} from './p02-m17-a-changed-files.js';

// The predecessor definition remains visible for review; the executable closeout below enforces the exact M17-A boundary.

function preservedP02M16ECloseoutDefinition(): void {
console.log('Preserved P02-M16-E closeout definition (not executed by P02-M17-A).');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');
const worktreeRoot = path.resolve(baseDir, '../../');

let errors = false;

// 1. P02-M16-E reconciled bounded changed-file maximum allowlist
const ALLOWLIST = [...P02_M16_E_ALLOWLIST];

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
    console.error(`ERROR: Changed file '${gitPath}' is outside the reconciled P02-M16-E 69-path maximum allowlist.`);
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
  ,'tests/runtime-intake-reconciliation.test.ts'
  ,'tests/current-era-intake-reproof.test.ts'
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
}

void preservedP02M16ECloseoutDefinition;

const m17BaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m17RepoRoot = path.resolve(m17BaseDir, '../..');
const m17Failures: string[] = [];
if (
  P02_M16_C_ALLOWLIST.length !== 16 ||
  P02_M16_C_ALLOWLIST.some((candidatePath) => !candidatePath.startsWith('platform-v2/ml-vs01/'))
) {
  m17Failures.push('predecessor P02-M16-C centralized boundary invalid');
}
const m17Sha256 = (bytes: Buffer | string): string => crypto.createHash('sha256').update(bytes).digest('hex');
const m17GitText = (args: string[]): string => execFileSync('git', args, {
  cwd: m17RepoRoot,
  encoding: 'utf8',
}).trim();
const m17GitBytes = (args: string[]): Buffer => execFileSync('git', args, { cwd: m17RepoRoot });

const m17Head = m17GitText(['rev-parse', 'HEAD']);
const m17Tree = m17GitText(['rev-parse', 'HEAD^{tree}']);
const m17Branch = m17GitText(['symbolic-ref', '--short', 'HEAD']);
const m17OriginPlatform = m17GitText(['rev-parse', 'refs/remotes/origin/platform']);
const m17OriginMain = m17GitText(['rev-parse', 'refs/remotes/origin/main']);
if (m17Head !== P02_M17_A_BASE_COMMIT) m17Failures.push(`HEAD mismatch: expected ${P02_M17_A_BASE_COMMIT}, observed ${m17Head}`);
if (m17Tree !== P02_M17_A_BASE_TREE) m17Failures.push(`HEAD tree mismatch: expected ${P02_M17_A_BASE_TREE}, observed ${m17Tree}`);
if (m17Branch !== P02_M17_A_BRANCH) m17Failures.push(`branch mismatch: expected ${P02_M17_A_BRANCH}, observed ${m17Branch}`);
if (m17OriginPlatform !== P02_M17_A_BASE_COMMIT) m17Failures.push(`origin/platform mismatch: observed ${m17OriginPlatform}`);
if (m17OriginMain !== P02_M17_A_MAIN_COMMIT) m17Failures.push(`origin/main mismatch: observed ${m17OriginMain}`);

const m17States = readCandidateStatus(m17RepoRoot);
const m17ChangedPaths = m17States.map((state) => state.path).sort();
m17Failures.push(...validateCandidateStatus(m17States));
const m17DocumentedPaths = readChangedFilesInventory(path.join(m17BaseDir, 'CHANGED_FILES.md')).sort();
m17Failures.push(...compareExactPathSets(m17ChangedPaths, m17DocumentedPaths));
if (m17ChangedPaths.length === 0) m17Failures.push('candidate has no changed paths');

const m17MigrationDir = path.join(m17BaseDir, 'db/migrations');
const m17MigrationNames = fs.readdirSync(m17MigrationDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const m17ExpectedNumbers = Array.from({ length: 23 }, (_unused, index) => String(index + 1).padStart(4, '0'));
if (m17MigrationNames.length !== 23 || m17MigrationNames.some((name, index) => !name.startsWith(`${m17ExpectedNumbers[index]}_`))) {
  m17Failures.push(`migration inventory must be exactly 0001-0023; observed ${m17MigrationNames.join(', ')}`);
}
if (m17MigrationNames.some((name) => name.startsWith('0024_')) || fs.existsSync(path.join(m17MigrationDir, '0024'))) {
  m17Failures.push('migration 0024 is present');
}
const m17HeadMigrationPaths = m17GitText(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'platform-v2/ml-vs01/db/migrations'])
  .split('\n')
  .filter((entry) => /^platform-v2\/ml-vs01\/db\/migrations\/\d{4}_.+\.sql$/.test(entry));
const m17HeadMigrationNames = m17HeadMigrationPaths.map((entry) => path.basename(entry)).sort();
if (JSON.stringify(m17HeadMigrationNames) !== JSON.stringify(m17MigrationNames)) {
  m17Failures.push('worktree migration path set differs from the exact HEAD migration path set');
}
const m17MigrationHashes: Record<string, string> = {};
for (const name of m17MigrationNames) {
  const repoPath = `platform-v2/ml-vs01/db/migrations/${name}`;
  const worktreeBytes = fs.readFileSync(path.join(m17MigrationDir, name));
  const worktreeHash = m17Sha256(worktreeBytes);
  m17MigrationHashes[name] = worktreeHash;
  if (!m17HeadMigrationNames.includes(name)) {
    m17Failures.push(`migration is absent from HEAD: ${name}`);
    continue;
  }
  const headBytes = m17GitBytes(['show', `HEAD:${repoPath}`]);
  const headHash = m17Sha256(headBytes);
  if (!worktreeBytes.equals(headBytes) || worktreeHash !== headHash) {
    m17Failures.push(`migration differs from HEAD bytes: ${name}`);
  }
}

const m17LockBytes = fs.readFileSync(path.join(m17BaseDir, 'package-lock.json'));
const m17HeadLockBytes = m17GitBytes(['show', 'HEAD:platform-v2/ml-vs01/package-lock.json']);
const m17LockHash = m17Sha256(m17LockBytes);
if (!m17LockBytes.equals(m17HeadLockBytes)) m17Failures.push('package-lock.json differs from HEAD bytes');
if (m17LockHash !== P02_M17_A_PACKAGE_LOCK_SHA256) m17Failures.push(`package-lock.json SHA-256 mismatch: ${m17LockHash}`);

const m17Package = JSON.parse(fs.readFileSync(path.join(m17BaseDir, 'package.json'), 'utf8')) as Record<string, unknown>;
const m17HeadPackage = JSON.parse(m17GitText(['show', 'HEAD:platform-v2/ml-vs01/package.json'])) as Record<string, unknown>;
const m17PackageWithoutScripts = { ...m17Package, scripts: undefined };
const m17HeadPackageWithoutScripts = { ...m17HeadPackage, scripts: undefined };
if (JSON.stringify(m17PackageWithoutScripts) !== JSON.stringify(m17HeadPackageWithoutScripts)) {
  m17Failures.push('package.json contains a non-script change');
}
const m17Scripts = m17Package.scripts as Record<string, string>;
const m17HeadScripts = m17HeadPackage.scripts as Record<string, string>;
for (const [name, value] of Object.entries(m17HeadScripts)) {
  if (name !== 'verify:all' && m17Scripts[name] !== value) m17Failures.push(`predecessor package script changed: ${name}`);
}
const m17ExpectedAddedScripts: Record<string, string> = {
  'run:internal-operations-console-new-listing': 'tsx scripts/run-internal-operations-console-new-listing.ts',
  'verify:internal-operations-console-new-listing': 'tsx scripts/verify-internal-operations-console-new-listing.ts',
};
for (const [name, value] of Object.entries(m17ExpectedAddedScripts)) {
  if (m17Scripts[name] !== value) m17Failures.push(`required package script mismatch: ${name}`);
}
const m17AllowedScriptNames = new Set([...Object.keys(m17HeadScripts), ...Object.keys(m17ExpectedAddedScripts)]);
for (const name of Object.keys(m17Scripts)) if (!m17AllowedScriptNames.has(name)) m17Failures.push(`unauthorized package script added: ${name}`);
const m17FoundationSuffix = ' && npm run verify:foundation-closeout';
const m17HeadVerifyAll = m17HeadScripts['verify:all'];
const m17ExpectedVerifyAll = m17HeadVerifyAll.endsWith(m17FoundationSuffix)
  ? `${m17HeadVerifyAll.slice(0, -m17FoundationSuffix.length)} && npm run run:internal-operations-console-new-listing && npm run verify:internal-operations-console-new-listing${m17FoundationSuffix}`
  : '';
if (m17Scripts['verify:all'] !== m17ExpectedVerifyAll) m17Failures.push('verify:all is not the exact predecessor chain with the M17-A runner and dedicated verifier inserted before foundation closeout');

for (const repoPath of P02_M17_A_TEST_PATHS) {
  const absolutePath = path.join(m17RepoRoot, repoPath);
  if (!fs.existsSync(absolutePath)) {
    m17Failures.push(`required targeted test is absent: ${repoPath}`);
    continue;
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  if (!/(?:test|it)\s*\(/.test(content) || !/expect\s*\(/.test(content)) m17Failures.push(`targeted test is not substantive: ${repoPath}`);
  if (/\.(?:skip|todo)\s*\(/.test(content)) m17Failures.push(`targeted test contains skip/todo: ${repoPath}`);
}

for (const repoPath of m17ChangedPaths) {
  const absolutePath = path.join(m17RepoRoot, repoPath);
  if (!fs.existsSync(absolutePath)) {
    m17Failures.push(`candidate path is absent from the worktree: ${repoPath}`);
    continue;
  }
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.includes(0)) m17Failures.push(`binary/NUL payload is prohibited: ${repoPath}`);
  if (bytes.length > 1_500_000) m17Failures.push(`unexpected oversized candidate file: ${repoPath}`);
}

const m17Result = {
  verifier: 'P02-M17-A_FOUNDATION_CLOSEOUT_V1',
  pass: m17Failures.length === 0,
  entry: {
    branch: m17Branch,
    head: m17Head,
    tree: m17Tree,
    originPlatform: m17OriginPlatform,
    originMain: m17OriginMain,
  },
  candidate: {
    mode: 'uncommitted-unstaged-only',
    allowlistMaximum: P02_M17_A_ALLOWLIST.length,
    changedPaths: m17ChangedPaths,
    allOtherPathsUnchanged: m17Failures.every((failure) => !failure.includes('outside')),
  },
  migrations: { count: m17MigrationNames.length, names: m17MigrationNames, sha256: m17MigrationHashes, migration0024Absent: !m17MigrationNames.some((name) => name.startsWith('0024_')) },
  packageLockSha256: m17LockHash,
  packageJsonChanges: 'script-only',
  failures: m17Failures,
};

console.log(JSON.stringify(m17Result, null, 2));
if (!m17Result.pass) process.exit(1);
