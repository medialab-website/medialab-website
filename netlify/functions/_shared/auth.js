const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Initialize Firebase Admin using Service Account credentials from environment variables.
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

const APPROVED_ACCOUNTS = [
  'solutions@medialab.fyi',
  'sean@medialab.fyi',
  'thomasina@medialab.fyi'
];

/**
 * Shared authorization policy for MediaLab Operations Console.
 * Validates the Firebase ID token and enforces the approved account list.
 * 
 * @param {Request} request - The standard web Request object.
 * @returns {Promise<Object>} Object containing { error, statusCode } on failure, or { ok: true, decodedToken } on success.
 */
async function verifyAuth(request) {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { 
      statusCode: 401, 
      error: 'Missing or malformed Authorization header'
    };
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // Verify the ID token and check if it has been revoked
    const decodedToken = await getAuth().verifyIdToken(idToken, true);
    
    if (decodedToken.email_verified !== true) {
       return {
         statusCode: 403,
         error: `Access Denied: The account email is not verified.`
       };
    }

    const email = (decodedToken.email || '').trim().toLowerCase();

    if (!APPROVED_ACCOUNTS.includes(email)) {
      return {
        statusCode: 403,
        error: `Access Denied: The account ${email} is not authorized for server-side access.`
      };
    }

    return { ok: true, decodedToken };
  } catch (error) {
    console.error('Error verifying token:', error);
    return {
      statusCode: 401,
      error: 'Invalid or expired token'
    };
  }
}

module.exports = {
  verifyAuth,
  APPROVED_ACCOUNTS
};
