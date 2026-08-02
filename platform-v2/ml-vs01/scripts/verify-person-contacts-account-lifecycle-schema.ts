import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('Running verify-person-contacts-account-lifecycle-schema.ts...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseDir = path.resolve(__dirname, '..');
let errors = false;

const expectedMigrations = [
  {
    filename: '0001_identity_and_tenancy.sql',
    sha256: '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'
  },
  {
    filename: '0002_property_identity_and_snapshots.sql',
    sha256: 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'
  },
  {
    filename: '0003_person_contacts_and_account_lifecycle.sql',
    sha256: '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'
  }
];

const expectedTables = [
  'account_lifecycle_transitions',
  'account_recovery_sessions',
  'contact_method_retirements',
  'contact_method_supersessions',
  'contact_methods',
  'contact_verification_evidence',
  'contact_verification_invalidations',
  'person_account_states',
  'primary_email_replacements'
];

const expectedFunctions = [
  'actor_can_administer_person',
  'apply_account_lifecycle_transition',
  'apply_contact_retirement',
  'apply_contact_supersession',
  'apply_primary_email_replacement',
  'bootstrap_identity_account',
  'bootstrap_person_contact',
  'correct_contact_method',
  'create_contact_method',
  'guard_account_lifecycle_transition_insert',
  'guard_account_state_insert',
  'guard_account_state_update',
  'guard_contact_method_insert',
  'guard_contact_method_update',
  'guard_contact_retirement_insert',
  'guard_contact_supersession_insert',
  'guard_contact_verification_insert',
  'guard_people_primary_email_update',
  'guard_primary_email_replacement_insert',
  'guard_verification_invalidation_insert',
  'invalidate_contact_verification',
  'normalize_contact_value',
  'record_contact_verification',
  'reject_contact_history_mutation',
  'replace_primary_email',
  'require_identity_person',
  'resolve_account_recovery_session',
  'resolve_ordinary_session',
  'retire_contact_method',
  'transition_account_lifecycle'
];

const expectedTriggers = [
  'account_lifecycle_transitions_apply',
  'account_lifecycle_transitions_immutability_guard',
  'account_lifecycle_transitions_insert_guard',
  'contact_method_retirements_apply',
  'contact_method_retirements_immutability_guard',
  'contact_method_retirements_insert_guard',
  'contact_method_supersessions_apply',
  'contact_method_supersessions_immutability_guard',
  'contact_method_supersessions_insert_guard',
  'contact_methods_delete_guard',
  'contact_methods_insert_guard',
  'contact_methods_update_guard',
  'contact_verification_evidence_immutability_guard',
  'contact_verification_evidence_insert_guard',
  'contact_verification_invalidations_immutability_guard',
  'contact_verification_invalidations_insert_guard',
  'identities_account_bootstrap',
  'people_contact_bootstrap',
  'people_primary_email_update_guard',
  'person_account_states_delete_guard',
  'person_account_states_insert_guard',
  'person_account_states_update_guard',
  'primary_email_replacements_apply',
  'primary_email_replacements_immutability_guard',
  'primary_email_replacements_insert_guard'
];

const expectedPartialIndexes = [
  'contact_methods_active_email_normalized_key',
  'contact_methods_active_phone_person_key'
];

const publicApis = [
  'correct_contact_method',
  'create_contact_method',
  'invalidate_contact_verification',
  'record_contact_verification',
  'replace_primary_email',
  'retire_contact_method',
  'transition_account_lifecycle'
];

const publicApiSignatures = [
  'medialab_core.correct_contact_method(uuid, uuid, text, uuid, text, text)',
  'medialab_core.create_contact_method(uuid, text, uuid, text, text)',
  'medialab_core.invalidate_contact_verification(uuid, text, uuid, text)',
  'medialab_core.record_contact_verification(uuid, text, uuid, timestamptz, text, text)',
  'medialab_core.replace_primary_email(uuid, text, uuid, uuid, text)',
  'medialab_core.retire_contact_method(uuid, text, uuid, text)',
  'medialab_core.transition_account_lifecycle(uuid, text, uuid, uuid, text, text, boolean)'
];

function fail(message: string): void {
  console.error(`ERROR: ${message}`);
  errors = true;
}

function exactNames(label: string, actual: string[], expected: string[]): void {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(`${label} mismatch. Expected ${sortedExpected.join(', ')}, got ${sortedActual.join(', ')}`);
  }
}

