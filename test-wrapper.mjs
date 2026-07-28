import handler from './netlify/functions/review-bridge.mjs';

// Load env vars
process.env.REVIEW_BRIDGE_SHARED_SECRET = 'TEST_SECRET_VALUE';
process.env.GOOGLE_DRIVE_QUICK_EDIT_UPLOAD_FOLDER_ID = 'MOCK_FOLDER_ID';

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url === "https://script.google.com/macros/s/AKfycbzVMn8pJwVCuTWEwI6j3EkYubloe_1_rdpUJ8RmPv5q-uL-A7m4dc4JG8ekg2WB1l7_sw/exec") {
    const payload = JSON.parse(options.body);

    // Mock Apps Script behavior
    if (payload.secret !== 'TEST_SECRET_VALUE') {
        return { ok: true, json: async () => ({ ok: false, message: 'Unauthorized' }) };
    }

    if (payload.command === 'LIST_QUICK_EDIT_QUEUE') {
        return { ok: true, json: async () => ({
            ok: true,
            listings: [
                {
                    Listing_ID: 'TEST_LISTING_1',
                    Full_Address: '123 Mock Street',
                    Returned_Edits_Status: 'QUICK_EDITS_NEEDED',
                    Items: [
                        { Review_Item_ID: 'ITEM_1', File_Name: 'photo1.jpg', Thumbnail_Link: 'http://thumb', PixelMob_Revision_Note: 'Remove cord' }
                    ]
                }
            ]
        })};
    } else if (payload.command === 'VALIDATE_QUICK_EDIT') {
        return { ok: true, json: async () => ({ ok: true, fileId: 'MOCK_GOOGLE_DRIVE_FILE_ID' }) };
    } else if (payload.command === 'UPLOAD_QUICK_EDIT') {
        return { ok: true, json: async () => ({ ok: true, newStatus: 'SEAN_FINALIZED' }) };
    }

    return { ok: true, json: async () => ({ ok: true }) };
  }

  // Real fetch for googleapis or anything else
  return originalFetch(url, options);
};

// Also we need to mock googleapis because we don't have the Service Account locally.
import { google } from 'googleapis';
google.auth.GoogleAuth = class MockAuth {
    constructor() {}
    async getClient() { return {}; }
};
google.drive = () => ({
    files: {
        get: async (params, opts) => {
            console.log(`[MOCK DRIVE] Getting file: ${params.fileId}`);
            // Return fake binary data
            const buffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00, 0x00, 0x00]);
            return { data: buffer, headers: { 'content-type': 'image/jpeg' } };
        }
    }
});

async function runLocal() {
  console.log("=== Testing LIST_QUICK_EDIT_QUEUE locally ===");
  const req1 = new Request('http://localhost/mock', {
     method: 'POST',
     headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer bypass-me'
     },
     body: JSON.stringify({ command: 'LIST_QUICK_EDIT_QUEUE' })
  });

  const res1 = await handler(req1, {});
  console.log("LIST Status:", res1.status);
  const data1 = await res1.json();
  console.log("LIST Data:", JSON.stringify(data1, null, 2));

  const targetItem = data1.listings[0].Items[0];

  console.log(`\n=== Testing DOWNLOAD_QUICK_EDIT_IMAGE locally ===`);
  const req2 = new Request('http://localhost/mock', {
     method: 'POST',
     headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer bypass-me'
     },
     body: JSON.stringify({ command: 'DOWNLOAD_QUICK_EDIT_IMAGE', Review_Item_ID: targetItem.Review_Item_ID })
  });

  const res2 = await handler(req2, {});
  console.log("DOWNLOAD Status:", res2.status);
  if (res2.status === 200) {
      const buffer = await res2.arrayBuffer();
      console.log(`DOWNLOAD Success! Received ${buffer.byteLength} bytes.`);
      console.log(`Magic bytes: ${Buffer.from(buffer).toString('hex', 0, 4)}`);
  } else {
      console.log("DOWNLOAD Error:", await res2.text());
  }

  console.log(`\n=== Testing UPLOAD_QUICK_EDIT locally ===`);
  const baseOriginalBytes = 15 * 1024 * 1024;
  const base64Bytes = Math.ceil(baseOriginalBytes * 1.333333);
  const payloadStr = 'A'.repeat(base64Bytes);

  const req3 = new Request('http://localhost/mock', {
     method: 'POST',
     headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer bypass-me'
     },
     body: JSON.stringify({
         command: 'UPLOAD_QUICK_EDIT',
         Review_Item_ID: targetItem.Review_Item_ID,
         base64: payloadStr
     })
  });

  const res3 = await handler(req3, {});
  console.log("UPLOAD Status:", res3.status);
  const data3 = await res3.json();
  console.log("UPLOAD Data:", JSON.stringify(data3, null, 2));
}

runLocal().catch(console.error);
