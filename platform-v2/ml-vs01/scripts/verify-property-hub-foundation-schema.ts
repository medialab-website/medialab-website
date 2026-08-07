import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { P02_M15_A_ALLOWLIST } from './p02-m15-a-changed-files.js';
import {
  PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS,
  PROPERTY_HUB_ID,
  PROPERTY_HUB_SOURCE
} from '../db/fixtures/property-hub-foundation-fixtures.js';

console.log('Running verify-property-hub-foundation-schema.ts...');

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(baseDir, '../..');
const TEST_SOCKET = '/tmp/mlvs01-p02m15a-pg';
const TEST_PORT = 55443;
const TEST_DB = 'medialab_p02m15a_test';
const TEST_OWNER_ROLE = 'medialab_p02m15a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m15a_test_app';
let errors = false;

const expectedMigrations = [
  ['0001_identity_and_tenancy.sql', '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'],
  ['0002_property_identity_and_snapshots.sql', 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'],
  ['0003_person_contacts_and_account_lifecycle.sql', '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'],
  ['0004_current_catalog_and_price_snapshots.sql', 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'],
  ['0005_catalog_administration_lifecycle.sql', '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40'],
  ['0006_orders_and_immutable_commercial_evidence.sql', '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f'],
  ['0007_property_hub_foundation.sql', '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16']
] as const;

const packetTables = [
  'property_hub_events',
  'property_hub_external_references',
  'property_hub_idempotency_records',
  'property_hub_orders',
  'property_hub_participants',
  'property_hubs'
];

const packetFunctions = [
  'create_property_hub',
  'get_property_hub_record',
  'reject_property_hub_evidence_mutation',
  'require_property_hub_permission'
];

const packetTriggers = [
  ['property_hub_events_immutability_guard', 'property_hub_events', 'reject_property_hub_evidence_mutation'],
  ['property_hub_external_references_immutability_guard', 'property_hub_external_references', 'reject_property_hub_evidence_mutation'],
  ['property_hub_idempotency_records_immutability_guard', 'property_hub_idempotency_records', 'reject_property_hub_evidence_mutation'],
  ['property_hub_orders_immutability_guard', 'property_hub_orders', 'reject_property_hub_evidence_mutation'],
  ['property_hub_participants_immutability_guard', 'property_hub_participants', 'reject_property_hub_evidence_mutation'],
  ['property_hubs_immutability_guard', 'property_hubs', 'reject_property_hub_evidence_mutation']
];

const allowedPaths = [...P02_M15_A_ALLOWLIST].sort();

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

const lockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'package-lock.json'))).digest('hex');
if (lockHash !== '11cc280ef7ff1c66638bc1cc3e85c750844f6041bcf338a5b59c55b0f79d9258') {
  fail(`package-lock.json SHA-256 mismatch: ${lockHash}`);
}

const migrationText = fs.readFileSync(path.join(baseDir, 'db/migrations/0007_property_hub_foundation.sql'), 'utf8');
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
  'property_snapshots_id_property_org_key',
  'orders_id_organization_property_key',
  'property_hub_external_references_source_key',
  'property_hub_idempotency_records_actor_command_key',
  'PROPERTY_HUB_CREATED',
  "current_state = 'ESTABLISHED'",
  'HUB_MANAGER',
  'HUB_PARTICIPANT',
  'pg_advisory_xact_lock',
  'CREATE_PROPERTY_HUB',
  'property_hub.create',
  'property_hub.read',
  'SECURITY DEFINER',
  'SET search_path = pg_catalog, medialab_core, pg_temp',
  'REVOKE ALL ON FUNCTION medialab_core.create_property_hub',
  'REVOKE ALL ON FUNCTION medialab_core.get_property_hub_record'
]) {
  if (!migrationText.includes(required)) fail(`Migration 0007 missing required evidence: ${required}`);
}

