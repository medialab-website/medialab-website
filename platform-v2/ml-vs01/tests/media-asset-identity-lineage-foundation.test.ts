import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m08a_test';
const OWNER_ROLE = 'medialab_p02m08a_test_owner';
const RUNTIME_ROLE = 'medialab_p02m08a_test_app';
const SOCKET = '/tmp/mlvs01-p02m08a-pg';
const PORT = 55438;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M08_A_TEST';
const ORIGINAL_HASH = crypto.createHash('sha256').update('synthetic-original-bytes').digest('hex');
const CORRECTED_HASH = crypto.createHash('sha256').update('synthetic-corrected-bytes').digest('hex');

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('P02-M08-A Media Asset Identity and Lineage foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE,
      runtimeUser: RUNTIME_ROLE, confirm: TEST_DB });
  }

  async function issueSession(): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour', NULL)`,
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

  async function setupJob(token: string): Promise<{jobId: string; workstreamId: string}> {
    const job = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1, $2, $3, $4, $5, $6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE]
    );
    const workstream = await runtime.query<{ create_service_workstream: string }>(
      'SELECT medialab_core.create_service_workstream($1, $2, $3, $4, $5)',
      [token, `workstream-${crypto.randomUUID()}`, job.rows[0].create_job, ORDER_ITEM_FIXTURES[0].id, SOURCE]
    );
    return { jobId: job.rows[0].create_job, workstreamId: workstream.rows[0].create_service_workstream };
  }

  async function createAsset(token: string, jobId: string, workstreamId: string, key = `asset-${crypto.randomUUID()}`): Promise<string> {
    const result = await runtime.query<{ create_media_asset: string }>(
      'SELECT medialab_core.create_media_asset($1, $2, $3, $4, $5::jsonb)',
      [token, key, jobId, workstreamId, JSON.stringify({ source: SOURCE, capture_context: 'SYNTHETIC_ONLY' })]
    );
    return result.rows[0].create_media_asset;
  }

  async function addVersion(token: string, assetId: string, kind: string, filename: string, checksum: string, key = `version-${crypto.randomUUID()}`): Promise<string> {
    const result = await runtime.query<{ add_media_asset_version: string }>(
      'SELECT medialab_core.add_media_asset_version($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [token, key, assetId, kind, filename, 12345, 'image/dng', checksum, SOURCE]
    );
    return result.rows[0].add_media_asset_version;
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

  it('replays eleven migrations, preserves 0010, and exposes only the controlled runtime inventory', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(11);
    expect(ledger.rows[9]).toEqual({
      filename: '0010_mission_plan_foundation.sql',
      sha256: '2342a7935a27534a4e45233162d35b8b4200839ac0b3fb8394d19015521629c3'
    });
    expect(ledger.rows[10].filename).toBe('0011_media_asset_identity_and_lineage_foundation.sql');
    const direct = await owner.query(
      `SELECT count(*)::int AS count FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core' AND table_name LIKE 'media_%'`, [RUNTIME_ROLE]
    );
    expect(direct.rows[0].count).toBe(0);
    const sequence = await owner.query(
      `SELECT count(*)::int AS count FROM information_schema.role_usage_grants
        WHERE grantee = $1 AND object_schema = 'medialab_core' AND object_type = 'SEQUENCE'`, [RUNTIME_ROLE]
    );
    expect(sequence.rows[0].count).toBe(0);
    const grants = await owner.query(
      `SELECT p.proname, has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname LIKE '%media%' ORDER BY p.proname`, [RUNTIME_ROLE]
    );
    const publicNames = ['add_media_asset_version', 'create_media_asset', 'create_media_manifest',
      'designate_media_approved_source', 'get_media_asset_record', 'get_media_manifest',
      'record_media_capture_relationship', 'record_media_lineage', 'record_media_location_observation',
      'record_media_storage_object', 'record_media_transfer_event', 'record_media_verification_event'];
    expect(grants.rows.filter((row) => row.runtime_execute).map((row) => row.proname).sort()).toEqual(publicNames.sort());
    expect(grants.rows.some((row) => row.public_execute)).toBe(false);
  });

  it('keeps logical identity independent from filenames and locations while preserving immutable versions and corrected lineage', async () => {
    const token = await issueSession();
    const { jobId, workstreamId } = await setupJob(token);
    const key = `asset-${crypto.randomUUID()}`;
    const assetId = await createAsset(token, jobId, workstreamId, key);
    expect(await createAsset(token, jobId, workstreamId, key)).toBe(assetId);
    const originalId = await addVersion(token, assetId, 'ORIGINAL', 'CARD_A/IMG_0001.DNG', ORIGINAL_HASH);
    const correctedId = await addVersion(token, assetId, 'QUICK_EDIT_CORRECTION', 'renamed-final-v7.dng', CORRECTED_HASH);
    await runtime.query('SELECT medialab_core.record_media_lineage($1,$2,$3,$4,$5,$6)',
      [token, `lineage-${crypto.randomUUID()}`, originalId, correctedId, 'EDITOR_RETURN_TO_CORRECTED_VERSION', 'Synthetic corrected-version evidence']);
    await runtime.query('SELECT medialab_core.record_media_lineage($1,$2,$3,$4,$5,$6)',
      [token, `supersede-${crypto.randomUUID()}`, originalId, correctedId, 'SUPERSEDES', 'Synthetic non-overwriting supersession']);
    const storage = await runtime.query<{ record_media_storage_object: string }>(
      'SELECT medialab_core.record_media_storage_object($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [token, `storage-${crypto.randomUUID()}`, originalId, 'SYNTHETIC_STORE', 'bucket-a', 'object-0001', ORIGINAL_HASH, 12345, 'image/dng', SOURCE]
    );
    await runtime.query('SELECT medialab_core.record_media_location_observation($1,$2,$3,$4,$5,$6)',
      [token, `loc-${crypto.randomUUID()}`, storage.rows[0].record_media_storage_object, '/capture/card-a/IMG_0001.DNG', 'OBSERVED_PRESENT', SOURCE]);
    await runtime.query('SELECT medialab_core.record_media_location_observation($1,$2,$3,$4,$5,$6)',
      [token, `move-${crypto.randomUUID()}`, storage.rows[0].record_media_storage_object, '/staging/renamed-original.dng', 'MOVED', SOURCE]);
    const read = await runtime.query('SELECT medialab_core.get_media_asset_record($1,$2) AS record', [token, assetId]);
    expect(read.rows[0].record.asset.id).toBe(assetId);
    expect(read.rows[0].record.versions.map((v: any) => v.observed_filename)).toEqual(['CARD_A/IMG_0001.DNG', 'renamed-final-v7.dng']);
    await expectFailure(owner.query('UPDATE medialab_core.media_asset_versions SET observed_filename = $1 WHERE id = $2', ['overwrite.dng', originalId]), /immutable append-only/);
    await expectFailure(runtime.query('SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token, `version-${crypto.randomUUID()}`, assetId, 'ORIGINAL', 'second-original.dng', 12345, 'image/dng', ORIGINAL_HASH, SOURCE]));
    const actor = await owner.query('SELECT created_by_identity_id FROM medialab_core.media_assets WHERE id = $1', [assetId]);
    expect(actor.rows[0].created_by_identity_id).toBe(STAFF_IDENTITY_ID);
  });

  it('records capture pairs, verification, retry/receipt evidence, and append-only approved-source history', async () => {
    const token = await issueSession();
    const { jobId, workstreamId } = await setupJob(token);
    const firstAsset = await createAsset(token, jobId, workstreamId);
    const secondAsset = await createAsset(token, jobId, workstreamId);
    const raw = await addVersion(token, firstAsset, 'ORIGINAL', 'IMG_0100.DNG', ORIGINAL_HASH);
    const jpeg = await addVersion(token, secondAsset, 'ORIGINAL', 'IMG_0100.JPG', CORRECTED_HASH);
    for (const kind of ['HDR_BRACKET', 'CAPTURE_GROUP', 'JPEG_RAW_PAIR', 'DRONE_JPEG_DNG_PAIR', 'SELECTED_MEDIA']) {
      await runtime.query('SELECT medialab_core.record_media_capture_relationship($1,$2,$3,$4,$5,$6)',
        [token, `rel-${crypto.randomUUID()}`, raw, jpeg, kind, `GROUP-${kind}`]);
    }
    const storage = await runtime.query<{ record_media_storage_object: string }>(
      'SELECT medialab_core.record_media_storage_object($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [token, `storage-${crypto.randomUUID()}`, raw, 'SYNTHETIC_STORE', 'capture', 'raw-0100', ORIGINAL_HASH, 12345, 'image/dng', SOURCE]
    );
    await runtime.query('SELECT medialab_core.record_media_verification_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `verify-fail-${crypto.randomUUID()}`, raw, 'SHA256', 'FAILED', CORRECTED_HASH, JSON.stringify({ reason: 'synthetic mismatch' })]);
    await runtime.query('SELECT medialab_core.record_media_verification_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `verify-ok-${crypto.randomUUID()}`, raw, 'SHA256', 'VERIFIED', ORIGINAL_HASH, JSON.stringify({ receipt: 'synthetic verified' })]);
    await runtime.query('SELECT medialab_core.record_media_transfer_event($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
      [token, `transfer-fail-${crypto.randomUUID()}`, storage.rows[0].record_media_storage_object, 'HANDOFF', 'FAILED', 1, 'handoff-a', null, JSON.stringify({ failure: 'synthetic timeout' })]);
    await runtime.query('SELECT medialab_core.record_media_transfer_event($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
      [token, `transfer-retry-${crypto.randomUUID()}`, storage.rows[0].record_media_storage_object, 'HANDOFF', 'SUCCEEDED', 2, 'handoff-a', 'receipt-synthetic-2', JSON.stringify({ retry_of_attempt: 1 })]);
    const originalDesignation = await runtime.query<{ designate_media_approved_source: string }>(
      'SELECT medialab_core.designate_media_approved_source($1,$2,$3,$4,$5,$6,$7)',
      [token, `designation-${crypto.randomUUID()}`, raw, 'QUICK_EDIT_PATH', 'USE_ORIGINAL', null, 'Synthetic use-original compatibility']
    );
    await runtime.query('SELECT medialab_core.designate_media_approved_source($1,$2,$3,$4,$5,$6,$7)',
      [token, `designation-${crypto.randomUUID()}`, raw, 'QUICK_EDIT_PATH', 'SKIP_QUICK_EDIT', originalDesignation.rows[0].designate_media_approved_source, 'Synthetic skip compatibility']);
    await expectFailure(owner.query('DELETE FROM medialab_core.media_approved_source_designations WHERE id = $1',
      [originalDesignation.rows[0].designate_media_approved_source]), /immutable append-only/);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.media_transfer_events WHERE retry_key = $1', ['handoff-a'])).rows[0].count).toBe(2);
  });

  it('rejects inconsistent Job/Workstream and tenant evidence and produces deterministic credential-free manifest readback', async () => {
    const token = await issueSession();
    const first = await setupJob(token);
    const second = await setupJob(token);
    await expectFailure(createAsset(token, first.jobId, second.workstreamId), /cross-tenant, cross-Job, or missing/);
    const assetId = await createAsset(token, first.jobId, first.workstreamId);
    const versionId = await addVersion(token, assetId, 'ORIGINAL', 'manifest-original.dng', ORIGINAL_HASH);
    await expectFailure(runtime.query('SELECT medialab_core.record_media_verification_event($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `unsafe-${crypto.randomUUID()}`, versionId, 'SHA256', 'PENDING', null, JSON.stringify({ access_token: 'forbidden' })]), /credentials and secrets/);
    const manifest = await runtime.query<{ create_media_manifest: string }>(
      'SELECT medialab_core.create_media_manifest($1,$2,$3,$4)',
      [token, `manifest-${crypto.randomUUID()}`, first.jobId, 'MEDIA_MANIFEST_V1']
    );
    const stored = await owner.query(
      `SELECT manifest_json, integrity_sha256,
              integrity_sha256 = encode(sha256(convert_to(manifest_json::text, 'UTF8')), 'hex') AS hash_matches
         FROM medialab_core.media_manifests WHERE id = $1`, [manifest.rows[0].create_media_manifest]
    );
    expect(stored.rows[0].hash_matches).toBe(true);
    expect(stored.rows[0].manifest_json.schema_version).toBe('MEDIA_MANIFEST_V1');
    expect(JSON.stringify(stored.rows[0].manifest_json)).not.toMatch(/credential|password|secret|access_token/i);
    const readback = await runtime.query('SELECT medialab_core.get_media_manifest($1,$2) AS manifest',
      [token, manifest.rows[0].create_media_manifest]);
    expect(readback.rows[0].manifest.integrity_sha256).toBe(stored.rows[0].integrity_sha256);
    await expectFailure(owner.query(
      'INSERT INTO medialab_core.media_assets (id, organization_id, job_id, source_context, created_by_identity_id) VALUES ($1,$2,$3,$4::jsonb,$5)',
      [crypto.randomUUID(), crypto.randomUUID(), first.jobId, '{}', STAFF_IDENTITY_ID]));
  });
});
