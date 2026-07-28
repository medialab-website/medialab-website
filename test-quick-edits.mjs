import fetch from 'node-fetch';
import fs from 'fs';

const BRIDGE_URL = 'http://localhost:8888/.netlify/functions/review-bridge';

async function runTest() {
  console.log("=== Testing LIST_QUICK_EDIT_QUEUE ===");
  const listRes = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer bypass-me` },
    body: JSON.stringify({ command: 'LIST_QUICK_EDIT_QUEUE' })
  });
  console.log("LIST Status:", listRes.status);
  const listData = await listRes.json();
  console.log("LIST Data:", JSON.stringify(listData, null, 2));

  if (!listData.listings || listData.listings.length === 0) {
     console.log("No listings found. Stopping test.");
     return;
  }

  const targetItem = listData.listings[0].Items[0];
  if (!targetItem) {
     console.log("No items found. Stopping test.");
     return;
  }

  console.log(`\n=== Testing DOWNLOAD_QUICK_EDIT_IMAGE for item ${targetItem.Review_Item_ID} ===`);
  const dlRes = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer bypass-me` },
    body: JSON.stringify({ command: 'DOWNLOAD_QUICK_EDIT_IMAGE', Review_Item_ID: targetItem.Review_Item_ID })
  });
  console.log("DOWNLOAD Status:", dlRes.status);
  if (dlRes.status === 200) {
      const buffer = await dlRes.arrayBuffer();
      console.log(`DOWNLOAD Success! Received ${buffer.byteLength} bytes.`);
  } else {
      console.log("DOWNLOAD Error:", await dlRes.text());
  }

  console.log(`\n=== Testing UPLOAD_QUICK_EDIT for item ${targetItem.Review_Item_ID} ===`);
  // Create 15MiB mock base64
  console.log("Generating 15MiB base64 payload...");
  const baseOriginalBytes = 15 * 1024 * 1024;
  const base64Bytes = Math.ceil(baseOriginalBytes * 1.333333);
  const payloadStr = 'A'.repeat(base64Bytes);

  const uploadRes = await fetch(BRIDGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer bypass-me` },
    body: JSON.stringify({
        command: 'UPLOAD_QUICK_EDIT',
        Review_Item_ID: targetItem.Review_Item_ID,
        base64: payloadStr
    })
  });
  console.log("UPLOAD Status:", uploadRes.status);
  const uploadData = await uploadRes.json();
  console.log("UPLOAD Data:", JSON.stringify(uploadData, null, 2));
}

runTest();
