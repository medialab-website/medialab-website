import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m16a_test';
const OWNER = 'medialab_p02m16a_test_owner';
const RUNTIME = 'medialab_p02m16a_test_app';
const SOCKET = '/tmp/mlvs01-p02m16a-pg';
const PORT = 55447;
const ACTOR = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M22_A_TEST';
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

interface JobScope { jobId: string; workstreamId: string }
interface ReviewScenario {
  token: string;
  job: JobScope;
  handoffId: string;
  assetId: string;
  originalVersionId: string;
  returnedVersionId: string;
  returnedChecksum: string;
  returnedObjectIdentifier: string;
  reviewBatchId: string;
  reviewItemId: string;
  quickEditRequestId: string;
  reviewGeneration: number;
  decisionGeneration: number;
}

interface UploadIntentResult {
  uploadIntentId: string;
  requestId: string;
  state: string;
  generation: number;
  replayed: boolean;
}

interface RegistrationResult {
  uploadIntentId: string;
  requestId: string;
  correctedVersionId: string;
  providerObjectIdentifier: string;
  successorReviewBatchId: string;
  successorReviewItemId: string;
  successorDecisionId: string;
  successorCompletionEventId: string;
  finalSourceVersionId: string;
  replayed: boolean;
}

describe('P02-M22-A contextual Editor Review and mobile Quick Edit database bridge', () => {
  let owner: pg.Client;
  let runtime: pg.Client;
  const reset = () => resetTestDatabase({
    host: SOCKET, port: PORT, database: TEST_DB, user: OWNER, runtimeUser: RUNTIME, confirm: TEST_DB,
  });

  async function fail(promise: Promise<unknown>, expected?: RegExp) {
    try {
      await promise;
      throw new Error('Expected failure');
    } catch (error: any) {
      if (error.message === 'Expected failure') throw error;
      if (expected) expect(error.message).toMatch(expected);
    }
  }

  async function session(identityId = ACTOR) {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
        (id,identity_id,token_sha256,issued_at,expires_at)
       VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
      [crypto.randomUUID(), identityId, digest(token)],
    );
    return token;
  }

  async function outsiderSession() {
    const personId = crypto.randomUUID();
    const identityId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO medialab_core.people(id,display_name,email)
       VALUES($1,'Outside Organization Reviewer',$2)`,
      [personId, `outside-${personId}@fixture.medialab.invalid`],
    );
    await owner.query(
      `INSERT INTO medialab_core.identities
        (id,person_id,provider,provider_subject,status,email_verified_at)
       VALUES($1,$2,'LOCAL_DEVELOPMENT',$3,'ACTIVE',clock_timestamp())`,
      [identityId, personId, `outside-${identityId}`],
    );
    return session(identityId);
  }

  async function job(token: string): Promise<JobScope> {
    const created = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE],
    );
    const workstream = await runtime.query<{ create_service_workstream: string }>(
      'SELECT medialab_core.create_service_workstream($1,$2,$3,$4,$5)',
      [token, `workstream-${crypto.randomUUID()}`, created.rows[0].create_job, ORDER_ITEM_FIXTURES[0].id, SOURCE],
    );
    return { jobId: created.rows[0].create_job, workstreamId: workstream.rows[0].create_service_workstream };
  }

  async function returnedPhoto(token: string, scope: JobScope, withVerification = true,
    unresolvedEvidence = false, photoCount = 1) {
    if (photoCount < 1 || (unresolvedEvidence && photoCount !== 1)) {
      throw new Error('Synthetic returned-photo setup requires one or more photos and only one for ambiguity');
    }
    const workspace = await runtime.query<{ create_cull_workspace: string }>(
      'SELECT medialab_core.create_cull_workspace($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `cull-${crypto.randomUUID()}`, scope.jobId, scope.workstreamId, 'PHOTO', 'Photo cull',
        'Synthetic Quick Edit cull', JSON.stringify({ source: SOURCE })],
    );
    const candidates: string[] = [];
    for (let index = 0; index < photoCount; index += 1) {
      const asset = await runtime.query<{ create_media_asset: string }>(
        'SELECT medialab_core.create_media_asset($1,$2,$3,$4,$5::jsonb)',
        [token, `asset-${crypto.randomUUID()}`, scope.jobId, scope.workstreamId, JSON.stringify({ source: SOURCE })],
      );
      const originalChecksum = digest(`original-${crypto.randomUUID()}`);
      const original = await runtime.query<{ add_media_asset_version: string }>(
        'SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [token, `original-${crypto.randomUUID()}`, asset.rows[0].create_media_asset, 'ORIGINAL',
          `capture-${index + 1}.dng`, 2400 + index, 'image/dng', originalChecksum, SOURCE],
      );
      const candidate = await runtime.query<{ admit_cull_candidate: string }>(
        'SELECT medialab_core.admit_cull_candidate($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb)',
        [token, `candidate-${crypto.randomUUID()}`, workspace.rows[0].create_cull_workspace,
          asset.rows[0].create_media_asset, original.rows[0].add_media_asset_version, [],
          JSON.stringify({ source: SOURCE })],
      );
      candidates.push(candidate.rows[0].admit_cull_candidate);
    }
    await runtime.query('SELECT medialab_core.seal_cull_inventory($1,$2,$3,$4)',
      [token, `seal-cull-${crypto.randomUUID()}`, workspace.rows[0].create_cull_workspace, 'Synthetic cull seal']);
    for (const [index, candidateId] of candidates.entries()) {
      await runtime.query(
        'SELECT medialab_core.decide_cull_candidate($1,$2,$3,$4,$5,$6,$7::uuid,$8::jsonb)',
        [token, `keep-${crypto.randomUUID()}`, candidateId, 'KEEP',
          'Synthetic selected photo', index, null, JSON.stringify({ source: SOURCE })],
      );
    }
    await runtime.query('SELECT medialab_core.finalize_cull_workspace($1,$2,$3,$4,$5,$6,$7)',
      [token, `complete-cull-${crypto.randomUUID()}`, workspace.rows[0].create_cull_workspace,
        'Synthetic cull completion', photoCount, false, null]);

    const handoff = await runtime.query<{ create_editor_handoff_batch: string }>(
      'SELECT medialab_core.create_editor_handoff_batch($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `handoff-${crypto.randomUUID()}`, workspace.rows[0].create_cull_workspace, 'EXTERNAL_EDITOR',
        'SYNTHETIC_EDITOR', 'Synthetic editor handoff', JSON.stringify({ source: SOURCE })],
    );
    await runtime.query('SELECT medialab_core.record_editor_handoff_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `dispatch-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch, 'DISPATCHED', 0,
        'Synthetic dispatch', JSON.stringify({ source: SOURCE })]);
    await runtime.query('SELECT medialab_core.record_editor_handoff_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `ack-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch, 'ACKNOWLEDGED', 1,
        'Synthetic acknowledgement', JSON.stringify({ source: SOURCE })]);
    const intake = await runtime.query<{ create_returned_media_intake_batch: string }>(
      'SELECT medialab_core.create_returned_media_intake_batch($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `intake-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch,
        `RETURN_${crypto.randomUUID()}`, 'Synthetic returned-media intake', JSON.stringify({ source: SOURCE })],
    );
    const handoffItems = (await owner.query<{
      id: string; media_asset_id: string; source_media_asset_version_id: string;
    }>(
      `SELECT id,media_asset_id,source_media_asset_version_id
         FROM medialab_core.editor_handoff_items WHERE handoff_batch_id=$1 ORDER BY ordinal,id`,
      [handoff.rows[0].create_editor_handoff_batch],
    )).rows;
    expect(handoffItems).toHaveLength(photoCount);
    if (unresolvedEvidence) {
      await runtime.query(
        `SELECT medialab_core.record_returned_media_item(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::jsonb
        )`,
        [token, `ambiguous-${crypto.randomUUID()}`, intake.rows[0].create_returned_media_intake_batch,
          'ambiguous-return.jpg', 1700, 'image/jpeg', digest(`ambiguous-${crypto.randomUUID()}`),
          'AMBIGUOUS', 'MULTIPLE_CANDIDATES', null, 0, 'Synthetic ambiguous editor return',
          JSON.stringify({ source: SOURCE })],
      );
    }
    const photos: Array<{
      assetId: string; originalVersionId: string; returnedVersionId: string;
      returnedChecksum: string; returnedObjectIdentifier: string;
    }> = [];
    for (const [index, handoffItem] of handoffItems.entries()) {
      const returnedChecksum = digest(`returned-${crypto.randomUUID()}`);
      const byteSize = 1800 + index;
      const returned = await runtime.query<{ record_returned_media_item: string }>(
        `SELECT medialab_core.record_returned_media_item(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::jsonb
        )`,
        [token, `returned-${crypto.randomUUID()}`, intake.rows[0].create_returned_media_intake_batch,
          index === 0 ? 'editor-return.jpg' : `editor-return-${index + 1}.jpg`,
          byteSize, 'image/jpeg', returnedChecksum, 'EXACT_MATCH', 'MANIFEST_REFERENCE',
          handoffItem.id, (unresolvedEvidence ? 1 : 0) + index,
          'Synthetic exact editor return', JSON.stringify({ source: SOURCE })],
      );
      const returnedVersionId = (await owner.query<{ returned_media_asset_version_id: string }>(
        `SELECT returned_media_asset_version_id FROM medialab_core.returned_media_item_current
          WHERE returned_item_id=$1`, [returned.rows[0].record_returned_media_item],
      )).rows[0].returned_media_asset_version_id;
      const returnedObjectIdentifier = `returned/${returnedVersionId}.jpg`;
      await runtime.query(
        'SELECT medialab_core.record_media_storage_object($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [token, `returned-storage-${crypto.randomUUID()}`, returnedVersionId, 'LOCAL_FIXTURE',
          'M22A_RETURNED_REVIEW', returnedObjectIdentifier, returnedChecksum, byteSize, 'image/jpeg', SOURCE],
      );
      if (withVerification) {
        await runtime.query(
          'SELECT medialab_core.record_media_verification_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
          [token, `returned-verification-${crypto.randomUUID()}`, returnedVersionId, 'SERVER_STREAM_SHA256',
            'VERIFIED', returnedChecksum, JSON.stringify({ source: SOURCE })],
        );
      }
      photos.push({
        assetId: handoffItem.media_asset_id,
        originalVersionId: handoffItem.source_media_asset_version_id,
        returnedVersionId,
        returnedChecksum,
        returnedObjectIdentifier,
      });
    }
    if (!unresolvedEvidence) {
      await runtime.query('SELECT medialab_core.complete_editor_handoff_returns($1,$2,$3,$4,$5)',
        [token, `complete-returns-${crypto.randomUUID()}`, handoff.rows[0].create_editor_handoff_batch, photoCount,
          'Synthetic returned inventory completion']);
    }
    return {
      handoffId: handoff.rows[0].create_editor_handoff_batch,
      ...photos[0]!,
      photos,
    };
  }

  async function quickEditScenario(): Promise<ReviewScenario> {
    const token = await session();
    const scope = await job(token);
    const returned = await returnedPhoto(token, scope);
    const started = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [token, `start-review-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    const reviewItemId = (await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_review_items WHERE review_batch_id=$1', [started.reviewBatchId],
    )).rows[0].id;
    await runtime.query(
      `SELECT medialab_core.submit_operations_editor_review(
        $1,$2,$3::uuid,$4::uuid,$5::bigint,$6::jsonb
      )`,
      [token, `quick-edit-submit-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID,
        started.reviewBatchId, 2, JSON.stringify([{
          reviewItemId, disposition: 'QUICK_EDIT', expectedGeneration: 0, currentDecisionId: null,
        }])],
    );
    const request = await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_quick_edit_requests WHERE review_item_id=$1',
      [reviewItemId],
    );
    return {
      token,
      job: scope,
      ...returned,
      reviewBatchId: started.reviewBatchId,
      reviewItemId,
      quickEditRequestId: request.rows[0].id,
      reviewGeneration: 3,
      decisionGeneration: 1,
    };
  }

  async function createIntent(scenario: ReviewScenario, key = `intent-${crypto.randomUUID()}`) {
    return runtime.query<{ create_operations_quick_edit_upload_intent: UploadIntentResult }>(
      `SELECT medialab_core.create_operations_quick_edit_upload_intent(
        $1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::bigint,$8::bigint
      )`,
      [scenario.token, key, ORDER_FOUNDATION_ORDER_ID, scenario.reviewBatchId, scenario.reviewItemId,
        scenario.quickEditRequestId, scenario.reviewGeneration, scenario.decisionGeneration],
    );
  }

  function registrationArguments(scenario: ReviewScenario, intentId: string, key: string,
    checksum = digest('corrected-photo')) {
    return [scenario.token, key, ORDER_FOUNDATION_ORDER_ID, scenario.reviewBatchId, scenario.reviewItemId,
      scenario.quickEditRequestId, intentId, scenario.reviewGeneration, scenario.decisionGeneration, 0,
      'quick-edit-correction.jpg', 1900, 'image/jpeg', checksum,
      `quick-edits/${intentId}.jpg`, 'Synthetic Quick Edit correction registration'];
  }

  const registrationSql = `SELECT medialab_core.register_operations_quick_edit_revision(
    $1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::bigint,$9::bigint,$10::bigint,
    $11,$12::bigint,$13,$14,$15,$16
  )`;

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER });
    runtime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await owner.connect();
    await runtime.connect();
  });
  beforeEach(reset);
  afterAll(async () => {
    await runtime.end();
    await owner.end();
    await reset();
  });

  it('installs only the exact runtime bridge authority with fixed search paths and no table DML', async () => {
    const ledger = await owner.query<{ filename: string }>(
      'SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename',
    );
    expect(ledger.rows[26]?.filename).toBe('0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql');
    expect(ledger.rows.at(-1)?.filename).toBe('0028_client_account_and_operator_contact_intake_foundation.sql');
    const signatures = [
      'medialab_core.start_operations_editor_review(text,text,uuid,text)',
      'medialab_core.list_operations_review_attention(text)',
      'medialab_core.get_operations_review_workspace(text,uuid)',
      'medialab_core.submit_operations_editor_review(text,text,uuid,uuid,bigint,jsonb)',
      'medialab_core.resolve_operations_review_media_source(text,uuid,uuid,uuid,text)',
      'medialab_core.create_operations_quick_edit_upload_intent(text,text,uuid,uuid,uuid,uuid,bigint,bigint)',
      'medialab_core.get_operations_quick_edit_upload_intent(text,uuid,uuid)',
      'medialab_core.register_operations_quick_edit_revision(text,text,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,bigint,text,text,text,text)',
    ];
    for (const signature of signatures) {
      const authority = await owner.query<{ runtime: boolean; public: boolean; config: string[] }>(
        `SELECT has_function_privilege($1,$2,'EXECUTE') runtime,
                has_function_privilege('public',$2,'EXECUTE') public,
                p.proconfig config
           FROM pg_proc p WHERE p.oid=$2::regprocedure`,
        [RUNTIME, signature],
      );
      expect(authority.rows[0].runtime).toBe(true);
      expect(authority.rows[0].public).toBe(false);
      expect(authority.rows[0].config).toContain('search_path=pg_catalog, medialab_core, pg_temp');
    }
    const helpers = await owner.query<{ runtime_count: number; public_count: number }>(
      `SELECT count(*) FILTER (WHERE has_function_privilege($1,p.oid,'EXECUTE'))::int runtime_count,
              count(*) FILTER (WHERE has_function_privilege('public',p.oid,'EXECUTE'))::int public_count
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='medialab_core' AND p.proname IN
          ('operations_review_version_summary','operations_review_actions','operations_review_batch_workspace')`,
      [RUNTIME],
    );
    expect(helpers.rows[0]).toEqual({ runtime_count: 0, public_count: 0 });
    const tableAuthority = await owner.query<{ any_privilege: boolean }>(
      `SELECT bool_or(has_table_privilege($1,format('medialab_core.%I',c.relname),'SELECT,INSERT,UPDATE,DELETE')) any_privilege
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='medialab_core' AND c.relname LIKE 'operations_quick_edit_upload_%'`,
      [RUNTIME],
    );
    expect(tableAuthority.rows[0].any_privilege).toBe(false);
    const nullableOperatorNotes = await owner.query<{
      table_name: string; column_name: string; is_nullable: string;
    }>(
      `SELECT table_name,column_name,is_nullable
         FROM information_schema.columns
        WHERE table_schema='medialab_core' AND column_name='reason'
          AND table_name IN (
            'returned_review_decisions','returned_revision_requests','returned_quick_edit_requests'
          )
        ORDER BY table_name`,
    );
    expect(nullableOperatorNotes.rows).toEqual([
      { table_name: 'returned_quick_edit_requests', column_name: 'reason', is_nullable: 'YES' },
      { table_name: 'returned_review_decisions', column_name: 'reason', is_nullable: 'YES' },
      { table_name: 'returned_revision_requests', column_name: 'reason', is_nullable: 'YES' },
    ]);
  });

  it('starts from exact completed returns and rejects missing or ambiguous evidence without duplicate concurrent review inventory', async () => {
    const emptyToken = await session();
    await job(emptyToken);
    await fail(runtime.query('SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4)',
      [emptyToken, `no-return-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO']),
    /No returned-media handoff/);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.returned_review_batches')).rows[0].n).toBe(0);

    const token = await session();
    const scope = await job(token);
    await returnedPhoto(token, scope, true, true);
    await fail(runtime.query('SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4)',
      [token, `ambiguous-return-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO']),
    /unresolved or ambiguous/);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.returned_review_batches')).rows[0].n).toBe(0);

    const cleanToken = await session();
    const cleanScope = await job(cleanToken);
    const clean = await returnedPhoto(cleanToken, cleanScope);
    const left = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    const right = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await left.connect();
    await right.connect();
    try {
      const [a, b] = await Promise.all([
        left.query<{ value: any }>(
          'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
          [cleanToken, `concurrent-start-a-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
        ),
        right.query<{ value: any }>(
          'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
          [cleanToken, `concurrent-start-b-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
        ),
      ]);
      const results = [a.rows[0].value, b.rows[0].value];
      expect(new Set(results.map((result) => result.reviewBatchId)).size).toBe(1);
      expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
      expect(results[0]).toMatchObject({ lane: 'PHOTO', itemCount: 1, lifecycleGeneration: 2 });
      const counts = await owner.query<{ batches: number; items: number; versions: number; final_designations: number }>(
        `SELECT
          (SELECT count(*)::int FROM medialab_core.returned_review_batches
            WHERE editor_handoff_batch_id=$1) batches,
          (SELECT count(*)::int FROM medialab_core.returned_review_items ri
            JOIN medialab_core.returned_review_batches rb ON rb.id=ri.review_batch_id
            WHERE rb.editor_handoff_batch_id=$1) items,
          (SELECT count(*)::int FROM medialab_core.returned_review_items
            WHERE review_media_asset_version_id=$2) versions,
          (SELECT count(*)::int FROM medialab_core.media_approved_source_designations) final_designations`,
        [clean.handoffId, clean.returnedVersionId],
      );
      expect(counts.rows[0]).toEqual({ batches: 1, items: 1, versions: 1, final_designations: 0 });
    } finally {
      await left.end();
      await right.end();
    }
  });

  it('records every review selection and completion without notes while keeping system audit evidence distinct', async () => {
    const token = await session();
    const scope = await job(token);
    await returnedPhoto(token, scope);
    const started = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [token, `start-note-free-review-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    const reviewItemId = (await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_review_items WHERE review_batch_id=$1',
      [started.reviewBatchId],
    )).rows[0].id;

    let currentDecisionId = (await runtime.query<{ decision_id: string }>(
      `SELECT medialab_core.record_returned_review_decision(
        $1,$2,$3::uuid,$4,$5::text,$6::text,$7::bigint
      ) decision_id`,
      [token, `note-free-reject-${crypto.randomUUID()}`, reviewItemId,
        'REJECT_REVISION', null, null, 0],
    )).rows[0].decision_id;
    const dispositions = ['QUICK_EDIT', 'SKIP_QUICK_EDIT', 'ACCEPT', 'USE_ORIGINAL'] as const;
    for (const [index, disposition] of dispositions.entries()) {
      currentDecisionId = (await runtime.query<{ decision_id: string }>(
        `SELECT medialab_core.supersede_returned_review_decision(
          $1,$2,$3::uuid,$4::uuid,$5,$6::text,$7::text,$8::bigint
        ) decision_id`,
        [token, `note-free-${disposition.toLowerCase()}-${crypto.randomUUID()}`, reviewItemId,
          currentDecisionId, disposition, null, null, index + 1],
      )).rows[0].decision_id;
    }
    await runtime.query(
      `SELECT medialab_core.complete_returned_review_batch(
        $1,$2,$3::uuid,$4::bigint,$5::text
      )`,
      [token, `complete-note-free-review-${crypto.randomUUID()}`, started.reviewBatchId, 2, null],
    );

    const evidence = await owner.query<{
      decisions: Array<{ disposition: string; reason: string | null; instructions: string | null }>;
      revision_request: { reason: string | null; instructions: string | null };
      quick_edit_request: { reason: string | null; instructions: string | null };
      designation_reasons: string[];
      completion_reason: string;
    }>(
      `SELECT
        (SELECT jsonb_agg(jsonb_build_object(
          'disposition',d.disposition,'reason',d.reason,'instructions',d.instructions
        ) ORDER BY d.decided_at,d.id)
           FROM medialab_core.returned_review_decisions d WHERE d.review_batch_id=$1) decisions,
        (SELECT jsonb_build_object('reason',r.reason,'instructions',r.instructions)
           FROM medialab_core.returned_revision_requests r WHERE r.review_item_id=$2) revision_request,
        (SELECT jsonb_build_object('reason',q.reason,'instructions',q.instructions)
           FROM medialab_core.returned_quick_edit_requests q WHERE q.review_item_id=$2) quick_edit_request,
        (SELECT jsonb_agg(s.reason ORDER BY s.designated_at,s.id)
           FROM medialab_core.media_approved_source_designations s
           JOIN medialab_core.returned_review_decisions d ON d.final_source_designation_id=s.id
          WHERE d.review_batch_id=$1) designation_reasons,
        (SELECT e.reason FROM medialab_core.returned_review_batch_events e
          WHERE e.review_batch_id=$1 AND e.event_type='COMPLETED') completion_reason`,
      [started.reviewBatchId, reviewItemId],
    );
    expect(evidence.rows[0]).toEqual({
      decisions: [
        { disposition: 'REJECT_REVISION', reason: null, instructions: null },
        { disposition: 'QUICK_EDIT', reason: null, instructions: null },
        { disposition: 'SKIP_QUICK_EDIT', reason: null, instructions: null },
        { disposition: 'ACCEPT', reason: null, instructions: null },
        { disposition: 'USE_ORIGINAL', reason: null, instructions: null },
      ],
      revision_request: { reason: null, instructions: null },
      quick_edit_request: { reason: null, instructions: null },
      designation_reasons: [
        'System evidence: returned review selected the reviewed version as final source.',
        'System evidence: returned review selected the immutable original as final source.',
      ],
      completion_reason: 'System evidence: returned review completed with every item resolved.',
    });
    const workspace = (await runtime.query<{ workspace: any }>(
      'SELECT medialab_core.get_operations_review_workspace($1,$2::uuid) workspace',
      [token, ORDER_FOUNDATION_ORDER_ID],
    )).rows[0].workspace;
    expect(workspace.completedHistory).toHaveLength(1);
    expect(workspace.completedHistory[0].decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ disposition: 'REJECT_REVISION', reason: null, instructions: null }),
      expect.objectContaining({ disposition: 'QUICK_EDIT', reason: null, instructions: null }),
      expect.objectContaining({ disposition: 'USE_ORIGINAL', reason: null, instructions: null }),
    ]));
    expect(JSON.stringify(workspace.completedHistory)).not.toMatch(/System evidence:/);
  });

  it('submits a complete mixed three-item review atomically with exact-set validation and rollback', async () => {
    const token = await session();
    const scope = await job(token);
    await returnedPhoto(token, scope, true, false, 3);
    const started = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [token, `start-atomic-review-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    expect(started).toMatchObject({ itemCount: 3, lifecycleGeneration: 4 });
    const reviewItemIds = (await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_review_items WHERE review_batch_id=$1 ORDER BY id',
      [started.reviewBatchId],
    )).rows.map(({ id }) => id);
    expect(reviewItemIds).toHaveLength(3);
    const decisions = [
      { reviewItemId: reviewItemIds[0]!, disposition: 'ACCEPT',
        expectedGeneration: 0, currentDecisionId: null },
      { reviewItemId: reviewItemIds[1]!, disposition: 'REJECT_REVISION',
        instructions: 'Restore the clean vertical window lines.', expectedGeneration: 0, currentDecisionId: null },
      { reviewItemId: reviewItemIds[2]!, disposition: 'QUICK_EDIT',
        instructions: 'Reduce the window reflection.', expectedGeneration: 0, currentDecisionId: null },
    ];
    const submitSql = `SELECT medialab_core.submit_operations_editor_review(
      $1,$2,$3::uuid,$4::uuid,$5::bigint,$6::jsonb
    ) value`;
    const submitArguments = (key: string, submittedDecisions: unknown,
      expectedGeneration: number | null = started.lifecycleGeneration,
      orderId = ORDER_FOUNDATION_ORDER_ID) => [
      token, key, orderId, started.reviewBatchId, expectedGeneration, JSON.stringify(submittedDecisions),
    ];

    await fail(runtime.query(submitSql,
      submitArguments(`missing-${crypto.randomUUID()}`, [])), /bounded nonempty decision array/);
    await fail(runtime.query(submitSql,
      submitArguments(`missing-one-${crypto.randomUUID()}`, decisions.slice(0, 2))),
    /every exact review item once/);
    await fail(runtime.query(submitSql,
      submitArguments(`duplicate-${crypto.randomUUID()}`, [decisions[0], decisions[0], decisions[2]])),
    /every exact review item once/);
    await fail(runtime.query(submitSql, submitArguments(`same-count-extra-${crypto.randomUUID()}`, [
      decisions[0], decisions[1], { ...decisions[2], reviewItemId: crypto.randomUUID() },
    ])),
    /extra or unavailable review item/);
    await fail(runtime.query(submitSql,
      submitArguments(`unknown-field-${crypto.randomUUID()}`, [
        { ...decisions[0], reason: null }, decisions[1], decisions[2],
      ])), /exact bounded decision fields/);
    await fail(runtime.query(submitSql,
      submitArguments(`null-batch-generation-${crypto.randomUUID()}`, decisions, null)),
    /Stale review batch generation/);
    await fail(runtime.query(submitSql,
      submitArguments(`null-item-generation-${crypto.randomUUID()}`, [
        decisions[0], { ...decisions[1], expectedGeneration: null }, decisions[2],
      ])), /field types are invalid/);
    await fail(runtime.query(submitSql,
      submitArguments(`stale-item-${crypto.randomUUID()}`, [
        decisions[0], { ...decisions[1], expectedGeneration: 1 }, decisions[2],
      ])),
    /Stale review-item/);
    await fail(runtime.query(submitSql,
      submitArguments(`wrong-current-decision-${crypto.randomUUID()}`, [
        decisions[0], { ...decisions[1], currentDecisionId: crypto.randomUUID() }, decisions[2],
      ])), /Stale review-item/);
    await fail(runtime.query(submitSql,
      submitArguments(`unsupported-${crypto.randomUUID()}`, [
        { ...decisions[0], disposition: 'USE_ORIGINAL' }, decisions[1], decisions[2],
      ])),
    /supports only Accept/);
    await fail(runtime.query(submitSql,
      submitArguments(`accept-note-${crypto.randomUUID()}`, [
        { ...decisions[0], instructions: 'Hidden note' }, decisions[1], decisions[2],
      ])),
    /Only Send back and Quick Edit/);
    await fail(runtime.query(submitSql,
      submitArguments(`wrong-order-${crypto.randomUUID()}`, decisions, started.lifecycleGeneration, crypto.randomUUID())),
    /Order is missing or unavailable/);
    const rejectedState = await owner.query<{
      decisions: number; idempotency: number; lifecycle_generation: number; unresolved_count: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM medialab_core.returned_review_decisions WHERE review_batch_id=$1) decisions,
        (SELECT count(*)::int FROM medialab_core.media_command_idempotency
          WHERE command_type='SUBMIT_OPERATIONS_EDITOR_REVIEW') idempotency,
        lifecycle_generation::int,unresolved_count
       FROM medialab_core.returned_review_batch_current WHERE review_batch_id=$1`,
      [started.reviewBatchId],
    );
    expect(rejectedState.rows[0]).toEqual({
      decisions: 0, idempotency: 0, lifecycle_generation: 4, unresolved_count: 3,
    });

    await owner.query(`CREATE FUNCTION medialab_core.reject_m22a_atomic_completion_test()
      RETURNS trigger AS $test$
      BEGIN
        IF NEW.event_type='COMPLETED' THEN
          RAISE EXCEPTION 'Synthetic completion failure after decision application';
        END IF;
        RETURN NEW;
      END;
      $test$ LANGUAGE plpgsql SET search_path=pg_catalog,medialab_core,pg_temp`);
    await owner.query(`CREATE TRIGGER reject_m22a_atomic_completion_test
      BEFORE INSERT ON medialab_core.returned_review_batch_events
      FOR EACH ROW EXECUTE FUNCTION medialab_core.reject_m22a_atomic_completion_test()`);
    const rollbackKey = `rollback-${crypto.randomUUID()}`;
    try {
      await fail(runtime.query(submitSql,
        submitArguments(rollbackKey, decisions)), /Synthetic completion failure/);
    } finally {
      await owner.query(`DROP TRIGGER reject_m22a_atomic_completion_test
        ON medialab_core.returned_review_batch_events`);
      await owner.query('DROP FUNCTION medialab_core.reject_m22a_atomic_completion_test()');
    }
    const rolledBack = await owner.query<{
      decisions: number; designations: number; revisions: number; quick_edits: number;
      completions: number; idempotency: number; state: string; lifecycle_generation: number;
      item_count: number; resolved_count: number; unresolved_count: number; final_source_count: number;
      revision_routed_count: number; quick_edit_routed_count: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM medialab_core.returned_review_decisions
          WHERE review_batch_id=$1) decisions,
        (SELECT count(*)::int FROM medialab_core.media_approved_source_designations
          WHERE job_id=$2) designations,
        (SELECT count(*)::int FROM medialab_core.returned_revision_requests
          WHERE job_id=$2) revisions,
        (SELECT count(*)::int FROM medialab_core.returned_quick_edit_requests
          WHERE job_id=$2) quick_edits,
        (SELECT count(*)::int FROM medialab_core.returned_review_batch_events
          WHERE review_batch_id=$1 AND event_type='COMPLETED') completions,
        (SELECT count(*)::int FROM medialab_core.media_command_idempotency
          WHERE command_type='SUBMIT_OPERATIONS_EDITOR_REVIEW' AND idempotency_key=$3) idempotency,
        c.current_state state,c.lifecycle_generation::int,c.item_count,c.resolved_count,c.unresolved_count,
        c.final_source_count,c.revision_routed_count,c.quick_edit_routed_count
       FROM medialab_core.returned_review_batch_current c WHERE c.review_batch_id=$1`,
      [started.reviewBatchId, scope.jobId, rollbackKey],
    );
    expect(rolledBack.rows[0]).toEqual({
      decisions: 0, designations: 0, revisions: 0, quick_edits: 0,
      completions: 0, idempotency: 0, state: 'SEALED', lifecycle_generation: 4,
      item_count: 3, resolved_count: 0, unresolved_count: 3, final_source_count: 0,
      revision_routed_count: 0, quick_edit_routed_count: 0,
    });
    const rolledBackItems = await owner.query<{
      review_item_id: string; current_decision_id: string | null; current_disposition: string | null;
      current_route_state: string; decision_generation: number;
    }>(
      `SELECT review_item_id,current_decision_id,current_disposition,current_route_state,decision_generation::int
         FROM medialab_core.returned_review_item_current
        WHERE review_batch_id=$1 ORDER BY review_item_id`,
      [started.reviewBatchId],
    );
    expect(rolledBackItems.rows).toEqual(reviewItemIds.map((review_item_id) => ({
      review_item_id, current_decision_id: null, current_disposition: null,
      current_route_state: 'UNDECIDED', decision_generation: 0,
    })));

    const left = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    const right = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await left.connect();
    await right.connect();
    const attempts = [
      { client: left, key: `atomic-left-${crypto.randomUUID()}` },
      { client: right, key: `atomic-right-${crypto.randomUUID()}` },
    ];
    try {
      const settled = await Promise.allSettled(attempts.map(({ client, key }) =>
        client.query<{ value: any }>(submitSql, submitArguments(key, decisions))));
      const winnerIndex = settled.findIndex((result) => result.status === 'fulfilled');
      expect(winnerIndex).toBeGreaterThanOrEqual(0);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const loser = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(loser?.reason?.code).toBe('40001');
      expect(String(loser?.reason?.message)).toMatch(/Stale review batch generation/);
      const winner = (settled[winnerIndex] as PromiseFulfilledResult<pg.QueryResult<{ value: any }>>)
        .value.rows[0].value;
      expect(winner).toMatchObject({
        orderId: ORDER_FOUNDATION_ORDER_ID,
        reviewBatchId: started.reviewBatchId,
        replayed: false,
        decisions: reviewItemIds.map((reviewItemId) => ({ reviewItemId })),
      });
      const replay = (await runtime.query<{ value: any }>(submitSql,
        submitArguments(attempts[winnerIndex]!.key, [...decisions].reverse()))).rows[0].value;
      expect(replay).toMatchObject({
        completedEventId: winner.completedEventId,
        decisions: winner.decisions,
        replayed: true,
      });
      await fail(runtime.query(submitSql,
        submitArguments(attempts[winnerIndex]!.key, [
          { ...decisions[0], disposition: 'QUICK_EDIT' }, decisions[1], decisions[2],
        ])),
      /Idempotency key conflicts/);
    } finally {
      await left.end();
      await right.end();
    }
    const committed = await owner.query<{
      decisions: number; designations: number; revisions: number; quick_edits: number;
      completions: number; idempotency: number; state: string; lifecycle_generation: number;
      item_count: number; resolved_count: number; unresolved_count: number; final_source_count: number;
      revision_routed_count: number; quick_edit_routed_count: number; completion_reason: string;
    }>(
      `SELECT
        (SELECT count(*)::int FROM medialab_core.returned_review_decisions
          WHERE review_batch_id=$1) decisions,
        (SELECT count(*)::int FROM medialab_core.media_approved_source_designations
          WHERE job_id=$2) designations,
        (SELECT count(*)::int FROM medialab_core.returned_revision_requests WHERE job_id=$2) revisions,
        (SELECT count(*)::int FROM medialab_core.returned_quick_edit_requests WHERE job_id=$2) quick_edits,
        (SELECT count(*)::int FROM medialab_core.returned_review_batch_events
          WHERE review_batch_id=$1 AND event_type='COMPLETED') completions,
        (SELECT count(*)::int FROM medialab_core.media_command_idempotency
          WHERE command_type='SUBMIT_OPERATIONS_EDITOR_REVIEW') idempotency,
        c.current_state state,c.lifecycle_generation::int,c.item_count,c.resolved_count,c.unresolved_count,
        c.final_source_count,c.revision_routed_count,c.quick_edit_routed_count,
        (SELECT reason FROM medialab_core.returned_review_batch_events
          WHERE review_batch_id=$1 AND event_type='COMPLETED') completion_reason
       FROM medialab_core.returned_review_batch_current c WHERE c.review_batch_id=$1`,
      [started.reviewBatchId, scope.jobId],
    );
    expect(committed.rows[0]).toEqual({
      decisions: 3, designations: 1, revisions: 1, quick_edits: 1,
      completions: 1, idempotency: 1, state: 'COMPLETED', lifecycle_generation: 5,
      item_count: 3, resolved_count: 3, unresolved_count: 0, final_source_count: 1,
      revision_routed_count: 1, quick_edit_routed_count: 1,
      completion_reason: 'System evidence: returned review completed with every item resolved.',
    });
    const committedItems = await owner.query<{
      review_item_id: string; current_decision_id: string; current_disposition: string;
      current_route_state: string; decision_generation: number; reason: string | null;
      instructions: string | null; designation_reason: string | null;
    }>(
      `SELECT i.id review_item_id,c.current_decision_id,c.current_disposition,c.current_route_state,
              c.decision_generation::int,d.reason,d.instructions,designation.reason designation_reason
         FROM medialab_core.returned_review_items i
         JOIN medialab_core.returned_review_item_current c ON c.review_item_id=i.id
         JOIN medialab_core.returned_review_decisions d ON d.id=c.current_decision_id
         LEFT JOIN medialab_core.media_approved_source_designations designation
           ON designation.id=c.current_final_source_designation_id
        WHERE i.review_batch_id=$1 ORDER BY i.id`,
      [started.reviewBatchId],
    );
    expect(committedItems.rows).toEqual([
      { review_item_id: reviewItemIds[0], current_decision_id: expect.any(String),
        current_disposition: 'ACCEPT', current_route_state: 'FINAL_SOURCE_SELECTED', decision_generation: 1,
        reason: null, instructions: null,
        designation_reason: 'System evidence: returned review selected the reviewed version as final source.' },
      { review_item_id: reviewItemIds[1], current_decision_id: expect.any(String),
        current_disposition: 'REJECT_REVISION', current_route_state: 'REVISION_ROUTED', decision_generation: 1,
        reason: null, instructions: 'Restore the clean vertical window lines.', designation_reason: null },
      { review_item_id: reviewItemIds[2], current_decision_id: expect.any(String),
        current_disposition: 'QUICK_EDIT', current_route_state: 'QUICK_EDIT_ROUTED', decision_generation: 1,
        reason: null, instructions: 'Reduce the window reflection.', designation_reason: null },
    ]);
    const routedNotes = await owner.query<{
      route: string; reason: string | null; instructions: string | null;
    }>(
      `SELECT 'REJECT_REVISION' route,reason,instructions FROM medialab_core.returned_revision_requests
        WHERE job_id=$1
       UNION ALL
       SELECT 'QUICK_EDIT',reason,instructions FROM medialab_core.returned_quick_edit_requests
        WHERE job_id=$1 ORDER BY route`,
      [scope.jobId],
    );
    expect(routedNotes.rows).toEqual([
      { route: 'QUICK_EDIT', reason: null, instructions: 'Reduce the window reflection.' },
      { route: 'REJECT_REVISION', reason: null, instructions: 'Restore the clean vertical window lines.' },
    ]);
  });

  it('converges concurrent same-key reordered multi-item submissions on one result', async () => {
    const token = await session();
    const scope = await job(token);
    await returnedPhoto(token, scope, true, false, 3);
    const started = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [token, `start-same-key-review-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    const reviewItemIds = (await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_review_items WHERE review_batch_id=$1 ORDER BY id',
      [started.reviewBatchId],
    )).rows.map(({ id }) => id);
    const decisions = reviewItemIds.map((reviewItemId, index) => ({
      reviewItemId,
      disposition: (index === 0 ? 'ACCEPT' : index === 1 ? 'REJECT_REVISION' : 'QUICK_EDIT'),
      ...(index === 0 ? {} : { instructions: index === 1 ? 'Straighten verticals.' : 'Reduce glare.' }),
      expectedGeneration: 0,
      currentDecisionId: null,
    }));
    const submitSql = `SELECT medialab_core.submit_operations_editor_review(
      $1,$2,$3::uuid,$4::uuid,$5::bigint,$6::jsonb
    ) value`;
    const key = `atomic-same-${crypto.randomUUID()}`;
    const argumentsFor = (submittedDecisions: unknown) => [
      token, key, ORDER_FOUNDATION_ORDER_ID, started.reviewBatchId,
      started.lifecycleGeneration, JSON.stringify(submittedDecisions),
    ];
    const left = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    const right = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await left.connect();
    await right.connect();
    try {
      const [forward, reversed] = await Promise.all([
        left.query<{ value: any }>(submitSql, argumentsFor(decisions)),
        right.query<{ value: any }>(submitSql, argumentsFor([...decisions].reverse())),
      ]);
      const results = [forward.rows[0].value, reversed.rows[0].value];
      expect(results.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
      expect(new Set(results.map(({ completedEventId }) => completedEventId)).size).toBe(1);
      expect(new Set(results.map(({ decisions: result }) => JSON.stringify(result))).size).toBe(1);
      expect(results[0].decisions.map(({ reviewItemId }: { reviewItemId: string }) => reviewItemId))
        .toEqual(reviewItemIds);
    } finally {
      await left.end();
      await right.end();
    }
    const evidence = await owner.query<{ decisions: number; idempotency: number; completions: number }>(
      `SELECT
        (SELECT count(*)::int FROM medialab_core.returned_review_decisions WHERE review_batch_id=$1) decisions,
        (SELECT count(*)::int FROM medialab_core.media_command_idempotency
          WHERE command_type='SUBMIT_OPERATIONS_EDITOR_REVIEW' AND idempotency_key=$2) idempotency,
        (SELECT count(*)::int FROM medialab_core.returned_review_batch_events
          WHERE review_batch_id=$1 AND event_type='COMPLETED') completions`,
      [started.reviewBatchId, key],
    );
    expect(evidence.rows[0]).toEqual({ decisions: 3, idempotency: 1, completions: 1 });
  });

  it('projects contextual attention, safe active/history metadata, and server-only media descriptors', async () => {
    const token = await session();
    const scope = await job(token);
    const returned = await returnedPhoto(token, scope);
    let attention = await runtime.query<{ item: any }>(
      'SELECT item FROM medialab_core.list_operations_review_attention($1) item', [token],
    );
    expect(attention.rows).toHaveLength(1);
    expect(attention.rows[0].item).toMatchObject({
      orderId: ORDER_FOUNDATION_ORDER_ID,
      jobId: scope.jobId,
      actions: [{ code: 'EDITOR_REVIEW_READY', lane: 'PHOTO', reviewBatchId: null, reviewItemId: null }],
    });
    const startKey = `start-review-${crypto.randomUUID()}`;
    const started = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [token, startKey, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    expect(started).toMatchObject({
      lane: 'PHOTO', itemCount: 1, lifecycleGeneration: 2, replayed: false,
    });
    const startReplay = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [token, startKey, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    expect(startReplay).toMatchObject({ reviewBatchId: started.reviewBatchId, replayed: true });
    const startConvergence = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [token, `converge-review-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    expect(startConvergence).toMatchObject({ reviewBatchId: started.reviewBatchId, replayed: true });
    const reviewItemId = (await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_review_items WHERE review_batch_id=$1', [started.reviewBatchId],
    )).rows[0].id;
    const active = await runtime.query<{ workspace: any }>(
      'SELECT medialab_core.get_operations_review_workspace($1,$2::uuid) workspace',
      [token, ORDER_FOUNDATION_ORDER_ID],
    );
    expect(active.rows[0].workspace.activeReview).toMatchObject({
      reviewBatchId: started.reviewBatchId,
      lifecycleGeneration: 2,
      itemCount: 1,
      unresolvedCount: 1,
      items: [{
        reviewItemId,
        previewAvailable: true,
        version: {
          versionId: returned.returnedVersionId,
          observedFilename: 'editor-return.jpg',
          checksumSha256: returned.returnedChecksum,
        },
      }],
    });
    expect(JSON.stringify(active.rows[0].workspace)).not.toMatch(
      /object_identifier|provider_object_identifier|storage_namespace|M22A_RETURNED_REVIEW|returned\//i,
    );
    const descriptor = await runtime.query<{ source: any }>(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'REVIEW_PREVIEW'
      ) source`, [token, ORDER_FOUNDATION_ORDER_ID, started.reviewBatchId, reviewItemId],
    );
    expect(descriptor.rows[0].source).toEqual({
      object_identifier: returned.returnedObjectIdentifier,
      filename: 'editor-return.jpg',
      byte_size: 1800,
      checksum_sha256: returned.returnedChecksum,
      media_type: 'image/jpeg',
    });
    await fail(runtime.query(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'QUICK_EDIT_DOWNLOAD'
      )`, [token, ORDER_FOUNDATION_ORDER_ID, started.reviewBatchId, reviewItemId],
    ), /not currently actionable/);
    await owner.query("UPDATE medialab_core.permissions SET is_active=false WHERE code='media_editor_handoff.read'");
    expect((await runtime.query('SELECT item FROM medialab_core.list_operations_review_attention($1) item',
      [token])).rows).toHaveLength(0);
    await fail(runtime.query('SELECT medialab_core.get_operations_review_workspace($1,$2::uuid)',
      [token, ORDER_FOUNDATION_ORDER_ID]), /media_editor_handoff.read/);
    await fail(runtime.query(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'REVIEW_PREVIEW'
      )`, [token, ORDER_FOUNDATION_ORDER_ID, started.reviewBatchId, reviewItemId],
    ), /media_editor_handoff.read/);
    await fail(runtime.query('SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4)',
      [token, `permission-denied-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO']),
    /media_editor_handoff.read/);
    const outsider = await outsiderSession();
    expect((await runtime.query('SELECT item FROM medialab_core.list_operations_review_attention($1) item',
      [outsider])).rows).toHaveLength(0);
    await fail(runtime.query('SELECT medialab_core.get_operations_review_workspace($1,$2::uuid)',
      [outsider, ORDER_FOUNDATION_ORDER_ID]), /lacks active order.read authority/);
    await fail(runtime.query(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'REVIEW_PREVIEW'
      )`, [outsider, ORDER_FOUNDATION_ORDER_ID, started.reviewBatchId, reviewItemId],
    ), /lacks active order.read authority/);
  });

  it('fails the server-only resolver closed for completed previews, missing verification, and ambiguous storage', async () => {
    const completed = await quickEditScenario();
    await fail(runtime.query(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'REVIEW_PREVIEW'
      )`, [completed.token, ORDER_FOUNDATION_ORDER_ID, completed.reviewBatchId, completed.reviewItemId],
    ), /only for an active draft or sealed review/);

    const unverifiedToken = await session();
    const unverifiedScope = await job(unverifiedToken);
    const unverified = await returnedPhoto(unverifiedToken, unverifiedScope, false);
    const unverifiedReview = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [unverifiedToken, `start-unverified-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    const unverifiedItemId = (await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_review_items WHERE review_batch_id=$1',
      [unverifiedReview.reviewBatchId],
    )).rows[0].id;
    const unverifiedProjection = (await owner.query<{ value: any }>(
      'SELECT medialab_core.operations_review_batch_workspace($1::uuid) value',
      [unverifiedReview.reviewBatchId],
    )).rows[0].value;
    expect(unverifiedProjection.items[0].previewAvailable).toBe(false);
    await fail(runtime.query(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'REVIEW_PREVIEW'
      )`, [unverifiedToken, ORDER_FOUNDATION_ORDER_ID, unverifiedReview.reviewBatchId, unverifiedItemId],
    ), /checksum evidence is unavailable/);

    const duplicateToken = await session();
    const duplicateScope = await job(duplicateToken);
    const duplicate = await returnedPhoto(duplicateToken, duplicateScope);
    const duplicateReview = (await runtime.query<{ value: any }>(
      'SELECT medialab_core.start_operations_editor_review($1,$2,$3::uuid,$4) value',
      [duplicateToken, `start-duplicate-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'PHOTO'],
    )).rows[0].value;
    const duplicateItemId = (await owner.query<{ id: string }>(
      'SELECT id FROM medialab_core.returned_review_items WHERE review_batch_id=$1',
      [duplicateReview.reviewBatchId],
    )).rows[0].id;
    await runtime.query(
      'SELECT medialab_core.record_media_storage_object($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [duplicateToken, `duplicate-storage-${crypto.randomUUID()}`, duplicate.returnedVersionId, 'LOCAL_FIXTURE',
        'M22A_RETURNED_REVIEW_DUPLICATE', `duplicate/${duplicate.returnedVersionId}.jpg`,
        duplicate.returnedChecksum, 1800, 'image/jpeg', SOURCE],
    );
    const duplicateProjection = (await owner.query<{ value: any }>(
      'SELECT medialab_core.operations_review_batch_workspace($1::uuid) value',
      [duplicateReview.reviewBatchId],
    )).rows[0].value;
    expect(duplicateProjection.items[0].previewAvailable).toBe(false);
    await fail(runtime.query(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'REVIEW_PREVIEW'
      )`, [duplicateToken, ORDER_FOUNDATION_ORDER_ID, duplicateReview.reviewBatchId, duplicateItemId],
    ), /storage identity is ambiguous/);
  });

  it('durably resumes upload intent and atomically finalizes one corrected source with immutable review evidence', async () => {
    const scenario = await quickEditScenario();
    let workspace = (await runtime.query<{ workspace: any }>(
      'SELECT medialab_core.get_operations_review_workspace($1,$2::uuid) workspace',
      [scenario.token, ORDER_FOUNDATION_ORDER_ID],
    )).rows[0].workspace;
    expect(workspace.actions).toEqual([expect.objectContaining({
      code: 'QUICK_EDIT_REQUIRED', reviewBatchId: scenario.reviewBatchId,
      reviewItemId: scenario.reviewItemId, quickEditRequestId: scenario.quickEditRequestId,
    })]);
    expect(workspace.quickEdits).toEqual([expect.objectContaining({
      quickEditRequestId: scenario.quickEditRequestId,
      instructions: null,
      expectedReviewLifecycleGeneration: 3,
      expectedDecisionGeneration: 1,
      uploadState: 'AWAITING_UPLOAD',
      downloadAvailable: true,
    })]);
    expect(workspace.completedHistory).toEqual([expect.objectContaining({
      reviewBatchId: scenario.reviewBatchId,
      itemCount: 1,
      quickEditRoutedCount: 1,
      decisions: [expect.objectContaining({ disposition: 'QUICK_EDIT', reason: null, instructions: null })],
    })]);
    expect(JSON.stringify(workspace)).not.toMatch(
      /object_identifier|provider_object_identifier|storage_namespace|M22A_RETURNED_REVIEW|returned\//i,
    );
    const download = await runtime.query<{ source: any }>(
      `SELECT medialab_core.resolve_operations_review_media_source(
        $1,$2::uuid,$3::uuid,$4::uuid,'QUICK_EDIT_DOWNLOAD'
      ) source`, [scenario.token, ORDER_FOUNDATION_ORDER_ID, scenario.reviewBatchId, scenario.reviewItemId],
    );
    expect(download.rows[0].source.object_identifier).toBe(scenario.returnedObjectIdentifier);

    await fail(runtime.query(
      `SELECT medialab_core.create_operations_quick_edit_upload_intent(
        $1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::bigint,$8::bigint
      )`, [scenario.token, `stale-intent-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID,
        scenario.reviewBatchId, scenario.reviewItemId, scenario.quickEditRequestId, 2, 1],
    ), /Stale or incomplete/);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.operations_quick_edit_upload_intents'))
      .rows[0].n).toBe(0);

    const intentKey = `intent-${crypto.randomUUID()}`;
    const firstIntent = (await createIntent(scenario, intentKey)).rows[0].create_operations_quick_edit_upload_intent;
    expect(firstIntent).toMatchObject({
      requestId: scenario.quickEditRequestId, state: 'AWAITING_UPLOAD', generation: 0, replayed: false,
    });
    const replayIntent = (await createIntent(scenario, intentKey)).rows[0].create_operations_quick_edit_upload_intent;
    expect(replayIntent).toMatchObject({ uploadIntentId: firstIntent.uploadIntentId, replayed: true });
    const convergedIntent = (await createIntent(scenario)).rows[0].create_operations_quick_edit_upload_intent;
    expect(convergedIntent).toMatchObject({ uploadIntentId: firstIntent.uploadIntentId, replayed: true });
    const readback = await runtime.query<{ value: any }>(
      'SELECT medialab_core.get_operations_quick_edit_upload_intent($1,$2::uuid,$3::uuid) value',
      [scenario.token, ORDER_FOUNDATION_ORDER_ID, firstIntent.uploadIntentId],
    );
    expect(readback.rows[0].value).toMatchObject({
      uploadIntentId: firstIntent.uploadIntentId,
      requestId: scenario.quickEditRequestId,
      reviewBatchId: scenario.reviewBatchId,
      reviewItemId: scenario.reviewItemId,
      state: 'AWAITING_UPLOAD',
      generation: 0,
      expectedReviewLifecycleGeneration: scenario.reviewGeneration,
      expectedDecisionGeneration: scenario.decisionGeneration,
      correctedChecksumSha256: null,
      registeredObjectIdentifier: null,
    });

    const correctedChecksum = digest(`corrected-${crypto.randomUUID()}`);
    const registrationKey = `register-${crypto.randomUUID()}`;
    const staleArguments = registrationArguments(scenario, firstIntent.uploadIntentId,
      `stale-register-${crypto.randomUUID()}`, correctedChecksum);
    staleArguments[9] = 1;
    await fail(runtime.query(registrationSql, staleArguments), /Stale Quick Edit upload generation/);
    expect((await owner.query("SELECT count(*)::int n FROM medialab_core.media_asset_versions WHERE version_kind='QUICK_EDIT_CORRECTION'"))
      .rows[0].n).toBe(0);

    const args = registrationArguments(scenario, firstIntent.uploadIntentId, registrationKey, correctedChecksum);
    const registered = (await runtime.query<{ value: RegistrationResult }>(
      `${registrationSql.replace('SELECT ', 'SELECT ')} value`, args,
    )).rows[0].value;
    expect(registered).toMatchObject({
      uploadIntentId: firstIntent.uploadIntentId,
      requestId: scenario.quickEditRequestId,
      providerObjectIdentifier: args[14],
      finalSourceVersionId: expect.any(String),
      successorDecisionId: expect.any(String),
      successorCompletionEventId: expect.any(String),
      replayed: false,
    });
    expect(registered.finalSourceVersionId).toBe(registered.correctedVersionId);
    const replayed = (await runtime.query<{ value: RegistrationResult }>(
      `${registrationSql.replace('SELECT ', 'SELECT ')} value`, args,
    )).rows[0].value;
    expect(replayed).toMatchObject({
      correctedVersionId: registered.correctedVersionId,
      providerObjectIdentifier: args[14],
      successorReviewBatchId: registered.successorReviewBatchId,
      replayed: true,
    });
    const converged = (await runtime.query<{ value: RegistrationResult }>(
      `${registrationSql.replace('SELECT ', 'SELECT ')} value`,
      registrationArguments(scenario, firstIntent.uploadIntentId, `converge-${crypto.randomUUID()}`, correctedChecksum),
    )).rows[0].value;
    expect(converged).toMatchObject({
      correctedVersionId: registered.correctedVersionId,
      successorReviewBatchId: registered.successorReviewBatchId,
      replayed: true,
    });
    const sameKeyDrift = registrationArguments(
      scenario, firstIntent.uploadIntentId, registrationKey, correctedChecksum,
    );
    sameKeyDrift[10] = 'same-bytes-renamed.jpg';
    await fail(runtime.query(registrationSql, sameKeyDrift), /Idempotency key conflicts with a different request/);
    const sameContentNewKey = registrationArguments(
      scenario, firstIntent.uploadIntentId, `same-content-${crypto.randomUUID()}`, correctedChecksum,
    );
    sameContentNewKey[10] = 'same-bytes-renamed.jpg';
    sameContentNewKey[14] = `quick-edits/alternate-${firstIntent.uploadIntentId}.jpg`;
    sameContentNewKey[15] = 'Equivalent content registration from a resumed browser upload';
    const contentConverged = (await runtime.query<{ value: RegistrationResult }>(
      `${registrationSql.replace('SELECT ', 'SELECT ')} value`, sameContentNewKey,
    )).rows[0].value;
    expect(contentConverged).toMatchObject({
      correctedVersionId: registered.correctedVersionId,
      providerObjectIdentifier: args[14],
      successorReviewBatchId: registered.successorReviewBatchId,
      replayed: true,
    });
    await fail(runtime.query(registrationSql,
      registrationArguments(scenario, firstIntent.uploadIntentId, `conflict-${crypto.randomUUID()}`,
        digest('conflicting-content'))), /conflicts with an already registered correction/);

    const evidence = await owner.query<{
      versions: number; storage: number; verification: number; lineage: number; quick_links: number;
      successor_batches: number; successor_items: number; successor_links: number; upload_events: number;
      successor_decisions: number; successor_completions: number; final_designations: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM medialab_core.media_asset_versions
          WHERE id=$1 AND version_kind='QUICK_EDIT_CORRECTION') versions,
        (SELECT count(*)::int FROM medialab_core.media_storage_objects WHERE version_id=$1) storage,
        (SELECT count(*)::int FROM medialab_core.media_verification_events
          WHERE version_id=$1 AND verification_state='VERIFIED') verification,
        (SELECT count(*)::int FROM medialab_core.media_asset_lineage
          WHERE source_version_id=$2 AND target_version_id=$1
            AND relationship_type='EDITOR_RETURN_TO_CORRECTED_VERSION') lineage,
        (SELECT count(*)::int FROM medialab_core.returned_quick_edit_version_links
          WHERE quick_edit_request_id=$3 AND corrected_media_asset_version_id=$1) quick_links,
        (SELECT count(*)::int FROM medialab_core.returned_review_batches WHERE id=$4) successor_batches,
        (SELECT count(*)::int FROM medialab_core.returned_review_items
          WHERE review_batch_id=$4 AND review_media_asset_version_id=$1) successor_items,
        (SELECT count(*)::int FROM medialab_core.returned_review_successor_links
          WHERE predecessor_review_batch_id=$5 AND successor_review_batch_id=$4) successor_links,
        (SELECT count(*)::int FROM medialab_core.operations_quick_edit_upload_events
          WHERE upload_intent_id=$6) upload_events,
        (SELECT count(*)::int FROM medialab_core.returned_review_decisions
          WHERE id=$7 AND review_item_id=(SELECT id FROM medialab_core.returned_review_items
            WHERE review_batch_id=$4)) successor_decisions,
        (SELECT count(*)::int FROM medialab_core.returned_review_batch_events
          WHERE id=$8 AND review_batch_id=$4 AND event_type='COMPLETED') successor_completions,
        (SELECT count(*)::int FROM medialab_core.media_approved_source_designations
          WHERE version_id=$1) final_designations`,
      [registered.correctedVersionId, scenario.returnedVersionId, scenario.quickEditRequestId,
        registered.successorReviewBatchId, scenario.reviewBatchId, firstIntent.uploadIntentId,
        registered.successorDecisionId, registered.successorCompletionEventId],
    );
    expect(evidence.rows[0]).toEqual({
      versions: 1, storage: 1, verification: 1, lineage: 1, quick_links: 1,
      successor_batches: 1, successor_items: 1, successor_links: 1, upload_events: 2,
      successor_decisions: 1, successor_completions: 1, final_designations: 1,
    });
    const successor = await owner.query(
      `SELECT bc.current_state,bc.item_count,bc.resolved_count,bc.unresolved_count,
              bc.final_source_count,bc.lifecycle_generation,ic.current_disposition,ic.current_route_state,
              d.reviewed_media_asset_version_id,designation.version_id final_source_version_id
         FROM medialab_core.returned_review_batch_current bc
         JOIN medialab_core.returned_review_item_current ic ON ic.review_batch_id=bc.review_batch_id
         JOIN medialab_core.returned_review_decisions d ON d.id=ic.current_decision_id
         JOIN medialab_core.media_approved_source_designations designation
           ON designation.id=ic.current_final_source_designation_id
        WHERE bc.review_batch_id=$1`,
      [registered.successorReviewBatchId],
    );
    expect(successor.rows[0]).toMatchObject({
      current_state: 'COMPLETED', item_count: 1, resolved_count: 1, unresolved_count: 0,
      final_source_count: 1, lifecycle_generation: '3', current_disposition: 'ACCEPT',
      current_route_state: 'FINAL_SOURCE_SELECTED',
      reviewed_media_asset_version_id: registered.correctedVersionId,
      final_source_version_id: registered.correctedVersionId,
    });
    const completedReadback = await runtime.query<{ value: any }>(
      'SELECT medialab_core.get_operations_quick_edit_upload_intent($1,$2::uuid,$3::uuid) value',
      [scenario.token, ORDER_FOUNDATION_ORDER_ID, firstIntent.uploadIntentId],
    );
    expect(completedReadback.rows[0].value).toMatchObject({
      state: 'FINALIZED', generation: 1,
      expectedReviewLifecycleGeneration: scenario.reviewGeneration,
      expectedDecisionGeneration: scenario.decisionGeneration,
      correctedVersionId: registered.correctedVersionId,
      correctedChecksumSha256: correctedChecksum,
      registeredObjectIdentifier: args[14],
      successorReviewBatchId: registered.successorReviewBatchId,
      successorDecisionId: registered.successorDecisionId,
      successorCompletionEventId: registered.successorCompletionEventId,
    });
    const requestReadback = await runtime.query<{ value: any }>(
      'SELECT medialab_core.get_operations_quick_edit_upload_intent($1,$2::uuid,$3::uuid) value',
      [scenario.token, ORDER_FOUNDATION_ORDER_ID, scenario.quickEditRequestId],
    );
    expect(requestReadback.rows[0].value).toMatchObject({
      uploadIntentId: firstIntent.uploadIntentId,
      requestId: scenario.quickEditRequestId,
      state: 'FINALIZED',
      generation: 1,
      expectedReviewLifecycleGeneration: scenario.reviewGeneration,
      expectedDecisionGeneration: scenario.decisionGeneration,
      correctedVersionId: registered.correctedVersionId,
      correctedChecksumSha256: correctedChecksum,
      registeredObjectIdentifier: args[14],
      successorReviewBatchId: registered.successorReviewBatchId,
      successorDecisionId: registered.successorDecisionId,
      successorCompletionEventId: registered.successorCompletionEventId,
    });
    await fail(runtime.query(
      'SELECT medialab_core.get_operations_quick_edit_upload_intent($1,$2::uuid,$3::uuid)',
      [scenario.token, crypto.randomUUID(), scenario.quickEditRequestId],
    ), /missing or unavailable/);
    workspace = (await runtime.query<{ workspace: any }>(
      'SELECT medialab_core.get_operations_review_workspace($1,$2::uuid) workspace',
      [scenario.token, ORDER_FOUNDATION_ORDER_ID],
    )).rows[0].workspace;
    expect(workspace.quickEdits).toEqual([]);
    expect(workspace.activeReview).toBeNull();
    expect(workspace.actions).toEqual([]);
    expect(workspace.completedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewBatchId: scenario.reviewBatchId, quickEditRoutedCount: 1 }),
      expect.objectContaining({ reviewBatchId: registered.successorReviewBatchId, finalSourceCount: 1,
        decisions: [expect.objectContaining({ disposition: 'ACCEPT' })] }),
    ]));

    const outsider = await outsiderSession();
    await fail(runtime.query('SELECT medialab_core.get_operations_quick_edit_upload_intent($1,$2::uuid,$3::uuid)',
      [outsider, ORDER_FOUNDATION_ORDER_ID, firstIntent.uploadIntentId]), /lacks active order.read authority/);
    await fail(runtime.query(
      `SELECT medialab_core.create_operations_quick_edit_upload_intent(
        $1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::bigint,$8::bigint
      )`, [scenario.token, `wrong-scope-${crypto.randomUUID()}`, crypto.randomUUID(), scenario.reviewBatchId,
        scenario.reviewItemId, scenario.quickEditRequestId, scenario.reviewGeneration, scenario.decisionGeneration],
    ), /cross-tenant, cross-Job, or unavailable/);
  });

  it('serializes concurrent registration attempts and emits no duplicate correction evidence', async () => {
    const scenario = await quickEditScenario();
    const intent = (await createIntent(scenario)).rows[0].create_operations_quick_edit_upload_intent;
    const checksum = digest(`concurrent-correction-${crypto.randomUUID()}`);
    const left = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    const right = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await left.connect();
    await right.connect();
    try {
      const leftArguments = registrationArguments(
        scenario, intent.uploadIntentId, `concurrent-a-${crypto.randomUUID()}`, checksum,
      );
      const rightArguments = registrationArguments(
        scenario, intent.uploadIntentId, `concurrent-b-${crypto.randomUUID()}`, checksum,
      );
      rightArguments[10] = 'concurrent-same-bytes-renamed.jpg';
      rightArguments[14] = `quick-edits/concurrent-alternate-${intent.uploadIntentId}.jpg`;
      rightArguments[15] = 'Concurrent equivalent-content registration under an alternate staged object';
      const [a, b] = await Promise.all([
        left.query<{ value: RegistrationResult }>(
          `${registrationSql.replace('SELECT ', 'SELECT ')} value`, leftArguments,
        ),
        right.query<{ value: RegistrationResult }>(
          `${registrationSql.replace('SELECT ', 'SELECT ')} value`, rightArguments,
        ),
      ]);
      const results = [a.rows[0].value, b.rows[0].value];
      expect(new Set(results.map((result) => result.correctedVersionId)).size).toBe(1);
      expect(new Set(results.map((result) => result.successorReviewBatchId)).size).toBe(1);
      expect(new Set(results.map((result) => result.providerObjectIdentifier)).size).toBe(1);
      expect([leftArguments[14], rightArguments[14]]).toContain(results[0].providerObjectIdentifier);
      expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
      const counts = await owner.query<{
        versions: number; storage: number; verification: number; lineage: number;
        quick_links: number; successor_batches: number; successor_items: number; successor_links: number;
        canonical_object_identifier: string;
      }>(
        `SELECT
          (SELECT count(*)::int FROM medialab_core.media_asset_versions
            WHERE version_kind='QUICK_EDIT_CORRECTION' AND asset_id=$1) versions,
          (SELECT count(*)::int FROM medialab_core.media_storage_objects WHERE version_id=$2) storage,
          (SELECT count(*)::int FROM medialab_core.media_verification_events WHERE version_id=$2) verification,
          (SELECT count(*)::int FROM medialab_core.media_asset_lineage WHERE target_version_id=$2) lineage,
          (SELECT count(*)::int FROM medialab_core.returned_quick_edit_version_links
            WHERE quick_edit_request_id=$3) quick_links,
          (SELECT count(*)::int FROM medialab_core.returned_review_batches WHERE id=$4) successor_batches,
          (SELECT count(*)::int FROM medialab_core.returned_review_items WHERE review_batch_id=$4) successor_items,
          (SELECT count(*)::int FROM medialab_core.returned_review_successor_links
            WHERE successor_review_batch_id=$4) successor_links,
          (SELECT provider_object_identifier FROM medialab_core.media_storage_objects
            WHERE version_id=$2) canonical_object_identifier`,
        [scenario.assetId, results[0].correctedVersionId, scenario.quickEditRequestId,
          results[0].successorReviewBatchId],
      );
      expect(counts.rows[0]).toEqual({
        versions: 1, storage: 1, verification: 1, lineage: 1,
        quick_links: 1, successor_batches: 1, successor_items: 1, successor_links: 1,
        canonical_object_identifier: results[0].providerObjectIdentifier,
      });
    } finally {
      await left.end();
      await right.end();
    }
  });
});
