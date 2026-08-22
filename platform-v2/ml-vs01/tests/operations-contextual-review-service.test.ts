import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OperationsConsoleDatabase,
  OperationsConsoleDatabaseError,
  type QuickEditRegistrationProjection,
} from "../src/operations-console/database.js";
import { ReviewMediaStore } from "../src/operations-console/review-media-store.js";
import { OperationsConsoleService } from "../src/operations-console/service.js";
import type { ResolvedDevelopmentOperatorSession } from "../src/operations-console/session.js";

const ids = Object.freeze({
  order: "82000000-0000-5000-8000-000000000001",
  batch: "82000000-0000-5000-8000-000000000002",
  item: "82000000-0000-5000-8000-000000000003",
  request: "82000000-0000-5000-8000-000000000004",
  intent: "82000000-0000-5000-8000-000000000005",
  corrected: "82000000-0000-5000-8000-000000000006",
  successor: "82000000-0000-5000-8000-000000000007",
  successorDecision: "82000000-0000-5000-8000-000000000011",
  successorCompletion: "82000000-0000-5000-8000-000000000012",
});

const session = {
  databaseSessionToken: "server-only-review-token",
  organizationId: "82000000-0000-5000-8000-000000000008",
  actorPersonId: "82000000-0000-5000-8000-000000000009",
  membershipId: "82000000-0000-5000-8000-000000000010",
} as unknown as ResolvedDevelopmentOperatorSession;

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function jpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("synthetic-quick-edit"), Buffer.from([0xff, 0xd9])]);
}

function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function store(): Promise<{ root: string; value: ReviewMediaStore }> {
  const root = await mkdtemp(path.join(tmpdir(), "m22a-review-service-"));
  roots.push(root);
  return { root, value: new ReviewMediaStore({ root }) };
}

function projection(linked: boolean) {
  return {
    context: { orderId: ids.order, customer: {}, property: {}, services: [], attention: [] },
    actions: [],
    activeReview: null,
    quickEdits: linked ? [] : [{
      quickEditRequestId: ids.request,
      reviewBatchId: ids.batch,
      reviewItemId: ids.item,
      lane: "PHOTO",
      instructions: "Correct exposure.",
      expectedReviewLifecycleGeneration: 3,
      expectedDecisionGeneration: 1,
      sourceVersion: {},
      uploadState: "AWAITING_UPLOAD",
      uploadMessage: "Choose revision.",
      downloadAvailable: true,
      correctedVersionId: null,
      successorReviewBatchId: null,
    }],
    completedHistory: [],
  } as any;
}

function fakeDatabase(options: {
  registrationFailure?: "CONFLICT" | "UNAVAILABLE";
  readbackUnavailable?: boolean;
  delayRegistration?: boolean;
} = {}) {
  let linked = false;
  let winningObjectIdentifier: string | null = null;
  let winningChecksum: string | null = null;
  let createCalls = 0;
  let registerCalls = 0;
  let getCalls = 0;
  const database = {
    async getOperationsReviewWorkspace() { return projection(linked); },
    async createOperationsQuickEditUploadIntent() {
      createCalls += 1;
      return { uploadIntentId: ids.intent, requestId: ids.request, state: "AWAITING_UPLOAD", generation: 0,
        replayed: createCalls > 1 };
    },
    async getOperationsQuickEditUploadIntent() {
      getCalls += 1;
      if (options.readbackUnavailable) throw new OperationsConsoleDatabaseError("UNAVAILABLE", "synthetic readback outage");
      return { uploadIntentId: ids.intent, requestId: ids.request, reviewBatchId: ids.batch, reviewItemId: ids.item,
        state: linked ? "FINALIZED" : "AWAITING_UPLOAD", generation: linked ? 1 : 0,
        correctedVersionId: linked ? ids.corrected : null, successorReviewBatchId: linked ? ids.successor : null,
        successorDecisionId: linked ? ids.successorDecision : null,
        successorCompletionEventId: linked ? ids.successorCompletion : null,
        correctedChecksumSha256: winningChecksum, registeredObjectIdentifier: winningObjectIdentifier,
        expectedReviewLifecycleGeneration: 3, expectedDecisionGeneration: 1 };
    },
    async registerOperationsQuickEditRevision(_token: string, input: any): Promise<QuickEditRegistrationProjection> {
      registerCalls += 1;
      if (options.delayRegistration) await new Promise((resolve) => setTimeout(resolve, 20));
      if (options.registrationFailure) throw new OperationsConsoleDatabaseError(options.registrationFailure, "synthetic registration failure");
      linked = true;
      const providerObjectIdentifier = winningObjectIdentifier ?? String(input.objectIdentifier);
      winningObjectIdentifier = providerObjectIdentifier;
      winningChecksum ??= input.checksumSha256;
      return { requestId: ids.request, correctedVersionId: ids.corrected, successorReviewBatchId: ids.successor,
        successorDecisionId: ids.successorDecision, successorCompletionEventId: ids.successorCompletion,
        finalSourceVersionId: ids.corrected,
        providerObjectIdentifier, replayed: registerCalls > 1 };
    },
  } as unknown as OperationsConsoleDatabase;
  return { database, counts: () => ({ createCalls, registerCalls, getCalls }),
    clearFailure: () => { options.registrationFailure = undefined; options.readbackUnavailable = false; } };
}

