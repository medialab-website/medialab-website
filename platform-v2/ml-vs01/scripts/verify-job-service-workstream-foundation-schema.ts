import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

console.log('Running verify-job-service-workstream-foundation-schema.ts...');

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(baseDir, 'db/migrations');
const packetMigration = '0009_job_and_service_workstream_foundation.sql';
const successorMigration = '0010_mission_plan_foundation.sql';
const secondSuccessorMigration = '0011_media_asset_identity_and_lineage_foundation.sql';
const thirdSuccessorMigration = '0012_durable_media_operations_reconciliation_foundation.sql';
const fourthSuccessorMigration = '0013_capture_session_ingest_custody_foundation.sql';
const fifthSuccessorMigration = '0014_media_cull_workspace_selected_media_evidence_foundation.sql';
const sixthSuccessorMigration = '0015_editor_handoff_returned_media_intake_foundation.sql';
const TEST_SOCKET = '/tmp/mlvs01-p02m12a-pg';
const TEST_PORT = 55442;
const TEST_DB = 'medialab_p02m12a_test';
const TEST_OWNER_ROLE = 'medialab_p02m12a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m12a_test_app';
let errors = false;

const predecessorMigrations = [
  ['0001_identity_and_tenancy.sql', '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'],
  ['0002_property_identity_and_snapshots.sql', 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'],
  ['0003_person_contacts_and_account_lifecycle.sql', '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'],
  ['0004_current_catalog_and_price_snapshots.sql', 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'],
  ['0005_catalog_administration_lifecycle.sql', '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40'],
  ['0006_orders_and_immutable_commercial_evidence.sql', '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f'],
  ['0007_property_hub_foundation.sql', '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16'],
  ['0008_scheduling_request_and_appointment_foundation.sql', 'cd1b394f95fea42b4cb770e59a1de38e74c7c44bbb3de43de91189fdd9504c9e']
] as const;

const packetTables = [
  'job_appointments',
  'job_events',
  'job_service_command_idempotency',
  'job_service_external_references',
  'jobs',
  'service_workstream_events',
  'service_workstreams'
];

const publicFunctions = [
  'create_job',
  'create_service_workstream',
  'get_job_record',
  'get_service_workstream_record',
  'link_job_appointment',
  'record_job_service_external_reference',
  'transition_job_state',
  'transition_service_workstream_state'
];

const helperFunctions = [
  'check_job_service_idempotency',
  'guard_job_update',
  'guard_service_workstream_update',
  'record_job_service_idempotency',
  'reject_job_service_evidence_mutation',
  'require_job_service_permission'
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
exact('Canonical migration inventory', migrationFiles, [...predecessorMigrations.map(([filename]) => filename), packetMigration, successorMigration, secondSuccessorMigration, thirdSuccessorMigration, fourthSuccessorMigration, fifthSuccessorMigration, sixthSuccessorMigration]);

const packetBytes = fs.readFileSync(path.join(migrationDir, packetMigration));
const packetHash = crypto.createHash('sha256').update(packetBytes).digest('hex');
const migrationText = packetBytes.toString('utf8');

exact(
  'Packet table inventory',
  [...migrationText.matchAll(/CREATE TABLE medialab_core\.([a-z0-9_]+)/g)].map((match) => match[1]),
  packetTables
);
exact(
  'Packet function inventory',
  [...migrationText.matchAll(/CREATE OR REPLACE FUNCTION medialab_core\.([a-z0-9_]+)/g)].map((match) => match[1]),
  [...publicFunctions, ...helperFunctions]
);

for (const required of [
  'order_items_id_order_key', 'appointments_id_organization_order_key',
  'source_order_item_id', 'frozen_source_description', 'job_appointments',
  'DRAFT', 'READY', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED',
  'PENDING', 'IN_PROGRESS', 'pg_advisory_xact_lock', 'job.manage', 'job.read',
  'SECURITY DEFINER', 'SET search_path = pg_catalog, medialab_core, pg_temp',
  'Terminal Job state cannot be reopened', 'Terminal Service Workstream state cannot be reopened',
  'Job completion requires every Workstream to be terminal', 'Accepted Order',
  'Property Hub is not related', 'Appointment is unrelated', 'Order Item is not immutable evidence'
]) {
  if (!migrationText.includes(required)) fail(`Migration 0009 missing required evidence: ${required}`);
}

for (const prohibited of [
  'ON DELETE CASCADE', 'session_user', 'ARYEO', 'GOOGLE_DRIVE', 'MISSION_PLAN',
  'CAPTURE_SESSION', 'PIXELMOB', 'PAYMENT', 'INVOICE', 'PUBLICATION', 'DELIVERY',
  'CREATE TABLE medialab_core.assignments', 'CREATE TABLE medialab_core.assets'
]) {
  if (migrationText.includes(prohibited)) fail(`Migration 0009 contains prohibited evidence: ${prohibited}`);
}

const client = new pg.Client({
  host: TEST_SOCKET,
  port: TEST_PORT,
  database: TEST_DB,
  user: TEST_OWNER_ROLE
});

try {
  await client.connect();

  const ledger = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  const expectedLedger = [
    ...predecessorMigrations.map(([filename, sha256]) => ({ filename, sha256 })),
    { filename: packetMigration, sha256: packetHash },
    {
      filename: successorMigration,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, successorMigration))).digest('hex')
    },
    {
      filename: secondSuccessorMigration,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, secondSuccessorMigration))).digest('hex')
    },
    {
      filename: thirdSuccessorMigration,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, thirdSuccessorMigration))).digest('hex')
    },
    {
      filename: fourthSuccessorMigration,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, fourthSuccessorMigration))).digest('hex')
    },
    {
      filename: fifthSuccessorMigration,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, fifthSuccessorMigration))).digest('hex')
    },
    {
      filename: sixthSuccessorMigration,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, sixthSuccessorMigration))).digest('hex')
    }
  ];
  if (JSON.stringify(ledger.rows) !== JSON.stringify(expectedLedger)) fail('Fifteen-row migration ledger mismatch');

  const tables = await client.query(
    `SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'medialab_core' AND tablename = ANY($1::text[]) ORDER BY tablename`,
    [packetTables]
  );
  exact('Database packet table inventory', tables.rows.map((row) => row.tablename), packetTables);
  if (tables.rows.some((row) => row.tableowner !== TEST_OWNER_ROLE)) fail('Packet table ownership mismatch');

  const sequences = await client.query(
    `SELECT sequencename, sequenceowner FROM pg_sequences
      WHERE schemaname = 'medialab_core' AND sequencename LIKE ANY(ARRAY['job%', 'service_workstream%'])`
  );
  if (sequences.rows.length !== 0) fail('Packet unexpectedly created sequences');

  const functions = await client.query(
    `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
            has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'medialab_core' AND p.proname = ANY($2::text[])
      ORDER BY p.proname`,
    [TEST_RUNTIME_ROLE, [...publicFunctions, ...helperFunctions]]
  );
  exact('Database packet function inventory', functions.rows.map((row) => row.proname), [...publicFunctions, ...helperFunctions]);
  if (functions.rows.some((row) => row.owner !== TEST_OWNER_ROLE)) fail('Packet function ownership mismatch');
  if (functions.rows.some((row) => row.public_execute)) fail('PUBLIC can execute a packet function');
  if (functions.rows.some((row) => publicFunctions.includes(row.proname) !== row.runtime_execute)) {
    fail('Runtime packet function grant inventory mismatch');
  }
  if (functions.rows.some((row) => row.prosecdef && JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp']))) {
    fail('A SECURITY DEFINER packet function lacks the hardened search path');
  }

  const privileges = await client.query(
    `SELECT c.relname,
            has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS runtime_access,
            has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS public_access
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'medialab_core' AND c.relname = ANY($2::text[])`,
    [TEST_RUNTIME_ROLE, packetTables]
  );
  if (privileges.rows.some((row) => row.runtime_access || row.public_access)) fail('Packet table privilege boundary mismatch');

  const triggers = await client.query(
    `SELECT c.relname AS table_name, t.tgname AS trigger_name
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'medialab_core' AND NOT t.tgisinternal
        AND c.relname = ANY($1::text[])`,
    [packetTables]
  );
  const protectedTables = new Set(triggers.rows.map((row) => row.table_name));
  for (const table of packetTables) {
    if (!protectedTables.has(table)) fail(`Packet table ${table} lacks an immutability or controlled-update trigger`);
  }
} catch (error: any) {
  fail(`Database verification failed: ${error.message || String(error)}`);
} finally {
  await client.end().catch(() => undefined);
}

if (errors) {
  console.error('Job and Service Workstream foundation schema verification FAILED.');
  process.exit(1);
}

console.log(`Job and Service Workstream foundation schema verification PASSED. Migration SHA-256: ${packetHash}`);
