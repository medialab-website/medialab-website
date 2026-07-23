import authModule from './_shared/auth.js';
const { verifyAuth } = authModule;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async (req, context) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const authResult = await verifyAuth(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.statusCode, headers: { 'Content-Type': 'application/json' } });
  }

  const orderId = new URL(req.url).searchParams.get('order_id');
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'Missing order_id parameter' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  
  if (!uuidRegex.test(orderId)) {
    return new Response(JSON.stringify({ error: 'Invalid order_id format (must be UUID)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const apiKey = process.env.ARYEO_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ARYEO_NOT_CONFIGURED', message: 'Aryeo integration is currently unavailable.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
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
      return new Response(JSON.stringify({ error: 'Upstream Aryeo API request failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const orderData = await aryeoRes.json();
    const plan = await generateMissionPlan(orderData.data, origin, fetchToUse);

    return new Response(JSON.stringify(plan), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`[Mission Plan Error] Fetch failed: ${error.message}`);
    return new Response(JSON.stringify({ error: 'Upstream connection error' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};

async function generateMissionPlan(order, origin, fetchToUse) {
  const warnings = [];
  const now = new Date();

  // 1. Order Normalization
  const customer = order.customer || {};
  const services = (order.items || []).map(i => i.title || i.name).filter(Boolean).join(", ");
  
  // 2. Appointment Selection
  const appointments = order.appointments || [];
  let selectedAppt = null;
  
  for (const appt of appointments) {
    const statusLower = (appt.status || "").toLowerCase();
    if (statusLower !== 'cancelled' && statusLower !== 'canceled') {
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
  } else {
    const sLower = (selectedAppt.status || "").toLowerCase();
    if (sLower !== 'scheduled' && sLower !== 'confirmed') {
      warnings.push("Appointment is unconfirmed.");
    }
  }

  const users = selectedAppt && selectedAppt.users ? selectedAppt.users.map(u => u.first_name + " " + u.last_name).join(', ') : "Unassigned";
  if (users === "Unassigned") {
    warnings.push("No crew assigned to the appointment.");
  }

  // 3. Address & Coordinates
  let addressObj = {};
  if (order.listing && order.listing.address && (order.listing.address.street_name || order.listing.address.unparsed_address_part_one)) {
    addressObj = order.listing.address;
  } else if (order.address && (order.address.street_name || order.address.unparsed_address_part_one)) {
    addressObj = order.address;
  }

  let addressParts = [];
  if (addressObj.unparsed_address_part_one) {
    addressParts.push(addressObj.unparsed_address_part_one);
  } else if (addressObj.street_number && addressObj.street_name) {
    addressParts.push(`${addressObj.street_number} ${addressObj.street_name}`);
  }

  if (addressParts.length > 0) {
    if (addressObj.city) addressParts.push(addressObj.city);
    if (addressObj.state_or_province) {
      let stZip = addressObj.state_or_province;
      if (addressObj.postal_code) stZip += ` ${addressObj.postal_code}`;
      addressParts.push(stZip);
    } else if (addressObj.postal_code) {
      addressParts.push(addressObj.postal_code);
    }
  }

  let addressStr = addressParts.join(", ").trim();

  const hasMissingAddress = !addressStr || addressStr.toLowerCase().includes('tbd');
  if (hasMissingAddress) {
    warnings.push("Property address is missing or TBD.");
  }

  let lat = null, lng = null;
  if (order.listing && order.listing.address && Number.isFinite(parseFloat(order.listing.address.latitude)) && Number.isFinite(parseFloat(order.listing.address.longitude))) {
    lat = parseFloat(order.listing.address.latitude);
    lng = parseFloat(order.listing.address.longitude);
  } else if (order.address && Number.isFinite(parseFloat(order.address.latitude)) && Number.isFinite(parseFloat(order.address.longitude))) {
    lat = parseFloat(order.address.latitude);
    lng = parseFloat(order.address.longitude);
  }

  if (lat === null || lng === null) {
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
      let pRes;
      try {
        pRes = await fetchToUse(`https://api.weather.gov/points/${lat},${lng}`, {
          headers: { 'User-Agent': 'MediaLabOperationsConsole/0.1 (https://medialab.fyi)', 'Accept': 'application/geo+json' },
          signal: nwsController.signal
        });
      } finally {
        clearTimeout(nwsTimeout);
      }

      if (pRes.ok) {
        const pData = await pRes.json();
        const forecastUrl = pData.properties?.forecastHourly;

        let isValidUrl = false;
        if (forecastUrl) {
          try {
            const u = new URL(forecastUrl);
            isValidUrl = (u.protocol === 'https:' && u.hostname === 'api.weather.gov');
          } catch (e) {
            isValidUrl = false;
          }
        }

        if (isValidUrl) {
          const fController = new AbortController();
          const fTimeout = setTimeout(() => fController.abort(), 8000);
          let fRes;
          try {
            fRes = await fetchToUse(forecastUrl, {
               headers: { 'User-Agent': 'MediaLabOperationsConsole/0.1 (https://medialab.fyi)', 'Accept': 'application/geo+json' },
               signal: fController.signal
            });
          } finally {
            clearTimeout(fTimeout);
          }

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
    } catch (error) {
      console.error(`[Weather Fetch Error] ${error.message}`);
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
