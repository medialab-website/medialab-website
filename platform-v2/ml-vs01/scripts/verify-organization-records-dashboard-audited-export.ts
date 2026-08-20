import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY } from '../db/fixtures/organization-records-dashboard-audited-export-fixtures.js';

const migration = '0022_organization_records_dashboard_audited_export_foundation.sql';
const expectedMigrationSha256 = '9b5bf835a860c65fff33c658bd766176246d082fa8ff34291181f8a2ae51193f';
const predecessorSha256: Record<string, string> = {
  '0001_identity_and_tenancy.sql': '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31',
  '0002_property_identity_and_snapshots.sql': 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83',
  '0003_person_contacts_and_account_lifecycle.sql': '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3',
  '0004_current_catalog_and_price_snapshots.sql': 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876',
  '0005_catalog_administration_lifecycle.sql': '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40',
  '0006_orders_and_immutable_commercial_evidence.sql': '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f',
  '0007_property_hub_foundation.sql': '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16',
  '0008_scheduling_request_and_appointment_foundation.sql': 'cd1b394f95fea42b4cb770e59a1de38e74c7c44bbb3de43de91189fdd9504c9e',
  '0009_job_and_service_workstream_foundation.sql': '188cd691645a4ac039c83cf5939885d8b63997ab81ccb37be4667a5011738a66',
  '0010_mission_plan_foundation.sql': '2342a7935a27534a4e45233162d35b8b4200839ac0b3fb8394d19015521629c3',
  '0011_media_asset_identity_and_lineage_foundation.sql': '1b9fbde392d801ffc8fb0a00a461447cac855bae0046f1d433ac0360b8c15c80',
  '0012_durable_media_operations_reconciliation_foundation.sql': '37ae08918b3fdd38ee9fbe2eb24dad3e252c2a58fca0db4171c493a081bb7a8f',
  '0013_capture_session_ingest_custody_foundation.sql': 'fb90823b98c56242dcbe4d148f63440d061ae0d7efcc652652c9feafa9be29fa',
  '0014_media_cull_workspace_selected_media_evidence_foundation.sql': 'f406c7c329f863f0b34c8a1b99259386dc89c7f26934073de08d01057df8569f',
  '0015_editor_handoff_returned_media_intake_foundation.sql': '42a4b5381cbb1b434b2f1871e91fd5cc460d756d16df632c35dfc68b752c31c5',
  '0016_returned_editor_review_final_source_decision_foundation.sql': '192bf59bd11acd39355ae4682c9ac25d5430468f23465bc90e1f58366a613b57',
  '0017_publication_delivery_entitlement_foundation.sql': '1df90da711216cef0b591c7d1b1b9d1e2fb73b6d18f59fa5f566827d52c9fe5b',
  '0018_temporary_download_center_external_sharing_foundation.sql': 'cc8c200768326e69668e6566f4fd9a6432afef4bb62819d2ec7db26df674acd0',
  '0019_temporary_download_center_access_credential_gateway_foundation.sql': 'a74ce35c15325f4ea8e8c36c8c616fd9e8332b4dd8cb667267bd342b2fdae4f1',
  '0020_disposable_delivery_surface_local_fixture_foundation.sql': '6b378a9684d5910ac7f7dba6fdc84ceab27702372c903343277d0c054223667f',
  '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql': 'a7fe47745e190bb999d2d34739a1d89ed8cebf38dd79fdf202232112bb50d1ca'
};

