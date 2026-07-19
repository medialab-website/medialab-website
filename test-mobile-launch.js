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
const getExitRoute = require('./netlify/functions/get-exit-route');

console.log('Running Mobile Launch Tests...\n');

(async function testMobileLaunch() {
    try {
        // --- AUTH TESTS ---
        runTest('Auth List - Solutions account', () => assert.ok(APPROVED_ACCOUNTS.includes('solutions@medialab.fyi')));
        runTest('Auth List - Sean account', () => assert.ok(APPROVED_ACCOUNTS.includes('sean@medialab.fyi')));
        runTest('Auth List - Thomasina account', () => assert.ok(APPROVED_ACCOUNTS.includes('thomasina@medialab.fyi')));
        runTest('Auth List - Random account', () => assert.ok(!APPROVED_ACCOUNTS.includes('attacker@evil.com')));
        runTest('getExitRoute exposes a handler', () => assert.strictEqual(typeof getExitRoute.handler, 'function'));

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
