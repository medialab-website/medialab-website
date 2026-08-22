import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReviewMediaStore,
  ReviewMediaStoreError,
  type ReviewMediaDescriptor,
} from "../src/operations-console/review-media-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function isolatedRoot(label = "store"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `m22a-review-${label}-`));
  roots.push(root);
  return root;
}

function png(payload = "review-png"): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(payload.repeat(8), "utf8"),
  ]);
}

function jpeg(payload = "review-jpeg"): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    Buffer.from(payload.repeat(8), "utf8"),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectStoreCode(code: string) {
  return expect.objectContaining({ name: "ReviewMediaStoreError", code });
}

describe("M22-A provider-neutral review media store", () => {
  it("requires an explicit narrow existing non-symlink root", async () => {
    const root = await isolatedRoot("root");
    const linked = `${root}-link`;
    await symlink(root, linked);
    roots.push(linked);

    expect(() => new ReviewMediaStore({ root: "." })).toThrow(expectStoreCode("INVALID_ROOT"));
    expect(() => new ReviewMediaStore({ root: path.parse(root).root })).toThrow(expectStoreCode("INVALID_ROOT"));
    expect(() => new ReviewMediaStore({ root: linked })).toThrow(expectStoreCode("INVALID_ROOT"));
    expect(() => new ReviewMediaStore({ root: path.join(root, "missing") })).toThrow(expectStoreCode("INVALID_ROOT"));
    expect(() => new ReviewMediaStore({ root })).not.toThrow();
  });

  it("streams PNG upload to a private file and returns an exact server-generated descriptor", async () => {
    const root = await isolatedRoot("png");
    const store = new ReviewMediaStore({ root });
    const bytes = png();
    const chunks = [bytes.subarray(0, 2), bytes.subarray(2, 7), bytes.subarray(7)];
    const uploaded = await store.upload({
      body: Readable.from(chunks), filename: "Camera Roll Revision.png", mediaType: "image/png",
    });

    expect(uploaded).toEqual({
      objectIdentifier: `objects/${digest(bytes).slice(0, 2)}/${digest(bytes)}.png`,
      byteSize: bytes.length,
      sha256: digest(bytes),
      mediaType: "image/png",
      filename: "Camera Roll Revision.png",
      replayed: false,
    });
    expect(uploaded.objectIdentifier).not.toContain(uploaded.filename);
    const stored = path.join(root, uploaded.objectIdentifier);
    expect((await stat(stored)).mode & 0o777).toBe(0o600);
    expect(await readFile(stored)).toEqual(bytes);
    await expect(store.download(uploaded)).resolves.toMatchObject({ descriptor: {
      objectIdentifier: uploaded.objectIdentifier, sha256: uploaded.sha256, mediaType: "image/png",
    } });
    expect((await store.read(uploaded)).bytes).toEqual(bytes);
  });

  it("supports JPEG and makes an exact retry replay the same object without duplicates", async () => {
    const root = await isolatedRoot("retry");
    const store = new ReviewMediaStore({ root });
    const bytes = jpeg();
    const request = { body: bytes, filename: "revision.jpeg", mediaType: "image/jpeg" as const };
    const created = await store.upload(request);
    const retried = await store.upload(request);

    expect(created.replayed).toBe(false);
    expect(retried).toEqual({ ...created, replayed: true });
    const prefixDirectory = path.dirname(path.join(root, created.objectIdentifier));
    expect(await readdir(prefixDirectory)).toEqual([path.basename(created.objectIdentifier)]);
    expect((await readdir(path.join(root, ".staging"))).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  it("isolates identical bytes by server-generated attempt ownership for race-safe rejection cleanup", async () => {
    const root = await isolatedRoot("owned-attempts");
    const store = new ReviewMediaStore({ root });
    const bytes = jpeg("owned-attempt");
    const firstOwner = "1".repeat(64);
    const secondOwner = "2".repeat(64);
    const first = await store.upload({ body: bytes, filename: "first.jpg", mediaType: "image/jpeg",
      ownershipKey: firstOwner });
    const second = await store.upload({ body: bytes, filename: "second.jpg", mediaType: "image/jpeg",
      ownershipKey: secondOwner });

    expect(first.objectIdentifier).not.toBe(second.objectIdentifier);
    expect(first.objectIdentifier).toContain(`.${firstOwner}.jpg`);
    expect(second.objectIdentifier).toContain(`.${secondOwner}.jpg`);
    await expect(store.cleanupRejected(first)).resolves.toEqual({ removed: true });
    await expect(store.read(second)).resolves.toMatchObject({ descriptor: { objectIdentifier: second.objectIdentifier } });
    await expect(store.upload({ body: bytes, filename: "bad.jpg", mediaType: "image/jpeg",
      ownershipKey: "not-server-generated" })).rejects.toEqual(expectStoreCode("INVALID_UPLOAD"));
  });

  it("rejects traversal-shaped and metadata-conflicting descriptors before filesystem escape", async () => {
    const root = await isolatedRoot("traversal");
    const store = new ReviewMediaStore({ root });
    const uploaded = await store.upload({ body: png(), filename: "revision.png", mediaType: "image/png" });
    const unsafe = [
      "../outside.png", "/etc/passwd", "objects/../outside.png", "objects\\outside.png",
      `objects/${uploaded.sha256.slice(0, 2)}/${uploaded.sha256}.jpg`,
    ];
    for (const objectIdentifier of unsafe) {
      await expect(store.read({ ...uploaded, objectIdentifier })).rejects.toEqual(expectStoreCode("INVALID_DESCRIPTOR"));
    }
    await expect(store.read({ ...uploaded, sha256: "0".repeat(64) })).rejects.toEqual(expectStoreCode("INVALID_DESCRIPTOR"));
    await expect(store.read({ ...uploaded, filename: "../revision.png" })).rejects.toEqual(expectStoreCode("INVALID_DESCRIPTOR"));
  });

  it("rejects final and intermediate symlinks without reading bytes outside the root", async () => {
    const root = await isolatedRoot("symlink");
    const outside = await isolatedRoot("outside");
    const store = new ReviewMediaStore({ root });
    const bytes = png("symlink-proof");
    const uploaded = await store.upload({ body: bytes, filename: "revision.png", mediaType: "image/png" });
    const stored = path.join(root, uploaded.objectIdentifier);
    const outsideFile = path.join(outside, "outside.png");
    await writeFile(outsideFile, bytes);
    await rm(stored);
    await symlink(outsideFile, stored);
    await expect(store.read(uploaded)).rejects.toEqual(expectStoreCode("MEDIA_UNAVAILABLE"));

    await rm(stored);
    const prefixDirectory = path.dirname(stored);
    const parkedPrefix = `${prefixDirectory}-parked`;
    await rename(prefixDirectory, parkedPrefix);
    await symlink(outside, prefixDirectory);
    await writeFile(path.join(outside, path.basename(stored)), bytes);
    await expect(store.read(uploaded)).rejects.toEqual(expectStoreCode("MEDIA_UNAVAILABLE"));
  });

  it("detects size, hash, and image-magic tampering on every read", async () => {
    const root = await isolatedRoot("tamper");
    const store = new ReviewMediaStore({ root });
    const bytes = png("tamper-proof");
    const uploaded = await store.upload({ body: bytes, filename: "revision.png", mediaType: "image/png" });
    const stored = path.join(root, uploaded.objectIdentifier);

    await writeFile(stored, Buffer.alloc(bytes.length, 0x41), { mode: 0o600 });
    await expect(store.read(uploaded)).rejects.toEqual(expectStoreCode("INTEGRITY_MISMATCH"));
    await writeFile(stored, Buffer.concat([bytes, Buffer.from("extra")]), { mode: 0o600 });
    await expect(store.read(uploaded)).rejects.toEqual(expectStoreCode("INTEGRITY_MISMATCH"));

    const unsupported = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(64)]);
    const sha256 = digest(unsupported);
    const objectIdentifier = `objects/${sha256.slice(0, 2)}/${sha256}.png`;
    await mkdir(path.dirname(path.join(root, objectIdentifier)), { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, objectIdentifier), unsupported, { mode: 0o600 });
    const descriptor: ReviewMediaDescriptor = {
      objectIdentifier, byteSize: unsupported.length, sha256, mediaType: "image/png", filename: "unsupported.png",
    };
    await expect(store.read(descriptor)).rejects.toEqual(expectStoreCode("INTEGRITY_MISMATCH"));
  });

  it("fails closed for oversize, unsupported, mismatched, and interrupted uploads and removes partial files", async () => {
    const root = await isolatedRoot("rejection");
    const store = new ReviewMediaStore({ root, maximumImageBytes: 64 });
    await expect(store.upload({ body: png("oversized"), filename: "large.png", mediaType: "image/png" }))
      .rejects.toEqual(expectStoreCode("UPLOAD_TOO_LARGE"));
    await expect(store.upload({ body: Buffer.from("GIF89a-not-supported"), filename: "image.gif", mediaType: "image/gif" as never }))
      .rejects.toEqual(expectStoreCode("UNSUPPORTED_MEDIA"));
    await expect(store.upload({ body: jpeg("x"), filename: "wrong.png", mediaType: "image/png" }))
      .rejects.toEqual(expectStoreCode("UNSUPPORTED_MEDIA"));

    const interrupted = async function* () {
      yield png().subarray(0, 12);
      throw new Error("synthetic interrupted Camera Roll read");
    };
    await expect(store.upload({ body: interrupted(), filename: "interrupted.png", mediaType: "image/png" }))
      .rejects.toEqual(expectStoreCode("INVALID_UPLOAD"));
    expect((await readdir(path.join(root, ".staging"))).filter((name) => name.endsWith(".part"))).toEqual([]);
    await expect(lstat(path.join(root, "objects"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("offers descriptor-only quarantine and cleanup helpers that are replay-safe", async () => {
    const root = await isolatedRoot("cleanup");
    const store = new ReviewMediaStore({ root });
    const first = await store.upload({ body: png("quarantine"), filename: "quarantine.png", mediaType: "image/png" });
    const quarantined = await store.quarantineRejected(first);
    expect(quarantined).toEqual({
      quarantineIdentifier: `.quarantine/${first.sha256.slice(0, 2)}/${first.sha256}.png`, replayed: false,
    });
    await expect(store.read(first)).rejects.toEqual(expectStoreCode("MEDIA_UNAVAILABLE"));
    await expect(store.quarantineRejected(first)).resolves.toEqual({ ...quarantined, replayed: true });

    const second = await store.upload({ body: jpeg("cleanup"), filename: "cleanup.jpg", mediaType: "image/jpeg" });
    await expect(store.cleanupRejected(second)).resolves.toEqual({ removed: true });
    await expect(store.cleanupRejected(second)).resolves.toEqual({ removed: false });
    await expect(store.cleanupRejected({ ...second, objectIdentifier: "../../outside.jpg" }))
      .rejects.toEqual(expectStoreCode("INVALID_DESCRIPTOR"));
  });

  it("exports bounded fixed errors without filesystem path disclosure", async () => {
    const root = await isolatedRoot("errors");
    const store = new ReviewMediaStore({ root });
    try {
      await store.read({
        objectIdentifier: "../secret", byteSize: 8, sha256: "0".repeat(64), mediaType: "image/png", filename: "x.png",
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewMediaStoreError);
      expect(String((error as Error).message)).not.toContain(root);
    }
  });
});
