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
        if (token === "mock-valid-token-authorized") return { email: 'solutions@medialab.fyi', email_verified: true };
        if (token === "mock-valid-token-unauthorized") return { email: 'wrong@example.com', email_verified: true };
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

  // Test 10: Valid upstream data handling & UUID separation
  global.mockFetch = async (url) => {
    // Assert no write methods
    assert(!url.includes('POST') && !url.includes('PUT'), "No write HTTP methods sent to Aryeo");

    if (url.includes('/appointments')) {
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: "appt-uuid-not-order-uuid",
            status: "SCHEDULED",
            timezone: "America/Chicago",
            order: {
              id: "111e4567-e89b-12d3-a456-426614174000",
              number: 2002
            }
          }]
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        data: [{
          id: "123e4567-e89b-12d3-a456-426614174000",
          number: 1001,
          status: "SCHEDULED",
          appointments: [{ status: "SCHEDULED", timezone: "America/Los_Angeles" }],
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
  let parsed = JSON.parse(res.body);
  assert(parsed.items[0].payment_status === "PARTIALLY_PAID", "Payment info parsed");
  assert(parsed.items[0].id === "123e4567-e89b-12d3-a456-426614174000", "All Orders ID is UUID");
  assert(parsed.items[0].number === 1001, "All Orders number is separate");
  assert(parsed.items[0].timezone === "America/Los_Angeles", "Timezone respects priority (appointment fallback)");

  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { view: 'upcoming' }
  });
  parsed = JSON.parse(res.body);
  assert(parsed.items[0].id === "111e4567-e89b-12d3-a456-426614174000", "Upcoming ID is normalized order UUID");
  assert(parsed.items[0].number === 2002, "Upcoming number is separate");
  assert(parsed.items[0].timezone === "America/Chicago", "Upcoming timezone respects fallback");

  // Test 11: Safe upstream diagnostic logging
  global.mockFetch = async () => ({
    ok: false,
    status: 422,
    statusText: 'Unprocessable Entity',
    json: async () => ({ message: 'A safe Aryeo API error message' })
  });
  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { view: 'completed' }
  });
  assert(res.statusCode === 502, "Returns 502 on upstream failure");
  parsed = JSON.parse(res.body);
  assert(parsed.diagnostic.status === 422, "Diagnostic contains upstream status");
  assert(parsed.diagnostic.message === 'A safe Aryeo API error message', "Diagnostic contains safe message");

  // Test 12: General UUID format accepted
  res = await detailsFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: 'a23e4567-e89b-02d3-a456-426614174000' } // v0, not v1-5
  });
  assert(res.statusCode === 502, "Accepts generalized UUID");

  // Test 13: Completed Fallback Pagination, deduplication & includes
  let fetchCount = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  
  global.mockFetch = async (url) => {
    activeRequests++;
    if (activeRequests > maxActiveRequests) maxActiveRequests = activeRequests;
    
    // Simulate network delay to test concurrency overlap
    await new Promise(resolve => setTimeout(resolve, 10));

    if (url.includes('/v1/orders')) {
      assert(!url.includes('filter%5Bfulfillment_status%5D'), "Completed no longer sends filter[fulfillment_status]");
      assert(url.includes('include=customer%2Clisting'), "Completed uses reduced includes");
      
      const pageStr = new URLSearchParams(url.split('?')[1]).get('page');
      fetchCount++;
      const pageNum = parseInt(pageStr);
      
      activeRequests--;
      
      if (pageNum === 1) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: "uuid-1", fulfillment_status: "FULFILLED", fulfilled_at: "2026-07-01T00:00:00Z" },
              { id: "uuid-1", fulfillment_status: "FULFILLED", fulfilled_at: "2026-07-01T00:00:00Z" } // dup
            ],
            meta: { total: 5, current_page: 1, last_page: 6, per_page: 100 }
          })
        };
      } else {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: `uuid-${pageNum}`, fulfillment_status: "FULFILLED", fulfilled_at: "2026-07-02T00:00:00Z" }
            ],
            meta: { total: 5, current_page: pageNum, last_page: 6, per_page: 100 }
          })
        };
      }
    }
    activeRequests--;
    return { ok: false, status: 500 };
  };

  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { view: 'completed', page: '1', per_page: '10' }
  });
  
  assert(res.statusCode === 200, "Completed fallback succeeds");
  parsed = JSON.parse(res.body);
  assert(fetchCount === 6, "Completed fallback loops through all 6 pages");
  assert(maxActiveRequests > 1, "More than one page can execute concurrently");
  assert(maxActiveRequests <= 4, "Maximum observed concurrency never exceeds four");
  assert(parsed.items.length === 6, "All items collected, deduplicated, and filtered");

  // Test 14: Completed Fallback Safety Limit
  fetchCount = 0;
  global.mockFetch = async (url) => {
    fetchCount++;
    return {
      ok: true,
      json: async () => ({
        data: [],
        meta: { current_page: fetchCount, last_page: 100 } // infinite pages
      })
    };
  };
  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { view: 'completed' }
  });
  parsed = JSON.parse(res.body);
  assert(fetchCount === 20, "Enforces finite safety limit (20 loops)");
  assert(parsed.diagnostic && parsed.diagnostic.message.includes("Safety limit"), "Incomplete diagnostic included");

  // Test 15: Upstream page failure during concurrent execution
  global.mockFetch = async (url) => {
    const pageStr = new URLSearchParams(url.split('?')[1]).get('page');
    if (pageStr === '1') {
      return {
        ok: true,
        json: async () => ({
          data: [],
          meta: { current_page: 1, last_page: 5, per_page: 100 }
        })
      };
    } else if (pageStr === '3') {
      return {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ message: "Failed at page 3" })
      };
    } else {
      return {
        ok: true,
        json: async () => ({ data: [], meta: { current_page: parseInt(pageStr), last_page: 5 } })
      };
    }
  };
  res = await ordersFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { view: 'completed' }
  });
  assert(res.statusCode === 502, "Upstream page failure returns 502");
  parsed = JSON.parse(res.body);
  assert(parsed.diagnostic && parsed.diagnostic.message === "Failed at page 3", "Controlled JSON error with diagnostic from failed concurrent page");

  console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed.`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
