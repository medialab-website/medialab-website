import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { P02_M15_A_ALLOWLIST } from './p02-m15-a-changed-files.js';
import {
  CURRENT_CATALOG_EFFECTIVE_AT,
  CURRENT_CATALOG_SEED_EFFECTIVE_DATE,
  CURRENT_CATALOG_SEED_VERSION,
  CURRENT_CATALOG_SOURCE_URL,
  CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS,
  CURRENT_REAL_ESTATE_PRODUCT_FIXTURES
} from '../db/fixtures/current-real-estate-catalog-seed.js';

console.log('Running verify-catalog-administration-lifecycle-schema.ts...');

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(baseDir, '../..');
let errors = false;

const TEST_SOCKET = '/tmp/mlvs01-p02m15a-pg';
const TEST_PORT = 55443;
const TEST_DB = 'medialab_p02m15a_test';
const TEST_OWNER_ROLE = 'medialab_p02m15a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m15a_test_app';

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
  ['0018_temporary_download_center_external_sharing_foundation.sql', crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'db/migrations/0018_temporary_download_center_external_sharing_foundation.sql'))).digest('hex')]
] as const;

const packetFunctions = [
  'apply_catalog_product_administration_defaults',
  'create_catalog_draft_product',
  'delete_catalog_draft_product',
  'get_catalog_administration_products',
  'guard_catalog_draft_product_delete',
  'publish_catalog_draft_product',
  'revise_catalog_draft_product',
  'revise_published_catalog_product_definition',
  'set_catalog_product_archived'
];

const runtimeFunctions = packetFunctions.filter((name) => ![
  'apply_catalog_product_administration_defaults',
  'guard_catalog_draft_product_delete'
].includes(name));

const packetTriggers = [
  ['catalog_administration_events_immutability_guard', 'catalog_administration_events', 'reject_catalog_evidence_mutation'],
  ['catalog_products_administration_defaults', 'catalog_products', 'apply_catalog_product_administration_defaults'],
  ['catalog_products_delete_guard', 'catalog_products', 'guard_catalog_draft_product_delete']
];

const administrationColumns = [
  'id',
  'product_id',
  'product_code',
  'display_name',
  'previous_definition',
  'new_definition',
  'event_type',
  'previous_authoring_state',
  'new_authoring_state',
  'previous_lifecycle_state',
  'new_lifecycle_state',
  'previous_archived',
  'new_archived',
  'duplicated_from_product_id',
  'reason',
  'source_system',
  'actor_identity_id',
  'occurred_at'
];

const addedProductColumns = [
  'archived_at',
  'archived_by_identity_id',
  'authoring_state',
  'duplicated_from_product_id',
  'published_at',
  'published_by_identity_id',
  'seed_effective_date',
  'seed_version',
  'source_display_label',
  'source_type',
  'source_url'
];

const packetConstraintNames = [
  'catalog_administration_events_actor_identity_id_fkey',
  'catalog_administration_events_display_name_check',
  'catalog_administration_events_new_authoring_check',
  'catalog_administration_events_new_definition_check',
  'catalog_administration_events_new_lifecycle_check',
  'catalog_administration_events_pkey',
  'catalog_administration_events_previous_authoring_check',
  'catalog_administration_events_previous_definition_check',
  'catalog_administration_events_previous_lifecycle_check',
  'catalog_administration_events_product_code_check',
  'catalog_administration_events_reason_check',
  'catalog_administration_events_source_check',
  'catalog_administration_events_type_check',
  'catalog_products_archive_evidence_check',
  'catalog_products_archived_by_identity_id_fkey',
  'catalog_products_authoring_state_check',
  'catalog_products_draft_nonselectable_check',
  'catalog_products_duplicate_source_check',
  'catalog_products_duplicated_from_product_id_fkey',
  'catalog_products_public_source_metadata_check',
  'catalog_products_publication_evidence_check',
  'catalog_products_published_by_identity_id_fkey',
  'catalog_products_seed_version_check',
  'catalog_products_source_display_label_check',
  'catalog_products_source_type_check',
  'catalog_products_source_url_check'
];

const packetIndexes = [
  'catalog_administration_events_actor_idx',
  'catalog_administration_events_pkey',
  'catalog_administration_events_product_idx',
  'catalog_products_administration_idx',
  'catalog_products_duplicate_source_idx'
];

