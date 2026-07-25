import assert from 'assert';
import reviewBridgeHandler from './netlify/functions/review-bridge.mjs';

// Mock process.env
process.env.FIREBASE_REVIEW_BRIDGE_SECRET = 'TEST_SECRET_VALUE';

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
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'SAVE_REVIEW_DECISIONS' }) });
    res = await reviewBridgeHandler(req, {});
    report(`Rejects unsupported command (Got ${res.status})`, res.status === 403);
    if (res.status !== 403) {
      console.log('Body:', await res.text());
    }

    // Test 4: Valid command forwarded securely
    globalFetchCalls = [];
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'LIST_REVIEW_QUEUE' }) });
    res = await reviewBridgeHandler(req, {});
    
    report('Accepts LIST_REVIEW_QUEUE', res.status === 200);
    report('Forwards request to Apps Script', globalFetchCalls.length === 1 && globalFetchCalls[0].url.includes('script.google.com'));
    
    let upstreamBody = JSON.parse(globalFetchCalls[0].options.body);
    report('Injects secret server-side', upstreamBody.secret === 'TEST_SECRET_VALUE' && upstreamBody.command === 'LIST_REVIEW_QUEUE');

    let body = await res.json();
    report('Secret never appears in client response', JSON.stringify(body).indexOf('TEST_SECRET_VALUE') === -1);
    
    // Test 5: Upstream error degraded safely
    mockFetchResponse = new Response(JSON.stringify({ ok: false, message: 'Apps Script failed' }), { status: 200 });
    req = new Request('http://localhost/review-bridge', { method: 'POST', body: JSON.stringify({ command: 'LIST_REVIEW_QUEUE' }) });
    res = await reviewBridgeHandler(req, {});
    report('Upstream failure degrades safely (502)', res.status === 502);

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
