const { verifyAuth } = require('./_shared/auth');

exports.handler = async (event, context) => {
  const authResult = await verifyAuth(event);
  
  if (!authResult.ok) {
    return {
      statusCode: authResult.statusCode,
      body: JSON.stringify({ error: authResult.error })
    };
  }

  // Return minimal success payload
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ok: true,
      authorized: true,
      service: "MediaLab Operations Console PoC",
      message: "Server authorization verified"
    })
  };
};