const allowedPaths = [...P02_M15_A_ALLOWLIST].sort();

const exactPrices: Record<string, number> = {
  ADDITIONAL_AERIAL_EXTERIOR_PHOTO: 1500,
  AERIAL_ONLY_VIDEO: 17500,
  AGENT_INTRO_ADD_ON: 5000,
  AI_PHOTO_VIDEO_15: 4000,
  AI_PHOTO_VIDEO_25: 6000,
  CAD_FILES: 3000,
  FLOOR_PLAN_3D_VIDEO: 6500,
  GLA_REPORT: 1500,
  MATTERPORT_2000_4000: 14000,
  MATTERPORT_4000_6000: 22000,
  MATTERPORT_6000_7000: 26500,
  MATTERPORT_UNDER_2500: 12000,
  PROPERTY_BOUNDARY_LINES: 1000,
  VIRTUAL_STAGING: 2500,
  VIRTUAL_TWILIGHT_PHOTO: 1500
};

function fail(message: string): void {
  console.error(`ERROR: ${message}`);
  errors = true;
}

function exact(label: string, actual: string[], expected: string[]): void {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) fail(`${label} mismatch. Expected ${e.join(', ')}, got ${a.join(', ')}`);
}

for (const [filename, expectedHash] of expectedMigrations) {
  const actualHash = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(baseDir, 'db/migrations', filename)))
    .digest('hex');
  if (actualHash !== expectedHash) fail(`${filename} SHA-256 mismatch. Expected ${expectedHash}, got ${actualHash}`);
}

const packageHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'package.json'))).digest('hex');
const lockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(baseDir, 'package-lock.json'))).digest('hex');
if (packageHash !== '1b523743a00ad3fc163a0777f866da716ac4e6c2c091ddbb099afc2ebf43f5d0') fail(`package.json SHA-256 mismatch: ${packageHash}`);
if (lockHash !== '11cc280ef7ff1c66638bc1cc3e85c750844f6041bcf338a5b59c55b0f79d9258') fail(`package-lock.json SHA-256 mismatch: ${lockHash}`);

const migrationText = fs.readFileSync(path.join(baseDir, 'db/migrations/0005_catalog_administration_lifecycle.sql'), 'utf8');
for (const required of [
  "authoring_state IN ('DRAFT', 'PUBLISHED')",
  "authoring_state <> 'DRAFT' OR lifecycle_state = 'NONSELECTABLE'",
  'CREATE TABLE medialab_core.catalog_administration_events',
  'Only a never-published, nonselectable draft catalog product may be deleted',
  'Catalog draft has protected commercial, package, mapping, snapshot, lifecycle, or provenance references',
  "PERFORM medialab_core.require_catalog_permission(v_actor_identity_id, 'catalog.manage')",
  'FROM medialab_core.resolve_ordinary_session(p_session_token)',
  'SET search_path = pg_catalog, medialab_core, pg_temp;',
  'REVOKE ALL ON FUNCTION medialab_core.delete_catalog_draft_product(text, uuid, text, text) FROM PUBLIC;'
]) {
  if (!migrationText.includes(required)) fail(`Migration evidence missing: ${required}`);
}
for (const prohibited of ['CREATE TABLE medialab_core.order_lines', 'ON DELETE CASCADE', 'current_setting(', 'session_user']) {
  if (migrationText.includes(prohibited)) fail(`Prohibited migration construct found: ${prohibited}`);
}

const sourceText = fs.readFileSync(path.join(baseDir, 'db/fixtures/current-real-estate-catalog-seed.ts'), 'utf8');
for (const required of [CURRENT_CATALOG_SOURCE_URL, 'PUBLIC_WEBSITE', 'P02_M03_B_2026_08_03', 'Matterport (2k - 4k Sq Ft)']) {
  if (!sourceText.includes(required)) fail(`Canonical source evidence missing: ${required}`);
}
for (const forbidden of ['ENHANCED_FLOOR_PLAN_UPGRADE', 'FLOOR_PLAN_3D_UPGRADE', 'synthetic-aryeo-product']) {
  if (sourceText.includes(forbidden)) fail(`Unapproved canonical seed value found: ${forbidden}`);
}

