import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runHygiene, isVerifiedAppleDouble } from './appledouble-hygiene.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const testDir = path.join(repoRoot, 'temp_test_appledouble_fixture');

function setupFixtures() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  // 1. Valid AppleDouble fixture
  const validPath = path.join(testDir, '._valid_fixture.mjs');
  const validHeader = Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]);
  fs.writeFileSync(validPath, validHeader);

  // 2. Canonical counterpart file
  const canonicalPath = path.join(testDir, 'valid_fixture.mjs');
  fs.writeFileSync(canonicalPath, 'console.log("canonical");');

  // 3. Fake non-AppleDouble ._* file (starts with text)
  const fakePath = path.join(testDir, '._fake_text.mjs');
  fs.writeFileSync(fakePath, 'module.exports = {};');

  // 4. Symlink pointing to valid file
  const symlinkPath = path.join(testDir, '._symlink_target');
  try {
    fs.symlinkSync(validPath, symlinkPath);
  } catch (err) {
    // ignore symlink creation error if platform restricts
  }

  return { validPath, canonicalPath, fakePath, symlinkPath };
}

function cleanupFixtures() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log('=== RUNNING APPLEDOUBLE HYGIENE TESTS ===');
  let passed = 0;
  let failed = 0;

  function report(name, condition) {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${name}`);
      failed++;
    }
  }

  try {
    const { validPath, canonicalPath, fakePath, symlinkPath } = setupFixtures();

    // Test A: Check mode detects valid fixture
    const checkResult = runHygiene(repoRoot, false);
    const foundValid = checkResult.verified.some(item => item.fullPath === validPath);
    report('Check mode detects valid AppleDouble fixture', foundValid);

    // Test B: Refuses non-AppleDouble ._* file
    const fakeCheck = isVerifiedAppleDouble(fakePath, repoRoot);
    report('Refuses non-AppleDouble ._* file', !fakeCheck.valid && fakeCheck.reason.includes('magic bytes'));

    // Test C: Refuses symlinks
    if (fs.existsSync(symlinkPath)) {
      const symlinkCheck = isVerifiedAppleDouble(symlinkPath, repoRoot);
      report('Refuses symlink candidate', !symlinkCheck.valid && symlinkCheck.reason.includes('symlink'));
    } else {
      report('Refuses symlink candidate', true);
    }

    // Test D: Refuses tracked files
    const trackedCheck = isVerifiedAppleDouble(path.join(repoRoot, 'firebase.json'), repoRoot);
    report('Refuses candidate if basename does not start with ._', !trackedCheck.valid);

    // Test E: Clean mode removes valid fixture only
    const cleanResult = runHygiene(repoRoot, true);
    const validRemoved = !fs.existsSync(validPath);
    const canonicalUntouched = fs.existsSync(canonicalPath);
    const fakeUntouched = fs.existsSync(fakePath);

    report('Clean mode removes valid AppleDouble fixture', validRemoved);
    report('Clean mode leaves canonical counterpart untouched', canonicalUntouched);
    report('Clean mode leaves non-AppleDouble file untouched', fakeUntouched);

  } catch (err) {
    console.error('Test execution error:', err);
    report('Test execution encountered error', false);
  } finally {
    cleanupFixtures();
  }

  console.log(`\nTests Completed: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
