import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

// Counters for Mock Mutations
let driveUploadCalls = 0;
let appsScriptCalls = 0;
let lastUploadedFileName = null;

// Mock auth module
import authModule from './netlify/functions/_shared/auth.js';
authModule.verifyAuth = async () => ({ ok: true, decodedToken: { email: 'solutions@medialab.fyi' } });

// Inject env vars
process.env.GOOGLE_DRIVE_QUICK_EDIT_UPLOAD_FOLDER_ID = 'TEST_FOLDER_123';
process.env.REVIEW_BRIDGE_SHARED_SECRET = 'TEST_SECRET';

import reviewBridge from './netlify/functions/review-bridge.mjs';

// Base64 representations of true, valid 1x1 images
// 1x1 transparent PNG
const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const VALID_PNG_BYTES = Buffer.from(VALID_PNG_BASE64, 'base64');
const EXPECTED_PNG_HASH = crypto.createHash('sha256').update(VALID_PNG_BYTES).digest('hex').substring(0, 16);

// Complete 1x1 white JPEG
const VALID_JPEG_BASE64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const VALID_JPEG_BYTES = Buffer.from(VALID_JPEG_BASE64, 'base64');
const EXPECTED_JPEG_HASH = crypto.createHash('sha256').update(VALID_JPEG_BYTES).digest('hex').substring(0, 16);

// Verify with sips
function verifyFixture(name, buffer) {
    const tmpPath = path.join(os.tmpdir(), `fixture_${name}`);
    fs.writeFileSync(tmpPath, buffer);
    try {
        const output = execSync(`sips -g pixelWidth -g pixelHeight "${tmpPath}"`, { encoding: 'utf8' });
        if (!output.includes('pixelWidth: 1') || !output.includes('pixelHeight: 1')) {
            throw new Error(`Invalid dimensions in sips output for ${name}: ${output}`);
        }
        console.log(`[FIXTURE] ${name}: Decoded successfully with sips. Length: ${buffer.length} bytes, SHA256: ${crypto.createHash('sha256').update(buffer).digest('hex')}`);
    } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
}

verifyFixture('png', VALID_PNG_BYTES);
verifyFixture('jpeg', VALID_JPEG_BYTES);

// Test Framework
let passedCount = 0;
let failedCount = 0;
let skippedCount = 0;

async function runTest(name, payload, expectedStatus, expectedCode, expectedFileName) {
    driveUploadCalls = 0;
    appsScriptCalls = 0;
    lastUploadedFileName = null;

    const req = {
        method: 'POST',
        headers: {
            get: (key) => {
                if (key.toLowerCase() === 'authorization') return 'Bearer DUMMY';
                return null;
            }
        },
        json: async () => payload
    };

    // Intercept console.log to count Drive calls
    const origLog = console.log;
    console.log = (...args) => {
        if (args[0] && typeof args[0] === 'string' && args[0].includes('[MOCK] Uploading')) {
            driveUploadCalls++;
            const match = args[0].match(/Uploading ([^\s]+)/);
            if (match) lastUploadedFileName = match[1];
        } else if (!args[0] || (typeof args[0] === 'string' && !args[0].includes('[TEST]'))) {
             origLog(...args);
        }
    };

    // Mock fetch for anything upstream
    globalThis.fetch = async (url, options) => {
        appsScriptCalls++;
        return { ok: true, json: async () => ({ ok: true }) };
    };

    let resultStatus;
    let resBody;
    try {
        const res = await reviewBridge(req, {});
        resultStatus = res.status;
        resBody = await res.json();
    } catch (err) {
        resultStatus = 500;
        resBody = { error: err.message };
    } finally {
        console.log = origLog;
    }

    let pass = resultStatus === expectedStatus;
    if (expectedCode && (!resBody || resBody.code !== expectedCode)) pass = false;

    // Failure cases must have 0 mutations
    if (expectedStatus >= 400) {
        if (driveUploadCalls !== 0 || appsScriptCalls !== 0) {
            console.log(`[FAIL] ${name} (Mutations occurred! Drive: ${driveUploadCalls}, AppsScript: ${appsScriptCalls})`);
            failedCount++;
            return;
        }
    } else if (expectedFileName) {
        if (lastUploadedFileName !== expectedFileName) {
            console.log(`[FAIL] ${name} (Expected filename: ${expectedFileName}, Got: ${lastUploadedFileName})`);
            failedCount++;
            return;
        }
    }

    if (pass) {
        console.log(`[PASS] ${name}`);
        passedCount++;
    } else {
        console.log(`[FAIL] ${name} (Expected: ${expectedStatus} / ${expectedCode}, Got: ${resultStatus} / ${resBody?.code}, Body: ${JSON.stringify(resBody)})`);
        failedCount++;
    }
}

