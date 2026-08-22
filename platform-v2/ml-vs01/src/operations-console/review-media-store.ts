import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export const DEFAULT_MAX_REVIEW_IMAGE_BYTES = 25 * 1024 * 1024;
export const SUPPORTED_REVIEW_IMAGE_MEDIA_TYPES = Object.freeze(["image/jpeg", "image/png"] as const);

export type ReviewImageMediaType = (typeof SUPPORTED_REVIEW_IMAGE_MEDIA_TYPES)[number];
export type ReviewMediaInput = Buffer | AsyncIterable<Uint8Array>;

export interface ReviewMediaStoreOptions {
  readonly root: string;
  readonly maximumImageBytes?: number;
}

export interface ReviewMediaUploadRequest {
  readonly body: ReviewMediaInput;
  readonly filename: string;
  readonly mediaType: ReviewImageMediaType;
  /** Server-generated attempt owner used to make rejected-object cleanup race-safe. */
  readonly ownershipKey?: string;
}

/**
 * Provider-neutral evidence needed to resolve one exact review image. Callers
 * persist this descriptor with canonical review/version evidence; the local
 * path is deliberately never exposed.
 */
export interface ReviewMediaDescriptor {
  readonly objectIdentifier: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly mediaType: ReviewImageMediaType;
  readonly filename: string;
}

export interface ReviewMediaUploadResult extends ReviewMediaDescriptor {
  readonly replayed: boolean;
}

export interface ReviewMediaDownload {
  readonly bytes: Buffer;
  readonly descriptor: ReviewMediaDescriptor;
}

export interface ReviewMediaQuarantineResult {
  readonly quarantineIdentifier: string;
  readonly replayed: boolean;
}

export type ReviewMediaStoreErrorCode =
  | "INVALID_ROOT"
  | "INVALID_DESCRIPTOR"
  | "INVALID_UPLOAD"
  | "UNSUPPORTED_MEDIA"
  | "UPLOAD_TOO_LARGE"
  | "MEDIA_UNAVAILABLE"
  | "INTEGRITY_MISMATCH"
  | "STORE_CONFLICT";

const ERROR_MESSAGES: Readonly<Record<ReviewMediaStoreErrorCode, string>> = Object.freeze({
  INVALID_ROOT: "Review media root is not an isolated directory.",
  INVALID_DESCRIPTOR: "Review media descriptor is not valid.",
  INVALID_UPLOAD: "Review media upload is not valid.",
  UNSUPPORTED_MEDIA: "Review media type is not supported.",
  UPLOAD_TOO_LARGE: "Review media upload exceeds the bounded limit.",
  MEDIA_UNAVAILABLE: "Review media is unavailable.",
  INTEGRITY_MISMATCH: "Review media integrity verification failed.",
  STORE_CONFLICT: "Review media storage state conflicts with the request.",
});

export class ReviewMediaStoreError extends Error {
  readonly code: ReviewMediaStoreErrorCode;