for (const testFile of ['tests/catalog-administration-lifecycle.test.ts', 'tests/current-real-estate-catalog.test.ts']) {
  const testText = fs.readFileSync(path.join(baseDir, testFile), 'utf8');
  if (testText.includes('.skip(') || testText.includes('.todo(') || testText.includes('retry:')) fail(`${testFile} contains skip, todo, or retry`);
}

const porcelain = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: repositoryRoot,
  encoding: 'utf8'
}).trimEnd();
const actualPaths = porcelain ? porcelain.split('\n').map((line) => line.slice(3)) : [];
for (const line of porcelain ? porcelain.split('\n') : []) {
  if (/[DRC]/.test(line.slice(0, 2))) fail(`Disallowed status ${line.slice(0, 2)} for ${line.slice(3)}`);
}
exact('Independent changed-file inventory', actualPaths, allowedPaths);
if (execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()) {
  fail('Candidate contains staged paths');
}

const host = process.env.PGHOST ?? TEST_SOCKET;
const port = Number(process.env.PGPORT ?? TEST_PORT);
const database = process.env.PGDATABASE ?? TEST_DB;
const user = process.env.PGUSER ?? TEST_OWNER_ROLE;
if (host !== TEST_SOCKET || port !== TEST_PORT || database !== TEST_DB || user !== TEST_OWNER_ROLE) {
  fail(`Verifier database boundary mismatch: host=${host} port=${port} database=${database} user=${user}`);
}

