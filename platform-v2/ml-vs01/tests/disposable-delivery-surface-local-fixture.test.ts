import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildDisposableDeliveryApp, startDisposableDeliveryServer } from '../src/disposable-delivery/app.js';
import type { DisposableDeliveryDatabase } from '../src/disposable-delivery/database.js';
import { createSyntheticFixtureDownload } from '../src/disposable-delivery/fixture-download.js';
import type { DeliveryByteSource } from '../src/disposable-delivery/local-file-adapter.js';

const CREDENTIAL = '11111111-1111-4111-8111-111111111111';
const ITEM = '22222222-2222-4222-8222-222222222222';
const SECRET = 'a'.repeat(64);
const OPEN_REFERENCE = 'M15C.OPEN.11111111-1111-4111-8111-111111111111';
const DOWNLOAD_REFERENCE = 'M15C.DOWNLOAD.22222222-2222-4222-8222-222222222222';

describe('P02-M15-C disposable delivery surface and local fixture', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  function database(overrides: Partial<DisposableDeliveryDatabase> = {}): DisposableDeliveryDatabase {
    return {
      async getManifest() {
        return {
          status: 'AVAILABLE',
          expires_at: '2030-01-01T00:00:00.000Z',
          stakeholder_label: 'Fixture stakeholder',
          categories: [{ category_code: 'PHOTOS', category_label: 'Photos', items: [{ item_id: ITEM, label: 'Photos 1', ordinal: 1 }] }]
        };
      },
      async resolveDownloadSource(input) {
        const fixture = createSyntheticFixtureDownload(input.itemId);
        return {
          item_id: input.itemId,
          media_asset_id: '33333333-3333-4333-8333-333333333333',
          media_asset_version_id: '44444444-4444-4444-8444-444444444444',
          storage_object_id: '55555555-5555-4555-8555-555555555555',
          provider: 'LOCAL_FIXTURE',
          storage_namespace: 'M15D_DELIVERY',
          provider_object_identifier: 'predecessor/synthetic.txt',
          checksum_sha256: fixture.sha256,
          byte_size: fixture.bytes.length,
          media_type: fixture.contentType
        };
      },
      async close() {},
      ...overrides
    };
  }

  const byteSource: DeliveryByteSource = {
    async read(descriptor) {
      return createSyntheticFixtureDownload(descriptor.item_id);
    }
  };

  it('serves only a secretless shell and same-origin asset with strict no-store security headers', async () => {
    app = buildDisposableDeliveryApp(database(), byteSource);
    const shell = await app.inject({ method: 'GET', url: `/d/${CREDENTIAL}` });
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain('Temporary Download Center');
    expect(shell.body).not.toContain(SECRET);
    expect(shell.headers['cache-control']).toContain('no-store');
    expect(shell.headers['content-security-policy']).toContain("default-src 'none'");
    expect(shell.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(shell.headers['x-frame-options']).toBe('DENY');
    expect(shell.headers['x-robots-tag']).toBe('noindex, nofollow');

    const asset = await app.inject({ method: 'GET', url: '/assets/disposable-delivery.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(asset.body.indexOf("history.replaceState(null, '', location.pathname)")).toBeLessThan(asset.body.indexOf("post('/api/disposable-delivery/open'"));
    expect(asset.body).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
    expect(asset.body).not.toMatch(/https?:\/\//);
  });

  it('returns only the safe manifest and a deterministic bounded synthetic fixture after gateway allow', async () => {
    app = buildDisposableDeliveryApp(database(), byteSource);
    const opened = await app.inject({ method: 'POST', url: '/api/disposable-delivery/open', payload: { credentialId: CREDENTIAL, secret: SECRET, accessEventReference: OPEN_REFERENCE } });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(opened.json()).toEqual({
      status: 'AVAILABLE', expiresAt: '2030-01-01T00:00:00.000Z', stakeholderLabel: 'Fixture stakeholder',
      categories: [{ code: 'PHOTOS', label: 'Photos', items: [{ id: ITEM, label: 'Photos 1', ordinal: 1 }] }]
    });
    expect(opened.body).not.toMatch(/secret|verifier|provider|path|url|bytes/i);

    const downloaded = await app.inject({ method: 'POST', url: '/api/disposable-delivery/download', payload: { credentialId: CREDENTIAL, secret: SECRET, itemId: ITEM, accessEventReference: DOWNLOAD_REFERENCE } });
    const fixture = createSyntheticFixtureDownload(ITEM);
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(downloaded.rawPayload.equals(fixture.bytes)).toBe(true);
    expect(downloaded.headers['x-content-sha256']).toBe(fixture.sha256);
    expect(fixture.bytes.length).toBeLessThanOrEqual(512);
    expect(createSyntheticFixtureDownload(ITEM)).toEqual(fixture);
  });

  it('fails closed generically, rejects excess input, and never emits fixture bytes after deny', async () => {
    let manifestCalls = 0;
    app = buildDisposableDeliveryApp(database({
      async getManifest() { manifestCalls += 1; return null; },
      async resolveDownloadSource() { return null; }
    }), byteSource);
    const unavailable = { status: 'UNAVAILABLE' };
    const deniedOpen = await app.inject({ method: 'POST', url: '/api/disposable-delivery/open', payload: { credentialId: CREDENTIAL, secret: '0'.repeat(64), accessEventReference: OPEN_REFERENCE } });
    expect(deniedOpen.statusCode).toBe(404);
    expect(deniedOpen.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(deniedOpen.json()).toEqual(unavailable);
    const excess = await app.inject({ method: 'POST', url: '/api/disposable-delivery/open', payload: { credentialId: CREDENTIAL, secret: SECRET, accessEventReference: OPEN_REFERENCE, organizationId: CREDENTIAL } });
    expect(excess.statusCode).toBe(404);
    expect(manifestCalls).toBe(1);
    const deniedDownload = await app.inject({ method: 'POST', url: '/api/disposable-delivery/download', payload: { credentialId: CREDENTIAL, secret: SECRET, itemId: ITEM, accessEventReference: DOWNLOAD_REFERENCE } });
    expect(deniedDownload.statusCode).toBe(404);
    expect(deniedDownload.json()).toEqual(unavailable);
  });

  it('refuses every non-loopback bind before opening database or network resources', async () => {
    await expect(startDisposableDeliveryServer({ host: '0.0.0.0', port: 0 })).rejects.toThrow('only to 127.0.0.1');
    await expect(startDisposableDeliveryServer({ host: '::1', port: 0 })).rejects.toThrow('only to 127.0.0.1');
  });
});
