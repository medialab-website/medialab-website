import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commercialFingerprint,
  OperationsConsoleDatabase,
  OPERATIONS_CONSOLE_DATABASE,
  OPERATIONS_CONSOLE_ORGANIZATION_ID,
  resolveCatalogSelections,
  sha256Evidence,
  type CreateListingTransactionCommand,
  type TransactionFaultStage,
} from "../src/operations-console/database.js";
import {
  issueOperationsConsoleDatabaseSession,
  resetAndSeedOperationsConsoleDatabase,
} from "../scripts/run-internal-operations-console-new-listing.js";

const OWNER_ROLE = "medialab_p02m17a_test_owner";
const here = dirname(fileURLToPath(import.meta.url));
const TABLES = [
  "people", "identities", "memberships", "person_external_references", "properties", "property_snapshots",
  "commercial_snapshots", "commercial_snapshot_package_items", "orders", "order_parties", "order_items",
  "order_external_references", "order_idempotency_records", "order_events", "order_relationships",
] as const;

let database: OperationsConsoleDatabase;
let databaseSessionToken: string;

async function ownerQuery(text: string, values: unknown[] = []): Promise<void> {
  const client = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER_ROLE });
  await client.connect();
  try {
    await client.query(text, values);
  } finally {
    await client.end();
  }
}

