import authModule from './_shared/auth.js';
import crypto from 'crypto';
import { google } from 'googleapis';

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzVMn8pJwVCuTWEwI6j3EkYubloe_1_rdpUJ8RmPv5q-uL-A7m4dc4JG8ekg2WB1l7_sw/exec";

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const authResult = await authModule.verifyAuth(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: authResult.error }), {
      status: authResult.statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Ensure this is an authorized MediaLab identity
  const allowedEmails = ['solutions@medialab.fyi', 'sean@medialab.fyi', 'thomasina@medialab.fyi'];
  if (!authResult.decodedToken || !allowedEmails.includes(authResult.decodedToken.email)) {
    return new Response(JSON.stringify({ error: 'Forbidden: Requires authorized MediaLab identity' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const allowedCommands = [
    'LIST_REVIEW_QUEUE', 'GET_LISTING_REVIEW', 'SAVE_REVIEW_DECISIONS', 'SUBMIT_LISTING_REVIEW',
    'LIST_QUICK_EDIT_QUEUE', 'DOWNLOAD_QUICK_EDIT_IMAGE', 'UPLOAD_QUICK_EDIT'
  ];
  if (!allowedCommands.includes(payload.command)) {
    return new Response(JSON.stringify({ error: 'Forbidden: Unsupported command' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const secret = process.env.REVIEW_BRIDGE_SHARED_SECRET;
  if (!secret) {
    console.error('Server configuration error: missing REVIEW_BRIDGE_SHARED_SECRET');
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Pre-flight validation/action for Quick Edits Upload
  let mockDriveFileId = null;
  let mockDriveFileName = null;

  if (payload.command === 'UPLOAD_QUICK_EDIT') {
    const isString = (v) => typeof v === 'string' && v.trim() !== '';
    if (!isString(payload.Review_Item_ID) || !isString(payload.base64) || !isString(payload.fileName) || !isString(payload.mimeType)) {
       return new Response(JSON.stringify({ code: 'MISSING_OR_INVALID_FIELDS', message: 'Required fields are missing or of invalid type.' }), { status: 400 });
    }

    // Limits
    const MAX_SIZE_BYTES = 15 * 1024 * 1024;
    const MAX_BASE64_LENGTH = Math.ceil(MAX_SIZE_BYTES / 3) * 4; // Exactly 20,971,520

    if (payload.base64.length > MAX_BASE64_LENGTH) {
       return new Response(JSON.stringify({ code: 'ENCODED_PAYLOAD_TOO_LARGE', message: 'Encoded payload exceeds maximum size limit.' }), { status: 413 });
    }

    if (payload.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.base64)) {
       return new Response(JSON.stringify({ code: 'MALFORMED_BASE64', message: 'Payload is not valid standard Base64 encoding.' }), { status: 400 });
    }

    const buffer = Buffer.from(payload.base64, 'base64');

    // Strict canonical check: re-encoding must exactly match input
    if (buffer.toString('base64') !== payload.base64) {
       return new Response(JSON.stringify({ code: 'MALFORMED_BASE64', message: 'Payload contains noncanonical Base64 encoding.' }), { status: 400 });
    }

    if (buffer.length === 0 || buffer.length > MAX_SIZE_BYTES) {
       return new Response(JSON.stringify({ code: 'DECODED_FILE_TOO_LARGE_OR_EMPTY', message: 'Decoded file is empty or exceeds 15 MiB.' }), { status: 413 });
    }

    const fileNameLower = payload.fileName.toLowerCase();
    const mimeType = payload.mimeType;
    const isJpegExt = fileNameLower.endsWith('.jpg') || fileNameLower.endsWith('.jpeg');
    const isPngExt = fileNameLower.endsWith('.png');

    if (!isJpegExt && !isPngExt) return new Response(JSON.stringify({ code: 'UNSUPPORTED_EXTENSION', message: 'File extension is not supported.' }), { status: 415 });
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return new Response(JSON.stringify({ code: 'UNSUPPORTED_MIME', message: 'MIME type is not supported.' }), { status: 415 });
    if ((isJpegExt && mimeType !== 'image/jpeg') || (isPngExt && mimeType !== 'image/png')) {
       return new Response(JSON.stringify({ code: 'MIME_EXTENSION_MISMATCH', message: 'MIME type does not agree with extension.' }), { status: 415 });
    }

    let detectedExt = null;
    let width = 0;
    let height = 0;

    if (buffer.length > 8) {
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        detectedExt = 'jpg';
        let offset = 2;
        while (offset < buffer.length - 8) {
          if (buffer[offset] !== 0xFF) { offset++; continue; }
          const marker = buffer[offset + 1];
          if (marker === 0xC0 || marker === 0xC2) {
             height = buffer.readUInt16BE(offset + 5);
             width = buffer.readUInt16BE(offset + 7);
             break;
          }
          offset += 2 + buffer.readUInt16BE(offset + 2);
        }
      } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
                 buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        detectedExt = 'png';
        if (buffer.length > 24 && buffer.toString('ascii', 12, 16) === 'IHDR') {
           width = buffer.readUInt32BE(16);
           height = buffer.readUInt32BE(20);
        }
      }
    }

    if (!detectedExt) return new Response(JSON.stringify({ code: 'STRUCTURALLY_INVALID_IMAGE', message: 'Image signature could not be verified or is corrupt.' }), { status: 422 });
    if ((detectedExt === 'jpg' && !isJpegExt) || (detectedExt === 'png' && !isPngExt)) {
      return new Response(JSON.stringify({ code: 'SIGNATURE_TYPE_MISMATCH', message: 'Detected image signature does not match declared type.' }), { status: 415 });
    }
    if (width === 0 || height === 0) return new Response(JSON.stringify({ code: 'STRUCTURALLY_INVALID_IMAGE', message: 'Image dimensions could not be extracted.' }), { status: 422 });

    const MAX_DIMENSION = 20000;
    const MAX_PIXELS = 100000000;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || (width * height) > MAX_PIXELS) {
      return new Response(JSON.stringify({ code: 'INVALID_DIMENSIONS', message: 'Image dimensions exceed maximum boundaries.' }), { status: 422 });
    }

    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);
    mockDriveFileName = `QuickEdit_${payload.Review_Item_ID}_${fileHash}.${detectedExt}`;
  }

  // Upstream command might need mapping
  let upstreamCommand = payload.command;
  if (payload.command === 'DOWNLOAD_QUICK_EDIT_IMAGE') {
      upstreamCommand = 'VALIDATE_QUICK_EDIT';
  }

  const upstreamPayload = {
    command: upstreamCommand,
    secret: secret
  };

  // Add required payload fields based on the command
  if (payload.Listing_ID) upstreamPayload.Listing_ID = payload.Listing_ID;
  if (payload.decisions) upstreamPayload.decisions = payload.decisions;
  if (payload.Review_Item_ID) upstreamPayload.Review_Item_ID = payload.Review_Item_ID;

  if (payload.command === 'UPLOAD_QUICK_EDIT') {
     upstreamPayload.Corrected_Edit_Upload = mockDriveFileName;
     upstreamPayload.base64 = payload.base64;
     upstreamPayload.mimeType = payload.mimeType;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const upstreamResponse = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(upstreamPayload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!upstreamResponse.ok) {
      console.error(`Upstream error: ${upstreamResponse.status}`);
      return new Response(JSON.stringify({ error: 'Upstream API failure' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let upstreamData;
    try {
      upstreamData = await upstreamResponse.json();
    } catch (parseErr) {
      console.error('Failed to parse upstream response:', parseErr);
      return new Response(JSON.stringify({ error: 'Invalid response from upstream' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!upstreamData.ok) {
      console.error('Upstream reported non-ok:', upstreamData);
      return new Response(JSON.stringify({ error: upstreamData.message || 'Upstream error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Sanitize and Map Response Shape
    let responseBody = { ok: true };

    if (payload.command === 'LIST_REVIEW_QUEUE') {
      responseBody.listings = (upstreamData.listings || []).map(item => ({
        Listing_ID: String(item.Listing_ID || ''),
        Full_Address: String(item.Full_Address || ''),
        Returned_Edits_Status: String(item.Returned_Edits_Status || '')
      }));
    } else if (payload.command === 'LIST_QUICK_EDIT_QUEUE') {
      responseBody.listings = (upstreamData.listings || []).map(item => ({
        Listing_ID: String(item.Listing_ID || ''),
        Full_Address: String(item.Full_Address || ''),
        Returned_Edits_Status: String(item.Returned_Edits_Status || ''),
        Items: (item.Items || []).map(i => ({
            Review_Item_ID: String(i.Review_Item_ID || ''),
            File_Name: String(i.File_Name || ''),
            Thumbnail_Link: String(i.Thumbnail_Link || ''),
            PixelMob_Revision_Note: String(i.PixelMob_Revision_Note || '')
        }))
      }));
    } else if (payload.command === 'GET_LISTING_REVIEW') {
      responseBody.listing = {
        Listing_ID: String(upstreamData.listing?.Listing_ID || ''),
        Full_Address: String(upstreamData.listing?.Full_Address || ''),
        Returned_Edits_Status: String(upstreamData.listing?.Returned_Edits_Status || '')
      };
      responseBody.items = (upstreamData.items || []).map(item => ({
        Review_Item_ID: String(item.Review_Item_ID || ''),
        File_Name: String(item.File_Name || ''),
        Thumbnail_Link: String(item.Thumbnail_Link || ''),
        Drive_View_Link: String(item.Drive_View_Link || ''),
        Review_Status: String(item.Review_Status || ''),
        PixelMob_Revision_Note: String(item.PixelMob_Revision_Note || '')
      }));
    } else if (payload.command === 'SAVE_REVIEW_DECISIONS') {
      responseBody.updatedCount = upstreamData.updatedCount || 0;
    } else if (payload.command === 'SUBMIT_LISTING_REVIEW') {
      responseBody.newStatus = String(upstreamData.newStatus || '');
    } else if (payload.command === 'DOWNLOAD_QUICK_EDIT_IMAGE') {
      // Apps Script validated the item and returned Internal_Edit_File_ID
      const fileId = upstreamData.fileId;
      if (!fileId) return new Response(JSON.stringify({ error: 'No file ID returned from upstream' }), { status: 502 });

      // Setup Drive API client using ADC
      const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
      });
      const drive = google.drive({ version: 'v3', auth });

      try {
        const fileResponse = await drive.files.get(
          { fileId: fileId, alt: 'media' },
          { responseType: 'arraybuffer' }
        );

        // Return a binary response!
        return new Response(fileResponse.data, {
          status: 200,
          headers: {
            'Content-Type': fileResponse.headers['content-type'] || 'image/jpeg',
            'Content-Disposition': `attachment; filename="QuickEdit_${payload.Review_Item_ID}.jpg"`
          }
        });
      } catch (driveErr) {
        console.error('Drive download failed:', driveErr);
        return new Response(JSON.stringify({ error: 'Failed to retrieve image from Drive' }), { status: 502 });
      }
    } else if (payload.command === 'UPLOAD_QUICK_EDIT') {
      responseBody.newStatus = String(upstreamData.newStatus || '');
    }

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Upstream fetch failed:', error);
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Upstream gateway timeout' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'Upstream gateway error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
