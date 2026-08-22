import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { CATALOG_EXPECTED_ROW_COUNTS } from '../db/fixtures/current-catalog-price-fixtures.js';
import { CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS } from '../db/fixtures/current-real-estate-catalog-seed.js';
import { ORDER_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/order-foundation-fixtures.js';

console.log('Running verify-current-catalog-price-reconstruction-schema.ts...');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(baseDir, '../..');
let errors = false;

const TEST_SOCKET = '/tmp/mlvs01-p02m16a-pg';
const TEST_PORT = 55447;
const TEST_DB = 'medialab_p02m16a_test';
const TEST_OWNER_ROLE = 'medialab_p02m16a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m16a_test_app';

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
  'catalog_bracket_sets',
  'catalog_external_mappings',
  'catalog_package_version_items',
  'catalog_package_versions',
  'catalog_price_brackets',
  'catalog_prices',
  'catalog_product_change_events',
  'catalog_products',
  'commercial_snapshot_package_items',
  'commercial_snapshots',
  'custom_commercial_snapshots'
];

const packetFunctions = [
  'create_catalog_commercial_snapshot',
  'create_catalog_product',
  'create_custom_commercial_snapshot',
  'get_current_catalog_package_inclusions',
  'get_current_selectable_catalog',
  'record_catalog_external_mapping',
  'record_catalog_price',
  'reject_catalog_evidence_mutation',
  'reject_catalog_product_delete',
  'replace_catalog_bracket_set',
  'replace_catalog_package_composition',
  'require_catalog_permission',
  'revise_catalog_product'
];

const runtimeFunctions = packetFunctions.filter((name) => ![
  'reject_catalog_evidence_mutation',
  'reject_catalog_product_delete',
  'require_catalog_permission'
].includes(name));


const metadataDigests = {
  columns: ['157', '7d702e90254f03aeb86b34ac0df51761e70a1c8ec9b488b21e0289702676d4cc'],
  constraints: ['140', 'dd481681b65ad91f55a825d9f0b1e15bcc27c34da7a9c43d44d2752ba55dce8f'],
  indexes: ['36', '4d3eaadeb44e18f3a159a7f6857d0cb906ff07dd5c2b7d4a6133d66cc47e8295'],
  triggers: ['12', '65c47cb994d63be2d00dc247e985e200e9ed49d80449a09d2347b29787c90585']
} as const;

const expectedFunctionSignatures = [
  ['create_catalog_commercial_snapshot', 'p_session_token text, p_snapshot_id uuid, p_product_id uuid, p_quantity numeric, p_basis_value bigint, p_adjustment_amount_cents bigint, p_adjustment_reason text, p_travel_estimate_amount_cents bigint, p_travel_estimate_basis text, p_effective_at timestamp with time zone, p_source_system text, p_source_record_type text, p_source_record_identifier text, p_material_increase_amount_cents bigint, p_renewed_accepted_at timestamp with time zone', 'uuid'],
  ['create_catalog_product', 'p_session_token text, p_product_id uuid, p_product_code text, p_display_name text, p_product_kind text, p_classification text, p_commercial_unit text, p_source_system text', 'uuid'],
  ['create_custom_commercial_snapshot', 'p_session_token text, p_snapshot_id uuid, p_description text, p_approved_price_cents bigint, p_currency text, p_quantity numeric, p_reason text, p_adjustment_amount_cents bigint, p_adjustment_reason text, p_travel_estimate_amount_cents bigint, p_travel_estimate_basis text, p_source_system text, p_effective_at timestamp with time zone, p_material_increase_amount_cents bigint, p_renewed_accepted_at timestamp with time zone', 'uuid'],
  ['get_current_catalog_package_inclusions', 'p_effective_at timestamp with time zone', 'TABLE(package_product_id uuid, package_product_code text, package_display_name text, package_version_id uuid, package_version_number integer, included_product_id uuid, included_product_code text, included_display_name text, included_classification text, quantity numeric, commercial_unit text, item_position integer)'],
  ['get_current_selectable_catalog', 'p_effective_at timestamp with time zone', 'TABLE(product_id uuid, product_code text, display_name text, product_kind text, classification text, commercial_unit text, price_evidence_id uuid, amount_cents bigint, currency text, bracket_set_id uuid, bracket_id uuid, bracket_code text, bracket_basis text, lower_bound bigint, upper_bound bigint, lower_inclusive boolean, upper_inclusive boolean, effective_at timestamp with time zone)'],
  ['record_catalog_external_mapping', 'p_session_token text, p_mapping_id uuid, p_provider text, p_external_record_type text, p_external_identifier text, p_target_product_id uuid, p_source_system text, p_observed_at timestamp with time zone', 'uuid'],
  ['record_catalog_price', 'p_session_token text, p_price_id uuid, p_product_id uuid, p_amount_cents bigint, p_currency text, p_effective_at timestamp with time zone, p_source_system text, p_source_record_identifier text', 'uuid'],
  ['reject_catalog_evidence_mutation', '', 'trigger'],
  ['reject_catalog_product_delete', '', 'trigger'],
  ['replace_catalog_bracket_set', 'p_session_token text, p_bracket_set_id uuid, p_package_product_id uuid, p_bracket_basis text, p_effective_at timestamp with time zone, p_source_system text, p_brackets jsonb', 'uuid'],
  ['replace_catalog_package_composition', 'p_session_token text, p_package_version_id uuid, p_package_product_id uuid, p_effective_at timestamp with time zone, p_source_system text, p_items jsonb', 'uuid'],
  ['require_catalog_permission', 'p_actor_identity_id uuid, p_permission_code text', 'void'],
  ['revise_catalog_product', 'p_session_token text, p_product_id uuid, p_display_name text, p_lifecycle_state text, p_reason text, p_source_system text', 'void']
] as const;

