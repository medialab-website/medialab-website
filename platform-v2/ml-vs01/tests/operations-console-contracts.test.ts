import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OPERATIONS_CONSOLE_CONTRACT_FAMILIES,
  OPERATIONS_CONSOLE_SCHEMA,
  OperationsConsoleRequestValidationError,
  operationsConsoleContract,
  parseCreateListingRequestV1,
  parseDevelopmentOperatorSessionRequestV1,
  parseListingPreviewRequestV1,
} from "../src/operations-console/contracts.js";
import {
  OperationsConsoleHttpError,
  operationsConsoleError,
  serializeOperationsConsoleError,
} from "../src/operations-console/errors.js";
import {
  DevelopmentOperatorSessionManager,
  OPERATIONS_CONSOLE_SESSION_COOKIE,
} from "../src/operations-console/session.js";

const choiceHandle = "CatalogChoiceHandle_0000000001";
const anotherChoiceHandle = "CatalogChoiceHandle_0000000002";
const previewReceipt = "P".repeat(43);

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected action to throw");
}

const validPreviewRequest = () => ({
  customer: {
    displayName: "  Casey   Customer  ",
    email: " CASEY.CUSTOMER@EXAMPLE.TEST ",
  },
  property: {
    addressLine1: "  101   Fixture Lane ",
    addressLine2: " ",
    locality: " Exampleville ",
    administrativeArea: " nc ",
    postalCode: " 00000 ",
    countryCode: " us ",
    squareFeet: 2_400,
  },
  services: [
    { choiceHandle, quantity: 1 },
    { choiceHandle: anotherChoiceHandle, quantity: 2 },
  ],
});

