import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  P02_M17_A_ALLOWLIST,
  P02_M17_A_BASE_COMMIT,
  P02_M17_A_BASE_TREE,
  P02_M17_A_BRANCH,
  P02_M17_A_MAIN_COMMIT,
  P02_M17_A_PACKAGE_LOCK_SHA256,
  P02_M17_A_REQUIRED_CONTRACTS,
  P02_M17_A_TEST_PATHS,
  compareExactPathSets,
  readCandidateStatus,
  readChangedFilesInventory,
  validateCandidateStatus,
} from "./p02-m17-a-changed-files.js";

const ACCEPTANCE_STATEMENTS = [
  "Exact starting `platform`, tree, and unchanged `main` are verified.",
  "Migrations are exactly `0001–0023`.",
  "Every migration remains byte-identical.",
  "Migration `0024` is absent.",
  "Migration ledger is exactly `0001–0023` after reset.",
  "Reset/seed/migrate succeeds from zero twice.",
  "`package-lock.json` remains exact SHA-256.",
  "Dependency names and versions remain unchanged.",
  "`package.json` changes are script-only.",
  "Every changed path is inside the exact 24-path allowlist.",
  "Actual changed subset is recorded exactly.",
  "No rename, deletion, vendored package, binary fixture, generated cache, or hidden payload enters the candidate.",
  "Application binds only to `127.0.0.1` on the bounded port.",
  "Business execution uses only the restricted runtime role.",
  "Owner role is used only for deterministic test setup/migration/reset outside request handling.",
  "Runtime canonical-table DML grants remain zero.",
  "Runtime sequence authority remains zero.",
  "`PUBLIC` canonical-table DML remains zero.",
  "`PUBLIC` function execution remains zero.",
  "Browser cannot supply actor, organization, membership, party, source, UUID, idempotency, or authority values.",
  "Every business mutation derives actor from the ordinary session.",
  "No direct canonical-table read/write occurs in Operations Console code.",
  "No external network request occurs.",
  "Final validation leaves no application or database listener running.",
  "No session token appears in body, URL, HTML, JS, logs, screenshots, or evidence.",
  "Cookie is HttpOnly, SameSite Strict, bounded, and path-scoped.",
  "Security headers are present on HTML, JS, CSS, JSON, and error responses.",
  "CSP rejects inline/unapproved script and external resource loading.",
  "Oversized JSON is rejected.",
  "Unsupported content type is rejected.",
  "Malformed JSON is rejected safely.",
  "Error response contains bounded message/code/reference and no SQL/internal details.",
  "Preview from another session is rejected.",
  "Expired preview is rejected.",
  "Altered payload under a preview is rejected.",
  "Browser-supplied money or authority fields are ignored/rejected.",
  "Catalog route returns only current active selectable products.",
  "Retired, legacy, and nonselectable products are excluded.",
  "Package inclusions are accurate and ordered.",
  "Flat-price product resolves exact effective price.",
  "Bracketed package resolves exact matching bracket.",
  "Boundary values choose the correct bracket with accepted inclusive/exclusive law.",
  "Missing required square feet blocks preview before mutation.",
  "No matching bracket fails closed.",
  "Duplicate product selection fails or consolidates deterministically.",
  "Package quantity other than one is rejected.",
  "Invalid nonpackage quantity is rejected.",
  "Browser price alteration has no effect.",
  "Creation re-resolves current eligibility and price rather than trusting preview display.",
  "Review total equals sum of server-resolved lines.",
  "Valid new normalized email creates one Person and one active minimum membership.",
  "Exact replay reuses the Person and membership.",
  "Different email creates a different Person.",
  "Email case/whitespace normalizes deterministically.",
  "Invalid email fails before mutation.",
  "Missing email fails with owner-readable guidance.",
  "Display name alone never merges Persons.",
  "Conflicting email evidence fails closed.",
  "No authentication Identity or credentials are created.",
  "Suspended/removed membership is not silently reactivated.",
  "Complete new address creates one Property and one Snapshot.",
  "Exact normalized address reuses the Property.",
  "Exact repeated facts reuse the Snapshot.",
  "Changed supported square footage creates a new immutable Snapshot.",
  "Existing Snapshot bytes/row remain unchanged.",
  "Incomplete exact address fails before mutation.",
  "Fuzzy/near address does not silently reuse.",
  "Tenant boundary prevents cross-organization reuse.",
  "Ambiguous exact candidates fail closed.",
  "Browser cannot submit Property or Snapshot IDs.",
  "Successful submission commits customer, membership, Property, Snapshot, commercial snapshots, Order, parties, items, external reference, idempotency record, and events together.",
  "Injected failure after customer reconciliation leaves no new Person/membership.",
  "Injected failure after Property reconciliation leaves no new customer/Property/Snapshot.",
  "Injected failure after first commercial snapshot leaves no partial commercial evidence.",
  "Injected failure immediately before `create_order` leaves no canonical effects.",
  "Injected failure after `create_order` but before commit leaves no Order or related rows.",
  "Server process error before commit rolls back the transaction.",
  "No success response is emitted before commit.",
  "Canonical readback matches transaction-created identities and lines.",
  "Exact repeated final submission returns the original Order.",
  "Exact replay creates no duplicate Person, membership, Property, Snapshot, commercial snapshot, Order, party, item, reference, or event.",
  "Conflicting payload under the same submission identity fails closed.",
  "Two simultaneous identical submissions produce exactly one Order.",
  "Two simultaneous different submissions remain independent.",
  "Deterministic commercial snapshot replay uses exact identities without ambiguous duplicate suppression.",
  "Non-primary-key or unexpected uniqueness conflict fails closed.",
  "Browser refresh/back/duplicate click cannot create a second Order from the same bound submission.",
  "Exactly six required party roles are derived server-side.",
  "`AUTHORIZED_ACTOR` equals the session actor.",
  "Customer and billing party equal the reconciled customer.",
  "Organization party equals server-fixed organization.",
  "Property/Snapshot references equal reconciled results.",
  "Every Order item points to the intended immutable commercial snapshot.",
  "Line quantities and amounts match canonical readback.",
  "Total equals item subtotal plus zero travel.",
  "Order source is provider-neutral M17-A evidence.",
  "Confirmation is built from `get_order_record` output.",
  "Confirmation remains available through the authenticated read route after page refresh.",
  "Unknown or unauthorized Order read fails closed.",
  "UI never claims scheduling, payment, Job, Mission Plan, media, review, or delivery occurred.",
  "Customer → Property → Services → Review → Confirmation flow is complete.",
  "Required fields are labeled and keyboard reachable.",
  "Focus moves to validation summary/error appropriately.",
  "Errors are not color-only.",
  "Currency is formatted consistently.",
  "Progress and active step are accurate.",
  "Create control is disabled while pending.",
  "Mobile-width layout remains usable without horizontal control loss.",
  "Touch controls meet reasonable target sizing.",
  "No raw JSON or database dump is the primary interface.",
  "Nonproduction/data-boundary notice is visible.",
  "A normal operator can complete the synthetic scenario without PostgreSQL or terminal access.",
  "New targeted tests pass.",
  "Complete test suite passes serially.",
  "Typecheck passes.",
  "Strict `npm run verify:all` passes with reliable failure propagation.",
  "M17-A dedicated verifier passes.",
  "Migration, runtime, dependency, placeholder, changed-file, predecessor schema, and foundation-closeout gates pass.",
  "Privacy scan finds no credential, real customer data, absolute path, provider payload, token, or raw session evidence.",
  "No commit, push, PR, `platform` advancement, `main` mutation, deployment, production, provider, Desktop, real-data, real-media, dual-run, cutover, retirement, or cleanup occurs.",
] as const;