const ownerTablePrivileges = ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'];

function fail(message: string): void {
  console.error(`ERROR: ${message}`);
  errors = true;
}

function digestRows(rows: unknown[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function exact(label: string, actual: string[], expected: string[]): void {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(`${label} mismatch. Expected ${sortedExpected.join(', ')}, got ${sortedActual.join(', ')}`);
  }
}

for (const [filename, expectedHash] of expectedMigrations) {
  const bytes = fs.readFileSync(path.join(baseDir, 'db/migrations', filename));
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash) fail(`${filename} SHA-256 mismatch. Expected ${expectedHash}, got ${actualHash}`);
}
const migrationFiles = fs.readdirSync(path.join(baseDir, 'db/migrations')).filter((name) => name.endsWith('.sql') && name !== '0025_operations_mission_plan_draft_controls.sql' && name !== '0026_editorial_segment_foundation.sql' && name !== '0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql' && name !== '0028_client_account_and_operator_contact_intake_foundation.sql').sort();
exact('Canonical migration inventory', migrationFiles, expectedMigrations.map(([filename]) => filename));

const packageJson = JSON.parse(fs.readFileSync(path.join(baseDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const lockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'package-lock.json'))).digest('hex');
exact('Runtime dependency boundary', Object.entries(packageJson.dependencies ?? {}).map(([name, version]) => `${name}:${version}`), ['fastify:5.11.2', 'pg:8.22.0']);
exact('Development dependency boundary', Object.entries(packageJson.devDependencies ?? {}).map(([name, version]) => `${name}:${version}`), ['@types/node:26.1.2', '@types/pg:8.20.3', 'tsx:4.23.1', 'typescript:7.0.2', 'vitest:4.1.10']);
exact('Optional dependency boundary', Object.entries(packageJson.optionalDependencies ?? {}).map(([name, version]) => `${name}:${version}`), []);
if (lockHash !== '2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a') {
  fail(`package-lock.json SHA-256 mismatch: ${lockHash}`);
}

const migrationText = fs.readFileSync(path.join(baseDir, 'db/migrations/0004_current_catalog_and_price_snapshots.sql'), 'utf8');
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

