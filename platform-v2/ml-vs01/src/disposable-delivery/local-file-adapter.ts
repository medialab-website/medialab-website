import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DeliverySourceDescriptor } from './database.js';

export const LOCAL_FIXTURE_PROVIDER = 'LOCAL_FIXTURE';
export const M15D_DELIVERY_NAMESPACE = 'M15D_DELIVERY';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;
const OBJECT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_OBJECT_IDENTIFIER_LENGTH = 1000;
const MAX_LOCAL_FIXTURE_BYTES = 1024 * 1024;

export interface FileBackedDelivery {
  bytes: Buffer;
  filename: string;
  contentType: string;
  sha256: string;
}

export interface DeliveryByteSource {
  read(descriptor: DeliverySourceDescriptor): Promise<FileBackedDelivery>;
}

function unavailable(): Error {
  return new Error('Local file delivery source unavailable');
}

function validatedSegments(identifier: string): string[] {
  if (identifier.length === 0 || identifier.length > MAX_OBJECT_IDENTIFIER_LENGTH ||
      path.isAbsolute(identifier) || identifier.includes('\\') ||
      /[\u0000-\u001f\u007f]/.test(identifier) || /^[a-z][a-z0-9+.-]*:/i.test(identifier) ||
      !OBJECT_IDENTIFIER_PATTERN.test(identifier)) {
    throw unavailable();
  }
  const segments = identifier.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) throw unavailable();
  return segments;
}

function validateDescriptor(descriptor: DeliverySourceDescriptor): void {
  if (descriptor.provider !== LOCAL_FIXTURE_PROVIDER || descriptor.storage_namespace !== M15D_DELIVERY_NAMESPACE ||
      !UUID_PATTERN.test(descriptor.item_id) || !UUID_PATTERN.test(descriptor.media_asset_id) ||
      !UUID_PATTERN.test(descriptor.media_asset_version_id) || !UUID_PATTERN.test(descriptor.storage_object_id) ||
      !SHA256_PATTERN.test(descriptor.checksum_sha256) || !MEDIA_TYPE_PATTERN.test(descriptor.media_type) ||
      !Number.isSafeInteger(descriptor.byte_size) || descriptor.byte_size < 0 ||
      descriptor.byte_size > MAX_LOCAL_FIXTURE_BYTES) {
    throw unavailable();
  }
}

export function createLocalFileAdapter(storageRoot: string): DeliveryByteSource {
  return {
    async read(descriptor) {
      validateDescriptor(descriptor);
      const segments = validatedSegments(descriptor.provider_object_identifier);
      const configuredRoot = path.resolve(storageRoot);
      const configuredRootStat = await lstat(configuredRoot).catch(() => { throw unavailable(); });
      if (!configuredRootStat.isDirectory() || configuredRootStat.isSymbolicLink()) throw unavailable();

      const canonicalRoot = await realpath(configuredRoot).catch(() => { throw unavailable(); });
      const candidate = path.resolve(canonicalRoot, ...segments);
      if (candidate === canonicalRoot || !candidate.startsWith(`${canonicalRoot}${path.sep}`)) throw unavailable();

      let traversed = canonicalRoot;
      for (let index = 0; index < segments.length; index += 1) {
        traversed = path.join(traversed, segments[index]!);
        const entry = await lstat(traversed).catch(() => { throw unavailable(); });
        if (entry.isSymbolicLink()) throw unavailable();
        if (index < segments.length - 1 && !entry.isDirectory()) throw unavailable();
        if (index === segments.length - 1 && !entry.isFile()) throw unavailable();
      }

      const canonicalCandidate = await realpath(candidate).catch(() => { throw unavailable(); });
      if (canonicalCandidate !== candidate || !canonicalCandidate.startsWith(`${canonicalRoot}${path.sep}`)) throw unavailable();

      const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
      const handle = await open(canonicalCandidate, constants.O_RDONLY | noFollow).catch(() => { throw unavailable(); });
      try {
        const fileStat = await handle.stat();
        if (!fileStat.isFile() || fileStat.size !== descriptor.byte_size) throw unavailable();
        const bytes = await handle.readFile();
        if (bytes.length !== descriptor.byte_size) throw unavailable();
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== descriptor.checksum_sha256) throw unavailable();
        return {
          bytes,
          filename: `medialab-item-${descriptor.item_id.toLowerCase()}.bin`,
          contentType: descriptor.media_type,
          sha256
        };
      } finally {
        await handle.close();
      }
    }
  };
}
