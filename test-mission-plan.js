
const mockRequire = require('module').prototype.require;
require('module').prototype.require = function(path) {
  if (path === 'firebase-admin/app') {
    return { initializeApp: () => {}, getApps: () => [{ name: '[DEFAULT]' }], cert: () => {} };
  }
  if (path === 'firebase-admin/auth') {
    return { 
      getAuth: () => ({
        verifyIdToken: async (token) => {
          if (token === 'VALID_TOKEN') return { email: 'solutions@medialab.fyi', email_verified: true };
          if (token === 'UNAUTHORIZED_USER') return { email: 'stranger@example.com', email_verified: true };
          throw new Error('Invalid token');
        }
      }) 
    };
  }
  return mockRequire.apply(this, arguments);
};

let missionPlanFunction;

let passCount = 0;
let failCount = 0;

global.assert = function(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    failCount++;
  }
};

const AUTHORIZED_TOKEN = 'Bearer VALID_TOKEN';
const NOW = new Date().getTime();
const FUTURE_1H = new Date(NOW + 3600000).toISOString();
const FUTURE_2H = new Date(NOW + 7200000).toISOString();
const PAST_1H = new Date(NOW - 3600000).toISOString();

async function runTests() {
  console.log("=== RUNNING MISSION PLAN TESTS ===");
  const mod = await import('./netlify/functions/get-mission-plan.mjs');
  missionPlanFunction = {
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
      return { statusCode: res.status, body: await res.text() };
    }
  };

  // Firebase Auth is globally mocked at the top of the file.

  process.env.ARYEO_API_KEY = 'TEST_KEY';
  process.env.MEDIALAB_ROUTE_ORIGIN = '123 Base St, City, ST 12345';

  let res, parsed;

  // Test 1: Auth boundaries
  res = await missionPlanFunction.handler({ httpMethod: 'GET', headers: {} });
  assert(res.statusCode === 401, "Missing auth returns 401");
  res = await missionPlanFunction.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer INVALID' } });
  assert(res.statusCode === 401, "Invalid token returns 401");
  res = await missionPlanFunction.handler({ httpMethod: 'GET', headers: { authorization: 'Bearer UNAUTHORIZED_USER' } });
  assert(res.statusCode === 403, "Unauthorized email returns 403");

  // Test 2: UUID validation
  res = await missionPlanFunction.handler({ httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN } });
  assert(res.statusCode === 400, "Missing order_id returns 400");
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: '123' } 
  });
  assert(res.statusCode === 400, "Invalid order_id format returns 400");

  // Base mock fetch for Aryeo
  const baseOrder = {
    id: "a23e4567-e89b-12d3-a456-426614174000",
    number: 12345,
    customer: { name: "Agent Smith" },
    listing: {
      address: {
        street_number: "100", street_name: "Test Ave", city: "Test City", state_or_province: "TC", postal_code: "12345",
        latitude: 40.0, longitude: -80.0
      }
    },
    appointments: [
      { id: "appt-1", status: "SCHEDULED", start_at: FUTURE_1H, end_at: FUTURE_2H, users: [{first_name: "Jane", last_name: "Doe"}] }
    ],
    items: [{title: "Photography"}, {title: "Drone Services"}, {title: "Matterport 3D Tour"}]
  };

  global.mockFetch = async (url) => {
    if (url.includes('api.aryeo.com')) {
      return { ok: true, json: async () => ({ data: baseOrder }) };
    }
    if (url.includes('api.weather.gov/points/')) {
      return { ok: true, json: async () => ({ properties: { forecastHourly: "https://api.weather.gov/gridpoints/TEST/1,1/forecast/hourly" } }) };
    }
    if (url.includes('api.weather.gov/gridpoints/')) {
      return {
        ok: true,
        json: async () => ({
          properties: {
            periods: [
              { startTime: new Date(NOW).toISOString(), endTime: FUTURE_1H, temperature: 70, temperatureUnit: "F", shortForecast: "Sunny" },
              { startTime: FUTURE_1H, endTime: FUTURE_2H, temperature: 75, temperatureUnit: "F", shortForecast: "Partly Cloudy", probabilityOfPrecipitation: { value: 10 }, windSpeed: "5 mph", windDirection: "NW" }
            ]
          }
        })
      };
    }
    return { ok: false, status: 404 };
  };

  // Test 3: Successful Base Generation
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  assert(res.statusCode === 200, "Valid data returns 200");
  parsed = JSON.parse(res.body);

  assert(parsed.order.id === baseOrder.id, "Order ID normalized");
  assert(parsed.crew === "Jane Doe", "Crew normalized");
  assert(parsed.appointment.id === "appt-1", "Appointment normalized");
  assert(parsed.weather.available === true, "Weather matched");
  assert(parsed.weather.temperature === 75, "Exact weather period matched appointment start");
  assert(parsed.directions.available === true, "Directions generated");
  assert(parsed.directions.url.includes('123+Base+St') || parsed.directions.url.includes('123%20Base%20St'), "URL encoded origin");
  console.log('DIRECTIONS URL:', parsed.directions.url);
  assert(parsed.directions.url.includes('40%2C-80') || parsed.directions.url.includes('40,-80') || parsed.directions.url.includes('40%2C+-80'), "Dest uses coordinates");
  
  // Test 4: Deterministic Checklist
  const c = parsed.checklist.join(' ');
  assert(c.includes('Drone batteries charged'), "Drone checklist added");
  assert(c.includes('Required scanner'), "Matterport checklist added");
  
  // Test 5: Missing Route Origin Degrades Gracefully
  delete process.env.MEDIALAB_ROUTE_ORIGIN;
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  parsed = JSON.parse(res.body);
  assert(parsed.directions.available === false, "Missing origin disables directions");
  assert(parsed.warnings.some(w => w.includes('route origin not configured')), "Missing origin adds warning");
  process.env.MEDIALAB_ROUTE_ORIGIN = '123 Base St, City, ST 12345'; // Restore

  // Test 6: Missing Coordinates / TBD Address
  const noCoordOrder = JSON.parse(JSON.stringify(baseOrder));
  noCoordOrder.listing.address = { street_name: "TBD" }; // No lat/lng, TBD address
  global.mockFetch = async (url) => {
    if (url.includes('api.aryeo.com')) return { ok: true, json: async () => ({ data: noCoordOrder }) };
    return { ok: false };
  };
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  parsed = JSON.parse(res.body);
  assert(parsed.directions.available === false, "Directions unavailable for TBD address");
  assert(parsed.warnings.some(w => w.includes('Property address is missing or TBD')), "TBD warning added");
  assert(parsed.weather.available === false, "Weather unavailable without coordinates");

  // Test 7: Forecast Outside Range
  const outOfRangeOrder = JSON.parse(JSON.stringify(baseOrder));
  outOfRangeOrder.appointments[0].start_at = new Date(NOW + 864000000).toISOString(); // 10 days out
  global.mockFetch = async (url) => {
    if (url.includes('api.aryeo.com')) return { ok: true, json: async () => ({ data: outOfRangeOrder }) };
    if (url.includes('api.weather.gov/points/')) return { ok: true, json: async () => ({ properties: { forecastHourly: "https://api.weather.gov/gridpoints/TEST/1,1/forecast/hourly" } }) };
    if (url.includes('api.weather.gov/gridpoints/')) return {
        ok: true, json: async () => ({ properties: { periods: [ { startTime: new Date(NOW).toISOString(), endTime: FUTURE_1H, temperature: 70 } ] } })
    };
    return { ok: false };
  };
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  parsed = JSON.parse(res.body);
  assert(parsed.weather.available === false, "Weather unavailable if outside forecast range");
  assert(parsed.warnings.some(w => w.includes('Forecast not yet available')), "Out of range warning added");

  // Test 8: NWS Outage / Hostname validation
  const badNwsOrder = JSON.parse(JSON.stringify(baseOrder));
  global.mockFetch = async (url) => {
    if (url.includes('api.aryeo.com')) return { ok: true, json: async () => ({ data: badNwsOrder }) };
    if (url.includes('api.weather.gov/points/')) return { ok: true, json: async () => ({ properties: { forecastHourly: "http://malicious.com/forecast" } }) }; // Not https://api.weather.gov
    return { ok: false };
  };
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  parsed = JSON.parse(res.body);
  assert(parsed.weather.available === false, "Weather handles NWS outage/invalid hostname gracefully");

  // Test 9: Appointment Selection (Cancelled / Past / Multiple)
  const multiApptOrder = JSON.parse(JSON.stringify(baseOrder));
  multiApptOrder.appointments = [
    { id: "appt-cancel", status: "CANCELLED", start_at: FUTURE_1H, end_at: FUTURE_2H },
    { id: "appt-past", status: "SCHEDULED", start_at: PAST_1H, end_at: NOW },
    { id: "appt-future-2", status: "SCHEDULED", start_at: FUTURE_2H, end_at: new Date(NOW + 10000000).toISOString() },
    { id: "appt-future-1", status: "SCHEDULED", start_at: FUTURE_1H, end_at: FUTURE_2H } // Should pick this one (earliest future)
  ];
  global.mockFetch = async (url) => {
    if (url.includes('api.aryeo.com')) return { ok: true, json: async () => ({ data: multiApptOrder }) };
    return { ok: false };
  };
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  parsed = JSON.parse(res.body);
  assert(parsed.appointment.id === "appt-future-1", "Selected earliest future non-cancelled appointment");

  // Test 10: Empty order address fallback & Complete construction
  const emptyAddrOrder = JSON.parse(JSON.stringify(baseOrder));
  emptyAddrOrder.address = {};
  emptyAddrOrder.listing.address = {
    unparsed_address_part_one: "456 Test Blvd",
    city: "Testville",
    state_or_province: "TX",
    postal_code: "67890"
  };
  global.mockFetch = async (url) => {
    if (url.includes('api.aryeo.com')) return { ok: true, json: async () => ({ data: emptyAddrOrder }) };
    if (url.includes('api.weather.gov')) return { ok: false };
    return { ok: false };
  };
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  parsed = JSON.parse(res.body);
  assert(parsed.directions.url.includes(encodeURIComponent('456 Test Blvd, Testville, TX 67890').replace(/%20/g, '+')) || parsed.directions.url.includes(encodeURIComponent('456 Test Blvd, Testville, TX 67890')), "Listing address fallback and complete construction succeeded");

  // Test 11: item.name service matching
  const itemNameOrder = JSON.parse(JSON.stringify(baseOrder));
  itemNameOrder.items = [{ name: "Drone Photography" }];
  global.mockFetch = async (url) => {
    if (url.includes('api.aryeo.com')) return { ok: true, json: async () => ({ data: itemNameOrder }) };
    if (url.includes('api.weather.gov')) return { ok: false };
    return { ok: false };
  };
  res = await missionPlanFunction.handler({ 
    httpMethod: 'GET', headers: { authorization: AUTHORIZED_TOKEN }, queryStringParameters: { order_id: baseOrder.id } 
  });
  parsed = JSON.parse(res.body);
  const c2 = parsed.checklist.join(' ');
  assert(c2.includes('Drone batteries charged'), "item.name service matched drone condition");
  console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed.`);
  if (failCount > 0) process.exit(1);
}

runTests().catch(e => { console.error(e); process.exit(1); });
