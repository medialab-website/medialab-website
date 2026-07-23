import authModule from './_shared/auth.js';
const { verifyAuth } = authModule;

export default async (req, context) => {
  const authResult = await verifyAuth(req);
  
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Return minimal success payload
  return new Response(JSON.stringify({
    ok: true,
    authorized: true,
    service: "MediaLab Operations Console PoC",
    message: "Server authorization verified"
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
