import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deterministicPng } from "../src/operational-pilot/fixture-media.js";
import { MAX_CORRECTION_BYTES, stageRawCorrection } from "../src/operational-pilot/local-media-adapter.js";
import { QuickEditWorker } from "../src/operational-pilot/quick-edit-worker.js";

const roots: string[] = []; afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
async function root() { const value = await mkdtemp(join(tmpdir(), "m16a-worker-")); roots.push(value); return value; }

describe("P02-M16-A bounded staging and durable worker", () => {
  it("stages a raw stream with exact size/SHA and atomic final name", async () => {
    const staging = await root(); const bytes = deterministicPng(99); const result = await stageRawCorrection(Readable.from(bytes), staging, "correction.png", "image/png");
    expect(result).toEqual({ objectIdentifier: "correction.png", byteSize: bytes.length, checksumSha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png" });
    expect(await readFile(join(staging, "correction.png"))).toEqual(bytes);
  });
  it("fails closed for traversal, absolute names, unsupported media, excess bytes, and partial ingress", async () => {
    const staging = await root();
    await expect(stageRawCorrection(Readable.from(Buffer.alloc(100)), staging, "../escape.png", "image/png")).rejects.toThrow(/unsafe/);
    await expect(stageRawCorrection(Readable.from(Buffer.alloc(100)), staging, "/escape.png", "image/png")).rejects.toThrow(/unsafe/);
    await expect(stageRawCorrection(Readable.from(Buffer.alloc(100)), staging, "bad.jpg", "image/jpeg")).rejects.toThrow(/unsupported/);
    await expect(stageRawCorrection(Readable.from(Buffer.alloc(MAX_CORRECTION_BYTES + 1)), staging, "large.png", "image/png")).rejects.toThrow(/bounded/);
    await expect(readFile(join(staging, "large.png.part"))).rejects.toThrow();
  });
  it("records an injected failed attempt and leaves retry as an explicit operator action", async () => {
    const staging = await root(); const bytes = deterministicPng(99); await writeFile(join(staging, "correction.png"), bytes);
    const calls: { name: string; values: readonly unknown[] }[] = []; const database = { invoke: vi.fn(async (name: string, values: readonly unknown[]) => {
      calls.push({ name, values }); if (name === "claim_media_operation") return { claimed: true, operation_id: "op", attempt_id: "attempt-1", attempt_number: 1 }; return "id";
    }) } as never;
    const worker = new QuickEditWorker(database, staging); const result = await worker.run({ operationId: "op", targetId: "target", objectIdentifier: "correction.png", byteSize: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png" }, true);
    expect(result).toMatchObject({ result: "FAILED", retryEligible: true, retryScheduled: false }); expect(calls.map((call) => call.name)).toEqual([
      "claim_media_operation", "start_media_operation_attempt", "record_media_operation_checkpoint", "complete_media_operation_attempt"]);
  });
  it("independently verifies attempt 2 and records one receipt before success", async () => {
    const staging = await root(); const bytes = deterministicPng(99); await writeFile(join(staging, "correction.png"), bytes);
    const calls: string[] = []; const database = { invoke: vi.fn(async (name: string) => { calls.push(name); if (name === "claim_media_operation") return { claimed: true, operation_id: "op", attempt_id: "attempt-2", attempt_number: 2 }; return "id"; }) } as never;
    const worker = new QuickEditWorker(database, staging); const result = await worker.run({ operationId: "op", targetId: "target", objectIdentifier: "correction.png", byteSize: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png" }, false);
    expect(result).toMatchObject({ result: "SUCCEEDED", attempt: 2 }); expect(calls.filter((name) => name === "record_media_operation_receipt")).toHaveLength(1);
    expect(calls.at(-1)).toBe("complete_media_operation_attempt");
  });
  it("rejects symlink and integrity mismatch during independent verification", async () => {
    const staging = await root(); const outside = await root(); const bytes = deterministicPng(99); await writeFile(join(outside, "outside.png"), bytes); await symlink(join(outside, "outside.png"), join(staging, "link.png"));
    const database = { invoke: vi.fn(async (name: string) => name === "claim_media_operation" ? { claimed: true, operation_id: "op", attempt_id: "attempt", attempt_number: 2 } : "id") } as never;
    const worker = new QuickEditWorker(database, staging); const base = { operationId: "op", targetId: "target", objectIdentifier: "link.png", byteSize: bytes.length, checksumSha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png" as const };
    await expect(worker.run(base, false)).rejects.toThrow(/regular file/);
    await mkdir(join(staging, "nested")); await writeFile(join(staging, "wrong.png"), bytes); await expect(worker.run({ ...base, objectIdentifier: "wrong.png", checksumSha256: "0".repeat(64) }, false)).rejects.toThrow(/integrity/);
  });
});
