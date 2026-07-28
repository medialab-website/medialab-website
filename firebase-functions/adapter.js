export async function createNetlifyRequest(expressReq) {
  const url = `https://${expressReq.get('host') || 'localhost'}${expressReq.originalUrl}`;
  const options = {
    method: expressReq.method,
    headers: expressReq.headers,
  };
  
  if (['POST', 'PUT', 'PATCH'].includes(expressReq.method)) {
    // In Firebase Functions, expressReq.rawBody contains the raw Buffer
    options.body = expressReq.rawBody || expressReq.body;
  }
  
  return new Request(url, options);
}

export async function adaptResponse(netlifyResponse, expressRes) {
  netlifyResponse.headers.forEach((value, key) => {
    expressRes.setHeader(key, value);
  });
  
  const buffer = await netlifyResponse.arrayBuffer();
  expressRes.status(netlifyResponse.status).send(Buffer.from(buffer));
}

export function createHandler(netlifyHandler) {
  return async (req, res) => {
    try {
      const netlifyReq = await createNetlifyRequest(req);
      const netlifyRes = await netlifyHandler(netlifyReq, {});
      await adaptResponse(netlifyRes, res);
    } catch (error) {
      console.error('Adapter error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