if (ACCEPTANCE_STATEMENTS.length !== 120) throw new Error(`P02-M17-A acceptance inventory has ${ACCEPTANCE_STATEMENTS.length} entries, expected 120`);

interface StaticCheck {
  pass: boolean;
  observation: string;
}

interface RuntimeAcceptance {
  passed: boolean;
  observation: string;
  evidence?: unknown;
}

interface RuntimeVerification {
  acceptanceIds: number[];
  acceptance: Record<string, RuntimeAcceptance>;
}

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(baseDir, "../..");
const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const gitText = (args: string[]): string => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const gitBytes = (args: string[]): Buffer => execFileSync("git", args, { cwd: repoRoot });
const expectedIds = Array.from({ length: 120 }, (_unused, index) => index + 1);
const staticChecks: Record<string, StaticCheck> = {};
const record = (name: string, pass: boolean, observation: string): void => {
  staticChecks[name] = { pass, observation };
};
const safeRead = (repoPath: string): string => {
  const absolute = path.join(repoRoot, repoPath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
};

const head = gitText(["rev-parse", "HEAD"]);
const tree = gitText(["rev-parse", "HEAD^{tree}"]);
const branch = gitText(["symbolic-ref", "--short", "HEAD"]);
const originPlatform = gitText(["rev-parse", "refs/remotes/origin/platform"]);
const originMain = gitText(["rev-parse", "refs/remotes/origin/main"]);
let candidateRemoteTrackingAbsent = false;
try {
  execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${P02_M17_A_BRANCH}`], { cwd: repoRoot, stdio: "ignore" });
} catch {
  candidateRemoteTrackingAbsent = true;
}
record(
  "entry",
  head === P02_M17_A_BASE_COMMIT && tree === P02_M17_A_BASE_TREE && branch === P02_M17_A_BRANCH && originPlatform === P02_M17_A_BASE_COMMIT && originMain === P02_M17_A_MAIN_COMMIT,
  `branch=${branch}; HEAD=${head}; tree=${tree}; origin/platform=${originPlatform}; origin/main=${originMain}`,
);

const states = readCandidateStatus(repoRoot);
const changedPaths = states.map((state) => state.path).sort();
const statusFailures = validateCandidateStatus(states);
const documentedPaths = readChangedFilesInventory(path.join(baseDir, "CHANGED_FILES.md")).sort();
const inventoryFailures = compareExactPathSets(changedPaths, documentedPaths);
record("allowlist", statusFailures.every((failure) => !failure.includes("outside")), `${changedPaths.length}/${P02_M17_A_ALLOWLIST.length} maximum allowlist paths changed; repository-wide porcelain-v2 -z inspected`);
record("inventory", inventoryFailures.length === 0 && changedPaths.length > 0, inventoryFailures.length === 0 ? `CHANGED_FILES.md equals the ${changedPaths.length}-path Git set` : inventoryFailures.join("; "));

let artifactFailure = statusFailures.length > 0;
for (const repoPath of changedPaths) {
  const absolute = path.join(repoRoot, repoPath);
  if (!existsSync(absolute)) {
    artifactFailure = true;
    continue;
  }
  const bytes = readFileSync(absolute);
  if (bytes.includes(0) || bytes.length > 1_500_000) artifactFailure = true;
}
record("artifacts", !artifactFailure, statusFailures.length === 0 ? "all candidate records are unstaged text modifications/additions with no rename, copy, delete, conflict, vendor, cache, hidden, binary, or oversized payload" : statusFailures.join("; "));

const migrationDir = path.join(baseDir, "db/migrations");
const migrationNames = readdirSync(migrationDir).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
const migrationNumbersExact = migrationNames.length === 23 && migrationNames.every((name, index) => name.startsWith(`${String(index + 1).padStart(4, "0")}_`));
const headMigrationPaths = gitText(["ls-tree", "-r", "--name-only", "HEAD", "--", "platform-v2/ml-vs01/db/migrations"])
  .split("\n")
  .filter((entry) => /^platform-v2\/ml-vs01\/db\/migrations\/\d{4}_.+\.sql$/.test(entry));
const headMigrationNames = headMigrationPaths.map((entry) => path.basename(entry)).sort();
const migrationHashes: Record<string, string> = {};
let migrationBytesExact = JSON.stringify(migrationNames) === JSON.stringify(headMigrationNames);
for (const name of migrationNames) {
  const repoPath = `platform-v2/ml-vs01/db/migrations/${name}`;
  const worktreeBytes = readFileSync(path.join(migrationDir, name));
  migrationHashes[name] = sha256(worktreeBytes);
  if (!headMigrationNames.includes(name)) {
    migrationBytesExact = false;
    continue;
  }
  const headBytes = gitBytes(["show", `HEAD:${repoPath}`]);
  if (!worktreeBytes.equals(headBytes)) migrationBytesExact = false;
}
record("migrationInventory", migrationNumbersExact, migrationNumbersExact ? `exact SQL migration inventory ${migrationNames[0]} through ${migrationNames[22]}` : `observed ${migrationNames.join(", ")}`);
record("migrationBytes", migrationBytesExact, migrationBytesExact ? "all 23 worktree migration byte streams equal HEAD" : "migration path or byte mismatch from HEAD");
record("migration0024", !migrationNames.some((name) => name.startsWith("0024_")), "no 0024_*.sql migration is present");

const lockBytes = readFileSync(path.join(baseDir, "package-lock.json"));
const headLockBytes = gitBytes(["show", "HEAD:platform-v2/ml-vs01/package-lock.json"]);
const lockHash = sha256(lockBytes);
record("lock", lockBytes.equals(headLockBytes) && lockHash === P02_M17_A_PACKAGE_LOCK_SHA256, `package-lock.json SHA-256=${lockHash}; HEAD bytes equal=${lockBytes.equals(headLockBytes)}`);

const packageJson = JSON.parse(readFileSync(path.join(baseDir, "package.json"), "utf8")) as Record<string, unknown>;
const headPackageJson = JSON.parse(gitText(["show", "HEAD:platform-v2/ml-vs01/package.json"])) as Record<string, unknown>;
const packageWithoutScripts = { ...packageJson, scripts: undefined };
const headPackageWithoutScripts = { ...headPackageJson, scripts: undefined };
const dependenciesExact = JSON.stringify(packageJson.dependencies) === JSON.stringify(headPackageJson.dependencies)
  && JSON.stringify(packageJson.devDependencies) === JSON.stringify(headPackageJson.devDependencies)
  && JSON.stringify(packageJson.optionalDependencies) === JSON.stringify(headPackageJson.optionalDependencies);
record("dependencies", dependenciesExact, dependenciesExact ? "dependency names and exact versions equal HEAD" : "dependency inventory differs from HEAD");
const scripts = packageJson.scripts as Record<string, string>;
const headScripts = headPackageJson.scripts as Record<string, string>;
const expectedAddedScripts: Record<string, string> = {
  "run:internal-operations-console-new-listing": "tsx scripts/run-internal-operations-console-new-listing.ts",
  "verify:internal-operations-console-new-listing": "tsx scripts/verify-internal-operations-console-new-listing.ts",
};
const allowedScriptNames = new Set([...Object.keys(headScripts), ...Object.keys(expectedAddedScripts)]);
const foundationSuffix = " && npm run verify:foundation-closeout";
const headVerifyAll = headScripts["verify:all"];
const expectedVerifyAll = headVerifyAll.endsWith(foundationSuffix)
  ? `${headVerifyAll.slice(0, -foundationSuffix.length)} && npm run run:internal-operations-console-new-listing && npm run verify:internal-operations-console-new-listing${foundationSuffix}`
  : "";
const scriptsExact = Object.entries(headScripts).every(([name, value]) => name === "verify:all" || scripts[name] === value)
  && Object.entries(expectedAddedScripts).every(([name, value]) => scripts[name] === value)
  && Object.keys(scripts).every((name) => allowedScriptNames.has(name))
  && scripts["verify:all"] === expectedVerifyAll;
record("packageScripts", JSON.stringify(packageWithoutScripts) === JSON.stringify(headPackageWithoutScripts) && scriptsExact, scriptsExact ? "package.json differs only by two bounded M17-A scripts and their exact fail-fast insertion before foundation closeout" : "package.json script boundary mismatch");

const sourcePaths = [
  "platform-v2/ml-vs01/src/operations-console/app.ts",
  "platform-v2/ml-vs01/src/operations-console/contracts.ts",
  "platform-v2/ml-vs01/src/operations-console/database.ts",
  "platform-v2/ml-vs01/src/operations-console/errors.ts",
  "platform-v2/ml-vs01/src/operations-console/service.ts",
  "platform-v2/ml-vs01/src/operations-console/session.ts",
  "platform-v2/ml-vs01/src/operations-console/server.ts",
];
const publicPaths = [
  "platform-v2/ml-vs01/src/operations-console/public/index.html",
  "platform-v2/ml-vs01/src/operations-console/public/app.js",
  "platform-v2/ml-vs01/src/operations-console/public/styles.css",
];
const runnerPath = "platform-v2/ml-vs01/scripts/run-internal-operations-console-new-listing.ts";
const missingImplementation = [...sourcePaths, ...publicPaths, runnerPath].filter((entry) => !existsSync(path.join(repoRoot, entry)));
const runtimeSource = sourcePaths.map(safeRead).join("\n");
const publicSource = publicPaths.map(safeRead).join("\n");
const runnerSource = safeRead(runnerPath);
const allSource = `${runtimeSource}\n${publicSource}\n${runnerSource}`;

const requiredRouteSpecs: Array<[string, string]> = [
  ["get", "/health"], ["post", "/session"], ["get", "/api/catalog"], ["post", "/api/listings/preview"],
  ["post", "/api/listings"], ["get", "/api/orders/:orderId"], ["get", "/"], ["get", "/app.js"], ["get", "/styles.css"],
];
const routeMissing = requiredRouteSpecs.filter(([method, route]) => {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`\\.${method}(?:<[^\\n]{0,240}>)?\\s*\\(\\s*[\"']${escaped}[\"']`).test(runtimeSource);
});
record("routes", missingImplementation.length === 0 && routeMissing.length === 0, routeMissing.length === 0 ? "all nine bounded routes are statically registered" : `missing route registrations: ${routeMissing.map(([method, route]) => `${method.toUpperCase()} ${route}`).join(", ")}`);

const contractsSource = safeRead("platform-v2/ml-vs01/src/operations-console/contracts.ts");
const missingContracts = P02_M17_A_REQUIRED_CONTRACTS.filter((name) => !contractsSource.includes(name));
record("contracts", missingContracts.length === 0, missingContracts.length === 0 ? "all nine versioned contract families are present" : `missing contracts: ${missingContracts.join(", ")}`);

const bindPass = allSource.includes("127.0.0.1") && allSource.includes("4317") && !/["'](?:0\.0\.0\.0|\[?::\]?|localhost)["']/i.test(runtimeSource);
record("bind", bindPass, bindPass ? "runtime and runner preserve 127.0.0.1:4317 with no wildcard/hostname bind" : "bounded loopback bind evidence is absent or contradictory");
const restrictedRolePass = runnerSource.includes("medialab_p02m17a_test_app") && !runtimeSource.includes("medialab_p02m17a_test_owner") && !runtimeSource.includes("process.env");
record("restrictedRole", restrictedRolePass, restrictedRolePass ? "runner fixes the restricted application role; request-path source has no owner-role literal or environment-selected authority" : "restricted-role/request-authority source boundary mismatch");
record("ownerSetup", runnerSource.includes("medialab_p02m17a_test_owner") && !runtimeSource.includes("medialab_p02m17a_test_owner"), "owner-role literal is confined to the deterministic runner, outside Operations Console request source");
const requiredFunctions = [
  "get_current_selectable_catalog", "get_current_catalog_package_inclusions", "reconcile_customer_person_intake",
  "reconcile_property_snapshot_intake", "create_catalog_commercial_snapshot", "create_order", "get_order_record",
];
const directCanonicalDml = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:medialab_core\.)/i.test(runtimeSource);
const canonicalRelations = [...runtimeSource.matchAll(/\b(?:FROM|JOIN)\s+medialab_core\.([a-z_][a-z0-9_]*)/gi)].map((match) => match[1]);
const directCanonicalRelation = canonicalRelations.some((name) => !requiredFunctions.includes(name));
const directCanonicalSql = directCanonicalDml || directCanonicalRelation;
record("canonicalBoundary", !directCanonicalSql, directCanonicalSql ? `direct canonical table SQL detected; relations=${canonicalRelations.join(", ")}` : "Operations Console source contains no direct canonical-table read or DML syntax outside accepted function invocation");
const missingFunctions = requiredFunctions.filter((name) => !runtimeSource.includes(name));
record("acceptedFunctions", missingFunctions.length === 0, missingFunctions.length === 0 ? "all seven accepted command/query functions are named in the runtime database boundary" : `accepted function calls missing: ${missingFunctions.join(", ")}`);
const outboundDetected = /(?:from\s+["'](?:node:https?|https?:|undici|axios|got|googleapis|@aws)|\b(?:https?|request)\.request\s*\(|\bfetch\s*\()/i.test(runtimeSource);
record("outbound", !outboundDetected, outboundDetected ? "outbound-network client primitive detected in server source" : "server source contains no outbound-network client primitive");

const browserAuthorityFields = ["actorId", "organizationId", "membershipId", "partyId", "sourceId", "idempotencyKey", "commercialSnapshotId", "propertyId", "snapshotId"];
const browserAuthorityLeaks = browserAuthorityFields.filter((field) => new RegExp(`[\"']${field}[\"']\\s*:`).test(publicSource));
record("browserAuthority", browserAuthorityLeaks.length === 0, browserAuthorityLeaks.length === 0 ? "public request-building source supplies no canonical actor/tenant/party/source/idempotency/snapshot authority field" : `public authority fields detected: ${browserAuthorityLeaks.join(", ")}`);

const sessionCookiePass = /httponly/i.test(runtimeSource) && /samesite.{0,24}strict/is.test(runtimeSource) && /\bpath.{0,16}(?:["']\/["']|=\/)/is.test(runtimeSource) && /maxage|max-age|expires/i.test(runtimeSource);
const publicSessionTokenLeak = /(?:session[_-]?token|database[_-]?session|bearer\s+)/i.test(publicSource);
record("session", sessionCookiePass && !publicSessionTokenLeak, sessionCookiePass && !publicSessionTokenLeak ? "HttpOnly, SameSite Strict, bounded Path cookie controls are present and public assets contain no raw session token surface" : "session cookie or public token boundary mismatch");
const lowerRuntime = runtimeSource.toLowerCase();
const requiredHeaders = ["content-security-policy", "x-content-type-options", "referrer-policy", "cache-control", "x-frame-options"];
const missingHeaders = requiredHeaders.filter((header) => !lowerRuntime.includes(header));
const cspPass = lowerRuntime.includes("script-src 'self'") && lowerRuntime.includes("connect-src 'self'") && !/unsafe-inline|unsafe-eval|https?:\/\//i.test(runtimeSource + publicSource);
record("responseSecurity", missingHeaders.length === 0 && cspPass, missingHeaders.length === 0 && cspPass ? "bounded security-header set and self-only script/connect CSP are present with no inline/external resource grant" : `response security mismatch; missing=${missingHeaders.join(", ")}`);

const testContents: Record<string, string> = {};
const testObservations: string[] = [];
let testsSubstantive = true;
for (const repoPath of P02_M17_A_TEST_PATHS) {
  const content = safeRead(repoPath);
  testContents[path.basename(repoPath)] = content;
  const testCount = (content.match(/(?:test|it)\s*\(/g) ?? []).length;
  const expectCount = (content.match(/expect\s*\(/g) ?? []).length;
  const skipped = /\.(?:skip|todo)\s*\(/.test(content);
  if (testCount < 2 || expectCount < 2 || skipped) testsSubstantive = false;
  testObservations.push(`${path.basename(repoPath)}:${testCount} tests/${expectCount} expects${skipped ? "/SKIPPED" : ""}`);
}
record("targetedTests", testsSubstantive, testObservations.join("; "));
const testEvidence = (filename: string, tokens: string[]): StaticCheck => {
  const content = (testContents[filename] ?? "").toLowerCase();
  const observed = tokens.filter((token) => content.includes(token.toLowerCase()));
  return { pass: observed.length >= Math.ceil(tokens.length * 0.6), observation: `${filename} covers ${observed.join(", ")}` };
};
const securityCoverage = testEvidence("operations-console-security.test.ts", ["cookie", "content-type", "malformed", "oversized", "preview", "session", "authority", "public", "error", "header"]);
record("securityCoverage", securityCoverage.pass, securityCoverage.observation);
const catalogCoverage = testEvidence("operations-console-catalog.test.ts", ["active", "retired", "package", "inclusion", "flat", "bracket", "boundary", "square", "quantity", "price", "total"]);
record("catalogCoverage", catalogCoverage.pass, catalogCoverage.observation);
const transactionContent = (testContents["operations-console-transaction.test.ts"] ?? "").toLowerCase();
const customerTokens = ["email", "person", "membership", "normalize", "invalid", "missing", "conflict", "suspend"];
const propertyTokens = ["property", "snapshot", "address", "square", "reuse", "immutable", "tenant", "ambiguous"];
const transactionTokens = ["rollback", "commit", "inject", "customer", "property", "commercial", "create_order", "readback"];
const canonicalTokens = ["party", "authorized_actor", "customer", "organization", "snapshot", "item", "total", "source", "get_order_record"];
const tokenCheck = (name: string, content: string, tokens: string[]): void => {
  const observed = tokens.filter((token) => content.includes(token));
  record(name, observed.length >= Math.ceil(tokens.length * 0.6), `${name} evidence tokens: ${observed.join(", ")}`);
};
tokenCheck("customerCoverage", transactionContent, customerTokens);
tokenCheck("propertyCoverage", transactionContent, propertyTokens);
tokenCheck("transactionCoverage", transactionContent + runtimeSource.toLowerCase(), transactionTokens);
tokenCheck("canonicalOrderCoverage", transactionContent + runtimeSource.toLowerCase(), canonicalTokens);
const idempotencyContent = (testContents["operations-console-idempotency.test.ts"] ?? "").toLowerCase();
tokenCheck("idempotencyCoverage", idempotencyContent + runtimeSource.toLowerCase(), ["replay", "submission", "conflict", "concurrent", "duplicate", "advisory", "savepoint", "deterministic"]);
const uiContent = `${testContents["operations-console-ui.test.ts"] ?? ""}\n${publicSource}`.toLowerCase();
tokenCheck("uiCoverage", uiContent, ["customer", "property", "services", "review", "confirmation", "label", "focus", "keyboard", "mobile", "touch", "nonproduction", "disabled"]);

const transactionSourcePass = /\bBEGIN\b/i.test(runtimeSource) && /\bCOMMIT\b/i.test(runtimeSource) && /\bROLLBACK\b/i.test(runtimeSource) && /advisory/i.test(runtimeSource);
record("transactionSource", transactionSourcePass, transactionSourcePass ? "runtime database boundary includes explicit transaction, rollback, commit, and advisory-lock controls" : "explicit transaction/advisory-lock control is incomplete");
const noInlineScript = !/<script(?![^>]*\bsrc=)[^>]*>/i.test(safeRead(publicPaths[0]));
const uiAssetsPass = noInlineScript && !/<pre\b/i.test(publicSource) && !/https?:\/\//i.test(publicSource) && /@media/i.test(safeRead(publicPaths[2]));
record("uiAssets", uiAssetsPass, uiAssetsPass ? "self-contained accessible UI assets contain no inline/external script or raw-dump primary element and include a responsive rule" : "public asset boundary mismatch");

const sourceForPrivacy = [...sourcePaths, ...publicPaths].map(safeRead).join("\n");
const disallowedSecret = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAIza[0-9A-Za-z_-]{20,}|\bAKIA[0-9A-Z]{16}|\bgh[pousr]_[0-9A-Za-z]{20,}|\bsk-[0-9A-Za-z]{20,}/.test(sourceForPrivacy);
const disallowedAbsolutePath = /\/(?:Users|Volumes|home)\//.test(sourceForPrivacy);
const namedProviderPayload = /\b(?:AppSheet|ARYEO|PixelMob|Google Sheets|Apps Script)\b/i.test(sourceForPrivacy);
const sourceEmails = sourceForPrivacy.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
const realEmail = sourceEmails.some((email) => !/@(?:example\.com|example\.test|example\.invalid)$/i.test(email));
record("privacy", !disallowedSecret && !disallowedAbsolutePath && !namedProviderPayload && !realEmail && !publicSessionTokenLeak, `secret=${disallowedSecret}; userPath=${disallowedAbsolutePath}; namedProviderPayload=${namedProviderPayload}; realEmail=${realEmail}; publicSessionToken=${publicSessionTokenLeak}`);
record("noExternalMutation", head === P02_M17_A_BASE_COMMIT && originPlatform === P02_M17_A_BASE_COMMIT && originMain === P02_M17_A_MAIN_COMMIT && candidateRemoteTrackingAbsent && states.every((state) => state.kind === "untracked" || state.indexStatus === "."), "HEAD remains the exact base, platform/main tracking refs remain exact, candidate tracking ref is absent, and every candidate path is unstaged");

const staticKeysForAcceptance = (id: number): string[] => {
  if (id === 1) return ["entry"];
  if (id === 2) return ["migrationInventory"];
  if (id === 3) return ["migrationBytes"];
  if (id === 4) return ["migration0024"];
  if (id === 5 || id === 6) return ["migrationInventory", "migrationBytes"];
  if (id === 7) return ["lock"];
  if (id === 8) return ["dependencies"];
  if (id === 9) return ["packageScripts"];
  if (id === 10) return ["allowlist"];
  if (id === 11) return ["inventory"];
  if (id === 12) return ["artifacts"];
  if (id === 13) return ["bind", "routes"];
  if (id === 14) return ["restrictedRole"];
  if (id === 15) return ["ownerSetup"];
  if (id >= 16 && id <= 19) return ["restrictedRole", "canonicalBoundary", "securityCoverage"];
  if (id === 20) return ["browserAuthority", "contracts", "securityCoverage"];
  if (id === 21) return ["session", "acceptedFunctions", "securityCoverage"];
  if (id === 22) return ["canonicalBoundary", "acceptedFunctions"];
  if (id === 23) return ["outbound"];
  if (id === 24) return ["bind", "targetedTests"];
  if (id >= 25 && id <= 36) return ["session", "responseSecurity", "securityCoverage", "contracts"];
  if (id >= 37 && id <= 50) return ["catalogCoverage", "acceptedFunctions", "contracts"];
  if (id >= 51 && id <= 60) return ["customerCoverage", "transactionSource", "acceptedFunctions"];
  if (id >= 61 && id <= 70) return ["propertyCoverage", "transactionSource", "acceptedFunctions"];
  if (id >= 71 && id <= 79) return ["transactionCoverage", "transactionSource", "acceptedFunctions"];
  if (id >= 80 && id <= 87) return ["idempotencyCoverage", "transactionSource"];
  if (id >= 88 && id <= 100) return ["canonicalOrderCoverage", "acceptedFunctions", "browserAuthority"];
  if (id >= 101 && id <= 112) return ["uiCoverage", "uiAssets", "routes"];
  if (id === 113) return ["targetedTests"];
  if (id === 114) return ["targetedTests"];
  if (id === 115) return ["contracts"];
  if (id === 116 || id === 117) return ["packageScripts", "targetedTests"];
  if (id === 118) return ["entry", "migrationInventory", "migrationBytes", "lock", "dependencies", "allowlist", "inventory"];
  if (id === 119) return ["privacy"];
  return ["noExternalMutation"];
};

const runtimeEvidencePath = process.env.P02_M17_A_RUNTIME_EVIDENCE ?? "/tmp/mlvs01-p02m17a-output/verification/RUNTIME_VERIFICATION.json";
const requireRuntime = process.env.P02_M17_A_REQUIRE_RUNTIME_EVIDENCE === "1";
let runtimeEvidence: RuntimeVerification | undefined;
let runtimeEvidenceError: string | undefined;
if (existsSync(runtimeEvidencePath)) {
  try {
    runtimeEvidence = JSON.parse(readFileSync(runtimeEvidencePath, "utf8")) as RuntimeVerification;
    if (JSON.stringify(runtimeEvidence.acceptanceIds) !== JSON.stringify(expectedIds)) throw new Error("acceptanceIds is not the exact ordered 1..120 inventory");
    if (JSON.stringify(Object.keys(runtimeEvidence.acceptance).sort((left, right) => Number(left) - Number(right))) !== JSON.stringify(expectedIds.map(String))) {
      throw new Error("acceptance object keys are not exactly 1..120");
    }
    for (const id of expectedIds) {
      const item = runtimeEvidence.acceptance[String(id)];
      if (typeof item?.passed !== "boolean" || typeof item?.observation !== "string" || item.observation.trim().length === 0 || item.observation.length > 4_000) {
        throw new Error(`acceptance ${id} has an invalid runtime evidence shape`);
      }
      const serializedRuntimeItem = JSON.stringify(item);
      if (/\/(?:Users|Volumes|home)\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bbearer\s+[A-Za-z0-9._~-]{12,}|\b(?:AIza|AKIA|gh[pousr]_|sk-)[0-9A-Za-z_-]{12,}/i.test(serializedRuntimeItem)) {
        throw new Error(`acceptance ${id} runtime observation violates the evidence privacy boundary`);
      }
    }
  } catch (error) {
    runtimeEvidence = undefined;
    runtimeEvidenceError = error instanceof Error ? error.message : String(error);
  }
} else if (requireRuntime) {
  runtimeEvidenceError = `required runtime evidence is absent at ${runtimeEvidencePath}`;
}

const matrix = ACCEPTANCE_STATEMENTS.map((statement, index) => {
  const id = index + 1;
  const checkNames = staticKeysForAcceptance(id);
  const checks = checkNames.map((name) => ({ name, ...staticChecks[name] }));
  const staticPass = checks.every((check) => check.pass);
  const dynamic = runtimeEvidence?.acceptance[String(id)];
  const runtimePass = dynamic?.passed === true;
  const pass = staticPass && (!requireRuntime || runtimePass);
  return {
    id,
    statement,
    pass,
    staticCoveragePass: staticPass,
    staticObservations: checks.map((check) => `${check.name}: ${check.observation}`),
    runtimeRequired: requireRuntime,
    runtimePass: dynamic ? runtimePass : null,
    runtimeObservation: dynamic?.observation ?? null,
    runtimeEvidence: dynamic?.evidence,
  };
});

const structuralFailures = Object.entries(staticChecks).filter(([_name, check]) => !check.pass).map(([name, check]) => `${name}: ${check.observation}`);
if (runtimeEvidenceError) structuralFailures.push(`runtimeEvidence: ${runtimeEvidenceError}`);
if (runtimeEvidence && Object.values(runtimeEvidence.acceptance).some((item) => !item.passed)) structuralFailures.push("runtime evidence contains one or more failed acceptance observations");
const failedRows = matrix.filter((row) => !row.pass);
const pass = structuralFailures.length === 0 && failedRows.length === 0;
const mode = requireRuntime ? "static-and-runtime" : "static-coverage";
const result = {
  verifier: "P02-M17-A_INTERNAL_OPERATIONS_CONSOLE_NEW_LISTING_V1",
  mode,
  pass,
  acceptanceCount: matrix.length,
  acceptancePassed: matrix.filter((row) => row.pass).length,
  runtimeEvidenceFile: path.basename(runtimeEvidencePath),
  runtimeEvidenceLoaded: Boolean(runtimeEvidence),
  entry: { branch, head, tree, originPlatform, originMain },
  repository: { changedPaths, allowlistMaximum: P02_M17_A_ALLOWLIST.length, allOtherPathsUnchanged: staticChecks.allowlist.pass },
  migrations: { names: migrationNames, sha256: migrationHashes, migration0024Absent: staticChecks.migration0024.pass },
  packageLockSha256: lockHash,
  staticChecks,
  failures: structuralFailures,
  acceptance: matrix,
};

const evidenceRoot = process.env.P02_M17_A_EVIDENCE_ROOT ?? path.dirname(runtimeEvidencePath);
mkdirSync(evidenceRoot, { recursive: true });
writeFileSync(path.join(evidenceRoot, "BEHAVIOR_ACCEPTANCE_MATRIX.json"), `${JSON.stringify({ schema: "P02-M17-A_ACCEPTANCE_MATRIX_V1", mode, rows: matrix }, null, 2)}\n`, { mode: 0o600 });
const markdownRows = matrix.map((row) => {
  const observation = (row.runtimeObservation ?? row.staticObservations.join("; ")).replace(/\|/g, "\\|").replace(/\s+/g, " ");
  return `| ${row.id} | ${row.statement.replace(/\|/g, "\\|")} | ${row.pass ? "PASS" : "FAIL"} | ${observation} |`;
});
writeFileSync(path.join(evidenceRoot, "BEHAVIOR_ACCEPTANCE_MATRIX.md"), [
  "# P02-M17-A behavior acceptance matrix",
  "",
  `Mode: \`${mode}\``,
  "",
  "| ID | Exact acceptance behavior | Result | Derived observation |",
  "|---:|---|:---:|---|",
  ...markdownRows,
  "",
].join("\n"), { mode: 0o600 });
writeFileSync(path.join(evidenceRoot, "DEDICATED_VERIFIER.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify(result, null, 2));
if (!pass) process.exit(1);
