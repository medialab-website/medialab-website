import crypto from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';
import { buildDisposableDeliveryApp } from '../src/disposable-delivery/app.js';
import { createDisposableDeliveryDatabase, type DeliverySourceDescriptor } from '../src/disposable-delivery/database.js';
import { createLocalFileAdapter } from '../src/disposable-delivery/local-file-adapter.js';

const TEST_DB = 'medialab_p02m16a_test';
const OWNER = 'medialab_p02m16a_test_owner';
const RUNTIME = 'medialab_p02m16a_test_app';
const SOCKET = '/tmp/mlvs01-p02m16a-pg';
const PORT = 55447;
const STORAGE_ROOT = '/tmp/mlvs01-p02m15e-storage';
const ACTOR = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M15_D_TEST';
const FIXTURE_BYTES = Buffer.from('MediaLab P02-M15-D controlled local file-backed delivery proof.\n', 'utf8');
const FIXTURE_SHA256 = crypto.createHash('sha256').update(FIXTURE_BYTES).digest('hex');

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

describe('P02-M15-D provider-neutral file-backed delivery and local storage proof', () => {
  let owner: pg.Client;
  let runtime: pg.Client;
  const reset = () => resetTestDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER, runtimeUser: RUNTIME, confirm: TEST_DB });

  async function session(): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at)
       VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
      [crypto.randomUUID(), ACTOR, digest(token)]
    );
    return token;
  }

  async function acceptedFinal(token: string) {
    const job = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1,$2,$3,$4,$5,$6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE]
    );
    const workstream = await runtime.query<{ create_service_workstream: string }>(
      'SELECT medialab_core.create_service_workstream($1,$2,$3,$4,$5)',
      [token, `workstream-${crypto.randomUUID()}`, job.rows[0].create_job, ORDER_ITEM_FIXTURES[0].id, SOURCE]
    );
    const asset = await runtime.query<{ create_media_asset: string }>(
      'SELECT medialab_core.create_media_asset($1,$2,$3,$4,$5::jsonb)',
      [token, `asset-${crypto.randomUUID()}`, job.rows[0].create_job, workstream.rows[0].create_service_workstream, JSON.stringify({ source: SOURCE })]
    );
    const original = await runtime.query<{ add_media_asset_version: string }>(
      'SELECT medialab_core.add_media_asset_version($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [token, `original-${crypto.randomUUID()}`, asset.rows[0].create_media_asset, 'ORIGINAL', 'source.dng', 1000, 'image/dng', digest(crypto.randomUUID()), SOURCE]
    );
    const cull = await runtime.query<{ create_cull_workspace: string }>(
      'SELECT medialab_core.create_cull_workspace($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [token, `cull-${crypto.randomUUID()}`, job.rows[0].create_job, workstream.rows[0].create_service_workstream, 'PHOTO', 'Photo cull', 'Synthetic cull', JSON.stringify({ source: SOURCE })]
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
      [token, `return-${crypto.randomUUID()}`, intake.rows[0].create_returned_media_intake_batch, 'm15d-proof.bin', FIXTURE_BYTES.length, 'application/octet-stream', FIXTURE_SHA256, 'EXACT_MATCH', 'MANIFEST_REFERENCE', handoffItem, 0, 'Synthetic exact return', '{}']
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
    return { jobId: job.rows[0].create_job, workstreamId: workstream.rows[0].create_service_workstream, assetId: asset.rows[0].create_media_asset, versionId };
  }

  async function ready(options: { storage?: boolean; storageSha?: string; storageSize?: number; objectId?: string } = {}) {
    const token = await session();
    const final = await acceptedFinal(token);
    const publication = await runtime.query<{ create_media_publication: string }>(
      'SELECT medialab_core.create_media_publication($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [token, `publication-${crypto.randomUUID()}`, final.jobId, final.workstreamId, null, 'Synthetic publication', '{}']
    );
    await runtime.query('SELECT medialab_core.add_media_publication_item($1,$2,$3,$4,$5,$6,$7,$8)', [token, `publication-item-${crypto.randomUUID()}`, publication.rows[0].create_media_publication, final.versionId, 'PHOTOS', 'PRIMARY_GALLERY', 1, 'Synthetic placement']);
    await runtime.query('SELECT medialab_core.seal_media_publication($1,$2,$3,$4,$5)', [token, `seal-publication-${crypto.randomUUID()}`, publication.rows[0].create_media_publication, 1, 'Synthetic freeze']);
    await runtime.query('SELECT medialab_core.activate_media_publication($1,$2,$3,$4,$5)', [token, `activate-publication-${crypto.randomUUID()}`, publication.rows[0].create_media_publication, 2, 'Synthetic activation']);
    const center = await runtime.query<{ create_temporary_download_center: string }>(
      'SELECT medialab_core.create_temporary_download_center($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)',
      [token, `center-${crypto.randomUUID()}`, PROPERTY_HUB_ID, 7, 'Synthetic stakeholder', JSON.stringify([{ publication_id: publication.rows[0].create_media_publication, category_code: 'PHOTOS' }]), 'Synthetic center creation', '{}']
    );
    await runtime.query('SELECT medialab_core.record_delivery_financial_eligibility($1,$2,$3,$4,$5,$6,$7::uuid,$8)', [token, `financial-${crypto.randomUUID()}`, ORDER_FOUNDATION_ORDER_ID, 'ELIGIBLE', 'NONPRODUCTION_FIXTURE', 'P02_M15_D_FIXTURE_ELIGIBLE', null, 'Synthetic bounded eligibility']);
    const issued = (await runtime.query<{ issue_temporary_download_center_access_credential: any }>(
      'SELECT medialab_core.issue_temporary_download_center_access_credential($1,$2,$3,$4,$5,$6::jsonb)',
      [token, `issue-${crypto.randomUUID()}`, center.rows[0].create_temporary_download_center, 0, 'Synthetic access issue', '{}']
    )).rows[0].issue_temporary_download_center_access_credential;
    const item = (await owner.query('SELECT i.* FROM medialab_core.temporary_download_center_current c JOIN medialab_core.temporary_download_center_items i ON i.version_id=c.current_version_id WHERE c.center_id=$1', [center.rows[0].create_temporary_download_center])).rows[0];
    const objectId = options.objectId ?? `objects/${crypto.randomUUID()}.bin`;
    if (options.storage !== false) {
      if (options.storageSha !== undefined || options.storageSize !== undefined) {
        await owner.query(
          `INSERT INTO medialab_core.media_storage_objects
             (id,version_id,organization_id,job_id,provider,storage_namespace,provider_object_identifier,checksum_sha256,byte_size,media_type,source_provenance,recorded_by_identity_id)
           SELECT $1,v.id,v.organization_id,v.job_id,'LOCAL_FIXTURE','M15D_DELIVERY',$2,$3,$4,'application/octet-stream','Synthetic owner-role mismatch evidence',$5
             FROM medialab_core.media_asset_versions v WHERE v.id=$6`,
          [crypto.randomUUID(), objectId, options.storageSha ?? FIXTURE_SHA256, options.storageSize ?? FIXTURE_BYTES.length, ACTOR, final.versionId]
        );
      } else {
        await runtime.query(
          'SELECT medialab_core.record_media_storage_object($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [token, `storage-${crypto.randomUUID()}`, final.versionId, 'LOCAL_FIXTURE', 'M15D_DELIVERY', objectId, FIXTURE_SHA256, FIXTURE_BYTES.length, 'application/octet-stream', 'Synthetic M15-D local storage evidence']
        );
      }
      const target = path.join(STORAGE_ROOT, objectId);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, FIXTURE_BYTES);
    }
    return { token, final, centerId: center.rows[0].create_temporary_download_center, issued, item, objectId };
  }

  function descriptor(overrides: Partial<DeliverySourceDescriptor> = {}): DeliverySourceDescriptor {
    return {
      item_id: crypto.randomUUID(),
      media_asset_id: crypto.randomUUID(),
      media_asset_version_id: crypto.randomUUID(),
      storage_object_id: crypto.randomUUID(),
      provider: 'LOCAL_FIXTURE',
      storage_namespace: 'M15D_DELIVERY',
      provider_object_identifier: 'objects/proof.bin',
      checksum_sha256: FIXTURE_SHA256,
      byte_size: FIXTURE_BYTES.length,
      media_type: 'application/octet-stream',
      ...overrides
    };
  }

  beforeAll(async () => {
    await mkdir(STORAGE_ROOT, { recursive: true });
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER });
    runtime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await owner.connect();
    await runtime.connect();
  });
  beforeEach(reset);
  afterAll(async () => { await runtime.end(); await owner.end(); await reset(); });

  it('applies 0021 as one locked SECURITY DEFINER resolver with only restricted-runtime EXECUTE', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(22);
    expect(ledger.rows[20].filename).toBe('0021_provider_neutral_file_backed_disposable_delivery_foundation.sql');
    const fn = await owner.query(`SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,
        pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,
        has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname='resolve_temporary_download_center_delivery_source'`, [RUNTIME]);
    expect(fn.rows).toHaveLength(1);
    expect(fn.rows[0]).toMatchObject({ prosecdef: true, owner: OWNER, runtime: true, public: false });
    expect(fn.rows[0].proconfig).toEqual(['search_path=pg_catalog, medialab_core, pg_temp']);
    expect(fn.rows[0].arguments).toBe('p_credential uuid, p_presented_secret text, p_access_event_reference text, p_item uuid, p_evidence jsonb, p_provider text, p_storage_namespace text');
    expect((fn.rows[0].definition.match(/evaluate_temporary_download_center_gateway_access/g) ?? [])).toHaveLength(1);
    expect(fn.rows[0].definition).toMatch(/temporary_download_center_items/);
    expect(fn.rows[0].definition).toMatch(/media_asset_versions/);
    expect(fn.rows[0].definition).toMatch(/media_storage_objects/);
    const dml = await owner.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE')`, [RUNTIME]);
    expect(dml.rows[0].n).toBe(0);
    const publicFunctions = await owner.query(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core' AND has_function_privilege('public',p.oid,'EXECUTE')`);
    expect(publicFunctions.rows[0].n).toBe(0);
  });

  it('downloads exact controlled disk bytes through one resolver/gateway attempt without descriptor leakage', async () => {
    const state = await ready();
    const database = createDisposableDeliveryDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    const app = buildDisposableDeliveryApp(database, createLocalFileAdapter(STORAGE_ROOT));
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const reference = `M15D.DOWNLOAD.${crypto.randomUUID().toUpperCase()}`;
    const payload = { credentialId: state.issued.credential_id, secret: state.issued.access_secret, itemId: state.item.id, accessEventReference: reference };
    try {
      const shell = await fetch(`${address}/d/${state.issued.credential_id}#${state.issued.access_secret}`);
      expect(shell.status).toBe(200);
      expect(await shell.text()).not.toContain(state.issued.access_secret);
      const response = await fetch(`${address}/api/disposable-delivery/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const downloaded = Buffer.from(await response.arrayBuffer());
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toBe(`attachment; filename="medialab-item-${state.item.id}.bin"`);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(response.headers.get('x-content-sha256')).toBe(FIXTURE_SHA256);
      expect(downloaded.equals(FIXTURE_BYTES)).toBe(true);
      expect(crypto.createHash('sha256').update(downloaded).digest('hex')).toBe(FIXTURE_SHA256);
      const disclosureSurface = JSON.stringify(response.headers) + downloaded.toString('utf8');
      expect(disclosureSurface).not.toContain(state.objectId);
      expect(disclosureSurface).not.toMatch(/LOCAL_FIXTURE|M15D_DELIVERY|media_asset_version|storage_object|\/tmp\//);
      expect((await owner.query('SELECT count(*)::int n FROM medialab_core.temporary_download_center_gateway_evaluations WHERE access_event_reference=$1', [reference])).rows[0].n).toBe(1);
      expect((await owner.query('SELECT count(*)::int n FROM medialab_core.temporary_download_center_access_observations WHERE access_event_reference=$1', [reference])).rows[0].n).toBe(1);

      const retry = await fetch(`${address}/api/disposable-delivery/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      expect(retry.status).toBe(200);
      expect(Buffer.from(await retry.arrayBuffer()).equals(FIXTURE_BYTES)).toBe(true);
      expect((await owner.query('SELECT count(*)::int n FROM medialab_core.temporary_download_center_gateway_evaluations WHERE access_event_reference=$1', [reference])).rows[0].n).toBe(1);

      const conflict = await fetch(`${address}/api/disposable-delivery/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, secret: '0'.repeat(64) }) });
      expect(conflict.status).toBe(404);
      expect(await conflict.json()).toEqual({ status: 'UNAVAILABLE' });
    } finally {
      await app.close();
    }
  });

  it('fails closed for zero, multiple, or metadata-inconsistent canonical storage sources', async () => {
    const database = createDisposableDeliveryDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    try {
      const missing = await ready({ storage: false });
      expect(await database.resolveDownloadSource({ credentialId: missing.issued.credential_id, secret: missing.issued.access_secret, itemId: missing.item.id, accessEventReference: `M15D.ZERO.${crypto.randomUUID().toUpperCase()}`, evidence: { surface: 'TEST' } })).toBeNull();

      await reset();
      const multiple = await ready();
      await runtime.query('SELECT medialab_core.record_media_storage_object($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [multiple.token, `storage-${crypto.randomUUID()}`, multiple.final.versionId, 'LOCAL_FIXTURE', 'M15D_DELIVERY', `objects/${crypto.randomUUID()}.bin`, FIXTURE_SHA256, FIXTURE_BYTES.length, 'application/octet-stream', 'Synthetic duplicate candidate']);
      expect(await database.resolveDownloadSource({ credentialId: multiple.issued.credential_id, secret: multiple.issued.access_secret, itemId: multiple.item.id, accessEventReference: `M15D.MULTIPLE.${crypto.randomUUID().toUpperCase()}`, evidence: { surface: 'TEST' } })).toBeNull();

      await reset();
      const mismatch = await ready({ storageSha: '0'.repeat(64) });
      expect(await database.resolveDownloadSource({ credentialId: mismatch.issued.credential_id, secret: mismatch.issued.access_secret, itemId: mismatch.item.id, accessEventReference: `M15D.MISMATCH.${crypto.randomUUID().toUpperCase()}`, evidence: { surface: 'TEST' } })).toBeNull();
    } finally {
      await database.close();
    }
  });

  it('rejects traversal, URL/control syntax, missing/non-regular files, unknown sources, and integrity mismatches', async () => {
    const root = await mkdtemp(`${STORAGE_ROOT}/adapter-`);
    await mkdir(path.join(root, 'objects'));
    await writeFile(path.join(root, 'objects', 'proof.bin'), FIXTURE_BYTES);
    const adapter = createLocalFileAdapter(root);
    const valid = await adapter.read(descriptor());
    expect(valid.bytes.equals(FIXTURE_BYTES)).toBe(true);
    expect(valid.sha256).toBe(FIXTURE_SHA256);

    for (const provider_object_identifier of ['/etc/passwd', '../escape', 'objects/../proof.bin', 'objects/./proof.bin', 'objects//proof.bin', 'objects\\proof.bin', 'https://example.invalid/proof.bin', `objects/${String.fromCharCode(0)}proof.bin`, 'missing.bin']) {
      await expect(adapter.read(descriptor({ provider_object_identifier }))).rejects.toThrow('unavailable');
    }
    await expect(adapter.read(descriptor({ provider: 'OTHER' }))).rejects.toThrow('unavailable');
    await expect(adapter.read(descriptor({ storage_namespace: 'OTHER' }))).rejects.toThrow('unavailable');
    await expect(adapter.read(descriptor({ provider_object_identifier: 'objects', byte_size: 0, checksum_sha256: digest('') }))).rejects.toThrow('unavailable');
    await expect(adapter.read(descriptor({ byte_size: FIXTURE_BYTES.length + 1 }))).rejects.toThrow('unavailable');
    await expect(adapter.read(descriptor({ checksum_sha256: '0'.repeat(64) }))).rejects.toThrow('unavailable');
  });

  it('rejects symbolic-link targets and intermediate components without reading outside the controlled root', async () => {
    const root = await mkdtemp(`${STORAGE_ROOT}/symlink-`);
    const outside = await mkdtemp(`${STORAGE_ROOT}/outside-`);
    await mkdir(path.join(root, 'objects'));
    await writeFile(path.join(outside, 'outside.bin'), FIXTURE_BYTES);
    await symlink(path.join(outside, 'outside.bin'), path.join(root, 'objects', 'target.bin'));
    await symlink(outside, path.join(root, 'linked'));
    const adapter = createLocalFileAdapter(root);
    await expect(adapter.read(descriptor({ provider_object_identifier: 'objects/target.bin' }))).rejects.toThrow('unavailable');
    await expect(adapter.read(descriptor({ provider_object_identifier: 'linked/outside.bin' }))).rejects.toThrow('unavailable');
  });

  it('returns generic zero-byte denial for wrong credentials or foreign items', async () => {
    const state = await ready();
    const database = createDisposableDeliveryDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    const app = buildDisposableDeliveryApp(database, createLocalFileAdapter(STORAGE_ROOT));
    try {
      for (const payload of [
        { credentialId: state.issued.credential_id, secret: '0'.repeat(64), itemId: state.item.id, accessEventReference: `M15D.DENY.${crypto.randomUUID().toUpperCase()}` },
        { credentialId: state.issued.credential_id, secret: state.issued.access_secret, itemId: crypto.randomUUID(), accessEventReference: `M15D.DENY.${crypto.randomUUID().toUpperCase()}` }
      ]) {
        const response = await app.inject({ method: 'POST', url: '/api/disposable-delivery/download', payload });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ status: 'UNAVAILABLE' });
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.headers['x-content-sha256']).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
});
