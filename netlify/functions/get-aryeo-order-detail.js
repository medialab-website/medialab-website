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

// Simple UUID regex
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Upstream Aryeo API request failed' })
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeDetailResponse(data))
    };
  } catch (error) {
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
    timezone: firstAppt ? firstAppt.timezone : "America/New_York",
    appointment_status: firstAppt ? firstAppt.status : "N/A",
    
    assigned_users: users || "Unassigned",
    services: (order.items || []).map(i => i.title).join(", "),
    notes: order.notes || "",
    
    updated_at: order.updated_at || new Date().toISOString()
  };
}
