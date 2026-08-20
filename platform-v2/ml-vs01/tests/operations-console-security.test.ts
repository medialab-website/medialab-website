import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOperationsConsoleApp, type OperationsConsoleApplicationService } from "../src/operations-console/app.js";
import { operationsConsoleContract } from "../src/operations-console/contracts.js";
import {
  OperationsConsoleDatabase,
  OPERATIONS_CONSOLE_DATABASE,
  OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
  OPERATIONS_CONSOLE_ORGANIZATION_ID,
} from "../src/operations-console/database.js";
import { DevelopmentOperatorSessionManager } from "../src/operations-console/session.js";
import { resetAndSeedOperationsConsoleDatabase } from "../scripts/run-internal-operations-console-new-listing.js";

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(here, "../src/operations-console");
const OWNER_ROLE = "medialab_p02m17a_test_owner";
const DATABASE_TOKEN = "server-bound-database-session-token-for-security-test";
const HOST_HEADERS = { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" };

let previewCalls = 0;
let app: ReturnType<typeof createOperationsConsoleApp>;

const fakeService: OperationsConsoleApplicationService = {
  async catalog() {
    return operationsConsoleContract("SelectableCatalogV1", {
      pricedAt: "2026-08-20T00:00:00.000Z", expiresAt: "2026-08-20T00:15:00.000Z",
      evidenceClassification: "NONPRODUCTION_RECONSTRUCTED" as const, disclosure: "Synthetic test boundary", choices: [],
    });
  },
  async preview() {
    previewCalls += 1;
    throw new Error("preview should not be reached by rejected security payloads");
  },
  async create() { throw new Error("create should not be reached by rejected security payloads"); },
  async order() { throw new Error("order should not be reached by rejected security payloads"); },
};

beforeAll(async () => {
  await resetAndSeedOperationsConsoleDatabase();
  app = createOperationsConsoleApp({
    service: fakeService,
    sessions: new DevelopmentOperatorSessionManager({ ttlSeconds: 900 }),
    developmentOperatorContext: {
      databaseSessionToken: DATABASE_TOKEN,
      organizationId: OPERATIONS_CONSOLE_ORGANIZATION_ID,
      actorPersonId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
      membershipId: "50d8b321-7b99-5bd9-b1a4-cecb924ecc39",
    },
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app?.close();
});

async function sessionCookie(): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/session", headers: { ...HOST_HEADERS, "content-type": "application/json" }, payload: "{}",
  });
  expect(response.statusCode).toBe(200);
  const cookie = response.headers["set-cookie"];
  expect(cookie).toBeTypeOf("string");
  return String(cookie).split(";", 1)[0]!;
}

