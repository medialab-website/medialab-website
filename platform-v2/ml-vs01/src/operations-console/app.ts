import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyRequest } from "fastify";
import {
  operationsConsoleContract,
  parseCreateListingRequestV1,
  parseDevelopmentOperatorSessionRequestV1,
  parseListingPreviewRequestV1,
  type CanonicalOrderConfirmationV1,
  type CreateListingRequestV1,
  type ListingCreationReceiptV1,
  type ListingPreviewRequestV1,
  type ListingPreviewV1,
  type SelectableCatalogV1,
} from "./contracts.js";
import { operationsConsoleError, serializeOperationsConsoleError } from "./errors.js";
import {
  DevelopmentOperatorSessionManager,
  type ResolvedDevelopmentOperatorSession,
  type ServerBoundDevelopmentOperatorContext,
} from "./session.js";
import {
  parseAssignment,
  parseAcceptProposal,
  parseCancel,
  parseConfirm,
  parseEmpty,
  parseProposedWindow,
  parseReplacement,
  parseRequestedWindow,
  parseReschedule,
  type AssignmentCandidates,
  type AcceptProposalInput,
  type AssignmentInput,
  type CancelAppointmentInput,
  type ConfirmAppointmentInput,
  type OperationsActionReceipt,
  type OperationsContext,
  type OperationsHome,
  type OperationsWindowInput,
  type ReplacementInput,
  type RescheduleAppointmentInput,
} from "./operations-contracts.js";

const publicRoot = join(dirname(fileURLToPath(import.meta.url)), "public");
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive",
});

export interface OperationsConsoleApplicationService {
  catalog(session: ResolvedDevelopmentOperatorSession): Promise<SelectableCatalogV1>;
  preview(session: ResolvedDevelopmentOperatorSession, request: ListingPreviewRequestV1): Promise<ListingPreviewV1>;
  create(session: ResolvedDevelopmentOperatorSession, request: CreateListingRequestV1): Promise<ListingCreationReceiptV1>;
  order(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<CanonicalOrderConfirmationV1>;
  operationsHome?(session: ResolvedDevelopmentOperatorSession, from: string, to: string): Promise<OperationsHome>;
  operationsContext?(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<OperationsContext>;
  assignmentCandidates?(session: ResolvedDevelopmentOperatorSession, organizationId: string): Promise<AssignmentCandidates>;
  initializeOperations?(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<OperationsActionReceipt>;
  addRequestedWindow?(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: OperationsWindowInput): Promise<OperationsActionReceipt>;
  proposeWindow?(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: OperationsWindowInput): Promise<OperationsActionReceipt>;
  acceptProposal?(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: AcceptProposalInput): Promise<OperationsActionReceipt>;
  confirmAppointment?(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: ConfirmAppointmentInput): Promise<OperationsActionReceipt>;
  cancelAppointment?(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, input: CancelAppointmentInput): Promise<OperationsActionReceipt>;
  rescheduleAppointment?(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, input: RescheduleAppointmentInput): Promise<OperationsActionReceipt>;
  assignParticipant?(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, input: AssignmentInput): Promise<OperationsActionReceipt>;
  replaceParticipant?(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, assignmentId: string, input: ReplacementInput): Promise<OperationsActionReceipt>;
  close?(): Promise<void>;
}

export interface OperationsConsoleApplicationOptions {
  service: OperationsConsoleApplicationService;
  sessions: DevelopmentOperatorSessionManager;
  developmentOperatorContext: ServerBoundDevelopmentOperatorContext;
}

function authenticated(
  sessions: DevelopmentOperatorSessionManager,
  request: Pick<FastifyRequest, "headers">,
): ResolvedDevelopmentOperatorSession {
  return sessions.resolveCookie(request.headers.cookie);
}

function assertSameOrigin(request: FastifyRequest): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== "string" || typeof request.headers.host !== "string") throw operationsConsoleError("FORBIDDEN");
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.host !== request.headers.host) {
      throw operationsConsoleError("FORBIDDEN");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "OperationsConsoleHttpError") throw error;
    throw operationsConsoleError("FORBIDDEN");
  }
}

function canonicalId(value: string): string {
  if (!ORDER_ID.test(value)) throw operationsConsoleError("NOT_FOUND");
  return value.toLowerCase();
}

function isoRange(value: string | undefined): string {
  if (typeof value !== "string" || value.length > 40 || !/[zZ]|[+-]\d{2}:\d{2}$/u.test(value)) throw operationsConsoleError("INVALID_REQUEST");
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw operationsConsoleError("INVALID_REQUEST");
  return date.toISOString();
}