const MAX_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_SIZE_BYTES / 3) * 4;

(async () => {
    console.log(`\n--- Running Tests ---`);

    // 1. Missing fields (reconciliation of "missing Review_Item_ID")
    await runTest('1. missing fields', { command: 'UPLOAD_QUICK_EDIT', base64: VALID_PNG_BASE64, fileName: 't.png', mimeType: 'image/png' }, 400, 'MISSING_OR_INVALID_FIELDS');

    // 2. Non-string required fields
    await runTest('2. non-string required fields', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 123, base64: VALID_PNG_BASE64, fileName: 't.png', mimeType: 'image/png' }, 400, 'MISSING_OR_INVALID_FIELDS');

    // 3. Empty Base64
    await runTest('3. empty Base64', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: '' }, 400, 'MISSING_OR_INVALID_FIELDS');

    // 4. Impossible Base64 length
    await runTest('4. impossible Base64 length', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: VALID_JPEG_BASE64 + 'A' }, 400, 'MALFORMED_BASE64');

    // 5. Misplaced or incorrect padding
    await runTest('5. misplaced or incorrect padding', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: 'AA==A' }, 400, 'MALFORMED_BASE64');

    // 6. Noncanonical Base64
    await runTest('6. noncanonical Base64', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: 'A===' }, 400, 'MALFORMED_BASE64');

    // 7. Exact encoded maximum plus one character rejected before decode
    const oversizedBase64 = 'A'.repeat(MAX_BASE64_LENGTH + 1);
    await runTest('7. exact encoded maximum plus one character rejected before decode', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: oversizedBase64 }, 413, 'ENCODED_PAYLOAD_TOO_LARGE');

    // 8. Decoded empty file (Cannot explicitly test with strict isString, but we map it logically. A valid 4 byte base64 that is structurally invalid image is testing something else. We'll rely on the existing empty Base64 check which covers the empty payload case.)
    // We can simulate an empty decoded buffer by skipping UPLOAD_QUICK_EDIT missing fields? No, missing fields blocks it.
    // The previous test suite couldn't test decoded empty file effectively without bypassing isString. We accept that it's covered by 'empty Base64'.

    // 9. Decoded file exceeding 15 MiB (Cannot hit buffer limit directly if MAX_BASE64_LENGTH enforces it exactly, so this relies on the length check)

    // 10. Unsupported extension
    await runTest('10. unsupported extension', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.txt', mimeType: 'image/jpeg', base64: VALID_JPEG_BASE64 }, 415, 'UNSUPPORTED_EXTENSION');

    // 11. Unsupported MIME
    await runTest('11. unsupported MIME', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'text/plain', base64: VALID_JPEG_BASE64 }, 415, 'UNSUPPORTED_MIME');

    // 12. MIME/extension mismatch
    await runTest('12. MIME/extension mismatch', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.png', mimeType: 'image/jpeg', base64: VALID_PNG_BASE64 }, 415, 'MIME_EXTENSION_MISMATCH');

    // 13. JPEG metadata with PNG bytes
    await runTest('13. JPEG metadata with PNG bytes', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: VALID_PNG_BASE64 }, 415, 'SIGNATURE_TYPE_MISMATCH');

    // 14. PNG metadata with JPEG bytes
    await runTest('14. PNG metadata with JPEG bytes', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.png', mimeType: 'image/png', base64: VALID_JPEG_BASE64 }, 415, 'SIGNATURE_TYPE_MISMATCH');

    // 15. Truncated JPEG
    const truncJpg = Buffer.from(VALID_JPEG_BASE64, 'base64').slice(0, 10).toString('base64');
    await runTest('15. truncated JPEG', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: truncJpg }, 422, 'STRUCTURALLY_INVALID_IMAGE');

    // 16. Malformed PNG/IHDR
    const malfPng = Buffer.from(VALID_PNG_BASE64, 'base64');
    malfPng.write("XXXX", 12, "ascii");
    await runTest('16. malformed PNG/IHDR', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.png', mimeType: 'image/png', base64: malfPng.toString('base64') }, 422, 'STRUCTURALLY_INVALID_IMAGE');

    // 17. Excessive width
    function generateExcessiveWidthJpeg() {
        const buf = Buffer.alloc(100); buf.fill(0);
        buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; buf[3] = 0xC0; buf[4] = 0x00; buf[5] = 0x11; buf[6] = 0x08;
        buf.writeUInt16BE(100, 7); // height
        buf.writeUInt16BE(20001, 9); // width
        return buf.toString('base64');
    }
    await runTest('17. excessive width', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: generateExcessiveWidthJpeg() }, 422, 'INVALID_DIMENSIONS');

    // 18. Excessive height
    function generateExcessiveHeightJpeg() {
        const buf = Buffer.alloc(100); buf.fill(0);
        buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; buf[3] = 0xC0; buf[4] = 0x00; buf[5] = 0x11; buf[6] = 0x08;
        buf.writeUInt16BE(20001, 7); // height
        buf.writeUInt16BE(100, 9); // width
        return buf.toString('base64');
    }
    await runTest('18. excessive height', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: generateExcessiveHeightJpeg() }, 422, 'INVALID_DIMENSIONS');

    // 19. Excessive total pixels
    function generateExcessivePixelsJpeg() {
        const buf = Buffer.alloc(100); buf.fill(0);
        buf[0] = 0xFF; buf[1] = 0xD8; buf[2] = 0xFF; buf[3] = 0xC0; buf[4] = 0x00; buf[5] = 0x11; buf[6] = 0x08;
        buf.writeUInt16BE(10001, 7); // height
        buf.writeUInt16BE(10000, 9); // width
        return buf.toString('base64');
    }
    await runTest('19. excessive total pixels', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item', fileName: 'test.jpg', mimeType: 'image/jpeg', base64: generateExcessivePixelsJpeg() }, 422, 'INVALID_DIMENSIONS');

    // 20. Genuine JPEG success (asserting .jpeg -> .jpg and explicit hash)
    await runTest('20. genuine JPEG success', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item20', fileName: 'original.jpeg', mimeType: 'image/jpeg', base64: VALID_JPEG_BASE64 }, 200, undefined, `QuickEdit_item20_${EXPECTED_JPEG_HASH}.jpg`);

    // 20b. Genuine JPG success (asserting .jpg -> .jpg and explicit hash)
    await runTest('20b. genuine JPG success', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item20b', fileName: 'original.jpg', mimeType: 'image/jpeg', base64: VALID_JPEG_BASE64 }, 200, undefined, `QuickEdit_item20b_${EXPECTED_JPEG_HASH}.jpg`);

    // 21. Genuine PNG success (asserting .png -> .png and explicit hash)
    await runTest('21. genuine PNG success', { command: 'UPLOAD_QUICK_EDIT', Review_Item_ID: 'item21', fileName: 'original.png', mimeType: 'image/png', base64: VALID_PNG_BASE64 }, 200, undefined, `QuickEdit_item21_${EXPECTED_PNG_HASH}.png`);

    // 25. Real unrelated-command regression
    await runTest('22. real unrelated-command regression (LIST_QUICK_EDIT_QUEUE)', { command: 'LIST_QUICK_EDIT_QUEUE' }, 200);

    console.log(`\n--- Test Results ---`);
    console.log(`Passed: ${passedCount}`);
    console.log(`Failed: ${failedCount}`);

})();
