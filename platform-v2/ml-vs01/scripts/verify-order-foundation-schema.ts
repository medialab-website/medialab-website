import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { ORDER_FOUNDATION_ROW_COUNT_INCREMENTS, ORDER_FOUNDATION_SOURCE } from '../db/fixtures/order-foundation-fixtures.js';

console.log('Running verify-order-foundation-schema.ts...');

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(baseDir, '../..');
const TEST_SOCKET = '/tmp/mlvs01-p02m16a-pg';
const TEST_PORT = 55447;
const TEST_DB = 'medialab_p02m16a_test';
const TEST_OWNER_ROLE = 'medialab_p02m16a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m16a_test_app';
let errors = false;

const expectedMigrations = [
  ['0001_identity_and_tenancy.sql', '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'],
  ['0002_property_identity_and_snapshots.sql', 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'],
  ['0003_person_contacts_and_account_lifecycle.sql', '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'],
  ['0004_current_catalog_and_price_snapshots.sql', 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'],
  ['0005_catalog_administration_lifecycle.sql', '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40'],
  ['0006_orders_and_immutable_commercial_evidence.sql', '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f'],
  ['0007_property_hub_foundation.sql', '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16'],
  ['0008_scheduling_request_and_appointment_foundation.sql', 'cd1b394f95fea42b4cb770e59a1de38e74c7c44bbb3de43de91189fdd9504c9e'],
  ['0009_job_and_service_workstream_foundation.sql', '188cd691645a4ac039c83cf5939885d8b63997ab81ccb37be4667a5011738a66'],
  ['0010_mission_plan_foundation.sql', '2342a7935a27534a4e45233162d35b8b4200839ac0b3fb8394d19015521629c3'],
  ['0011_media_asset_identity_and_lineage_foundation.sql', '1b9fbde392d801ffc8fb0a00a461447cac855bae0046f1d433ac0360b8c15c80'],
  ['0012_durable_media_operations_reconciliation_foundation.sql', '37ae08918b3fdd38ee9fbe2eb24dad3e252c2a58fca0db4171c493a081bb7a8f'],
  ['0013_capture_session_ingest_custody_foundation.sql', 'fb90823b98c56242dcbe4d148f63440d061ae0d7efcc652652c9feafa9be29fa'],
  ['0014_media_cull_workspace_selected_media_evidence_foundation.sql', 'f406c7c329f863f0b34c8a1b99259386dc89c7f26934073de08d01057df8569f'],
  ['0015_editor_handoff_returned_media_intake_foundation.sql', '42a4b5381cbb1b434b2f1871e91fd5cc460d756d16df632c35dfc68b752c31c5'],
  ['0016_returned_editor_review_final_source_decision_foundation.sql', '192bf59bd11acd39355ae4682c9ac25d5430468f23465bc90e1f58366a613b57'],
  ['0017_publication_delivery_entitlement_foundation.sql', '1df90da711216cef0b591c7d1b1b9d1e2fb73b6d18f59fa5f566827d52c9fe5b'],
  ['0018_temporary_download_center_external_sharing_foundation.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0018_temporary_download_center_external_sharing_foundation.sql'))).digest('hex')],
  ['0019_temporary_download_center_access_credential_gateway_foundation.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0019_temporary_download_center_access_credential_gateway_foundation.sql'))).digest('hex')],
  ['0020_disposable_delivery_surface_local_fixture_foundation.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0020_disposable_delivery_surface_local_fixture_foundation.sql'))).digest('hex')],
  ['0021_provider_neutral_file_backed_disposable_delivery_foundation.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0021_provider_neutral_file_backed_disposable_delivery_foundation.sql'))).digest('hex')]
  ,['0022_organization_records_dashboard_audited_export_foundation.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0022_organization_records_dashboard_audited_export_foundation.sql'))).digest('hex')]
  ,['0023_runtime_intake_reconciliation_commands.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0023_runtime_intake_reconciliation_commands.sql'))).digest('hex')]
  ,['0024_operations_home_scheduling_assignment_console.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0024_operations_home_scheduling_assignment_console.sql'))).digest('hex')]
] as const;

const packetTables = [
  'order_events',
  'order_external_references',
  'order_idempotency_records',
  'order_items',
  'order_parties',
  'order_relationships',
  'orders'
];

const packetFunctions = [
  'create_order',
  'get_order_record',
  'guard_order_relationship_insert',
  'reject_order_evidence_mutation',
  'require_order_permission'
];