const requiredMigrationEvidence = [
  "catalog_origin IN ('CURRENT', 'LEGACY')",
  "lifecycle_state IN ('ACTIVE', 'RETIRED', 'NONSELECTABLE')",
  "catalog_origin <> 'LEGACY' OR lifecycle_state = 'NONSELECTABLE'",
  'amount_cents bigint NOT NULL',
  "currency ~ '^[A-Z]{3}$'",
  'bracket_lower_inclusive boolean NULL',
  'bracket_upper_inclusive boolean NULL',
  'adjustment_actor_identity_id uuid NULL',
  'adjustment_at timestamptz NULL',
  'travel_estimate_basis text NULL',
  'renewed_acceptance_required boolean NOT NULL',
  'source_record_identifier text NULL',
  'Custom commercial evidence cannot be promoted through ordinary catalog creation',
  'Package inclusion must reference another current, nonretired canonical product',
  'Bracket set contains a gap or overlap',
  'Catalog products cannot be deleted',
  'is immutable;',
  'FROM medialab_core.resolve_ordinary_session(p_session_token)',
  "PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage')",
  "PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.snapshot_create')",
  'SET search_path = pg_catalog, medialab_core, pg_temp;'
];
for (const evidence of requiredMigrationEvidence) {
  if (!migrationText.includes(evidence)) fail(`Migration evidence missing: ${evidence}`);
}

const securityDefinerCount = migrationText.match(/SECURITY DEFINER/g)?.length ?? 0;
const fixedPathCount = migrationText.match(/SECURITY DEFINER\s+SET search_path = pg_catalog, medialab_core, pg_temp;/g)?.length ?? 0;
if (securityDefinerCount !== 13 || fixedPathCount !== 13) {
  fail(`Expected 13 fixed-path SECURITY DEFINER functions, got ${securityDefinerCount}/${fixedPathCount}`);
}
for (const prohibited of ['CREATE TABLE medialab_core.order_lines', 'organization_id uuid', 'ON DELETE CASCADE', 'current_setting(', 'session_user']) {
  if (migrationText.includes(prohibited)) fail(`Prohibited migration construct found: ${prohibited}`);
}

const fixtureText = fs.readFileSync(path.join(baseDir, 'db/fixtures/current-catalog-price-fixtures.ts'), 'utf8');
for (const required of ['SYNTH_HOME_PACKAGE', 'SYNTH_RETIRED_ADDON', 'SYNTH_LEGACY_ALACARTE', 'synthetic-aryeo-product-001', 'SYNTHETIC_P02_M03_A_FIXTURE']) {
  if (!fixtureText.includes(required)) fail(`Synthetic fixture evidence missing: ${required}`);
}
if (/@(?!fixture\.medialab\.invalid)/.test(fixtureText)) fail('Packet fixture contains a non-fixture email-shaped value');

const testText = fs.readFileSync(path.join(baseDir, 'tests/current-catalog-price-reconstruction.test.ts'), 'utf8');
if (testText.includes('.skip(') || testText.includes('.todo(') || testText.includes('retry:')) {
  fail('Packet tests contain a skip, todo, or retry configuration');
}
for (const evidence of ['rejects bracket gaps', 'rejects bracket overlaps', 'rejects recovery authority', 'rejects suspended catalog actors', 'zero table DML']) {
  if (!testText.includes(evidence)) fail(`Behavioral test evidence missing: ${evidence}`);
}

const porcelain = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: repositoryRoot,
  encoding: 'utf8'
}).trimEnd();
const statusLines = porcelain ? porcelain.split('\n') : [];
const actualPaths: string[] = [];
for (const line of statusLines) {
  const status = line.slice(0, 2);
  const name = line.slice(3);
  if (status.includes('D') || status.includes('R') || status.includes('C')) {
    fail(`Disallowed status ${status} for ${name}`);
  }
  actualPaths.push(name);
}
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
if (staged) fail(`Candidate has staged paths: ${staged.replaceAll('\n', ', ')}`);

const host = process.env.PGHOST ?? TEST_SOCKET;
const port = Number(process.env.PGPORT ?? TEST_PORT);
const database = process.env.PGDATABASE ?? TEST_DB;
const user = process.env.PGUSER ?? TEST_OWNER_ROLE;
if (host !== TEST_SOCKET || port !== TEST_PORT || database !== TEST_DB || user !== TEST_OWNER_ROLE) {
  fail(`Verifier database boundary mismatch: host=${host} port=${port} database=${database} user=${user}`);
}

