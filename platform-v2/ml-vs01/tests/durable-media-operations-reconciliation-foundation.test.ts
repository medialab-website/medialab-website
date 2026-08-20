import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PEOPLE_FIXTURES } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m16a_test';
const OWNER_ROLE = 'medialab_p02m16a_test_owner';
const RUNTIME_ROLE = 'medialab_p02m16a_test_app';
const SOCKET = '/tmp/mlvs01-p02m16a-pg';
const PORT = 55447;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M09_A_TEST';
const VERSION_HASH = crypto.createHash('sha256').update('synthetic-operation-target').digest('hex');

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('P02-M09-A Durable Media Operations and Reconciliation foundation', () => {
  let owner: pg.Client;
  let runtimeA: pg.Client;
  let runtimeB: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE,
      runtimeUser: RUNTIME_ROLE, confirm: TEST_DB });
  }

  async function issueSession(identityId = STAFF_IDENTITY_ID): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour', NULL)`,
      [crypto.randomUUID(), identityId, digest(token)]
    );
    return token;
  }

  async function expectFailure(work: Promise<unknown>, pattern?: RegExp): Promise<void> {
    try {
      await work;
      throw new Error('Expected PostgreSQL operation to fail');
    } catch (error: any) {
      if (error.message === 'Expected PostgreSQL operation to fail') throw error;
      if (pattern) expect(error.message).toMatch(pattern);
    }
  }

  async function setupMedia(token: string): Promise<{
    jobId: string; workstreamId: string; assetId: string; versionId: string;
  }> {
    const job = await runtimeA.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE]
    );
    const workstream = await runtimeA.query<{ create_service_workstream: string }>(
      'SELECT medialab_core.create_service_workstream($1,$2,$3,$4,$5)',
      [token, `workstream-${crypto.randomUUID()}`, job.rows[0].create_job, ORDER_ITEM_FIXTURES[0].id, SOURCE]
    );
    const asset = await runtimeA.query<{ create_media_asset: string }>(
      'SELECT medialab_core.create_media_asset($1,$2,$3,$4,$5::jsonb)',
      [token, `asset-${crypto.randomUUID()}`, job.rows[0].create_job,
        workstream.rows[0].create_service_workstream, JSON.stringify({ source: SOURCE })]
    );
    const version = await runtimeA.query<{ add_media_asset_version: string }>(
      'SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token, `version-${crypto.randomUUID()}`, asset.rows[0].create_media_asset, 'ORIGINAL',
        'synthetic-target.dng', 1000, 'image/dng', VERSION_HASH, SOURCE]
    );
    return { jobId: job.rows[0].create_job, workstreamId: workstream.rows[0].create_service_workstream,
      assetId: asset.rows[0].create_media_asset, versionId: version.rows[0].add_media_asset_version };
  }

  async function requestWithTarget(token: string, media: {jobId: string; workstreamId: string; versionId: string},
    suffix = crypto.randomUUID()): Promise<{operationId: string; targetId: string}> {
    const operation = await runtimeA.query<{ request_media_operation: string }>(
      'SELECT medialab_core.request_media_operation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `request-${suffix}`, media.jobId, media.workstreamId, 'TRANSFER', 'EDITOR_HANDOFF',
        'Synthetic durable-operation request', JSON.stringify({ source: SOURCE, purpose: 'VALIDATION_ONLY' })]
    );
    const target = await runtimeA.query<{ attach_media_operation_target: string }>(
      'SELECT medialab_core.attach_media_operation_target($1,$2,$3,$4,$5)',
      [token, `target-${suffix}`, operation.rows[0].request_media_operation, 'MEDIA_ASSET_VERSION', media.versionId]
    );
    await runtimeA.query('SELECT medialab_core.ready_media_operation($1,$2,$3,$4)',
      [token, `ready-${suffix}`, operation.rows[0].request_media_operation, 'Validated explicit target is ready']);
    return { operationId: operation.rows[0].request_media_operation,
      targetId: target.rows[0].attach_media_operation_target };
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE });
    runtimeA = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME_ROLE });
    runtimeB = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME_ROLE });
    await owner.connect();
    await runtimeA.connect();
    await runtimeB.connect();
  });
  beforeEach(async () => { await reset(); });
  afterAll(async () => {
    if (runtimeB) await runtimeB.end();
    if (runtimeA) await runtimeA.end();
    if (owner) await owner.end();
    await reset();
  });

  it('replays thirteen migrations and exposes only exact controlled commands and safe projections', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(25);
    expect(ledger.rows[22].filename).toBe('0023_runtime_intake_reconciliation_commands.sql');
    expect(ledger.rows[10]).toEqual({
      filename: '0011_media_asset_identity_and_lineage_foundation.sql',
      sha256: '1b9fbde392d801ffc8fb0a00a461447cac855bae0046f1d433ac0360b8c15c80'
    });
    expect(ledger.rows[11].filename).toBe('0012_durable_media_operations_reconciliation_foundation.sql');
    const direct = await owner.query(
      `SELECT c.relname, has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS runtime_access,
              has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS public_access
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'medialab_core' AND c.relname LIKE 'media_operation%'`, [RUNTIME_ROLE]
    );
    expect(direct.rows.length).toBeGreaterThanOrEqual(10);
    expect(direct.rows.some((row) => row.runtime_access || row.public_access)).toBe(false);
    const granted = await owner.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname LIKE '%media_operation%'
          AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY p.proname`, [RUNTIME_ROLE]
    );
    expect(granted.rows.map((row) => row.proname)).toEqual([
      'attach_media_operation_target', 'claim_media_operation', 'complete_media_operation_attempt',
      'get_media_operation_record', 'list_claimable_media_operations', 'list_media_operations',
      'ready_media_operation', 'record_media_operation_checkpoint', 'record_media_operation_receipt',
      'record_media_operation_reconciliation', 'request_media_operation', 'request_media_operation_control',
      'schedule_media_operation_retry', 'start_media_operation_attempt'
    ]);
    const publicExec = await owner.query(
      `SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname LIKE '%media_operation%'
          AND has_function_privilege('public', p.oid, 'EXECUTE')`
    );
    expect(publicExec.rows[0].count).toBe(0);
  });

  it('derives the actor, enforces tenant/Job targets, and provides actor-scoped idempotency', async () => {
    const token = await issueSession();
    const media = await setupMedia(token);
    const operationKey = `operation-${crypto.randomUUID()}`;
    const args = [token, operationKey, media.jobId, media.workstreamId, 'PROCESSING', 'SYNTHETIC_RECIPE',
      'Synthetic request', JSON.stringify({ source: SOURCE })];
    const first = await runtimeA.query<{ request_media_operation: string }>(
      'SELECT medialab_core.request_media_operation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', args);
    const replay = await runtimeA.query<{ request_media_operation: string }>(
      'SELECT medialab_core.request_media_operation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', args);
    expect(replay.rows[0].request_media_operation).toBe(first.rows[0].request_media_operation);
    await expectFailure(runtimeA.query(
      'SELECT medialab_core.request_media_operation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, operationKey, media.jobId, media.workstreamId, 'PROCESSING', 'DIFFERENT_REQUEST',
        'Synthetic request', JSON.stringify({ source: SOURCE })]), /Idempotency key conflicts/);
    const secondMedia = await setupMedia(token);
    await expectFailure(runtimeA.query('SELECT medialab_core.attach_media_operation_target($1,$2,$3,$4,$5)',
      [token, `cross-${crypto.randomUUID()}`, first.rows[0].request_media_operation,
        'MEDIA_ASSET_VERSION', secondMedia.versionId]), /cross-tenant, cross-Job/);
    await expectFailure(runtimeA.query('SELECT medialab_core.request_media_operation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `unsafe-${crypto.randomUUID()}`, media.jobId, media.workstreamId, 'TRANSFER', 'UPLOAD',
        'Unsafe evidence must fail', JSON.stringify({ signed_url: 'https://invalid.example/file?signature=secret' })]),
      /Credentials, signed references/);
    const actor = await owner.query('SELECT requested_by_identity_id FROM medialab_core.media_operations WHERE id = $1',
      [first.rows[0].request_media_operation]);
    expect(actor.rows[0].requested_by_identity_id).toBe(STAFF_IDENTITY_ID);
    await expectFailure(runtimeA.query('INSERT INTO medialab_core.media_operations (id) VALUES ($1)', [crypto.randomUUID()]));
  });

  it('allows exactly one concurrent claim, preserves immutable monotonic attempts, and orders checkpoints and receipts', async () => {
    const token = await issueSession();
    const media = await setupMedia(token);
    const { operationId, targetId } = await requestWithTarget(token, media);
    const [claimA, claimB] = await Promise.all([
      runtimeA.query<{ claim_media_operation: any }>('SELECT medialab_core.claim_media_operation($1,$2,$3)',
        ['WORKER.A', `claim-${crypto.randomUUID()}`, 60]),
      runtimeB.query<{ claim_media_operation: any }>('SELECT medialab_core.claim_media_operation($1,$2,$3)',
        ['WORKER.B', `claim-${crypto.randomUUID()}`, 60])
    ]);
    const claims = [claimA.rows[0].claim_media_operation, claimB.rows[0].claim_media_operation];
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    const winner = claims.find((claim) => claim.claimed)!;
    const worker = claimA.rows[0].claim_media_operation.claimed ? 'WORKER.A' : 'WORKER.B';
    const runtime = worker === 'WORKER.A' ? runtimeA : runtimeB;
    expect(winner.operation_id).toBe(operationId);
    expect(winner.attempt_number).toBe(1);
    await runtime.query('SELECT medialab_core.start_media_operation_attempt($1,$2,$3)',
      [worker, `start-${crypto.randomUUID()}`, winner.attempt_id]);
    const checkpointOne = await runtime.query<{ record_media_operation_checkpoint: string }>(
      'SELECT medialab_core.record_media_operation_checkpoint($1,$2,$3,$4,$5::jsonb)',
      [worker, `checkpoint-${crypto.randomUUID()}`, winner.attempt_id, 'STREAM_OPENED', JSON.stringify({ progress: 10 })]);
    await runtime.query('SELECT medialab_core.record_media_operation_checkpoint($1,$2,$3,$4,$5::jsonb)',
      [worker, `checkpoint-${crypto.randomUUID()}`, winner.attempt_id, 'BYTES_VERIFIED', JSON.stringify({ progress: 90 })]);
    await runtime.query(
      'SELECT medialab_core.complete_media_operation_attempt($1,$2,$3,$4,$5,$6::jsonb)',
      [worker, `fail-${crypto.randomUUID()}`, winner.attempt_id, 'FAILED',
        'Synthetic timeout-like failure', JSON.stringify({ failure_class: 'TIMEOUT_LIKE' })]);
    const receipt = await runtime.query<{ record_media_operation_receipt: string }>(
      `SELECT medialab_core.record_media_operation_receipt(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [worker, `late-receipt-${crypto.randomUUID()}`, winner.attempt_id, targetId, 'LATE_TECHNICAL_SUCCESS',
        'synthetic-receipt-1', 1000, VERSION_HASH, 'image/dng', null, 'LATE_SUCCESS', 'VERIFIED',
        JSON.stringify({ arrival: 'AFTER_RECORDED_FAILURE' })]
    );
    expect(receipt.rows[0].record_media_operation_receipt).toMatch(/[0-9a-f-]{36}/);
    await runtime.query(
      `SELECT medialab_core.schedule_media_operation_retry($1,$2,$3,$4,$5,clock_timestamp() + interval '1 millisecond')`,
      [worker, `retry-${crypto.randomUUID()}`, operationId, winner.attempt_id, 'Bounded synthetic retry']);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const retryClaim = await runtimeA.query<{ claim_media_operation: any }>(
      'SELECT medialab_core.claim_media_operation($1,$2,$3)',
      ['WORKER.RETRY', `retry-claim-${crypto.randomUUID()}`, 60]);
    expect(retryClaim.rows[0].claim_media_operation).toMatchObject({ claimed: true, operation_id: operationId, attempt_number: 2 });
    const attempts = await owner.query(
      'SELECT attempt_number, retry_of_attempt_id FROM medialab_core.media_operation_attempts WHERE operation_id = $1 ORDER BY attempt_number',
      [operationId]);
    expect(attempts.rows).toEqual([
      { attempt_number: 1, retry_of_attempt_id: null },
      { attempt_number: 2, retry_of_attempt_id: winner.attempt_id }
    ]);
    const checkpoints = await owner.query(
      'SELECT checkpoint_sequence FROM medialab_core.media_operation_checkpoints WHERE attempt_id = $1 ORDER BY checkpoint_sequence',
      [winner.attempt_id]);
    expect(checkpoints.rows).toEqual([{ checkpoint_sequence: 1 }, { checkpoint_sequence: 2 }]);
    await expectFailure(owner.query('UPDATE medialab_core.media_operation_attempts SET worker_key = $1 WHERE id = $2',
      ['WORKER.MUTATION', winner.attempt_id]), /immutable append-only/);
    await expectFailure(owner.query('DELETE FROM medialab_core.media_operation_checkpoints WHERE id = $1',
      [checkpointOne.rows[0].record_media_operation_checkpoint]), /immutable append-only/);
  });

  it('records late success and all reconciliation classes without rewriting command, attempt, or receipt history', async () => {
    const token = await issueSession();
    const media = await setupMedia(token);
    const { operationId, targetId } = await requestWithTarget(token, media);
    const claim = await runtimeA.query<{ claim_media_operation: any }>(
      'SELECT medialab_core.claim_media_operation($1,$2,$3)', ['WORKER.RECONCILE', `claim-${crypto.randomUUID()}`, 60]);
    const attemptId = claim.rows[0].claim_media_operation.attempt_id;
    await runtimeA.query('SELECT medialab_core.start_media_operation_attempt($1,$2,$3)',
      ['WORKER.RECONCILE', `start-${crypto.randomUUID()}`, attemptId]);
    await runtimeA.query('SELECT medialab_core.complete_media_operation_attempt($1,$2,$3,$4,$5,$6::jsonb)',
      ['WORKER.RECONCILE', `fail-${crypto.randomUUID()}`, attemptId, 'FAILED', 'Synthetic timeout recorded',
        JSON.stringify({ failure_class: 'TIMEOUT_LIKE' })]);
    const findingTypes = [
      'LATE_SUCCESS_AFTER_FAILURE', 'DUPLICATE_TECHNICAL_EFFECT', 'ORPHANED_OBJECT_PRESENT',
      'UNEXPECTED_OBJECT_PRESENT', 'EXPECTED_OBJECT_MISSING', 'CHECKSUM_CONFLICT',
      'STALE_CANONICAL_PROJECTION', 'RETRY_AMBIGUITY', 'MANUAL_REVIEW_REQUIRED'
    ];
    for (const finding of findingTypes) {
      await runtimeA.query(
        'SELECT medialab_core.record_media_operation_reconciliation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [token, `reconcile-${finding}-${crypto.randomUUID()}`, operationId, attemptId,
          finding.includes('ORPHANED') || finding.includes('UNEXPECTED') ? null : targetId,
          finding, 'MANUAL_REVIEW_REQUIRED', JSON.stringify({ source: SOURCE, finding })]
      );
    }
    const resolved = await runtimeA.query<{ record_media_operation_reconciliation: string }>(
      'SELECT medialab_core.record_media_operation_reconciliation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `resolve-${crypto.randomUUID()}`, operationId, attemptId, targetId,
        'EXPECTED_EFFECT_VERIFIED', 'EXPECTED_EFFECT_VERIFIED', JSON.stringify({ source: SOURCE })]
    );
    const record = await runtimeA.query<{ record: any }>(
      'SELECT medialab_core.get_media_operation_record($1,$2) AS record', [token, operationId]);
    expect(record.rows[0].record.projection.current_state).toBe('RECONCILED');
    expect(record.rows[0].record.reconciliations).toHaveLength(findingTypes.length + 1);
    expect(record.rows[0].record.attempts).toHaveLength(1);
    expect(record.rows[0].record.events.some((event: any) => event.event_type === 'FAILED')).toBe(true);
    await expectFailure(owner.query('DELETE FROM medialab_core.media_operation_reconciliations WHERE id = $1',
      [resolved.rows[0].record_media_operation_reconciliation]), /immutable append-only/);
  });

  it('keeps stop, cancellation, override, manual fallback, and technical results as distinct facts', async () => {
    const token = await issueSession();
    const media = await setupMedia(token);
    const { operationId, targetId } = await requestWithTarget(token, media);
    const claim = await runtimeA.query<{ claim_media_operation: any }>(
      'SELECT medialab_core.claim_media_operation($1,$2,$3)', ['WORKER.CONTROL', `claim-${crypto.randomUUID()}`, 60]);
    const attemptId = claim.rows[0].claim_media_operation.attempt_id;
    await runtimeA.query('SELECT medialab_core.start_media_operation_attempt($1,$2,$3)',
      ['WORKER.CONTROL', `start-${crypto.randomUUID()}`, attemptId]);
    await runtimeA.query(
      `SELECT medialab_core.record_media_operation_receipt(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      ['WORKER.CONTROL', `receipt-${crypto.randomUUID()}`, attemptId, targetId, 'TECHNICAL_OBSERVATION',
        'synthetic-receipt-control', 1000, VERSION_HASH, 'image/dng', null, 'OBSERVED', 'PROVISIONAL', '{}']
    );
    let projection = await owner.query('SELECT current_state FROM medialab_core.media_operation_projections WHERE operation_id = $1', [operationId]);
    expect(projection.rows[0].current_state).toBe('STARTED');
    for (const control of ['OVERRIDE_RECORDED', 'STOP_REQUESTED']) {
      await runtimeA.query('SELECT medialab_core.request_media_operation_control($1,$2,$3,$4,$5,$6::jsonb)',
        [token, `control-${control}-${crypto.randomUUID()}`, operationId, control,
          `Synthetic ${control}`, JSON.stringify({ source: SOURCE })]);
    }
    await runtimeA.query('SELECT medialab_core.complete_media_operation_attempt($1,$2,$3,$4,$5,$6::jsonb)',
      ['WORKER.CONTROL', `stopped-${crypto.randomUUID()}`, attemptId, 'STOPPED', 'Worker honored stop request', '{}']);
    await runtimeA.query('SELECT medialab_core.request_media_operation_control($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `fallback-${crypto.randomUUID()}`, operationId, 'MANUAL_FALLBACK_RECORDED',
        'Synthetic manual fallback preserved', JSON.stringify({ source: SOURCE })]);
    const cancellation = await runtimeA.query<{ request_media_operation: string }>(
      'SELECT medialab_core.request_media_operation($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `cancel-op-${crypto.randomUUID()}`, media.jobId, media.workstreamId, 'TRANSFER', 'COPY',
        'Synthetic cancellation request', '{}']);
    await runtimeA.query('SELECT medialab_core.request_media_operation_control($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `cancel-${crypto.randomUUID()}`, cancellation.rows[0].request_media_operation,
        'CANCELLATION_REQUESTED', 'Synthetic cancellation', '{}']);
    const controls = await owner.query(
      `SELECT request_type FROM medialab_core.media_operation_control_requests
        WHERE operation_id = $1 ORDER BY requested_at, id`, [operationId]);
    expect(controls.rows.map((row) => row.request_type).sort()).toEqual(
      ['MANUAL_FALLBACK_RECORDED', 'OVERRIDE_RECORDED', 'STOP_REQUESTED']);
    await expectFailure(owner.query(
      'UPDATE medialab_core.media_operation_projections SET current_state = $1 WHERE operation_id = $2',
      ['SUCCEEDED', operationId]), /controlled commands/);
    const peopleBefore = await owner.query('SELECT count(*)::int AS count FROM medialab_core.people');
    expect(peopleBefore.rows[0].count).toBe(PEOPLE_FIXTURES.length);
  });
});