describe("M17-A session, HTTP, runtime, and source authority", () => {
  it("uses an opaque HttpOnly Strict bounded cookie and never serializes the database session token", async () => {
    const response = await app.inject({
      method: "POST", url: "/session", headers: { ...HOST_HEADERS, "content-type": "application/json" }, payload: "{}",
    });
    expect(response.headers["set-cookie"]).toMatch(/^ml_m17a_operator=[A-Za-z0-9_-]{43}; Max-Age=900; Path=\/; HttpOnly; SameSite=Strict$/u);
    expect(response.body).not.toContain(DATABASE_TOKEN);
    expect(response.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/iu);
  });

  it("sets the complete security policy on HTML, assets, JSON, and errors", async () => {
    for (const url of ["/", "/app.js", "/styles.css", "/brand-logo.jpg", "/health", "/missing"]) {
      const response = await app.inject({ method: "GET", url, headers: { host: HOST_HEADERS.host } });
      expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(response.headers["content-security-policy"]).toContain("object-src 'none'");
      expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(response.headers["content-security-policy"]).not.toContain("unsafe-inline");
      expect(response.headers["permissions-policy"]).toContain("payment=()");
    }
  });

  it("rejects browser authority, UUID, source, and money fields before service execution", async () => {
    const cookie = await sessionCookie();
    const base = {
      customer: { displayName: "Security Candidate", email: "security@example.invalid" },
      property: { addressLine1: "1 Test Lane", addressLine2: null, locality: "Example City",
        administrativeArea: "NY", postalCode: "10001", countryCode: "US", squareFeet: 1800 },
      services: [{ choiceHandle: "OpaqueChoiceHandle_123456", quantity: 1 }],
    };
    for (const forbidden of [
      { actorId: randomUuid() }, { organizationId: randomUuid() }, { propertyId: randomUuid() },
      { parties: [] }, { source: "BROWSER" }, { totalCents: 1 }, { priceCents: 1 }, { providerIdentity: "external" },
    ]) {
      const response = await app.inject({
        method: "POST", url: "/api/listings/preview",
        headers: { ...HOST_HEADERS, cookie, "content-type": "application/json" }, payload: JSON.stringify({ ...base, ...forbidden }),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_REQUEST");
      expect(response.body).not.toContain(JSON.stringify(forbidden));
    }
    expect(previewCalls).toBe(0);
  });

  it("rejects malformed, unsupported, oversized, and cross-origin requests with bounded errors", async () => {
    const malformed = await app.inject({ method: "POST", url: "/session",
      headers: { ...HOST_HEADERS, "content-type": "application/json" }, payload: "{" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ contract: "OperationsConsoleErrorV1", error: { code: "INVALID_REQUEST" } });
    expect(malformed.json().requestReference).toBeTypeOf("string");

    const unsupported = await app.inject({ method: "POST", url: "/session",
      headers: { ...HOST_HEADERS, "content-type": "text/plain" }, payload: "{}" });
    expect(unsupported.statusCode).toBe(400);

    const oversized = await app.inject({ method: "POST", url: "/session",
      headers: { ...HOST_HEADERS, "content-type": "application/json" }, payload: JSON.stringify({ value: "x".repeat(70_000) }) });
    expect(oversized.statusCode).toBe(400);

    const crossOrigin = await app.inject({ method: "POST", url: "/session",
      headers: { host: HOST_HEADERS.host, origin: "https://example.invalid", "content-type": "application/json" }, payload: "{}" });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it("connects as the exact restricted role and denies direct canonical mutation", async () => {
    const database = new OperationsConsoleDatabase();
    try {
      await expect(database.assertRestrictedRuntime()).resolves.toEqual({
        user: "medialab_p02m17a_test_app", database: "medialab_p02m17a_test", port: 55448,
      });
    } finally {
      await database.close();
    }
    const runtime = new pg.Client(OPERATIONS_CONSOLE_DATABASE);
    await runtime.connect();
    try {
      await expect(runtime.query(
        "INSERT INTO medialab_core.people(id,display_name,email,created_at,updated_at) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp())",
        [randomUuid(), "Denied", "denied@example.invalid"],
      )).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtime.end();
    }
  });

  it("proves zero PUBLIC function execution and no Operations Console outbound/direct-table runtime code", async () => {
    const owner = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER_ROLE });
    await owner.connect();
    try {
      const result = await owner.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='medialab_core' AND has_function_privilege('public',p.oid,'EXECUTE')`,
      );
      expect(result.rows[0]!.count).toBe(0);
    } finally {
      await owner.end();
    }
    const sourceFiles = (await readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(sourceRoot, entry.name));
    const source = (await Promise.all(sourceFiles.map((path) => readFile(path, "utf8")))).join("\n");
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?medialab_core\./iu);
    expect(source).not.toMatch(/https?:\/\//iu);
    expect(source).not.toMatch(/\b(?:fetch|axios|got|undici|https?\.request)\s*\(/u);
    const server = await readFile(resolve(sourceRoot, "server.ts"), "utf8");
    expect(server).toContain('OPERATIONS_CONSOLE_HOST = "127.0.0.1"');
    expect(server).toContain("OPERATIONS_CONSOLE_PORT = 4317");
  });
});

function randomUuid(): string {
  return "78000000-0000-5000-8000-000000000001";
}