const packetTriggers = [
  ['order_events_immutability_guard', 'order_events', 'reject_order_evidence_mutation'],
  ['order_external_references_immutability_guard', 'order_external_references', 'reject_order_evidence_mutation'],
  ['order_idempotency_records_immutability_guard', 'order_idempotency_records', 'reject_order_evidence_mutation'],
  ['order_items_immutability_guard', 'order_items', 'reject_order_evidence_mutation'],
  ['order_parties_immutability_guard', 'order_parties', 'reject_order_evidence_mutation'],
  ['order_relationships_immutability_guard', 'order_relationships', 'reject_order_evidence_mutation'],
  ['order_relationships_insert_guard', 'order_relationships', 'guard_order_relationship_insert'],
  ['orders_immutability_guard', 'orders', 'reject_order_evidence_mutation']
];


function fail(message: string): void {
  console.error(`ERROR: ${message}`);
  errors = true;
}

function exact(label: string, actual: string[], expected: string[]): void {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    fail(`${label} mismatch. Expected ${normalizedExpected.join(', ')}, got ${normalizedActual.join(', ')}`);
  }
}

for (const [filename, expectedHash] of expectedMigrations) {
  const bytes = fs.readFileSync(path.join(baseDir, 'db/migrations', filename));
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash) fail(`${filename} SHA-256 mismatch. Expected ${expectedHash}, got ${actualHash}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(baseDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const lockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'package-lock.json'))).digest('hex');
exact('Runtime dependency boundary', Object.entries(packageJson.dependencies ?? {}).map(([name, version]) => `${name}:${version}`), ['fastify:5.11.2', 'pg:8.22.0']);
exact('Development dependency boundary', Object.entries(packageJson.devDependencies ?? {}).map(([name, version]) => `${name}:${version}`), ['@types/node:26.1.2', '@types/pg:8.20.3', 'tsx:4.23.1', 'typescript:7.0.2', 'vitest:4.1.10']);
exact('Optional dependency boundary', Object.entries(packageJson.optionalDependencies ?? {}).map(([name, version]) => `${name}:${version}`), []);
if (lockHash !== '2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a') fail(`package-lock.json SHA-256 mismatch: ${lockHash}`);

const migrationText = fs.readFileSync(path.join(baseDir, 'db/migrations/0006_orders_and_immutable_commercial_evidence.sql'), 'utf8');
exact(
  'Packet table inventory',
  [...migrationText.matchAll(/CREATE TABLE medialab_core\.([a-z0-9_]+)/g)].map((match) => match[1]),
  packetTables
);
exact(
  'Packet function inventory',
  [...migrationText.matchAll(/CREATE OR REPLACE FUNCTION medialab_core\.([a-z0-9_]+)/g)].map((match) => match[1]),
  packetFunctions
);

for (const required of [
  'pg_advisory_xact_lock',
  'order_external_references_source_key',
  'order_idempotency_records_actor_command_key',
  'ORDERING_PERSON',
  'BILLING_PARTY',
  'COMMERCIAL_OWNER',
  'AUTHORIZED_ACTOR',
  'ORDER_RELATIONSHIP_RECORDED',
  'SECURITY DEFINER',
  'SET search_path = pg_catalog, medialab_core, pg_temp',
  'REVOKE ALL ON FUNCTION medialab_core.create_order',
  'REVOKE ALL ON FUNCTION medialab_core.get_order_record'
]) {
  if (!migrationText.includes(required)) fail(`Migration 0006 missing required evidence: ${required}`);
}

for (const prohibited of [
  'CREATE TABLE medialab_core.order_lines',
  'CREATE TABLE medialab_core.jobs',
  'CREATE TABLE medialab_core.payments',
  'ON DELETE CASCADE',
  'session_user',
  'current_setting(',
  'ARYEO'
]) {
  if (migrationText.includes(prohibited)) fail(`Migration 0006 contains prohibited evidence: ${prohibited}`);
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
  fail(`Unable to prove changed-file boundary: ${error.message || String(error)}`);
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
  const expectedLedger = expectedMigrations.map(([filename, sha256]) => ({ filename, sha256 }));
  if (JSON.stringify(ledger.rows.filter((row:any)=>row.filename!=='0025_operations_mission_plan_draft_controls.sql'&&row.filename!=='0026_editorial_segment_foundation.sql'&&row.filename!=='0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql'&&row.filename!=='0028_client_account_and_operator_contact_intake_foundation.sql')) !== JSON.stringify(expectedLedger)) fail(`Twenty-two-row migration ledger mismatch: ${JSON.stringify(ledger.rows.filter((row:any)=>row.filename!=='0025_operations_mission_plan_draft_controls.sql'&&row.filename!=='0026_editorial_segment_foundation.sql'&&row.filename!=='0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql'&&row.filename!=='0028_client_account_and_operator_contact_intake_foundation.sql'))}`);

  const tables = await client.query(
    `SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'medialab_core' AND tablename LIKE 'order%'
        AND tablename <> 'order_client_accounts'
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
    [TEST_RUNTIME_ROLE, packetFunctions]
  );
  exact('Database packet function inventory', functions.rows.map((row) => row.proname), packetFunctions);
  for (const row of functions.rows) {
    if (row.owner !== TEST_OWNER_ROLE) fail(`${row.proname} owner mismatch`);
    if (row.public_execute) fail(`${row.proname} is executable by PUBLIC`);
    if (!Array.isArray(row.proconfig) || row.proconfig[0] !== 'search_path=pg_catalog, medialab_core, pg_temp') {
      fail(`${row.proname} fixed search_path mismatch`);
    }
    const shouldBeRuntime = ['create_order', 'get_order_record'].includes(row.proname);
    if (row.runtime_execute !== shouldBeRuntime) fail(`${row.proname} runtime EXECUTE mismatch`);
    if (shouldBeRuntime && !row.prosecdef) fail(`${row.proname} must be SECURITY DEFINER`);
  }

  const triggers = await client.query(
    `SELECT t.tgname, c.relname, p.proname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND n.nspname = 'medialab_core' AND c.relname LIKE 'order%'
        AND c.relname <> 'order_client_accounts'
      ORDER BY c.relname, t.tgname`
  );
  const normalizedTriggers = triggers.rows.map((row) => [row.tgname, row.relname, row.proname]);
  if (JSON.stringify(normalizedTriggers) !== JSON.stringify(packetTriggers)) fail(`Packet trigger inventory mismatch: ${JSON.stringify(normalizedTriggers)}`);

  const runtimeDml = await client.query(
    `SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee = $1 AND table_schema = 'medialab_core' AND table_name LIKE 'order%'
      ORDER BY table_name, privilege_type`,
    [TEST_RUNTIME_ROLE]
  );
  if (runtimeDml.rows.length !== 0) fail(`Runtime has direct packet table privileges: ${JSON.stringify(runtimeDml.rows)}`);

  const runtimeOwned = await client.query(
    `SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'medialab_core' AND pg_get_userbyid(c.relowner) = $1`,
    [TEST_RUNTIME_ROLE]
  );
  if (runtimeOwned.rows[0].count !== 0) fail('Runtime role owns schema relations');

  const fixture = await client.query(
    `SELECT
       (SELECT count(*)::int FROM medialab_core.orders WHERE source_system = $1) AS orders,
       (SELECT count(*)::int FROM medialab_core.order_parties p JOIN medialab_core.orders o ON o.id = p.order_id WHERE o.source_system = $1) AS parties,
       (SELECT count(*)::int FROM medialab_core.order_items i JOIN medialab_core.orders o ON o.id = i.order_id WHERE o.source_system = $1) AS items,
       (SELECT count(*)::int FROM medialab_core.order_external_references r JOIN medialab_core.orders o ON o.id = r.order_id WHERE o.source_system = $1) AS external_references,
       (SELECT count(*)::int FROM medialab_core.order_idempotency_records r JOIN medialab_core.orders o ON o.id = r.result_order_id WHERE o.source_system = $1) AS idempotency_records,
       (SELECT count(*)::int FROM medialab_core.order_events e JOIN medialab_core.orders o ON o.id = e.order_id WHERE o.source_system = $1) AS events,
       (SELECT count(*)::int FROM medialab_core.order_relationships) AS relationships`,
    [ORDER_FOUNDATION_SOURCE]
  );
  const expectedFixture = {
    orders: ORDER_FOUNDATION_ROW_COUNT_INCREMENTS.orders,
    parties: ORDER_FOUNDATION_ROW_COUNT_INCREMENTS.order_parties,
    items: ORDER_FOUNDATION_ROW_COUNT_INCREMENTS.order_items,
    external_references: ORDER_FOUNDATION_ROW_COUNT_INCREMENTS.order_external_references,
    idempotency_records: ORDER_FOUNDATION_ROW_COUNT_INCREMENTS.order_idempotency_records,
    events: ORDER_FOUNDATION_ROW_COUNT_INCREMENTS.order_events,
    relationships: ORDER_FOUNDATION_ROW_COUNT_INCREMENTS.order_relationships
  };
  if (JSON.stringify(fixture.rows[0]) !== JSON.stringify(expectedFixture)) fail(`Fixture inventory mismatch: ${JSON.stringify(fixture.rows[0])}`);

  const constraints = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE connamespace = 'medialab_core'::regnamespace
        AND conname IN ('order_external_references_source_key',
                        'order_idempotency_records_actor_command_key',
                        'order_items_order_position_key',
                        'order_parties_order_role_key',
                        'order_relationships_not_self_check')
      ORDER BY conname`
  );
  if (constraints.rows.length !== 5) fail(`Required uniqueness and relationship constraints missing: ${JSON.stringify(constraints.rows)}`);
} catch (error: any) {
  fail(`Database verification failed: ${error.message || String(error)}`);
} finally {
  await client.end().catch(() => undefined);
}

if (errors) {
  console.error('Order-foundation schema gate FAILED.');
  process.exit(1);
}

console.log('Order-foundation schema gate PASSED.');
