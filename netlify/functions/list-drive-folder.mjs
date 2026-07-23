import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { google } = require('googleapis');

import authModule from './_shared/auth.js';
const { verifyAuth } = authModule;
import { executeDriveList } from './_shared/drive-core.mjs';

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

    const result = await executeDriveList(drive, folderId);

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    const status = error.message === 'Server configuration error: missing folder ID' ? 500 : 502;
    return new Response(JSON.stringify({ error: error.message || 'Upstream API failure' }), { status, headers: { 'Content-Type': 'application/json' } });
  }
};
