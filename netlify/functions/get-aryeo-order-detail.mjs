import authModule from './_shared/auth.js';
const { verifyAuth } = authModule;

// General UUID regex
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
    return new Response(JSON.stringify({ error: 'ARYEO_NOT_CONFIGURED', message: 'Aryeo integration is currently unavailable.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Real request
  const apiUrl = `https://api.aryeo.com/v1/orders/${orderId}`;
  let queryParams = new URLSearchParams();
  queryParams.append('include', 'customer,listing,appointments,appointments.users,items');

  try {
    // Allow injecting a mocked fetch for isolated local tests
    const fetchToUse = global.mockFetch || fetch;
    const response = await fetchToUse(`${apiUrl}?${queryParams.toString()}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const status = response.status;
      const statusText = response.statusText;
      let safeErrorMessage = 'Unknown upstream error';
      try {
        const errBody = await response.json();
        if (errBody && errBody.message && typeof errBody.message === 'string') safeErrorMessage = errBody.message;
        else if (errBody && errBody.error && typeof errBody.error === 'string') safeErrorMessage = errBody.error;
      } catch(e) {}
      
      console.error(`[Aryeo API Error] Detail | Status: ${status} | StatusText: ${statusText} | Msg: ${safeErrorMessage}`);

      return new Response(JSON.stringify({ 
        error: 'Upstream Aryeo API request failed',
        diagnostic: { status, statusText, message: safeErrorMessage }
      }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const data = await response.json();
    return new Response(JSON.stringify(normalizeDetailResponse(data)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[Aryeo API Error] Detail | Fetch failed: ${error.message}`);
    return new Response(JSON.stringify({ error: 'Upstream connection error' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};

function normalizeDetailResponse(payload) {
  const order = payload.data || {};
  
  const customer = order.customer || {};
  const addressObj = order.address || (order.listing && order.listing.address) || {};
  let addressStr = addressObj.street_name || addressObj.unparsed_address_part_one || "Unknown Address";
  if (addressObj.street_number && addressObj.street_name && !addressObj.unparsed_address_part_one) {
    addressStr = `${addressObj.street_number} ${addressObj.street_name}, ${addressObj.city || ''}, ${addressObj.state_or_province || ''} ${addressObj.postal_code || ''}`.trim();
  }
  // clean up trailing commas
  addressStr = addressStr.replace(/,\s*$/, "");

  const appointments = order.appointments || [];
  const firstAppt = appointments.length > 0 ? appointments[0] : null;
  const users = firstAppt && firstAppt.users ? firstAppt.users.map(u => u.first_name + " " + u.last_name).join(', ') : (order.users || []).map(u => u.first_name + " " + u.last_name).join(', ');

  let tz = "America/New_York";
  if (order.address && order.address.timezone) tz = order.address.timezone;
  else if (order.listing && order.listing.address && order.listing.address.timezone) tz = order.listing.address.timezone;
  else if (firstAppt && firstAppt.timezone) tz = firstAppt.timezone;

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    fulfillment_status: order.fulfillment_status,
    fulfilled_at: order.fulfilled_at,
    payment_status: order.payment_status || (order.invoice ? order.invoice.payment_status : null),
    total_amount: order.total_amount || (order.invoice ? order.invoice.total_amount : null),
    balance_amount: order.balance_amount || (order.invoice ? order.invoice.balance_amount : null),
    currency: order.currency || "USD",
    
    customer_name: customer.name || "Unknown",
    customer_email: customer.email || "",
    customer_phone: customer.phone || "",
    
    address: addressStr,
    
    start_at: firstAppt ? firstAppt.start_at : null,
    timezone: tz,
    appointment_status: firstAppt ? firstAppt.status : "N/A",
    
    assigned_users: users || "Unassigned",
    services: (order.items || []).map(i => i.title).join(", "),
    notes: order.notes || "",
    
    updated_at: order.updated_at || new Date().toISOString()
  };
}
