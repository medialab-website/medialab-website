import assert from 'assert';
import reviewBridgeHandler from './netlify/functions/review-bridge.mjs';

// Mock process.env
process.env.REVIEW_BRIDGE_SHARED_SECRET = 'TEST_SECRET_VALUE';

// Mock auth module
import authModule from './netlify/functions/_shared/auth.js';

let mockVerifyAuthResult = { ok: true };
authModule.verifyAuth = async (req) => mockVerifyAuthResult;

let globalFetchCalls = [];
let mockFetchResponse = null;

global.fetch = async (url, options) => {
  globalFetchCalls.push({ url, options });
  if (mockFetchResponse) {
    return mockFetchResponse;
  }
  return new Response(JSON.stringify({ ok: true, listings: [] }), { status: 200 });
};

async function runTests() {
  console.log('=== RUNNING REVIEW BRIDGE PROXY TESTS ===');
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
    // Test 1: Only POST allowed
    let req = new Request('http://localhost/review-bridge', { method: 'GET' });
    let res = await reviewBridgeHandler(req, {});
    report('Rejects GET requests', res.status === 405);

    // Test 2: Token rejected
    mockVerifyAuthResult = { ok: false, statusCode: 401, error: 'Unauthorized' };
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'LIST_REVIEW_QUEUE' }) });
    res = await reviewBridgeHandler(req, {});
    report('Rejects invalid token', res.status === 401);

    // Test 3: Unsupported command rejected
    mockVerifyAuthResult = { ok: true, decodedToken: { email: 'solutions@medialab.fyi' } };
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'UNKNOWN_COMMAND' }) });
    res = await reviewBridgeHandler(req, {});
    report(`Rejects unsupported command (Got ${res.status})`, res.status === 403);

    // Test 4: Valid command LIST_REVIEW_QUEUE
    globalFetchCalls = [];
    mockFetchResponse = new Response(JSON.stringify({ ok: true, listings: [{ Listing_ID: '123' }] }), { status: 200 });
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'LIST_REVIEW_QUEUE' }) });
    res = await reviewBridgeHandler(req, {});
    report('Accepts LIST_REVIEW_QUEUE', res.status === 200);

    let upstreamBody = JSON.parse(globalFetchCalls[0].options.body);
    report('Injects secret server-side', upstreamBody.secret === 'TEST_SECRET_VALUE' && upstreamBody.command === 'LIST_REVIEW_QUEUE');

    let body = await res.json();
    report('Response correctly sanitized', Array.isArray(body.listings) && body.listings.length === 1);

    // Test 5: GET_LISTING_REVIEW
    globalFetchCalls = [];
    mockFetchResponse = new Response(JSON.stringify({ ok: true, listing: { Listing_ID: '456' }, items: [{ Review_Item_ID: 'abc' }] }), { status: 200 });
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'GET_LISTING_REVIEW', Listing_ID: '456' }) });
    res = await reviewBridgeHandler(req, {});
    report('Accepts GET_LISTING_REVIEW', res.status === 200);
    body = await res.json();
    report('Sanitized GET_LISTING_REVIEW response', body.listing.Listing_ID === '456' && body.items[0].Review_Item_ID === 'abc');

    // Test 6: SAVE_REVIEW_DECISIONS
    globalFetchCalls = [];
    mockFetchResponse = new Response(JSON.stringify({ ok: true, updatedCount: 1 }), { status: 200 });
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'SAVE_REVIEW_DECISIONS', Listing_ID: '456', decisions: [] }) });
    res = await reviewBridgeHandler(req, {});
    report('Accepts SAVE_REVIEW_DECISIONS', res.status === 200);
    body = await res.json();
    report('Sanitized SAVE_REVIEW_DECISIONS response', body.updatedCount === 1);

    // Test 7: SUBMIT_LISTING_REVIEW
    globalFetchCalls = [];
    mockFetchResponse = new Response(JSON.stringify({ ok: true, newStatus: 'FINALIZE_REVIEW' }), { status: 200 });
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'SUBMIT_LISTING_REVIEW', Listing_ID: '456' }) });
    res = await reviewBridgeHandler(req, {});
    report('Accepts SUBMIT_LISTING_REVIEW', res.status === 200);
    body = await res.json();
    report('Sanitized SUBMIT_LISTING_REVIEW response', body.newStatus === 'FINALIZE_REVIEW');

    // Test 8: Upstream error degraded safely
    mockFetchResponse = new Response(JSON.stringify({ ok: false, message: 'Apps Script failed' }), { status: 200 });
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'LIST_REVIEW_QUEUE' }) });
    res = await reviewBridgeHandler(req, {});
    report('Upstream failure degrades safely (502)', res.status === 502);

    // Test 9: UPLOAD_QUICK_EDIT forwards base64 safely
    globalFetchCalls = [];
    mockFetchResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // valid 1x1 png
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({
      command: 'UPLOAD_QUICK_EDIT',
      Review_Item_ID: '789',
      fileName: 'test.png',
      mimeType: 'image/png',
      base64: fakeBase64
    })});
    res = await reviewBridgeHandler(req, {});
    report('Accepts UPLOAD_QUICK_EDIT', res.status === 200);
    upstreamBody = JSON.parse(globalFetchCalls[0].options.body);
    report('Forwards base64 data to Apps Script', upstreamBody.base64 === fakeBase64 && upstreamBody.mimeType === 'image/png' && upstreamBody.Corrected_Edit_Upload.startsWith('QuickEdit_789_'));

  } catch (err) {
    console.error(err);
    report('Test execution encountered error', false);
  }

  console.log(`\nTests Completed: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