const requiredFiles = [
  'db/migrate.ts',
  'db/seed.ts',
  'db/reset-test-database.ts',
  'db/migrations/0001_identity_and_tenancy.sql',
  'db/migrations/0002_property_identity_and_snapshots.sql',
  'db/migrations/0003_person_contacts_and_account_lifecycle.sql',
  'tests/person-contacts-account-lifecycle-schema.test.ts',
  'scripts/verify-person-contacts-account-lifecycle-schema.ts'
];
for (const relPath of requiredFiles) {
  if (!fs.existsSync(path.join(baseDir, relPath))) fail(`Required P02-M02-A file missing: ${relPath}`);
}

const migrationsDir = path.join(baseDir, 'db/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
exactNames('Canonical migration inventory', migrationFiles, expectedMigrations.map((entry) => entry.filename));
for (const expected of expectedMigrations) {
  const bytes = fs.readFileSync(path.join(migrationsDir, expected.filename));
  const actual = crypto.createHash('sha256').update(bytes).digest('hex').toLowerCase();
  if (actual !== expected.sha256) fail(`${expected.filename} SHA-256 mismatch. Expected ${expected.sha256}, got ${actual}`);
}

const lockBytes = fs.readFileSync(path.join(baseDir, 'package-lock.json'));
const lockHash = crypto.createHash('sha256').update(lockBytes).digest('hex').toLowerCase();
if (lockHash !== '11cc280ef7ff1c66638bc1cc3e85c750844f6041bcf338a5b59c55b0f79d9258') {
  fail(`package-lock.json SHA-256 mismatch. Got ${lockHash}`);
}

const migrationText = fs.readFileSync(path.join(migrationsDir, expectedMigrations[2].filename), 'utf8');
exactNames(
  'Packet table inventory',
  [...migrationText.matchAll(/CREATE TABLE medialab_core\.([a-z0-9_]+)/g)].map((match) => match[1]),
  expectedTables
);
exactNames(
  'Packet function inventory',
  [...migrationText.matchAll(/CREATE OR REPLACE FUNCTION medialab_core\.([a-z0-9_]+)/g)].map((match) => match[1]),
  expectedFunctions
);
exactNames(
  'Packet trigger inventory',
  [...migrationText.matchAll(/CREATE TRIGGER ([a-z0-9_]+)/g)].map((match) => match[1]),
  expectedTriggers
);
exactNames(
  'Packet partial unique-index inventory',
  [...migrationText.matchAll(/CREATE UNIQUE INDEX ([a-z0-9_]+)[\s\S]*?WHERE /g)].map((match) => match[1]),
  expectedPartialIndexes
);

const recoveryFragments = [
  'CREATE TABLE medialab_core.account_recovery_sessions',
  'token_sha256 text NOT NULL UNIQUE',
  "token_sha256 ~ '^[0-9a-f]{64}$'",
  'consumed_at timestamptz NULL',
  'external_authentication_reference text NULL',
  'REFERENCES medialab_core.identities(id) ON DELETE RESTRICT',
  'CREATE OR REPLACE FUNCTION medialab_core.resolve_account_recovery_session',
  'FOR UPDATE OF s',
  'AND s.consumed_at IS NULL',
  'SET consumed_at = v_consumed_at'
];
for (const fragment of recoveryFragments) {
  if (!migrationText.includes(fragment)) fail(`Recovery-session requirement missing: ${fragment}`);
}

const ordinaryResolverFragments = [
  'CREATE OR REPLACE FUNCTION medialab_core.resolve_ordinary_session',
  "encode(sha256(convert_to(p_session_token, 'UTF8')), 'hex')",
  'FROM medialab_core.development_sessions s',
  'AND s.issued_at <= v_now',
  'AND s.expires_at > v_now',
  'AND s.revoked_at IS NULL',
  "AND i.status = 'ACTIVE'",
  'FOR SHARE OF s'
];
for (const fragment of ordinaryResolverFragments) {
  if (!migrationText.includes(fragment)) fail(`Ordinary bearer resolver requirement missing: ${fragment}`);
}

for (const api of publicApis) {
  const match = migrationText.match(
    new RegExp(`CREATE OR REPLACE FUNCTION medialab_core\\.${api}\\(([\\s\\S]*?)\\)\\nRETURNS`)
  );
  if (!match) {
    fail(`Public mutation API missing: ${api}`);
    continue;
  }
  if (!/p_(session|bearer)_token text/.test(match[1])) fail(`${api} does not accept a raw bearer token`);
  if (match[1].includes('p_actor_identity_id')) fail(`${api} accepts a caller-asserted actor Identity UUID`);
  if (!migrationText.includes(`REVOKE ALL ON FUNCTION medialab_core.${api}(`)) {
    fail(`${api} is missing its PUBLIC EXECUTE revocation`);
  }
}

for (const table of expectedTables) {
  if (!migrationText.includes(`REVOKE ALL ON TABLE medialab_core.${table} FROM PUBLIC`)) {
    fail(`${table} is missing its PUBLIC privilege revocation`);
  }
}
for (const fn of expectedFunctions) {
  if (!migrationText.includes(`REVOKE ALL ON FUNCTION medialab_core.${fn}(`)) {
    fail(`${fn} is missing its PUBLIC EXECUTE revocation`);
  }
}

const prohibitedMigrationPatterns = [
  'current_setting(',
  'set_config(',
  'current_user',
  'session_user',
  'session_replication_role',
  'DISABLE TRIGGER',
  'ON DELETE CASCADE',
  'medialab_vs01_repair_p01a_'
];
for (const pattern of prohibitedMigrationPatterns) {
  if (migrationText.includes(pattern)) fail(`Migration contains prohibited authority or environment pattern: ${pattern}`);
}

const fixedSecurityDefinerPath = 'SET search_path = pg_catalog, medialab_core, pg_temp;';
const securityDefinerCount = migrationText.match(/SECURITY DEFINER/g)?.length ?? 0;
const securedWithFixedPathCount =
  migrationText.match(/SECURITY DEFINER\s+SET search_path = pg_catalog, medialab_core, pg_temp;/g)?.length ?? 0;
if (securityDefinerCount === 0 || securityDefinerCount !== securedWithFixedPathCount) {
  fail(`SECURITY DEFINER search_path mismatch: ${securityDefinerCount} functions, ${securedWithFixedPathCount} fixed paths`);
}
const migrationWithoutFixedPaths = migrationText.replaceAll(fixedSecurityDefinerPath, '');
if (migrationWithoutFixedPaths.includes('pg_temp')) {
  fail('pg_temp appears outside the exact fixed search_path declaration');
}

const schemaQualifiedNames = new Set(
  [...migrationText.matchAll(/medialab_core\.([a-z][a-z0-9_]*)/g)].map((match) => match[1])
);
for (const name of schemaQualifiedNames) {
  const unqualifiedReference = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE|REFERENCES|ALTER\\s+TABLE|CREATE\\s+TABLE|ON)\\s+${name}\\b`,
    'i'
  );
  if (unqualifiedReference.test(migrationText)) {
    fail(`Unqualified relation or protected-object reference found: ${name}`);
  }
}
if (/\bEXECUTE\s+(?:format\s*\(|['"$])/i.test(migrationText)) {
  fail('Migration contains dynamic SQL execution');
}

const migrateText = fs.readFileSync(path.join(baseDir, 'db/migrate.ts'), 'utf8');
const grantContractFragments = [
  'PGRUNTIMEUSER',
  'sanitizeRoleIdentifier',
  'Configured runtime role',
  'current_user AS migration_owner',
  'runtime_exists',
  'Migration owner and restricted runtime role must be different roles',
  'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA medialab_core',
  'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA medialab_core FROM PUBLIC',
  'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA medialab_core',
  'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA medialab_core',
  'GRANT USAGE ON SCHEMA medialab_core',
  'applyRuntimePrivilegePolicy'
];
for (const fragment of grantContractFragments) {
  if (!migrateText.includes(fragment)) fail(`Controlled runtime-role grant contract missing: ${fragment}`);
}
const configuredRuntimeSignatures = [...migrateText.matchAll(/'(medialab_core\.[a-z_]+\([^']+\))'/g)].map(
  (match) => match[1]
);
exactNames('Runtime EXECUTE signature allowlist', configuredRuntimeSignatures, publicApiSignatures);
for (const signature of publicApiSignatures) {
  if (!migrateText.includes('GRANT EXECUTE ON FUNCTION ${signature}')) {
    fail(`Runtime EXECUTE grant template missing exact signature: ${signature}`);
  }
}
if (/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)\b/i.test(migrateText)) {
  fail('Migration runner grants a direct table privilege to runtime');
}

const applyLoopStart = migrateText.indexOf('// Apply migration in transaction');
const transactionBegin = migrateText.indexOf("await client.query('BEGIN;');", applyLoopStart);
const migrationSql = migrateText.indexOf('await client.query(sqlContent);', transactionBegin);
const runtimePolicy = migrateText.indexOf('await applyRuntimePrivilegePolicy(client, runtimeUser!);', migrationSql);
const ledgerInsert = migrateText.indexOf('INSERT INTO ${safeTable}', runtimePolicy);
const transactionCommit = migrateText.indexOf("await client.query('COMMIT;');", ledgerInsert);
if (
  applyLoopStart < 0 ||
  transactionBegin < 0 ||
  migrationSql < transactionBegin ||
  runtimePolicy < migrationSql ||
  ledgerInsert < runtimePolicy ||
  transactionCommit < ledgerInsert
) {
  fail('Migration SQL, runtime privilege policy, ledger insert, and commit are not in one ordered transaction');
}

const testText = fs.readFileSync(
  path.join(baseDir, 'tests/person-contacts-account-lifecycle-schema.test.ts'),
  'utf8'
);
if (testText.includes('.skip(') || testText.includes('.todo(')) fail('P02-M02-A tests contain skipped or todo tests');
const requiredTestEvidence = [
  'ordinary actor binding accepts only a valid, current, unrevoked bearer token',
  'ordinary and recovery bearer types cannot cross their authorized mutation boundaries',
  'recovery tokens reject another Identity, expiration, revocation, consumption, and reuse',
  'failed recovery rolls back token consumption',
  'RECOVERED to ACTIVE rejects recovery credentials and requires a newly issued ordinary session',
  'retirement is authenticated, attributable, immutable, history-preserving, and primary-safe',
  'restricted runtime owns nothing and can execute exactly the seven public APIs',
  'restricted runtime cannot read credentials, mutate tables, alter guards, or execute helpers',
  'INSERT INTO medialab_core.contact_methods',
  'UPDATE medialab_core.contact_methods',
  'DELETE FROM medialab_core.contact_verification_evidence',
  'DISABLE TRIGGER',
  'DROP TRIGGER',
  'resolve_ordinary_session',
  'token_sha256 FROM medialab_core.development_sessions',
  'token_sha256 FROM medialab_core.account_recovery_sessions',
  'ordinary session FOR SHARE blocks concurrent revocation until the authorized mutation commits',
  'pg_catalog.pg_blocking_pids',
  "SET statement_timeout = '5000ms'",
  'revocationSettled',
  "await runtime.query('COMMIT')",
  'rejected_count: 0',
  'temporary relation shadowing cannot alter protected authentication, authorization, evidence, or mutation results',
  'CREATE TEMP TABLE development_sessions',
  'CREATE TEMP TABLE contact_methods',
  'INSERT INTO pg_temp.development_sessions',
  'DROP TABLE IF EXISTS pg_temp.contact_methods',
  'search_path=pg_catalog, medialab_core, pg_temp'
];
for (const evidence of requiredTestEvidence) {
  if (!testText.includes(evidence)) fail(`Executable authority test evidence missing: ${evidence}`);
}

const migrationReadmeText = fs.readFileSync(path.join(baseDir, 'db/migrations/README.md'), 'utf8');
const buildStateText = fs.readFileSync(path.join(baseDir, 'BUILD_STATE.md'), 'utf8');
const requiredRunnerDocumentation = [
  'Migration SQL is deliberately environment-role-neutral',
  '`db/migrate.ts` is the canonical supported migration entrypoint',
  'owner and runtime roles both exist and differ',
  'same database transaction',
  'Raw manual execution of migration `0003` alone is safe but incomplete and is not a supported deployment path',
  'zero direct packet-table privileges',
  'no credential-table reads',
  'zero internal-helper execution',
  'exactly seven public mutation APIs executable',
  'zero PUBLIC function execution'
];
for (const fragment of requiredRunnerDocumentation) {
  if (!migrationReadmeText.includes(fragment)) fail(`Migration-runner documentation missing: ${fragment}`);
}
const requiredStartFreshDocumentation = [
  'START_FRESH records recovery intent for the same Person and Identity while preserving existing history',
  'memberships, contacts, orders, payments, historical evidence, or profile/preferences data',
  'Actual profile/preferences reset behavior remains deferred until those models exist'
];
for (const fragment of requiredStartFreshDocumentation) {
  if (!buildStateText.includes(fragment)) fail(`START_FRESH documentation missing: ${fragment}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(baseDir, 'package.json'), 'utf8'));
if (
  packageJson.scripts?.['verify:person-contacts-account-lifecycle-schema'] !==
  'tsx scripts/verify-person-contacts-account-lifecycle-schema.ts'
) {
  fail('package.json is missing the exact P02-M02-A verifier command');
}
const verifyAll = packageJson.scripts?.['verify:all'] ?? '';
const packetVerifierPosition = verifyAll.indexOf('verify:person-contacts-account-lifecycle-schema');
const foundationPosition = verifyAll.indexOf('verify:foundation-closeout');
if (packetVerifierPosition < 0 || foundationPosition < 0 || packetVerifierPosition > foundationPosition) {
  fail('verify:all must invoke the P02-M02-A verifier before foundation-closeout');
}

if (errors) {
  console.error('Person Contacts and Account Lifecycle schema verification FAILED.');
  process.exit(1);
}

console.log('Person Contacts and Account Lifecycle schema verification PASSED.');
