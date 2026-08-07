import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = path.join(baseDir, 'db/migrations');
const packetMigration = '0014_media_cull_workspace_selected_media_evidence_foundation.sql';
const successorMigration = '0015_editor_handoff_returned_media_intake_foundation.sql';
const secondSuccessorMigration = '0016_returned_editor_review_final_source_decision_foundation.sql';
const thirdSuccessorMigration = '0017_publication_delivery_entitlement_foundation.sql';
const fourthSuccessorMigration = '0018_temporary_download_center_external_sharing_foundation.sql';
const fifthSuccessorMigration = '0019_temporary_download_center_access_credential_gateway_foundation.sql';
const sixthSuccessorMigration = '0020_disposable_delivery_surface_local_fixture_foundation.sql';
const predecessors = [
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
  ['0013_capture_session_ingest_custody_foundation.sql','fb90823b98c56242dcbe4d148f63440d061ae0d7efcc652652c9feafa9be29fa']
] as const;
const tables = ['cull_candidate_current','cull_candidate_inventory_events','cull_candidate_relationship_contexts',
  'cull_candidates','cull_current_selections','cull_decision_batches','cull_decision_events','cull_inventory_seals',
  'cull_selection_designation_events','cull_workspace_completions','cull_workspace_current','cull_workspace_events','cull_workspaces'];
const publicFunctions = ['admit_cull_candidate','admit_cull_candidates','clear_cull_candidate_decision',
  'create_cull_successor_workspace','create_cull_workspace','decide_cull_candidate','decide_cull_candidates',
  'finalize_cull_workspace','get_cull_candidate_history','get_cull_selected_media','get_cull_workspace',
  'list_cull_workspaces','seal_cull_inventory','withdraw_cull_candidate'];
const helpers = ['reject_cull_evidence_mutation','require_cull_permission','validate_cull_reason','validate_cull_safe_json'];
const triggerTables = ['cull_candidate_inventory_events','cull_candidate_relationship_contexts','cull_candidates',
  'cull_decision_batches','cull_decision_events','cull_inventory_seals','cull_selection_designation_events',
  'cull_workspace_completions','cull_workspace_events','cull_workspaces'];
let errors=false;
function fail(message:string) { console.error(`ERROR: ${message}`); errors=true; }
function exact(label:string, actual:string[], expected:string[]) {
  if (JSON.stringify([...actual].sort())!==JSON.stringify([...expected].sort())) fail(`${label} mismatch`);
}
for (const [name,sha] of predecessors) {
  const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,name))).digest('hex');
  if (actual!==sha) fail(`${name} predecessor SHA-256 mismatch`);
}
const bytes=fs.readFileSync(path.join(migrationDir,packetMigration));
const packetHash=crypto.createHash('sha256').update(bytes).digest('hex');
const sql=bytes.toString('utf8');
exact('Migration inventory',fs.readdirSync(migrationDir).filter(x=>x.endsWith('.sql')),
  [...predecessors.map(x=>x[0]),packetMigration,successorMigration,secondSuccessorMigration,thirdSuccessorMigration,fourthSuccessorMigration,fifthSuccessorMigration,sixthSuccessorMigration]);
