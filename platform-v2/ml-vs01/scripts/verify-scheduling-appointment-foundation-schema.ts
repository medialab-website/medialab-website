import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';

console.log('Running verify-scheduling-appointment-foundation-schema.ts...');

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(baseDir, '../..');
const TEST_SOCKET = '/tmp/mlvs01-p02m16a-pg';
const TEST_PORT = 55447;
const TEST_DB = 'medialab_p02m16a_test';
const TEST_OWNER_ROLE = 'medialab_p02m16a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m16a_test_app';
let errors = false;

const predecessorMigrations = [
  ['0001_identity_and_tenancy.sql', '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'],
  ['0002_property_identity_and_snapshots.sql', 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'],
  ['0003_person_contacts_and_account_lifecycle.sql', '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'],
  ['0004_current_catalog_and_price_snapshots.sql', 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'],
  ['0005_catalog_administration_lifecycle.sql', '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40'],
  ['0006_orders_and_immutable_commercial_evidence.sql', '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f'],
  ['0007_property_hub_foundation.sql', '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16']
] as const;

const packetMigration = '0008_scheduling_request_and_appointment_foundation.sql';
const packetTables = [
  'appointment_events',
  'appointment_participant_assignment_endings',
  'appointment_participant_assignments',
  'appointments',
  'scheduling_acceptances',
  'scheduling_command_idempotency',
  'scheduling_external_references',
  'scheduling_request_events',
  'scheduling_requests',
  'scheduling_windows'
];

const publicFunctions = [
  'accept_scheduling_proposal',
  'add_scheduling_requested_window',
  'assign_appointment_participant',
  'cancel_appointment',
  'close_scheduling_request',
  'confirm_appointment',
  'create_scheduling_request',
  'end_appointment_participant_assignment',
  'get_appointment_record',
  'get_scheduling_request_record',
  'propose_scheduling_window',
  'record_appointment_no_show',
  'record_appointment_unable_to_complete',
  'record_appointment_weather_delay',
  'record_scheduling_offline_acceptance',
  'replace_appointment_participant_assignment',
  'supersede_and_reschedule_appointment',
  'withdraw_scheduling_request'
];

const helperFunctions = [
  'actor_can_read_scheduling',
  'actor_has_permission',
  'actor_is_order_customer',
  'check_scheduling_idempotency',
  'current_appointment_state',
  'current_scheduling_request_state',
  'guard_scheduling_window_time',
  'record_appointment_status',
  'record_scheduling_idempotency',
  'reject_scheduling_evidence_mutation',
  'require_scheduling_staff',
  'validate_scheduling_time_evidence'
];

const packetTriggers = [
  ['appointment_events_immutability_guard', 'appointment_events', 'reject_scheduling_evidence_mutation'],
  ['appointment_assignment_endings_immutability_guard', 'appointment_participant_assignment_endings', 'reject_scheduling_evidence_mutation'],
  ['appointment_assignments_immutability_guard', 'appointment_participant_assignments', 'reject_scheduling_evidence_mutation'],
  ['appointments_immutability_guard', 'appointments', 'reject_scheduling_evidence_mutation'],
  ['scheduling_acceptances_immutability_guard', 'scheduling_acceptances', 'reject_scheduling_evidence_mutation'],
  ['scheduling_command_idempotency_immutability_guard', 'scheduling_command_idempotency', 'reject_scheduling_evidence_mutation'],
  ['scheduling_external_references_immutability_guard', 'scheduling_external_references', 'reject_scheduling_evidence_mutation'],
  ['scheduling_request_events_immutability_guard', 'scheduling_request_events', 'reject_scheduling_evidence_mutation'],
  ['scheduling_requests_immutability_guard', 'scheduling_requests', 'reject_scheduling_evidence_mutation'],
  ['scheduling_windows_immutability_guard', 'scheduling_windows', 'reject_scheduling_evidence_mutation'],
  ['scheduling_windows_time_guard', 'scheduling_windows', 'guard_scheduling_window_time']
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
  const actualHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(baseDir, 'db/migrations', filename))).digest('hex');
  if (actualHash !== expectedHash) fail(`${filename} predecessor SHA-256 mismatch`);
}
const packetBytes = fs.readFileSync(path.join(baseDir, 'db/migrations', packetMigration));
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
  'STAFF_RESCHEDULE', 'CUSTOMER_AUTHENTICATED', 'STAFF_RECORDED', 'AUTHENTICATED_ORDER_PLACER',
  'PRIMARY_OPERATOR', 'ADDITIONAL_OPERATOR', 'COORDINATOR', 'APPOINTMENT_SUPERSEDED',
  'INACCESSIBLE_PROPERTY', 'UNABLE_TO_COMPLETE', 'WEATHER_DELAYED', 'NO_SHOW',
  'pg_timezone_names', 'AT TIME ZONE', 'pg_advisory_xact_lock',
  'scheduling.staff.manage', 'scheduling.read', 'SECURITY DEFINER',
  'SET search_path = pg_catalog, medialab_core, pg_temp'
]) {
  if (!migrationText.includes(required)) fail(`Migration 0008 missing required evidence: ${required}`);
}

for (const prohibited of [
  'CREATE TABLE medialab_core.jobs', 'CREATE TABLE medialab_core.calendars',
  'CREATE TABLE medialab_core.crews', 'CREATE TABLE medialab_core.payments',
  'CREATE TABLE medialab_core.notifications', 'ON DELETE CASCADE', 'session_user',
  'ARYEO', 'GOOGLE_DRIVE', "'COMPLETED'"
]) {
  if (migrationText.includes(prohibited)) fail(`Migration 0008 contains prohibited evidence: ${prohibited}`);
}