for (const prohibited of [
  'ARYEO',
  'CREATE TABLE medialab_core.jobs',
  'CREATE TABLE medialab_core.appointments',
  'CREATE TABLE medialab_core.schedules',
  'CREATE TABLE medialab_core.media',
  'CREATE TABLE medialab_core.payments',
  'CREATE TABLE medialab_core.notifications',
  'ON DELETE CASCADE',
  'session_user',
  'p_actor_identity_id uuid,\n    p_idempotency_key'
]) {
  if (migrationText.includes(prohibited)) fail(`Migration 0007 contains prohibited evidence: ${prohibited}`);
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
  exact('Independent changed-file boundary', actualPaths, allowedPaths);
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
  const expectedLedger = [
    ...expectedMigrations.map(([filename, sha256]) => ({ filename, sha256 })),
    ...[
      '0008_scheduling_request_and_appointment_foundation.sql',
      '0009_job_and_service_workstream_foundation.sql',
      '0010_mission_plan_foundation.sql',
      '0011_media_asset_identity_and_lineage_foundation.sql',
      '0012_durable_media_operations_reconciliation_foundation.sql'
      ,'0013_capture_session_ingest_custody_foundation.sql'
      ,'0014_media_cull_workspace_selected_media_evidence_foundation.sql'
      ,'0015_editor_handoff_returned_media_intake_foundation.sql'
      ,'0016_returned_editor_review_final_source_decision_foundation.sql'
      ,'0017_publication_delivery_entitlement_foundation.sql'
      ,'0018_temporary_download_center_external_sharing_foundation.sql'
    ].map((filename) => ({
      filename,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations', filename))).digest('hex')
    }))
  ];
  if (JSON.stringify(ledger.rows) !== JSON.stringify(expectedLedger)) {
    fail(`Seventeen-row migration ledger mismatch: ${JSON.stringify(ledger.rows)}`);
  }

  const tables = await client.query(
    `SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = 'medialab_core' AND tablename LIKE 'property_hub%'
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
    const shouldBeRuntime = ['create_property_hub', 'get_property_hub_record'].includes(row.proname);
    if (row.runtime_execute !== shouldBeRuntime) fail(`${row.proname} runtime EXECUTE mismatch`);
    if (shouldBeRuntime && !row.prosecdef) fail(`${row.proname} must be SECURITY DEFINER`);
  }

  const triggers = await client.query(
    `SELECT t.tgname, c.relname, p.proname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND n.nspname = 'medialab_core' AND c.relname LIKE 'property_hub%'
      ORDER BY c.relname, t.tgname`
  );
  const normalizedTriggers = triggers.rows.map((row) => [row.tgname, row.relname, row.proname]);
  if (JSON.stringify(normalizedTriggers) !== JSON.stringify(packetTriggers)) {
    fail(`Packet trigger inventory mismatch: ${JSON.stringify(normalizedTriggers)}`);
  }

  const runtimeDml = await client.query(
    `SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee = $1 AND table_schema = 'medialab_core' AND table_name LIKE 'property_hub%'
      ORDER BY table_name, privilege_type`,
    [TEST_RUNTIME_ROLE]
  );
  if (runtimeDml.rows.length !== 0) fail(`Runtime has direct Hub table privileges: ${JSON.stringify(runtimeDml.rows)}`);

  const publicDml = await client.query(
    `SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'PUBLIC' AND table_schema = 'medialab_core' AND table_name LIKE 'property_hub%'
      ORDER BY table_name, privilege_type`
  );
  if (publicDml.rows.length !== 0) fail(`PUBLIC has direct Hub table privileges: ${JSON.stringify(publicDml.rows)}`);

  const fixture = await client.query(
    `SELECT
       (SELECT count(*)::int FROM medialab_core.property_hubs WHERE source_system = $1) AS property_hubs,
       (SELECT count(*)::int FROM medialab_core.property_hub_orders ho JOIN medialab_core.property_hubs h ON h.id = ho.property_hub_id WHERE h.source_system = $1) AS property_hub_orders,
       (SELECT count(*)::int FROM medialab_core.property_hub_participants hp JOIN medialab_core.property_hubs h ON h.id = hp.property_hub_id WHERE h.source_system = $1) AS property_hub_participants,
       (SELECT count(*)::int FROM medialab_core.property_hub_external_references r JOIN medialab_core.property_hubs h ON h.id = r.property_hub_id WHERE h.source_system = $1) AS property_hub_external_references,
       (SELECT count(*)::int FROM medialab_core.property_hub_idempotency_records r JOIN medialab_core.property_hubs h ON h.id = r.result_property_hub_id WHERE h.source_system = $1) AS property_hub_idempotency_records,
       (SELECT count(*)::int FROM medialab_core.property_hub_events e JOIN medialab_core.property_hubs h ON h.id = e.property_hub_id WHERE h.source_system = $1) AS property_hub_events`,
    [PROPERTY_HUB_SOURCE]
  );
  const expectedFixture = {
    property_hubs: PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS.property_hubs,
    property_hub_orders: PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS.property_hub_orders,
    property_hub_participants: PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS.property_hub_participants,
    property_hub_external_references: PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS.property_hub_external_references,
    property_hub_idempotency_records: PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS.property_hub_idempotency_records,
    property_hub_events: PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS.property_hub_events
  };
  if (JSON.stringify(fixture.rows[0]) !== JSON.stringify(expectedFixture)) {
    fail(`Fixture inventory mismatch: ${JSON.stringify(fixture.rows[0])}`);
  }

  const association = await client.query(
    `SELECT h.property_id, h.initial_property_snapshot_id,
            count(DISTINCT ho.order_id)::int AS order_count,
            count(DISTINCT hp.id)::int AS participant_count,
            count(DISTINCT e.id)::int AS event_count
       FROM medialab_core.property_hubs h
       JOIN medialab_core.property_hub_orders ho ON ho.property_hub_id = h.id
       JOIN medialab_core.property_hub_participants hp ON hp.property_hub_id = h.id
       JOIN medialab_core.property_hub_events e ON e.property_hub_id = h.id
      WHERE h.id = $1
      GROUP BY h.id`,
    [PROPERTY_HUB_ID]
  );
  if (association.rows[0]?.order_count !== 2 || association.rows[0]?.participant_count !== 2 || association.rows[0]?.event_count !== 1) {
    fail(`Canonical Hub association proof mismatch: ${JSON.stringify(association.rows[0])}`);
  }

  const constraints = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE connamespace = 'medialab_core'::regnamespace
        AND conname IN ('property_hub_external_references_source_key',
                        'property_hub_idempotency_records_actor_command_key',
                        'property_hub_orders_pkey',
                        'property_hub_participants_membership_role_key',
                        'property_hubs_id_organization_property_key')
      ORDER BY conname`
  );
  if (constraints.rows.length !== 5) fail(`Required Hub constraints missing: ${JSON.stringify(constraints.rows)}`);
} catch (error: any) {
  fail(`Database verification failed: ${error.message || String(error)}`);
} finally {
  await client.end().catch(() => undefined);
}

if (errors) {
  console.error('Property Hub foundation schema gate FAILED.');
  process.exit(1);
}

console.log('Property Hub foundation schema gate PASSED.');
