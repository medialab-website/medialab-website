import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

console.log('Running verify-media-asset-identity-lineage-schema.ts...');
const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(baseDir, 'db/migrations');
const packetMigration = '0011_media_asset_identity_and_lineage_foundation.sql';
const successorMigration = '0012_durable_media_operations_reconciliation_foundation.sql';
const secondSuccessorMigration = '0013_capture_session_ingest_custody_foundation.sql';
const thirdSuccessorMigration = '0014_media_cull_workspace_selected_media_evidence_foundation.sql';
const fourthSuccessorMigration = '0015_editor_handoff_returned_media_intake_foundation.sql';
const fifthSuccessorMigration = '0016_returned_editor_review_final_source_decision_foundation.sql';
const sixthSuccessorMigration = '0017_publication_delivery_entitlement_foundation.sql';
const seventhSuccessorMigration = '0018_temporary_download_center_external_sharing_foundation.sql';
const eighthSuccessorMigration = '0019_temporary_download_center_access_credential_gateway_foundation.sql';
const ninthSuccessorMigration = '0020_disposable_delivery_surface_local_fixture_foundation.sql';
const tenthSuccessorMigration = '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql';
const eleventhSuccessorMigration = '0022_organization_records_dashboard_audited_export_foundation.sql';
const runtimeIntakeSuccessorMigration = '0023_runtime_intake_reconciliation_commands.sql';
const operationsSuccessorMigration = '0024_operations_home_scheduling_assignment_console.sql';
const predecessorMigrations = [
  ['0001_identity_and_tenancy.sql', '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'],
  ['0002_property_identity_and_snapshots.sql', 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'],
  ['0003_person_contacts_and_account_lifecycle.sql', '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'],
  ['0004_current_catalog_and_price_snapshots.sql', 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'],
  ['0005_catalog_administration_lifecycle.sql', '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40'],
  ['0006_orders_and_immutable_commercial_evidence.sql', '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f'],
  ['0007_property_hub_foundation.sql', '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16'],
  ['0008_scheduling_request_and_appointment_foundation.sql', 'cd1b394f95fea42b4cb770e59a1de38e74c7c44bbb3de43de91189fdd9504c9e'],
  ['0009_job_and_service_workstream_foundation.sql', '188cd691645a4ac039c83cf5939885d8b63997ab81ccb37be4667a5011738a66'],
  ['0010_mission_plan_foundation.sql', '2342a7935a27534a4e45233162d35b8b4200839ac0b3fb8394d19015521629c3']
] as const;
const tables = ['media_approved_source_designations', 'media_asset_lineage', 'media_asset_versions',
  'media_assets', 'media_capture_relationships', 'media_command_idempotency', 'media_location_observations',
  'media_manifests', 'media_storage_objects', 'media_transfer_events', 'media_verification_events'];
const publicFunctions = ['add_media_asset_version', 'create_media_asset', 'create_media_manifest',
  'designate_media_approved_source', 'get_media_asset_record', 'get_media_manifest',
  'record_media_capture_relationship', 'record_media_lineage', 'record_media_location_observation',
  'record_media_storage_object', 'record_media_transfer_event', 'record_media_verification_event'];
const helperFunctions = ['check_media_idempotency', 'record_media_idempotency', 'reject_media_evidence_mutation',
  'require_media_permission', 'validate_media_safe_json'];
let errors = false;
function fail(message: string): void { console.error(`ERROR: ${message}`); errors = true; }
function exact(label: string, actual: string[], expected: string[]): void {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    fail(`${label} mismatch. Expected ${[...expected].sort().join(', ')}, got ${[...actual].sort().join(', ')}`);
  }
}
for (const [filename, expected] of predecessorMigrations) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, filename))).digest('hex');
  if (actual !== expected) fail(`${filename} predecessor SHA-256 mismatch`);
}
const migrationFiles = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql') && name !== '0025_operations_mission_plan_draft_controls.sql' && name !== '0026_editorial_segment_foundation.sql').sort();
exact('Migration inventory', migrationFiles, [...predecessorMigrations.map(([name]) => name), packetMigration, successorMigration, secondSuccessorMigration, thirdSuccessorMigration, fourthSuccessorMigration, fifthSuccessorMigration, sixthSuccessorMigration, seventhSuccessorMigration, eighthSuccessorMigration, ninthSuccessorMigration, tenthSuccessorMigration, eleventhSuccessorMigration, runtimeIntakeSuccessorMigration, operationsSuccessorMigration]);
const packetBytes = fs.readFileSync(path.join(migrationDir, packetMigration));
const packetHash = crypto.createHash('sha256').update(packetBytes).digest('hex');
const successorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, successorMigration))).digest('hex');
const secondSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, secondSuccessorMigration))).digest('hex');
const thirdSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, thirdSuccessorMigration))).digest('hex');
const fourthSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, fourthSuccessorMigration))).digest('hex');
const fifthSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, fifthSuccessorMigration))).digest('hex');
const sixthSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, sixthSuccessorMigration))).digest('hex');
const seventhSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, seventhSuccessorMigration))).digest('hex');
const eighthSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, eighthSuccessorMigration))).digest('hex');
const ninthSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, ninthSuccessorMigration))).digest('hex');
const tenthSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, tenthSuccessorMigration))).digest('hex');
const eleventhSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, eleventhSuccessorMigration))).digest('hex');
const runtimeIntakeSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, runtimeIntakeSuccessorMigration))).digest('hex');
const operationsSuccessorHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir, operationsSuccessorMigration))).digest('hex');
const sql = packetBytes.toString('utf8');
exact('Packet table inventory', [...sql.matchAll(/CREATE TABLE medialab_core\.([a-z0-9_]+)/g)].map((m) => m[1]), tables);
exact('Packet function inventory', [...sql.matchAll(/CREATE OR REPLACE FUNCTION medialab_core\.([a-z0-9_]+)/g)].map((m) => m[1]), [...publicFunctions, ...helperFunctions]);
for (const evidence of ['ORIGINAL_TO_EDITOR_RETURN', 'EDITOR_RETURN_TO_CORRECTED_VERSION', 'HDR_BRACKET',
  'JPEG_RAW_PAIR', 'DRONE_JPEG_DNG_PAIR', 'USE_ORIGINAL', 'SKIP_QUICK_EDIT', 'REPLACEMENT_SOURCE',
  'Media manifest readback hash mismatch', 'pg_advisory_xact_lock', 'media_asset.manage', 'media_asset.read',
  'Provider credentials and secrets are prohibited', 'SECURITY DEFINER',
  'SET search_path = pg_catalog, medialab_core, pg_temp']) {
  if (!sql.includes(evidence)) fail(`Migration 0011 missing required evidence: ${evidence}`);
}
for (const prohibited of ['ON DELETE CASCADE', 'CREATE TABLE medialab_core.capture_sessions',
  'CREATE TABLE medialab_core.quick_edit', 'CREATE TABLE medialab_core.deliveries',
  'CREATE TABLE medialab_core.publications', 'drive.googleapis.com', 'aws_secret_access_key']) {
  if (sql.includes(prohibited)) fail(`Migration 0011 contains prohibited evidence: ${prohibited}`);
}
const client = new pg.Client({ host: '/tmp/mlvs01-p02m16a-pg', port: 55447,
  database: 'medialab_p02m16a_test', user: 'medialab_p02m16a_test_owner' });
