const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY 
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    })
  });
}

const AUTHORIZED_EMAIL = 'solutions@medialab.fyi';
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing or malformed Authorization header' }) };
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken, true);
    if (decodedToken.email !== AUTHORIZED_EMAIL) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized user' }) };
    }
  } catch (error) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  const orderId = event.queryStringParameters?.order_id;
  if (!orderId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing order_id parameter' }) };
  }
  
  if (!uuidRegex.test(orderId)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid order_id format (must be UUID)' }) };
  }

  const apiKey = process.env.ARYEO_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ARYEO_NOT_CONFIGURED', message: 'Aryeo integration is currently unavailable.' })
    };
  }

  const origin = process.env.MEDIALAB_ROUTE_ORIGIN;
  // Missing origin does not fail the plan, handled during generation

  try {
    const fetchToUse = global.mockFetch || fetch;
    const aryeoUrl = `https://api.aryeo.com/v1/orders/${orderId}?include=customer,listing,appointments,appointments.users,items`;
    
    // Timeout support for Aryeo
    const aryeoController = new AbortController();
    const aryeoTimeout = setTimeout(() => aryeoController.abort(), 8000);
    
    let aryeoRes;
    try {
      aryeoRes = await fetchToUse(aryeoUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        signal: aryeoController.signal
      });
    } catch(e) {
      if (e.name === 'AbortError') {
        throw new Error("Aryeo request timed out");
      }
      throw e;
    } finally {
      clearTimeout(aryeoTimeout);
    }

    if (!aryeoRes.ok) {
      let safeErrorMessage = 'Unknown upstream error';
      try {
        const errBody = await aryeoRes.json();
        if (errBody && errBody.message && typeof errBody.message === 'string') safeErrorMessage = errBody.message;
      } catch(e) {}
      
      console.error(`[Mission Plan API Error] Aryeo Status: ${aryeoRes.status} | Msg: ${safeErrorMessage}`);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Upstream Aryeo API request failed' })
      };
    }

    const orderData = await aryeoRes.json();
    const plan = await generateMissionPlan(orderData.data, origin, fetchToUse);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan)
    };

  } catch (error) {
    console.error(`[Mission Plan Error] Fetch failed: ${error.message}`);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream connection error' })
    };
  }
};

