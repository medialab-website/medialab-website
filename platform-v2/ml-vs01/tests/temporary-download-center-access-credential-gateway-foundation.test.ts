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
import { TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL_GATEWAY_FIXTURE_POLICY } from '../db/fixtures/temporary-download-center-access-credential-gateway-fixtures.js';
import { buildDisposableDeliveryApp } from '../src/disposable-delivery/app.js';
import { createDisposableDeliveryDatabase } from '../src/disposable-delivery/database.js';
import { createSyntheticFixtureDownload } from '../src/disposable-delivery/fixture-download.js';

const TEST_DB = 'medialab_p02m15c_test';
const OWNER = 'medialab_p02m15c_test_owner';
const RUNTIME = 'medialab_p02m15c_test_app';
const SOCKET = '/tmp/mlvs01-p02m15c-pg';
const PORT = 55444;
const ACTOR = IDENTITY_FIXTURES[1].id;
const ADMIN = IDENTITY_FIXTURES[0].id;
const SOURCE = 'SYNTHETIC_P02_M15_B_TEST';
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

describe('P02-M15-C Temporary Download Center access credential and gateway foundation', () => {
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

  async function center(token: string, publicationId: string, days = 7) {
    return (await runtime.query<{ create_temporary_download_center: string }>(
      'SELECT medialab_core.create_temporary_download_center($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)',
      [token, `center-${crypto.randomUUID()}`, PROPERTY_HUB_ID, days, 'Synthetic stakeholder', selection(publicationId), 'Synthetic center creation', '{}']
    )).rows[0].create_temporary_download_center;
  }

  async function eligible(token: string, orderId = ORDER_FOUNDATION_ORDER_ID) {
    return (await runtime.query<{ record_delivery_financial_eligibility: string }>(
      'SELECT medialab_core.record_delivery_financial_eligibility($1,$2,$3,$4,$5,$6,$7::uuid,$8)',
      [token, `financial-${crypto.randomUUID()}`, orderId, 'ELIGIBLE', 'NONPRODUCTION_FIXTURE', 'P02_M15_B_FIXTURE_ELIGIBLE', null, 'Synthetic bounded eligibility']
    )).rows[0].record_delivery_financial_eligibility;
  }

  async function issue(token: string, centerId: string, key = `issue-${crypto.randomUUID()}`) {
    return (await runtime.query<{ issue_temporary_download_center_access_credential: any }>(
      'SELECT medialab_core.issue_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)',
      [token, key, centerId, 0, 'Synthetic access issue', '{}']
    )).rows[0].issue_temporary_download_center_access_credential;
  }

  async function gateway(credentialId: string, secret: string, kind: 'OPEN' | 'DOWNLOAD', reference: string, itemId: string | null = null, evidence: Record<string, unknown> = {}) {
    return (await runtime.query<{ evaluate_temporary_download_center_gateway_access: any }>(
      'SELECT medialab_core.evaluate_temporary_download_center_gateway_access($1,$2,$3,$4,$5,$6::jsonb)',
      [credentialId, secret, kind, reference, itemId, JSON.stringify(evidence)]
    )).rows[0].evaluate_temporary_download_center_gateway_access;
  }

  async function ready(financiallyEligible = true, issueKey?: string) {
    const token = await session();
    const pub = await publication(token, await acceptedFinal(token, await job(token)));
    const centerId = await center(token, pub);
    if (financiallyEligible) await eligible(token);
    const issued = await issue(token, centerId, issueKey);
    const item = (await owner.query('SELECT i.id,i.version_id FROM medialab_core.temporary_download_center_current c JOIN medialab_core.temporary_download_center_items i ON i.version_id=c.current_version_id WHERE c.center_id=$1', [centerId])).rows[0];
    return { token, pub, centerId, issued, item };
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER });
    runtime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await owner.connect(); await runtime.connect();
  });
  beforeEach(reset);
  afterAll(async () => { await runtime.end(); await owner.end(); await reset(); });

  it('applies 0019 with exact controlled objects, strong one-time secret issuance, and no durable or read-path secret exposure', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(20);
    expect(ledger.rows[18].filename).toBe('0019_temporary_download_center_access_credential_gateway_foundation.sql');
    expect(ledger.rows[19].filename).toBe('0020_disposable_delivery_surface_local_fixture_foundation.sql');
    expect(TEMPORARY_DOWNLOAD_CENTER_ACCESS_CREDENTIAL_GATEWAY_FIXTURE_POLICY).toMatchObject({ verifierAlgorithm: 'SHA256-HEX-V1', usableSecretBytes: 32 });
    const state = await ready(true, 'one-time-stable');
    expect(state.issued.access_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(state.issued.secret_returned).toBe(true);
    const stored = (await owner.query('SELECT * FROM medialab_core.temporary_download_center_access_credentials WHERE id=$1', [state.issued.credential_id])).rows[0];
    expect(stored.verifier_sha256).toBe(digest(state.issued.access_secret));
    expect(JSON.stringify(stored)).not.toContain(state.issued.access_secret);
    const replay = await issue(state.token, state.centerId, 'one-time-stable');
    expect(replay).toMatchObject({ credential_id: state.issued.credential_id, access_secret: null, secret_returned: false, replayed: true });
    const history = (await runtime.query<{ get_temporary_download_center_access_credential_history: any }>('SELECT medialab_core.get_temporary_download_center_access_credential_history($1,$2)', [state.token, state.centerId])).rows[0].get_temporary_download_center_access_credential_history;
    expect(JSON.stringify(history)).not.toMatch(/verifier_sha256|request_sha256|access_secret/);
    expect(JSON.stringify(history)).not.toContain(state.issued.access_secret);
  });

  it('uses generic deny behavior, writes bounded allow/deny observations, and enforces idempotent/conflicting retry law', async () => {
    const state = await ready();
    const allowRef = `OPEN:${crypto.randomUUID().toUpperCase()}`;
    const allowed = await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', allowRef, null, { attempt: 'synthetic' });
    expect(allowed).toMatchObject({ decision: 'ALLOW', reason_code: 'GATEWAY_ALLOWED', center_id: state.centerId, replayed: false });
    expect(Object.keys(allowed).sort()).toEqual(['access_event_reference','center_id','current_version_id','decision','item_id','reason_code','replayed'].sort());
    expect(JSON.stringify(allowed)).not.toMatch(/https?:|file:|path|provider|bytes|secret|signed/i);
    const replayed = await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', allowRef, null, { attempt: 'synthetic' });
    expect(replayed).toMatchObject({ decision: 'ALLOW', replayed: true });
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.temporary_download_center_access_observations WHERE access_event_reference=$1', [allowRef])).rows[0].n).toBe(1);
    await fail(gateway(state.issued.credential_id, '0'.repeat(64), 'OPEN', allowRef, null, { attempt: 'synthetic' }), /Conflicting access-event replay/);

    const wrong = await gateway(state.issued.credential_id, '0'.repeat(64), 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`);
    const malformed = await gateway(state.issued.credential_id, 'malformed', 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`);
    const missing = await gateway(crypto.randomUUID(), '0'.repeat(64), 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`);
    for (const denied of [wrong, malformed, missing]) expect(denied).toMatchObject({ decision: 'DENY', reason_code: 'ACCESS_DENIED', center_id: null, current_version_id: null, item_id: null });
    expect((await owner.query("SELECT count(*)::int n FROM medialab_core.temporary_download_center_access_observations WHERE observed_outcome='DENY'")).rows[0].n).toBe(2);
    const durable = await owner.query(`SELECT concat_ws('|',
      COALESCE((SELECT string_agg(to_jsonb(c)::text,'|') FROM medialab_core.temporary_download_center_access_credentials c),''),
      COALESCE((SELECT string_agg(to_jsonb(e)::text,'|') FROM medialab_core.temporary_download_center_access_credential_events e),''),
      COALESCE((SELECT string_agg(to_jsonb(g)::text,'|') FROM medialab_core.temporary_download_center_gateway_evaluations g),''),
      COALESCE((SELECT string_agg(to_jsonb(o)::text,'|') FROM medialab_core.temporary_download_center_access_observations o),'')) evidence`);
    expect(durable.rows[0].evidence).not.toContain(state.issued.access_secret);
  });

  it('rotates sequentially without extending center expiry, invalidates old access immediately, and permits creator/admin revocation without secret recovery', async () => {
    const state = await ready();
    const centerExpiry = (await owner.query('SELECT expires_at FROM medialab_core.temporary_download_centers WHERE id=$1', [state.centerId])).rows[0].expires_at.toISOString();
    const rotated = (await runtime.query<{ rotate_temporary_download_center_access_credential: any }>(
      'SELECT medialab_core.rotate_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)',
      [state.token, 'rotate-stable', state.centerId, 1, 'Synthetic access rotation', '{}']
    )).rows[0].rotate_temporary_download_center_access_credential;
    expect(rotated).toMatchObject({ generation: 2, secret_returned: true, replayed: false });
    expect(rotated.access_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.access_secret).not.toBe(state.issued.access_secret);
    expect(new Date(rotated.expires_at).toISOString()).toBe(centerExpiry);
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');
    expect((await gateway(rotated.credential_id, rotated.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('ALLOW');
    const replay = (await runtime.query<{ rotate_temporary_download_center_access_credential: any }>('SELECT medialab_core.rotate_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)', [state.token, 'rotate-stable', state.centerId, 1, 'Synthetic access rotation', '{}'])).rows[0].rotate_temporary_download_center_access_credential;
    expect(replay).toMatchObject({ credential_id: rotated.credential_id, access_secret: null, secret_returned: false, replayed: true });
    await fail(runtime.query('SELECT medialab_core.rotate_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)', [state.token, 'rotate-stale', state.centerId, 1, 'Synthetic stale rotation', '{}']), /current active unexpired credential generation/);

    const admin = await session(ADMIN);
    await owner.query("INSERT INTO medialab_core.membership_permission_sets(organization_id,membership_id,permission_set_id) VALUES($1,'d614e5c7-9d65-54da-8e08-2562ae2f1f48','a2f7dc02-5f3b-5763-aa57-eeb3474b1af4')", [ORGANIZATION_FIXTURE.id]);
    await runtime.query('SELECT medialab_core.revoke_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)', [admin, 'admin-revoke-access', state.centerId, 2, 'Synthetic admin revocation', '{}']);
    expect((await gateway(rotated.credential_id, rotated.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');
    const history = (await runtime.query<{ get_temporary_download_center_access_credential_history: any }>('SELECT medialab_core.get_temporary_download_center_access_credential_history($1,$2)', [admin, state.centerId])).rows[0].get_temporary_download_center_access_credential_history;
    expect(history.events.map((event: any) => event.event_type)).toEqual(['ISSUED','ROTATED','REVOKED']);
    expect(JSON.stringify(history)).not.toMatch(/verifier_sha256|access_secret/);
  });

  it('reuses current M15-A policy for PAY_NOW, publication state, creator authority, and safe generic gateway denial', async () => {
    const state = await ready(false);
    const financialRef = `OPEN:${crypto.randomUUID().toUpperCase()}`;
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', financialRef)).decision).toBe('DENY');
    await eligible(state.token);
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('ALLOW');
    await runtime.query('SELECT medialab_core.revoke_media_publication($1,$2,$3,$4,$5)', [state.token, `revoke-pub-${crypto.randomUUID()}`, state.pub, 3, 'Synthetic publication revocation']);
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');
    const admin = await session(ADMIN);
    await runtime.query('SELECT medialab_core.transition_account_lifecycle($1,$2,$3,$4,$5,$6,$7)', [crypto.randomUUID(), admin, PEOPLE_FIXTURES[1].id, ACTOR, 'SUSPENDED', 'Synthetic creator authority reevaluation', false]);
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');
    const internalReasons = (await owner.query('SELECT reason_code FROM medialab_core.temporary_download_center_gateway_evaluations WHERE center_id=$1 ORDER BY evaluated_at', [state.centerId])).rows.map(row => row.reason_code);
    expect(internalReasons).toContain('SOURCE_FINANCIAL_GATE_LOCKED');
    expect(internalReasons).toContain('SOURCE_PUBLICATION_LOCKED');
    expect(internalReasons).toContain('CREATOR_AUTHORITY_LOCKED');
  });

  it('denies replaced, revoked, center-expired, and credential-expired access without reviving immutable evidence', async () => {
    const state = await ready();
    await runtime.query('SELECT medialab_core.replace_temporary_download_center($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)', [state.token, 'replace-for-gateway', state.centerId, 0, 7, 'Replacement stakeholder', selection(state.pub), 'Synthetic replacement', '{}']);
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');

    const revokedCenter = await center(state.token, state.pub);
    const revokedIssue = await issue(state.token, revokedCenter);
    await runtime.query('SELECT medialab_core.revoke_temporary_download_center($1,$2,$3,$4,$5)', [state.token, 'revoke-center-gateway', revokedCenter, 0, 'Synthetic center revocation']);
    expect((await gateway(revokedIssue.credential_id, revokedIssue.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');

    const expiringCenter = await center(state.token, state.pub);
    const centerRow = (await owner.query('SELECT * FROM medialab_core.temporary_download_centers WHERE id=$1', [expiringCenter])).rows[0];
    const expiredSecret = crypto.randomBytes(32).toString('hex');
    const expiredCredential = crypto.randomUUID();
    const issuedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await owner.query(`INSERT INTO medialab_core.temporary_download_center_access_credentials(id,center_id,organization_id,property_hub_id,credential_generation,verifier_sha256,verifier_algorithm,issued_by_identity_id,issued_at,expires_at,reason,context) VALUES($1,$2,$3,$4,1,$5,'SHA256-HEX-V1',$6,$7,$8,'Synthetic expired access','{}')`, [expiredCredential, expiringCenter, centerRow.organization_id, centerRow.property_hub_id, digest(expiredSecret), ACTOR, issuedAt, expiredAt]);
    await owner.query(`INSERT INTO medialab_core.temporary_download_center_access_credential_events(id,credential_id,center_id,organization_id,property_hub_id,credential_generation,event_type,reason,evidence,recorded_by_identity_id,recorded_at) VALUES($1,$2,$3,$4,$5,1,'ISSUED','Synthetic expired access','{}',$6,$7)`, [crypto.randomUUID(), expiredCredential, expiringCenter, centerRow.organization_id, centerRow.property_hub_id, ACTOR, issuedAt]);
    await owner.query(`INSERT INTO medialab_core.temporary_download_center_access_credential_current(center_id,current_credential_id,current_generation,lifecycle_state,updated_at) VALUES($1,$2,1,'ACTIVE',$3)`, [expiringCenter, expiredCredential, issuedAt]);
    expect((await gateway(expiredCredential, expiredSecret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');
    expect((await owner.query('SELECT lifecycle_state FROM medialab_core.temporary_download_center_access_credential_current WHERE center_id=$1', [expiringCenter])).rows[0].lifecycle_state).toBe('ACTIVE');
  });

  it('requires an exact current-version item for DOWNLOAD and denies stale prior-version items after selection update', async () => {
    const state = await ready();
    const allowed = await gateway(state.issued.credential_id, state.issued.access_secret, 'DOWNLOAD', `DOWNLOAD:${crypto.randomUUID().toUpperCase()}`, state.item.id);
    expect(allowed).toMatchObject({ decision: 'ALLOW', item_id: state.item.id });
    expect(JSON.stringify(allowed)).not.toMatch(/url|path|provider|bytes|download_command|secret/i);
    const secondPublication = await publication(state.token, await acceptedFinal(state.token, await job(state.token)));
    await runtime.query('SELECT medialab_core.update_temporary_download_center_selection($1,$2,$3,$4,$5::jsonb,$6)', [state.token, 'gateway-selection-update', state.centerId, 0, selection(secondPublication), 'Synthetic selection update']);
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'DOWNLOAD', `DOWNLOAD:${crypto.randomUUID().toUpperCase()}`, state.item.id)).decision).toBe('DENY');
    const newItem = (await owner.query('SELECT i.id FROM medialab_core.temporary_download_center_current c JOIN medialab_core.temporary_download_center_items i ON i.version_id=c.current_version_id WHERE c.center_id=$1', [state.centerId])).rows[0].id;
    expect((await gateway(state.issued.credential_id, state.issued.access_secret, 'DOWNLOAD', `DOWNLOAD:${crypto.randomUUID().toUpperCase()}`, newItem)).decision).toBe('ALLOW');
    expect((await owner.query("SELECT count(*)::int n FROM medialab_core.temporary_download_center_gateway_evaluations WHERE center_id=$1 AND reason_code='ITEM_NOT_CURRENT'", [state.centerId])).rows[0].n).toBe(1);
  });

  it('preserves APPROVED_TERMS as a distinct policy pass and locks a multi-Order center when one PAY_NOW source is locked', async () => {
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
    const orderItem = (await owner.query('SELECT id FROM medialab_core.order_items WHERE order_id=$1', [order])).rows[0].id;
    const termsPublication = await publication(token, await acceptedFinal(token, await job(token, order, orderItem)));
    const termsCenter = await center(token, termsPublication);
    const termsIssue = await issue(token, termsCenter);
    expect((await gateway(termsIssue.credential_id, termsIssue.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('ALLOW');
    const payNowPublication = await publication(token, await acceptedFinal(token, await job(token)));
    await runtime.query('SELECT medialab_core.update_temporary_download_center_selection($1,$2,$3,$4,$5::jsonb,$6)', [token, 'gateway-multi-order', termsCenter, 0, JSON.stringify([{ publication_id: termsPublication, category_code: 'PHOTOS' }, { publication_id: payNowPublication, category_code: 'PHOTOS' }]), 'Synthetic multi Order selection']);
    expect((await gateway(termsIssue.credential_id, termsIssue.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`)).decision).toBe('DENY');
  });

  it('rejects evidence mutation, direct runtime DML, unsafe evidence, stale authority, and inappropriate PUBLIC execution', async () => {
    const state = await ready();
    await gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`);
    await fail(owner.query('UPDATE medialab_core.temporary_download_center_access_credentials SET reason=$1 WHERE id=$2', ['Mutated', state.issued.credential_id]), /immutable append-only/);
    await fail(owner.query('DELETE FROM medialab_core.temporary_download_center_gateway_evaluations'), /immutable append-only/);
    await fail(owner.query("UPDATE medialab_core.temporary_download_center_access_credential_current SET lifecycle_state='REVOKED' WHERE center_id=$1", [state.centerId]), /controlled packet functions/);
    await fail(runtime.query(`INSERT INTO medialab_core.temporary_download_center_gateway_evaluations(id,access_event_reference,request_sha256,event_kind,decision,reason_code) VALUES($1,$2,$3,'OPEN','DENY','ACCESS_DENIED')`, [crypto.randomUUID(), `OPEN:${crypto.randomUUID().toUpperCase()}`, '0'.repeat(64)]), /permission denied/);
    await fail(runtime.query('SELECT medialab_core.issue_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)', [state.token, 'unsafe-reason', state.centerId, 0, state.issued.access_secret, '{}']), /Bounded provider-neutral/);
    await fail(runtime.query('SELECT medialab_core.rotate_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)', [state.token, 'unsafe-context', state.centerId, 1, 'Synthetic rotation', JSON.stringify({ secret: state.issued.access_secret })]), /prohibited secrets/);
    await fail(gateway(state.issued.credential_id, state.issued.access_secret, 'OPEN', `OPEN:${crypto.randomUUID().toUpperCase()}`, null, { source_url: 'https://example.invalid/access' }), /prohibited secrets|URLs/);
    await fail(runtime.query('SELECT medialab_core.get_temporary_download_center_access_credential_history($1,$2)', [state.token, crypto.randomUUID()]), /missing or unavailable/);
    const direct = await owner.query(`SELECT c.relname,has_table_privilege($1,c.oid,'INSERT') i,has_table_privilege($1,c.oid,'UPDATE') u,has_table_privilege($1,c.oid,'DELETE') d FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='medialab_core' AND c.relname=ANY($2::text[]) ORDER BY c.relname`, [RUNTIME, ['temporary_download_center_access_credentials','temporary_download_center_access_credential_events','temporary_download_center_access_credential_current','temporary_download_center_gateway_evaluations','temporary_download_center_access_observations']]);
    expect(direct.rows.every(row => !row.i && !row.u && !row.d)).toBe(true);
    expect((await owner.query(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND p.proname LIKE '%temporary_download_center%' AND has_function_privilege('public',p.oid,'EXECUTE')`)).rows[0].n).toBe(0);
  });

  it('serves a loopback-only secretless shell and authorizes manifest and deterministic synthetic fixture download through fresh M15-B gateway evaluations', async () => {
    const state = await ready();
    const deliveryDatabase = createDisposableDeliveryDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    const app = buildDisposableDeliveryApp(deliveryDatabase);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const shell = await fetch(`${address}/d/${state.issued.credential_id}#${state.issued.access_secret}`, { redirect: 'error' });
      const shellText = await shell.text();
      expect(shell.status).toBe(200);
      expect(shellText).toContain('Temporary Download Center');
      expect(shellText).not.toContain(state.issued.access_secret);
      expect(shell.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(shell.headers.get('cache-control')).toContain('no-store');

      const script = await (await fetch(`${address}/assets/disposable-delivery.js`)).text();
      expect(script).toContain("location.hash.startsWith('#')");
      expect(script).toContain("history.replaceState(null, '', location.pathname)");
      expect(script).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\./);

      const openReference = `M15C.OPEN.${crypto.randomUUID().toUpperCase()}`;
      const openPayload = { credentialId: state.issued.credential_id, secret: state.issued.access_secret, accessEventReference: openReference };
      const open = await fetch(`${address}/api/disposable-delivery/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openPayload)
      });
      const manifest = await open.json() as any;
      expect(open.status).toBe(200);
      expect(manifest).toMatchObject({ status: 'AVAILABLE', stakeholderLabel: 'Synthetic stakeholder' });
      expect(manifest.categories).toHaveLength(1);
      expect(manifest.categories[0]).toMatchObject({ code: 'PHOTOS', label: 'Photos' });
      expect(manifest.categories[0].items[0].id).toBe(state.item.id);
      expect(JSON.stringify(manifest)).not.toMatch(/secret|verifier|organization|property_hub|source_order|media_asset|https?:|file:|provider|path|bytes/i);

      const replay = await fetch(`${address}/api/disposable-delivery/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(openPayload)
      });
      expect(replay.status).toBe(200);
      expect((await owner.query('SELECT count(*)::int n FROM medialab_core.temporary_download_center_access_observations WHERE access_event_reference=$1', [openReference])).rows[0].n).toBe(1);

      const downloadReference = `M15C.DOWNLOAD.${crypto.randomUUID().toUpperCase()}`;
      const download = await fetch(`${address}/api/disposable-delivery/download`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...openPayload, itemId: state.item.id, accessEventReference: downloadReference })
      });
      const expectedFixture = createSyntheticFixtureDownload(state.item.id);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toContain('application/octet-stream');
      expect(download.headers.get('x-content-sha256')).toBe(expectedFixture.sha256);
      expect(Buffer.from(await download.arrayBuffer()).equals(expectedFixture.bytes)).toBe(true);

      const wrongSecret = await fetch(`${address}/api/disposable-delivery/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...openPayload, secret: '0'.repeat(64), accessEventReference: `M15C.OPEN.${crypto.randomUUID().toUpperCase()}` })
      });
      expect(wrongSecret.status).toBe(404);
      expect(await wrongSecret.json()).toEqual({ status: 'UNAVAILABLE' });
      expect((await owner.query('SELECT count(*)::int n FROM medialab_core.temporary_download_center_access_observations WHERE access_event_reference=$1', [downloadReference])).rows[0].n).toBe(1);
    } finally {
      await app.close();
    }
  });
});
