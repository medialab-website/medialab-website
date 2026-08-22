import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_OPERATIONS_ADMISSION_SCHEMA, type AryeoSnapshotManifestV1 } from "../src/current-admission/contracts.js";
import { loadAndNormalizeAryeoSnapshot } from "../src/current-admission/normalization.js";

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

const listing = {
  id: "listing-one", address: { unparsed_address_part_one: "1 Fixture Way", unparsed_address_part_two: null,
    city: "Example", state_or_province: "TN", postal_code: "37620", timezone: "America/New_York" },
  building: { square_feet: 1800 },
};
const customer = { id: "customer-group-one", name: "Private Fixture Customer Group", email: "Group@Example.Invalid", phone: "5555550100" };
const customerUser = { id: "customer-user-one", full_name: "Private Fixture Customer", first_name: "Private",
  last_name: "Customer", email: "Fixture@Example.Invalid", phone: "5555550101" };
const customerTeam = { id: "customer-team-one", name: "Private Fixture Team", brokerage_name: "Private Fixture Brokerage" };

function order(id: string, title: string, total: number) {
  return {
    id, identifier: id.toUpperCase(), created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-02T10:00:00Z",
    currency: "USD", order_status: "OPEN", payment_status: "PAID", fulfillment_status: "FULFILLED",
    total_amount: total, customer, listing: { id: listing.id }, address: listing.address,
    customer_team_membership: { customer_user: customerUser, customer_team: customerTeam },
    items: [{ id: `${id}-item`, title, description: "Synthetic private line", quantity: 2,
      unit_price_amount: 100, gross_total_amount: total, is_canceled: false }], appointments: [],
  };
}

async function fixtureRoot(): Promise<string> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "m23a-normalization-")));
  const root = join(parent, "snapshot");
  await mkdir(root, { mode: 0o700 });
  const records: Record<string, unknown[]> = {
    "customer-users": [], customers: [customer], "company-team-members": [],
    orders: [order("current-order", "Medium Home Package", 150), order("legacy-order", "Interior Photos", 200)],
    listings: [listing],
    appointments: [
      { id: "appointment-one", status: "SCHEDULED", start_at: "2026-08-03T14:00:00Z", end_at: null,
        duration: 60, rescheduled_at: "2026-08-02T12:00:00Z", previous_start_at: "2026-08-03T13:00:00Z",
        company_team_members: [{ id: "team-one" }], users: [], order: { id: "current-order" } },
      { id: "appointment-invalid", status: "CANCELED", start_at: "2026-08-04T14:00:00Z",
        end_at: "2026-08-04T14:00:00Z", duration: 0, rescheduled_at: null, previous_start_at: null,
        company_team_members: [], users: [], order: { id: "legacy-order" } },
    ],
    products: [], "product-categories": [],
  };
  const files: AryeoSnapshotManifestV1["datasetFiles"] = [];
  for (const [datasetId, datasetRecords] of Object.entries(records)) {
    const body = `${JSON.stringify({ schema: CURRENT_OPERATIONS_ADMISSION_SCHEMA, contract: "AryeoDatasetSnapshotV1",
      datasetId, endpointPath: `/${datasetId}`, method: "GET", acquiredAt: "2026-08-21T00:00:00Z",
      pageCount: 1, reportedTotal: datasetRecords.length, recordCount: datasetRecords.length,
      providerTimestamps: ["2026-08-21T00:00:00Z"], records: datasetRecords }, null, 2)}\n`;
    await writeFile(join(root, `${datasetId}.json`), body, { mode: 0o600 });
    files.push({ datasetId, relativePath: `${datasetId}.json`, byteSize: Buffer.byteLength(body), sha256: sha256(body),
      pageCount: 1, reportedTotal: datasetRecords.length, recordCount: datasetRecords.length });
  }
  const manifest: AryeoSnapshotManifestV1 = { schema: CURRENT_OPERATIONS_ADMISSION_SCHEMA,
    contract: "AryeoSnapshotManifestV1", method: "GET_ONLY", apiBaseUrl: "https://api.aryeo.com/v1",
    startedAt: "2026-08-21T00:00:00Z", completedAt: "2026-08-21T00:01:00Z", allowlistedDatasetCount: 8,
    datasetFiles: files, totalRecords: Object.values(records).reduce((sum, values) => sum + values.length, 0),
    secretMaterialIncluded: false, providerMutationCount: 0 };
  await writeFile(join(root, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return root;
}

describe("P02-M23-A current operations normalization", () => {
  it("preserves every order while separating Home Package and legacy-service structures", async () => {
    const root = await fixtureRoot();
    const { normalized, receipt } = await loadAndNormalizeAryeoSnapshot(root);
    expect(normalized.orders).toHaveLength(2);
    expect(receipt.classificationCounts).toEqual({ CURRENT_HOME_PACKAGE: 1, LEGACY_SERVICES: 1 });
    expect(normalized.orders.map((value) => value.sourceRecordType).sort()).toEqual([
      "ARYEO_CURRENT_HOME_PACKAGE_ORDER", "ARYEO_LEGACY_SERVICES_ORDER",
    ]);
    const current = normalized.orders.find((value) => value.structure === "CURRENT_HOME_PACKAGE")!;
    expect(current.customer).toMatchObject({ externalCustomerUserId: "customer-user-one",
      displayName: "Private Fixture Customer", email: "fixture@example.invalid" });
    expect(current.clientAccount).toEqual({ externalCustomerGroupId: "customer-group-one",
      customerGroupName: "Private Fixture Customer Group", externalCustomerTeamId: "customer-team-one",
      customerTeamName: "Private Fixture Team", brokerageName: "Private Fixture Brokerage" });
    expect(current.serviceLines[0]).toMatchObject({ quantity: 2, originalUnitAmountCents: 100,
      effectiveUnitAmountCents: 75, adjustmentAmountCents: -25, lineTotalCents: 150 });
    expect(current.appointments[0]).toMatchObject({ startsAt: "2026-08-03T14:00:00Z",
      endsAt: "2026-08-03T15:00:00.000Z", rescheduledAt: "2026-08-02T12:00:00Z" });
    const legacy = normalized.orders.find((value) => value.structure === "LEGACY_SERVICES")!;
    expect(legacy.exceptionCodes).toContain("INVALID_APPOINTMENT_TIME_EVIDENCE");
    expect(receipt.exceptionCounts.INVALID_APPOINTMENT_TIME_EVIDENCE).toBe(1);
    const publicBytes = JSON.stringify(receipt);
    expect(publicBytes).not.toContain("Private Fixture Customer");
    expect(publicBytes).not.toContain("Fixture@Example.Invalid");
    expect(receipt.containsCustomerPii).toBe(false);
    expect(receipt.providerMutationCount).toBe(0);
  });

  it("detects source-file drift before normalization", async () => {
    const root = await fixtureRoot();
    await writeFile(join(root, "orders.json"), "{}\n");
    await expect(loadAndNormalizeAryeoSnapshot(root)).rejects.toThrow(/identity mismatch/);
  });

  it("rejects a symlinked or noncanonical source root", async () => {
    const root = await fixtureRoot();
    await chmod(root, 0o700);
    const alias = `${root}-alias`;
    const { symlink } = await import("node:fs/promises");
    await symlink(root, alias);
    await expect(loadAndNormalizeAryeoSnapshot(alias)).rejects.toThrow(/BOUNDARY_FAILURE/);
    expect(await readFile(join(root, "MANIFEST.json"), "utf8")).toContain("AryeoSnapshotManifestV1");
  });
});