describe("P02-M17-A operations-console request contracts", () => {
  it("declares the exact nine versioned families under one schema", () => {
    expect(OPERATIONS_CONSOLE_SCHEMA).toBe("ML_INTERNAL_OPERATIONS_CONSOLE_V1");
    expect(OPERATIONS_CONSOLE_CONTRACT_FAMILIES).toEqual([
      "OperationsConsoleHealthV1",
      "DevelopmentOperatorSessionReceiptV1",
      "SelectableCatalogV1",
      "ListingPreviewRequestV1",
      "ListingPreviewV1",
      "CreateListingRequestV1",
      "ListingCreationReceiptV1",
      "CanonicalOrderConfirmationV1",
      "OperationsConsoleErrorV1",
    ]);
    expect(new Set(OPERATIONS_CONSOLE_CONTRACT_FAMILIES).size).toBe(9);
    expect(operationsConsoleContract("OperationsConsoleHealthV1", {
      status: "OK",
      environment: "NONPRODUCTION",
      observedAt: "2026-08-19T12:00:00.000Z",
    })).toEqual({
      schema: OPERATIONS_CONSOLE_SCHEMA,
      contract: "OperationsConsoleHealthV1",
      status: "OK",
      environment: "NONPRODUCTION",
      observedAt: "2026-08-19T12:00:00.000Z",
    });
  });

  it("keeps package inclusions and price brackets explicit in the selectable catalog contract", () => {
    const catalog = operationsConsoleContract("SelectableCatalogV1", {
      pricedAt: "2026-08-19T12:00:00.000Z",
      expiresAt: "2026-08-19T12:05:00.000Z",
      evidenceClassification: "NONPRODUCTION_RECONSTRUCTED",
      disclosure: "Reconstructed nonproduction catalog evidence.",
      choices: [{
        choiceHandle,
        kind: "PACKAGE",
        displayName: "Fixture package",
        description: "Synthetic fixture package",
        pricingBasis: "SQUARE_FEET",
        requiresSquareFeet: true,
        quantityMinimum: 1,
        quantityMaximum: 1,
        displayedPriceCents: null,
        currencyCode: "USD",
        inclusions: [{ displayName: "Fixture photos", quantity: 25, commercialUnit: "IMAGE", position: 1 }],
        priceBrackets: [{
          bracketCode: "FIXTURE_0_2499",
          basis: "SQUARE_FEET",
          lowerBound: 0,
          upperBound: 2_500,
          lowerInclusive: true,
          upperInclusive: false,
          amountCents: 20_000,
          currencyCode: "USD",
        }],
      }],
    });
    expect(catalog.choices[0].inclusions).toEqual([
      { displayName: "Fixture photos", quantity: 25, commercialUnit: "IMAGE", position: 1 },
    ]);
    expect(catalog.choices[0].priceBrackets[0]).toMatchObject({
      bracketCode: "FIXTURE_0_2499",
      basis: "SQUARE_FEET",
      amountCents: 20_000,
    });
  });

  it("accepts only an empty object for development session creation", () => {
    expect(parseDevelopmentOperatorSessionRequestV1({})).toEqual({});
    for (const invalid of [null, [], "", { actorPersonId: randomUUID() }, { databaseSessionToken: "not allowed" }, { role: "owner" }]) {
      expect(() => parseDevelopmentOperatorSessionRequestV1(invalid)).toThrow(OperationsConsoleRequestValidationError);
    }
  });

  it("normalizes the bounded customer, exact address tuple, and service choices", () => {
    expect(parseListingPreviewRequestV1(validPreviewRequest())).toEqual({
      customer: { displayName: "Casey Customer", email: "casey.customer@example.test" },
      property: {
        addressLine1: "101 Fixture Lane",
        addressLine2: null,
        locality: "Exampleville",
        administrativeArea: "NC",
        postalCode: "00000",
        countryCode: "US",
        squareFeet: 2_400,
      },
      services: [
        { choiceHandle, quantity: 1 },
        { choiceHandle: anotherChoiceHandle, quantity: 2 },
      ],
    });

    const withoutSquareFeet = validPreviewRequest();
    delete (withoutSquareFeet.property as Partial<typeof withoutSquareFeet.property>).squareFeet;
    expect(parseListingPreviewRequestV1(withoutSquareFeet).property).not.toHaveProperty("squareFeet");
  });

  it("rejects unknown authority, identity, source, provider, UUID, and money fields at every request boundary", () => {
    const forbiddenRootFields = [
      "actorPersonId",
      "organizationId",
      "membershipId",
      "customerPersonId",
      "propertyId",
      "sourceSystem",
      "providerIdentity",
      "unitAmountCents",
      "totalAmountCents",
      "currencyCode",
      "idempotencyKey",
    ];
    for (const field of forbiddenRootFields) {
      expect(() => parseListingPreviewRequestV1({ ...validPreviewRequest(), [field]: "browser-controlled" })).toThrow(/not allowed/);
    }

    expect(() => parseListingPreviewRequestV1({
      ...validPreviewRequest(),
      customer: { ...validPreviewRequest().customer, personId: randomUUID() },
    })).toThrow(/personId.*not allowed/);
    expect(() => parseListingPreviewRequestV1({
      ...validPreviewRequest(),
      property: { ...validPreviewRequest().property, snapshotId: randomUUID() },
    })).toThrow(/snapshotId.*not allowed/);
    expect(() => parseListingPreviewRequestV1({
      ...validPreviewRequest(),
      services: [{ choiceHandle, quantity: 1, priceCents: 1 }],
    })).toThrow(/priceCents.*not allowed/);

    for (const field of forbiddenRootFields) {
      expect(() => parseCreateListingRequestV1({ previewReceipt, [field]: "browser-controlled" })).toThrow(/not allowed/);
    }
  });

  it("enforces input bounds, exact keys, unique handles, and integer quantities", () => {
    expect(() => parseListingPreviewRequestV1({ ...validPreviewRequest(), unexpected: true })).toThrow(/unexpected.*not allowed/);
    expect(() => parseListingPreviewRequestV1({ ...validPreviewRequest(), customer: { displayName: "Casey" } })).toThrow(/email.*required/);
    expect(() => parseListingPreviewRequestV1({ ...validPreviewRequest(), customer: { displayName: "Casey", email: "invalid" } })).toThrow(/valid email/);
    expect(() => parseListingPreviewRequestV1({ ...validPreviewRequest(), customer: { displayName: "Casey\nCustomer", email: "casey@example.test" } })).toThrow(/control characters/);
    expect(() => parseListingPreviewRequestV1({ ...validPreviewRequest(), services: [] })).toThrow(/1-50/);
    expect(() => parseListingPreviewRequestV1({
      ...validPreviewRequest(),
      services: [{ choiceHandle, quantity: 1 }, { choiceHandle, quantity: 1 }],
    })).toThrow(/unique/);
    for (const invalidQuantity of [0, 1.5, 100, "1", null]) {
      expect(() => parseListingPreviewRequestV1({
        ...validPreviewRequest(),
        services: [{ choiceHandle, quantity: invalidQuantity }],
      })).toThrow(/integer from 1 through 99/);
    }
    expect(() => parseListingPreviewRequestV1({
      ...validPreviewRequest(),
      services: [{ choiceHandle: randomUUID(), quantity: 1 }],
    })).toThrow(/canonical identifier/);
    expect(() => parseListingPreviewRequestV1({
      ...validPreviewRequest(),
      services: [{ choiceHandle: ` ${choiceHandle}`, quantity: 1 }],
    })).toThrow(/opaque selection handle/);
    for (const invalidSquareFeet of [0, -1, 1.5, 1_000_001, "2400"]) {
      expect(() => parseListingPreviewRequestV1({
        ...validPreviewRequest(),
        property: { ...validPreviewRequest().property, squareFeet: invalidSquareFeet },
      })).toThrow(/integer from 1 through 1000000/);
    }
  });

  it("allows final creation from one opaque preview receipt and no repeated business input", () => {
    expect(parseCreateListingRequestV1({ previewReceipt })).toEqual({ previewReceipt });
    for (const invalid of [
      {},
      { previewReceipt: "short" },
      { previewReceipt: `${"x".repeat(31)}!` },
      { previewReceipt: randomUUID() },
      { previewReceipt, customer: validPreviewRequest().customer },
      { previewReceipt, services: validPreviewRequest().services },
    ]) {
      expect(() => parseCreateListingRequestV1(invalid)).toThrow(OperationsConsoleRequestValidationError);
    }
  });
});