try {
  await client.connect();
  const ledger = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  const expectedLedger = [...predecessorMigrations.map(([filename, sha256]) => ({ filename, sha256 })),
    { filename: packetMigration, sha256: packetHash }, { filename: successorMigration, sha256: successorHash },
    { filename: secondSuccessorMigration, sha256: secondSuccessorHash },
    { filename: thirdSuccessorMigration, sha256: thirdSuccessorHash },
    { filename: fourthSuccessorMigration, sha256: fourthSuccessorHash },
    { filename: fifthSuccessorMigration, sha256: fifthSuccessorHash },
    { filename: sixthSuccessorMigration, sha256: sixthSuccessorHash },
    { filename: seventhSuccessorMigration, sha256: seventhSuccessorHash },
    { filename: eighthSuccessorMigration, sha256: eighthSuccessorHash },
    { filename: ninthSuccessorMigration, sha256: ninthSuccessorHash },
    { filename: tenthSuccessorMigration, sha256: tenthSuccessorHash },
    { filename: eleventhSuccessorMigration, sha256: eleventhSuccessorHash },
    { filename: runtimeIntakeSuccessorMigration, sha256: runtimeIntakeSuccessorHash },
    { filename: operationsSuccessorMigration, sha256: operationsSuccessorHash }];
  if (JSON.stringify(ledger.rows.filter((row:any)=>row.filename!=='0025_operations_mission_plan_draft_controls.sql'&&row.filename!=='0026_editorial_segment_foundation.sql')) !== JSON.stringify(expectedLedger)) fail('Twenty-four-row predecessor migration ledger mismatch');
  const dbTables = await client.query(
    `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'medialab_core'
      AND tablename = ANY($1::text[]) ORDER BY tablename`, [tables]
  );
  exact('Database table inventory', dbTables.rows.map((row) => row.tablename), tables);
  if (dbTables.rows.some((row) => row.tableowner !== 'medialab_p02m16a_test_owner')) fail('Packet table ownership mismatch');
  const dbFunctions = await client.query(
    `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
            has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'medialab_core' AND p.proname = ANY($2::text[]) ORDER BY p.proname`,
    ['medialab_p02m16a_test_app', [...publicFunctions, ...helperFunctions]]
  );
  exact('Database function inventory', dbFunctions.rows.map((row) => row.proname), [...publicFunctions, ...helperFunctions]);
  if (dbFunctions.rows.some((row) => row.owner !== 'medialab_p02m16a_test_owner')) fail('Packet function ownership mismatch');
  if (dbFunctions.rows.some((row) => row.public_execute)) fail('PUBLIC can execute a packet function');
  if (dbFunctions.rows.some((row) => publicFunctions.includes(row.proname) !== row.runtime_execute)) fail('Runtime function grant inventory mismatch');
  if (dbFunctions.rows.some((row) => row.prosecdef && JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp']))) {
    fail('A SECURITY DEFINER function lacks the hardened search path');
  }
  const privileges = await client.query(
    `SELECT c.relname, has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS runtime_access,
            has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS public_access
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'medialab_core' AND c.relname = ANY($2::text[])`,
    ['medialab_p02m16a_test_app', tables]
  );
  if (privileges.rows.some((row) => row.runtime_access || row.public_access)) fail('Direct table privilege boundary mismatch');
} catch (error: any) {
  fail(`Database verification failed: ${error.message || String(error)}`);
} finally { await client.end().catch(() => undefined); }
if (errors) { console.error('Media asset identity and lineage verification FAILED.'); process.exit(1); }
console.log(`Media asset identity and lineage verification PASSED. 0011 SHA-256: ${packetHash}`);
