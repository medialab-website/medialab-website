import authModule from './_shared/auth.js';

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzVMn8pJwVCuTWEwI6j3EkYubloe_1_rdpUJ8RmPv5q-uL-A7m4dc4JG8ekg2WB1l7_sw/exec";

export default async (req, context) => {
  // CORS is typically handled by the Firebase Hosting wrapper or client same-origin,
  // but if needed we can add headers. For now, strict POST check.
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 1. Verify Authorization
  const authResult = await authModule.verifyAuth(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 2. Validate Client Payload
  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (payload.command !== 'LIST_REVIEW_QUEUE') {
    return new Response(JSON.stringify({ error: 'Forbidden: Unsupported command' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. Obtain Secret
  const secret = process.env.FIREBASE_REVIEW_BRIDGE_SECRET;
  if (!secret) {
    console.error('Server configuration error: missing FIREBASE_REVIEW_BRIDGE_SECRET');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 4. Forward to Apps Script
  const upstreamPayload = {
    command: payload.command,
    secret: secret
  };

  try {
    // Add timeout using AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const upstreamResponse = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(upstreamPayload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!upstreamResponse.ok) {
      console.error(`Upstream error: ${upstreamResponse.status}`);
      return new Response(JSON.stringify({ error: 'Upstream API failure' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let upstreamData;
    try {
      upstreamData = await upstreamResponse.json();
    } catch (parseErr) {
      console.error('Failed to parse upstream response:', parseErr);
      return new Response(JSON.stringify({ error: 'Invalid response from upstream' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!upstreamData.ok) {
      console.error('Upstream reported non-ok:', upstreamData);
      return new Response(JSON.stringify({ error: upstreamData.message || 'Upstream error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Sanitize and Map Response Shape
    const listings = (upstreamData.listings || []).map(item => ({
      Listing_ID: String(item.Listing_ID || ''),
      Full_Address: String(item.Full_Address || ''),
      Returned_Edits_Status: String(item.Returned_Edits_Status || '')
    }));

    return new Response(JSON.stringify({
      ok: true,
      listings: listings
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Upstream fetch failed:', error);
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Upstream gateway timeout' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'Upstream gateway error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
