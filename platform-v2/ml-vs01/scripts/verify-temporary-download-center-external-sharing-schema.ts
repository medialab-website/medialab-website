import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = '0018_temporary_download_center_external_sharing_foundation.sql';
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
  ['0017_publication_delivery_entitlement_foundation.sql','1df90da711216cef0b591c7d1b1b9d1e2fb73b6d18f59fa5f566827d52c9fe5b']
] as const;
const tables = ['temporary_download_centers','temporary_download_center_versions','temporary_download_center_selections','temporary_download_center_items','temporary_download_center_events','temporary_download_center_current','temporary_download_center_access_observations'].sort();
const runtimeFunctions = ['create_temporary_download_center','update_temporary_download_center_selection','replace_temporary_download_center','revoke_temporary_download_center','get_temporary_download_center','evaluate_temporary_download_center_policy','get_temporary_download_center_activity'].sort();
const helpers = ['reject_temporary_download_center_evidence_mutation','validate_temporary_download_center_text','validate_temporary_download_center_json','normalize_temporary_download_center_selections','temporary_download_center_hub_authority','materialize_temporary_download_center_version'].sort();
const triggers = ['temporary_download_centers_immutability_guard','temporary_download_center_versions_immutability_guard','temporary_download_center_selections_immutability_guard','temporary_download_center_items_immutability_guard','temporary_download_center_events_immutability_guard','temporary_download_center_observations_immutability_guard'].sort();
const permissions = ['temporary_download_center.create','temporary_download_center.manage','temporary_download_center.read','temporary_download_center.activity.read'].sort();
function fail(message: string): never { throw new Error(`TEMPORARY_DOWNLOAD_CENTER_SCHEMA_VERIFICATION_FAILED: ${message}`); }

for (const [name, expected] of predecessorHashes) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(base, 'db/migrations', name))).digest('hex');
  if (actual !== expected) fail(`${name} predecessor SHA mismatch: ${actual}`);
}
const bytes = fs.readFileSync(path.join(base, 'db/migrations', migration));
const packetHash = crypto.createHash('sha256').update(bytes).digest('hex');
const sql = bytes.toString('utf8');
const declaredObjectNames = [...sql.matchAll(/CREATE(?: OR REPLACE)? (?:TABLE|FUNCTION) medialab_core\.([a-z0-9_]+)/g)].map(match => match[1]);
if (declaredObjectNames.some(name => /(token|credential|access_code|signed_url|public_url|download_endpoint|recipient_login)/i.test(name))) fail('public credential or access mechanism object detected');

const client = new pg.Client({ host: '/tmp/mlvs01-p02m16a-pg', port: 55447, database: 'medialab_p02m16a_test', user: 'medialab_p02m16a_test_owner' });
await client.connect();
try {
  const ledger = await client.query('SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  if (ledger.rows.length !== 27 || ledger.rows[17].filename !== migration || ledger.rows[17].sha256 !== packetHash || ledger.rows[18].filename !== '0019_temporary_download_center_access_credential_gateway_foundation.sql' || ledger.rows[19].filename !== '0020_disposable_delivery_surface_local_fixture_foundation.sql' || ledger.rows[20].filename !== '0021_provider_neutral_file_backed_disposable_delivery_foundation.sql' || ledger.rows[22].filename !== '0023_runtime_intake_reconciliation_commands.sql') fail('migration ledger identity mismatch');
  const tableInventory = await client.query("SELECT tablename,tableowner FROM pg_tables WHERE schemaname='medialab_core' AND tablename=ANY($1::text[]) ORDER BY tablename", [tables]);
  if (JSON.stringify(tableInventory.rows.map(row => row.tablename)) !== JSON.stringify(tables) || tableInventory.rows.some(row => row.tableowner !== 'medialab_p02m16a_test_owner')) fail('table inventory or owner mismatch');
  const functions = await client.query(`SELECT p.proname,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,pg_get_function_identity_arguments(p.oid) arguments,has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND p.proname=ANY($2::text[]) ORDER BY p.proname`, ['medialab_p02m16a_test_app', [...runtimeFunctions, ...helpers]]);
  if (functions.rows.length !== runtimeFunctions.length + helpers.length || functions.rows.some(row => row.owner !== 'medialab_p02m16a_test_owner' || row.public || row.runtime !== runtimeFunctions.includes(row.proname))) fail('function owner/runtime/PUBLIC grant mismatch');
  if (functions.rows.filter(row => runtimeFunctions.includes(row.proname)).some(row => !row.prosecdef || JSON.stringify(row.proconfig) !== JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp']) || /actor_identity/i.test(row.arguments))) fail('runtime SECURITY DEFINER, search_path, or actor-derivation discipline mismatch');
  const dml = await client.query(`SELECT c.relname,(has_table_privilege($1,c.oid,'SELECT') OR has_table_privilege($1,c.oid,'INSERT') OR has_table_privilege($1,c.oid,'UPDATE') OR has_table_privilege($1,c.oid,'DELETE')) runtime,(has_table_privilege('public',c.oid,'SELECT') OR has_table_privilege('public',c.oid,'INSERT') OR has_table_privilege('public',c.oid,'UPDATE') OR has_table_privilege('public',c.oid,'DELETE')) public FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='medialab_core' AND c.relname=ANY($2::text[])`, ['medialab_p02m16a_test_app', tables]);
  if (dml.rows.some(row => row.runtime || row.public)) fail('runtime or PUBLIC table authority detected');
  const triggerInventory = await client.query(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='medialab_core' AND NOT t.tgisinternal AND t.tgname=ANY($1::text[]) ORDER BY t.tgname`, [triggers]);
  if (JSON.stringify(triggerInventory.rows.map(row => row.tgname)) !== JSON.stringify(triggers)) fail('append-only trigger inventory mismatch');
  const permissionInventory = await client.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'temporary_download_center.%' ORDER BY code");
  if (JSON.stringify(permissionInventory.rows.map(row => row.code)) !== JSON.stringify(permissions)) fail('permission inventory mismatch');
  const seeded = await client.query('SELECT (SELECT count(*) FROM medialab_core.temporary_download_centers)::int centers,(SELECT count(*) FROM medialab_core.temporary_download_center_access_observations)::int observations');
  if (seeded.rows[0].centers !== 0 || seeded.rows[0].observations !== 0) fail('operational M15 fixtures detected');
  const writers = await client.query("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND proname LIKE 'temporary_download_center%' AND (proname LIKE '%observation%' OR proname LIKE '%writer%')");
  if (writers.rows.length !== 0) fail('activity-observation writer function detected');
  const credentialColumns = await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='medialab_core' AND table_name=ANY($1::text[]) AND column_name ~* '(token|credential|access_code|signed_url|public_url|download_endpoint|recipient_login)'`, [tables]);
  if (credentialColumns.rows.length !== 0) fail('public credential or access mechanism column detected');
  console.log(`Temporary Download Center schema verification PASSED. 0018 size: ${bytes.length}; SHA-256: ${packetHash}; predecessor hashes: ${predecessorHashes.length}`);
} finally { await client.end(); }
