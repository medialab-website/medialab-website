import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOperationsConsoleApp,
  type OperationsConsoleApplicationService,
} from "../src/operations-console/app.js";
import { operationsConsoleContract } from "../src/operations-console/contracts.js";
import { DevelopmentOperatorSessionManager } from "../src/operations-console/session.js";
import type {
  OperationsReviewWorkspace,
  ReviewSubmissionInput,
} from "../src/operations-console/operations-contracts.js";
import {
  parseReviewSubmission,
} from "../src/operations-console/operations-contracts.js";

const ids = Object.freeze({
  organization: "6d91cee6-91c1-52ea-937a-77c1ddc51c63",
  actor: "d43d9499-efbd-5116-b561-67dd34d1df8d",
  membership: "50d8b321-7b99-5bd9-b1a4-cecb924ecc39",
  order: "72000000-0000-5000-8000-000000000001",
  job: "72000000-0000-5000-8000-000000000002",
  batch: "72000000-0000-5000-8000-000000000003",
  item: "72000000-0000-5000-8000-000000000004",
  request: "72000000-0000-5000-8000-000000000005",
  correctedVersion: "72000000-0000-5000-8000-000000000006",
  successorBatch: "72000000-0000-5000-8000-000000000007",
  successorDecision: "72000000-0000-5000-8000-000000000008",
  successorCompletion: "72000000-0000-5000-8000-000000000009",
});

const workspace = {
  schema: "ML_INTERNAL_OPERATIONS_CONSOLE_V1",
  contract: "OperationsReviewWorkspaceV1",
  evidenceClassification: "NONPRODUCTION_CANONICAL_REVIEW",
  disclosure: "Synthetic contextual review test.",
  context: { orderId: ids.order },
  actions: [],
  activeReview: null,
  quickEdits: [],
  completedHistory: [],
} as unknown as OperationsReviewWorkspace;

function collect(body: Buffer | AsyncIterable<Uint8Array>): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return Promise.resolve(body);
  return (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  })();
}

