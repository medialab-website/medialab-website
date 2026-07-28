import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const indexPath = path.join(__dirname, 'firebase-functions', 'index.js');

function runTests() {
  console.log('=== RUNNING FIREBASE HANDLER ALIGNMENT TEST ===');
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
    const content = fs.readFileSync(indexPath, 'utf-8');

    // Test 1: REVIEW_BRIDGE_SHARED_SECRET is defined and exported with it
    report(
      'Binds REVIEW_BRIDGE_SHARED_SECRET',
      content.includes('defineSecret("REVIEW_BRIDGE_SHARED_SECRET")') &&
      content.includes('secrets: [REVIEW_BRIDGE_SHARED_SECRET]') &&
      content.includes('export const reviewBridge = onRequest(')
    );

    // Test 2: FIREBASE_REVIEW_BRIDGE_SECRET is fully removed
    report(
      'Does not reference FIREBASE_REVIEW_BRIDGE_SECRET',
      !content.includes('FIREBASE_REVIEW_BRIDGE_SECRET')
    );

    // Test 3: Unrelated secrets (like ARYEO_API_KEY) are intact
    report(
      'Maintains ARYEO_API_KEY configuration',
      content.includes('defineSecret("ARYEO_API_KEY")') &&
      content.includes('secrets: [ARYEO_API_KEY]')
    );

    // Test 4: GOOGLE_DRIVE_QUICK_EDIT_UPLOAD_FOLDER_ID is removed
    report(
      'Does not reference GOOGLE_DRIVE_QUICK_EDIT_UPLOAD_FOLDER_ID',
      !content.includes('GOOGLE_DRIVE_QUICK_EDIT_UPLOAD_FOLDER_ID')
    );

    // Test 7: No unrelated Firebase function definition changed
    report(
      'Maintains getMissionPlan exact definition',
      content.includes('export const getMissionPlan = onRequest(') &&
      content.includes('{ ...baseOpts, secrets: [ARYEO_API_KEY, OPENROUTESERVICE_API_KEY] },') &&
      content.includes('createHandler(getMissionPlanHandler)')
    );
  } catch (err) {
    console.error(err);
    report('Test execution encountered error', false);
  }

  console.log(`\nTests Completed: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
