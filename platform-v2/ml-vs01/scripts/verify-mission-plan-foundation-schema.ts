import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

console.log('Running verify-mission-plan-foundation-schema.ts...');

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(baseDir, 'db/migrations');
const packetMigration = '0010_mission_plan_foundation.sql';
const TEST_SOCKET = '/tmp/mlvs01-p02m04a-pg';
const TEST_PORT = 55432;
const TEST_DB = 'medialab_p02m04a_test';
const TEST_OWNER_ROLE = 'medialab_p02m04a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m04a_test_app';
let errors = false;

const predecessorMigrations = [
  ['0001_identity_and_tenancy.sql', '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'],
  ['0002_property_identity_and_snapshots.sql', 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'],
  ['0003_person_contacts_and_account_lifecycle.sql', '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'],
  ['0004_current_catalog_and_price_snapshots.sql', 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'],
  ['0005_catalog_administration_lifecycle.sql', '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40'],
  ['0006_orders_and_immutable_commercial_evidence.sql', '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f'],
  ['0007_property_hub_foundation.sql', '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16'],
  ['0008_scheduling_request_and_appointment_foundation.sql', 'cd1b394f95fea42b4cb770e59a1de38e74c7c44bbb3de43de91189fdd9504c9e'],
  ['0009_job_and_service_workstream_foundation.sql', '188cd691645a4ac039c83cf5939885d8b63997ab81ccb37be4667a5011738a66']
] as const;

const packetTables = [
  'mission_plan_command_idempotency', 'mission_plan_draft_contacts', 'mission_plan_draft_workstreams',
  'mission_plan_drafts', 'mission_plan_events', 'mission_plan_notes', 'mission_plan_open_events',
  'mission_plan_sensitive_envelopes', 'mission_plan_version_contacts', 'mission_plan_version_notes',
  'mission_plan_version_workstreams', 'mission_plan_versions', 'mission_plans'
];

const publicFunctions = [
  'add_mission_plan_note', 'create_mission_plan_draft', 'create_mission_plan_superseding_draft',
  'get_mission_plan_record', 'list_mission_plans',
  'get_mission_plan_sensitive_envelopes', 'issue_mission_plan_version',
  'record_mission_plan_open_event', 'record_mission_plan_sensitive_envelope',
  'refresh_mission_plan_draft', 'replace_mission_plan_draft_contacts',
  'replace_mission_plan_draft_workstreams', 'revise_mission_plan_draft'
];

const helperFunctions = [
  'actor_can_read_mission_plan', 'check_mission_plan_idempotency',
  'compute_mission_plan_source_fingerprint', 'guard_mission_plan_draft_update',
  'record_mission_plan_idempotency', 'reject_mission_plan_evidence_mutation',
  'require_mission_plan_permission', 'validate_mission_plan_content'
];

function fail(message: string): void {
  console.error(`ERROR: ${message}`);
  errors = true;
}

function exact(label: string, actual: string[], expected: string[]): void {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    fail(`${label} mismatch. Expected ${[...expected].sort().join(', ')}, got ${[...actual].sort().join(', ')}`);
  }
}

for (const [filename, expectedHash] of predecessorMigrations) {
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, filename))).digest('hex');
  if (actualHash !== expectedHash) fail(`${filename} predecessor SHA-256 mismatch`);
}

const migrationFiles = fs.readdirSync(migrationDir).filter((filename) => filename.endsWith('.sql')).sort();
exact('Canonical migration inventory', migrationFiles, [...predecessorMigrations.map(([filename]) => filename), packetMigration]);

const packetBytes = fs.readFileSync(path.join(migrationDir, packetMigration));
const packetHash = crypto.createHash('sha256').update(packetBytes).digest('hex');
const migrationText = packetBytes.toString('utf8');

exact('Packet table inventory', [...migrationText.matchAll(/CREATE TABLE medialab_core\.([a-z0-9_]+)/g)].map((m) => m[1]), packetTables);
exact('Packet function inventory', [...migrationText.matchAll(/CREATE OR REPLACE FUNCTION medialab_core\.([a-z0-9_]+)/g)].map((m) => m[1]), [...publicFunctions, ...helperFunctions]);

