import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

// Safety check: ensure we are operating within the expected repository
if (!fs.existsSync(path.join(repoRoot, 'netlify.toml')) || !fs.existsSync(path.join(repoRoot, 'firebase.json'))) {
  console.error('ERROR: appledouble-hygiene must be executed within TCML_Website repository root.');
  process.exit(1);
}

const args = process.argv.slice(2);
const isCleanMode = args.includes('--clean');
const isVerbose = args.includes('--verbose') || args.includes('-v');

export function scanAppleDoubleCandidates(targetDir, root) {
  let candidates = [];
  let entries;
  try {
    entries = fs.readdirSync(targetDir, { withFileTypes: true });
  } catch (err) {
    return candidates;
  }

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(targetDir, entry.name);

    let stats;
    try {
      stats = fs.lstatSync(fullPath);
    } catch (err) {
      continue;
    }

    if (stats.isSymbolicLink()) continue; // Never follow or scan symlinks

    if (stats.isDirectory()) {
      candidates = candidates.concat(scanAppleDoubleCandidates(fullPath, root));
    } else if (stats.isFile() && entry.name.startsWith('._')) {
      candidates.push(fullPath);
    }
  }
  return candidates;
}

export function isVerifiedAppleDouble(filePath, root) {
  // Rule 1 & 10: Must be strictly inside root
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return { valid: false, reason: 'outside repository root' };
  }

  // Rule 2: Must not be inside .git
  const relPath = path.relative(root, resolved);
  if (relPath.startsWith('.git' + path.sep) || relPath === '.git') {
    return { valid: false, reason: 'inside .git' };
  }

  // Rule 3 & 4: Must be a regular file, not a symlink
  let stats;
  try {
    stats = fs.lstatSync(resolved);
  } catch (err) {
    return { valid: false, reason: 'unable to stat file' };
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return { valid: false, reason: 'not a regular file or is a symlink' };
  }

  // Rule 5: Basename must start with ._
  if (!path.basename(resolved).startsWith('._')) {
    return { valid: false, reason: 'basename does not start with ._' };
  }

  // Rule 8: Verify AppleDouble magic bytes (0x00 0x05 0x16 0x07)
  try {
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(resolved, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);

    if (bytesRead < 4 || buf[0] !== 0x00 || buf[1] !== 0x05 || buf[2] !== 0x16 || buf[3] !== 0x07) {
      return { valid: false, reason: 'magic bytes do not match AppleDouble signature' };
    }
  } catch (err) {
    return { valid: false, reason: 'error reading magic bytes' };
  }

  // Rule 6 & 7: Must not be tracked by git
  try {
    execSync('git ls-files --error-unmatch ' + JSON.stringify(relPath), { cwd: root, stdio: 'pipe' });
    return { valid: false, reason: 'file is tracked by git' };
  } catch (err) {
    // Non-zero exit code from git ls-files means file is NOT tracked, which is required
  }

  return { valid: true, relPath };
}

export function runHygiene(root = repoRoot, clean = isCleanMode) {
  const allCandidates = scanAppleDoubleCandidates(root, root);
  const verified = [];
  const rejected = [];

  for (const candidate of allCandidates) {
    const check = isVerifiedAppleDouble(candidate, root);
    if (check.valid) {
      verified.push({ fullPath: candidate, relPath: check.relPath });
    } else {
      rejected.push({ fullPath: candidate, relPath: path.relative(root, candidate), reason: check.reason });
    }
  }

  if (!clean) {
    if (verified.length > 0) {
      console.log(`[AppleDouble Check] Found ${verified.length} verified AppleDouble sidecar file(s):`);
      for (const item of verified) {
        console.log(`  - ${item.relPath}`);
      }
      if (rejected.length > 0 && isVerbose) {
        console.log(`[AppleDouble Check] Skipped ${rejected.length} candidate(s) (not verified AppleDouble):`);
        for (const item of rejected) {
          console.log(`  - ${item.relPath} (${item.reason})`);
        }
      }
      return { status: 'CONTAMINATION_FOUND', count: verified.length, verified, rejected };
    } else {
      console.log('[AppleDouble Check] Repository is clean. No AppleDouble sidecar files found.');
      return { status: 'CLEAN', count: 0, verified: [], rejected };
    }
  } else {
    let removedCount = 0;
    console.log(`[AppleDouble Clean] Removing ${verified.length} verified AppleDouble file(s)...`);
    for (const item of verified) {
      try {
        fs.unlinkSync(item.fullPath);
        console.log(`  Removed: ${item.relPath}`);
        removedCount++;
      } catch (err) {
        console.error(`  ERROR removing ${item.relPath}: ${err.message}`);
      }
    }
    if (rejected.length > 0) {
      console.log(`[AppleDouble Clean] Skipped ${rejected.length} candidate(s) (not verified AppleDouble):`);
      for (const item of rejected) {
        console.log(`  Skipped: ${item.relPath} (${item.reason})`);
      }
    }
    console.log(`[AppleDouble Clean] Complete. Removed ${removedCount} file(s).`);
    return { status: 'CLEANED', count: removedCount, verified, rejected };
  }
}

// CLI Execution if called directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const result = runHygiene(repoRoot, isCleanMode);
  if (!isCleanMode && result.count > 0) {
    process.exit(1);
  }
}
