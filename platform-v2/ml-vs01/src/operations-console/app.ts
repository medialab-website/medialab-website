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

  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(join(publicRoot, "index.html"))));
  app.get("/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(await readFile(join(publicRoot, "app.js"))));
  app.get("/styles.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(await readFile(join(publicRoot, "styles.css"))));

  return app;
}
