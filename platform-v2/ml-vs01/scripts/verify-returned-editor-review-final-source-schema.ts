import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migration='0016_returned_editor_review_final_source_decision_foundation.sql';
const expectedPredecessors=new Map<string,string>([
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
 ['0015_editor_handoff_returned_media_intake_foundation.sql','42a4b5381cbb1b434b2f1871e91fd5cc460d756d16df632c35dfc68b752c31c5']
]);
const tables=['returned_quick_edit_requests','returned_quick_edit_version_links','returned_review_batch_current','returned_review_batch_events','returned_review_batches','returned_review_decisions','returned_review_item_current','returned_review_items','returned_review_successor_links','returned_revision_requests','returned_revision_version_links'].sort();
const publicFunctions=['admit_returned_review_item','associate_quick_edit_corrected_version','associate_returned_revision','complete_returned_review_batch','create_returned_review_batch','get_returned_review_batch','get_returned_review_history','get_returned_review_lineage','link_returned_review_successor','list_returned_review_batches','record_returned_review_decision','seal_returned_review_inventory','supersede_returned_review_decision'].sort();
const helpers=['apply_returned_review_decision','current_returned_review_final_designation','recompute_returned_review_current','reject_returned_review_evidence_mutation','require_returned_review_permission','returned_review_final_purpose','validate_returned_review_safe_json','validate_returned_review_text'].sort();
const triggers=['returned_quick_edit_requests_immutability_guard','returned_quick_edit_version_links_immutability_guard','returned_review_batch_events_immutability_guard','returned_review_batches_immutability_guard','returned_review_decisions_immutability_guard','returned_review_items_immutability_guard','returned_review_successor_links_immutability_guard','returned_revision_requests_immutability_guard','returned_revision_version_links_immutability_guard'].sort();
function fail(message:string):never{throw new Error(`RETURNED_REVIEW_SCHEMA_VERIFICATION_FAILED: ${message}`);}
for(const [name,sha] of expectedPredecessors){const bytes=fs.readFileSync(path.join(base,'db/migrations',name));const actual=crypto.createHash('sha256').update(bytes).digest('hex');if(actual!==sha)fail(`${name} predecessor SHA mismatch: ${actual}`);}
const bytes=fs.readFileSync(path.join(base,'db/migrations',migration));const packetHash=crypto.createHash('sha256').update(bytes).digest('hex');
const client=new pg.Client({host:'/tmp/mlvs01-p02m15d-pg',port:55445,database:'medialab_p02m15d_test',user:'medialab_p02m15d_test_owner'});await client.connect();
try{
 const ledger=await client.query('SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename');if(ledger.rows.length !== 21||ledger.rows[15].filename!==migration||ledger.rows[15].sha256!==packetHash||ledger.rows[16].filename!=='0017_publication_delivery_entitlement_foundation.sql'||ledger.rows[17].filename!=='0018_temporary_download_center_external_sharing_foundation.sql'||ledger.rows[18].filename!=='0019_temporary_download_center_access_credential_gateway_foundation.sql'||ledger.rows[19].filename!=='0020_disposable_delivery_surface_local_fixture_foundation.sql'||ledger.rows[20].filename!=='0021_provider_neutral_file_backed_disposable_delivery_foundation.sql')fail('migration ledger identity mismatch');
 const t=await client.query("SELECT tablename,tableowner FROM pg_tables WHERE schemaname='medialab_core' AND tablename LIKE 'returned_%review%' OR schemaname='medialab_core' AND tablename IN ('returned_revision_requests','returned_revision_version_links','returned_quick_edit_requests','returned_quick_edit_version_links') ORDER BY tablename");if(JSON.stringify(t.rows.map(r=>r.tablename))!==JSON.stringify(tables))fail(`table inventory mismatch: ${t.rows.map(r=>r.tablename)}`);if(t.rows.some(r=>r.tableowner!=='medialab_p02m15d_test_owner'))fail('packet table owner mismatch');
 const f=await client.query(`SELECT p.proname,pg_get_userbyid(p.proowner) owner,has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND p.proname=ANY($2::text[]) ORDER BY p.proname`,['medialab_p02m15d_test_app',[...publicFunctions,...helpers]]);if(f.rows.length!==publicFunctions.length+helpers.length)fail('function inventory mismatch');if(f.rows.some(r=>r.owner!=='medialab_p02m15d_test_owner'||r.public||r.runtime!==publicFunctions.includes(r.proname)))fail('function owner/runtime/PUBLIC grant mismatch');
 const dml=await client.query(`SELECT c.relname,(has_table_privilege($1,c.oid,'SELECT') OR has_table_privilege($1,c.oid,'INSERT') OR has_table_privilege($1,c.oid,'UPDATE') OR has_table_privilege($1,c.oid,'DELETE')) runtime,(has_table_privilege('public',c.oid,'SELECT') OR has_table_privilege('public',c.oid,'INSERT') OR has_table_privilege('public',c.oid,'UPDATE') OR has_table_privilege('public',c.oid,'DELETE')) public FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='medialab_core' AND c.relname=ANY($2::text[])`,['medialab_p02m15d_test_app',tables]);if(dml.rows.some(r=>r.runtime||r.public))fail('runtime or PUBLIC packet-table authority detected');
 const tr=await client.query(`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='medialab_core' AND NOT t.tgisinternal AND t.tgname=ANY($1::text[]) ORDER BY t.tgname`,[triggers]);if(JSON.stringify(tr.rows.map(r=>r.tgname))!==JSON.stringify(triggers))fail('append-only trigger inventory mismatch');
 const perms=await client.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'media_return_review.%' ORDER BY code");if(JSON.stringify(perms.rows.map(r=>r.code))!==JSON.stringify(['media_return_review.manage','media_return_review.read']))fail('permission inventory mismatch');
 const seeded=await client.query('SELECT count(*)::int n FROM medialab_core.returned_review_batches');if(seeded.rows[0].n!==0)fail('operational review fixtures detected');
 console.log(`Returned-editor review and final-source schema verification PASSED. 0016 size: ${bytes.length}; SHA-256: ${packetHash}`);
}finally{await client.end();}