function testApplication() {
  const observations: {
    submission: ReviewSubmissionInput | null;
    start: null | { idempotencyKey: string; lane: string };
    upload: null | { key: string; filename: string; mediaType: string; bytes: Buffer };
  } = { submission: null, start: null, upload: null };
  const service: OperationsConsoleApplicationService = {
    async catalog() {
      return operationsConsoleContract("SelectableCatalogV1", {
        pricedAt: "2026-08-21T12:00:00.000Z", expiresAt: "2026-08-21T12:15:00.000Z",
        evidenceClassification: "NONPRODUCTION_RECONSTRUCTED" as const,
        disclosure: "Synthetic test boundary.", choices: [],
      });
    },
    async preview() { throw new Error("not used"); },
    async create() { throw new Error("not used"); },
    async order() { throw new Error("not used"); },
    async reviewAttention() {
      return { schema: "ML_INTERNAL_OPERATIONS_CONSOLE_V1", contract: "OperationsReviewAttentionV1",
        items: [{ orderId: ids.order, jobId: ids.job, actions: [{ code: "QUICK_EDIT_REQUIRED",
          label: "Quick Edit", lane: "PHOTO", reviewBatchId: ids.batch, reviewItemId: ids.item,
          quickEditRequestId: ids.request }] }],
      };
    },
    async reviewWorkspace() { return workspace; },
    async startReview(_session, orderId, input) {
      expect(orderId).toBe(ids.order); observations.start = input;
      return { schema: "ML_INTERNAL_OPERATIONS_CONSOLE_V1", contract: "ReviewActionReceiptV1",
        action: "REVIEW_STARTED", replaySafe: true, workspace };
    },
    async submitReview(_session, orderId, batchId, input) {
      expect([orderId, batchId]).toEqual([ids.order, ids.batch]);
      observations.submission = input;
      return { schema: "ML_INTERNAL_OPERATIONS_CONSOLE_V1", contract: "ReviewActionReceiptV1",
        action: "REVIEW_SUBMITTED", replaySafe: true, workspace };
    },
    async reviewMedia(_session, orderId, batchId, itemId, purpose) {
      expect([orderId, batchId, itemId, purpose]).toEqual([ids.order, ids.batch, ids.item, "QUICK_EDIT_DOWNLOAD"]);
      return { filename: "fixture-review.jpg", mediaType: "image/jpeg", byteSize: 4,
        checksumSha256: "a".repeat(64), bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
    },
    async uploadQuickEditRevision(_session, orderId, requestId, input) {
      expect([orderId, requestId]).toEqual([ids.order, ids.request]);
      observations.upload = { key: input.idempotencyKey, filename: input.filename,
        mediaType: input.mediaType, bytes: await collect(input.body) };
      return { schema: "ML_INTERNAL_OPERATIONS_CONSOLE_V1", contract: "QuickEditUploadReceiptV1",
        accepted: true, replaySafe: true, requestId, correctedVersionId: ids.correctedVersion,
        successorReviewBatchId: ids.successorBatch, successorDecisionId: ids.successorDecision,
        successorCompletionEventId: ids.successorCompletion, finalSourceVersionId: ids.correctedVersion,
        uploadState: "FINALIZED", workspace };
    },
  };
  const app = createOperationsConsoleApp({ service,
    sessions: new DevelopmentOperatorSessionManager({ ttlSeconds: 900 }),
    developmentOperatorContext: { databaseSessionToken: "server-only-test-token",
      organizationId: ids.organization, actorPersonId: ids.actor, membershipId: ids.membership } });
  return { app, observations };
}

async function issueCookie(app: ReturnType<typeof createOperationsConsoleApp>): Promise<string> {
  const issued = await app.inject({ method: "POST", url: "/session", payload: {} });
  expect(issued.statusCode).toBe(200);
  return String(issued.headers["set-cookie"]).split(";", 1)[0]!;
}

let closeable: ReturnType<typeof createOperationsConsoleApp> | null = null;
afterEach(async () => { await closeable?.close(); closeable = null; });

describe("P02-M22-A contextual review HTTP boundary", () => {
  it("normalizes whole-review optional notes while keeping the complete request keys strict", () => {
    const submissionDecision = { reviewItemId: ids.item, disposition: "QUICK_EDIT" as const,
      expectedGeneration: 3, currentDecisionId: null };
    const submission = { idempotencyKey: "submitkey_123456", expectedGeneration: 5,
      decisions: [submissionDecision] };
    expect(parseReviewSubmission(submission)).toEqual({ ...submission,
      decisions: [{ ...submissionDecision, instructions: null }] });
    expect(parseReviewSubmission({ ...submission, decisions: [{ ...submissionDecision, instructions: null }] }))
      .toEqual({ ...submission, decisions: [{ ...submissionDecision, instructions: null }] });
    expect(parseReviewSubmission({ ...submission, decisions: [{ ...submissionDecision, instructions: "   " }] }))
      .toEqual({ ...submission, decisions: [{ ...submissionDecision, instructions: null }] });
    expect(() => parseReviewSubmission({ ...submission,
      decisions: [{ ...submissionDecision, disposition: "USE_ORIGINAL" }] })).toThrow(/whole-review/);
    expect(() => parseReviewSubmission({ ...submission,
      decisions: [{ ...submissionDecision, disposition: "ACCEPT", instructions: "Hidden note" }] }))
      .toThrow(/only for Send back/);
    expect(() => parseReviewSubmission({ ...submission, decisions: [submissionDecision, submissionDecision] }))
      .toThrow(/at most once/);
    expect(() => parseReviewSubmission({ ...submission, reason: null })).toThrow(/exactly/);
    expect(() => parseReviewSubmission({ ...submission, organizationId: ids.organization })).toThrow(/exactly/);
  });

  it("requires the opaque session and exposes only the exact contextual attention/workspace projections", async () => {
    const { app } = testApplication(); closeable = app;
    expect((await app.inject({ method: "GET", url: "/api/operations/review-attention" })).statusCode).toBe(401);
    const cookie = await issueCookie(app);
    const attention = await app.inject({ method: "GET", url: "/api/operations/review-attention", headers: { cookie } });
    expect(attention.statusCode).toBe(200);
    expect(attention.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(attention.json()).toMatchObject({ contract: "OperationsReviewAttentionV1",
      items: [{ orderId: ids.order, actions: [{ code: "QUICK_EDIT_REQUIRED" }] }] });
    const exact = await app.inject({ method: "GET", url: `/api/operations/orders/${ids.order}/review-workspace`, headers: { cookie } });
    expect(exact.statusCode).toBe(200);
    expect(exact.json()).toMatchObject({ contract: "OperationsReviewWorkspaceV1", context: { orderId: ids.order } });
  });

  it("exposes only atomic generation-bound review submission and no per-item mutation route", async () => {
    const { app, observations } = testApplication(); closeable = app;
    const cookie = await issueCookie(app);
    const start = await app.inject({ method: "POST", url: `/api/operations/orders/${ids.order}/reviews/start`,
      headers: { cookie, "content-type": "application/json" },
      payload: { idempotencyKey: "startkey_123456", lane: "PHOTO" } });
    expect(start.statusCode).toBe(200);
    expect(observations.start).toEqual({ idempotencyKey: "startkey_123456", lane: "PHOTO" });
    const removedPerItem = await app.inject({ method: "POST",
      url: `/api/operations/orders/${ids.order}/reviews/${ids.batch}/items/${ids.item}/decision`,
      headers: { cookie, origin: "http://127.0.0.1:4317", host: "127.0.0.1:4317", "content-type": "application/json" },
      payload: { idempotencyKey: "reviewkey_123456", disposition: "QUICK_EDIT",
        expectedGeneration: 3, currentDecisionId: null } });
    expect(removedPerItem.statusCode).toBe(404);

    const malformed = await app.inject({ method: "POST",
      url: `/api/operations/orders/${ids.order}/reviews/${ids.batch}/submit`,
      headers: { cookie, "content-type": "application/json" },
      payload: { idempotencyKey: "reviewkey_654321", expectedGeneration: 5,
        decisions: [{ reviewItemId: ids.item, disposition: "ACCEPT",
          expectedGeneration: 4, currentDecisionId: null }], organizationId: ids.organization } });
    expect(malformed.statusCode).toBe(400);

    const submit = await app.inject({ method: "POST",
      url: `/api/operations/orders/${ids.order}/reviews/${ids.batch}/submit`,
      headers: { cookie, "content-type": "application/json" },
      payload: { idempotencyKey: "submitkey_123456", expectedGeneration: 5,
        decisions: [{ reviewItemId: ids.item, disposition: "QUICK_EDIT",
          instructions: "Reduce the reflection.", expectedGeneration: 3, currentDecisionId: null }] } });
    expect(submit.statusCode).toBe(200);
    expect(observations.submission).toEqual({ idempotencyKey: "submitkey_123456", expectedGeneration: 5,
      decisions: [{ reviewItemId: ids.item, disposition: "QUICK_EDIT",
        instructions: "Reduce the reflection.", expectedGeneration: 3, currentDecisionId: null }] });

    const crossOrigin = await app.inject({ method: "POST",
      url: `/api/operations/orders/${ids.order}/reviews/${ids.batch}/submit`,
      headers: { cookie, host: "127.0.0.1:4317", origin: "https://example.invalid", "content-type": "application/json" },
      payload: { idempotencyKey: "submitkey_654321", expectedGeneration: 5,
        decisions: [{ reviewItemId: ids.item, disposition: "ACCEPT",
          expectedGeneration: 3, currentDecisionId: null }] } });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it("serves one verified protected image and accepts only an explicit bounded JPEG/PNG upload", async () => {
    const { app, observations } = testApplication(); closeable = app;
    const cookie = await issueCookie(app);
    const download = await app.inject({ method: "GET",
      url: `/api/operations/orders/${ids.order}/review-media/${ids.batch}/items/${ids.item}?purpose=QUICK_EDIT_DOWNLOAD`,
      headers: { cookie } });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("image/jpeg");
    expect(download.headers["content-disposition"]).toBe("attachment; filename*=UTF-8''fixture-review.jpg");
    expect(download.headers["x-content-sha256"]).toBe("a".repeat(64));
    expect(download.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const invalidPurpose = await app.inject({ method: "GET",
      url: `/api/operations/orders/${ids.order}/review-media/${ids.batch}/items/${ids.item}?purpose=PROVIDER_PATH`,
      headers: { cookie } });
    expect(invalidPurpose.statusCode).toBe(400);

    const key = `upload_${randomUUID().replaceAll("-", "")}`;
    const uploadBytes = Buffer.alloc(70_000, 0);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(uploadBytes);
    const upload = await app.inject({ method: "POST",
      url: `/api/operations/orders/${ids.order}/quick-edit/${ids.request}/revision?idempotencyKey=${key}&filename=corrected.png`,
      headers: { cookie, "content-type": "image/png" }, payload: uploadBytes });
    expect(upload.statusCode).toBe(200);
    expect(upload.json()).toMatchObject({ contract: "QuickEditUploadReceiptV1", accepted: true,
      successorReviewBatchId: ids.successorBatch });
    expect(observations.upload).toEqual({ key, filename: "corrected.png", mediaType: "image/png", bytes: uploadBytes });

    const unsupported = await app.inject({ method: "POST",
      url: `/api/operations/orders/${ids.order}/quick-edit/${ids.request}/revision?idempotencyKey=${key}&filename=corrected.gif`,
      headers: { cookie, "content-type": "image/gif" }, payload: Buffer.from("GIF89a") });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  });
});