const tableListSql = `(${packetTables.map((table) => `'${table}'`).join(',')})`;
const functionListSql = `(${packetFunctions.map((name) => `'${name}'`).join(',')})`;

async function verifyDatabase(): Promise<void> {
  if (errors) return;
  const client = new pg.Client({ host, port, database, user });
  await client.connect();
  try {
    const ledger = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    const expectedLedger = expectedMigrations.map(([filename, sha256]) => ({ filename, sha256 }));
    if (JSON.stringify(ledger.rows.filter((row:any)=>row.filename!=='0025_operations_mission_plan_draft_controls.sql'&&row.filename!=='0026_editorial_segment_foundation.sql'&&row.filename!=='0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql'&&row.filename!=='0028_client_account_and_operator_contact_intake_foundation.sql')) !== JSON.stringify(expectedLedger)) fail('Database migration ledger does not match the exact twenty-two-file inventory');

    const tables = await client.query(
      `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'medialab_core' AND tablename IN ${tableListSql} ORDER BY tablename`
    );
    exact('Database packet table inventory', tables.rows.map((row) => row.tablename), packetTables);
    if (tables.rows.some((row) => row.tableowner !== TEST_OWNER_ROLE)) fail('One or more packet tables have the wrong owner');

    const schema = await client.query(`SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'medialab_core'`);
    if (schema.rows[0]?.owner !== TEST_OWNER_ROLE) fail(`medialab_core owner mismatch: ${schema.rows[0]?.owner}`);

    const queries = {
      columns: `SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, coalesce(column_default, '') AS column_default FROM information_schema.columns WHERE table_schema = 'medialab_core' AND table_name IN ${tableListSql} ORDER BY table_name, ordinal_position`,
      constraints: `SELECT c.relname AS table_name, x.conname, x.contype, pg_get_constraintdef(x.oid, true) AS definition FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'medialab_core' AND c.relname IN ${tableListSql} AND x.contype <> 'n' ORDER BY c.relname, x.conname`,
      indexes: `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'medialab_core' AND tablename IN ${tableListSql} ORDER BY tablename, indexname`,
      triggers: `SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid, true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'medialab_core' AND c.relname IN ${tableListSql} AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`
    };
    for (const [label, query] of Object.entries(queries)) {
      const result = await client.query(query);
      const [expectedCount, expectedDigest] = metadataDigests[label as keyof typeof metadataDigests];
      const actualDigest = digestRows(result.rows);
      if (String(result.rows.length) !== expectedCount || actualDigest !== expectedDigest) {
        fail(`${label} inventory mismatch: count=${result.rows.length} digest=${actualDigest}`);
      }
    }

    const functions = await client.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result,
              p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname IN ${functionListSql}
        ORDER BY p.proname, arguments`
    );
    exact(
      'Function signature and result inventory',
      functions.rows.map((row) => `${row.proname}|${row.arguments}|${row.result}`),
      expectedFunctionSignatures.map(([name, args, result]) => `${name}|${args}|${result}`)
    );
    if (functions.rows.length !== 13) fail(`Expected exactly 13 packet functions, got ${functions.rows.length}`);
    if (functions.rows.some((row) => row.prosecdef !== true)) fail('One or more packet functions are not SECURITY DEFINER');
    if (functions.rows.some((row) => JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp']))) {
      fail('One or more packet functions do not use the exact fixed search_path');
    }
    if (functions.rows.some((row) => row.owner !== TEST_OWNER_ROLE)) fail('One or more packet functions have the wrong owner');

    const tableGrants = await client.query(
      `SELECT table_name, grantee, privilege_type, is_grantable
         FROM information_schema.table_privileges
        WHERE table_schema = 'medialab_core' AND table_name IN ${tableListSql}
        ORDER BY table_name, grantee, privilege_type`
    );
    exact('Table-grant table inventory', [...new Set(tableGrants.rows.map((row) => row.table_name))], packetTables);
    if (tableGrants.rows.length !== 77) fail(`Expected exactly 77 packet table grants, got ${tableGrants.rows.length}`);
    if (tableGrants.rows.some((row) => row.grantee !== TEST_OWNER_ROLE)) fail('Packet table grant has an unexpected grantee class');
    for (const table of packetTables) {
      const grants = tableGrants.rows.filter((row) => row.table_name === table);
      exact(`${table} owner privilege inventory`, grants.map((row) => row.privilege_type), ownerTablePrivileges);
      if (grants.some((row) => row.is_grantable !== 'YES')) fail(`${table} owner privilege is not grantable`);
    }

    const routineGrants = await client.query(
      `SELECT routine_name, grantee, privilege_type, is_grantable
         FROM information_schema.routine_privileges
        WHERE specific_schema = 'medialab_core' AND routine_name IN ${functionListSql}
        ORDER BY routine_name, grantee, privilege_type`
    );
    const expectedRoutineGrantRows = [
      ...packetFunctions.map((name) => `${name}|OWNER|EXECUTE|YES`),
      ...runtimeFunctions.map((name) => `${name}|RUNTIME|EXECUTE|NO`)
    ];
    exact(
      'Routine grant inventory',
      routineGrants.rows.map((row) => `${row.routine_name}|${row.grantee === TEST_OWNER_ROLE ? 'OWNER' : row.grantee === TEST_RUNTIME_ROLE ? 'RUNTIME' : `UNEXPECTED:${row.grantee}`}|${row.privilege_type}|${row.is_grantable}`),
      expectedRoutineGrantRows
    );
    if (routineGrants.rows.length !== 23) fail(`Expected exactly 23 packet routine grants, got ${routineGrants.rows.length}`);

    const executable = await client.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname IN ${functionListSql}
          AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY p.proname`,
      [TEST_RUNTIME_ROLE]
    );
    exact('Runtime packet EXECUTE inventory', executable.rows.map((row) => row.proname), runtimeFunctions);

    const directRuntime = await client.query(
      `SELECT count(*)::int AS count FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core' AND table_name IN ${tableListSql}`,
      [TEST_RUNTIME_ROLE]
    );
    if (directRuntime.rows[0].count !== 0) fail('Runtime role has a direct packet-table privilege');
    const publicExecution = await client.query(
      `SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname IN ${functionListSql}
          AND has_function_privilege('public', p.oid, 'EXECUTE')`
    );
    if (publicExecution.rows[0].count !== 0) fail('PUBLIC can execute a packet function');

    for (const [table, expectedCount] of Object.entries(CATALOG_EXPECTED_ROW_COUNTS)) {
      const result = await client.query(`SELECT count(*)::int AS count FROM medialab_core.${table}`);
      const canonicalCount = CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS[table as keyof typeof CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS] ?? 0;
      const orderCount = ORDER_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof ORDER_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0;
      const additivePermissionCount = table === 'permissions' || table === 'permission_set_permissions' ? 33 : 0;
      if (result.rows[0].count !== expectedCount + canonicalCount + orderCount + additivePermissionCount) fail(`${table} fixture count mismatch: ${result.rows[0].count}`);
    }

    const selectable = await client.query(
      `SELECT product_code, count(*)::int AS rows
         FROM medialab_core.get_current_selectable_catalog('2026-03-28T12:00:00.000Z')
        GROUP BY product_code ORDER BY product_code`
    );
    if (selectable.rows.length !== 0) fail(`Synthetic catalog products became selectable: ${JSON.stringify(selectable.rows)}`);

    const customSeparation = await client.query(
      `SELECT count(*)::int AS count FROM medialab_core.catalog_products
        WHERE id IN (SELECT id FROM medialab_core.custom_commercial_snapshots)`
    );
    if (customSeparation.rows[0].count !== 0) fail('Custom evidence identity appears in canonical catalog products');
    const mapping = await client.query(
      `SELECT provider, external_identifier, target_product_id::text
         FROM medialab_core.catalog_external_mappings ORDER BY id`
    );
    if (mapping.rows.length !== 1 || mapping.rows[0].provider !== 'ARYEO' || mapping.rows[0].external_identifier === mapping.rows[0].target_product_id) {
      fail('External mapping does not preserve the provider-to-canonical identity boundary');
    }
  } finally {
    await client.end();
  }
}

await verifyDatabase();

if (errors) {
  console.error('Current catalog and price reconstruction schema verification FAILED.');
  process.exit(1);
}

console.log('Current catalog and price reconstruction schema verification PASSED.');