for (const required of [
  'job_appointments_mission_plan_identity_key', 'mission_plans_job_appointment_key',
  'draft_generation', 'source_fingerprint_sha256', 'supersedes_version_id',
  'canonical_json_sha256', 'canonical JSON readback hash mismatch', 'pg_advisory_xact_lock',
  'ALL_ELIGIBLE_NONTERMINAL', 'Selected Workstream is cross-tenant, cross-Job, missing, or terminal',
  'INTERNAL_STAFF_ONLY', 'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE',
  'envelope_format_version', 'algorithm_identifier', 'key_reference_identifier', 'nonce_or_iv',
  'supersedes_envelope_id',
  'opaque_ciphertext', 'ciphertext_sha256', 'trusted_payload_sha256',
  'Mission Plan draft is stale', 'immutable append-only evidence', 'mission_plan.manage',
  'mission_plan.read', 'mission_plan.sensitive_read', 'SECURITY DEFINER',
  'SET search_path = pg_catalog, medialab_core, pg_temp'
]) {
  if (!migrationText.includes(required)) fail(`Migration 0010 missing required evidence: ${required}`);
}

for (const prohibited of [
  'ON DELETE CASCADE', 'session_user', 'CREATE TABLE medialab_core.assets',
  'CREATE TABLE medialab_core.capture_sessions', 'CREATE TABLE medialab_core.invoices',
  'CREATE TABLE medialab_core.publications', 'CREATE TABLE medialab_core.deliveries',
  'CREATE TABLE medialab_core.gear', 'gear_id', 'gear_items'
]) {
  if (migrationText.includes(prohibited)) fail(`Migration 0010 contains prohibited evidence: ${prohibited}`);
}

if (/plaintext_secret\s+(text|bytea|jsonb)/i.test(migrationText)) fail('Migration declares a plaintext-secret storage column');

const client = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_OWNER_ROLE });
try {
  await client.connect();
  const ledger = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  const expectedLedger = [
    ...predecessorMigrations.map(([filename, sha256]) => ({ filename, sha256 })),
    { filename: packetMigration, sha256: packetHash }
  ];
  if (JSON.stringify(ledger.rows) !== JSON.stringify(expectedLedger)) fail('Ten-row migration ledger mismatch');

  const tables = await client.query(
    `SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'medialab_core' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [packetTables]
  );
  exact('Database packet table inventory', tables.rows.map((row) => row.tablename), packetTables);
  if (tables.rows.some((row) => row.tableowner !== TEST_OWNER_ROLE)) fail('Mission Plan table ownership mismatch');

  const functions = await client.query(
    `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
            has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'medialab_core' AND p.proname = ANY($2::text[]) ORDER BY p.proname`,
    [TEST_RUNTIME_ROLE, [...publicFunctions, ...helperFunctions]]
  );
  exact('Database packet function inventory', functions.rows.map((row) => row.proname), [...publicFunctions, ...helperFunctions]);
  if (functions.rows.some((row) => row.owner !== TEST_OWNER_ROLE)) fail('Mission Plan function ownership mismatch');
  if (functions.rows.some((row) => row.public_execute)) fail('PUBLIC can execute a Mission Plan function');
  if (functions.rows.some((row) => publicFunctions.includes(row.proname) !== row.runtime_execute)) {
    fail('Restricted runtime Mission Plan grant inventory mismatch');
  }
  if (functions.rows.some((row) => row.prosecdef && JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp']))) {
    fail('A Mission Plan SECURITY DEFINER function lacks the hardened search path');
  }

  const privileges = await client.query(
    `SELECT c.relname,
            has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS runtime_access,
            has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS public_access
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'medialab_core' AND c.relname = ANY($2::text[])`,
    [TEST_RUNTIME_ROLE, packetTables]
  );
  if (privileges.rows.some((row) => row.runtime_access || row.public_access)) fail('Mission Plan direct table privilege boundary mismatch');
} catch (error: any) {
  fail(`Database verification failed: ${error.message || String(error)}`);
} finally {
  await client.end().catch(() => undefined);
}

if (errors) {
  console.error('Mission Plan foundation verification FAILED.');
  process.exit(1);
}
console.log(`Mission Plan foundation verification PASSED. 0010 SHA-256: ${packetHash}`);
