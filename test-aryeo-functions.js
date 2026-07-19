// Simple test harness for netlify functions
process.env.FIREBASE_PROJECT_ID = "mock-project";
process.env.FIREBASE_CLIENT_EMAIL = "mock@mock.com";
process.env.FIREBASE_PRIVATE_KEY = "mock-key";
require('module').Module._cache[require.resolve('firebase-admin/app')] = {
  id: require.resolve('firebase-admin/app'),
  filename: require.resolve('firebase-admin/app'),
  loaded: true,
  exports: {
    initializeApp: () => {},
    getApps: () => [],
    cert: () => ({})
  }
};
require('module').Module._cache[require.resolve('firebase-admin/auth')] = {
  id: require.resolve('firebase-admin/auth'),
  filename: require.resolve('firebase-admin/auth'),
  loaded: true,
  exports: {
    getAuth: () => ({
      verifyIdToken: async (token) => {
        if (token === "mock-valid-token-authorized") return { email: 'solutions@medialab.fyi' };
        if (token === "mock-valid-token-unauthorized") return { email: 'wrong@example.com' };
        throw new Error('Invalid token');
      }
    })
  }
};
const ordersFunction = require('./netlify/functions/get-aryeo-orders.js');
const detailsFunction = require('./netlify/functions/get-aryeo-order-detail.js');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log("=== RUNNING ARYEO READ-ONLY TESTS ===");

  const AUTHORIZED_TOKEN = "Bearer mock-valid-token-authorized";
  const UNAUTHORIZED_TOKEN = "Bearer mock-valid-token-unauthorized";
  const INVALID_TOKEN = "Bearer mock-invalid-token";

// Old mock removed

  // Test 1: Missing ARYEO_API_KEY returns sanitized 503, never mock data
  delete process.env.ARYEO_API_KEY;
  let res = await ordersFunction.handler({ httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN } });
  assert(res.statusCode === 503, "Missing ARYEO_API_KEY returns 503 for lists");
  assert(JSON.parse(res.body).error === 'ARYEO_NOT_CONFIGURED', "Error is ARYEO_NOT_CONFIGURED");

  let resDetail = await detailsFunction.handler({ 
    httpMethod: 'GET', 
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  assert(resDetail.statusCode === 503, "Missing ARYEO_API_KEY returns 503 for details");
  assert(JSON.parse(resDetail.body).error === 'ARYEO_NOT_CONFIGURED', "Error is ARYEO_NOT_CONFIGURED for details");

  // Re-enable key for subsequent tests
  process.env.ARYEO_API_KEY = "test-key";

  // Test 2: Missing authorization returns 401
  res = await ordersFunction.handler({ httpMethod: 'GET', headers: {} });
  assert(res.statusCode === 401, "Missing auth returns 401");

  // Test 3: Invalid/revoked token returns 401
  res = await ordersFunction.handler({ httpMethod: 'GET', headers: { authorization: INVALID_TOKEN } });
  assert(res.statusCode === 401, "Invalid token returns 401");

  // Test 4: Unauthorized approved-token fixture returns 403
  res = await ordersFunction.handler({ httpMethod: 'GET', headers: { authorization: UNAUTHORIZED_TOKEN } });
  assert(res.statusCode === 403, "Unauthorized email returns 403");

  // Test 5: Unsupported method returns 405
  res = await ordersFunction.handler({ httpMethod: 'POST', headers: { authorization: AUTHORIZED_TOKEN } });
  assert(res.statusCode === 405, "POST method returns 405");

  // Test 6: Malformed UUID returns 400
  res = await detailsFunction.handler({ 
    httpMethod: 'GET', 
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: 'not-a-uuid' }
  });
  assert(res.statusCode === 400, "Malformed UUID returns 400");
  assert(JSON.parse(res.body).error.includes('UUID'), "UUID error message");

  // Test 7: Valid UUID reaches the mocked upstream adapter (Aryeo upstream failure returns sanitized 502)
  global.mockFetch = async () => ({ ok: false, status: 500, text: async () => 'Internal Server Error' });
  res = await detailsFunction.handler({ 
    httpMethod: 'GET', 
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  assert(res.statusCode === 502, "Upstream failure returns 502");

  // Test 8: Pagination parameter bounds
  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { page: '0' }
  });
  assert(res.statusCode === 400, "Page 0 returns 400");
  
  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { per_page: '999' }
  });
  assert(res.statusCode === 400, "per_page > 100 returns 400");

  // Test 9: View allowlist
  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { view: 'invalid_view' }
  });
  assert(res.statusCode === 400, "Invalid view returns 400");

  // Test 10: Valid upstream data handling
  global.mockFetch = async (url) => {
    // Assert no write methods
    assert(!url.includes('POST') && !url.includes('PUT'), "No write HTTP methods sent to Aryeo");
    return {
      ok: true,
      json: async () => ({
        data: [{
          id: "123e4567-e89b-12d3-a456-426614174000",
          number: 1001,
          status: "SCHEDULED",
          appointments: [{ status: "SCHEDULED" }],
          payment_status: "PARTIALLY_PAID",
          currency: "USD",
          balance_amount: 15000,
          customer: { name: "Test Cust" },
          items: [{ title: "Test Item" }]
        }],
        meta: { total: 1, current_page: 1, last_page: 1, per_page: 25 }
      })
    };
  };

  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { view: 'all' }
  });
  assert(res.statusCode === 200, "Valid data returns 200");
  const parsed = JSON.parse(res.body);
  assert(parsed.items[0].payment_status === "PARTIALLY_PAID", "Payment info parsed");

  console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed.`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