  constructor(code: ReviewMediaStoreErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = "ReviewMediaStoreError";
    this.code = code;
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GENERATED_OBJECT_PATTERN = /^objects\/([0-9a-f]{2})\/([0-9a-f]{64})(?:\.([0-9a-f]{64}))?\.(jpg|png)$/u;
const STAGING_NAME_PATTERN = /^[0-9a-f-]{36}\.part$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const MAGIC_PROBE_BYTES = PNG_SIGNATURE.length;
const MAX_CONFIGURABLE_REVIEW_IMAGE_BYTES = 100 * 1024 * 1024;

function storeError(code: ReviewMediaStoreErrorCode, cause?: unknown): ReviewMediaStoreError {
  return new ReviewMediaStoreError(code, cause === undefined ? undefined : { cause });
}

function canonicalExistingDirectory(candidate: string): string | null {
  try {
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

function assertNarrowRoot(root: string): { canonicalRoot: string; device: number; inode: number } {
  if (typeof root !== "string" || root.length === 0 || !path.isAbsolute(root) || root.includes("\0")) {
    throw storeError("INVALID_ROOT");
  }

  const configuredRoot = path.resolve(root);
  let status;
  let canonicalRoot;
  try {
    status = lstatSync(configuredRoot);
    canonicalRoot = realpathSync(configuredRoot);
  } catch (error) {
    throw storeError("INVALID_ROOT", error);
  }
  if (!status.isDirectory() || status.isSymbolicLink()) throw storeError("INVALID_ROOT");

  const filesystemRoot = path.parse(canonicalRoot).root;
  const rootSegments = path.relative(filesystemRoot, canonicalRoot).split(path.sep).filter(Boolean);
  if (rootSegments.length < 2) throw storeError("INVALID_ROOT");

  const broadRoots = new Set<string>();
  for (const broad of [filesystemRoot, homedir(), tmpdir(), process.cwd()]) {
    const canonical = canonicalExistingDirectory(path.resolve(broad));
    if (canonical !== null) {
      broadRoots.add(canonical);
      if (canonical.startsWith(`${canonicalRoot}${path.sep}`)) throw storeError("INVALID_ROOT");
    }
  }
  if (broadRoots.has(canonicalRoot)) throw storeError("INVALID_ROOT");

  return { canonicalRoot, device: status.dev, inode: status.ino };
}

function assertMaximum(value: number): void {
  if (!Number.isSafeInteger(value) || value < MAGIC_PROBE_BYTES || value > MAX_CONFIGURABLE_REVIEW_IMAGE_BYTES) {
    throw storeError("INVALID_ROOT");
  }
}

function isSupportedMediaType(value: unknown): value is ReviewImageMediaType {
  return value === "image/jpeg" || value === "image/png";
}

function extensionFor(mediaType: ReviewImageMediaType): "jpg" | "png" {
  return mediaType === "image/jpeg" ? "jpg" : "png";
}

function assertFilename(filename: unknown, mediaType: ReviewImageMediaType, code: ReviewMediaStoreErrorCode): asserts filename is string {
  if (typeof filename !== "string" || filename.length === 0 || filename.length > 255 ||
      filename !== filename.trim() || path.isAbsolute(filename) || filename.includes("/") || filename.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(filename) || filename === "." || filename === "..") {
    throw storeError(code);
  }
  const extension = path.extname(filename).toLowerCase();
  if (mediaType === "image/png" ? extension !== ".png" : extension !== ".jpg" && extension !== ".jpeg") {
    throw storeError(code);
  }
}

function detectedMediaType(header: Buffer): ReviewImageMediaType | null {
  if (header.length >= PNG_SIGNATURE.length && header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (header.length >= JPEG_SIGNATURE.length && header.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return "image/jpeg";
  return null;
}

function assertMagic(bytes: Buffer, expected: ReviewImageMediaType): void {
  if (detectedMediaType(bytes.subarray(0, MAGIC_PROBE_BYTES)) !== expected) throw storeError("UNSUPPORTED_MEDIA");
}

function generatedObjectIdentifier(sha256: string, mediaType: ReviewImageMediaType, ownershipKey?: string): string {
  return `objects/${sha256.slice(0, 2)}/${sha256}${ownershipKey ? `.${ownershipKey}` : ""}.${extensionFor(mediaType)}`;
}

function validateDescriptor(descriptor: ReviewMediaDescriptor, maximumImageBytes: number): void {
  if (descriptor === null || typeof descriptor !== "object" || !isSupportedMediaType(descriptor.mediaType) ||
      !Number.isSafeInteger(descriptor.byteSize) || descriptor.byteSize < MAGIC_PROBE_BYTES || descriptor.byteSize > maximumImageBytes ||
      !SHA256_PATTERN.test(descriptor.sha256)) {
    throw storeError("INVALID_DESCRIPTOR");
  }
  assertFilename(descriptor.filename, descriptor.mediaType, "INVALID_DESCRIPTOR");
  const match = GENERATED_OBJECT_PATTERN.exec(descriptor.objectIdentifier);
  if (match === null || match[1] !== descriptor.sha256.slice(0, 2) || match[2] !== descriptor.sha256 ||
      match[4] !== extensionFor(descriptor.mediaType) ||
      descriptor.objectIdentifier !== generatedObjectIdentifier(descriptor.sha256, descriptor.mediaType, match[3])) {
    throw storeError("INVALID_DESCRIPTOR");
  }
}

function immutableDescriptor(descriptor: ReviewMediaDescriptor): ReviewMediaDescriptor {
  return Object.freeze({
    objectIdentifier: descriptor.objectIdentifier,
    byteSize: descriptor.byteSize,
    sha256: descriptor.sha256,
    mediaType: descriptor.mediaType,
    filename: descriptor.filename,
  });
}

function chunksFor(input: ReviewMediaInput): AsyncIterable<Uint8Array> {
  if (Buffer.isBuffer(input)) {
    return (async function* oneBuffer() { yield input; })();
  }
  if (input === null || typeof input !== "object" || !(Symbol.asyncIterator in input)) {
    throw storeError("INVALID_UPLOAD");
  }
  return input;
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    if (bytesWritten <= 0) throw storeError("MEDIA_UNAVAILABLE");
    offset += bytesWritten;
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/**
 * An isolated local byte store. It has no provider, network, database, or
 * business-state authority; it only creates and verifies bounded image-byte
 * evidence under one explicit root.
 */
export class ReviewMediaStore {
  readonly maximumImageBytes: number;
  readonly #root: string;
  readonly #rootDevice: number;
  readonly #rootInode: number;

  constructor(options: ReviewMediaStoreOptions) {
    if (options === null || typeof options !== "object") throw storeError("INVALID_ROOT");
    const maximumImageBytes = options.maximumImageBytes ?? DEFAULT_MAX_REVIEW_IMAGE_BYTES;
    assertMaximum(maximumImageBytes);
    const root = assertNarrowRoot(options.root);
    this.maximumImageBytes = maximumImageBytes;
    this.#root = root.canonicalRoot;
    this.#rootDevice = root.device;
    this.#rootInode = root.inode;
  }

  async upload(request: ReviewMediaUploadRequest): Promise<ReviewMediaUploadResult> {
    if (request === null || typeof request !== "object" || !isSupportedMediaType(request.mediaType)) {
      throw storeError("UNSUPPORTED_MEDIA");
    }
    assertFilename(request.filename, request.mediaType, "INVALID_UPLOAD");
    if (request.ownershipKey !== undefined && !SHA256_PATTERN.test(request.ownershipKey)) {
      throw storeError("INVALID_UPLOAD");
    }
    await this.#assertStableRoot();
    const stagingDirectory = await this.#ensureDirectories([".staging"]);
    const partName = `${randomUUID()}.part`;
    const partPath = path.join(stagingDirectory, partName);
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(partPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600)
      .catch((error) => { throw storeError("MEDIA_UNAVAILABLE", error); });
    const hash = createHash("sha256");
    let byteSize = 0;
    let header = Buffer.alloc(0);
    let handleOpen = true;
    let moved = false;

    try {
      for await (const value of chunksFor(request.body)) {
        if (!(value instanceof Uint8Array)) throw storeError("INVALID_UPLOAD");
        if (value.byteLength === 0) continue;
        byteSize += value.byteLength;
        if (byteSize > this.maximumImageBytes) throw storeError("UPLOAD_TOO_LARGE");
        const bytes = Buffer.from(value);
        if (header.length < MAGIC_PROBE_BYTES) {
          header = Buffer.concat([header, bytes.subarray(0, MAGIC_PROBE_BYTES - header.length)]);
          if (header.length === MAGIC_PROBE_BYTES) assertMagic(header, request.mediaType);
        }
        hash.update(bytes);
        await writeAll(handle, bytes);
      }
      if (byteSize < MAGIC_PROBE_BYTES || header.length < MAGIC_PROBE_BYTES) throw storeError("INVALID_UPLOAD");
      assertMagic(header, request.mediaType);
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handleOpen = false;

      const sha256 = hash.digest("hex");
      const descriptor = immutableDescriptor({
        objectIdentifier: generatedObjectIdentifier(sha256, request.mediaType, request.ownershipKey),
        byteSize,
        sha256,
        mediaType: request.mediaType,
        filename: request.filename,
      });
      const prefixDirectory = await this.#ensureDirectories(["objects", sha256.slice(0, 2)]);
      const finalPath = path.join(prefixDirectory, path.basename(descriptor.objectIdentifier));
      const existing = await lstat(finalPath).catch((error) => {
        if (isMissing(error)) return null;
        throw storeError("MEDIA_UNAVAILABLE", error);
      });
      if (existing !== null) {
        if (!existing.isFile() || existing.isSymbolicLink()) throw storeError("STORE_CONFLICT");
        await this.read(descriptor);
        await this.#removePart(partPath);
        return Object.freeze({ ...descriptor, replayed: true });
      }

      await this.#assertStableRoot();
      await rename(partPath, finalPath).catch((error) => { throw storeError("MEDIA_UNAVAILABLE", error); });
      moved = true;
      await this.read(descriptor);
      return Object.freeze({ ...descriptor, replayed: false });
    } catch (error) {
      if (error instanceof ReviewMediaStoreError) throw error;
      throw storeError("INVALID_UPLOAD", error);
    } finally {
      if (handleOpen) await handle.close().catch(() => undefined);
      if (!moved) await this.#removePart(partPath);
    }
  }

  async read(descriptor: ReviewMediaDescriptor): Promise<ReviewMediaDownload> {
    validateDescriptor(descriptor, this.maximumImageBytes);
    await this.#assertStableRoot();
    const candidate = await this.#verifiedObjectPath(descriptor.objectIdentifier);
    if (candidate === null) throw storeError("MEDIA_UNAVAILABLE");
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(candidate, constants.O_RDONLY | noFollow)
      .catch((error) => { throw storeError("MEDIA_UNAVAILABLE", error); });
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== descriptor.byteSize) throw storeError("INTEGRITY_MISMATCH");
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (!after.isFile() || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
          bytes.length !== descriptor.byteSize) {
        throw storeError("INTEGRITY_MISMATCH");
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== descriptor.sha256) throw storeError("INTEGRITY_MISMATCH");
      try {
        assertMagic(bytes, descriptor.mediaType);
      } catch (error) {
        throw storeError("INTEGRITY_MISMATCH", error);
      }
      return Object.freeze({ bytes, descriptor: immutableDescriptor(descriptor) });
    } catch (error) {
      if (error instanceof ReviewMediaStoreError) throw error;
      throw storeError("MEDIA_UNAVAILABLE", error);
    } finally {
      await handle.close();
    }
  }

  async download(descriptor: ReviewMediaDescriptor): Promise<ReviewMediaDownload> {
    return this.read(descriptor);
  }

  /** Remove one exact generated object after a caller has definitively rejected it. */
  async cleanupRejected(descriptor: ReviewMediaDescriptor): Promise<{ readonly removed: boolean }> {
    validateDescriptor(descriptor, this.maximumImageBytes);
    await this.#assertStableRoot();
    const candidate = await this.#verifiedObjectPath(descriptor.objectIdentifier, true);
    if (candidate === null) return Object.freeze({ removed: false });
    await unlink(candidate).catch((error) => {
      if (!isMissing(error)) throw storeError("MEDIA_UNAVAILABLE", error);
    });
    return Object.freeze({ removed: true });
  }

  /** Atomically move one exact generated object out of the resolvable namespace. */
  async quarantineRejected(descriptor: ReviewMediaDescriptor): Promise<ReviewMediaQuarantineResult> {
    validateDescriptor(descriptor, this.maximumImageBytes);
    await this.#assertStableRoot();
    const source = await this.#verifiedObjectPath(descriptor.objectIdentifier, true);
    const prefix = descriptor.sha256.slice(0, 2);
    const quarantineDirectory = await this.#ensureDirectories([".quarantine", prefix]);
    const quarantineIdentifier = `.quarantine/${prefix}/${path.basename(descriptor.objectIdentifier)}`;
    const destination = path.join(quarantineDirectory, path.basename(quarantineIdentifier));
    const destinationStatus = await lstat(destination).catch((error) => {
      if (isMissing(error)) return null;
      throw storeError("MEDIA_UNAVAILABLE", error);
    });

    if (source === null) {
      if (destinationStatus === null || !destinationStatus.isFile() || destinationStatus.isSymbolicLink()) {
        throw storeError("MEDIA_UNAVAILABLE");
      }
      return Object.freeze({ quarantineIdentifier, replayed: true });
    }
    if (destinationStatus !== null) throw storeError("STORE_CONFLICT");
    await rename(source, destination).catch((error) => { throw storeError("MEDIA_UNAVAILABLE", error); });
    return Object.freeze({ quarantineIdentifier, replayed: false });
  }

  async #assertStableRoot(): Promise<void> {
    const status = await lstat(this.#root).catch((error) => { throw storeError("INVALID_ROOT", error); });
    if (!status.isDirectory() || status.isSymbolicLink() || status.dev !== this.#rootDevice || status.ino !== this.#rootInode) {
      throw storeError("INVALID_ROOT");
    }
    const canonical = await realpath(this.#root).catch((error) => { throw storeError("INVALID_ROOT", error); });
    if (canonical !== this.#root) throw storeError("INVALID_ROOT");
  }

  async #ensureDirectories(segments: readonly string[]): Promise<string> {
    let current = this.#root;
    for (const segment of segments) {
      if (!/^(?:objects|\.[a-z]+|[0-9a-f]{2})$/u.test(segment)) throw storeError("STORE_CONFLICT");
      current = path.join(current, segment);
      await mkdir(current, { mode: 0o700 }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw storeError("MEDIA_UNAVAILABLE", error);
      });
      const status = await lstat(current).catch((error) => { throw storeError("MEDIA_UNAVAILABLE", error); });
      if (!status.isDirectory() || status.isSymbolicLink()) throw storeError("STORE_CONFLICT");
      const canonical = await realpath(current).catch((error) => { throw storeError("MEDIA_UNAVAILABLE", error); });
      if (canonical !== current || !canonical.startsWith(`${this.#root}${path.sep}`)) throw storeError("STORE_CONFLICT");
    }
    return current;
  }

  async #verifiedObjectPath(objectIdentifier: string, allowMissing = false): Promise<string | null> {
    const segments = objectIdentifier.split("/");
    const candidate = path.resolve(this.#root, ...segments);
    if (candidate === this.#root || !candidate.startsWith(`${this.#root}${path.sep}`)) throw storeError("INVALID_DESCRIPTOR");
    let traversed = this.#root;
    for (let index = 0; index < segments.length; index += 1) {
      traversed = path.join(traversed, segments[index]!);
      const status = await lstat(traversed).catch((error) => {
        if (allowMissing && index === segments.length - 1 && isMissing(error)) return null;
        throw storeError("MEDIA_UNAVAILABLE", error);
      });
      if (status === null) return null;
      if (status.isSymbolicLink()) throw storeError("MEDIA_UNAVAILABLE");
      if (index < segments.length - 1 ? !status.isDirectory() : !status.isFile()) throw storeError("MEDIA_UNAVAILABLE");
    }
    const canonical = await realpath(candidate).catch((error) => { throw storeError("MEDIA_UNAVAILABLE", error); });
    if (canonical !== candidate || !canonical.startsWith(`${this.#root}${path.sep}`)) throw storeError("MEDIA_UNAVAILABLE");
    return canonical;
  }

  async #removePart(candidate: string): Promise<void> {
    if (path.dirname(candidate) !== path.join(this.#root, ".staging") || !STAGING_NAME_PATTERN.test(path.basename(candidate))) {
      throw storeError("STORE_CONFLICT");
    }
    await unlink(candidate).catch((error) => {
      if (!isMissing(error)) throw storeError("MEDIA_UNAVAILABLE", error);
    });
  }
}
