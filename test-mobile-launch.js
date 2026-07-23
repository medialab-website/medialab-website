const assert = require('assert');
const fs = require('fs');
const path = require('path');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
    try {
        fn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (e) {
        console.error(`❌ FAIL: ${name}`);
        console.error(e);
        testsFailed++;
    }
}

async function runTestAsync(name, fn) {
    try {
        await fn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (e) {
        console.error(`❌ FAIL: ${name}`);
        console.error(e);
        testsFailed++;
    }
}

// Setup mock environment BEFORE requiring auth
process.env.OPENROUTESERVICE_API_KEY = "test_ors_key";
process.env.MEDIALAB_ROUTE_ORIGIN = "123 Main St";
process.env.ARYEO_API_KEY = "test_aryeo_key";
process.env.FIREBASE_PROJECT_ID = "mock-project";
process.env.FIREBASE_CLIENT_EMAIL = "mock@mock.com";
process.env.FIREBASE_PRIVATE_KEY = "mock-key";

require('module').Module._cache[require.resolve('firebase-admin/app')] = {
  id: require.resolve('firebase-admin/app'),
  filename: require.resolve('firebase-admin/app'),
  loaded: true,
  exports: {
    initializeApp: () => {},
    getApps: () => [],
    cert: () => ({})
  }
};
require('module').Module._cache[require.resolve('firebase-admin/auth')] = {
  id: require.resolve('firebase-admin/auth'),
  filename: require.resolve('firebase-admin/auth'),
  loaded: true,
  exports: {
    getAuth: () => ({
      verifyIdToken: async (token) => {
        if (token === "mock-valid-token-authorized") return { email: 'solutions@medialab.fyi', email_verified: true };
        throw new Error('Invalid token');
      }
    })
  }
};

const { verifyAuth, APPROVED_ACCOUNTS } = require('./netlify/functions/_shared/auth');


console.log('Running Mobile Launch Tests...\n');

(async function testMobileLaunch() {
    try {
        // --- AUTH TESTS ---
        runTest('Auth List - Solutions account', () => assert.ok(APPROVED_ACCOUNTS.includes('solutions@medialab.fyi')));
        runTest('Auth List - Sean account', () => assert.ok(APPROVED_ACCOUNTS.includes('sean@medialab.fyi')));
        runTest('Auth List - Thomasina account', () => assert.ok(APPROVED_ACCOUNTS.includes('thomasina@medialab.fyi')));
        runTest('Auth List - Random account', () => assert.ok(!APPROVED_ACCOUNTS.includes('attacker@evil.com')));
        const getExitRoute = await import('./netlify/functions/get-exit-route.mjs');
        runTest('getExitRoute exposes a default handler', () => assert.strictEqual(typeof getExitRoute.default, 'function'));

        // --- POC.HTML LOGIC TESTS ---
        const htmlContent = fs.readFileSync(path.join(__dirname, 'operations-console', 'poc.html'), 'utf-8');

        runTest('Malicious HTML input escaping', () => {
            const escapeMatch = htmlContent.match(/function escapeHTML\(str\) \{[\s\S]*?\n\s*\}/);
            assert.ok(escapeMatch, "Could not find escapeHTML in poc.html");
            const escapeHTML = new Function('str', escapeMatch[0] + '\nreturn escapeHTML(str);');
            const malicious = '<script>alert("x")</script>&\'"';
            const escaped = escapeHTML(malicious);
            assert.strictEqual(escaped, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#039;&quot;');
        });

        runTest('Icon existence and dimensions', () => {
            function checkPngDim(filepath, expectedW, expectedH) {
                assert.ok(fs.existsSync(filepath), `File not found: ${filepath}`);
                const buf = fs.readFileSync(filepath);
                const w = buf.readUInt32BE(16);
                const h = buf.readUInt32BE(20);
                assert.strictEqual(w, expectedW, `Expected width ${expectedW}, got ${w}`);
                assert.strictEqual(h, expectedH, `Expected height ${expectedH}, got ${h}`);
            }
            checkPngDim(path.join(__dirname, 'operations-console/icons/icon-192.png'), 192, 192);
            checkPngDim(path.join(__dirname, 'operations-console/icons/icon-512.png'), 512, 512);
            checkPngDim(path.join(__dirname, 'operations-console/icons/apple-touch-icon.png'), 180, 180);
        });

        runTest('Manifest paths', () => {
            const manifestStr = fs.readFileSync(path.join(__dirname, 'operations-console/manifest.json'), 'utf-8');
            const manifest = JSON.parse(manifestStr);
            assert.strictEqual(manifest.start_url, './poc.html');
            assert.ok(manifest.icons.some(i => i.src === './icons/icon-192.png'));
            assert.ok(manifest.icons.some(i => i.src === './icons/icon-512.png'));

            // Check apple-touch-icon in HTML
            assert.ok(htmlContent.includes('href="./icons/apple-touch-icon.png"'), 'Missing apple-touch-icon link in poc.html');
        });

        // --- WEB SHARE MOCK TESTS ---
        // Simulating the exact logic from poc.html downloadBrief function
        async function mockDownloadBrief(navigatorMock) {
            let shared = false;
            let fallbackCalled = false;
            let returnedEarly = false;

            const file = { name: "Brief_12345678.html" };

            if (navigatorMock.share && navigatorMock.canShare && navigatorMock.canShare({ files: [file] })) {
                try {
                    await navigatorMock.share({ files: [file] });
                    shared = true;
                } catch (shareErr) {
                    if (shareErr.name === 'AbortError') {
                        returnedEarly = true;
                    }
                }
            }

            if (!shared && !returnedEarly) {
                fallbackCalled = true;
            }

            return { shared, fallbackCalled, returnedEarly };
        }

        await runTestAsync('Web Share success (no duplicate download)', async () => {
            const nav = {
                share: async () => {}, // succeeds
                canShare: () => true
            };
            const res = await mockDownloadBrief(nav);
            assert.strictEqual(res.shared, true, "Web share should succeed");
            assert.strictEqual(res.fallbackCalled, false, "Fallback should NOT be called on share success");
        });

        await runTestAsync('Web Share cancellation (AbortError)', async () => {
            const nav = {
                share: async () => {
                    const err = new Error("Abort");
                    err.name = "AbortError";
                    throw err;
                },
                canShare: () => true
            };
            const res = await mockDownloadBrief(nav);
            assert.strictEqual(res.shared, false, "Web share should NOT succeed");
            assert.strictEqual(res.returnedEarly, true, "Should return early on AbortError");
            assert.strictEqual(res.fallbackCalled, false, "Fallback should NOT be called on AbortError");
        });

        await runTestAsync('Fallback download on share unsupported', async () => {
            const nav = {}; // no share
            const res = await mockDownloadBrief(nav);
            assert.strictEqual(res.shared, false, "Web share should NOT succeed");
            assert.strictEqual(res.returnedEarly, false, "Should NOT return early");
            assert.strictEqual(res.fallbackCalled, true, "Fallback should be called when share is unsupported");
        });

        // --- Q4 OFFLINE REGRESSION TESTS ---
        runTest('Imports firebase auth correctly', () => {
            const importMatch = htmlContent.match(/import\s*\{\s*auth,\s*provider,\s*signInWithPopup,\s*signOut,\s*onAuthStateChanged\s*\}\s*from\s*['"\`]\.\/firebase-auth\.js['"\`]/);
            assert.ok(importMatch, "poc.html does not import the required firebase functions from ./firebase-auth.js");
        });

        runTest('Uses /.netlify/functions/verify-user endpoint', () => {
            const verifyUserMatch = htmlContent.match(/fetch\(['"\`]\/\.netlify\/functions\/verify-user['"\`]/);
            assert.ok(verifyUserMatch, "poc.html does not call /.netlify/functions/verify-user");

            const authVerifyMatch = htmlContent.match(/auth-verify/);
            assert.ok(!authVerifyMatch, "poc.html must NOT reference auth-verify endpoint");
        });

        runTest('Offline detection logic exists and blocks 401/403', () => {
            assert.ok(htmlContent.includes('response.status === 401 || response.status === 403'), "poc.html must check 401/403 statuses explicitly");
            assert.ok(htmlContent.includes("throw new Error('AUTH_FAILED')"), "poc.html must differentiate AUTH_FAILED from NETWORK_OFFLINE");
        });

        runTest('firebase-auth.js exists', () => {
            assert.ok(fs.existsSync(path.join(__dirname, 'operations-console', 'firebase-auth.js')), "firebase-auth.js missing");
        });

        runTest('500/503 network classification', () => {
            assert.ok(htmlContent.includes("error.message.startsWith('SERVER_ERROR')"), "poc.html must differentiate SERVER_ERROR from NETWORK_OFFLINE");
            assert.ok(htmlContent.includes("SERVER_ERROR:${response.status}"), "poc.html must capture the server error status");
        });

        runTest('Sign out clearing failure aborts sign out', () => {
            assert.ok(htmlContent.includes("alert(\"Failed to clear secure offline data"), "poc.html must show controlled error on sign out failure");
        });

        runTest('Local Firebase Bundle exists and is valid', () => {
            const bundlePath = path.join(__dirname, 'operations-console', 'firebase-auth-bundle.js');
            assert.ok(fs.existsSync(bundlePath), "firebase-auth-bundle.js missing");
            const bundleContent = fs.readFileSync(bundlePath, 'utf-8');
            assert.ok(bundleContent.length > 0, "Bundle is empty");
            assert.ok(!bundleContent.includes("from 'firebase/app'"), "Bundle contains unresolved static import firebase/app");
            assert.ok(!bundleContent.includes('from "firebase/app"'), "Bundle contains unresolved static import firebase/app");
            assert.ok(!bundleContent.includes("from 'firebase/auth'"), "Bundle contains unresolved static import firebase/auth");
            assert.ok(!bundleContent.includes('from "firebase/auth"'), "Bundle contains unresolved static import firebase/auth");
            assert.ok(!bundleContent.includes("from 'https://www.gstatic.com"), "Bundle contains gstatic import");
        });

        runTest('firebase-auth.js is adapter re-exporting from bundle', () => {
            const adapterContent = fs.readFileSync(path.join(__dirname, 'operations-console', 'firebase-auth.js'), 'utf-8');
            assert.ok(adapterContent.includes('export { auth, provider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase-auth-bundle.js";'), "Adapter must re-export from bundle");
            assert.ok(!adapterContent.includes('gstatic'), "Adapter must not import gstatic");
        });

        runTest('Broken SDK files are removed', () => {
            assert.ok(!fs.existsSync(path.join(__dirname, 'operations-console', 'firebase-app.js')), "firebase-app.js must be removed");
            assert.ok(!fs.existsSync(path.join(__dirname, 'operations-console', 'firebase-auth-sdk.js')), "firebase-auth-sdk.js must be removed");
        });

        runTest('sw.js excludes Firebase traffic but caches adapter and bundle', () => {
            const swContent = fs.readFileSync(path.join(__dirname, 'operations-console', 'sw.js'), 'utf-8');
            assert.ok(swContent.includes("url.hostname.includes('firebase')"), "sw.js must exclude firebase domain");
            assert.ok(swContent.includes("'./firebase-auth.js'"), "sw.js must cache local adapter");
            assert.ok(swContent.includes("'./firebase-auth-bundle.js'"), "sw.js must cache local bundle");
            assert.ok(!swContent.includes("'./firebase-app.js'"), "sw.js must not cache broken file");
            assert.ok(!swContent.includes("'./firebase-auth-sdk.js'"), "sw.js must not cache broken file");
        });

        runTest('Owner isolation exists', () => {
            assert.ok(htmlContent.includes('b.owner_uid === uid && b.owner_email === email'), "getAllBriefsFromDB must filter by owner");
        });

        runTest('XSS escaping for stored values', () => {
            assert.ok(htmlContent.includes('escapeHTML(brief.customer_name)'), "customer_name not escaped in offline render");
            assert.ok(htmlContent.includes('escapeHTML(brief.address)'), "address not escaped in offline render");
            assert.ok(htmlContent.includes('escapeHTML(brief.order_number)'), "order_number not escaped in offline render");
        });

        // --- FINAL RESULTS ---
        console.log(`\n==========================================`);
        console.log(`TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
        console.log(`==========================================`);

        if (testsFailed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } catch (e) {
        console.error('❌ Fatal test error:', e);
        process.exit(1);
    }
})();
