import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PERMISSION_SET_FIXTURE } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m15c_test';
const OWNER_ROLE = 'medialab_p02m15c_test_owner';
const RUNTIME_ROLE = 'medialab_p02m15c_test_app';
const SOCKET = '/tmp/mlvs01-p02m15c-pg';
const PORT = 55444;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M11_A_TEST';

function digest(value: string): string { return crypto.createHash('sha256').update(value).digest('hex'); }

describe('P02-M11-A Media Cull Workspace and selected-media evidence foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE,
      runtimeUser: RUNTIME_ROLE, confirm: TEST_DB });
  }
  async function issueSession(): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(`INSERT INTO medialab_core.development_sessions
      (id,identity_id,token_sha256,issued_at,expires_at,revoked_at)
      VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',NULL)`,
      [crypto.randomUUID(), STAFF_IDENTITY_ID, digest(token)]);
    return token;
  }
  async function expectFailure(work: Promise<unknown>, pattern?: RegExp): Promise<void> {
    try { await work; throw new Error('Expected PostgreSQL operation to fail'); }
    catch (error: any) {
      if (error.message === 'Expected PostgreSQL operation to fail') throw error;
      if (pattern) expect(error.message).toMatch(pattern);
    }
  }
  async function setupJob(token: string): Promise<{jobId:string; workstreamId:string}> {
    const job = await runtime.query<{create_job:string}>('SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE]);
    const workstream = await runtime.query<{create_service_workstream:string}>(
      'SELECT medialab_core.create_service_workstream($1,$2,$3,$4,$5)',
      [token, `workstream-${crypto.randomUUID()}`, job.rows[0].create_job, ORDER_ITEM_FIXTURES[0].id, SOURCE]);
    return { jobId: job.rows[0].create_job, workstreamId: workstream.rows[0].create_service_workstream };
  }
  async function asset(token:string, jobId:string, workstreamId:string, mediaType='image/dng') {
    const a = await runtime.query<{create_media_asset:string}>('SELECT medialab_core.create_media_asset($1,$2,$3,$4,$5::jsonb)',
      [token, `asset-${crypto.randomUUID()}`, jobId, workstreamId, JSON.stringify({ source: SOURCE })]);
    const checksum = digest(`bytes-${crypto.randomUUID()}`);
    const v = await runtime.query<{add_media_asset_version:string}>(
      'SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token, `version-${crypto.randomUUID()}`, a.rows[0].create_media_asset, 'ORIGINAL',
       mediaType.startsWith('video/') ? 'clip.mov' : 'frame.dng', 12345, mediaType, checksum, SOURCE]);
    return { assetId:a.rows[0].create_media_asset, versionId:v.rows[0].add_media_asset_version };
  }
  async function workspace(token:string, jobId:string, workstreamId:string|null, lane='PHOTO') {
    const r = await runtime.query<{create_cull_workspace:string}>(
      'SELECT medialab_core.create_cull_workspace($1,$2,$3,$4::uuid,$5,$6,$7,$8::jsonb)',
      [token, `workspace-${crypto.randomUUID()}`, jobId, workstreamId, lane, `${lane} synthetic cull`,
       'Synthetic workspace evidence', JSON.stringify({ source: SOURCE })]);
    return r.rows[0].create_cull_workspace;
  }
  async function admit(token:string, workspaceId:string, item:{assetId:string;versionId:string}, context:unknown={source:SOURCE}) {
    const r = await runtime.query<{admit_cull_candidate:string}>(
      'SELECT medialab_core.admit_cull_candidate($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb)',
      [token, `admit-${crypto.randomUUID()}`, workspaceId, item.assetId, item.versionId, [], JSON.stringify(context)]);
    return r.rows[0].admit_cull_candidate;
  }
  async function seal(token:string, workspaceId:string) {
    await runtime.query('SELECT medialab_core.seal_cull_inventory($1,$2,$3,$4)',
      [token, `seal-${crypto.randomUUID()}`, workspaceId, 'Synthetic inventory seal']);
  }
  async function decide(token:string, candidateId:string, outcome:string, generation:number, key=`decision-${crypto.randomUUID()}`) {
    return runtime.query<{decide_cull_candidate:string}>(
      'SELECT medialab_core.decide_cull_candidate($1,$2,$3,$4,$5,$6,$7::uuid,$8::jsonb)',
      [token, key, candidateId, outcome, `Synthetic ${outcome} decision`, generation, null, JSON.stringify({source:SOURCE})]);
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({host:SOCKET,port:PORT,database:TEST_DB,user:OWNER_ROLE});
    runtime = new pg.Client({host:SOCKET,port:PORT,database:TEST_DB,user:RUNTIME_ROLE});
    await owner.connect(); await runtime.connect();
  });
  beforeEach(async () => { await reset(); });
  afterAll(async () => { if (runtime) await runtime.end(); if (owner) await owner.end(); await reset(); });

  it('replays fifteen exact migrations with permission-only fixtures and exact restricted authority', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(20);
    expect(ledger.rows[13].filename).toBe('0014_media_cull_workspace_selected_media_evidence_foundation.sql');
    expect(ledger.rows[14].filename).toBe('0015_editor_handoff_returned_media_intake_foundation.sql');
    const perms = await owner.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'media_cull.%' ORDER BY code");
    expect(perms.rows.map(r=>r.code)).toEqual(['media_cull.manage','media_cull.read']);
    const seeded = await owner.query(`SELECT sum(n)::int AS n FROM (
      SELECT count(*) n FROM medialab_core.cull_workspaces UNION ALL SELECT count(*) FROM medialab_core.cull_candidates
      UNION ALL SELECT count(*) FROM medialab_core.cull_decision_events UNION ALL SELECT count(*) FROM medialab_core.cull_workspace_completions) q`);
    expect(seeded.rows[0].n).toBe(0);
    const f = await owner.query(`SELECT p.proname,has_function_privilege($1,p.oid,'EXECUTE') runtime,
      has_function_privilege('public',p.oid,'EXECUTE') public FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname LIKE '%cull%' ORDER BY p.proname`, [RUNTIME_ROLE]);
    expect(f.rows.filter(r=>r.runtime).map(r=>r.proname)).toEqual(['admit_cull_candidate','admit_cull_candidates',
      'clear_cull_candidate_decision','create_cull_successor_workspace','create_cull_workspace','decide_cull_candidate',
      'decide_cull_candidates','finalize_cull_workspace','get_cull_candidate_history','get_cull_selected_media',
      'get_cull_workspace','list_cull_workspaces','seal_cull_inventory','withdraw_cull_candidate']);
    expect(f.rows.some(r=>r.public)).toBe(false);
    const tables = await owner.query(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND c.relname LIKE 'cull_%' AND
      (has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('public',c.oid,'SELECT,INSERT,UPDATE,DELETE'))`,[RUNTIME_ROLE]);
    expect(tables.rows[0].n).toBe(0);
  });

  it('enforces exact ORIGINAL identity, one-Job scope, optional workstream, and separate lanes', async () => {
    const token=await issueSession(); const j1=await setupJob(token); const j2=await setupJob(token);
    const photo=await asset(token,j1.jobId,j1.workstreamId); const video=await asset(token,j1.jobId,j1.workstreamId,'video/quicktime');
    const other=await asset(token,j2.jobId,j2.workstreamId); const w=await workspace(token,j1.jobId,j1.workstreamId);
    const c1=await admit(token,w,photo,{source:SOURCE,observed_name:'same.dng'});
    expect(await expectFailure(admit(token,w,photo),/already an active candidate/)).toBeUndefined();
    await expectFailure(admit(token,w,video),/does not match.*lane/i);
    await expectFailure(admit(token,w,other),/cross-tenant, cross-Job/);
    const derived=await runtime.query<{add_media_asset_version:string}>('SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token,`derived-${crypto.randomUUID()}`,photo.assetId,'GENERATED_DERIVATIVE','same.dng',12345,'image/dng',digest('derived'),SOURCE]);
    await expectFailure(admit(token,w,{assetId:photo.assetId,versionId:derived.rows[0].add_media_asset_version}),/exact immutable ORIGINAL/);
    const c2=await admit(token,w,await asset(token,j1.jobId,j1.workstreamId),{source:SOURCE,observed_name:'same.dng'});
    expect(c2).not.toBe(c1);
    const jobOnly=await workspace(token,j1.jobId,null,'VIDEO'); expect(jobOnly).not.toBe(w);
    await expectFailure(workspace(token,j1.jobId,j2.workstreamId),/cross-tenant, cross-Job/);
  });

  it('seals explicit inventory and preserves append-only admission and withdrawal evidence', async () => {
    const token=await issueSession(); const j=await setupJob(token); const w=await workspace(token,j.jobId,j.workstreamId);
    const item=await asset(token,j.jobId,j.workstreamId); const c=await admit(token,w,item);
    await runtime.query('SELECT medialab_core.withdraw_cull_candidate($1,$2,$3,$4,$5::jsonb)',
      [token,`withdraw-${crypto.randomUUID()}`,c,'Synthetic correction',JSON.stringify({source:SOURCE})]);
    expect(await admit(token,w,item)).toBe(c);
    await seal(token,w);
    await expectFailure(admit(token,w,await asset(token,j.jobId,j.workstreamId)),/before inventory sealing/);
    await expectFailure(owner.query('DELETE FROM medialab_core.cull_candidate_inventory_events WHERE candidate_id=$1',[c]),/immutable append-only/);
    const evidence=await owner.query(`SELECT (SELECT count(*)::int FROM medialab_core.cull_candidate_inventory_events WHERE candidate_id=$1) events,
      (SELECT active FROM medialab_core.cull_candidate_current WHERE candidate_id=$1) active`,[c]);
    expect(evidence.rows[0]).toEqual({events:3,active:true});
  });

  it('records attributable corrections and rejects stale or conflicting idempotent decisions atomically', async () => {
    const token=await issueSession(); const j=await setupJob(token); const w=await workspace(token,j.jobId,j.workstreamId);
    const c=await admit(token,w,await asset(token,j.jobId,j.workstreamId)); await seal(token,w);
    const key=`decision-${crypto.randomUUID()}`; const first=await decide(token,c,'KEEP',0,key);
    expect((await decide(token,c,'KEEP',0,key)).rows[0]).toEqual(first.rows[0]);
    await expectFailure(decide(token,c,'REJECT',1,key),/Idempotency key.*different request/i);
    await expectFailure(decide(token,c,'REJECT',0),/Stale Cull Workspace/);
    await decide(token,c,'REJECT',1);
    await runtime.query('SELECT medialab_core.clear_cull_candidate_decision($1,$2,$3,$4,$5,$6::jsonb)',
      [token,`clear-${crypto.randomUUID()}`,c,'Synthetic correction clear',2,JSON.stringify({source:SOURCE})]);
    const h=await runtime.query<{get_cull_candidate_history:any}>('SELECT medialab_core.get_cull_candidate_history($1,$2)',[token,c]);
    expect(h.rows[0].get_cull_candidate_history.decision_events).toHaveLength(3);
    expect(h.rows[0].get_cull_candidate_history.current.current_outcome).toBeNull();
    expect(h.rows[0].get_cull_candidate_history.decision_events.every((e:any)=>e.recorded_by_identity_id===STAFF_IDENTITY_ID)).toBe(true);
  });

  it('applies synchronized decisions only to an explicit candidate list and rolls back invalid batches', async () => {
    const token=await issueSession(); const j=await setupJob(token); const w=await workspace(token,j.jobId,j.workstreamId);
    const c1=await admit(token,w,await asset(token,j.jobId,j.workstreamId));
    const c2=await admit(token,w,await asset(token,j.jobId,j.workstreamId));
    const c3=await admit(token,w,await asset(token,j.jobId,j.workstreamId)); await seal(token,w);
    await runtime.query('SELECT medialab_core.decide_cull_candidates($1,$2,$3,$4::uuid[],$5,$6,$7,$8::jsonb)',
      [token,`batch-${crypto.randomUUID()}`,w,[c1,c2],'KEEP','Explicit synchronized pair',0,JSON.stringify({source:SOURCE})]);
    const state=await owner.query('SELECT candidate_id,current_outcome FROM medialab_core.cull_candidate_current WHERE workspace_id=$1 ORDER BY candidate_id',[w]);
    expect(state.rows.filter(r=>r.current_outcome==='KEEP')).toHaveLength(2);
    expect(state.rows.find(r=>r.candidate_id===c3)?.current_outcome).toBeNull();
    const before=await owner.query('SELECT count(*)::int n FROM medialab_core.cull_decision_events WHERE workspace_id=$1',[w]);
    await expectFailure(runtime.query('SELECT medialab_core.decide_cull_candidates($1,$2,$3,$4::uuid[],$5,$6,$7,$8::jsonb)',
      [token,`bad-${crypto.randomUUID()}`,w,[c3,crypto.randomUUID()],'REJECT','Invalid explicit batch',1,JSON.stringify({source:SOURCE})]),/wrong-workspace candidate/);
    const after=await owner.query('SELECT count(*)::int n FROM medialab_core.cull_decision_events WHERE workspace_id=$1',[w]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('blocks unresolved completion and creates deterministic selected-media evidence with exact semantics and non-events', async () => {
    const token=await issueSession(); const j=await setupJob(token); const w=await workspace(token,j.jobId,j.workstreamId);
    const c1=await admit(token,w,await asset(token,j.jobId,j.workstreamId)); const c2=await admit(token,w,await asset(token,j.jobId,j.workstreamId));
    await seal(token,w); await decide(token,c1,'KEEP',0);
    await expectFailure(runtime.query('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token,`early-${crypto.randomUUID()}`,w,'Early prohibited completion',1,false,null]),/Every active candidate/);
    await decide(token,c2,'REJECT',1);
    const key=`final-${crypto.randomUUID()}`;
    const done=await runtime.query<{finalize_cull_workspace:any}>('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token,key,w,'Synthetic completion',2,false,null]);
    const replay=await runtime.query<{finalize_cull_workspace:any}>('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token,key,w,'Synthetic completion',2,false,null]);
    expect(replay.rows[0]).toEqual(done.rows[0]);
    const selected=await runtime.query<{get_cull_selected_media:any}>('SELECT medialab_core.get_cull_selected_media($1,$2)',[token,w]);
    expect(selected.rows[0].get_cull_selected_media.manifest.selected_count).toBe(1);
    expect(selected.rows[0].get_cull_selected_media.manifest.selected_versions[0].media_asset_id).toBeTruthy();
    const hash=await owner.query("SELECT encode(sha256(convert_to(manifest_json::text,'UTF8')),'hex') value FROM medialab_core.media_manifests WHERE id=$1",
      [done.rows[0].finalize_cull_workspace.media_manifest_id]);
    expect(hash.rows[0].value).toBe(selected.rows[0].get_cull_selected_media.manifest_integrity_sha256);
    await expectFailure(decide(token,c1,'REJECT',2),/sealed incomplete/);
    const nonEvents=await owner.query(`SELECT
      (SELECT count(*)::int FROM medialab_core.media_storage_objects) storage,
      (SELECT count(*)::int FROM medialab_core.media_transfer_events) transfers,
      (SELECT count(*)::int FROM medialab_core.media_operations) operations,
      (SELECT count(*)::int FROM medialab_core.media_approved_source_designations) approved_sources`);
    expect(nonEvents.rows[0]).toEqual({storage:0,transfers:0,operations:0,approved_sources:0});
  });

  it('requires a reason-bearing empty selection override and preserves recull predecessor history', async () => {
    const token=await issueSession(); const j=await setupJob(token); const original=await workspace(token,j.jobId,j.workstreamId);
    const item=await asset(token,j.jobId,j.workstreamId); const c=await admit(token,original,item); await seal(token,original); await decide(token,c,'REJECT',0);
    await expectFailure(runtime.query('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token,`empty-${crypto.randomUUID()}`,original,'No selected items',1,false,null]),/reason-bearing override/);
    await runtime.query('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token,`override-${crypto.randomUUID()}`,original,'No selected items',1,true,'Synthetic all-rejected selection']);
    const successor=await runtime.query<{create_cull_successor_workspace:string}>(
      'SELECT medialab_core.create_cull_successor_workspace($1,$2,$3,$4,$5,$6::jsonb)',
      [token,`recull-${crypto.randomUUID()}`,original,'PHOTO synthetic recull','Synthetic correction',JSON.stringify({source:SOURCE})]);
    const c2=await admit(token,successor.rows[0].create_cull_successor_workspace,item); await seal(token,successor.rows[0].create_cull_successor_workspace);
    await decide(token,c2,'KEEP',0);
    await runtime.query('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token,`recull-final-${crypto.randomUUID()}`,successor.rows[0].create_cull_successor_workspace,'Synthetic recull complete',1,false,null]);
    const current=await owner.query('SELECT workspace_id FROM medialab_core.cull_current_selections WHERE job_id=$1',[j.jobId]);
    expect(current.rows[0].workspace_id).toBe(successor.rows[0].create_cull_successor_workspace);
    const states=await owner.query('SELECT workspace_id,current_state FROM medialab_core.cull_workspace_current WHERE workspace_id=ANY($1::uuid[]) ORDER BY workspace_id',
      [[original,successor.rows[0].create_cull_successor_workspace]]);
    expect(states.rows.map(r=>r.current_state).sort()).toEqual(['COMPLETE','SUPERSEDED']);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.cull_workspace_completions WHERE workspace_id=ANY($1::uuid[])',[[original,successor.rows[0].create_cull_successor_workspace]])).rows[0].n).toBe(2);
  });

  it('rejects unsafe evidence, direct mutation, PUBLIC authority, missing authorization, and inaccessible scope', async () => {
    const token=await issueSession(); const j=await setupJob(token);
    await expectFailure(runtime.query('SELECT medialab_core.create_cull_workspace($1,$2,$3,$4::uuid,$5,$6,$7,$8::jsonb)',
      [token,`unsafe-${crypto.randomUUID()}`,j.jobId,j.workstreamId,'PHOTO','Unsafe','Synthetic reason',JSON.stringify({signed_url:'https://example.invalid/x'})]),/prohibited secrets/);
    const permission=await owner.query("SELECT id FROM medialab_core.permissions WHERE code='media_cull.manage'");
    await owner.query('DELETE FROM medialab_core.permission_set_permissions WHERE permission_set_id=$1 AND permission_id=$2',[PERMISSION_SET_FIXTURE.id,permission.rows[0].id]);
    await expectFailure(workspace(token,j.jobId,j.workstreamId),/lacks active media_cull.manage authority/);
    await owner.query('INSERT INTO medialab_core.permission_set_permissions(permission_set_id,permission_id,created_at) VALUES($1,$2,clock_timestamp())',[PERMISSION_SET_FIXTURE.id,permission.rows[0].id]);
    const w=await workspace(token,j.jobId,j.workstreamId);
    await expectFailure(runtime.query('INSERT INTO medialab_core.cull_workspace_events(id,workspace_id,organization_id,job_id,event_type,reason,recorded_by_identity_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [crypto.randomUUID(),w,ORGANIZATION_FIXTURE.id,j.jobId,'CREATED','Direct DML',STAFF_IDENTITY_ID]),/permission denied/);
    await expectFailure(owner.query('UPDATE medialab_core.cull_workspaces SET label=$1 WHERE id=$2',['Changed',w]),/immutable append-only/);
    await expectFailure(runtime.query('SELECT medialab_core.get_cull_workspace($1,$2)',[token,crypto.randomUUID()]),/missing or unavailable/);
    const schema=await owner.query(`SELECT has_schema_privilege('public','medialab_core','USAGE') usage,
      has_schema_privilege('public','medialab_core','CREATE') can_create`);
    expect(schema.rows[0]).toEqual({usage:false,can_create:false});
  });
});