const expectedTables = [
  'organization_record_access_events',
  'organization_record_export_items',
  'organization_record_export_snapshots',
  'organization_record_personal_summary_revocations',
  'organization_record_personal_summary_shares'
];
const expectedFunctions = [
  'classify_organization_record_order',
  'create_organization_record_export_snapshot',
  'get_internal_organization_records_projection',
  'get_organization_record_export_snapshot',
  'organization_record_projection_rows',
  'reject_organization_record_evidence_mutation',
  'revoke_personal_order_summary',
  'share_personal_order_summary',
  'validate_organization_record_text'
];
const expectedRuntimeFunctions = ['revoke_personal_order_summary', 'share_personal_order_summary'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`P02_M15_E_VERIFY_FAILURE: ${message}`);
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, '../db/migrations');
  const packetBytes = fs.readFileSync(path.join(migrationsDir, migration));
  assert(crypto.createHash('sha256').update(packetBytes).digest('hex') === expectedMigrationSha256, 'migration 0022 byte identity mismatch');
  for (const [filename, expected] of Object.entries(predecessorSha256)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDir, filename))).digest('hex');
    assert(actual === expected, `immutable predecessor ${filename} changed`);
  }

  const host = process.env.PGHOST || '/tmp/mlvs01-p02m16a-pg';
  const port = process.env.PGPORT ? Number(process.env.PGPORT) : 55447;
  const database = process.env.PGDATABASE || 'medialab_p02m16a_test';
  const user = process.env.PGUSER || 'medialab_p02m16a_test_owner';
  const runtime = process.env.PGRUNTIMEUSER || 'medialab_p02m16a_test_app';
  assert(host === '/tmp/mlvs01-p02m16a-pg' && port === 55447 && database === 'medialab_p02m16a_test', 'unsafe database target');
  assert(user === 'medialab_p02m16a_test_owner' && runtime === 'medialab_p02m16a_test_app', 'unsafe role target');

  const client = new pg.Client({ host, port, database, user });
  await client.connect();
  try {
    const ledger = await client.query('SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    assert(ledger.rows.length === 25, `expected 23 migration ledger rows, found ${ledger.rows.length}`);
    assert(ledger.rows[21].filename === migration && ledger.rows[21].sha256 === expectedMigrationSha256, 'migration 0022 ledger identity mismatch');
    assert(ledger.rows[22].filename === '0023_runtime_intake_reconciliation_commands.sql', 'migration 0023 ledger identity mismatch');
    for (const row of ledger.rows.slice(0, 21)) assert(predecessorSha256[row.filename] === row.sha256, `predecessor ledger mismatch for ${row.filename}`);

    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='medialab_core' AND table_name LIKE 'organization_record_%' ORDER BY table_name`);
    assert(JSON.stringify(tables.rows.map(row => row.table_name)) === JSON.stringify(expectedTables), 'packet table inventory mismatch');
    const functions = await client.query(`SELECT p.proname,p.prosecdef,p.proconfig,
        has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public,
        pg_get_functiondef(p.oid) definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname=ANY($2::text[]) ORDER BY p.proname`, [runtime, expectedFunctions]);
    assert(JSON.stringify(functions.rows.map(row => row.proname)) === JSON.stringify(expectedFunctions), 'packet function inventory mismatch');
    assert(JSON.stringify(functions.rows.filter(row => row.runtime).map(row => row.proname)) === JSON.stringify(expectedRuntimeFunctions), 'restricted runtime function inventory mismatch');
    assert(functions.rows.every(row => row.public === false), 'PUBLIC has packet function execution');
    assert(functions.rows.filter(row => row.prosecdef).every(row => row.proconfig?.[0] === 'search_path=pg_catalog, medialab_core, pg_temp'), 'SECURITY DEFINER search_path is not locked');

    const triggers = await client.query(`SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND NOT t.tgisinternal AND tgname LIKE 'organization_record_%immutability_guard' ORDER BY tgname`);
    assert(triggers.rows.length === 5, 'exact append-only trigger inventory mismatch');
    const dml = await client.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE')`, [runtime]);
    assert(dml.rows[0].n === 0, 'restricted runtime has direct table DML');
    const sequences = await client.query(`SELECT count(*)::int n FROM information_schema.role_usage_grants WHERE grantee=$1 AND object_schema='medialab_core' AND object_type='SEQUENCE'`, [runtime]);
    assert(sequences.rows[0].n === 0, 'restricted runtime has sequence authority');
    const publicFunctions = await client.query(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND has_function_privilege('public',p.oid,'EXECUTE')`);
    assert(publicFunctions.rows[0].n === 0, 'PUBLIC function execution is not zero');
    const rows = await client.query(`SELECT
      (SELECT count(*)::int FROM medialab_core.organization_record_personal_summary_shares) shares,
      (SELECT count(*)::int FROM medialab_core.organization_record_personal_summary_revocations) revocations,
      (SELECT count(*)::int FROM medialab_core.organization_record_export_snapshots) exports,
      (SELECT count(*)::int FROM medialab_core.organization_record_export_items) export_items,
      (SELECT count(*)::int FROM medialab_core.organization_record_access_events) access_events`);
    assert(Object.values(rows.rows[0]).every(value => value === 0), 'reset/seed created packet evidence');
    assert(ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY.customerDashboardRuntimeActivated === false, 'customer dashboard runtime was activated');
    assert(ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY.trustedBillingImplemented === false, 'trusted billing was invented');
    assert(ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY.paymentLedgerImplemented === false, 'payment ledger was invented');
    assert(ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY.mediaAuthorityImplemented === false, 'media authority was invented');
  } finally {
    await client.end();
  }
  console.log('P02-M16-A organization records and audited export verification PASSED.');
}

main().catch(error => { console.error(error); process.exit(1); });