try {
  const status = execFileSync('git', ['status', '--porcelain=v2', '--untracked-files=all'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  const actualPaths = status.split('\n').filter(Boolean).map((line) => {
    if (line.startsWith('? ')) return line.slice(2);
    const parts = line.split(' ');
    return parts[parts.length - 1];
  });
  if (status.split('\n').some((line) => line.startsWith('2 ') || line.includes('.D') || line.includes('D.'))) {
    fail('Changed-file boundary contains a rename or deletion');
  }
} catch (error: any) {
  fail(`Unable to prove independent changed-file boundary: ${error.message || String(error)}`);
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
    ...['0009_job_and_service_workstream_foundation.sql', '0010_mission_plan_foundation.sql', '0011_media_asset_identity_and_lineage_foundation.sql', '0012_durable_media_operations_reconciliation_foundation.sql', '0013_capture_session_ingest_custody_foundation.sql', '0014_media_cull_workspace_selected_media_evidence_foundation.sql', '0015_editor_handoff_returned_media_intake_foundation.sql', '0016_returned_editor_review_final_source_decision_foundation.sql', '0017_publication_delivery_entitlement_foundation.sql', '0018_temporary_download_center_external_sharing_foundation.sql', '0019_temporary_download_center_access_credential_gateway_foundation.sql', '0020_disposable_delivery_surface_local_fixture_foundation.sql', '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql', '0022_organization_records_dashboard_audited_export_foundation.sql', '0023_runtime_intake_reconciliation_commands.sql', '0024_operations_home_scheduling_assignment_console.sql'].map((filename) => ({
      filename,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations', filename))).digest('hex')
    }))
  ];
  if (JSON.stringify(ledger.rows.filter((row:any)=>row.filename!=='0025_operations_mission_plan_draft_controls.sql'&&row.filename!=='0026_editorial_segment_foundation.sql')) !== JSON.stringify(expectedLedger)) {
    fail(`Twenty-two-row migration ledger mismatch: ${JSON.stringify(ledger.rows.filter((row:any)=>row.filename!=='0025_operations_mission_plan_draft_controls.sql'&&row.filename!=='0026_editorial_segment_foundation.sql'))}`);
  }

  const tables = await client.query(
    `SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'medialab_core'
        AND (tablename LIKE 'scheduling_%' OR tablename LIKE 'appointment%')
      ORDER BY tablename`
  );
  exact('Database packet table inventory', tables.rows.map((row) => row.tablename), packetTables);
  if (tables.rows.some((row) => row.tableowner !== TEST_OWNER_ROLE)) fail('Packet table ownership mismatch');

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
  for (const row of functions.rows) {
    if (row.owner !== TEST_OWNER_ROLE) fail(`${row.proname} owner mismatch`);
    if (row.public_execute) fail(`${row.proname} is executable by PUBLIC`);
    if (!Array.isArray(row.proconfig) || row.proconfig[0] !== 'search_path=pg_catalog, medialab_core, pg_temp') {
      fail(`${row.proname} fixed search_path mismatch`);
    }
    const shouldBeRuntime = publicFunctions.includes(row.proname);
    if (row.runtime_execute !== shouldBeRuntime) fail(`${row.proname} runtime EXECUTE mismatch`);
    if (shouldBeRuntime && !row.prosecdef) fail(`${row.proname} must be SECURITY DEFINER`);
  }

  const triggers = await client.query(
    `SELECT t.tgname, c.relname, p.proname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND n.nspname = 'medialab_core'
        AND (c.relname LIKE 'scheduling_%' OR c.relname LIKE 'appointment%')
      ORDER BY c.relname, t.tgname`
  );
  const normalizedTriggers = triggers.rows.map((row) => [row.tgname, row.relname, row.proname]);
  if (JSON.stringify(normalizedTriggers) !== JSON.stringify(packetTriggers)) {
    fail(`Packet trigger inventory mismatch: ${JSON.stringify(normalizedTriggers)}`);
  }

  const directPrivileges = await client.query(
    `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee IN ($1, 'PUBLIC') AND table_schema = 'medialab_core'
        AND (table_name LIKE 'scheduling_%' OR table_name LIKE 'appointment%')`,
    [TEST_RUNTIME_ROLE]
  );
  if (directPrivileges.rows.length !== 0) fail(`Unexpected runtime/PUBLIC table privileges: ${JSON.stringify(directPrivileges.rows)}`);

  const packetPermissions = await client.query(
    `SELECT code, is_active FROM medialab_core.permissions
      WHERE code LIKE 'scheduling.%' ORDER BY code`
  );
  if (JSON.stringify(packetPermissions.rows) !== JSON.stringify([
    { code: 'scheduling.read', is_active: true },
    { code: 'scheduling.staff.manage', is_active: true }
  ])) fail(`Packet permission inventory mismatch: ${JSON.stringify(packetPermissions.rows)}`);

  const uniqueAppointment = await client.query(
    `SELECT count(*)::int AS count FROM pg_constraint
      WHERE connamespace = 'medialab_core'::regnamespace
        AND conname = 'appointments_request_key' AND contype = 'u'`
  );
  if (uniqueAppointment.rows[0].count !== 1) fail('One-Appointment-per-request uniqueness is missing');
} catch (error: any) {
  fail(`Database verification failed: ${error.message || String(error)}`);
} finally {
  await client.end().catch(() => undefined);
}

if (errors) {
  console.error('Scheduling and Appointment foundation verification FAILED.');
  process.exit(1);
}

console.log(`Scheduling and Appointment foundation verification PASSED. Migration SHA-256: ${packetHash}`);
