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

  const { view, page = 1, per_page = 25, search = '' } = event.queryStringParameters || {};
  
  // Parameter validation
  const pageNum = parseInt(page, 10);
  const perPageNum = parseInt(per_page, 10);
  if (isNaN(pageNum) || pageNum < 1) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid page parameter' }) };
  if (isNaN(perPageNum) || perPageNum < 1 || perPageNum > 100) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid per_page parameter' }) };

  const validViews = ['upcoming', 'completed', 'all'];
  if (view && !validViews.includes(view)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid view parameter' }) };
  }

  const apiKey = process.env.ARYEO_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ARYEO_NOT_CONFIGURED', message: 'Aryeo integration is currently unavailable.' })
    };
  }

  let apiUrl = 'https://api.aryeo.com/v1';
  let queryParams = new URLSearchParams();
  queryParams.append('page', pageNum);
  queryParams.append('per_page', perPageNum);

  if (view === 'upcoming') {
    apiUrl += '/appointments';
    queryParams.append('filter[tense]', 'UPCOMING');
    // Using documented appointment-related expansions. 
    queryParams.append('include', 'order,order.customer,order.listing,order.items,users');
    queryParams.append('sort', 'start_at');
  } else if (view === 'completed') {
    apiUrl += '/orders';
    queryParams.append('filter[fulfillment_status]', 'FULFILLED');
    queryParams.append('include', 'customer,listing,appointments,appointments.users,items');
    // Using created_at as safe documented sort, since fulfilled_at sorting requires live verification
    queryParams.append('sort', '-created_at'); 
  } else {
    // ALL ORDERS
    apiUrl += '/orders';
    queryParams.append('include', 'customer,listing,appointments,appointments.users,items');
    queryParams.append('sort', '-created_at');
    if (search && search.trim() !== '') {
      queryParams.append('filter[search]', search.trim());
    }
  }

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
      body: JSON.stringify(normalizeResponse(data, view))
    };
  } catch (error) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream connection error' })
    };
  }
};

function normalizeResponse(payload, view) {
  const meta = payload.meta || {};
  let items = [];

  if (view === 'upcoming') {
    // Payload contains appointments
    items = (payload.data || []).map(appt => {
      // Exclude canceled appointments
      if (appt.status === 'CANCELLED' || appt.status === 'canceled') return null;
      
      const order = appt.order || {};
      const customer = order.customer || appt.customer || {};
      const addressObj = order.address || (order.listing && order.listing.address) || (appt.listing && appt.listing.address) || {};
      let addressStr = addressObj.street_name || addressObj.unparsed_address_part_one || "Unknown Address";
      if (addressObj.street_number && addressObj.street_name && !addressObj.unparsed_address_part_one) {
        addressStr = `${addressObj.street_number} ${addressObj.street_name}`;
      }

      const services = (order.items || appt.order_items || []).map(i => i.title).join(", ");

      return {
        id: order.id || appt.id, // Use order UUID as internal identifier
        number: order.number || "N/A", // Friendly Aryeo order number
        address: addressStr,
        start_at: appt.start_at,
        timezone: appt.timezone || "America/New_York",
        customer_name: customer.name || "Unknown",
        services: services,
        status: appt.status || "SCHEDULED"
      };
    }).filter(Boolean);
  } else {
    // Payload contains orders
    items = (payload.data || []).map(order => {
      const customer = order.customer || {};
      const addressObj = order.address || (order.listing && order.listing.address) || {};
      let addressStr = addressObj.street_name || addressObj.unparsed_address_part_one || "Unknown Address";
      if (addressObj.street_number && addressObj.street_name && !addressObj.unparsed_address_part_one) {
        addressStr = `${addressObj.street_number} ${addressObj.street_name}`;
      }

      const appointments = order.appointments || [];
      const firstAppt = appointments.length > 0 ? appointments[0] : null;

      return {
        id: order.id,
        number: order.number,
        address: addressStr,
        start_at: firstAppt ? firstAppt.start_at : null,
        timezone: firstAppt ? firstAppt.timezone : "America/New_York",
        customer_name: customer.name || "Unknown",
        services: (order.items || []).map(i => i.title).join(", "),
        fulfillment_status: order.fulfillment_status,
        fulfilled_at: order.fulfilled_at,
        payment_status: order.payment_status || (order.invoice ? order.invoice.payment_status : null),
        total_amount: order.total_amount || (order.invoice ? order.invoice.total_amount : null),
        balance_amount: order.balance_amount || (order.invoice ? order.invoice.balance_amount : null),
        currency: order.currency || "USD",
        status: order.status
      };
    });
  }

  return {
    items,
    meta: {
      total: meta.total || items.length,
      current_page: meta.current_page || 1,
      last_page: meta.last_page || 1,
      per_page: meta.per_page || items.length
    }
  };
}
