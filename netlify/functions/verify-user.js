const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Initialize Firebase Admin with just the projectId.
// This is sufficient to securely verify ID tokens using Google's public keys.
if (!getApps().length) {
  initializeApp({
    projectId: 'gen-lang-client-0976387792'
  });
}

const AUTHORIZED_EMAIL = 'solutions@medialab.fyi';

exports.handler = async (event, context) => {
  // Get Authorization header
  const authHeader = event.headers.authorization || event.headers.Authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { 
      statusCode: 401, 
      body: JSON.stringify({ error: 'Missing or malformed Authorization header' }) 
    };
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // Verify the ID token
    const decodedToken = await getAuth().verifyIdToken(idToken);
    
    // Require the verified email to match exactly
    if (decodedToken.email !== AUTHORIZED_EMAIL) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: `Access Denied: The account ${decodedToken.email} is not authorized for server-side access.` })
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

  } catch (error) {
    // Return 401 for invalid or expired tokens
    console.error('Error verifying token:', error);
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid or expired token' })
    };
  }
};