async function counts(): Promise<Record<string, number>> {
  const client = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER_ROLE });
  await client.connect();
  try {
    const result: Record<string, number> = {};
    for (const table of TABLES) {
      const row = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM medialab_core."${table}"`);
      result[table] = row.rows[0]!.count;
    }
    return result;
  } finally {
    await client.end();
  }
}

async function command(suffix: string, squareFeet = 1800): Promise<CreateListingTransactionCommand> {
  const customer = { displayName: `Transaction Candidate ${suffix}`, email: `transaction-${suffix}@example.invalid` };
  const property = {
    addressLine1: `${suffix} Transaction Lane`, addressLine2: null, locality: "Example City",
    administrativeArea: "NY", postalCode: "10001", countryCode: "US", squareFeet,
  };
  const selections = [
    { productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 },
    { productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 2 },
  ];
  const projection = await database.getCatalog(databaseSessionToken);
  const lines = resolveCatalogSelections(projection, selections, squareFeet);
  return {
    databaseSessionToken,
    submissionId: `transaction-${suffix}`,
    requestFingerprint: sha256Evidence({ customer, property, selections }),
    expectedCommercialFingerprint: commercialFingerprint(lines),
    customer,
    property,
    selections,
  };
}

async function reviseCommand(
  original: CreateListingTransactionCommand,
  fields: Partial<Pick<CreateListingTransactionCommand, "submissionId" | "customer" | "property">>,
): Promise<CreateListingTransactionCommand> {
  const revised = { ...original, ...fields };
  const projection = await database.getCatalog(databaseSessionToken);
  const lines = resolveCatalogSelections(projection, revised.selections, revised.property.squareFeet);
  return {
    ...revised,
    requestFingerprint: sha256Evidence({ customer: revised.customer, property: revised.property, selections: revised.selections }),
    expectedCommercialFingerprint: commercialFingerprint(lines),
  };
}

beforeAll(async () => {
  await resetAndSeedOperationsConsoleDatabase();
  ({ databaseSessionToken } = await issueOperationsConsoleDatabaseSession());
  database = new OperationsConsoleDatabase();
}, 30_000);

afterAll(async () => {
  await database?.close();
});

describe("M17-A complete listing transaction", () => {
  it("commits customer, property, commercial evidence, six parties, Order, and canonical readback together", async () => {
    const result = await database.createListing(await command("success"));
    expect(result.customer).toMatchObject({ outcome: "CREATED", membership_status: "ACTIVE", membership_outcome: "CREATED" });
    expect(result.property).toMatchObject({ property_outcome: "PROPERTY_CREATED", snapshot_outcome: "SNAPSHOT_CREATED" });
    expect(result.canonicalRecord.order.id).toBe(result.orderId);
    expect(result.postCommitRecord.order.id).toBe(result.orderId);
    expect(result.postCommitRecord.parties.map((party) => party.party_role).sort()).toEqual([
      "AUTHORIZED_ACTOR", "BILLING_PARTY", "COMMERCIAL_OWNER", "CUSTOMER", "ORDERING_PERSON", "ORGANIZATION",
    ]);
    expect(result.postCommitRecord.items).toHaveLength(2);
    expect(Number(result.postCommitRecord.order.item_subtotal_cents)).toBe(20500);
    expect(Number(result.postCommitRecord.order.travel_amount_cents)).toBe(0);
    expect(Number(result.postCommitRecord.order.total_amount_cents)).toBe(20500);
    expect(result.postCommitRecord.events).toHaveLength(2);
    expect(result.postCommitRecord.external_references).toHaveLength(1);
  }, 20_000);

  it("reuses exact customer/property facts and appends, then reuses, immutable square-foot snapshots", async () => {
    const first = await command("immutable", 1800);
    const created = await database.createListing(first);
    const changedProperty = { ...first.property, squareFeet: 1900 };
    const projection = await database.getCatalog(databaseSessionToken);
    const changedLines = resolveCatalogSelections(projection, first.selections, 1900);
    const changed: CreateListingTransactionCommand = {
      ...first,
      submissionId: "transaction-immutable-changed",
      property: changedProperty,
      requestFingerprint: sha256Evidence({ customer: first.customer, property: changedProperty, selections: first.selections }),
      expectedCommercialFingerprint: commercialFingerprint(changedLines),
    };
    const appended = await database.createListing(changed);
    const repeated = await database.createListing({
      ...changed,
      submissionId: "transaction-immutable-repeated",
      requestFingerprint: sha256Evidence({ repeated: true, customer: changed.customer, property: changed.property, selections: changed.selections }),
    });
    expect(appended.customer.outcome).toBe("REUSED");
    expect(appended.property).toMatchObject({ property_outcome: "PROPERTY_REUSED", snapshot_outcome: "SNAPSHOT_CREATED" });
    expect(repeated.property).toMatchObject({ property_outcome: "PROPERTY_REUSED", snapshot_outcome: "SNAPSHOT_REUSED" });
    expect(appended.property.property_id).toBe(created.property.property_id);
    expect(appended.property.property_snapshot_id).not.toBe(created.property.property_snapshot_id);
    expect(repeated.property.property_snapshot_id).toBe(appended.property.property_snapshot_id);
  }, 20_000);

  it("normalizes email case and whitespace, distinguishes different emails, and never merges by display name", async () => {
    const identitiesBefore = (await counts()).identities;
    const normalizedBase = await command("normalize-first");
    const first = await database.createListing(await reviseCommand(normalizedBase, {
      customer: { displayName: "Shared Display Name", email: "  Normalize.Customer@Example.Invalid  " },
    }));
    const secondBase = await command("normalize-second");
    const second = await database.createListing(await reviseCommand(secondBase, {
      customer: { displayName: "Changed Display Name", email: "normalize.customer@example.invalid" },
    }));
    const thirdBase = await command("normalize-third");
    const third = await database.createListing(await reviseCommand(thirdBase, {
      customer: { displayName: "Shared Display Name", email: "different.customer@example.invalid" },
    }));
    expect(first.customer.outcome).toBe("CREATED");
    expect(second.customer).toMatchObject({ outcome: "REUSED", membership_outcome: "REUSED" });
    expect(second.customer.person_id).toBe(first.customer.person_id);
    expect(third.customer.person_id).not.toBe(first.customer.person_id);
    expect((await counts()).identities).toBe(identitiesBefore);
  }, 20_000);

  it("rejects missing and invalid email evidence before mutation", async () => {
    for (const [index, email] of ["", "not-an-email"].entries()) {
      const base = await command(`invalid-email-${index + 1}`);
      const invalid = await reviseCommand(base, { customer: { ...base.customer, email } });
      const before = await counts();
      try {
        await database.createListing(invalid);
        throw new Error("missing or invalid email unexpectedly succeeded");
      } catch (error) {
        expect(["CONFLICT", "VALIDATION"]).toContain((error as { code?: string }).code);
      }
      expect(await counts()).toEqual(before);
    }
  }, 20_000);

  it("fails closed when normalized email evidence conflicts across canonical Persons", async () => {
    const migration = await readFile(resolve(here, "../db/migrations/0023_runtime_intake_reconciliation_commands.sql"), "utf8");
    expect(migration).toContain("Customer email evidence conflicts across canonical Persons");
    expect(migration).toContain("Customer email and external-reference evidence resolve to different Persons");
    expect(migration).toMatch(/coalesce\(array_length\(v_email_people, 1\), 0\) > 1/iu);
    expect(migration).toMatch(/USING ERRCODE = '23505'/u);
  });

  it("does not silently reactivate a suspended or removed customer membership", async () => {
    const createdCommand = await command("suspended-membership");
    const created = await database.createListing(createdCommand);
    await ownerQuery(
      `UPDATE medialab_core.memberships SET status='SUSPENDED',suspended_at=clock_timestamp(),
       suspension_reason='Synthetic fail-closed test state',updated_at=clock_timestamp() WHERE id=$1`,
      [created.customer.membership_id],
    );
    const retryBase = await command("suspended-membership-retry");
    const retry = await reviseCommand(retryBase, { customer: createdCommand.customer });
    const before = await counts();
    await expect(database.createListing(retry)).rejects.toMatchObject({ code: "AUTHORITY" });
    expect(await counts()).toEqual(before);
    const owner = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER_ROLE });
    await owner.connect();
    try {
      const membership = await owner.query<{ status: string }>("SELECT status FROM medialab_core.memberships WHERE id=$1", [created.customer.membership_id]);
      expect(membership.rows[0]!.status).toBe("SUSPENDED");
    } finally {
      await owner.end();
    }
  }, 20_000);

  it("keeps exact Property reuse tenant-scoped", async () => {
    const otherOrganization = "78200000-0000-5000-8000-000000000001";
    const otherProperty = "78200000-0000-5000-8000-000000000002";
    await ownerQuery(
      "INSERT INTO medialab_core.organizations(id,name,created_at,updated_at) VALUES($1,'Other Synthetic Tenant',clock_timestamp(),clock_timestamp())",
      [otherOrganization],
    );
    await ownerQuery(
      "INSERT INTO medialab_core.properties(id,organization_id,created_at,archived_at) VALUES($1,$2,clock_timestamp(),NULL)",
      [otherProperty, otherOrganization],
    );
    await ownerQuery(
      `INSERT INTO medialab_core.property_snapshots(
        id,property_id,organization_id,captured_at,address_line_1,address_line_2,locality,
        administrative_area,postal_code,country_code,reported_square_feet,created_at
       ) VALUES($1,$2,$3,clock_timestamp(),'Tenant Boundary Lane',NULL,'Example City','NY','10001','US',1800,clock_timestamp())`,
      ["78200000-0000-5000-8000-000000000003", otherProperty, otherOrganization],
    );
    const base = await command("tenant-boundary");
    const tenantCommand = await reviseCommand(base, {
      property: { ...base.property, addressLine1: "Tenant Boundary Lane" },
    });
    const result = await database.createListing(tenantCommand);
    expect(result.canonicalRecord.order.organization_id).toBe(OPERATIONS_CONSOLE_ORGANIZATION_ID);
    expect(result.property.property_id).not.toBe(otherProperty);
    expect(result.property.property_outcome).toBe("PROPERTY_CREATED");
  }, 20_000);

  it("fails closed when exact address evidence is ambiguous inside the tenant", async () => {
    for (const index of [1, 2]) {
      const propertyId = `78300000-0000-5000-8000-${String(index).padStart(12, "0")}`;
      const snapshotId = `78300000-0000-5000-9000-${String(index).padStart(12, "0")}`;
      await ownerQuery(
        "INSERT INTO medialab_core.properties(id,organization_id,created_at,archived_at) VALUES($1,$2,clock_timestamp(),NULL)",
        [propertyId, OPERATIONS_CONSOLE_ORGANIZATION_ID],
      );
      await ownerQuery(
        `INSERT INTO medialab_core.property_snapshots(
          id,property_id,organization_id,captured_at,address_line_1,address_line_2,locality,
          administrative_area,postal_code,country_code,reported_square_feet,created_at
         ) VALUES($1,$2,$3,clock_timestamp(),'Ambiguous Evidence Lane',NULL,'Example City','NY','10001','US',1800,clock_timestamp())`,
        [snapshotId, propertyId, OPERATIONS_CONSOLE_ORGANIZATION_ID],
      );
    }
    const base = await command("ambiguous-address");
    const ambiguous = await reviseCommand(base, {
      property: { ...base.property, addressLine1: "Ambiguous Evidence Lane" },
    });
    const before = await counts();
    await expect(database.createListing(ambiguous)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await counts()).toEqual(before);
  }, 20_000);

  it("rolls every canonical side effect back at all six packet fault points", async () => {
    const stages: TransactionFaultStage[] = [
      "after_customer", "after_property", "after_first_commercial_snapshot", "before_order",
      "after_order_before_readback", "after_readback_before_commit",
    ];
    for (const [index, stage] of stages.entries()) {
      const before = await counts();
      const injected = await command(`fault-${index + 1}`);
      await expect(database.createListing({ ...injected, fault: (observed) => {
        if (observed === stage) throw new Error("injected test failure");
      } })).rejects.toThrow(/could not be completed/iu);
      expect(await counts()).toEqual(before);
    }
  }, 30_000);
});
