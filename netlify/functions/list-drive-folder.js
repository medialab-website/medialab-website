const { getAuth } = require('firebase-admin/auth');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { google } = require('googleapis');

const { verifyAuth } = require('./_shared/auth');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const authResult = await verifyAuth(event);
  if (!authResult.ok) {
    return {
      statusCode: authResult.statusCode,
      body: JSON.stringify({ error: authResult.error })
    };
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
