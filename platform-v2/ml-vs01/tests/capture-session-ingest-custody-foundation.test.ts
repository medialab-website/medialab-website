import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PERMISSION_SET_FIXTURE } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m15a_test';
const OWNER_ROLE = 'medialab_p02m15a_test_owner';
const RUNTIME_ROLE = 'medialab_p02m15a_test_app';
const SOCKET = '/tmp/mlvs01-p02m15a-pg';
const PORT = 55443;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M10_A_TEST';
const HASH_A = crypto.createHash('sha256').update('synthetic-capture-item-a').digest('hex');
const HASH_B = crypto.createHash('sha256').update('synthetic-capture-item-b').digest('hex');

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('P02-M10-A Capture Session, ingest, and custody foundation', () => {
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

  async function createJob(token: string): Promise<string> {
    const result = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE]
    );
    return result.rows[0].create_job;
  }

  async function createSession(token: string, jobId: string | null, key = `session-${crypto.randomUUID()}`): Promise<string> {
    const result = await runtime.query<{ create_capture_session: string }>(
      'SELECT medialab_core.create_capture_session($1,$2,$3,$4::uuid,$5,$6,$7::jsonb)',
      [token, key, ORGANIZATION_FIXTURE.id, jobId, 'Synthetic capture session', 'Synthetic validation intake',
        JSON.stringify({ source: SOURCE })]
    );
    return result.rows[0].create_capture_session;
  }

  async function registerSource(token: string, sessionId: string, label = 'CARD_A'): Promise<string> {
    const result = await runtime.query<{ register_capture_source: string }>(
      'SELECT medialab_core.register_capture_source($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `source-${crypto.randomUUID()}`, sessionId, 'CARD', label, JSON.stringify({ source: SOURCE })]
    );
    return result.rows[0].register_capture_source;
  }

  async function registerItem(token: string, sourceId: string, filename = 'IMG_0001.DNG', size = 12345): Promise<string> {
    const result = await runtime.query<{ register_capture_item: string }>(
      'SELECT medialab_core.register_capture_item($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::jsonb)',
      [token, `item-${crypto.randomUUID()}`, sourceId, filename, size, 'image/dng', '2026-01-02T03:04:05Z',
        `DCIM/${filename}`, JSON.stringify({ source: SOURCE })]
    );
    return result.rows[0].register_capture_item;
  }

  async function verifyItem(token: string, itemId: string, checksum = HASH_A, size = 12345): Promise<string> {
    const result = await runtime.query<{ record_capture_item_verification: string }>(
      'SELECT medialab_core.record_capture_item_verification($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
      [token, `verify-${crypto.randomUUID()}`, itemId, 'VERIFIED', 'SYNTHETIC_HASH_OBSERVATION', checksum, size,
        'image/dng', JSON.stringify({ source: SOURCE })]
    );
    return result.rows[0].record_capture_item_verification;
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

  it('replays thirteen migrations with exact controlled grants, zero PUBLIC authority, and permission-only fixtures', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(18);
    expect(ledger.rows[12].filename).toBe('0013_capture_session_ingest_custody_foundation.sql');
    const functions = await owner.query(
      `SELECT p.proname, has_function_privilege($1,p.oid,'EXECUTE') AS runtime_execute,
              has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='medialab_core' AND p.proname = ANY($2::text[]) ORDER BY p.proname`,
      [RUNTIME_ROLE, ['create_capture_session', 'assign_capture_session', 'register_capture_source',
        'record_capture_source_observation', 'register_capture_item', 'record_capture_item_observation',
        'record_capture_item_verification', 'record_capture_item_custody', 'record_capture_duplicate_evidence',
        'promote_capture_item', 'get_capture_session_record', 'get_capture_item_record', 'list_capture_sessions',
        'reject_capture_evidence_mutation', 'require_capture_permission', 'validate_capture_safe_json',
        'capture_session_assignment']]
    );
    expect(functions.rows.filter((row) => row.runtime_execute).map((row) => row.proname)).toEqual([
      'assign_capture_session', 'create_capture_session', 'get_capture_item_record', 'get_capture_session_record',
      'list_capture_sessions', 'promote_capture_item', 'record_capture_duplicate_evidence',
      'record_capture_item_custody', 'record_capture_item_observation', 'record_capture_item_verification',
      'record_capture_source_observation', 'register_capture_item', 'register_capture_source'
    ]);
    expect(functions.rows.some((row) => row.public_execute)).toBe(false);
    const tableAuthority = await owner.query(
      `SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='medialab_core' AND c.relname LIKE 'capture_%'
          AND (has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR
               has_table_privilege('public',c.oid,'SELECT,INSERT,UPDATE,DELETE'))`, [RUNTIME_ROLE]);
    expect(tableAuthority.rows[0].count).toBe(0);
    const schemaAuthority = await owner.query(
      `SELECT has_schema_privilege('public','medialab_core','USAGE') AS public_usage,
              has_schema_privilege('public','medialab_core','CREATE') AS public_create`);
    expect(schemaAuthority.rows[0]).toEqual({ public_usage: false, public_create: false });
    const permissions = await owner.query("SELECT code FROM medialab_core.permissions WHERE code LIKE 'media_capture.%' ORDER BY code");
    expect(permissions.rows.map((row) => row.code)).toEqual(['media_capture.manage', 'media_capture.read']);
    const seeded = await owner.query(`SELECT sum(row_count)::int AS count FROM (
      SELECT count(*) AS row_count FROM medialab_core.capture_sessions UNION ALL
      SELECT count(*) FROM medialab_core.capture_items UNION ALL
      SELECT count(*) FROM medialab_core.capture_item_verification_events UNION ALL
      SELECT count(*) FROM medialab_core.capture_duplicate_evidence UNION ALL
      SELECT count(*) FROM medialab_core.capture_item_promotions) q`);
    expect(seeded.rows[0].count).toBe(0);
  });

  it('creates assigned and quarantine sessions, allows multiple sources, and performs one-time assignment only', async () => {
    const token = await issueSession();
    const jobA = await createJob(token);
    const jobB = await createJob(token);
    const assigned = await createSession(token, jobA);
    const quarantine = await createSession(token, null);
    const sourceA = await registerSource(token, assigned, 'CARD_A');
    const sourceB = await registerSource(token, assigned, 'CARD_A');
    expect(sourceB).not.toBe(sourceA);
    const quarantineSource = await registerSource(token, quarantine, 'QUARANTINE_CARD');
    const quarantineItem = await registerItem(token, quarantineSource);
    await verifyItem(token, quarantineItem);
    await expectFailure(runtime.query('SELECT medialab_core.promote_capture_item($1,$2,$3,$4)',
      [token, `unassigned-${crypto.randomUUID()}`, quarantineItem, SOURCE]), /Unassigned quarantine items cannot be promoted/);
    const projection = await runtime.query<{ get_capture_session_record: any }>(
      'SELECT medialab_core.get_capture_session_record($1,$2)', [token, quarantine]);
    expect(projection.rows[0].get_capture_session_record.projection.state).toBe('UNASSIGNED_QUARANTINE');
    await runtime.query('SELECT medialab_core.assign_capture_session($1,$2,$3,$4,$5)',
      [token, `assign-${crypto.randomUUID()}`, quarantine, jobA, 'Synthetic one-time assignment']);
    await expectFailure(runtime.query('SELECT medialab_core.assign_capture_session($1,$2,$3,$4,$5)',
      [token, `reassign-${crypto.randomUUID()}`, quarantine, jobB, 'Prohibited reassignment']), /one-time.*reassignment/i);
    await expectFailure(runtime.query('SELECT medialab_core.assign_capture_session($1,$2,$3,$4,$5)',
      [token, `assigned-${crypto.randomUUID()}`, assigned, jobB, 'Prohibited cross-Job assignment']), /one-time.*reassignment/i);
    await expectFailure(createSession(token, crypto.randomUUID()), /Job is missing, cross-tenant/);
    await expectFailure(runtime.query(
      'SELECT medialab_core.create_capture_session($1,$2,$3,$4::uuid,$5,$6,$7::jsonb)',
      [token, `tenant-${crypto.randomUUID()}`, crypto.randomUUID(), null, 'Cross tenant', 'Rejected', '{}']),
      /lacks active media_capture.manage authority/);
    const assignments = await owner.query(
      'SELECT capture_session_id,job_id FROM medialab_core.capture_session_assignments ORDER BY capture_session_id');
    expect(assignments.rows).toHaveLength(2);
    expect(assignments.rows.every((row) => row.job_id === jobA)).toBe(true);
  });

  it('keeps pre-asset identity independent of names and records append-only observations, custody, and explicit conflicts', async () => {
    const token = await issueSession();
    const job = await createJob(token);
    const session = await createSession(token, job);
    const source = await registerSource(token, session, 'CARD_A');
    const itemA = await registerItem(token, source);
    const itemB = await registerItem(token, source);
    expect(itemB).not.toBe(itemA);
    await verifyItem(token, itemA, HASH_A);
    const conflict = await runtime.query<{ record_capture_item_verification: string }>(
      'SELECT medialab_core.record_capture_item_verification($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
      [token, `conflict-${crypto.randomUUID()}`, itemA, 'VERIFIED', 'SYNTHETIC_RECHECK', HASH_B, 12345,
        'image/dng', JSON.stringify({ source: SOURCE })]);
    const state = await owner.query('SELECT verification_state FROM medialab_core.capture_item_verification_events WHERE id=$1',
      [conflict.rows[0].record_capture_item_verification]);
    expect(state.rows[0].verification_state).toBe('CONFLICT');
    await runtime.query(
      'SELECT medialab_core.record_capture_item_custody($1,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8,$9::jsonb)',
      [token, `custody-${crypto.randomUUID()}`, itemA, 'CUSTODY_COPY_OBSERVED', source, null, null,
        'SYNTHETIC_CUSTODY_OBSERVATION', JSON.stringify({ source: SOURCE })]);
    await expectFailure(runtime.query('SELECT medialab_core.promote_capture_item($1,$2,$3,$4)',
      [token, `promotion-${crypto.randomUUID()}`, itemA, SOURCE]), /conflict blocks promotion/);
    await expectFailure(runtime.query('UPDATE medialab_core.capture_items SET discovered_at=clock_timestamp() WHERE id=$1', [itemA]));
    await expectFailure(owner.query('DELETE FROM medialab_core.capture_item_custody_events WHERE capture_item_id=$1', [itemA]),
      /immutable append-only evidence/);
    const counts = await owner.query(`SELECT
      (SELECT count(*)::int FROM medialab_core.capture_item_observations WHERE capture_item_id=$1) AS observations,
      (SELECT count(*)::int FROM medialab_core.capture_item_verification_events WHERE capture_item_id=$1) AS verifications,
      (SELECT count(*)::int FROM medialab_core.capture_item_custody_events WHERE capture_item_id=$1) AS custody`, [itemA]);
    expect(counts.rows[0]).toEqual({ observations: 1, verifications: 2, custody: 4 });
  });

  it('promotes one assigned verified item exactly once with both authorities and creates no downstream operational evidence', async () => {
    const token = await issueSession();
    const job = await createJob(token);
    const session = await createSession(token, job);
    const source = await registerSource(token, session);
    const item = await registerItem(token, source);
    const verificationId = await verifyItem(token, item);
    const capturePermission = await owner.query("SELECT id FROM medialab_core.permissions WHERE code='media_capture.manage'");
    await owner.query('DELETE FROM medialab_core.permission_set_permissions WHERE permission_set_id=$1 AND permission_id=$2',
      [PERMISSION_SET_FIXTURE.id, capturePermission.rows[0].id]);
    await expectFailure(runtime.query('SELECT medialab_core.promote_capture_item($1,$2,$3,$4)',
      [token, `no-capture-authority-${crypto.randomUUID()}`, item, SOURCE]), /lacks active media_capture.manage authority/);
    await owner.query('INSERT INTO medialab_core.permission_set_permissions(permission_set_id,permission_id,created_at) VALUES($1,$2,clock_timestamp())',
      [PERMISSION_SET_FIXTURE.id, capturePermission.rows[0].id]);
    const assetPermission = await owner.query("SELECT id FROM medialab_core.permissions WHERE code='media_asset.manage'");
    await owner.query('DELETE FROM medialab_core.permission_set_permissions WHERE permission_set_id=$1 AND permission_id=$2',
      [PERMISSION_SET_FIXTURE.id, assetPermission.rows[0].id]);
    await expectFailure(runtime.query('SELECT medialab_core.promote_capture_item($1,$2,$3,$4)',
      [token, `no-authority-${crypto.randomUUID()}`, item, SOURCE]), /lacks active media_asset.manage authority/);
    await owner.query('INSERT INTO medialab_core.permission_set_permissions(permission_set_id,permission_id,created_at) VALUES($1,$2,clock_timestamp())',
      [PERMISSION_SET_FIXTURE.id, assetPermission.rows[0].id]);
    const key = `promote-${crypto.randomUUID()}`;
    const promoted = await runtime.query<{ promote_capture_item: any }>(
      'SELECT medialab_core.promote_capture_item($1,$2,$3,$4)', [token, key, item, SOURCE]);
    const replay = await runtime.query<{ promote_capture_item: any }>(
      'SELECT medialab_core.promote_capture_item($1,$2,$3,$4)', [token, key, item, SOURCE]);
    expect(replay.rows[0].promote_capture_item).toEqual(promoted.rows[0].promote_capture_item);
    await expectFailure(runtime.query('SELECT medialab_core.promote_capture_item($1,$2,$3,$4)',
      [token, `second-${crypto.randomUUID()}`, item, SOURCE]), /already been promoted/);
    const evidence = await owner.query(`SELECT p.verification_event_id,a.organization_id,a.job_id,v.version_kind,
          v.checksum_sha256,v.byte_size::int,v.media_type,v.source_provenance,
          (SELECT count(*)::int FROM medialab_core.media_storage_objects WHERE version_id=v.id) AS storage_count,
          (SELECT count(*)::int FROM medialab_core.media_transfer_events t
             JOIN medialab_core.media_storage_objects s ON s.id=t.storage_object_id WHERE s.version_id=v.id) AS transfer_count,
          (SELECT count(*)::int FROM medialab_core.media_operations WHERE job_id=a.job_id) AS operation_count,
          (SELECT count(*)::int FROM medialab_core.media_approved_source_designations WHERE version_id=v.id) AS designation_count
        FROM medialab_core.capture_item_promotions p
        JOIN medialab_core.media_assets a ON a.id=p.media_asset_id
        JOIN medialab_core.media_asset_versions v ON v.id=p.media_asset_version_id
        WHERE p.capture_item_id=$1`, [item]);
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toEqual({ verification_event_id: verificationId, organization_id: ORGANIZATION_FIXTURE.id,
      job_id: job, version_kind: 'ORIGINAL', checksum_sha256: HASH_A, byte_size: 12345,
      media_type: 'image/dng', source_provenance: SOURCE, storage_count: 0, transfer_count: 0,
      operation_count: 0, designation_count: 0 });
  });

  it('keeps duplicate classifications append-only and nonmutating while rejecting cross-Job evidence', async () => {
    const token = await issueSession();
    const jobA = await createJob(token);
    const jobB = await createJob(token);
    const sessionA = await createSession(token, jobA);
    const sourceA = await registerSource(token, sessionA);
    const itemA = await registerItem(token, sourceA);
    const itemB = await registerItem(token, sourceA);
    for (const classification of ['EXACT_BYTE_MATCH', 'REDUNDANT_CUSTODY_COPY', 'POSSIBLE_DUPLICATE']) {
      await runtime.query(
        'SELECT medialab_core.record_capture_duplicate_evidence($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [token, `duplicate-${classification}-${crypto.randomUUID()}`, itemA, itemB, classification,
          'Synthetic comparison observation', 'Evidence only; no identity or retention effect', JSON.stringify({ source: SOURCE })]);
    }
    const sessionB = await createSession(token, jobB);
    const sourceB = await registerSource(token, sessionB);
    const itemC = await registerItem(token, sourceB);
    await expectFailure(runtime.query(
      'SELECT medialab_core.record_capture_duplicate_evidence($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `cross-job-${crypto.randomUUID()}`, itemA, itemC, 'POSSIBLE_DUPLICATE', 'Synthetic comparison',
        'Must reject cross-Job evidence', '{}']), /same organization and Job/);
    const evidence = await owner.query('SELECT evidence_classification FROM medialab_core.capture_duplicate_evidence ORDER BY evidence_classification');
    expect(evidence.rows.map((row) => row.evidence_classification)).toEqual([
      'EXACT_BYTE_MATCH', 'POSSIBLE_DUPLICATE', 'REDUNDANT_CUSTODY_COPY']);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.capture_items')).rows[0].count).toBe(3);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.media_assets')).rows[0].count).toBe(0);
  });

  it('returns exact actor-scoped idempotent results, rejects conflicting key reuse atomically, and rejects unsafe evidence', async () => {
    const token = await issueSession();
    const job = await createJob(token);
    const key = `idempotency-${crypto.randomUUID()}`;
    const first = await createSession(token, job, key);
    expect(await createSession(token, job, key)).toBe(first);
    const before = (await owner.query('SELECT count(*)::int AS count FROM medialab_core.capture_sessions')).rows[0].count;
    await expectFailure(runtime.query(
      'SELECT medialab_core.create_capture_session($1,$2,$3,$4::uuid,$5,$6,$7::jsonb)',
      [token, key, ORGANIZATION_FIXTURE.id, job, 'Changed label', 'Conflicting reuse', JSON.stringify({ source: SOURCE })]),
      /Idempotency key conflicts/);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.capture_sessions')).rows[0].count).toBe(before);
    const unsafeEvidence = [
      { credential: 'synthetic-forbidden' }, { secret: 'synthetic-forbidden' }, { token: 'synthetic-forbidden' },
      { signed_url: 'https://invalid.example/media?token=synthetic' }, { provider_payload: { unrestricted: true } },
      { absolute_path: '/synthetic/forbidden' }, { media_bytes: 'synthetic-forbidden' },
      { url: 'https://invalid.example/forbidden' }
    ];
    for (const evidence of unsafeEvidence) {
      await expectFailure(runtime.query(
        'SELECT medialab_core.create_capture_session($1,$2,$3,$4::uuid,$5,$6,$7::jsonb)',
        [token, `unsafe-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, null, 'Unsafe', 'Rejected', JSON.stringify(evidence)]),
        /Credentials, signed references, URLs/);
    }
    const session = await createSession(token, job);
    await expectFailure(runtime.query('SELECT medialab_core.register_capture_source($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `path-${crypto.randomUUID()}`, session, 'SOURCE_FOLDER', '/Volumes/RealMedia', '{}']));
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.capture_sources')).rows[0].count).toBe(0);
  });
});