describe("P02-M17-A bounded errors", () => {
  it("maps known failures to stable status/code/message combinations", () => {
    expect(serializeOperationsConsoleError(operationsConsoleError("PREVIEW_EXPIRED"), "req-fixture-001")).toEqual({
      statusCode: 410,
      body: {
        schema: OPERATIONS_CONSOLE_SCHEMA,
        contract: "OperationsConsoleErrorV1",
        requestReference: "req-fixture-001",
        error: {
          code: "PREVIEW_EXPIRED",
          message: "The listing preview has expired. Create a new preview.",
        },
      },
    });
    const conflict = operationsConsoleError("IDEMPOTENCY_CONFLICT");
    expect(conflict).toBeInstanceOf(OperationsConsoleHttpError);
    expect(conflict.statusCode).toBe(409);
  });

  it("never serializes raw validation, database, secret, or stack content", () => {
    const privateFailure = new Error("database password=fixture-secret at /Users/private/file.ts");
    const serialized = JSON.stringify(serializeOperationsConsoleError(privateFailure));
    expect(serialized).toContain("INTERNAL_ERROR");
    expect(serialized).not.toMatch(/password|fixture-secret|\/Users|stack/iu);

    const validation = serializeOperationsConsoleError(
      new OperationsConsoleRequestValidationError("$.databaseSessionToken is not allowed"),
      "../../private-request?token=secret",
    );
    expect(validation.statusCode).toBe(400);
    expect(JSON.stringify(validation)).not.toContain("databaseSessionToken");
    expect(validation.body.requestReference).toBe("request-unavailable");
    expect(JSON.stringify(validation)).not.toMatch(/private-request|token=secret/u);
  });
});

