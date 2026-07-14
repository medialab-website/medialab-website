const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Initialize Firebase Admin using Service Account credentials from environment variables.
// The private key might have literal '\n' characters from Netlify/dotenv that need to be parsed.
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
    // Verify the ID token and check if it has been revoked (requires IAM permission)
    const decodedToken = await getAuth().verifyIdToken(idToken, true);
    
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