export function createOperationsConsoleApp(options: OperationsConsoleApplicationOptions) {
  const app = Fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: 65_536,
    requestIdHeader: false,
  });

  app.addHook("onRequest", async (request) => {
    assertSameOrigin(request);
  });
  app.addHook("onSend", async (_request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
  });
  app.addHook("onClose", async () => {
    await options.service.close?.();
  });
  app.setErrorHandler((error, request, reply) => {
    const fastifyStatus = error !== null && typeof error === "object" && "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    const safeError = fastifyStatus === 413 || fastifyStatus === 415 || fastifyStatus === 400
      ? operationsConsoleError("INVALID_REQUEST", { cause: error })
      : error;
    const serialized = serializeOperationsConsoleError(safeError, String(request.id));
    return reply.code(serialized.statusCode).send(serialized.body);
  });

  app.get("/health", async () => operationsConsoleContract("OperationsConsoleHealthV1", {
    status: "OK" as const,
    environment: "NONPRODUCTION" as const,
    observedAt: new Date().toISOString(),
  }));

  app.post<{ Body: unknown }>("/session", async (request, reply) => {
    parseDevelopmentOperatorSessionRequestV1(request.body);
    const issued = options.sessions.issue(options.developmentOperatorContext);
    reply.header("set-cookie", issued.setCookieHeader);
    return issued.receipt;
  });

  app.get("/api/catalog", async (request) => options.service.catalog(authenticated(options.sessions, request)));

  app.post<{ Body: unknown }>("/api/listings/preview", async (request) => {
    const session = authenticated(options.sessions, request);
    return options.service.preview(session, parseListingPreviewRequestV1(request.body));
  });

  app.post<{ Body: unknown }>("/api/listings", async (request, reply) => {
    const session = authenticated(options.sessions, request);
    const receipt = await options.service.create(session, parseCreateListingRequestV1(request.body));
    return reply.code(receipt.replayed ? 200 : 201).send(receipt);
  });

  app.get<{ Params: { orderId: string } }>("/api/orders/:orderId", async (request) => {
    if (!ORDER_ID.test(request.params.orderId)) throw operationsConsoleError("NOT_FOUND");
    return options.service.order(authenticated(options.sessions, request), request.params.orderId.toLowerCase());
  });

  app.get<{ Querystring: { from?: string; to?: string } }>("/api/operations", async (request) =>
    options.service.operationsHome!(authenticated(options.sessions, request), isoRange(request.query.from), isoRange(request.query.to)));

  app.get<{ Params: { orderId: string } }>("/api/operations/orders/:orderId", async (request) =>
    options.service.operationsContext!(authenticated(options.sessions, request), canonicalId(request.params.orderId)));

  app.get<{ Querystring: { organizationId?: string } }>("/api/operations/assignment-candidates", async (request) =>
    options.service.assignmentCandidates!(authenticated(options.sessions, request), canonicalId(request.query.organizationId ?? "")));

  app.post<{ Params: { orderId: string }; Body: unknown }>("/api/operations/orders/:orderId/initialize", async (request) => {
    parseEmpty(request.body); return options.service.initializeOperations!(authenticated(options.sessions, request), canonicalId(request.params.orderId));
  });
  app.post<{ Params: { orderId: string; requestId: string }; Body: unknown }>("/api/operations/orders/:orderId/scheduling/:requestId/requested-windows", async (request) =>
    options.service.addRequestedWindow!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.requestId), parseRequestedWindow(request.body)));
  app.post<{ Params: { orderId: string; requestId: string }; Body: unknown }>("/api/operations/orders/:orderId/scheduling/:requestId/proposed-windows", async (request) =>
    options.service.proposeWindow!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.requestId), parseProposedWindow(request.body)));
  app.post<{ Params: { orderId: string; requestId: string }; Body: unknown }>("/api/operations/orders/:orderId/scheduling/:requestId/accept-proposal", async (request) =>
    options.service.acceptProposal!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.requestId), parseAcceptProposal(request.body)));
  app.post<{ Params: { orderId: string; requestId: string }; Body: unknown }>("/api/operations/orders/:orderId/scheduling/:requestId/confirm", async (request) =>
    options.service.confirmAppointment!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.requestId), parseConfirm(request.body)));
  app.post<{ Params: { orderId: string; appointmentId: string }; Body: unknown }>("/api/operations/orders/:orderId/appointments/:appointmentId/cancel", async (request) =>
    options.service.cancelAppointment!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.appointmentId), parseCancel(request.body)));
  app.post<{ Params: { orderId: string; appointmentId: string }; Body: unknown }>("/api/operations/orders/:orderId/appointments/:appointmentId/reschedule", async (request) =>
    options.service.rescheduleAppointment!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.appointmentId), parseReschedule(request.body)));
  app.post<{ Params: { orderId: string; appointmentId: string }; Body: unknown }>("/api/operations/orders/:orderId/appointments/:appointmentId/assignments", async (request) =>
    options.service.assignParticipant!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.appointmentId), parseAssignment(request.body)));
  app.post<{ Params: { orderId: string; appointmentId: string; assignmentId: string }; Body: unknown }>("/api/operations/orders/:orderId/appointments/:appointmentId/assignments/:assignmentId/replace", async (request) =>
    options.service.replaceParticipant!(authenticated(options.sessions, request), canonicalId(request.params.orderId), canonicalId(request.params.appointmentId), canonicalId(request.params.assignmentId), parseReplacement(request.body)));

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(join(publicRoot, "index.html"))));
  app.get("/operations", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(join(publicRoot, "index.html"))));
  app.get("/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(await readFile(join(publicRoot, "app.js"))));
  app.get("/styles.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(await readFile(join(publicRoot, "styles.css"))));

  return app;
}
