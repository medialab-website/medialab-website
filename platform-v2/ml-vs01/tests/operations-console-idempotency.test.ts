import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commercialFingerprint,
  deterministicSnapshotUuid,
  OperationsConsoleDatabase,
  OPERATIONS_CONSOLE_DATABASE,
  resolveCatalogSelections,
  sha256Evidence,
  type CreateListingTransactionCommand,
} from "../src/operations-console/database.js";
import {
  issueOperationsConsoleDatabaseSession,
  resetAndSeedOperationsConsoleDatabase,
} from "../scripts/run-internal-operations-console-new-listing.js";

const OWNER_ROLE = "medialab_p02m17a_test_owner";
const here = dirname(fileURLToPath(import.meta.url));
let database: OperationsConsoleDatabase;
let databaseSessionToken: string;

async function command(suffix: string): Promise<CreateListingTransactionCommand> {
  const customer = { displayName: `Replay Candidate ${suffix}`, email: `replay-${suffix}@example.invalid` };
  const property = {
    addressLine1: `${suffix} Replay Avenue`, addressLine2: null, locality: "Example City",
    administrativeArea: "NY", postalCode: "10001", countryCode: "US", squareFeet: 1800,
  };
  const selections = [
    { productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 },
    { productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 2 },
  ];
  const projection = await database.getCatalog(databaseSessionToken);
  const lines = resolveCatalogSelections(projection, selections, property.squareFeet);
  return {
    databaseSessionToken,
    submissionId: `replay-${suffix}`,
    requestFingerprint: sha256Evidence({ customer, property, selections }),
    expectedCommercialFingerprint: commercialFingerprint(lines),
    customer,
    property,
    selections,
  };
}

async function replayCounts(): Promise<Record<string, number>> {
  const client = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER_ROLE });
  await client.connect();
  try {
    const tables = ["people", "memberships", "properties", "property_snapshots", "commercial_snapshots",
      "commercial_snapshot_package_items", "orders", "order_parties", "order_items", "order_external_references",
      "order_idempotency_records", "order_events"];
    const values: Record<string, number> = {};
    for (const table of tables) {
      const row = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM medialab_core."${table}"`);
      values[table] = row.rows[0]!.count;
    }
    return values;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await resetAndSeedOperationsConsoleDatabase();
  ({ databaseSessionToken } = await issueOperationsConsoleDatabaseSession());
  database = new OperationsConsoleDatabase();
}, 30_000);

afterAll(async () => {
  await database?.close();
});

describe("M17-A idempotency and concurrency", () => {
  it("returns the original canonical Order on exact replay with no duplicate evidence", async () => {
    const request = await command("exact");
    const first = await database.createListing(request);
    const beforeReplay = await replayCounts();
    const second = await database.createListing(request);
    expect(second.orderId).toBe(first.orderId);
    expect(second.snapshotsReused).toBe(true);
    expect(second.commercialSnapshotIds).toEqual(first.commercialSnapshotIds);
    expect(await replayCounts()).toEqual(beforeReplay);
  }, 20_000);

  it("serializes simultaneous identical submissions to one Order and one evidence set", async () => {
    const request = await command("concurrent");
    const before = await replayCounts();
    const [one, two] = await Promise.all([database.createListing(request), database.createListing(request)]);
    const after = await replayCounts();
    expect(one.orderId).toBe(two.orderId);
    expect(after.orders - before.orders).toBe(1);
    expect(after.order_idempotency_records - before.order_idempotency_records).toBe(1);
    expect(after.order_parties - before.order_parties).toBe(6);
    expect(after.order_items - before.order_items).toBe(2);
    expect(after.order_events - before.order_events).toBe(2);
    expect(after.commercial_snapshots - before.commercial_snapshots).toBe(2);
  }, 20_000);

  it("rejects a changed payload under the same submission identity and rolls attempted evidence back", async () => {
    const original = await command("conflict");
    await database.createListing(original);
    const before = await replayCounts();
    const changed = {
      ...original,
      customer: { ...original.customer, email: "replay-conflict-changed@example.invalid" },
      requestFingerprint: sha256Evidence({ original: original.requestFingerprint, changed: true }),
    };
    await expect(database.createListing(changed)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await replayCounts()).toEqual(before);
  }, 20_000);

  it("keeps simultaneous different submissions independent", async () => {
    const [one, two] = await Promise.all([
      database.createListing(await command("independent-one")),
      database.createListing(await command("independent-two")),
    ]);
    expect(one.orderId).not.toBe(two.orderId);
  }, 20_000);

  it("derives snapshot UUIDs from full server context and accepts only the exact primary-key replay conflict", async () => {
    const base = "tenant:fingerprint:1:PRODUCT:1";
    expect(deterministicSnapshotUuid(base)).toBe(deterministicSnapshotUuid(base));
    expect(deterministicSnapshotUuid(base)).not.toBe(deterministicSnapshotUuid(`${base}:changed`));
    const source = await readFile(resolve(here, "../src/operations-console/database.ts"), "utf8");
    expect(source).toContain('postgresError.constraint !== "commercial_snapshots_pkey"');
    expect(source).toContain('ROLLBACK TO SAVEPOINT m17a_commercial_snapshots');
    expect(source).toContain('RELEASE SAVEPOINT m17a_commercial_snapshots');
  });
});