describe("P02-M22-A Quick Edit service recovery boundary", () => {
  it("delegates one complete review payload to the atomic database command exactly once", async () => {
    const decisions = [{ reviewItemId: ids.item, disposition: "QUICK_EDIT" as const,
      instructions: "Correct exposure.", expectedGeneration: 0, currentDecisionId: null }];
    const calls: unknown[][] = [];
    const database = {
      async submitOperationsReview(...args: unknown[]) {
        calls.push(args);
        return { orderId: ids.order, reviewBatchId: ids.batch, completedEventId: ids.intent,
          decisions: [{ reviewItemId: ids.item, decisionId: ids.request }], replayed: false };
      },
      async getOperationsReviewWorkspace() { return projection(true); },
    } as unknown as OperationsConsoleDatabase;
    const service = new OperationsConsoleService(database);
    await expect(service.submitReview(session, ids.order, ids.batch, {
      idempotencyKey: "atomic_review_submit_123",
      expectedGeneration: 2,
      decisions,
    })).resolves.toMatchObject({ action: "REVIEW_SUBMITTED", replaySafe: true });
    expect(calls).toEqual([[
      session.databaseSessionToken,
      "atomic_review_submit_123",
      ids.order,
      ids.batch,
      2,
      decisions,
    ]]);
  });

  it("serializes concurrent same-key uploads and returns one canonical correction", async () => {
    const media = await store();
    const fake = fakeDatabase({ delayRegistration: true });
    const service = new OperationsConsoleService(fake.database, { reviewMediaStore: media.value });
    const input = { idempotencyKey: "quickedit_same_key_123", filename: "revision.jpg",
      mediaType: "image/jpeg" as const, body: jpeg() };
    const [left, right] = await Promise.all([
      service.uploadQuickEditRevision(session, ids.order, ids.request, input),
      service.uploadQuickEditRevision(session, ids.order, ids.request, input),
    ]);
    expect(right).toEqual(left);
    expect(fake.counts()).toMatchObject({ createCalls: 1, registerCalls: 1 });
  });

  it("re-enters canonical registration on an HTTP retry after success", async () => {
    const media = await store();
    const fake = fakeDatabase();
    const service = new OperationsConsoleService(fake.database, { reviewMediaStore: media.value });
    const input = { idempotencyKey: "quickedit_replay_key_123", filename: "revision.jpg",
      mediaType: "image/jpeg" as const, body: jpeg() };
    const first = await service.uploadQuickEditRevision(session, ids.order, ids.request, input);
    const replay = await service.uploadQuickEditRevision(session, ids.order, ids.request, input);
    expect(replay).toMatchObject({ correctedVersionId: first.correctedVersionId,
      successorReviewBatchId: first.successorReviewBatchId, replaySafe: true });
    expect(fake.counts()).toMatchObject({ createCalls: 1, registerCalls: 2, getCalls: 1 });
  });

  it("removes a definitely rejected attempt object and allows a clean retry", async () => {
    const media = await store();
    const fake = fakeDatabase({ registrationFailure: "CONFLICT" });
    const service = new OperationsConsoleService(fake.database, { reviewMediaStore: media.value });
    const input = { idempotencyKey: "quickedit_conflict_key_123", filename: "revision.jpg",
      mediaType: "image/jpeg" as const, body: jpeg() };
    await expect(service.uploadQuickEditRevision(session, ids.order, ids.request, input))
      .rejects.toMatchObject({ code: "STATE_CONFLICT" });
    const objectDirectory = path.join(media.root, "objects", checksum(jpeg()).slice(0, 2));
    expect(await readdir(objectDirectory)).toEqual([]);
    fake.clearFailure();
    await expect(service.uploadQuickEditRevision(session, ids.order, ids.request, input))
      .resolves.toMatchObject({ uploadState: "FINALIZED", finalSourceVersionId: ids.corrected });
  });

  it("preserves an ambiguous attempt for deterministic retry instead of deleting possible committed bytes", async () => {
    const media = await store();
    const fake = fakeDatabase({ registrationFailure: "UNAVAILABLE", readbackUnavailable: true });
    const service = new OperationsConsoleService(fake.database, { reviewMediaStore: media.value });
    const input = { idempotencyKey: "quickedit_outage_key_123", filename: "revision.jpg",
      mediaType: "image/jpeg" as const, body: jpeg() };
    await expect(service.uploadQuickEditRevision(session, ids.order, ids.request, input))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const objectDirectory = path.join(media.root, "objects", checksum(jpeg()).slice(0, 2));
    const before = await readdir(objectDirectory);
    expect(before).toHaveLength(1);
    await expect(stat(path.join(objectDirectory, before[0]!))).resolves.toMatchObject({ size: jpeg().length });
    fake.clearFailure();
    await expect(service.uploadQuickEditRevision(session, ids.order, ids.request, input))
      .resolves.toMatchObject({ uploadState: "FINALIZED", finalSourceVersionId: ids.corrected });
    expect(await readdir(objectDirectory)).toEqual(before);
  });
});
