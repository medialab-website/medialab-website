import authModule from './_shared/auth.js';
const { verifyAuth } = authModule;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function geocode(address, apiKey) {
  const url = new URL('https://api.openrouteservice.org/geocode/search');
  url.searchParams.append('api_key', apiKey);
  url.searchParams.append('text', address);
  url.searchParams.append('size', '1');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return null;
    let data;
    try {
      const text = await res.text();
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (data && data.features && data.features.length > 0 && data.features[0].geometry && data.features[0].geometry.coordinates) {
      // GeoJSON: [longitude, latitude]
      const coords = data.features[0].geometry.coordinates;
      if (Array.isArray(coords) && coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
        return { lng: coords[0], lat: coords[1] };
      }
    }
  } catch (error) {
    // Return null without logging or exposing url/keys
  } finally {
    clearTimeout(timeoutId);
  }
  return null;
}

export default async (req, context) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const authResult = await verifyAuth(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const orderId = new URL(req.url).searchParams.get('order_id');
  if (!orderId || !uuidRegex.test(orderId)) {
    return new Response(JSON.stringify({ error: 'Invalid or missing order_id format (must be UUID)' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const aryeoKey = process.env.ARYEO_API_KEY;
  if (!aryeoKey) {
    return new Response(JSON.stringify({ error: 'ARYEO_NOT_CONFIGURED', message: 'Aryeo API key is missing.' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const orsKey = process.env.OPENROUTESERVICE_API_KEY;
  const originAddress = process.env.MEDIALAB_ROUTE_ORIGIN;

  if (!orsKey || !originAddress) {
    return new Response(JSON.stringify({
        available: false,
        warnings: ["Routing configuration is incomplete. Missing OPENROUTESERVICE_API_KEY or MEDIALAB_ROUTE_ORIGIN."]
      }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // Fetch from Aryeo
  let orderData;
  const aryeoController = new AbortController();
  const aryeoTimeout = setTimeout(() => aryeoController.abort(), 8000);
  try {
    const aryeoRes = await fetch(`https://api.aryeo.com/v1/orders/${orderId}?include=listing`, {
      headers: {
        'Authorization': `Bearer ${aryeoKey}`,
        'Accept': 'application/json'
      },
      signal: aryeoController.signal
    });
    if (!aryeoRes.ok) {
      return new Response(JSON.stringify({ error: 'Upstream Aryeo API request failed' }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    const json = await aryeoRes.json();
    orderData = json.data;
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Upstream Aryeo API request failed' }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } finally {
    clearTimeout(aryeoTimeout);
  }

  // Determine Listing Coordinates and State
  let listingLat = null;
  let listingLng = null;
  let listingState = "";
  let displayAddress = "";

  const addressObj = orderData.listing?.address || orderData.address || {};
  displayAddress = addressObj.unparsed_address_part_one || `${addressObj.street_number || ''} ${addressObj.street_name || ''}`.trim();
  if (addressObj.city) displayAddress += `, ${addressObj.city}`;
  if (addressObj.state_or_province) displayAddress += `, ${addressObj.state_or_province}`;

  listingState = (addressObj.state_or_province || "").toLowerCase();

  if (Number.isFinite(parseFloat(addressObj.latitude)) && Number.isFinite(parseFloat(addressObj.longitude))) {
    listingLat = parseFloat(addressObj.latitude);
    listingLng = parseFloat(addressObj.longitude);
  } else {
    // Attempt Geocode
    if (displayAddress) {
      const geo = await geocode(displayAddress, orsKey);
      if (geo) {
        listingLat = geo.lat;
        listingLng = geo.lng;
      }
    }
  }

  if (listingLat === null || listingLng === null) {
    return new Response(JSON.stringify({ available: false, warnings: ["Cannot determine listing coordinates."] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const isVA = listingState === "va" || listingState === "virginia";
  const isTN = listingState === "tn" || listingState === "tennessee";

  if (!isVA && !isTN) {
    return new Response(JSON.stringify({
        available: false,
        warnings: ["Listing state is unsupported for offline return route detection. Must be VA or TN."]
      }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // Resolve Origin Coordinates
  const originGeo = await geocode(originAddress, orsKey);
  if (!originGeo) {
    return new Response(JSON.stringify({ available: false, warnings: ["Cannot determine MEDIALAB_ROUTE_ORIGIN coordinates."] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // Fetch OpenRouteService directions
  let orsData;
  const orsController = new AbortController();
  const orsTimeout = setTimeout(() => orsController.abort(), 12000);
  try {
    const dirUrl = new URL('https://api.openrouteservice.org/v2/directions/driving-car');
    dirUrl.searchParams.append('api_key', orsKey);
    dirUrl.searchParams.append('start', `${listingLng},${listingLat}`);
    dirUrl.searchParams.append('end', `${originGeo.lng},${originGeo.lat}`);
    
    const orsRes = await fetch(dirUrl.toString(), { signal: orsController.signal });
    if (!orsRes.ok) {
       return new Response(JSON.stringify({ available: false, warnings: ["OpenRouteService request failed."] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    orsData = await orsRes.json();
  } catch (e) {
    return new Response(JSON.stringify({ available: false, warnings: ["OpenRouteService request failed due to timeout or network error."] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } finally {
    clearTimeout(orsTimeout);
  }

  if (!orsData.features || orsData.features.length === 0) {
    return new Response(JSON.stringify({ available: false, warnings: ["No route found."] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const segment = orsData.features[0].properties.segments[0];
  const steps = segment.steps || [];

  let targetLabel = isVA ? "I-81 SOUTH RETURN ROUTE" : "I-81 NORTH TO VIRGINIA EXIT 1";
  let targetEntryFound = false;
  let truncatedSteps = [];
  const warnings = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const road = (step.name || "").toLowerCase();
    const inst = (step.instruction || "").toLowerCase();
    
    truncatedSteps.push({
      sequence: i + 1,
      instruction: step.instruction,
      road_name: step.name || "",
      distance: step.distance,
      duration: step.duration
    });

    let found = false;
    if (isVA) {
      if (road.includes('i-81 s') || road.includes('i 81 south') || road.includes('interstate 81 south') || inst.includes('i-81 s') || inst.includes('i 81 south') || inst.includes('interstate 81 south')) {
        found = true;
      }
    } else {
      if (road.includes('i-81 n') || road.includes('i 81 north') || road.includes('interstate 81 north') || inst.includes('i-81 n') || inst.includes('i 81 north') || inst.includes('interstate 81 north')) {
        found = true;
      }
    }

    if (found) {
      targetEntryFound = true;
      break;
    }
  }

  if (!targetEntryFound) {
    warnings.push("Could not confidently identify interstate entry. Verify this manual fallback route.");
  }

  return new Response(JSON.stringify({
      available: true,
      order_id: orderData.id,
      order_number: orderData.number,
      listing_address: displayAddress,
      state: isVA ? "VA" : "TN",
      target_label: targetLabel,
      target_direction: isVA ? "SOUTH" : "NORTH",
      target_entry_found: targetEntryFound,
      generated_at: new Date().toISOString(),
      distance: segment.distance,
      duration: segment.duration,
      steps: truncatedSteps,
      warnings: warnings,
      attribution: "Routing © openrouteservice; map data © OpenStreetMap contributors"
    }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
