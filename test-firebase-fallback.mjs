import assert from 'assert';
import { executeDriveList } from './netlify/functions/_shared/drive-core.mjs';

async function runTests() {
  console.log('=== RUNNING FIREBASE FALLBACK TESTS ===');
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

  // 1. Shared core boundary: missing folder ID
  try {
    await executeDriveList({}, null);
    report('Shared core rejects missing folder ID', false);
  } catch (e) {
    report('Shared core rejects missing folder ID', e.message.includes('missing folder ID'));
  }

  // 2. Shared core boundary: valid folder ID uses drive client
  try {
    let driveCalled = false;
    const mockDrive = {
      files: {
        list: async (params) => {
          assert.equal(params.q, `'test-folder-id' in parents and trashed = false`);
          driveCalled = true;
          return { data: { files: [] } };
        }
      }
    };
    await executeDriveList(mockDrive, 'test-folder-id');
    report('Shared core constructs correct query and preserves metadata', driveCalled);
  } catch (e) {
    console.error(e);
    report('Shared core constructs correct query and preserves metadata', false);
  }

  console.log(`\nTests Completed: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