exact('Packet tables',[...sql.matchAll(/CREATE TABLE medialab_core\.([a-z0-9_]+)/g)].map(x=>x[1]),tables);
exact('Packet functions',[...sql.matchAll(/CREATE OR REPLACE FUNCTION medialab_core\.([a-z0-9_]+)/g)].map(x=>x[1]),[...publicFunctions,...helpers]);
for (const required of ['PHOTO','VIDEO','ORIGINAL','INVENTORY_SEALED','KEEP','REJECT','CULL_SELECTION',
  'SUPERSEDED','media_cull.manage','media_cull.read','media_asset.manage','check_media_idempotency',
  'FOR UPDATE','SECURITY DEFINER','SET search_path = pg_catalog, medialab_core, pg_temp']) {
  if (!sql.includes(required)) fail(`Missing required evidence ${required}`);
}
for (const prohibited of ['ON DELETE CASCADE','CREATE TABLE medialab_core.media_assets','CREATE TABLE medialab_core.media_operations',
  'CREATE TABLE medialab_core.media_storage_objects','drive.googleapis.com','aws_secret_access_key']) {
  if (sql.includes(prohibited)) fail(`Prohibited migration evidence ${prohibited}`);
}
const client=new pg.Client({host:'/tmp/mlvs01-p02m15c-pg',port:55444,database:'medialab_p02m15c_test',user:'medialab_p02m15c_test_owner'});
try {
  await client.connect();
  const ledger=await client.query('SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
  const successorHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,successorMigration))).digest('hex');
  const secondSuccessorHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,secondSuccessorMigration))).digest('hex');
  const thirdSuccessorHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,thirdSuccessorMigration))).digest('hex');
  const fourthSuccessorHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,fourthSuccessorMigration))).digest('hex');
  const fifthSuccessorHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,fifthSuccessorMigration))).digest('hex');
  const sixthSuccessorHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationDir,sixthSuccessorMigration))).digest('hex');
  const expected=[...predecessors.map(([filename,sha256])=>({filename,sha256})),{filename:packetMigration,sha256:packetHash},
    {filename:successorMigration,sha256:successorHash},
    {filename:secondSuccessorMigration,sha256:secondSuccessorHash},
    {filename:thirdSuccessorMigration,sha256:thirdSuccessorHash},
    {filename:fourthSuccessorMigration,sha256:fourthSuccessorHash},
    {filename:fifthSuccessorMigration,sha256:fifthSuccessorHash},
    {filename:sixthSuccessorMigration,sha256:sixthSuccessorHash}];
  if (JSON.stringify(ledger.rows)!==JSON.stringify(expected)) fail('Twenty-row migration ledger mismatch');
  const dbTables=await client.query("SELECT tablename,tableowner FROM pg_tables WHERE schemaname='medialab_core' AND tablename LIKE 'cull_%' ORDER BY tablename");
  exact('Database tables',dbTables.rows.map(r=>r.tablename),tables);
  if (dbTables.rows.some(r=>r.tableowner!=='medialab_p02m15c_test_owner')) fail('Packet table ownership mismatch');
  const dbFunctions=await client.query(`SELECT p.proname,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
    has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core'
    AND p.proname=ANY($2::text[]) ORDER BY p.proname`,['medialab_p02m15c_test_app',[...publicFunctions,...helpers]]);
  exact('Database functions',dbFunctions.rows.map(r=>r.proname),[...publicFunctions,...helpers]);
  if (dbFunctions.rows.some(r=>r.owner!=='medialab_p02m15c_test_owner'||r.public||publicFunctions.includes(r.proname)!==r.runtime)) fail('Function ownership or grant mismatch');
  if (dbFunctions.rows.some(r=>r.prosecdef&&JSON.stringify(r.proconfig)!==JSON.stringify(['search_path=pg_catalog, medialab_core, pg_temp']))) fail('Unsafe SECURITY DEFINER search_path');
  const triggers=await client.query(`SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='medialab_core' AND c.relname LIKE 'cull_%' AND NOT t.tgisinternal`);
  exact('Append-only triggers',triggers.rows.map(r=>r.relname),triggerTables);
  const authority=await client.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='medialab_core' AND c.relname LIKE 'cull_%' AND
    (has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('public',c.oid,'SELECT,INSERT,UPDATE,DELETE'))`,['medialab_p02m15c_test_app']);
  if (authority.rows[0].n!==0) fail('Runtime or PUBLIC has direct packet-table authority');
  const schema=await client.query("SELECT has_schema_privilege('public','medialab_core','USAGE') u,has_schema_privilege('public','medialab_core','CREATE') c");
  if (schema.rows[0].u||schema.rows[0].c) fail('PUBLIC has packet schema authority');
  const permissions=await client.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'media_cull.%' ORDER BY code");
  exact('Permission inventory',permissions.rows.map(r=>r.code),['media_cull.manage','media_cull.read']);
  const seeded=await client.query(`SELECT sum(n)::int n FROM (SELECT count(*) n FROM medialab_core.cull_workspaces
    UNION ALL SELECT count(*) FROM medialab_core.cull_candidates UNION ALL SELECT count(*) FROM medialab_core.cull_workspace_completions) q`);
  if (seeded.rows[0].n!==0) fail('Fixtures contain cull operational rows');
} catch (error:any) { fail(error.message||String(error)); } finally { await client.end().catch(()=>undefined); }
if (errors) process.exit(1);
console.log(`Media Cull Workspace and selected-media schema verification PASSED. 0014 SHA-256: ${packetHash}`);
