// Simple test harness for netlify functions
const fs = require('fs');

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
let ordersFunction;
let detailsFunction;
let exitRouteFunction;

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

  const o = await import('./netlify/functions/get-aryeo-orders.mjs');
  const d = await import('./netlify/functions/get-aryeo-order-detail.mjs');
  const e = await import('./netlify/functions/get-exit-route.mjs');

  const wrapper = (mod) => ({
    handler: async (event) => {
      const url = new URL('http://localhost');
      if (event.queryStringParameters) {
        for (const [k, v] of Object.entries(event.queryStringParameters)) url.searchParams.append(k, v);
      }
      const req = new Request(url, {
        method: event.httpMethod,
        headers: event.headers || {}
      });
      const res = await mod.default(req, {});
      return {
        statusCode: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: await res.text()
      };
    }
  });

  ordersFunction = wrapper(o);
  detailsFunction = wrapper(d);
  exitRouteFunction = wrapper(e);

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
              number: 2002,
              status: "SCHEDULED"
            }
          }, {
            id: "appt-uuid-canceled-order",
            status: "SCHEDULED",
            timezone: "America/Chicago",
            order: {
              id: "222e4567-e89b-12d3-a456-426614174000",
              number: 2003,
              status: "CANCELLED"
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
  assert(parsed.items.length === 1, "Canceled order is absent from Upcoming");
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

  console.log("=== RUNNING GET-EXIT-ROUTE TESTS ===");
  process.env.OPENROUTESERVICE_API_KEY = "mock-ors-key";
  process.env.MEDIALAB_ROUTE_ORIGIN = "mock-origin-address";
  process.env.ARYEO_API_KEY = "test-key";

  let requestedGeocodeUrl = "";
  let directionUrls = [];
  let routeMode = "both-success";

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (url.includes('api.aryeo.com')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            number: 9999,
            listing: {
              address: { latitude: 36.0, longitude: -82.0, state_or_province: 'NC', unparsed_address_part_one: '123 Test St' }
            }
          }
        })
      };
    }
    if (url.includes('api.openrouteservice.org/geocode')) {
      requestedGeocodeUrl = url;
      if (url.includes('bad-address')) {
        return { ok: false, status: 500 };
      }
      if (url.includes('no-features')) {
        return { ok: true, text: async () => JSON.stringify({ features: [] }) };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          features: [{
            geometry: { coordinates: [-79.0, 38.0] }
          }]
        })
      };
    }
    if (url.includes('api.openrouteservice.org/v2/directions')) {
      directionUrls.push(url);
      const parsedUrl = new URL(url);
      const start = parsedUrl.searchParams.get('start');
      const isRouteToListing = start === '-79,38';
      const shouldFail =
        routeMode === "both-fail" ||
        (routeMode === "to-listing-fails" && isRouteToListing) ||
        (routeMode === "home-fails" && !isRouteToListing);
      if (shouldFail) {
        return { ok: false, status: 503 };
      }
      return {
        ok: true,
        json: async () => ({
          features: [{
            properties: {
              segments: [{
                distance: 1000,
                duration: 600,
                steps: [{
                  instruction: isRouteToListing ? "Continue onto Test Road" : "Turn left toward Home Base",
                  name: isRouteToListing ? "Test Road" : "Home Road",
                  distance: 100,
                  duration: 60
                }]
              }]
            }
          }]
        })
      };
    }
    return { ok: false };
  };

  res = await exitRouteFunction.handler({
    httpMethod: 'GET',
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });

  assert(res.headers && (res.headers['Content-Type'] || res.headers['content-type']) === 'application/json; charset=utf-8', "Responses use application/json content type");
  assert(requestedGeocodeUrl.includes('api_key=mock-ors-key'), "Origin geocoder uses api_key as a query parameter");
  assert(requestedGeocodeUrl.includes('text='), "Address is passed through text");
  assert(requestedGeocodeUrl.includes('size=1'), "size=1 is supplied");
  assert(res.body.indexOf('mock-ors-key') === -1, "API key is never returned in the function response");

  parsed = JSON.parse(res.body);
  assert(parsed.available === true, "Route found and available");
  assert(parsed.route_to_listing.available === true, "Route to listing available");
  assert(parsed.route_home.available === true, "Route home available");
  assert(parsed.route_to_listing.steps[0].instruction.startsWith("Continue onto Test Road"), "Route to listing returns neutral complete directions");
  assert(parsed.route_home.steps[0].instruction === "Turn left toward Home Base", "Route home returns neutral complete directions");
  assert(directionUrls.length === 2, "Both route directions are requested");
  assert(directionUrls.some(url => {
    const parsedUrl = new URL(url);
    return parsedUrl.searchParams.get('start') === '-79,38' && parsedUrl.searchParams.get('end') === '-82,36';
  }), "Home Base to listing uses correct longitude/latitude order");
  assert(directionUrls.some(url => {
    const parsedUrl = new URL(url);
    return parsedUrl.searchParams.get('start') === '-82,36' && parsedUrl.searchParams.get('end') === '-79,38';
  }), "Listing to Home Base reverses the coordinates");

  routeMode = "home-fails";
  directionUrls = [];
  res = await exitRouteFunction.handler({
    httpMethod: 'GET',
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(parsed.available === true, "Overall route remains available when route home fails");
  assert(parsed.route_to_listing.available === true, "Route to listing is retained when route home fails");
  assert(parsed.route_home.available === false && parsed.route_home.steps.length === 0, "Failed route home is normalized independently");

  routeMode = "to-listing-fails";
  directionUrls = [];
  res = await exitRouteFunction.handler({
    httpMethod: 'GET',
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(parsed.available === true, "Overall route remains available when route to listing fails");
  assert(parsed.route_to_listing.available === false && parsed.route_to_listing.steps.length === 0, "Failed route to listing is normalized independently");
  assert(parsed.route_home.available === true, "Route home is retained when route to listing fails");

  routeMode = "both-fail";
  directionUrls = [];
  res = await exitRouteFunction.handler({
    httpMethod: 'GET',
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(parsed.available === false, "Overall route is unavailable only when both routes fail");
  assert(parsed.route_to_listing.available === false && parsed.route_home.available === false, "Both failed routes remain independently represented");
  assert(parsed.warnings.some(w => w.includes("Neither route")), "Both-route failure returns an explicit top-level warning");

  const routeSource = fs.readFileSync(require.resolve('./netlify/functions/get-exit-route.mjs'), 'utf8');
  assert(!routeSource.includes('isVA') && !routeSource.includes('isTN'), "VA/TN route gating is removed");
  assert(!routeSource.includes('target_entry_found') && !routeSource.includes('target_direction'), "Interstate target contract is removed");
  assert(!routeSource.includes('target_entry_node'), "Old generic truncation logic is removed");

  routeMode = "both-success";
  process.env.MEDIALAB_ROUTE_ORIGIN = "no-features";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET',
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(parsed.available === false && parsed.warnings.length > 0, "Missing geocoder features returns available:false safely");

  process.env.MEDIALAB_ROUTE_ORIGIN = "bad-address";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET',
    headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(parsed.available === false && parsed.warnings.length > 0, "Non-2xx geocoder responses return safe diagnostics");

  // --- BOUNDARY MODE TESTS ---
  console.log("--- RUNNING BOUNDARY MODE TESTS ---");
  process.env.MEDIALAB_I81_EXIT1_NB_ENTRY_COORDS = "-82.1,36.1";
  process.env.MEDIALAB_I81_EXIT1A_SB_RETURN_COORDS = "-82.2,36.2";
  process.env.MEDIALAB_ROUTE_ORIGIN = "mock-origin-address"; // Restore origin

  let boundaryMode = "qualifies";

  global.fetch = async (url) => {
    if (url.includes('api.aryeo.com')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            number: 9999,
            listing: { address: { latitude: 36.0, longitude: -82.0, state_or_province: 'VA', unparsed_address_part_one: '123 Richmond Ave' } }
          }
        })
      };
    }
    if (url.includes('api.openrouteservice.org/geocode')) {
      return {
        ok: true,
        text: async () => JSON.stringify({ features: [{ geometry: { coordinates: [-79.0, 38.0] } }] })
      };
    }
    if (url.includes('api.openrouteservice.org/v2/directions')) {
      const parsedUrl = new URL(url);
      const start = parsedUrl.searchParams.get('start');
      const end = parsedUrl.searchParams.get('end');

      const isFullOutbound = start === '-79,38' && end === '-82,36';
      const isFullReturn = start === '-82,36' && end === '-79,38';

      const isBoundOutbound = start === '-82.1,36.1';
      const isBoundReturn = start === '-82,36' && end === '-82.2,36.2';

      // Mock coordinates
      const mockOutboundGeo = [[-79, 38], [-82.1001, 36.1001], [-82, 36]]; // Passes near [-82.1, 36.1]
      const mockReturnGeo = [[-82, 36], [-82.2001, 36.2001], [-79, 38]];   // Passes near [-82.2, 36.2]
      const mockOutsideGeo = [[-79, 38], [-80, 37], [-82, 36]]; // Far from checkpoints

      if (boundaryMode === "qualifies") {
        if (isFullOutbound) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockOutboundGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Keep right", name: "", distance: 100 }] }] } }] }) };
        if (isFullReturn) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockReturnGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Merge onto Highway", name: "Highway", distance: 100 }] }] } }] }) };
        if (isBoundOutbound) return { ok: true, json: async () => ({ features: [{ properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Go straight bound out", name: "Bound Out", distance: 100 }] }] } }] }) };
        if (isBoundReturn) return { ok: true, json: async () => ({ features: [{ properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Take Exit 1", name: "Exit 1", distance: 100 }, { instruction: "Take Exit 1", name: "Exit 1", distance: 50 }, { instruction: "Arrive", name: "", distance: 100 }] }] } }] }) };
      }

      if (boundaryMode === "no-qualify") {
        if (isFullOutbound) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockOutsideGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [
          { instruction: "Head west", name: "", distance: 5 }, // 10. Compass-only removed
          { instruction: "Head south on Hwy 1", name: "Hwy 1", distance: 50 }, // 11. Compass with road
          { instruction: "Turn right", name: "", distance: 0 }, // 12. Unnamed zero distance removed
          { instruction: "Turn left", name: "Main St", distance: 0 }, // 13. Short named preserved
          { instruction: "Merge onto I-81 North", name: "I-81 North", distance: 100 } // 14. Useful labels preserved
        ] }] } }] }) };
        if (isFullReturn) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockOutsideGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Go to Local Road", name: "Local", distance: 100 }] }] } }] }) };
      }

      if (boundaryMode === "bound-fail") {
        if (isFullOutbound) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockOutboundGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Merge onto Highway", name: "Highway", distance: 100 }] }] } }] }) };
        if (isFullReturn) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockReturnGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Merge onto Highway", name: "Highway", distance: 100 }] }] } }] }) };
        if (isBoundOutbound) return { ok: false, status: 503 };
        if (isBoundReturn) return { ok: true, json: async () => ({ features: [{ properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Arrive", name: "", distance: 100 }] }] } }] }) };
      }

      if (boundaryMode === "synthetic-display-fail") {
        if (isFullOutbound) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockOutboundGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Keep right", name: "", distance: 100 }] }] } }] }) };
        if (isFullReturn) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: mockReturnGeo }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Merge onto Highway", name: "Highway", distance: 100 }] }] } }] }) };
        if (isBoundOutbound) return { ok: true, json: async () => ({ features: [{ properties: { segments: [{ distance: 100000, duration: 10, steps: [
          { instruction: "Continue on Gate City Highway, US 421", name: "Gate City Highway, US 421", distance: 0 },
          { type: 13, instruction: "Keep right", name: "Gate City Highway, US 421", distance: 95434 },
          { type: 13, instruction: "Keep right", name: "", distance: 321 },
          { type: 1, instruction: "Turn right onto Black Lick Road, VA 90", name: "Black Lick Road, VA 90", distance: 2414 },
          { type: 1, instruction: "Turn right onto Delp Avenue", name: "Delp Avenue", distance: 160 },
          { type: 0, instruction: "Turn left onto Church Street", name: "Church Street", distance: 10 },
          { type: 1, instruction: "Turn right onto Richmond Avenue", name: "Richmond Avenue", distance: 160 },
          { type: 1, instruction: "Turn right onto -", name: "-", distance: 10 },
          { type: 0, instruction: "Turn left onto -", name: "-", distance: 5 },
          { type: 10, instruction: "Arrive at your destination, on the left", name: "", distance: 0 }
        ] }] } }] }) };
        if (isBoundReturn) return { ok: true, json: async () => ({ features: [{ properties: { segments: [{ distance: 100000, duration: 10, steps: [
          { type: 13, instruction: "Keep right", name: "Some Wrong Name", distance: 95434 },
          { instruction: "Arrive", name: "", distance: 100 }
        ] }] } }] }) };
      }

      if (boundaryMode === "malformed-geo") {
        if (isFullOutbound) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: null }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Go to Local Road", name: "Local Road", distance: 100 }] }] } }] }) };
        if (isFullReturn) return { ok: true, json: async () => ({ features: [{ geometry: { coordinates: null }, properties: { segments: [{ distance: 10, duration: 10, steps: [{ instruction: "Go to Local Road", name: "Local Road", distance: 100 }] }] } }] }) };
      }

      return { ok: false, status: 500 };
    }
    return { ok: false };
  };

  // Run Boundary mode Qualifies
  boundaryMode = "qualifies";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  // Boundary messages have been removed from the application
  // assert(parsed.route_to_listing.boundary_message && parsed.route_to_listing.boundary_message.includes('Gate City Highway checkpoint near I-81 Exit 1'), "Outbound boundary messaging identifies the Gate City Highway checkpoint.");
  // assert(parsed.route_home.boundary_message && parsed.route_home.boundary_message.includes('Gate City Highway checkpoint;'), "Return boundary messaging identifies the Gate City Highway checkpoint.");
  // assert(parsed.route_home.boundary_message && parsed.route_home.boundary_message.startsWith('Take Exit 1A.'), "Return messaging still begins with Take Exit 1A.");

  const takeExit1ACount = parsed.route_home.steps.filter(s => s.instruction === 'Take Exit 1A').length;
  assert(takeExit1ACount === 1, "Qualifying return steps still contain exactly one Take Exit 1A.");

  const oldMessageRegex = /entrance ramp|off-ramp/i;
  assert(!oldMessageRegex.test(parsed.route_to_listing.boundary_message) && !oldMessageRegex.test(parsed.route_home.boundary_message), "The inaccurate entrance-ramp/off-ramp boundary messages are no longer returned by current code.");
  assert(!parsed.route_to_listing.steps.some(s => s.instruction.includes('I-81')), "Flawed full route steps not included in boundary outbound");

  // Run Boundary mode fails outbound
  boundaryMode = "bound-fail";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(!parsed.route_to_listing.available, "Outbound boundary failure isolated");
  assert(parsed.route_home.available, "Return boundary succeeds despite outbound failure");
  assert(parsed.route_home.steps.some(s => s.instruction === 'Take Exit 1A'), "Exit 1A inserted before arrival when missing");

  // Run Boundary mode No Qualify
  boundaryMode = "no-qualify";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(!parsed.route_to_listing.boundary_message, "Boundary mode not triggered for non-I-81 routes");
  assert(parsed.warnings.some(w => w.includes("Interstate pattern not identified")), "Safe warning when coordinates present but route doesn't qualify");

  // Verify normalization
  const fullSteps = parsed.route_to_listing.steps;
  assert(!fullSteps.some(s => s.instruction === 'Head west'), "A compass-only unnamed heading step is removed.");
  assert(fullSteps.some(s => s.instruction === 'Continue on Hwy 1'), "A heading step with a provider-supplied road name retains the road name without requiring a compass.");
  assert(!fullSteps.some(s => s.instruction === 'Turn right'), "An unnamed zero-distance turn is removed.");
  assert(fullSteps.some(s => s.instruction.includes('Turn left onto Main St')), "A short named maneuver is preserved.");

  // Run synthetic display fail mode
  boundaryMode = "synthetic-display-fail";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);

  const synthSteps = parsed.route_to_listing.steps;
  assert(synthSteps.some(s => s.instruction === 'Merge onto I-81 North' && s.road_name === 'I-81 North'), "The long interstate step identifies I-81 North.");
  assert(synthSteps.filter(s => s.instruction.includes('I-81 North')).length === 1, "The initial interstate wording matches the maneuver type and is not duplicated.");
  assert(synthSteps.some(s => s.instruction === 'Keep right toward Black Lick Road, VA 90'), "The short generic maneuver identifies the following provider-named road.");
  const bareManeuvers = ['Keep right', 'Keep left', 'Turn right', 'Turn left', 'Continue straight', 'Merge', 'Take the ramp'];
  assert(!synthSteps.some(s => bareManeuvers.includes(s.instruction) && !s.instruction.match(/Arrive/i)), "No displayed actionable step consists only of a bare maneuver.");
  assert(synthSteps.length < 10, "Unnamed turns that display as 0.0 mi are removed. Expected less than 10 steps.");
  const richmondStep = synthSteps.find(s => s.instruction.includes('Richmond Avenue'));
  assert(richmondStep.instruction === 'Turn right onto Richmond Avenue and watch for 123 in about 0.1 mi.', "Property cue is attached directly to the named street step");
  assert(synthSteps.some(s => s.instruction === 'Turn right onto -' && s.distance === 10), "Retains later driveway maneuvers");
  assert(synthSteps.some(s => s.instruction === 'Turn left onto -' && s.distance === 5), "Retains later micro-turn maneuvers");
  assert(!synthSteps.some(s => s.instruction.includes('Arrive')), "Contains no raw arrival instruction.");
  assert(!synthSteps.some(s => s.instruction.includes('undefined')), "No road or exit is invented.");

  const retSteps = parsed.route_home.steps;
  assert(retSteps.some(s => s.instruction.startsWith('Merge onto I-81 South')), "The equivalent return contract retains I-81 South.");
  assert(retSteps.filter(s => s.instruction === 'Take Exit 1A').length === 1, "Exactly one Take Exit 1A is retained.");
  assert(fullSteps.some(s => s.instruction.startsWith('Merge onto I-81 North')), "Useful I-81 North and I-81 South labels remain readable where applicable.");

  // Missing or malformed route geometry degrades safely
  boundaryMode = "malformed-geo";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(!parsed.route_to_listing.boundary_message, "Missing or malformed route geometry degrades safely without boundary mode.");

  // Missing config
  process.env.MEDIALAB_I81_EXIT1_NB_ENTRY_COORDS = "";
  boundaryMode = "qualifies"; // Full route would qualify, but no config
  res = await exitRouteFunction.handler({
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(!parsed.route_to_listing.boundary_message, "Boundary mode not triggered when config missing");
  assert(parsed.warnings.some(w => w.includes("missing or invalid")), "Safe warning when config missing");

  // Invalid config
  process.env.MEDIALAB_I81_EXIT1_NB_ENTRY_COORDS = "invalid,data";
  res = await exitRouteFunction.handler({
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN },
    queryStringParameters: { order_id: '123e4567-e89b-12d3-a456-426614174000' }
  });
  parsed = JSON.parse(res.body);
  assert(!parsed.route_to_listing.boundary_message, "Boundary mode not triggered when config invalid");
  assert(parsed.warnings.some(w => w.includes("missing or invalid")), "Safe warning when config invalid");
  assert(parsed.route_to_listing.available, "Full route retained on invalid config");

  global.fetch = originalFetch;

  console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed.`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
