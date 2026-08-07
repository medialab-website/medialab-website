import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PERMISSION_SET_FIXTURE } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m13a_test';
const OWNER_ROLE = 'medialab_p02m13a_test_owner';
const RUNTIME_ROLE = 'medialab_p02m13a_test_app';
const SOCKET = '/tmp/mlvs01-p02m13a-pg';
const PORT = 55443;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M12_A_TEST';

function digest(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }

describe('P02-M12-A editor handoff and returned-media intake foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE,
      runtimeUser: RUNTIME_ROLE, confirm: TEST_DB });
  }
  async function session(): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(`INSERT INTO medialab_core.development_sessions
      (id,identity_id,token_sha256,issued_at,expires_at,revoked_at)
      VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',NULL)`,
      [crypto.randomUUID(), STAFF_IDENTITY_ID, digest(token)]);
    return token;
  }
  async function fail(work: Promise<unknown>, pattern?: RegExp): Promise<void> {
    try { await work; throw new Error('Expected PostgreSQL operation to fail'); }
    catch (error: any) {
      if (error.message === 'Expected PostgreSQL operation to fail') throw error;
      if (pattern) expect(error.message).toMatch(pattern);
    }
  }
  async function job(token: string) {
    const j = await runtime.query<{create_job:string}>('SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token,`job-${crypto.randomUUID()}`,ORGANIZATION_FIXTURE.id,ORDER_FOUNDATION_ORDER_ID,PROPERTY_HUB_ID,SOURCE]);
    const w = await runtime.query<{create_service_workstream:string}>(
      'SELECT medialab_core.create_service_workstream($1,$2,$3,$4,$5)',
      [token,`workstream-${crypto.randomUUID()}`,j.rows[0].create_job,ORDER_ITEM_FIXTURES[0].id,SOURCE]);
    return { jobId:j.rows[0].create_job, workstreamId:w.rows[0].create_service_workstream };
  }
  async function asset(token:string, j:{jobId:string;workstreamId:string}, lane:'PHOTO'|'VIDEO') {
    const a = await runtime.query<{create_media_asset:string}>('SELECT medialab_core.create_media_asset($1,$2,$3,$4,$5::jsonb)',
      [token,`asset-${crypto.randomUUID()}`,j.jobId,j.workstreamId,JSON.stringify({source:SOURCE})]);
    const mediaType=lane==='PHOTO'?'image/dng':'video/quicktime';
    const v = await runtime.query<{add_media_asset_version:string}>(
      'SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token,`version-${crypto.randomUUID()}`,a.rows[0].create_media_asset,'ORIGINAL',lane==='PHOTO'?'source.dng':'source.mov',
       1000,mediaType,digest(`source-${crypto.randomUUID()}`),SOURCE]);
    return {assetId:a.rows[0].create_media_asset,versionId:v.rows[0].add_media_asset_version};
  }
  async function completedCull(token:string,j:{jobId:string;workstreamId:string},lane:'PHOTO'|'VIDEO',count=2) {
    const w = await runtime.query<{create_cull_workspace:string}>(
      'SELECT medialab_core.create_cull_workspace($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token,`cull-${crypto.randomUUID()}`,j.jobId,j.workstreamId,lane,`${lane} cull`,'Synthetic cull',JSON.stringify({source:SOURCE})]);
    const candidates:string[]=[];
    for(let i=0;i<count;i++) {
      const item=await asset(token,j,lane);
      const c=await runtime.query<{admit_cull_candidate:string}>(
        'SELECT medialab_core.admit_cull_candidate($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb)',
        [token,`admit-${crypto.randomUUID()}`,w.rows[0].create_cull_workspace,item.assetId,item.versionId,[],JSON.stringify({source:SOURCE})]);
      candidates.push(c.rows[0].admit_cull_candidate);
    }
    await runtime.query('SELECT medialab_core.seal_cull_inventory($1,$2,$3,$4)',
      [token,`seal-${crypto.randomUUID()}`,w.rows[0].create_cull_workspace,'Synthetic seal']);
    for(let i=0;i<candidates.length;i++) await runtime.query(
      'SELECT medialab_core.decide_cull_candidate($1,$2,$3,$4,$5,$6,$7::uuid,$8::jsonb)',
      [token,`keep-${crypto.randomUUID()}`,candidates[i],'KEEP','Synthetic selected media',i,null,JSON.stringify({source:SOURCE})]);
    await runtime.query('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token,`final-${crypto.randomUUID()}`,w.rows[0].create_cull_workspace,'Synthetic completed cull',count,false,null]);
    return w.rows[0].create_cull_workspace;
  }
  async function handoff(token:string,cullId:string,destination='EDITOR_PARTICIPANT_A') {
    const h=await runtime.query<{create_editor_handoff_batch:string}>(
      'SELECT medialab_core.create_editor_handoff_batch($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token,`handoff-${crypto.randomUUID()}`,cullId,'EXTERNAL_EDITOR',destination,'Synthetic editor handoff',JSON.stringify({source:SOURCE})]);
    await runtime.query('SELECT medialab_core.record_editor_handoff_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token,`dispatch-${crypto.randomUUID()}`,h.rows[0].create_editor_handoff_batch,'DISPATCHED',0,'Synthetic dispatch',JSON.stringify({source:SOURCE})]);
    await runtime.query('SELECT medialab_core.record_editor_handoff_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token,`ack-${crypto.randomUUID()}`,h.rows[0].create_editor_handoff_batch,'ACKNOWLEDGED',1,'Synthetic acknowledgement',JSON.stringify({source:SOURCE})]);
    return h.rows[0].create_editor_handoff_batch;
  }
  async function intake(token:string,handoffId:string,reference=`RETURN_BATCH_${crypto.randomUUID()}`) {
    const r=await runtime.query<{create_returned_media_intake_batch:string}>(
      'SELECT medialab_core.create_returned_media_intake_batch($1,$2,$3,$4,$5,$6::jsonb)',
      [token,`intake-${crypto.randomUUID()}`,handoffId,reference,'Synthetic returned-media intake',JSON.stringify({source:SOURCE})]);
    return r.rows[0].create_returned_media_intake_batch;
  }
  async function record(token:string,intakeId:string,handoffItemId:string|null,outcome:string,basis:string,generation:number,
    filename='renamed-edit.jpg',key=`return-${crypto.randomUUID()}`) {
    return runtime.query<{record_returned_media_item:string}>(
      'SELECT medialab_core.record_returned_media_item($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::jsonb)',
      [token,key,intakeId,filename,1500,'image/jpeg',digest(`return-${filename}-${key}`),outcome,basis,handoffItemId,generation,
       'Synthetic returned-media evidence',JSON.stringify({source:SOURCE})]);
  }

  beforeAll(async()=>{await reset();owner=new pg.Client({host:SOCKET,port:PORT,database:TEST_DB,user:OWNER_ROLE});
    runtime=new pg.Client({host:SOCKET,port:PORT,database:TEST_DB,user:RUNTIME_ROLE});await owner.connect();await runtime.connect();});
  beforeEach(async()=>{await reset();});
  afterAll(async()=>{if(runtime)await runtime.end();if(owner)await owner.end();await reset();});

  it('replays fifteen migrations with permission-only fixtures and exact restricted authority', async()=>{
    const ledger=await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(16); expect(ledger.rows[14].filename).toBe('0015_editor_handoff_returned_media_intake_foundation.sql');
    const permissions=await owner.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'media_editor_handoff.%' ORDER BY code");
    expect(permissions.rows.map(r=>r.code)).toEqual(['media_editor_handoff.manage','media_editor_handoff.read']);
    const evidence=await owner.query(`SELECT sum(n)::int n FROM (
      SELECT count(*) n FROM medialab_core.editor_handoff_batches UNION ALL SELECT count(*) FROM medialab_core.editor_handoff_items
      UNION ALL SELECT count(*) FROM medialab_core.returned_media_intake_batches UNION ALL SELECT count(*) FROM medialab_core.returned_media_items) q`);
    expect(evidence.rows[0].n).toBe(0);
    const functions=await owner.query(`SELECT p.proname,has_function_privilege($1,p.oid,'EXECUTE') runtime,
      has_function_privilege('public',p.oid,'EXECUTE') public FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND (p.proname LIKE '%editor_handoff%' OR p.proname LIKE '%returned_media%') ORDER BY p.proname`,[RUNTIME_ROLE]);
    expect(functions.rows.filter(r=>r.runtime).map(r=>r.proname)).toEqual([
      'complete_editor_handoff_returns','create_editor_handoff_batch','create_returned_media_intake_batch','get_editor_handoff_batch',
      'get_returned_media_history','list_editor_handoff_batches','record_editor_handoff_event','record_returned_media_item','resolve_returned_media_match']);
    expect(functions.rows.some(r=>r.public)).toBe(false);
  });

  it('creates exact deterministic PHOTO and VIDEO handoffs from selected cull evidence',async()=>{
    const token=await session();const j=await job(token);const photoCull=await completedCull(token,j,'PHOTO');
    const videoCull=await completedCull(token,j,'VIDEO',1);const photo=await handoff(token,photoCull,'PHOTO_EDITOR');const video=await handoff(token,videoCull,'VIDEO_EDITOR');
    const rows=await owner.query(`SELECT b.id,b.lane,b.destination_reference,c.item_count,m.manifest_json,m.integrity_sha256,
      encode(sha256(convert_to(m.manifest_json::text,'UTF8')),'hex') calculated
      FROM medialab_core.editor_handoff_batches b JOIN medialab_core.editor_handoff_current c ON c.handoff_batch_id=b.id
      JOIN medialab_core.media_manifests m ON m.id=c.outbound_manifest_id ORDER BY b.lane`);
    expect(rows.rows.map(r=>r.lane)).toEqual(['PHOTO','VIDEO']);expect(rows.rows.map(r=>r.item_count).sort()).toEqual([1,2]);
    expect(rows.rows.every(r=>r.integrity_sha256===r.calculated)).toBe(true);
    expect(rows.rows.every(r=>r.manifest_json.items.every((x:any)=>x.media_asset_id&&x.media_asset_version_id))).toBe(true);
    await fail(runtime.query('SELECT medialab_core.create_editor_handoff_batch($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token,`duplicate-${crypto.randomUUID()}`,photoCull,'EXTERNAL_EDITOR','ANOTHER','Duplicate','{}']),/already has an editor handoff/);
    expect(photo).not.toBe(video);
  });

  it('preserves partial returns, multiple intake batches, renamed files, and multiple immutable revisions',async()=>{
    const token=await session();const j=await job(token);const h=await handoff(token,await completedCull(token,j,'PHOTO'));
    const items=await owner.query('SELECT id FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=$1 ORDER BY ordinal',[h]);
    const i1=await intake(token,h,'RETURN_BATCH_ONE');await record(token,i1,items.rows[0].id,'EXACT_MATCH','MANIFEST_REFERENCE',0,'editor-renamed-one.jpg');
    let current=(await owner.query('SELECT * FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=$1',[h])).rows[0];
    expect(current).toMatchObject({current_state:'PARTIAL_RETURN',returned_source_count:1,outstanding_source_count:1});
    const i2=await intake(token,h,'RETURN_BATCH_TWO');await record(token,i2,items.rows[0].id,'REPEATED_RETURN','EXPLICIT_HANDOFF_ITEM',1,'editor-renamed-revision.jpg');
    const versions=await owner.query(`SELECT v.version_kind,v.observed_filename FROM medialab_core.media_asset_versions v
      JOIN medialab_core.editor_handoff_items i ON i.media_asset_id=v.asset_id WHERE i.id=$1 ORDER BY v.version_number`,[items.rows[0].id]);
    expect(versions.rows.map(r=>r.version_kind)).toEqual(['ORIGINAL','EDITOR_RETURN','REVISION_RETURN']);
    expect(versions.rows.map(r=>r.observed_filename)).toContain('editor-renamed-revision.jpg');
    expect((await owner.query("SELECT count(*)::int n FROM medialab_core.media_asset_lineage WHERE relationship_type='PARENT_TO_CHILD'")).rows[0].n).toBe(1);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.returned_media_intake_batches WHERE handoff_batch_id=$1',[h])).rows[0].n).toBe(2);
  });

  it('keeps filename-only, ambiguous, unmatched, and conflicting returns unresolved until explicit strong resolution',async()=>{
    const token=await session();const j=await job(token);const h=await handoff(token,await completedCull(token,j,'PHOTO',1));
    const item=(await owner.query('SELECT id FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=$1',[h])).rows[0].id;
    const batch=await intake(token,h);const unresolved=await record(token,batch,null,'AMBIGUOUS','FILENAME_ONLY',0,'source.dng');
    expect((await owner.query('SELECT current_state,unresolved_return_count FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=$1',[h])).rows[0])
      .toEqual({current_state:'RECONCILIATION_REQUIRED',unresolved_return_count:1});
    expect((await owner.query("SELECT count(*)::int n FROM medialab_core.media_asset_versions WHERE version_kind IN ('EDITOR_RETURN','REVISION_RETURN')")).rows[0].n).toBe(0);
    await runtime.query('SELECT medialab_core.resolve_returned_media_match($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
      [token,`resolve-${crypto.randomUUID()}`,unresolved.rows[0].record_returned_media_item,'CONFIDENT_MATCH','EXPLICIT_HANDOFF_ITEM',item,1,1,
       'Synthetic explicit reconciliation',JSON.stringify({source:SOURCE})]);
    const resolved=(await owner.query('SELECT current_outcome,match_generation FROM medialab_core.returned_media_item_current WHERE returned_item_id=$1',
      [unresolved.rows[0].record_returned_media_item])).rows[0];
    expect(resolved).toEqual({current_outcome:'CONFIDENT_MATCH',match_generation:'2'});
    expect((await owner.query('SELECT unresolved_return_count,outstanding_source_count FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=$1',[h])).rows[0])
      .toEqual({unresolved_return_count:0,outstanding_source_count:0});
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.returned_media_match_events WHERE returned_item_id=$1',
      [unresolved.rows[0].record_returned_media_item])).rows[0].n).toBe(2);
  });

  it('enforces actor idempotency, stale generations, lane and Job isolation, and atomic failure',async()=>{
    const token=await session();const j1=await job(token);const j2=await job(token);
    const h1=await handoff(token,await completedCull(token,j1,'PHOTO',1));const h2=await handoff(token,await completedCull(token,j2,'PHOTO',1));
    const item1=(await owner.query('SELECT id FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=$1',[h1])).rows[0].id;
    const item2=(await owner.query('SELECT id FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=$1',[h2])).rows[0].id;
    const batch=await intake(token,h1);const key=`idem-${crypto.randomUUID()}`;
    const first=await record(token,batch,item1,'EXACT_MATCH','MANIFEST_REFERENCE',0,'renamed.jpg',key);
    const replay=await record(token,batch,item1,'EXACT_MATCH','MANIFEST_REFERENCE',0,'renamed.jpg',key);expect(replay.rows).toEqual(first.rows);
    await fail(record(token,batch,item1,'EXACT_MATCH','MANIFEST_REFERENCE',1,'different.jpg',key),/Idempotency key.*different request/i);
    const before=(await owner.query('SELECT count(*)::int n FROM medialab_core.returned_media_items')).rows[0].n;
    await fail(record(token,batch,item2,'EXACT_MATCH','EXPLICIT_HANDOFF_ITEM',1),/cross-Job, cross-lane, or missing/);
    await fail(record(token,batch,item1,'REPEATED_RETURN','EXPLICIT_HANDOFF_ITEM',0),/Stale returned-media generation/);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.returned_media_items')).rows[0].n).toBe(before);
  });

  it('completes returned intake without implying approval and denies unsafe evidence, direct DML, mutation, and PUBLIC authority',async()=>{
    const token=await session();const j=await job(token);const h=await handoff(token,await completedCull(token,j,'PHOTO',1));
    const item=(await owner.query('SELECT id FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=$1',[h])).rows[0].id;
    const batch=await intake(token,h);await record(token,batch,item,'EXACT_MATCH','CHECKSUM_AND_SIZE',0);
    await runtime.query('SELECT medialab_core.complete_editor_handoff_returns($1,$2,$3,$4,$5)',
      [token,`complete-${crypto.randomUUID()}`,h,1,'Synthetic return completion']);
    expect((await owner.query('SELECT current_state FROM medialab_core.editor_handoff_current WHERE handoff_batch_id=$1',[h])).rows[0].current_state).toBe('RETURNS_COMPLETE');
    const nonEvents=await owner.query(`SELECT
      (SELECT count(*)::int FROM medialab_core.media_approved_source_designations) approved_sources,
      (SELECT count(*)::int FROM medialab_core.media_storage_objects) storage,
      (SELECT count(*)::int FROM medialab_core.media_transfer_events) transfers,
      (SELECT count(*)::int FROM medialab_core.media_operations) operations`);
    expect(nonEvents.rows[0]).toEqual({approved_sources:0,storage:0,transfers:0,operations:0});
    await fail(runtime.query('INSERT INTO medialab_core.editor_handoff_events(id,handoff_batch_id,organization_id,job_id,event_type,reason,recorded_by_identity_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(),h,ORGANIZATION_FIXTURE.id,j.jobId,'DISPATCHED','Direct DML',STAFF_IDENTITY_ID]),/permission denied/);
    await fail(owner.query('DELETE FROM medialab_core.returned_media_match_events'),/immutable append-only/);
    await fail(runtime.query('SELECT medialab_core.create_returned_media_intake_batch($1,$2,$3,$4,$5,$6::jsonb)',
      [token,`unsafe-${crypto.randomUUID()}`,h,'RETURN','Unsafe','{"signed_url":"https://example.invalid"}']),/prohibited secrets/);
    const permission=await owner.query("SELECT id FROM medialab_core.permissions WHERE code='media_editor_handoff.manage'");
    await owner.query('DELETE FROM medialab_core.permission_set_permissions WHERE permission_set_id=$1 AND permission_id=$2',[PERMISSION_SET_FIXTURE.id,permission.rows[0].id]);
    await fail(runtime.query('SELECT medialab_core.create_editor_handoff_batch($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token,`unauthorized-${crypto.randomUUID()}`,crypto.randomUUID(),'EXTERNAL_EDITOR','X','No authority','{}']),/missing or unavailable|lacks active/);
    const schema=await owner.query(`SELECT has_schema_privilege('public','medialab_core','USAGE') usage,
      has_schema_privilege('public','medialab_core','CREATE') can_create`);
    expect(schema.rows[0]).toEqual({usage:false,can_create:false});
  });
});
