import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = '0019_temporary_download_center_access_credential_gateway_foundation.sql';
const predecessorHashes = [
  ['0001_identity_and_tenancy.sql','29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31'],
  ['0002_property_identity_and_snapshots.sql','d3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83'],
  ['0003_person_contacts_and_account_lifecycle.sql','984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3'],
  ['0004_current_catalog_and_price_snapshots.sql','e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'],
  ['0005_catalog_administration_lifecycle.sql','928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40'],
  ['0006_orders_and_immutable_commercial_evidence.sql','5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f'],
  ['0007_property_hub_foundation.sql','8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16'],
  ['0008_scheduling_request_and_appointment_foundation.sql','cd1b394f95fea42b4cb770e59a1de38e74c7c44bbb3de43de91189fdd9504c9e'],
  ['0009_job_and_service_workstream_foundation.sql','188cd691645a4ac039c83cf5939885d8b63997ab81ccb37be4667a5011738a66'],
  ['0010_mission_plan_foundation.sql','2342a7935a27534a4e45233162d35b8b4200839ac0b3fb8394d19015521629c3'],
  ['0011_media_asset_identity_and_lineage_foundation.sql','1b9fbde392d801ffc8fb0a00a461447cac855bae0046f1d433ac0360b8c15c80'],
  ['0012_durable_media_operations_reconciliation_foundation.sql','37ae08918b3fdd38ee9fbe2eb24dad3e252c2a58fca0db4171c493a081bb7a8f'],
  ['0013_capture_session_ingest_custody_foundation.sql','fb90823b98c56242dcbe4d148f63440d061ae0d7efcc652652c9feafa9be29fa'],
  ['0014_media_cull_workspace_selected_media_evidence_foundation.sql','f406c7c329f863f0b34c8a1b99259386dc89c7f26934073de08d01057df8569f'],
  ['0015_editor_handoff_returned_media_intake_foundation.sql','42a4b5381cbb1b434b2f1871e91fd5cc460d756d16df632c35dfc68b752c31c5'],
  ['0016_returned_editor_review_final_source_decision_foundation.sql','192bf59bd11acd39355ae4682c9ac25d5430468f23465bc90e1f58366a613b57'],
  ['0017_publication_delivery_entitlement_foundation.sql','1df90da711216cef0b591c7d1b1b9d1e2fb73b6d18f59fa5f566827d52c9fe5b'],
  ['0018_temporary_download_center_external_sharing_foundation.sql','cc8c200768326e69668e6566f4fd9a6432afef4bb62819d2ec7db26df674acd0']
] as const;
const tables = [
  'temporary_download_center_access_credentials',
  'temporary_download_center_access_credential_events',
  'temporary_download_center_access_credential_current',
  'temporary_download_center_gateway_evaluations'
].sort();
const runtimeFunctions = [
  'issue_temporary_download_center_access_credential',
  'rotate_temporary_download_center_access_credential',
  'revoke_temporary_download_center_access_credential',
  'evaluate_temporary_download_center_gateway_access',
  'get_temporary_download_center_access_credential_history',
  'get_temporary_download_center_gateway_history'
].sort();
const helpers = [
  'reject_tdc_access_credential_evidence_mutation',
  'guard_tdc_access_credential_current_mutation',
  'validate_temporary_download_center_gateway_text',
  'validate_temporary_download_center_gateway_json',
  'validate_tdc_access_credential_scope',
  'temporary_download_center_current_policy'
].sort();
const triggers = [
  'tdc_access_credentials_scope_guard',
  'tdc_access_credentials_immutability_guard',
  'tdc_access_credential_events_immutability_guard',
  'tdc_gateway_evaluations_immutability_guard',
  'tdc_access_credential_current_control_guard'
].sort();
const indexes = [
  'temporary_download_center_access_credentials_history_idx',
  'temporary_download_center_access_credential_events_history_idx',
  'temporary_download_center_gateway_evaluations_history_idx'
].sort();

function fail(message: string): never {
  throw new Error(`TDC_ACCESS_CREDENTIAL_GATEWAY_SCHEMA_VERIFICATION_FAILED: ${message}`);
}