describe("P02-M17-A opaque development operator sessions", () => {
  const serverContext = {
    databaseSessionToken: "server-only-database-session-token",
    organizationId: "6d91cee6-91c1-52ea-937a-77c1ddc51c63",
    actorPersonId: "d43d9499-5175-5af8-a6b4-bd55ba765037",
    membershipId: "4badc340-b211-5baa-86ba-523ae9403ed4",
  } as const;

  it("issues a high-entropy bounded cookie while returning no database authority", () => {
    const manager = new DevelopmentOperatorSessionManager({
      ttlSeconds: 120,
      now: () => Date.parse("2026-08-19T12:00:00.000Z"),
    });
    const issued = manager.issue(serverContext);
    expect(issued.setCookieHeader).toMatch(
      new RegExp(`^${OPERATIONS_CONSOLE_SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Max-Age=120; Path=/; HttpOnly; SameSite=Strict$`),
    );
    expect(issued.receipt).toEqual({
      schema: OPERATIONS_CONSOLE_SCHEMA,
      contract: "DevelopmentOperatorSessionReceiptV1",
      authenticated: true,
      environment: "NONPRODUCTION",
      expiresAt: "2026-08-19T12:02:00.000Z",
    });
    const publicBytes = JSON.stringify(issued.receipt);
    expect(publicBytes).not.toMatch(/database|token|organization|actor|membership|6d91cee6/iu);

    const cookiePair = issued.setCookieHeader.split(";", 1)[0];
    const resolved = manager.resolveCookie(cookiePair);
    expect(resolved.databaseSessionToken).toBe(serverContext.databaseSessionToken);
    expect(resolved.organizationId).toBe(serverContext.organizationId);
    expect(resolved.actorPersonId).toBe(serverContext.actorPersonId);
    expect(resolved.membershipId).toBe(serverContext.membershipId);
    expect(JSON.stringify(resolved)).toBeUndefined();
  });

  it("uses distinct opaque handles and rejects malformed, duplicate, revoked, and expired cookies", () => {
    let now = Date.parse("2026-08-19T12:00:00.000Z");
    const manager = new DevelopmentOperatorSessionManager({ ttlSeconds: 60, now: () => now });
    const first = manager.issue(serverContext);
    const second = manager.issue(serverContext);
    const firstCookie = first.setCookieHeader.split(";", 1)[0];
    const secondCookie = second.setCookieHeader.split(";", 1)[0];
    expect(firstCookie).not.toBe(secondCookie);
    expect(manager.activeSessionCount).toBe(2);

    for (const invalid of [undefined, "", `${OPERATIONS_CONSOLE_SESSION_COOKIE}=short`, `${firstCookie}; ${secondCookie}`]) {
      expect(thrownBy(() => manager.resolveCookie(invalid))).toMatchObject({ code: "SESSION_REQUIRED", statusCode: 401 });
    }

    expect(manager.revokeCookie(firstCookie)).toBe(true);
    expect(manager.revokeCookie(firstCookie)).toBe(false);
    expect(thrownBy(() => manager.resolveCookie(firstCookie))).toMatchObject({ code: "SESSION_REQUIRED" });

    now += 60_001;
    expect(thrownBy(() => manager.resolveCookie(secondCookie))).toMatchObject({ code: "SESSION_EXPIRED", statusCode: 401 });
    expect(manager.activeSessionCount).toBe(0);
    expect(DevelopmentOperatorSessionManager.expiredCookieHeader()).toBe(
      `${OPERATIONS_CONSOLE_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`,
    );
  });

  it("bounds duration, active state, and server-side context before issuing", () => {
    expect(() => new DevelopmentOperatorSessionManager({ ttlSeconds: 59 })).toThrow(/ttl/);
    expect(() => new DevelopmentOperatorSessionManager({ ttlSeconds: 3_601 })).toThrow(/ttl/);

    const manager = new DevelopmentOperatorSessionManager({ maximumActiveSessions: 1 });
    manager.issue(serverContext);
    expect(thrownBy(() => manager.issue(serverContext))).toMatchObject({ code: "SERVICE_UNAVAILABLE", statusCode: 503 });

    const invalidContext = { ...serverContext, organizationId: "browser-text" };
    expect(() => new DevelopmentOperatorSessionManager().issue(invalidContext)).toThrow(/server-bound organization id/);
  });
});
