import crypto from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PERMISSION_SET_FIXTURE } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m16a_test';
const OWNER_ROLE = 'medialab_p02m16a_test_owner';
const RUNTIME_ROLE = 'medialab_p02m16a_test_app';
const SOCKET = '/tmp/mlvs01-p02m16a-pg';
const PORT = 55447;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M20_A_TEST';
const RANGE = {
  source_in_ticks: 30000,
  source_out_ticks: 120000,
  ticks_per_second: 30000,
  frame_duration_ticks: 1000,
  leading_handle_ticks: 3000,
  trailing_handle_ticks: 3000
};
const OBSERVATION = {
  duration_ticks: 300000,
  ticks_per_second: 30000,
  frame_duration_ticks: 1000,
  start_timecode_ticks: 324000000,
  width_pixels: 3840,
  height_pixels: 2160,
  orientation: 'LANDSCAPE',
  nominal_frame_rate_numerator: 30,
  nominal_frame_rate_denominator: 1,
  actual_frame_rate_numerator: 30,
  actual_frame_rate_denominator: 1,
  codec: 'Synthetic ProRes 422',
  bit_depth: 10,
  camera_make_model: 'Synthetic Camera A',
  device_identifier: 'SYNTH_CAM_A',
  lens: 'Synthetic 24-70',
  picture_profile: 'SYNTH_LOG',
  color_space: 'SYNTH_WIDE_GAMUT',
  audio_channels: 2,
  audio_sample_rate_hz: 48000,
  proxy_compatibility: 'SUPPORTED',
  confidence: 'HIGH'
};

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('P02-M20-A editorial segment foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({
      host: SOCKET,
      port: PORT,
      database: TEST_DB,
      user: OWNER_ROLE,
      runtimeUser: RUNTIME_ROLE,
      confirm: TEST_DB
    });
  }

  async function issueSession(): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
       (id,identity_id,token_sha256,issued_at,expires_at,revoked_at)
       VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',NULL)`,
      [crypto.randomUUID(), STAFF_IDENTITY_ID, digest(token)]
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

  async function setupJob(token: string): Promise<{ jobId: string; workstreamId: string }> {
    const job = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE]
    );
    const workstream = await runtime.query<{ create_service_workstream: string }>(
      'SELECT medialab_core.create_service_workstream($1,$2,$3,$4,$5)',
      [token, `workstream-${crypto.randomUUID()}`, job.rows[0].create_job, ORDER_ITEM_FIXTURES[0].id, SOURCE]
    );
    return { jobId: job.rows[0].create_job, workstreamId: workstream.rows[0].create_service_workstream };
  }

  async function createVideoSource(
    token: string,
    jobId: string,
    workstreamId: string,
    checksum = digest(`synthetic-video-${crypto.randomUUID()}`)
  ): Promise<{ assetId: string; versionId: string; workspaceId: string; candidateId: string }> {
    const asset = await runtime.query<{ create_media_asset: string }>(
      'SELECT medialab_core.create_media_asset($1,$2,$3,$4,$5::jsonb)',
      [token, `asset-${crypto.randomUUID()}`, jobId, workstreamId, JSON.stringify({ source: SOURCE })]
    );
    const version = await runtime.query<{ add_media_asset_version: string }>(
      'SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token, `version-${crypto.randomUUID()}`, asset.rows[0].create_media_asset, 'ORIGINAL',
        'synthetic-clip.mov', 123456, 'video/quicktime', checksum, SOURCE]
    );
    const workspace = await runtime.query<{ create_cull_workspace: string }>(
      'SELECT medialab_core.create_cull_workspace($1,$2,$3,$4::uuid,$5,$6,$7,$8::jsonb)',
      [token, `workspace-${crypto.randomUUID()}`, jobId, workstreamId, 'VIDEO', 'Synthetic video cull',
        'Synthetic editorial segment test', JSON.stringify({ source: SOURCE })]
    );
    const candidate = await runtime.query<{ admit_cull_candidate: string }>(
      'SELECT medialab_core.admit_cull_candidate($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb)',
      [token, `candidate-${crypto.randomUUID()}`, workspace.rows[0].create_cull_workspace,
        asset.rows[0].create_media_asset, version.rows[0].add_media_asset_version, [], JSON.stringify({ source: SOURCE })]
    );
    return {
      assetId: asset.rows[0].create_media_asset,
      versionId: version.rows[0].add_media_asset_version,
      workspaceId: workspace.rows[0].create_cull_workspace,
      candidateId: candidate.rows[0].admit_cull_candidate
    };
  }

  async function observe(
    token: string,
    versionId: string,
    kind = 'OBSERVED_METADATA',
    generation = 0,
    observation: Record<string, unknown> = OBSERVATION,
    key = `observation-${crypto.randomUUID()}`
  ): Promise<string> {
    const result = await runtime.query<{ record_media_technical_observation: string }>(
      'SELECT medialab_core.record_media_technical_observation($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)',
      [token, key, versionId, kind, JSON.stringify(observation), 'SYNTHETIC_METADATA', generation,
        JSON.stringify({ source: SOURCE })]
    );
    return result.rows[0].record_media_technical_observation;
  }

  async function createSegment(
    client: pg.Client,
    token: string,
    candidateId: string,
    observationId: string,
    name: string,
    range: Record<string, unknown> = RANGE,
    key = `segment-${crypto.randomUUID()}`
  ): Promise<string> {
    const result = await client.query<{ create_editorial_segment: string }>(
      'SELECT medialab_core.create_editorial_segment($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb)',
      [token, key, candidateId, observationId, JSON.stringify(range), name, 'CEREMONY', 'PRIMARY', 10,
        'Synthetic segment note', JSON.stringify({ source: SOURCE })]
    );
    return result.rows[0].create_editorial_segment;
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE });
    runtime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME_ROLE });
    await owner.connect();
    await runtime.connect();
  });

  beforeEach(async () => { await reset(); });

  afterAll(async () => {
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    await reset();
  });

  it('replays exact 0001-0027, seeds permissions only, and grants only seven controlled runtime APIs', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(27);
    expect(ledger.rows[25].filename).toBe('0026_editorial_segment_foundation.sql');
    expect(ledger.rows[26].filename).toBe('0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql');
    const permissions = await owner.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'editorial_segment.%' ORDER BY code");
    expect(permissions.rows.map((row) => row.code)).toEqual(['editorial_segment.manage', 'editorial_segment.read']);
    const seeded = await owner.query(`SELECT sum(n)::int AS n FROM (
      SELECT count(*) n FROM medialab_core.media_technical_observations
      UNION ALL SELECT count(*) FROM medialab_core.editorial_segments
      UNION ALL SELECT count(*) FROM medialab_core.editorial_segment_versions
      UNION ALL SELECT count(*) FROM medialab_core.editorial_segment_decision_events
    ) q`);
    expect(seeded.rows[0].n).toBe(0);
    const functions = await owner.query(`SELECT p.proname,
      has_function_privilege($1,p.oid,'EXECUTE') AS runtime,
      has_function_privilege('public',p.oid,'EXECUTE') AS public
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND
        (p.proname LIKE '%editorial_segment%' OR p.proname='record_media_technical_observation')
      ORDER BY p.proname`, [RUNTIME_ROLE]);
    expect(functions.rows.filter((row) => row.runtime).map((row) => row.proname)).toEqual([
      'clear_editorial_segment_decision', 'create_editorial_segment', 'decide_editorial_segment',
      'get_editorial_segment', 'list_editorial_segments', 'record_media_technical_observation',
      'revise_editorial_segment'
    ]);
    expect(functions.rows.some((row) => row.public)).toBe(false);
    const tables = await owner.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='medialab_core' AND (c.relname LIKE 'editorial_segment%' OR c.relname LIKE 'media_technical_observation%')
      AND (has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR
           has_table_privilege('public',c.oid,'SELECT,INSERT,UPDATE,DELETE'))`, [RUNTIME_ROLE]);
    expect(tables.rows[0].n).toBe(0);
  });

  it('records observed metadata and attributable operator correction without overwriting history', async () => {
    const token = await issueSession();
    const job = await setupJob(token);
    const source = await createVideoSource(token, job.jobId, job.workstreamId);
    const first = await observe(token, source.versionId);
    const corrected = await observe(token, source.versionId, 'OPERATOR_CORRECTION', 1,
      { ...OBSERVATION, actual_frame_rate_numerator: 30000, actual_frame_rate_denominator: 1001, confidence: 'OPERATOR_CONFIRMED' });
    expect(corrected).not.toBe(first);
    const rows = await owner.query(`SELECT id,observation_kind,supersedes_observation_id,recorded_by_identity_id
      FROM medialab_core.media_technical_observations WHERE media_asset_version_id=$1 ORDER BY recorded_at,id`, [source.versionId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1]).toMatchObject({ id: corrected, observation_kind: 'OPERATOR_CORRECTION',
      supersedes_observation_id: first, recorded_by_identity_id: STAFF_IDENTITY_ID });
    await expectFailure(observe(token, source.versionId, 'OPERATOR_CORRECTION', 1), /Stale technical observation generation/);
    await expectFailure(owner.query('UPDATE medialab_core.media_technical_observations SET confidence=$1 WHERE id=$2', ['LOW', first]),
      /immutable append-only/);

    const concurrentSource = await createVideoSource(token, job.jobId, job.workstreamId);
    const secondRuntime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME_ROLE });
    await secondRuntime.connect();
    try {
      const command = (client: pg.Client, key: string) => client.query(
        'SELECT medialab_core.record_media_technical_observation($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)',
        [token, key, concurrentSource.versionId, 'OBSERVED_METADATA', JSON.stringify(OBSERVATION),
          'SYNTHETIC_METADATA', 0, JSON.stringify({ source: SOURCE })]
      );
      const results = await Promise.allSettled([
        command(runtime, `concurrent-observation-a-${crypto.randomUUID()}`),
        command(secondRuntime, `concurrent-observation-b-${crypto.randomUUID()}`)
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message)
        .toMatch(/Stale technical observation generation/);
      const concurrentCount = await owner.query('SELECT count(*)::int AS n FROM medialab_core.media_technical_observations WHERE media_asset_version_id=$1',
        [concurrentSource.versionId]);
      expect(concurrentCount.rows[0].n).toBe(1);
    } finally {
      await secondRuntime.end();
    }
  });

  it('creates multiple overlapping segments without merging and converges exact retry and concurrent same-request calls', async () => {
    const token = await issueSession();
    const job = await setupJob(token);
    const source = await createVideoSource(token, job.jobId, job.workstreamId);
    const observationId = await observe(token, source.versionId);
    const key = `same-request-${crypto.randomUUID()}`;
    const secondRuntime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME_ROLE });
    await secondRuntime.connect();
    try {
      const [one, replay] = await Promise.all([
        createSegment(runtime, token, source.candidateId, observationId, 'CEREMONY_VOWS_A', RANGE, key),
        createSegment(secondRuntime, token, source.candidateId, observationId, 'CEREMONY_VOWS_A', RANGE, key)
      ]);
      expect(replay).toBe(one);
      expect(await createSegment(runtime, token, source.candidateId, observationId, 'CEREMONY_VOWS_A', RANGE, key)).toBe(one);
      const overlapping = await createSegment(runtime, token, source.candidateId, observationId, 'CEREMONY_VOWS_B',
        { ...RANGE, source_in_ticks: 60000, source_out_ticks: 150000 });
      expect(overlapping).not.toBe(one);
      const count = await owner.query('SELECT count(*)::int AS n FROM medialab_core.editorial_segments WHERE media_asset_version_id=$1', [source.versionId]);
      expect(count.rows[0].n).toBe(2);
    } finally {
      await secondRuntime.end();
    }
  });

  it('preserves source identity through revisions and records every decision correction and clear', async () => {
    const token = await issueSession();
    const job = await setupJob(token);
    const source = await createVideoSource(token, job.jobId, job.workstreamId);
    const observationId = await observe(token, source.versionId);
    const segmentId = await createSegment(runtime, token, source.candidateId, observationId, 'CEREMONY_PROCESSIONAL_A');
    const revised = await runtime.query<{ revise_editorial_segment: string }>(
      'SELECT medialab_core.revise_editorial_segment($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb)',
      [token, `revise-${crypto.randomUUID()}`, segmentId, observationId,
        JSON.stringify({ ...RANGE, source_out_ticks: 150000 }), 'CEREMONY_PROCESSIONAL_A2', 'CEREMONY', 'PRIMARY', 11,
        'Synthetic corrected segment', 1, JSON.stringify({ source: SOURCE })]
    );
    expect(revised.rows[0].revise_editorial_segment).toBeTruthy();
    await expectFailure(runtime.query(
      'SELECT medialab_core.revise_editorial_segment($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12::jsonb)',
      [token, `stale-${crypto.randomUUID()}`, segmentId, observationId, JSON.stringify(RANGE), 'STALE', 'CEREMONY', 'PRIMARY', 12,
        'Synthetic stale edit', 1, JSON.stringify({ source: SOURCE })]), /Stale editorial segment version generation/);
    const states = ['SELECTED', 'REJECTED', 'UNSELECTED', 'APPROVED_UNUSED', 'RESERVED'];
    for (let generation = 0; generation < states.length; generation += 1) {
      await runtime.query('SELECT medialab_core.decide_editorial_segment($1,$2,$3,$4,$5,$6,$7::jsonb)',
        [token, `decision-${crypto.randomUUID()}`, segmentId, states[generation], `Synthetic ${states[generation]} decision`, generation,
          JSON.stringify({ source: SOURCE })]);
    }
    await expectFailure(runtime.query('SELECT medialab_core.decide_editorial_segment($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `stale-decision-${crypto.randomUUID()}`, segmentId, 'SELECTED', 'Synthetic stale decision', 4,
        JSON.stringify({ source: SOURCE })]), /Stale editorial segment decision generation/);
    await runtime.query('SELECT medialab_core.clear_editorial_segment_decision($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `clear-${crypto.randomUUID()}`, segmentId, 'Synthetic explicit clear', 5, JSON.stringify({ source: SOURCE })]);
    const record = await runtime.query<{ get_editorial_segment: any }>('SELECT medialab_core.get_editorial_segment($1,$2)', [token, segmentId]);
    expect(record.rows[0].get_editorial_segment.segment.media_asset_version_id).toBe(source.versionId);
    expect(record.rows[0].get_editorial_segment.versions).toHaveLength(2);
    expect(record.rows[0].get_editorial_segment.decisions).toHaveLength(6);
    expect(record.rows[0].get_editorial_segment.current.current_decision_state).toBeNull();
  });

  it('rejects invalid bounds, timebases, handles, unsafe evidence, and invalid names atomically', async () => {
    const token = await issueSession();
    const job = await setupJob(token);
    const source = await createVideoSource(token, job.jobId, job.workstreamId);
    const observationId = await observe(token, source.versionId);
    const invalidRanges = [
      { ...RANGE, source_in_ticks: -1000 },
      { ...RANGE, source_out_ticks: 300001 },
      { ...RANGE, source_in_ticks: 30001 },
      { ...RANGE, ticks_per_second: 24000 },
      { ...RANGE, leading_handle_ticks: 31000 },
      { ...RANGE, trailing_handle_ticks: 181000 }
    ];
    for (const range of invalidRanges) {
      await expectFailure(createSegment(runtime, token, source.candidateId, observationId, 'INVALID_RANGE', range),
        /range, handles, or timebase/);
    }
    await expectFailure(createSegment(runtime, token, source.candidateId, observationId, '../unsafe-name'), /name_check/);
    const unsafeEvidence = [
      { signed_url: 'https://example.invalid/media' },
      { access_token: 'synthetic-prohibited-value' },
      { source: '/Volumes/prohibited/source.mov' },
      { source: '/Users/prohibited/source.mov' },
      { source: 'file:///tmp/prohibited.mov' },
      { source: 'C:\\prohibited\\source.mov' },
      { note: 'x'.repeat(33_000) }
    ];
    for (const evidence of unsafeEvidence) {
      await expectFailure(runtime.query(
        'SELECT medialab_core.create_editorial_segment($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11::jsonb)',
        [token, `unsafe-${crypto.randomUUID()}`, source.candidateId, observationId, JSON.stringify(RANGE), 'SAFE_NAME',
          'CEREMONY', 'PRIMARY', 10, 'Synthetic note', JSON.stringify(evidence)]),
      /Secrets, URLs, and absolute paths|bounded JSON object/);
    }
    const count = await owner.query('SELECT count(*)::int AS n FROM medialab_core.editorial_segments');
    expect(count.rows[0].n).toBe(0);
  });

  it('rejects cross-source observations and proves a failed transaction leaves no segment or idempotency residue', async () => {
    const token = await issueSession();
    const one = await setupJob(token);
    const two = await setupJob(token);
    const first = await createVideoSource(token, one.jobId, one.workstreamId, digest('same-synthetic-bytes'));
    const second = await createVideoSource(token, two.jobId, two.workstreamId, digest('same-synthetic-bytes'));
    const firstObservation = await observe(token, first.versionId);
    const secondObservation = await observe(token, second.versionId);
    await expectFailure(createSegment(runtime, token, first.candidateId, secondObservation, 'CROSS_JOB'), /cross-scope/);
    const firstSegment = await createSegment(runtime, token, first.candidateId, firstObservation, 'JOB_ONE_SEGMENT');
    const secondSegment = await createSegment(runtime, token, second.candidateId, secondObservation, 'JOB_TWO_SEGMENT');
    expect(secondSegment).not.toBe(firstSegment);

    const transactionKey = `transaction-${crypto.randomUUID()}`;
    await runtime.query('BEGIN');
    try {
      await createSegment(runtime, token, first.candidateId, firstObservation, 'WILL_ROLL_BACK', RANGE, transactionKey);
      await createSegment(runtime, token, first.candidateId, firstObservation, 'INVALID', { ...RANGE, source_out_ticks: 999999 });
      throw new Error('Expected transaction to fail');
    } catch (error: any) {
      expect(error.message).toMatch(/range, handles, or timebase/);
      await runtime.query('ROLLBACK');
    }
    const residue = await owner.query(`SELECT
      (SELECT count(*)::int FROM medialab_core.editorial_segments WHERE job_id=$1 AND id NOT IN ($2::uuid)) AS segments,
      (SELECT count(*)::int FROM medialab_core.media_command_idempotency WHERE idempotency_key=$3) AS idempotency`,
      [one.jobId, firstSegment, transactionKey]);
    expect(residue.rows[0]).toEqual({ segments: 0, idempotency: 0 });
  });

  it('preserves least privilege, append-only evidence, projections, and all media-operation non-events', async () => {
    const token = await issueSession();
    const job = await setupJob(token);
    const source = await createVideoSource(token, job.jobId, job.workstreamId);
    const observationId = await observe(token, source.versionId);
    const segmentId = await createSegment(runtime, token, source.candidateId, observationId, 'DETAILS_RING_A');
    await runtime.query('SELECT medialab_core.decide_editorial_segment($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `selected-${crypto.randomUUID()}`, segmentId, 'SELECTED', 'Synthetic selected segment', 0,
        JSON.stringify({ source: SOURCE })]);
    const listed = await runtime.query<{ list_editorial_segments: any }>(
      'SELECT medialab_core.list_editorial_segments($1,$2,$3,$4)', [token, job.jobId, job.workstreamId, 'SELECTED']);
    expect(listed.rows[0].list_editorial_segments).toHaveLength(1);
    await expectFailure(runtime.query('INSERT INTO medialab_core.editorial_segments(id) VALUES($1)', [crypto.randomUUID()]),
      /permission denied/);
    await expectFailure(owner.query('DELETE FROM medialab_core.editorial_segment_versions WHERE segment_id=$1', [segmentId]),
      /immutable append-only/);
    const nonEvents = await owner.query(`SELECT
      (SELECT count(*)::int FROM medialab_core.media_storage_objects) AS storage,
      (SELECT count(*)::int FROM medialab_core.media_transfer_events) AS transfers,
      (SELECT count(*)::int FROM medialab_core.media_operations) AS operations,
      (SELECT count(*)::int FROM medialab_core.media_approved_source_designations) AS approved_sources`);
    expect(nonEvents.rows[0]).toEqual({ storage: 0, transfers: 0, operations: 0, approved_sources: 0 });
    const schema = await owner.query(`SELECT has_schema_privilege('public','medialab_core','USAGE') AS usage,
      has_schema_privilege('public','medialab_core','CREATE') AS can_create`);
    expect(schema.rows[0]).toEqual({ usage: false, can_create: false });
    const permission = await owner.query("SELECT id FROM medialab_core.permissions WHERE code='editorial_segment.manage'");
    await owner.query('DELETE FROM medialab_core.permission_set_permissions WHERE permission_set_id=$1 AND permission_id=$2',
      [PERMISSION_SET_FIXTURE.id, permission.rows[0].id]);
    await expectFailure(observe(token, source.versionId, 'OPERATOR_CORRECTION', 1), /lacks active editorial_segment.manage authority/);
  });
});