for (const [name, expected] of predecessorHashes) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(base, 'db/migrations', name))).digest('hex');
  if (actual !== expected) fail(`${name} predecessor SHA mismatch: ${actual}`);
}

const bytes = fs.readFileSync(path.join(base, 'db/migrations', migration));
const packetHash = crypto.createHash('sha256').update(bytes).digest('hex');
const sql = bytes.toString('utf8');
if (/CREATE(?: OR REPLACE)? (?:TABLE|FUNCTION) medialab_core\.[a-z0-9_]*(public_url|signed_url|download_endpoint|recipient|web_route|provider_adapter)/i.test(sql)) {
  fail('public URL/route/download/provider object detected');
}

const client = new pg.Client({
  host: '/tmp/mlvs01-p02m16a-pg',
  port: 55447,
  database: 'medialab_p02m16a_test',
  user: 'medialab_p02m16a_test_owner'
});

await client.connect();
try {
  const ledger = await client.query('SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  if (ledger.rows.length !== 27 || ledger.rows[18].filename !== migration || ledger.rows[18].sha256 !== packetHash || ledger.rows[19].filename !== '0020_disposable_delivery_surface_local_fixture_foundation.sql' || ledger.rows[20].filename !== '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql' || ledger.rows[22].filename !== '0023_runtime_intake_reconciliation_commands.sql') fail('migration ledger identity mismatch');

  const tableInventory = await client.query(
    "SELECT tablename,tableowner FROM pg_tables WHERE schemaname='medialab_core' AND tablename=ANY($1::text[]) ORDER BY tablename",
    [tables]
  );
  if (JSON.stringify(tableInventory.rows.map(row => row.tablename)) !== JSON.stringify(tables) ||
      tableInventory.rows.some(row => row.tableowner !== 'medialab_p02m16a_test_owner')) fail('table inventory or owner mismatch');

  const functionInventory = await client.query(
    `SELECT p.proname,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
            pg_get_function_identity_arguments(p.oid) arguments,
            pg_get_functiondef(p.oid) definition,
            has_function_privilege($1,p.oid,'EXECUTE') runtime,
            has_function_privilege('public',p.oid,'EXECUTE') public
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname=ANY($2::text[]) ORDER BY p.proname`,
    ['medialab_p02m16a_test_app', [...runtimeFunctions, ...helpers]]
  );
  if (functionInventory.rows.length !== runtimeFunctions.length + helpers.length) fail('function inventory mismatch');
  if (functionInventory.rows.some(row => row.owner !== 'medialab_p02m16a_test_owner' || row.public || row.runtime !== runtimeFunctions.includes(row.proname))) {
    fail('function owner/runtime/PUBLIC grant mismatch');
  }
  if (functionInventory.rows.some(row => JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp'])) ||
      functionInventory.rows.filter(row => runtimeFunctions.includes(row.proname) || row.proname === 'temporary_download_center_current_policy').some(row => !row.prosecdef)) {
    fail('SECURITY DEFINER or locked search_path mismatch');
  }
  const gateway = functionInventory.rows.find(row => row.proname === 'evaluate_temporary_download_center_gateway_access');
  if (!gateway || /p_session|actor_identity/i.test(gateway.arguments)) fail('anonymous gateway signature accepts customer-session or actor authority');
  for (const name of runtimeFunctions.filter(name => name !== 'evaluate_temporary_download_center_gateway_access')) {
    const fn = functionInventory.rows.find(row => row.proname === name);
    if (!fn || !/^p_session text/.test(fn.arguments)) fail(`${name} does not derive authority from ordinary session input`);
  }

  const policyDefinition = await client.query(
    `SELECT pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname='evaluate_temporary_download_center_policy'`
  );
  if (policyDefinition.rows.length !== 1 || !policyDefinition.rows[0].definition.includes('temporary_download_center_current_policy')) {
    fail('authenticated M15-A policy does not reuse the shared current-policy helper');
  }
  if (!gateway.definition.includes('temporary_download_center_current_policy')) fail('gateway does not reuse the shared M15-A current-policy helper');

  const historyDefinitions = functionInventory.rows
    .filter(row => row.proname.startsWith('get_temporary_download_center_'))
    .map(row => row.definition)
    .join('\n');
  if (/verifier_sha256|request_sha256|access_secret/.test(historyDefinitions)) fail('history/read definition exposes secret or verifier material');
  const issue = functionInventory.rows.find(row => row.proname === 'issue_temporary_download_center_access_credential')?.definition ?? '';
  const rotate = functionInventory.rows.find(row => row.proname === 'rotate_temporary_download_center_access_credential')?.definition ?? '';
  const strongSecretExpression = 'sha256(uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid())||uuid_send(gen_random_uuid()))';
  if (!issue.replace(/\s/g, '').includes(strongSecretExpression) || !rotate.replace(/\s/g, '').includes(strongSecretExpression)) fail('32-byte server-side secret generation from 48 UUID-v4 input bytes missing');

  const dml = await client.query(
    `SELECT c.relname,
            (has_table_privilege($1,c.oid,'SELECT') OR has_table_privilege($1,c.oid,'INSERT') OR has_table_privilege($1,c.oid,'UPDATE') OR has_table_privilege($1,c.oid,'DELETE')) runtime,
            (has_table_privilege('public',c.oid,'SELECT') OR has_table_privilege('public',c.oid,'INSERT') OR has_table_privilege('public',c.oid,'UPDATE') OR has_table_privilege('public',c.oid,'DELETE')) public
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND c.relname=ANY($2::text[])`,
    ['medialab_p02m16a_test_app', [...tables, 'temporary_download_center_access_observations']]
  );
  if (dml.rows.some(row => row.runtime || row.public)) fail('runtime or PUBLIC direct table authority detected');

  const triggerInventory = await client.query(
    `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND NOT t.tgisinternal AND t.tgname=ANY($1::text[]) ORDER BY t.tgname`,
    [triggers]
  );
  if (JSON.stringify(triggerInventory.rows.map(row => row.tgname)) !== JSON.stringify(triggers)) fail('trigger inventory mismatch');

  const indexInventory = await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='medialab_core' AND indexname=ANY($1::text[]) ORDER BY indexname",
    [indexes]
  );
  if (JSON.stringify(indexInventory.rows.map(row => row.indexname)) !== JSON.stringify(indexes)) fail('index inventory mismatch');

  const unsafeColumns = await client.query(
    `SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='medialab_core' AND table_name=ANY($1::text[])
        AND column_name ~* '(^|_)(secret|password|plaintext|usable_token|bearer_token)($|_)'`,
    [tables]
  );
  if (unsafeColumns.rows.length !== 0) fail('durable usable-secret column detected');
  const verifierColumns = await client.query(
    `SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='medialab_core' AND table_name=ANY($1::text[]) AND column_name LIKE '%verifier%' ORDER BY table_name,column_name`,
    [tables]
  );
  if (JSON.stringify(verifierColumns.rows) !== JSON.stringify([{ table_name: 'temporary_download_center_access_credentials', column_name: 'verifier_algorithm' }, { table_name: 'temporary_download_center_access_credentials', column_name: 'verifier_sha256' }])) {
    fail('verifier material is not confined to the credential evidence row');
  }

  const seeded = await client.query(
    `SELECT (SELECT count(*) FROM medialab_core.temporary_download_center_access_credentials)::int credentials,
            (SELECT count(*) FROM medialab_core.temporary_download_center_gateway_evaluations)::int evaluations`
  );
  if (seeded.rows[0].credentials !== 0 || seeded.rows[0].evaluations !== 0) fail('operational credential/gateway fixtures detected');

  const publicAuthority = await client.query(
    `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname LIKE '%temporary_download_center%' AND has_function_privilege('public',p.oid,'EXECUTE')`
  );
  if (publicAuthority.rows[0].n !== 0) fail('inappropriate PUBLIC function authority detected');

  console.log(`TDC access credential/gateway schema verification PASSED. 0019 size: ${bytes.length}; SHA-256: ${packetHash}; predecessor hashes: ${predecessorHashes.length}`);
} finally {
  await client.end();
}
