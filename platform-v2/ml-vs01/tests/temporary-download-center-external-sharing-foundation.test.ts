import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { COMMERCIAL_SNAPSHOT_FIXTURES } from '../db/fixtures/current-catalog-price-fixtures.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PEOPLE_FIXTURES } from '../db/fixtures/identity-tenancy-fixtures.js';
import {
  ORDER_FOUNDATION_ORDER_ID,
  ORDER_FOUNDATION_PROPERTY_ID,
  ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
  ORDER_FOUNDATION_SOURCE,
  ORDER_ITEM_FIXTURES
} from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m15e_test';
const OWNER = 'medialab_p02m15e_test_owner';
const RUNTIME = 'medialab_p02m15e_test_app';
const SOCKET = '/tmp/mlvs01-p02m15e-pg';
const PORT = 55446;
const ACTOR = IDENTITY_FIXTURES[1].id;
const ADMIN = IDENTITY_FIXTURES[0].id;
const SOURCE = 'SYNTHETIC_P02_M15_A_TEST';
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

describe('P02-M15-A Temporary Download Center and external-sharing foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;
  const reset = () => resetTestDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER, runtimeUser: RUNTIME, confirm: TEST_DB });

  async function fail(work: Promise<unknown>, pattern?: RegExp): Promise<void> {
    try { await work; throw new Error('Expected failure'); }
    catch (error: any) {
      if (error.message === 'Expected failure') throw error;
      if (pattern) expect(error.message).toMatch(pattern);
    }
  }

  async function session(identity = ACTOR): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at)
       VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
      [crypto.randomUUID(), identity, digest(token)]
    );
    return token;
  }

  async function job(token: string, orderId = ORDER_FOUNDATION_ORDER_ID, orderItemId = ORDER_ITEM_FIXTURES[0].id) {
    const created = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, orderId, PROPERTY_HUB_ID, SOURCE]
    );
    const workstream = await runtime.query<{ create_service_workstream: string }>(
      'SELECT medialab_core.create_service_workstream($1,$2,$3,$4,$5)',
      [token, `ws-${crypto.randomUUID()}`, created.rows[0].create_job, orderItemId, SOURCE]
    );
    return { jobId: created.rows[0].create_job, workstreamId: workstream.rows[0].create_service_workstream };
  }

  async function acceptedFinal(token: string, work: { jobId: string; workstreamId: string }) {
    const asset = await runtime.query<{ create_media_asset: string }>(
      'SELECT medialab_core.create_media_asset($1,$2,$3,$4,$5::jsonb)',
      [token, `asset-${crypto.randomUUID()}`, work.jobId, work.workstreamId, JSON.stringify({ source: SOURCE })]
    );
    const original = await runtime.query<{ add_media_asset_version: string }>(
      'SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token, `original-${crypto.randomUUID()}`, asset.rows[0].create_media_asset, 'ORIGINAL', 'source.dng', 1000, 'image/dng', digest(crypto.randomUUID()), SOURCE]
    );
    const cull = await runtime.query<{ create_cull_workspace: string }>(
      'SELECT medialab_core.create_cull_workspace($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `cull-${crypto.randomUUID()}`, work.jobId, work.workstreamId, 'PHOTO', 'Photo cull', 'Synthetic cull', JSON.stringify({ source: SOURCE })]
    );
    const candidate = await runtime.query<{ admit_cull_candidate: string }>(
      'SELECT medialab_core.admit_cull_candidate($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb)',
      [token, `admit-${crypto.randomUUID()}`, cull.rows[0].create_cull_workspace, asset.rows[0].create_media_asset, original.rows[0].add_media_asset_version, [], JSON.stringify({ source: SOURCE })]
    );
    await runtime.query('SELECT medialab_core.seal_cull_inventory($1,$2,$3,$4)', [token, `seal-${crypto.randomUUID()}`, cull.rows[0].create_cull_workspace, 'Synthetic seal']);
    await runtime.query('SELECT medialab_core.decide_cull_candidate($1,$2,$3,$4,$5,$6,$7::uuid,$8::jsonb)', [token, `keep-${crypto.randomUUID()}`, candidate.rows[0].admit_cull_candidate, 'KEEP', 'Synthetic keep', 0, null, '{}']);
    await runtime.query('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)', [token, `finish-${crypto.randomUUID()}`, cull.rows[0].create_cull_workspace, 'Synthetic completion', 1, false, null]);
    const handoff = await runtime.query<{ create_editor_handoff_batch: string }>(
      'SELECT medialab_core.create_editor_handoff_batch($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `handoff-${crypto.randomUUID()}`, cull.rows[0].create_cull_workspace, 'EXTERNAL_EDITOR', 'SYNTHETIC_EDITOR', 'Synthetic handoff', '{}']
    );
    await runtime.query('SELECT medialab_core.record_editor_handoff_event($1,$2,$3,$4,$5,$6,$7::jsonb)', [token, `dispatch-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch, 'DISPATCHED', 0, 'Synthetic dispatch', '{}']);
    await runtime.query('SELECT medialab_core.record_editor_handoff_event($1,$2,$3,$4,$5,$6,$7::jsonb)', [token, `ack-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch, 'ACKNOWLEDGED', 1, 'Synthetic acknowledgement', '{}']);
    const intake = await runtime.query<{ create_returned_media_intake_batch: string }>(
      'SELECT medialab_core.create_returned_media_intake_batch($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `intake-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch, 'SYNTHETIC_RETURN', 'Synthetic intake', '{}']
    );
    const handoffItem = (await owner.query('SELECT id FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=$1', [handoff.rows[0].create_editor_handoff_batch])).rows[0].id;
    const returned = await runtime.query<{ record_returned_media_item: string }>(
      'SELECT medialab_core.record_returned_media_item($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::jsonb)',
      [token, `return-${crypto.randomUUID()}`, intake.rows[0].create_returned_media_intake_batch, 'edit.jpg', 1500, 'image/jpeg', digest(crypto.randomUUID()), 'EXACT_MATCH', 'MANIFEST_REFERENCE', handoffItem, 0, 'Synthetic exact return', '{}']
    );
    const versionId = (await owner.query('SELECT returned_media_asset_version_id FROM medialab_core.returned_media_item_current WHERE returned_item_id=$1', [returned.rows[0].record_returned_media_item])).rows[0].returned_media_asset_version_id;
    const review = await runtime.query<{ create_returned_review_batch: string }>(
      'SELECT medialab_core.create_returned_review_batch($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `review-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch, 1, 'Synthetic review', '{}']
    );
    const reviewItem = await runtime.query<{ admit_returned_review_item: string }>(
      'SELECT medialab_core.admit_returned_review_item($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `review-item-${crypto.randomUUID()}`, review.rows[0].create_returned_review_batch, versionId, 0, '{}']
    );
    await runtime.query('SELECT medialab_core.seal_returned_review_inventory($1,$2,$3,$4,$5)', [token, `seal-review-${crypto.randomUUID()}`, review.rows[0].create_returned_review_batch, 1, 'Synthetic seal']);
    await runtime.query('SELECT medialab_core.record_returned_review_decision($1,$2,$3,$4,$5,$6,$7)', [token, `accept-${crypto.randomUUID()}`, reviewItem.rows[0].admit_returned_review_item, 'ACCEPT', 'Synthetic accepted final source', null, 0]);
    await runtime.query('SELECT medialab_core.complete_returned_review_batch($1,$2,$3,$4,$5)', [token, `complete-${crypto.randomUUID()}`, review.rows[0].create_returned_review_batch, 2, 'Synthetic completed review']);
    return { ...work, versionId };
  }

  async function publication(token: string, final: { jobId: string; workstreamId: string; versionId: string }) {
    const created = await runtime.query<{ create_media_publication: string }>(
      'SELECT medialab_core.create_media_publication($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `publication-${crypto.randomUUID()}`, final.jobId, final.workstreamId, null, 'Synthetic publication', '{}']
    );
    await runtime.query('SELECT medialab_core.add_media_publication_item($1,$2,$3,$4,$5,$6,$7,$8)', [token, `item-${crypto.randomUUID()}`, created.rows[0].create_media_publication, final.versionId, 'PHOTOS', 'PRIMARY_GALLERY', 1, 'Synthetic placement']);
    await runtime.query('SELECT medialab_core.seal_media_publication($1,$2,$3,$4,$5)', [token, `seal-publication-${crypto.randomUUID()}`, created.rows[0].create_media_publication, 1, 'Synthetic freeze']);
    await runtime.query('SELECT medialab_core.activate_media_publication($1,$2,$3,$4,$5)', [token, `activate-${crypto.randomUUID()}`, created.rows[0].create_media_publication, 2, 'Synthetic activation']);
    return created.rows[0].create_media_publication;
  }

  const selection = (publicationId: string) => JSON.stringify([{ publication_id: publicationId, category_code: 'PHOTOS' }]);

  async function center(token: string, publicationId: string, days = 7, key = `center-${crypto.randomUUID()}`) {
    return (await runtime.query<{ create_temporary_download_center: string }>(
      'SELECT medialab_core.create_temporary_download_center($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)',
      [token, key, PROPERTY_HUB_ID, days, 'Synthetic stakeholder', selection(publicationId), 'Synthetic center creation', '{}']
    )).rows[0].create_temporary_download_center;
  }

  async function eligible(token: string, orderId = ORDER_FOUNDATION_ORDER_ID) {
    return (await runtime.query<{ record_delivery_financial_eligibility: string }>(
      'SELECT medialab_core.record_delivery_financial_eligibility($1,$2,$3,$4,$5,$6,$7::uuid,$8)',
      [token, `financial-${crypto.randomUUID()}`, orderId, 'ELIGIBLE', 'NONPRODUCTION_FIXTURE', 'P02_M15_A_FIXTURE_ELIGIBLE', null, 'Synthetic bounded eligibility']
    )).rows[0].record_delivery_financial_eligibility;
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER });
    runtime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await owner.connect(); await runtime.connect();
  });
  beforeEach(reset);
  afterAll(async () => { await runtime.end(); await owner.end(); await reset(); });

  it('preserves 0018 exact objects and permissions under the 0019 trusted gateway-writer boundary', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(22);
    expect(ledger.rows[17].filename).toBe('0018_temporary_download_center_external_sharing_foundation.sql');
    expect(ledger.rows[18].filename).toBe('0019_temporary_download_center_access_credential_gateway_foundation.sql');
    expect(ledger.rows[19].filename).toBe('0020_disposable_delivery_surface_local_fixture_foundation.sql');
    expect(ledger.rows[20].filename).toBe('0021_provider_neutral_file_backed_disposable_delivery_foundation.sql');
    expect((await owner.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'temporary_download_center.%' ORDER BY code")).rows.map(row => row.code)).toEqual([
      'temporary_download_center.activity.read', 'temporary_download_center.create', 'temporary_download_center.manage', 'temporary_download_center.read'
    ]);
    const tables = await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='medialab_core' AND tablename LIKE 'temporary_download_center%' ORDER BY tablename");
    expect(tables.rows.map(row => row.tablename)).toHaveLength(11);
    const observations = await owner.query("SELECT has_table_privilege($1,'medialab_core.temporary_download_center_access_observations','INSERT') i,has_table_privilege($1,'medialab_core.temporary_download_center_access_observations','UPDATE') u,has_table_privilege($1,'medialab_core.temporary_download_center_access_observations','DELETE') d", [RUNTIME]);
    expect(observations.rows[0]).toEqual({ i: false, u: false, d: false });
    const writers = await owner.query("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND proname LIKE 'temporary_download_center%' AND (proname LIKE '%observation%' OR proname LIKE '%writer%')");
    expect(writers.rows).toEqual([]);
    const publicAuthority = await owner.query(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND p.proname LIKE '%temporary_download_center%' AND has_function_privilege('public',p.oid,'EXECUTE')`);
    expect(publicAuthority.rows[0].n).toBe(0);
  });

  it('enforces 3/7/14-day expiry and creates a fixed exact immutable snapshot with actor-scoped idempotency', async () => {
    const token = await session();
    const final = await acceptedFinal(token, await job(token));
    const pub = await publication(token, final);
    for (const days of [3, 7, 14]) {
      const key = `stable-${days}`;
      const id = await center(token, pub, days, key);
      expect(await center(token, pub, days, key)).toBe(id);
      const record = (await owner.query('SELECT expiration_days,expires_at-created_at span FROM medialab_core.temporary_download_centers WHERE id=$1', [id])).rows[0];
      expect(record.expiration_days).toBe(days);
      expect(record.span.days).toBe(days);
    }
    await fail(center(token, pub, 4), /3, 7, or 14/);
    await fail(runtime.query('SELECT medialab_core.create_temporary_download_center($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)', [token, 'stable-7', PROPERTY_HUB_ID, 7, 'Different', selection(pub), 'Synthetic center creation', '{}']), /Idempotency key.*different request/i);
    const snapshot = await owner.query(`SELECT s.source_publication_id,i.source_publication_item_id,i.media_asset_version_id,i.category_code FROM medialab_core.temporary_download_center_selections s JOIN medialab_core.temporary_download_center_items i ON i.selection_id=s.id JOIN medialab_core.temporary_download_center_versions v ON v.id=s.version_id WHERE v.center_id=$1 ORDER BY i.materialized_ordinal`, [(await owner.query('SELECT id FROM medialab_core.temporary_download_centers ORDER BY created_at,id LIMIT 1')).rows[0].id]);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0]).toMatchObject({ source_publication_id: pub, media_asset_version_id: final.versionId, category_code: 'PHOTOS' });
    await fail(owner.query('UPDATE medialab_core.temporary_download_center_items SET materialized_ordinal=2'), /immutable append-only/);
  });

  it('updates selections as a new immutable version without extending expiry, rejects stale generation, and never auto-adds later media', async () => {
    const token = await session();
    const firstFinal = await acceptedFinal(token, await job(token));
    const firstPublication = await publication(token, firstFinal);
    const id = await center(token, firstPublication);
    const before = (await owner.query('SELECT expires_at,current_version_id FROM medialab_core.temporary_download_centers c JOIN medialab_core.temporary_download_center_current x ON x.center_id=c.id WHERE c.id=$1', [id])).rows[0];
    const secondFinal = await acceptedFinal(token, await job(token));
    const secondPublication = await publication(token, secondFinal);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.temporary_download_center_items WHERE center_id=$1', [id])).rows[0].n).toBe(1);
    await runtime.query('SELECT medialab_core.update_temporary_download_center_selection($1,$2,$3,$4,$5::jsonb,$6)', [token, 'update-selection', id, 0, selection(secondPublication), 'Synthetic immutable update']);
    const after = (await owner.query('SELECT c.expires_at,x.current_version_id,x.generation FROM medialab_core.temporary_download_centers c JOIN medialab_core.temporary_download_center_current x ON x.center_id=c.id WHERE c.id=$1', [id])).rows[0];
    expect(after.expires_at.toISOString()).toBe(before.expires_at.toISOString());
    expect(after.current_version_id).not.toBe(before.current_version_id);
    expect(after.generation).toBe('1');
    expect((await owner.query('SELECT version_number,count(*) OVER()::int n FROM medialab_core.temporary_download_center_versions WHERE center_id=$1 ORDER BY version_number', [id])).rows).toEqual([{ version_number: 1, n: 2 }, { version_number: 2, n: 2 }]);
    expect((await owner.query('SELECT source_publication_id,media_asset_version_id FROM medialab_core.temporary_download_center_items WHERE version_id=$1', [before.current_version_id])).rows[0]).toEqual({ source_publication_id: firstPublication, media_asset_version_id: firstFinal.versionId });
    await fail(runtime.query('SELECT medialab_core.update_temporary_download_center_selection($1,$2,$3,$4,$5::jsonb,$6)', [token, 'stale', id, 0, selection(firstPublication), 'Stale update']), /current active unexpired generation/);
  });

  it('replaces with a new identity and expiry, preserves the old center, and permits creator or scoped Organization Admin revocation/activity read only', async () => {
    const token = await session(); const admin = await session(ADMIN);
    const final = await acceptedFinal(token, await job(token)); const pub = await publication(token, final);
    const oldId = await center(token, pub, 3);
    const replacement = (await runtime.query<{ replace_temporary_download_center: string }>('SELECT medialab_core.replace_temporary_download_center($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)', [token, 'replace', oldId, 0, 14, 'Replacement stakeholder', selection(pub), 'Synthetic replacement', '{}'])).rows[0].replace_temporary_download_center;
    expect(replacement).not.toBe(oldId);
    expect((await owner.query('SELECT id,replaces_center_id,expiration_days FROM medialab_core.temporary_download_centers WHERE id=$1', [replacement])).rows[0]).toEqual({ id: replacement, replaces_center_id: oldId, expiration_days: 14 });
    expect((await owner.query('SELECT lifecycle_state,replacement_center_id FROM medialab_core.temporary_download_center_current WHERE center_id=$1', [oldId])).rows[0]).toEqual({ lifecycle_state: 'REPLACED', replacement_center_id: replacement });
    await owner.query("INSERT INTO medialab_core.membership_permission_sets(organization_id,membership_id,permission_set_id) VALUES($1,'d614e5c7-9d65-54da-8e08-2562ae2f1f48','a2f7dc02-5f3b-5763-aa57-eeb3474b1af4')", [ORGANIZATION_FIXTURE.id]);
    expect((await runtime.query<{ get_temporary_download_center_activity: any }>('SELECT medialab_core.get_temporary_download_center_activity($1,$2)', [admin, replacement])).rows[0].get_temporary_download_center_activity.observations).toEqual([]);
    await runtime.query('SELECT medialab_core.revoke_temporary_download_center($1,$2,$3,$4,$5)', [admin, 'admin-revoke', replacement, 0, 'Synthetic admin revocation']);
    expect((await owner.query('SELECT lifecycle_state FROM medialab_core.temporary_download_center_current WHERE center_id=$1', [replacement])).rows[0].lifecycle_state).toBe('REVOKED');
    await fail(runtime.query('SELECT medialab_core.update_temporary_download_center_selection($1,$2,$3,$4,$5::jsonb,$6)', [admin, 'admin-update', oldId, 1, selection(pub), 'Admin may not update']), /Only the currently authorized center creator/);
  });

  it('re-evaluates PAY_NOW evidence, publication state, creator authority, replacement, revocation, and expiry without creating permanent download rights', async () => {
    const token = await session(); const final = await acceptedFinal(token, await job(token)); const pub = await publication(token, final); const id = await center(token, pub);
    let policy = (await runtime.query<{ evaluate_temporary_download_center_policy: any }>('SELECT medialab_core.evaluate_temporary_download_center_policy($1,$2)', [token, id])).rows[0].evaluate_temporary_download_center_policy;
    expect(policy).toMatchObject({ policy_decision: 'POLICY_LOCKED', reason_code: 'SOURCE_FINANCIAL_GATE_LOCKED' });
    await eligible(token);
    policy = (await runtime.query<{ evaluate_temporary_download_center_policy: any }>('SELECT medialab_core.evaluate_temporary_download_center_policy($1,$2)', [token, id])).rows[0].evaluate_temporary_download_center_policy;
    expect(policy).toMatchObject({ policy_decision: 'POLICY_ELIGIBLE', reason_code: 'CURRENT_POLICY_ELIGIBLE' });
    expect(Object.keys(policy)).not.toEqual(expect.arrayContaining(['token', 'url', 'credential', 'download_url']));
    await runtime.query('SELECT medialab_core.revoke_media_publication($1,$2,$3,$4,$5)', [token, `revoke-pub-${crypto.randomUUID()}`, pub, 3, 'Synthetic publication revocation']);
    expect((await runtime.query<{ evaluate_temporary_download_center_policy: any }>('SELECT medialab_core.evaluate_temporary_download_center_policy($1,$2)', [token, id])).rows[0].evaluate_temporary_download_center_policy.reason_code).toBe('SOURCE_PUBLICATION_LOCKED');
    const expiredId = crypto.randomUUID(); const expiredVersion = crypto.randomUUID();
    const expiredCreatedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); const expiredAt = new Date(expiredCreatedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    await owner.query(`INSERT INTO medialab_core.temporary_download_centers(id,organization_id,property_hub_id,created_by_identity_id,expiration_days,context,created_at,expires_at) VALUES($1,$2,$3,$4,14,'{}',$5,$6)`, [expiredId, ORGANIZATION_FIXTURE.id, PROPERTY_HUB_ID, ACTOR, expiredCreatedAt, expiredAt]);
    await owner.query(`INSERT INTO medialab_core.temporary_download_center_versions(id,center_id,organization_id,property_hub_id,version_number,selection_sha256,reason,created_by_identity_id,created_at) VALUES($1,$2,$3,$4,1,$5,'Synthetic expired policy evidence',$6,$7)`, [expiredVersion, expiredId, ORGANIZATION_FIXTURE.id, PROPERTY_HUB_ID, '0'.repeat(64), ACTOR, expiredCreatedAt]);
    await owner.query(`INSERT INTO medialab_core.temporary_download_center_current(center_id,current_version_id,lifecycle_state,generation,updated_at) VALUES($1,$2,'ACTIVE',0,$3)`, [expiredId, expiredVersion, expiredCreatedAt]);
    expect((await runtime.query<{ evaluate_temporary_download_center_policy: any }>('SELECT medialab_core.evaluate_temporary_download_center_policy($1,$2)', [token, expiredId])).rows[0].evaluate_temporary_download_center_policy).toMatchObject({ effective_state: 'EXPIRED', policy_decision: 'POLICY_LOCKED', reason_code: 'CENTER_EXPIRED' });
    expect((await owner.query('SELECT lifecycle_state FROM medialab_core.temporary_download_center_current WHERE center_id=$1', [expiredId])).rows[0].lifecycle_state).toBe('ACTIVE');
    const admin = await session(ADMIN);
    await runtime.query('SELECT medialab_core.transition_account_lifecycle($1,$2,$3,$4,$5,$6,$7)', [crypto.randomUUID(), admin, PEOPLE_FIXTURES[1].id, ACTOR, 'SUSPENDED', 'Synthetic creator-authority reevaluation', false]);
    await owner.query("INSERT INTO medialab_core.membership_permission_sets(organization_id,membership_id,permission_set_id) VALUES($1,'d614e5c7-9d65-54da-8e08-2562ae2f1f48','a2f7dc02-5f3b-5763-aa57-eeb3474b1af4')", [ORGANIZATION_FIXTURE.id]);
    expect((await runtime.query<{ evaluate_temporary_download_center_policy: any }>('SELECT medialab_core.evaluate_temporary_download_center_policy($1,$2)', [admin, id])).rows[0].evaluate_temporary_download_center_policy.reason_code).toBe('CREATOR_AUTHORITY_LOCKED');
  });

  it('supports APPROVED_TERMS distinctly and proves one locked source Order locks a multi-order center', async () => {
    const token = await session();
    const order = (await runtime.query<{ create_order: string }>(
      `SELECT medialab_core.create_order($1,$2,'REAL_ESTATE',$3,$4,$5,'APPROVED_TERMS','USD',$6,'ORDER',$7,$8::jsonb,$9::jsonb,0,NULL,NULL,NULL,NULL)`,
      [token, `terms-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_PROPERTY_ID, ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID, ORDER_FOUNDATION_SOURCE, `terms-${crypto.randomUUID()}`, JSON.stringify([
        { role: 'ORDERING_PERSON', person_id: PEOPLE_FIXTURES[1].id }, { role: 'CUSTOMER', person_id: PEOPLE_FIXTURES[0].id },
        { role: 'BILLING_PARTY', person_id: PEOPLE_FIXTURES[0].id }, { role: 'COMMERCIAL_OWNER', person_id: PEOPLE_FIXTURES[1].id },
        { role: 'ORGANIZATION', organization_id: ORGANIZATION_FIXTURE.id }, { role: 'AUTHORIZED_ACTOR', person_id: PEOPLE_FIXTURES[1].id }
      ]), JSON.stringify([{ position: 1, commercial_snapshot_id: COMMERCIAL_SNAPSHOT_FIXTURES[1].id }])]
    )).rows[0].create_order;
    await owner.query('INSERT INTO medialab_core.property_hub_orders(property_hub_id,organization_id,property_id,order_id,associated_by_identity_id) VALUES($1,$2,$3,$4,$5)', [PROPERTY_HUB_ID, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_PROPERTY_ID, order, ACTOR]);
    const item = (await owner.query('SELECT id FROM medialab_core.order_items WHERE order_id=$1', [order])).rows[0].id;
    const termsPublication = await publication(token, await acceptedFinal(token, await job(token, order, item)));
    const termsCenter = await center(token, termsPublication);
    expect((await runtime.query<{ evaluate_temporary_download_center_policy: any }>('SELECT medialab_core.evaluate_temporary_download_center_policy($1,$2)', [token, termsCenter])).rows[0].evaluate_temporary_download_center_policy.policy_decision).toBe('POLICY_ELIGIBLE');
    const payNowPublication = await publication(token, await acceptedFinal(token, await job(token)));
    await runtime.query('SELECT medialab_core.update_temporary_download_center_selection($1,$2,$3,$4,$5::jsonb,$6)', [token, 'multi-order', termsCenter, 0, JSON.stringify([{ publication_id: termsPublication, category_code: 'PHOTOS' }, { publication_id: payNowPublication, category_code: 'PHOTOS' }]), 'Synthetic multi-order selection']);
    expect((await runtime.query<{ evaluate_temporary_download_center_policy: any }>('SELECT medialab_core.evaluate_temporary_download_center_policy($1,$2)', [token, termsCenter])).rows[0].evaluate_temporary_download_center_policy.reason_code).toBe('SOURCE_FINANCIAL_GATE_LOCKED');
  });

  it('preserves owner-role synthetic activity evidence, rejects runtime writes and mutation, and sanitizes dangerous evidence', async () => {
    const token = await session(); const final = await acceptedFinal(token, await job(token)); const pub = await publication(token, final); const id = await center(token, pub);
    const snapshot = (await owner.query('SELECT x.current_version_id,i.id item_id FROM medialab_core.temporary_download_center_current x JOIN medialab_core.temporary_download_center_items i ON i.version_id=x.current_version_id WHERE x.center_id=$1', [id])).rows[0];
    await owner.query(`INSERT INTO medialab_core.temporary_download_center_access_observations(id,center_id,version_id,item_id,event_kind,observed_outcome,reason_code,access_event_reference,evidence,observed_at) VALUES($1,$2,$3,NULL,'OPEN','ALLOW','POLICY_ELIGIBLE',$4,$5::jsonb,clock_timestamp()),($6,$2,$3,$7,'DOWNLOAD','DENY','POLICY_LOCKED',$8,$9::jsonb,clock_timestamp())`, [crypto.randomUUID(), id, snapshot.current_version_id, `OPEN:${crypto.randomUUID().toUpperCase()}`, '{}', crypto.randomUUID(), snapshot.item_id, `DOWNLOAD:${crypto.randomUUID().toUpperCase()}`, '{}']);
    const activity = (await runtime.query<{ get_temporary_download_center_activity: any }>('SELECT medialab_core.get_temporary_download_center_activity($1,$2)', [token, id])).rows[0].get_temporary_download_center_activity;
    expect(activity.observations.map((row: any) => row.event_kind).sort()).toEqual(['DOWNLOAD', 'OPEN']);
    await fail(runtime.query("INSERT INTO medialab_core.temporary_download_center_access_observations(id,center_id,version_id,event_kind,observed_outcome,reason_code,access_event_reference,observed_at) VALUES($1,$2,$3,'OPEN','ALLOW','POLICY_ELIGIBLE',$4,clock_timestamp())", [crypto.randomUUID(), id, snapshot.current_version_id, `OPEN:${crypto.randomUUID().toUpperCase()}`]), /permission denied/);
    await fail(owner.query('DELETE FROM medialab_core.temporary_download_center_access_observations'), /immutable append-only/);
    await fail(runtime.query('SELECT medialab_core.create_temporary_download_center($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)', [token, 'unsafe', PROPERTY_HUB_ID, 7, 'https://example.invalid/token', selection(pub), 'Unsafe bearer credential', '{"provider_payload":"data:base64"}']), /prohibited|Bounded/);
  });
});