async function generateMissionPlan(order, origin, fetchToUse) {
  const warnings = [];
  const now = new Date();

  // 1. Order Normalization
  const customer = order.customer || {};
  const services = (order.items || []).map(i => i.title).join(", ");
  
  // 2. Appointment Selection
  const appointments = order.appointments || [];
  let selectedAppt = null;
  
  for (const appt of appointments) {
    if (appt.status !== 'CANCELLED' && appt.status !== 'canceled') {
      const start = new Date(appt.start_at);
      if (start >= now) {
        if (!selectedAppt || start < new Date(selectedAppt.start_at)) {
          selectedAppt = appt;
        }
      }
    }
  }
  
  if (!selectedAppt) {
    warnings.push("No upcoming active appointment found.");
  } else if (selectedAppt.status !== 'SCHEDULED' && selectedAppt.status !== 'CONFIRMED') {
    warnings.push("Appointment is unconfirmed.");
  }

  const users = selectedAppt && selectedAppt.users ? selectedAppt.users.map(u => u.first_name + " " + u.last_name).join(', ') : "Unassigned";
  if (users === "Unassigned") {
    warnings.push("No crew assigned to the appointment.");
  }

  // 3. Address & Coordinates
  const addressObj = order.address || (order.listing && order.listing.address) || {};
  let addressStr = addressObj.street_name || addressObj.unparsed_address_part_one || "";
  if (addressObj.street_number && addressObj.street_name && !addressObj.unparsed_address_part_one) {
    addressStr = `${addressObj.street_number} ${addressObj.street_name}, ${addressObj.city || ''}, ${addressObj.state_or_province || ''} ${addressObj.postal_code || ''}`.trim();
  }
  addressStr = addressStr.replace(/,\s*$/, "");

  const hasMissingAddress = !addressStr || addressStr.toLowerCase().includes('tbd');
  if (hasMissingAddress) {
    warnings.push("Property address is missing or TBD.");
  }

  let lat = null, lng = null;
  if (order.listing && order.listing.address && order.listing.address.latitude && order.listing.address.longitude) {
    lat = order.listing.address.latitude;
    lng = order.listing.address.longitude;
  } else if (order.address && order.address.latitude && order.address.longitude) {
    lat = order.address.latitude;
    lng = order.address.longitude;
  }

  if (!lat || !lng) {
    warnings.push("Property coordinates are missing.");
  }

  let tz = "America/New_York";
  if (order.address && order.address.timezone) tz = order.address.timezone;
  else if (order.listing && order.listing.address && order.listing.address.timezone) tz = order.listing.address.timezone;
  else if (selectedAppt && selectedAppt.timezone) tz = selectedAppt.timezone;

  // 4. Checklist Generation
  const checklist = [
    "Camera batteries charged",
    "SD cards formatted",
    "Tripod packed",
    "Lenses cleaned",
    "Bracketing preset verified",
    "Walk the property before shooting",
    "Identify hero spaces and lighting problems",
    "Complete departure, arrival, and exit checks"
  ];

  const sLower = services.toLowerCase();
  if (sLower.includes('drone') || sLower.includes('aerial')) {
    checklist.push("Drone batteries charged");
    checklist.push("Drone firmware checked");
    checklist.push("Airspace reviewed");
    checklist.push("Wind and precipitation reviewed");
  }

  if (sLower.includes('matterport') || sLower.includes('virtual tour') || sLower.includes('3d') || sLower.includes('theta')) {
    checklist.push("Required scanner/Theta equipment packed");
    checklist.push("Scanner battery and storage checked");
  }

  if (sLower && !sLower.includes('photo') && !sLower.includes('video') && !sLower.includes('drone') && !sLower.includes('aerial') && !sLower.includes('matterport') && !sLower.includes('3d') && !sLower.includes('virtual') && !sLower.includes('floor')) {
     warnings.push("Unrecognized service requiring manual gear review.");
  }

  // 5. Directions Generation
  let directions = { available: false, url: null, message: null };
  if (!origin) {
    directions.message = "Directions unavailable — route origin not configured.";
    warnings.push("Directions unavailable — route origin not configured.");
  } else if (hasMissingAddress && (!lat || !lng)) {
    directions.message = "Directions unavailable — listing location required.";
    warnings.push("Directions unavailable — listing location required.");
  } else {
    const dest = (lat && lng) ? `${lat},${lng}` : addressStr;
    const url = new URL("https://www.google.com/maps/dir/?api=1");
    url.searchParams.append('origin', origin);
    url.searchParams.append('destination', dest);
    url.searchParams.append('travelmode', 'driving');
    directions.available = true;
    directions.url = url.toString();
  }

  // 6. Weather Fetch
  let weather = { available: false, message: null };
  if (!selectedAppt) {
    weather.message = "Weather unavailable — appointment missing.";
    warnings.push("Weather unavailable — appointment missing.");
  } else if (!lat || !lng) {
    weather.message = "Weather unavailable — property coordinates missing.";
    warnings.push("Weather unavailable — property coordinates missing.");
  } else {
    try {
      const nwsController = new AbortController();
      const nwsTimeout = setTimeout(() => nwsController.abort(), 8000);
      
      const pRes = await fetchToUse(`https://api.weather.gov/points/${lat},${lng}`, {
        headers: { 'User-Agent': 'MediaLabOperationsConsole/0.1 (https://medialab.fyi)', 'Accept': 'application/geo+json' },
        signal: nwsController.signal
      });
      clearTimeout(nwsTimeout);

      if (pRes.ok) {
        const pData = await pRes.json();
        const forecastUrl = pData.properties?.forecastHourly;

        if (forecastUrl && forecastUrl.startsWith('https://api.weather.gov/')) {
          const fController = new AbortController();
          const fTimeout = setTimeout(() => fController.abort(), 8000);
          const fRes = await fetchToUse(forecastUrl, {
             headers: { 'User-Agent': 'MediaLabOperationsConsole/0.1 (https://medialab.fyi)', 'Accept': 'application/geo+json' },
             signal: fController.signal
          });
          clearTimeout(fTimeout);

          if (fRes.ok) {
            const fData = await fRes.json();
            const periods = fData.properties?.periods || [];
            const apptTime = new Date(selectedAppt.start_at).getTime();
            
            let matchedPeriod = null;
            for (const p of periods) {
              const pStart = new Date(p.startTime).getTime();
              const pEnd = new Date(p.endTime).getTime();
              if (apptTime >= pStart && apptTime < pEnd) {
                matchedPeriod = p;
                break;
              }
            }

            if (matchedPeriod) {
              weather = {
                available: true,
                source: "National Weather Service",
                period_start: matchedPeriod.startTime,
                period_end: matchedPeriod.endTime,
                temperature: matchedPeriod.temperature,
                temperature_unit: matchedPeriod.temperatureUnit,
                short_forecast: matchedPeriod.shortForecast,
                precipitation_probability: matchedPeriod.probabilityOfPrecipitation?.value,
                wind_speed: matchedPeriod.windSpeed,
                wind_direction: matchedPeriod.windDirection,
                updated_at: fData.properties?.updated
              };
            } else {
              weather.message = "Forecast not yet available — check closer to the appointment.";
              warnings.push("Forecast not yet available — check closer to the appointment.");
            }
          } else {
             weather.message = "Weather service temporarily unavailable.";
             warnings.push("Weather service temporarily unavailable.");
          }
        } else {
          weather.message = "Weather service temporarily unavailable.";
          warnings.push("Weather service temporarily unavailable.");
        }
      } else {
         weather.message = "Weather service temporarily unavailable.";
         warnings.push("Weather service temporarily unavailable.");
      }
    } catch (e) {
      console.error(`[Mission Plan NWS Error] ${e.message}`);
      weather.message = "Weather service temporarily unavailable.";
      warnings.push("Weather service temporarily unavailable.");
    }
  }

  return {
    generated_at: now.toISOString(),
    aryeo_updated_at: order.updated_at || now.toISOString(),
    order: {
      id: order.id,
      number: order.number,
      customer_name: customer.name || "Unknown",
      address: addressStr || "TBD",
      notes: order.notes || ""
    },
    appointment: selectedAppt ? {
      id: selectedAppt.id,
      start_at: selectedAppt.start_at,
      end_at: selectedAppt.end_at,
      status: selectedAppt.status,
      timezone: tz
    } : null,
    crew: users,
    services: services || "None",
    weather: weather,
    directions: directions,
    checklist: checklist,
    warnings: warnings
  };
}
