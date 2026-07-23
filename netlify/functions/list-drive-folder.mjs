import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getAuth } = require('firebase-admin/auth');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { google } = require('googleapis');

import authModule from './_shared/auth.js';
const { verifyAuth } = authModule;

export default async (req, context) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const authResult = await verifyAuth(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), { status: authResult.statusCode, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const serviceAccountEmail = process.env.DRIVE_SERVICE_ACCOUNT_EMAIL;
    const rawPrivateKey = process.env.DRIVE_PRIVATE_KEY;
    const folderId = process.env.DRIVE_APPROVED_FOLDER_ID;

    if (!serviceAccountEmail || !rawPrivateKey || !folderId) {
      console.error('Missing Drive server configuration');
      return new Response(JSON.stringify({ error: 'Server configuration error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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

    return new Response(JSON.stringify({
      ok: true,
      scope: "approved-proof-folder",
      items: items
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error fetching Drive data:', error);
    return new Response(JSON.stringify({ error: 'Upstream API failure' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
