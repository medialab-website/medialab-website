import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { OperationalPilotDatabase } from "./database.js";

export interface WorkerTarget {
  operationId: string;
  targetId: string;
  objectIdentifier: string;
  byteSize: number;
  checksumSha256: string;
  mediaType: "image/png";
}

export class QuickEditWorker {
  constructor(private readonly database: OperationalPilotDatabase, private readonly stagingRoot: string,
    private readonly workerKey = "P02_M16_A_LOCAL_WORKER") {}

  async claimOnce(key: string = randomUUID()): Promise<Record<string, unknown>> {
    return this.database.invoke("claim_media_operation", [this.workerKey, `claim-${key}`, 30]);
  }

  async run(target: WorkerTarget, injectFailure: boolean): Promise<Record<string, unknown>> {
    const claim = await this.claimOnce(target.operationId);
    if (!claim.claimed || claim.operation_id !== target.operationId) return claim;
    const attemptId = String(claim.attempt_id);
    const attempt = Number(claim.attempt_number);
    await this.database.invoke("start_media_operation_attempt", [this.workerKey, `start-${attemptId}`, attemptId]);
    await this.database.invoke("record_media_operation_checkpoint", [this.workerKey, `open-${attemptId}`, attemptId,
      "STAGED_FILE_OPEN", JSON.stringify({ objectIdentifier: target.objectIdentifier, expectedByteSize: target.byteSize })], ["", "", "", "", "::jsonb"]);
    if (injectFailure) {
      await this.database.invoke("complete_media_operation_attempt", [this.workerKey, `fail-${attemptId}`, attemptId, "FAILED",
        "Injected bounded failure after staged-file checkpoint", JSON.stringify({ failureClass: "M16A_INJECTED_RETRY_PROOF" })], ["", "", "", "", "", "::jsonb"]);
      return { claimed: true, attemptId, attempt, result: "FAILED", retryEligible: true, retryScheduled: false };
    }
    const observed = await this.verify(target);
    await this.database.invoke("record_media_operation_checkpoint", [this.workerKey, `verified-${attemptId}`, attemptId,
      "INDEPENDENT_SHA256_VERIFIED", JSON.stringify(observed)], ["", "", "", "", "::jsonb"]);
    const manifest = createHash("sha256").update(JSON.stringify(observed)).digest("hex");
    await this.database.invoke("record_media_operation_receipt", [this.workerKey, `receipt-${attemptId}`, attemptId, target.targetId,
      "LOCAL_CORRECTION_VERIFIED", target.objectIdentifier, observed.byteSize, observed.checksumSha256, observed.mediaType,
      manifest, "LOCAL_FIXTURE", "VERIFIED", JSON.stringify({ bounded: true })], ["", "", "", "", "", "", "", "", "", "", "", "", "::jsonb"]);
    await this.database.invoke("complete_media_operation_attempt", [this.workerKey, `complete-${attemptId}`, attemptId, "SUCCEEDED",
      "Corrected media independently verified", JSON.stringify(observed)], ["", "", "", "", "", "::jsonb"]);
    return { claimed: true, attemptId, attempt, result: "SUCCEEDED", observed };
  }

  private async verify(target: WorkerTarget) {
    if (isAbsolute(target.objectIdentifier) || target.objectIdentifier.includes("..") || target.objectIdentifier.includes("\\")) throw new Error("unsafe worker object identifier");
    const root = await realpath(this.stagingRoot); const path = resolve(root, target.objectIdentifier);
    if (relative(root, path).startsWith(`..${sep}`)) throw new Error("worker path escaped controlled root");
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error("worker target is not a regular file");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const hash = createHash("sha256"); let byteSize = 0;
      for await (const bytes of handle.createReadStream()) { byteSize += bytes.length; hash.update(bytes); }
      const checksumSha256 = hash.digest("hex");
      if (byteSize !== target.byteSize || checksumSha256 !== target.checksumSha256 || target.mediaType !== "image/png") throw new Error("worker integrity verification failed");
      return { objectIdentifier: target.objectIdentifier, byteSize, checksumSha256, mediaType: target.mediaType };
    } finally { await handle.close(); }
  }
}