async function verifyDatabase(): Promise<void> {
  if (errors) return;
  const client = new pg.Client({ host, port, database, user });
  await client.connect();
  try {
    const ledger = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    const expectedLedger = expectedMigrations.map(([filename, sha256]) => ({ filename, sha256 }));
    if (JSON.stringify(ledger.rows) !== JSON.stringify(expectedLedger)) fail(`Seventeen-row migration ledger mismatch: ${JSON.stringify(ledger.rows)}`);

    const owner = await client.query(`SELECT tableowner FROM pg_tables WHERE schemaname = 'medialab_core' AND tablename = 'catalog_administration_events'`);
    if (owner.rows[0]?.tableowner !== TEST_OWNER_ROLE) fail(`Catalog administration event owner mismatch: ${owner.rows[0]?.tableowner}`);

    const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'medialab_core' AND table_name = 'catalog_administration_events' ORDER BY ordinal_position`);
    if (JSON.stringify(columns.rows.map((row) => row.column_name)) !== JSON.stringify(administrationColumns)) fail('Catalog administration event column inventory mismatch');
    const productColumns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'medialab_core' AND table_name = 'catalog_products' AND column_name = ANY($1::text[])`, [addedProductColumns]);
    exact('Added catalog product column inventory', productColumns.rows.map((row) => row.column_name), addedProductColumns);

    const constraints = await client.query(
      `SELECT x.conname FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'medialab_core' AND x.conname = ANY($1::text[])`,
      [packetConstraintNames]
    );
    exact('P02-M03-B constraint inventory', constraints.rows.map((row) => row.conname), packetConstraintNames);

    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'medialab_core' AND indexname = ANY($1::text[])`, [packetIndexes]);
    exact('P02-M03-B index inventory', indexes.rows.map((row) => row.indexname), packetIndexes);

    const functions = await client.query(
      `SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname = ANY($1::text[]) ORDER BY p.proname`,
      [packetFunctions]
    );
    exact('P02-M03-B function inventory', functions.rows.map((row) => row.proname), packetFunctions);
    for (const fn of functions.rows) {
      if (!fn.prosecdef || fn.owner !== TEST_OWNER_ROLE || JSON.stringify(fn.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp'])) {
        fail(`Unsafe function configuration: ${fn.proname}`);
      }
    }

    const triggers = await client.query(
      `SELECT t.tgname, c.relname AS table_name, p.proname AS function_name
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND n.nspname = 'medialab_core' AND t.tgname = ANY($1::text[]) ORDER BY t.tgname`,
      [packetTriggers.map(([name]) => name)]
    );
    const expectedTriggers = packetTriggers.map(([tgname, table_name, function_name]) => ({ tgname, table_name, function_name }));
    if (JSON.stringify(triggers.rows) !== JSON.stringify(expectedTriggers)) fail(`P02-M03-B trigger inventory mismatch: ${JSON.stringify(triggers.rows)}`);

    const executable = await client.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname = ANY($1::text[]) AND has_function_privilege($2, p.oid, 'EXECUTE') ORDER BY p.proname`,
      [packetFunctions, TEST_RUNTIME_ROLE]
    );
    exact('Runtime P02-M03-B EXECUTE inventory', executable.rows.map((row) => row.proname), runtimeFunctions);
    const publicExecution = await client.query(
      `SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname = ANY($1::text[]) AND has_function_privilege('public', p.oid, 'EXECUTE')`,
      [packetFunctions]
    );
    if (publicExecution.rows[0].count !== 0) fail('PUBLIC can execute a P02-M03-B function');
    const directRuntime = await client.query(
      `SELECT count(*)::int AS count FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')`,
      [TEST_RUNTIME_ROLE]
    );
    if (directRuntime.rows[0].count !== 0) fail('Runtime role has direct medialab_core table DML');

    const canonical = await client.query(
      `SELECT product_code, lifecycle_state, authoring_state, archived_at IS NOT NULL AS archived,
              source_type, source_url, source_display_label, seed_version, seed_effective_date::text
         FROM medialab_core.catalog_products WHERE source_type = 'PUBLIC_WEBSITE' ORDER BY product_code`
    );
    exact('Canonical current product codes', canonical.rows.map((row) => row.product_code), CURRENT_REAL_ESTATE_PRODUCT_FIXTURES.map((row) => row.product_code));
    if (canonical.rows.length !== CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS.catalog_products || canonical.rows.some((row) =>
      row.authoring_state !== 'PUBLISHED' || row.archived || row.source_url !== CURRENT_CATALOG_SOURCE_URL ||
      row.seed_version !== CURRENT_CATALOG_SEED_VERSION || row.seed_effective_date !== CURRENT_CATALOG_SEED_EFFECTIVE_DATE
    )) fail('Canonical product source, authoring, visibility, or seed metadata mismatch');

    const prices = await client.query(
      `SELECT p.product_code, pr.amount_cents::int AS amount_cents FROM medialab_core.catalog_prices pr
         JOIN medialab_core.catalog_products p ON p.id = pr.product_id WHERE p.source_type = 'PUBLIC_WEBSITE' ORDER BY p.product_code`
    );
    const actualPrices = Object.fromEntries(prices.rows.map((row) => [row.product_code, row.amount_cents]));
    if (JSON.stringify(actualPrices) !== JSON.stringify(exactPrices)) fail(`Canonical flat-price inventory mismatch: ${JSON.stringify(actualPrices)}`);

    const selectable = await client.query(`SELECT product_code FROM medialab_core.get_current_selectable_catalog($1) ORDER BY product_code`, [CURRENT_CATALOG_EFFECTIVE_AT]);
    if (selectable.rows.length !== 26 || selectable.rows.some((row) => row.product_code.startsWith('SYNTH_'))) fail('Current selectable projection must contain exactly 26 canonical rows and no synthetic row');
    const matterportBrackets = await client.query(
      `SELECT count(*)::int AS count FROM medialab_core.catalog_bracket_sets s JOIN medialab_core.catalog_products p ON p.id = s.package_product_id WHERE p.product_code LIKE 'MATTERPORT_%'`
    );
    if (matterportBrackets.rows[0].count !== 0) fail('Matterport products were placed in an automatic bracket evaluator');
    const invented = await client.query(`SELECT product_code FROM medialab_core.catalog_products WHERE product_code IN ('ENHANCED_FLOOR_PLAN_UPGRADE', 'FLOOR_PLAN_3D_UPGRADE')`);
    if (invented.rows.length !== 0) fail('An unpriced floor-plan upgrade base product was invented');
    const canonicalMappings = await client.query(
      `SELECT count(*)::int AS count FROM medialab_core.catalog_external_mappings m JOIN medialab_core.catalog_products p ON p.id = m.target_product_id WHERE p.source_type = 'PUBLIC_WEBSITE'`
    );
    if (canonicalMappings.rows[0].count !== 0) fail('Canonical current catalog contains an unapproved external provider mapping');
  } finally {
    await client.end();
  }
}

await verifyDatabase();

if (errors) {
  console.error('Catalog administration lifecycle schema verification FAILED.');
  process.exit(1);
}

console.log('Catalog administration lifecycle schema verification PASSED.');
