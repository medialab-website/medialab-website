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

  if (view === 'completed') {
    return await fetchCompletedOrdersFallback(apiKey, pageNum, perPageNum);
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
      const status = response.status;
      const statusText = response.statusText;
      let safeErrorMessage = 'Unknown upstream error';
      try {
        const errBody = await response.json();
        if (errBody && errBody.message && typeof errBody.message === 'string') safeErrorMessage = errBody.message;
        else if (errBody && errBody.error && typeof errBody.error === 'string') safeErrorMessage = errBody.error;
      } catch(e) {}
      
      console.error(`[Aryeo API Error] View: ${view} | Status: ${status} | StatusText: ${statusText} | Msg: ${safeErrorMessage}`);

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
      body: JSON.stringify(normalizeResponse(data, view))
    };
  } catch (error) {
    console.error(`[Aryeo API Error] View: ${view} | Fetch failed: ${error.message}`);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream connection error' })
    };
  }
};

async function fetchCompletedOrdersFallback(apiKey, pageNum, perPageNum) {
  let allFetchedOrders = [];
  const safetyLimit = 20;
  let diagnosticMsg = null;
  const maxConcurrency = 4;

  const getPage = async (page) => {
    const fetchToUse = global.mockFetch || fetch;
    const url = 'https://api.aryeo.com/v1/orders';
    const q = new URLSearchParams();
    q.append('page', page);
    q.append('per_page', 100);
    q.append('include', 'customer,listing');
    q.append('sort', '-created_at');

    const response = await fetchToUse(`${url}?${q.toString()}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
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
      
      const err = new Error('Upstream API request failed');
      err.status = status;
      err.statusText = statusText;
      err.safeErrorMessage = safeErrorMessage;
      throw err;
    }

    return await response.json();
  };

  try {
    // 1. Fetch first page to obtain pagination metadata
    const firstPagePayload = await getPage(1);
    allFetchedOrders = allFetchedOrders.concat(firstPagePayload.data || []);
    
    const meta = firstPagePayload.meta || {};
    let lastPage = meta.last_page || 1;
    
    // 2. Determine target page count based on safety limit
    let targetPageCount = lastPage;
    if (targetPageCount > safetyLimit) {
      targetPageCount = safetyLimit;
      diagnosticMsg = `Safety limit of ${safetyLimit} pages reached before retrieving all orders.`;
    }

    // 3. Fetch remaining pages with bounded concurrency (max 4)
    if (targetPageCount > 1) {
      const tasks = [];
      for (let p = 2; p <= targetPageCount; p++) {
        tasks.push(p);
      }

      for (let i = 0; i < tasks.length; i += maxConcurrency) {
        const chunk = tasks.slice(i, i + maxConcurrency);
        const results = await Promise.all(chunk.map(p => getPage(p)));
        for (const res of results) {
          allFetchedOrders = allFetchedOrders.concat(res.data || []);
        }
      }
    }

    // Deduplicate by UUID
    const seen = new Set();
    const deduplicated = [];
    for (const o of allFetchedOrders) {
      if (o && o.id && !seen.has(o.id)) {
        seen.add(o.id);
        deduplicated.push(o);
      }
    }

    // Filter
    const fulfilled = deduplicated.filter(o => o.fulfillment_status === 'FULFILLED');

    // Sort by fulfilled_at descending
    fulfilled.sort((a, b) => {
      if (a.fulfilled_at && b.fulfilled_at) {
        return new Date(b.fulfilled_at) - new Date(a.fulfilled_at);
      }
      if (a.fulfilled_at) return -1;
      if (b.fulfilled_at) return 1;
      return 0; // both lack fulfilled_at
    });

    // Paginate
    const totalItems = fulfilled.length;
    const totalPages = Math.ceil(totalItems / perPageNum) || 1;
    const p = Math.max(1, Math.min(pageNum, totalPages));
    const startIndex = (p - 1) * perPageNum;
    const paginatedOrders = fulfilled.slice(startIndex, startIndex + perPageNum);

    // Normalize
    const items = normalizeResponse({ data: paginatedOrders }, 'completed').items;

    const resBody = {
      items,
      meta: {
        total: totalItems,
        current_page: p,
        last_page: totalPages,
        per_page: items.length
      }
    };
    if (diagnosticMsg) resBody.diagnostic = { message: diagnosticMsg };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resBody)
    };

  } catch (error) {
    if (error.status) {
      console.error(`[Aryeo API Error] View: completed | Status: ${error.status} | StatusText: ${error.statusText} | Msg: ${error.safeErrorMessage}`);
      return {
        statusCode: 502,
        body: JSON.stringify({ 
          error: 'Upstream Aryeo API request failed',
          diagnostic: { status: error.status, statusText: error.statusText, message: error.safeErrorMessage }
        })
      };
    }
    console.error(`[Aryeo API Error] View: completed | Fetch failed: ${error.message}`);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream connection error' })
    };
  }
}

function normalizeResponse(payload, view) {
  const meta = payload.meta || {};
  let items = [];

  if (view === 'upcoming') {
    // Payload contains appointments
    items = (payload.data || []).map(appt => {
      // Exclude canceled appointments
      if (appt.status === 'CANCELLED' || appt.status === 'canceled') return null;
      
      const order = appt.order || {};
      if (!order.id) return null; // Exclude if no order UUID is present

      const customer = order.customer || appt.customer || {};
      const addressObj = order.address || (order.listing && order.listing.address) || (appt.listing && appt.listing.address) || {};
      let addressStr = addressObj.street_name || addressObj.unparsed_address_part_one || "Unknown Address";
      if (addressObj.street_number && addressObj.street_name && !addressObj.unparsed_address_part_one) {
        addressStr = `${addressObj.street_number} ${addressObj.street_name}`;
      }

      const services = (order.items || appt.order_items || []).map(i => i.title).join(", ");

      let tz = "America/New_York";
      if (order.address && order.address.timezone) tz = order.address.timezone;
      else if (order.listing && order.listing.address && order.listing.address.timezone) tz = order.listing.address.timezone;
      else if (appt.timezone) tz = appt.timezone;

      return {
        id: order.id, // Use order UUID as internal identifier
        number: order.number || "N/A", // Friendly Aryeo order number
        address: addressStr,
        start_at: appt.start_at,
        timezone: tz,
        customer_name: customer.name || "Unknown",
        services: services,
        status: appt.status || "SCHEDULED"
      };
    }).filter(Boolean);
  } else {
    // Payload contains orders
    items = (payload.data || []).map(order => {
      if (!order || !order.id) return null; // Exclude if no order UUID is present

      const customer = order.customer || {};
      const addressObj = order.address || (order.listing && order.listing.address) || {};
      let addressStr = addressObj.street_name || addressObj.unparsed_address_part_one || "Unknown Address";
      if (addressObj.street_number && addressObj.street_name && !addressObj.unparsed_address_part_one) {
        addressStr = `${addressObj.street_number} ${addressObj.street_name}`;
      }

      const appointments = order.appointments || [];
      const firstAppt = appointments.length > 0 ? appointments[0] : null;

      let tz = "America/New_York";
      if (order.address && order.address.timezone) tz = order.address.timezone;
      else if (order.listing && order.listing.address && order.listing.address.timezone) tz = order.listing.address.timezone;
      else if (firstAppt && firstAppt.timezone) tz = firstAppt.timezone;

      return {
        id: order.id,
        number: order.number,
        address: addressStr,
        start_at: firstAppt ? firstAppt.start_at : null,
        timezone: tz,
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
    }).filter(Boolean);
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
