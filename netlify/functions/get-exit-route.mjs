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

const R = 6371e3;
const toRad = x => x * Math.PI / 180;

function distancePointToSegment(p, a, b) {
  const lat0 = toRad((a.lat + b.lat) / 2);
  const dx = (lng, lat) => (lng - a.lng) * Math.cos(lat0);
  const dy = (lng, lat) => (lat - a.lat);

  const px = dx(p.lng, p.lat);
  const py = dy(p.lng, p.lat);
  const bx = dx(b.lng, b.lat);
  const by = dy(b.lng, b.lat);

  const l2 = bx * bx + by * by;
  if (l2 === 0) return Math.sqrt(px * px + py * py) * R * (Math.PI / 180);

  let t = (px * bx + py * by) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = t * bx;
  const projY = t * by;

  const distSq = (px - projX) ** 2 + (py - projY) ** 2;
  return Math.sqrt(distSq) * R * (Math.PI / 180);
}

function routePassesCheckpoint(geometry, checkpoint, toleranceMeters) {
  if (!geometry || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false;
  const coords = geometry.coordinates;

  if (coords.length === 1) {
    const a = { lng: coords[0][0], lat: coords[0][1] };
    return distancePointToSegment(checkpoint, a, a) <= toleranceMeters;
  }

  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lng: coords[i][0], lat: coords[i][1] };
    const b = { lng: coords[i+1][0], lat: coords[i+1][1] };
    if (distancePointToSegment(checkpoint, a, b) <= toleranceMeters) {
      return true;
    }
  }
  return false;
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

  // Determine listing coordinates.
  let listingLat = null;
  let listingLng = null;
  let displayAddress = "";

  const addressObj = orderData.listing?.address || orderData.address || {};
  displayAddress = addressObj.unparsed_address_part_one || `${addressObj.street_number || ''} ${addressObj.street_name || ''}`.trim();
  if (addressObj.city) displayAddress += `, ${addressObj.city}`;
  if (addressObj.state_or_province) displayAddress += `, ${addressObj.state_or_province}`;

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

  // Resolve Origin Coordinates
  const originGeo = await geocode(originAddress, orsKey);
  if (!originGeo) {
    return new Response(JSON.stringify({ available: false, warnings: ["Cannot determine MEDIALAB_ROUTE_ORIGIN coordinates."] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const unavailableRoute = (warning) => ({
    available: false,
    distance: null,
    duration: null,
    steps: [],
    warnings: [warning]
  });

  const getRoute = async (startGeo, endGeo, routeOptions = {}) => {
    const dirUrl = new URL('https://api.openrouteservice.org/v2/directions/driving-car');
    dirUrl.searchParams.append('api_key', orsKey);
    dirUrl.searchParams.append('start', `${startGeo.lng},${startGeo.lat}`);
    dirUrl.searchParams.append('end', `${endGeo.lng},${endGeo.lat}`);
    dirUrl.searchParams.append('geometry_format', 'geojson');

    const orsController = new AbortController();
    const orsTimeout = setTimeout(() => orsController.abort(), 12000);
    try {
      const orsRes = await fetch(dirUrl.toString(), { signal: orsController.signal });
      if (!orsRes.ok) return unavailableRoute("OpenRouteService request failed.");
      const orsData = await orsRes.json();
      const segment = orsData?.features?.[0]?.properties?.segments?.[0];
      if (!segment) return unavailableRoute("No route found.");

      const distance = Number(segment.distance);
      const duration = Number(segment.duration);
      const rawSteps = Array.isArray(segment.steps) ? segment.steps : [];
      let steps = rawSteps
        .filter(step => typeof step?.instruction === 'string' && step.instruction.trim())
        .map((step, i) => ({
        sequence: i + 1,
        instruction: step.instruction,
        road_name: typeof step.name === 'string' ? step.name : "",
        type: step.type,
        distance: Number.isFinite(Number(step.distance)) ? Number(step.distance) : null,
        duration: Number.isFinite(Number(step.duration)) ? Number(step.duration) : null
      }));

      // Human-readable offline step normalization
      let validSteps = [];
      let i81NorthInjected = false;
      let i81SouthInjected = false;

      for (let i = 0; i < steps.length; i++) {
        let s = steps[i];
        let inst = s.instruction.trim();
        let dist = s.distance;

        // Apply I-81 North/South identity for boundary routes
        if (routeOptions.isOutboundBoundary && !i81NorthInjected) {
            if (dist > 1609 && !inst.match(/arrive|toward|exit/i)) {
                if (s.type === 12 || s.type === 13 || inst.match(/merge|keep/i)) {
                   inst = `Merge onto I-81 North`;
                } else {
                   inst = `Continue on I-81 North`;
                }
                s.road_name = "I-81 North";
                i81NorthInjected = true;
            }
        }

        if (routeOptions.isReturnBoundary && !i81SouthInjected) {
            if (dist > 1609 && !inst.match(/arrive|toward|exit/i)) {
                if (s.type === 12 || s.type === 13 || inst.match(/merge|keep/i)) {
                   inst = `Merge onto I-81 South`;
                } else {
                   inst = `Continue on I-81 South`;
                }
                s.road_name = "I-81 South";
                i81SouthInjected = true;
            }
        }

        // 1 & 2: Normalize compass headings
        const headMatch = inst.match(/^Head\s+(north|south|east|west|northeast|northwest|southeast|southwest)\b/i);
        if (headMatch) {
          const onMatch = inst.match(/\bon\s+(.+)$/i);
          let roadInfo = "";
          if (onMatch && onMatch[1].trim()) {
            roadInfo = onMatch[1].trim();
          } else if (s.road_name && s.road_name.trim()) {
            roadInfo = s.road_name.trim();
          }

          if (roadInfo) {
            inst = `Continue on ${roadInfo}`;
          } else {
            if (!s.road_name || s.road_name.trim() === "") continue;
          }
        }

        const bareManeuversRegex = /^(Turn right|Turn left|Keep right|Keep left|Merge right|Merge left|Merge|Take the ramp|Continue straight)$/i;
        if (bareManeuversRegex.test(inst)) {
            let nextRoad = "";
            if (i + 1 < steps.length && steps[i+1].road_name && steps[i+1].road_name.trim() !== "") {
                nextRoad = steps[i+1].road_name.trim();
            }
            if (s.road_name && s.road_name.trim() !== "") {
                if (/ramp|exit/i.test(s.road_name)) {
                    if (nextRoad) {
                        let exitStr = /exit/i.test(s.road_name) ? s.road_name : "the ramp";
                        inst = `Take ${exitStr} toward ${nextRoad}`;
                    } else {
                        inst = `${inst} onto ${s.road_name.trim()}`;
                    }
                } else {
                    inst = `${inst} onto ${s.road_name.trim()}`;
                }
            } else if (nextRoad) {
                inst = `${inst} toward ${nextRoad}`;
            }
        }

        let hasUsefulContext = inst.match(/toward|exit|I-81|destination|arrive|ramp|onto/i) || (s.road_name && s.road_name.trim() !== "");

        if (!hasUsefulContext) {
            let nextNamedStep = null;
            if (i + 1 < steps.length && steps[i+1].road_name && steps[i+1].road_name.trim()) {
                nextNamedStep = steps[i+1].road_name.trim();
            }
            if (nextNamedStep && inst.match(/turn|keep|continue|merge|take/i)) {
                inst = `${inst} toward ${nextNamedStep}`;
                hasUsefulContext = true;
            }
        }

        // 3 & 4: Remove meaningless unnamed zero-distance maneuvers
        const miles = dist !== null ? (dist * 0.000621371) : null;
        const displaysAsZero = miles !== null && miles < 0.05;
        const isUnnamed = !s.road_name || s.road_name.trim() === "";

        if (displaysAsZero && isUnnamed && !inst.match(/arrive|toward|onto/i)) {
           continue;
        }

        validSteps.push({
            sequence: 0,
            instruction: inst,
            road_name: s.road_name,
            distance: dist,
            duration: s.duration
        });
      }

      if (routeOptions.isOutbound) {
          let propertySide = null;
          const arrivalStep = validSteps.length > 0 ? validSteps[validSteps.length - 1] : null;
          if (arrivalStep && arrivalStep.instruction.match(/arrive/i)) {
              const sideMatch = arrivalStep.instruction.match(/on the (left|right)/i);
              if (sideMatch) propertySide = sideMatch[1].toLowerCase();
          }

          let streetNumber = addressObj.street_number;
          if (!streetNumber && addressObj.unparsed_address_part_one) {
              const parts = addressObj.unparsed_address_part_one.trim().split(/\s+/);
              if (parts[0].match(/^\d+[a-zA-Z-]?$/)) {
                  streetNumber = parts[0];
              }
          }

          let listingStreetName = addressObj.street_name;
          if (!listingStreetName && addressObj.unparsed_address_part_one) {
              const parts = addressObj.unparsed_address_part_one.trim().split(/\s+/);
              if (parts.length > 1) {
                  listingStreetName = parts.slice(1).join(' ');
              }
          }

          let matchedStepIndex = -1;

          if (streetNumber && listingStreetName) {
              const suffixMap = {
                  'ave': 'avenue', 'rd': 'road', 'st': 'street', 'hwy': 'highway',
                  'blvd': 'boulevard', 'ln': 'lane', 'dr': 'drive', 'ct': 'court',
                  'trl': 'trail', 'pkwy': 'parkway',
                  'n': 'north', 's': 'south', 'e': 'east', 'w': 'west',
                  'ne': 'northeast', 'nw': 'northwest', 'se': 'southeast', 'sw': 'southwest'
              };
              const normalizeStr = str => {
                  return str.toLowerCase()
                            .replace(/[^a-z0-9]/g, ' ')
                            .split(/\s+/)
                            .filter(Boolean)
                            .map(w => suffixMap[w] || w)
                            .join(' ');
              };

              const cleanL = normalizeStr(listingStreetName);

              for (let i = validSteps.length - 1; i >= 0; i--) {
                  if (validSteps[i].road_name && validSteps[i].road_name.trim() !== "") {
                      if (!validSteps[i].instruction.match(/arrive/i)) {
                          const cleanR = normalizeStr(validSteps[i].road_name);
                          if (cleanL && cleanR && (cleanL === cleanR || cleanR.includes(cleanL) || cleanL.includes(cleanR))) {
                              matchedStepIndex = i;
                              break;
                          }
                      }
                  }
              }
          }

          if (matchedStepIndex !== -1) {
              let remainingDistanceMeters = 0;
              for (let i = matchedStepIndex; i < validSteps.length; i++) {
                  if (validSteps[i].distance !== null) {
                      remainingDistanceMeters += validSteps[i].distance;
                  }
              }

              let distStr = "a short distance";
              if (remainingDistanceMeters > 0) {
                  const miles = remainingDistanceMeters * 0.000621371;
                  if (miles < 0.1) {
                      const feet = remainingDistanceMeters * 3.28084;
                      distStr = `${Math.round(feet / 10) * 10} ft`;
                  } else {
                      distStr = `${miles.toFixed(1)} mi`;
                  }
              }

              validSteps[matchedStepIndex].instruction += ` and watch for ${streetNumber} in about ${distStr}.`;

              // Remove the raw arrival step, but keep the unnamed driveway maneuvers
              validSteps = validSteps.filter(s => !s.instruction.match(/arrive/i));
          } else {
              console.warn(`[get-exit-route] Could not safely match listing street "${listingStreetName}" to any ORS road.`);
          }
      }

      validSteps.forEach((s, idx) => s.sequence = idx + 1);
      steps = validSteps;

      if (!Number.isFinite(distance) || !Number.isFinite(duration) || steps.length === 0) {
        return unavailableRoute("Route details were incomplete or no usable steps remained.");
      }

      return {
        available: true,
        distance,
        duration,
        steps,
        geometry: orsData?.features?.[0]?.geometry,
        warnings: []
      };
    } catch (e) {
      console.error(`[getRoute] Caught error: ${e.stack || e}`);
      return unavailableRoute(e.name === 'AbortError'
        ? "OpenRouteService request timed out."
        : "OpenRouteService request failed due to network error.");
    } finally {
      clearTimeout(orsTimeout);
    }
  };

  const listingGeo = { lng: listingLng, lat: listingLat };

  let [routeToListingResult, routeHomeResult] = await Promise.allSettled([
    getRoute(originGeo, listingGeo, { isOutbound: true }),
    getRoute(listingGeo, originGeo, { isOutbound: false })
  ]);

  let routeToListing = routeToListingResult.status === 'fulfilled'
    ? routeToListingResult.value
    : unavailableRoute("Route to listing failed to generate.");
  let routeHome = routeHomeResult.status === 'fulfilled'
    ? routeHomeResult.value
    : unavailableRoute("Route home failed to generate.");

  const parseCoords = (str) => {
    if (!str) return null;
    const parts = str.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      if (parts[0] >= -180 && parts[0] <= 180 && parts[1] >= -90 && parts[1] <= 90) {
        return { lng: parts[0], lat: parts[1] };
      }
    }
    return null;
  };

  const exit1NbCoords = parseCoords(process.env.MEDIALAB_I81_EXIT1_NB_ENTRY_COORDS);
  const exit1aSbCoords = parseCoords(process.env.MEDIALAB_I81_EXIT1A_SB_RETURN_COORDS);

  const warnings = [];

  if (!exit1NbCoords || !exit1aSbCoords) {
    warnings.push("Exit 1 boundary coordinates are missing or invalid. Using full routing.");
  } else {
    const TOLERANCE_METERS = 150;
    const outboundQualifies = routeToListing.available && routePassesCheckpoint(routeToListing.geometry, exit1NbCoords, TOLERANCE_METERS);
    const returnQualifies = routeHome.available && routePassesCheckpoint(routeHome.geometry, exit1aSbCoords, TOLERANCE_METERS);

    if (outboundQualifies || returnQualifies) {
      const boundaryPromises = [];
      if (outboundQualifies) boundaryPromises.push(getRoute(exit1NbCoords, listingGeo, { isOutboundBoundary: true, isOutbound: true }));
      else boundaryPromises.push(Promise.resolve(routeToListing));

      if (returnQualifies) boundaryPromises.push(getRoute(listingGeo, exit1aSbCoords, { isReturnBoundary: true }));
      else boundaryPromises.push(Promise.resolve(routeHome));

      const [boundOutResult, boundRetResult] = await Promise.allSettled(boundaryPromises);

      const boundOut = boundOutResult.status === 'fulfilled' ? boundOutResult.value : unavailableRoute("Boundary route to listing failed to generate.");
      const boundRet = boundRetResult.status === 'fulfilled' ? boundRetResult.value : unavailableRoute("Boundary route home failed to generate.");

      if (outboundQualifies) {
        routeToListing = boundOut;
      }
      if (returnQualifies) {
        if (boundRet.available) {
          let hasExit1A = false;
          let genericRegex = /Take Exit 1\b/i;
          for (let i = 0; i < boundRet.steps.length; i++) {
            if (/Take Exit 1A\b/i.test(boundRet.steps[i].instruction)) {
              hasExit1A = true;
              break;
            }
          }
          if (!hasExit1A) {
            for (let i = 0; i < boundRet.steps.length; i++) {
              if (genericRegex.test(boundRet.steps[i].instruction)) {
                boundRet.steps[i].instruction = boundRet.steps[i].instruction.replace(genericRegex, "Take Exit 1A");
                hasExit1A = true;
                break;
              }
            }
          }
          if (!hasExit1A && boundRet.steps.length > 0) {
            boundRet.steps.splice(boundRet.steps.length - 1, 0, {
              sequence: 0,
              instruction: "Take Exit 1A",
              road_name: "",
              distance: null,
              duration: null
            });
          }
          boundRet.steps.forEach((s, idx) => s.sequence = idx + 1);
        }
        routeHome = boundRet;
      }
    } else {
      warnings.push("Interstate pattern not identified. Using full routing.");
    }
  }

  const isAvailable = routeToListing.available || routeHome.available;
  if (!routeToListing.available) warnings.push("Manual directions to the listing are unavailable.");
  if (!routeHome.available) warnings.push("Manual directions home are unavailable.");
  if (!isAvailable) warnings.push("Neither route could be generated.");

  return new Response(JSON.stringify({
      available: isAvailable,
      order_id: orderData.id,
      order_number: orderData.number,
      listing_address: displayAddress,
      origin_address: originAddress,
      route_to_listing: routeToListing,
      route_home: routeHome,
      warnings: warnings,
      attribution: "Routing © openrouteservice; map data © OpenStreetMap contributors"
    }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
