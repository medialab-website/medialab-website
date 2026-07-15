const { getAuth } = require('firebase-admin/auth');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { google } = require('googleapis');

// Initialize Firebase Admin (reused logic)
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
      return {
        statusCode: 403,
        body: JSON.stringify({ error: `Access Denied: The account ${decodedToken.email} is not authorized for server-side access.` })
      };
    }
  } catch (error) {
    console.error('Error verifying token:', error);
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid, expired, or revoked token' }) };
  }

  try {
    const serviceAccountEmail = process.env.DRIVE_SERVICE_ACCOUNT_EMAIL;
    const rawPrivateKey = process.env.DRIVE_PRIVATE_KEY;
    const folderId = process.env.DRIVE_APPROVED_FOLDER_ID;

    if (!serviceAccountEmail || !rawPrivateKey || !folderId) {
      console.error('Missing Drive server configuration');
      return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const drivePrivateKey = rawPrivateKey.replace(/\\n/g, '\n');

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: serviceAccountEmail,
        private_key: drivePrivateKey,
      },
      scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly']
    });

    const drive = google.drive({ version: 'v3', auth });

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives'
    });

    const items = response.data.files.map(file => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      itemType: file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
      modifiedTime: file.modifiedTime || null,
      webViewLink: file.webViewLink || null
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        scope: "approved-proof-folder",
        items: items
      })
    };

  } catch (error) {
    console.error('Error fetching Drive data:', error);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream API failure' })
    };
  }
};
