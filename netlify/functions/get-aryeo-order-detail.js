const { verifyAuth } = require('./_shared/auth');

// General UUID regex
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const authResult = await verifyAuth(event);
  if (!authResult.ok) {
    return {
      statusCode: authResult.statusCode,
      body: JSON.stringify({ error: authResult.error })
    };
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

      return {
        statusCode: 502,
        body: JSON.stringify({ 
          error: 'Upstream Aryeo API request failed',
          diagnostic: { status, statusText, message: safeErrorMessage }
        })
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeDetailResponse(data))
    };
  } catch (error) {
    console.error(`[Aryeo API Error] Detail | Fetch failed: ${error.message}`);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream connection error' })
    };
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
