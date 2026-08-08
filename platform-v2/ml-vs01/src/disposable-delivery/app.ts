import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { createDisposableDeliveryDatabase, type DisposableDeliveryDatabase } from './database.js';
import { createLocalFileAdapter, type DeliveryByteSource } from './local-file-adapter.js';
import { DISPOSABLE_DELIVERY_CSP, DISPOSABLE_DELIVERY_HTML, DISPOSABLE_DELIVERY_JAVASCRIPT } from './page.js';

const LOOPBACK_HOST = '127.0.0.1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const EVENT_REFERENCE_PATTERN = /^[A-Z0-9][A-Z0-9_.:-]{2,199}$/;
const EVIDENCE = Object.freeze({ surface: 'LOCAL_FILE_M15_D', transport: 'LOOPBACK_FASTIFY' });

interface OpenBody { credentialId: string; secret: string; accessEventReference: string }
interface DownloadBody extends OpenBody { itemId: string }

function isExactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function parseOpenBody(value: unknown): OpenBody | null {
  if (!isExactObject(value, ['credentialId', 'secret', 'accessEventReference'])) return null;
  const { credentialId, secret, accessEventReference } = value;
  return typeof credentialId === 'string' && UUID_PATTERN.test(credentialId) &&
    typeof secret === 'string' && SECRET_PATTERN.test(secret) &&
    typeof accessEventReference === 'string' && EVENT_REFERENCE_PATTERN.test(accessEventReference)
    ? { credentialId, secret, accessEventReference } : null;
}

function parseDownloadBody(value: unknown): DownloadBody | null {
  if (!isExactObject(value, ['credentialId', 'secret', 'accessEventReference', 'itemId'])) return null;
  const open = parseOpenBody({
    credentialId: value.credentialId,
    secret: value.secret,
    accessEventReference: value.accessEventReference
  });
  return open && typeof value.itemId === 'string' && UUID_PATTERN.test(value.itemId)
    ? { ...open, itemId: value.itemId } : null;
}

function applySecurityHeaders(reply: { header(name: string, value: string): unknown }): void {
  reply.header('cache-control', 'no-store, max-age=0');
  reply.header('content-security-policy', DISPOSABLE_DELIVERY_CSP);
  reply.header('cross-origin-opener-policy', 'same-origin');
  reply.header('cross-origin-resource-policy', 'same-origin');
  reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  reply.header('referrer-policy', 'no-referrer');
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('x-robots-tag', 'noindex, nofollow');
}

export function buildDisposableDeliveryApp(database: DisposableDeliveryDatabase, byteSource: DeliveryByteSource): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2048, logController: new LogController({ disableRequestLogging: true }) });
  app.addHook('onSend', async (_request, reply) => { applySecurityHeaders(reply); });
  app.setErrorHandler(async (_error, request, reply) => {
    if (request.url.startsWith('/api/disposable-delivery/')) return reply.code(404).send({ status: 'UNAVAILABLE' });
    return reply.code(404).type('text/plain').send('Not found');
  });

  app.get<{ Params: { credentialId: string } }>('/d/:credentialId', async (request, reply) => {
    if (!UUID_PATTERN.test(request.params.credentialId)) return reply.code(404).type('text/plain').send('Not found');
    return reply.type('text/html; charset=utf-8').send(DISPOSABLE_DELIVERY_HTML);
  });

  app.get('/assets/disposable-delivery.js', async (_request, reply) =>
    reply.type('application/javascript; charset=utf-8').send(DISPOSABLE_DELIVERY_JAVASCRIPT));

  app.post('/api/disposable-delivery/open', async (request, reply) => {
    const input = parseOpenBody(request.body);
    if (!input) return reply.code(404).send({ status: 'UNAVAILABLE' });
    try {
      const manifest = await database.getManifest({ ...input, evidence: EVIDENCE });
      if (!manifest) return reply.code(404).send({ status: 'UNAVAILABLE' });
      return reply.send({
        status: 'AVAILABLE',
        expiresAt: manifest.expires_at,
        stakeholderLabel: manifest.stakeholder_label,
        categories: manifest.categories.map((category) => ({
          code: category.category_code,
          label: category.category_label,
          items: category.items.map((item) => ({ id: item.item_id, label: item.label, ordinal: item.ordinal }))
        }))
      });
    } catch {
      return reply.code(404).send({ status: 'UNAVAILABLE' });
    }
  });

  app.post('/api/disposable-delivery/download', async (request, reply) => {
    const input = parseDownloadBody(request.body);
    if (!input) return reply.code(404).send({ status: 'UNAVAILABLE' });
    try {
      const descriptor = await database.resolveDownloadSource({ ...input, evidence: EVIDENCE });
      if (!descriptor || descriptor.item_id !== input.itemId) return reply.code(404).send({ status: 'UNAVAILABLE' });
      const delivery = await byteSource.read(descriptor);
      return reply
        .header('content-disposition', `attachment; filename="${delivery.filename}"`)
        .header('x-medialab-fixture-filename', delivery.filename)
        .header('x-content-sha256', delivery.sha256)
        .type(delivery.contentType)
        .send(delivery.bytes);
    } catch {
      return reply.code(404).send({ status: 'UNAVAILABLE' });
    }
  });

  app.addHook('onClose', async () => { await database.close(); });
  return app;
}

export async function startDisposableDeliveryServer(options: { host?: string; port?: number; storageRoot?: string } = {}): Promise<{ app: FastifyInstance; url: string }> {
  const host = options.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) throw new Error('Disposable delivery may bind only to 127.0.0.1');
  const database = createDisposableDeliveryDatabase({
    host: process.env.PGHOST || '/tmp/mlvs01-p02m15d-pg',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 55445,
    database: process.env.PGDATABASE || 'medialab_p02m15d_test',
    user: process.env.PGRUNTIMEUSER || 'medialab_p02m15d_test_app'
  });
  const byteSource = createLocalFileAdapter(options.storageRoot ?? process.env.ML_DISPOSABLE_DELIVERY_STORAGE_ROOT ?? '/tmp/mlvs01-p02m15d-storage');
  const app = buildDisposableDeliveryApp(database, byteSource);
  const address = await app.listen({ host, port: options.port ?? 0 });
  const port = (app.server.address() as AddressInfo).port;
  return { app, url: address.replace(/:\d+$/, `:${port}`) };
}
