import fs from 'fs';
import path from 'path';

const SRC = 'operations-console';
const DEST = 'firebase-public/operations-console';

const ALLOWLIST = [
  'poc.html',
  'manifest.json',
  'sw.js',
  'firebase-auth.js',
  'firebase-auth-bundle.js',
  'firebase-auth-entry.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

console.log('Staging Firebase Hosting assets...');

// Remove the symlink if it exists
if (fs.existsSync('firebase-public/operations-console')) {
  const stats = fs.lstatSync('firebase-public/operations-console');
  if (stats.isSymbolicLink()) {
    fs.unlinkSync('firebase-public/operations-console');
    console.log('Removed old symlink.');
  } else {
    fs.rmSync('firebase-public/operations-console', { recursive: true, force: true });
  }
}

// Ensure dest dir exists
if (!fs.existsSync(DEST)) {
  fs.mkdirSync(DEST, { recursive: true });
}
if (!fs.existsSync(path.join(DEST, 'icons'))) {
  fs.mkdirSync(path.join(DEST, 'icons'), { recursive: true });
}

let missing = false;

for (const file of ALLOWLIST) {
  const srcPath = path.join(SRC, file);
  const destPath = path.join(DEST, file);

  if (!fs.existsSync(srcPath)) {
    console.error(`ERROR: Required asset missing: ${srcPath}`);
    missing = true;
    continue;
  }

  const stats = fs.lstatSync(srcPath);
  if (stats.isSymbolicLink()) {
    console.error(`ERROR: Symlinks rejected: ${srcPath}`);
    missing = true;
    continue;
  }

  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied: ${file}`);
}

if (missing) {
  process.exit(1);
}

// Test boundary: Add an explicit check that a repository file didn't leak in
const forbidden = path.join(DEST, 'package.json');
if (fs.existsSync(forbidden)) {
  console.error('ERROR: forbidden file leaked into public.');
  process.exit(1);
}

console.log('Staging complete.');
