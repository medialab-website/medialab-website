import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { Readable } from "node:stream";
import { assertSafeEvidence, contract } from "./contracts.js";
import { stageRawCorrection } from "./local-media-adapter.js";

export interface PilotService {
  sessionForCookie(cookie: string): Promise<{ session: string; mode: "review" | "quick-edit" } | null>;
  overview(session: string): Promise<unknown>;
  missionPlan(session: string): Promise<{ filename: string; bytes: Buffer; sha256: string }>;
  review(session: string): Promise<unknown>;
  decide(session: string, itemId: string, decision: string, reason: string): Promise<unknown>;
  submitReview(session: string): Promise<unknown>;
  queue(session: string): Promise<unknown>;
  workingFile(session: string, requestId: string): Promise<{ filename: string; bytes: Buffer; mediaType: string; sha256: string }>;
  createCorrectionContext(session: string, requestId: string, idempotencyKey: string,
    staged: { objectIdentifier: string; byteSize: number; checksumSha256: string; mediaType: string }): Promise<unknown>;
  operation(session: string, operationId: string): Promise<unknown>;
  retry(session: string, operationId: string): Promise<unknown>;
  disposition(session: string, requestId: string, disposition: "SEND_TO_FINAL" | "NEEDS_REVIEW"): Promise<unknown>;
  publication(session: string): Promise<unknown>;
  observability(session: string): Promise<unknown>;
}

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), "public");
const securityHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'" };

function cookieValue(header: string | undefined): string | null {
  const value = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith("ml_pilot="));
  return value ? value.slice("ml_pilot=".length) : null;
}

export function createOperationalPilotApp(service: PilotService, stagingRoot: string) {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576, trustProxy: false });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addHook("onSend", async (_request, reply) => { for (const [name, value] of Object.entries(securityHeaders)) reply.header(name, value); });
  app.setErrorHandler((error, request, reply) => {
    const fault = error instanceof Error ? error : new Error("request rejected");
    const statusCode = "statusCode" in fault && typeof fault.statusCode === "number" ? fault.statusCode : 400;
    const allowed = /unresolved review items remain/i.test(fault.message) ? "unresolved review items remain" : "request rejected";
    return reply.code(statusCode < 500 ? statusCode : 400).send(contract("OperationalPilotErrorV1", {
      requestReference: request.id, error: allowed, errorCode: "BOUNDED_REQUEST_REJECTED", retryable: false,
    }));
  });

  async function authorized(request: { headers: { cookie?: string } }, mode?: "review" | "quick-edit") {
    const cookie = cookieValue(request.headers.cookie); if (!cookie) throw new Error("local session required");
    const session = await service.sessionForCookie(cookie); if (!session || (mode && session.mode !== mode)) throw new Error("local session unavailable");
    return session.session;
  }

  app.get("/health", async () => contract("OperationalPilotHealthV1", { status: "ok", host: "loopback" }));
  app.post<{ Body: { mode?: string } }>("/session", async (request, reply) => {
    const mode = request.body?.mode === "quick-edit" ? "quick-edit" : "review";
    const cookie = randomBytes(32).toString("base64url");
    // The service binds this opaque cookie server-side; neither database session token nor actor authority is returned.
    const bound = await service.sessionForCookie(`${mode}:${cookie}`); if (!bound) return reply.code(401).send({ error: "development session unavailable" });
    reply.header("set-cookie", `ml_pilot=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
    return contract("DevelopmentSessionReceiptV1", { mode, authenticated: true, requestReference: request.id });
  });
  app.get("/api/overview", async (request) => service.overview(await authorized(request)));
  app.get("/api/mission-plan", async (request, reply) => { const packet = await service.missionPlan(await authorized(request));
    reply.type("text/html; charset=utf-8").header("content-disposition", `attachment; filename="${packet.filename}"`).header("x-content-sha256", packet.sha256); return packet.bytes; });
  app.get("/api/review", async (request) => service.review(await authorized(request, "review")));
  app.post<{ Params: { itemId: string }; Body: { decision: string; reason?: string } }>("/api/review/:itemId/decision", async (request) => {
    assertSafeEvidence(request.body); if (!["ACCEPT", "REJECT", "QUICK_EDIT"].includes(request.body.decision)) throw new Error("unsupported decision");
    return service.decide(await authorized(request, "review"), request.params.itemId, request.body.decision, request.body.reason ?? "Synthetic operator decision");
  });
  app.post("/api/review/submit", async (request) => service.submitReview(await authorized(request, "review")));
  app.get("/api/quick-edit", async (request) => service.queue(await authorized(request, "quick-edit")));
  app.get<{ Params: { requestId: string } }>("/api/quick-edit/:requestId/working-file", async (request, reply) => {
    const file = await service.workingFile(await authorized(request, "quick-edit"), request.params.requestId);
    reply.type(file.mediaType).header("content-disposition", `attachment; filename="${file.filename.replaceAll('"', '')}"`).header("x-content-sha256", file.sha256); return file.bytes;
  });
  app.post<{ Params: { requestId: string }; Querystring: { idempotencyKey?: string } }>("/api/quick-edit/:requestId/correction", async (request, reply) => {
    const session = await authorized(request, "quick-edit"); const key = request.query.idempotencyKey;
    if (!key || !/^[a-zA-Z0-9-]{8,100}$/.test(key)) throw new Error("bounded idempotency key required");
    if (request.headers["content-type"] !== "application/octet-stream") throw new Error("raw octet-stream correction required");
    const body = request.body; if (!Buffer.isBuffer(body)) throw new Error("raw corrected bytes required");
    const staged = await stageRawCorrection(Readable.from(body), stagingRoot, `${request.params.requestId}.png`, "image/png");
    const context = await service.createCorrectionContext(session, request.params.requestId, key, staged);
    return reply.code(202).send(contract("QuickEditCorrectionStagingReceiptV1", { queued: true, requestReference: request.id, context }));
  });
  app.get<{ Params: { id: string } }>("/api/operations/:id", async (request) => service.operation(await authorized(request), request.params.id));
  app.post<{ Params: { id: string } }>("/api/operations/:id/retry", async (request) => service.retry(await authorized(request, "quick-edit"), request.params.id));
  app.post<{ Params: { requestId: string }; Body: { disposition: "SEND_TO_FINAL" | "NEEDS_REVIEW" } }>("/api/quick-edit/:requestId/disposition", async (request) => {
    if (!["SEND_TO_FINAL", "NEEDS_REVIEW"].includes(request.body?.disposition)) throw new Error("explicit disposition required");
    return service.disposition(await authorized(request, "quick-edit"), request.params.requestId, request.body.disposition);
  });
  app.get("/api/publication", async (request) => service.publication(await authorized(request)));
  app.get("/api/observability", async (request) => service.observability(await authorized(request)));
  app.get("/", async (_request, reply) => reply.type("text/html").send(await readFile(join(publicRoot, "index.html"))));
  app.get("/app.js", async (_request, reply) => reply.type("application/javascript").send(await readFile(join(publicRoot, "app.js"))));
  app.get("/styles.css", async (_request, reply) => reply.type("text/css").send(await readFile(join(publicRoot, "styles.css"))));
  return app;
}
