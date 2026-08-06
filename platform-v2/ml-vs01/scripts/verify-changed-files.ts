import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { P02_M09_A_ALLOWLIST } from './p02-m09-a-changed-files.js';

console.log('Running verify-changed-files.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const worktreeRoot = path.resolve(__dirname, '../../../');
const changedFilesMdPath = path.resolve(__dirname, '../CHANGED_FILES.md');

if (!fs.existsSync(changedFilesMdPath)) {
  console.error(`ERROR: CHANGED_FILES.md not found at ${changedFilesMdPath}`);
  process.exit(1);
}

const mdContent = fs.readFileSync(changedFilesMdPath, 'utf-8');

const gitStatusRaw = execSync('git status --porcelain -uall platform-v2/ml-vs01', {
  cwd: worktreeRoot,
  encoding: 'utf-8'
});

const actualGitFiles = gitStatusRaw
  .split('\n')
  .map((line: string) => line.replace(/\r$/, ''))
  .filter((line: string) => line.length > 0)
  .map((line: string) => line.substring(3).trim())
  .filter((f: string) => f.length > 0 && !f.includes('node_modules/'));

const stagedPaths = gitStatusRaw
  .split('\n')
  .map((line: string) => line.replace(/\r$/, ''))
  .filter((line: string) => line.length > 0 && line[0] !== ' ' && line[0] !== '?')
  .map((line: string) => line.substring(3).trim());

if (stagedPaths.length > 0) {
  console.error(`ERROR: Staged candidate paths detected: ${stagedPaths.join(', ')}`);
  process.exit(1);
}

console.log('Actual Git candidate files:');
actualGitFiles.forEach((f: string) => console.log(`  - ${f}`));

let missingInMd = false;
for (const gitFile of actualGitFiles) {
  if (!mdContent.includes(gitFile)) {
    console.error(`ERROR: Git status file '${gitFile}' is missing from CHANGED_FILES.md`);
    missingInMd = true;
  }
}

if (missingInMd) {
  process.exit(1);
}

if (JSON.stringify([...actualGitFiles].sort()) !== JSON.stringify([...P02_M09_A_ALLOWLIST].sort())) {
  console.error('ERROR: Actual Git candidate files do not exactly match the P02-M09-A allowlist.');
  process.exit(1);
}

console.log('Changed files inventory verification PASSED.');
