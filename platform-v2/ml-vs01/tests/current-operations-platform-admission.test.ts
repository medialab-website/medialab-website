import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PUBLICATION_DELIVERY_PERMISSION_FIXTURES,
  PUBLICATION_DELIVERY_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/publication-delivery-entitlement-fixtures.js";
import {
  CLIENT_ACCOUNT_PERMISSION_FIXTURES,
  CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/client-account-contact-foundation-fixtures.js";
import {
  issueOperationsConsoleDatabaseSession,
  resetAndSeedOperationsConsoleDatabase,
} from "../scripts/run-internal-operations-console-new-listing.js";
import type { NormalizedAryeoOrderV1 } from "../src/current-admission/contracts.js";
import { CurrentOperationsAdmissionDatabase } from "../src/current-admission/platform-admission.js";
import { OPERATIONS_CONSOLE_DATABASE } from "../src/operations-console/database.js";

const OWNER = "medialab_p02m17a_test_owner";
const MANIFEST_SHA = createHash("sha256").update("synthetic-m23a-manifest").digest("hex");

function fixtureOrder(suffix: string): NormalizedAryeoOrderV1 {
  return {
    externalOrderId: `aryeo-order-${suffix}`,
    externalOrderIdentifier: `ORDER-${suffix.toUpperCase()}`,
    externalListingId: `aryeo-listing-${suffix}`,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    structure: "CURRENT_HOME_PACKAGE",
    sourceRecordType: "ARYEO_CURRENT_HOME_PACKAGE_ORDER",
    orderStatus: "OPEN",
    paymentState: "PAID",
    fulfillmentState: "FULFILLED",
    customer: {
      externalCustomerUserId: `aryeo-customer-user-${suffix}`,
      displayName: `Synthetic Customer ${suffix}`,
      email: `synthetic-${suffix}@example.invalid`,
      phone: "+14235550100",
    },
    clientAccount: {
      externalCustomerGroupId: `aryeo-customer-group-${suffix}`,
      customerGroupName: `Synthetic Customer Group ${suffix}`,
      externalCustomerTeamId: `aryeo-customer-team-${suffix}`,
      customerTeamName: `Synthetic Team ${suffix}`,
      brokerageName: `Synthetic Brokerage ${suffix}`,
    },
    property: {
      addressLine1: `${suffix.length + 10} Synthetic Way`,
      addressLine2: null,
      locality: "Bristol",
      administrativeArea: "TN",
      postalCode: "37620",
      countryCode: "US",
      timezone: "America/New_York",
      reportedSquareFeet: 1800,
    },
    serviceLines: [
      {
        externalItemId: `aryeo-item-${suffix}-1`,
        title: "Medium Home Package",
        description: "Synthetic exact package description.",
        quantity: 1,
        originalUnitAmountCents: 30000,
        effectiveUnitAmountCents: 27500,
        adjustmentAmountCents: -2500,
        lineTotalCents: 27500,
        currency: "USD",
      },
      {
        externalItemId: `aryeo-item-${suffix}-2`,
        title: "Virtual Twilight Photo",
        description: null,
        quantity: 2,
        originalUnitAmountCents: 1500,
        effectiveUnitAmountCents: 1500,
        adjustmentAmountCents: 0,
        lineTotalCents: 3000,
        currency: "USD",
      },
    ],
    appointments: [
      {
        externalAppointmentId: `aryeo-appointment-${suffix}`,
        status: "SCHEDULED",
        startsAt: "2026-08-04T14:00:00.000Z",
        endsAt: "2026-08-04T15:30:00.000Z",
        durationMinutes: 90,
        timezone: "America/New_York",
        rescheduledAt: "2026-08-03T12:00:00.000Z",
        previousStartsAt: "2026-08-04T13:00:00.000Z",
        assignedTeamMemberIds: [`aryeo-team-member-${suffix}`],
      },
    ],
    totalAmountCents: 30500,
    exceptionCodes: [],
  };
}

async function seedAdmissionPermissions(): Promise<void> {
  const owner = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER });
  await owner.connect();
  try {
    const financialPermission = PUBLICATION_DELIVERY_PERMISSION_FIXTURES.find(
      (candidate) => candidate.code === "delivery_financial_evidence.record",
    );
    const clientPermission = CLIENT_ACCOUNT_PERMISSION_FIXTURES.find(
      (candidate) => candidate.code === "client_account.manage",
    );
    if (!financialPermission || !clientPermission) throw new Error("M23A_PERMISSION_FIXTURE_DIVERGENCE");
    for (const permission of [financialPermission, clientPermission]) {
      const binding = [
        ...PUBLICATION_DELIVERY_PERMISSION_SET_PERMISSION_FIXTURES,
        ...CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES,
      ].find((candidate) => candidate.permission_id === permission.id);
      if (!binding) throw new Error("M23A_PERMISSION_BINDING_DIVERGENCE");
      await owner.query(
        `INSERT INTO medialab_core.permissions(id,code,description,is_active,created_at)
         VALUES($1,$2,$3,$4,$5)`,
        [permission.id, permission.code, permission.description, permission.is_active, permission.created_at],
      );
      await owner.query(
        `INSERT INTO medialab_core.permission_set_permissions(permission_set_id,permission_id,created_at)
         VALUES($1,$2,$3)`,
        [binding.permission_set_id, binding.permission_id, binding.created_at],
      );
    }
  } finally {
    await owner.end();
  }
}

async function sourceCounts(): Promise<Record<string, number>> {
  const owner = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER });
  await owner.connect();
  try {
    const tables = [
      "person_external_references", "properties", "property_snapshots", "custom_commercial_snapshots",
      "orders", "order_items", "property_hubs", "property_hub_orders", "jobs", "service_workstreams",
      "scheduling_requests", "appointments", "job_appointments", "job_service_external_references",
      "delivery_financial_eligibility_evidence", "client_accounts", "client_account_external_references",
      "client_account_revisions", "client_account_people", "order_client_accounts", "contact_methods",
      "client_contact_source_evidence", "client_intake_idempotency_records",
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const result = await owner.query<{ count: number }>(`SELECT count(*)::int AS count FROM medialab_core."${table}"`);
      counts[table] = result.rows[0]!.count;
    }
    return counts;
  } finally {
    await owner.end();
  }
}

describe.sequential("P02-M23-A restricted-runtime current operations admission", () => {
  let token: string;
  let database: CurrentOperationsAdmissionDatabase | undefined;

  beforeAll(async () => {
    await resetAndSeedOperationsConsoleDatabase(1);
    await seedAdmissionPermissions();
    token = (await issueOperationsConsoleDatabaseSession()).databaseSessionToken;
    database = new CurrentOperationsAdmissionDatabase();
  }, 120_000);

  afterAll(async () => { await database?.close(); });

  it("admits exact customer, property, lines, Hub, Job, appointment, assignment evidence, and payment meaning", async () => {
    const result = await database!.admitOrder(token, MANIFEST_SHA, fixtureOrder("exact"));
    expect(result).toMatchObject({ workstreamCount: 2, schedulingRequestCount: 1, appointmentCount: 1,
      canceledAppointmentCount: 0, assignmentReferenceCount: 1, exactTotalCents: 30500,
      structure: "CURRENT_HOME_PACKAGE", clientAccountPersonLinkCount: 2, orderClientAccountLinkCount: 2,
      customerPhoneEvidenceCount: 1, serviceItemReferenceCount: 2 });
    expect(result.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.propertyHubId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.jobId).toMatch(/^[0-9a-f-]{36}$/);
    const authority = await database!.authorityProof();
    expect(authority).toMatchObject({ runtimeCanonicalTableDmlGrants: 0, publicCanonicalTableDmlGrants: 0,
      publicFunctionExecutionGrants: 0, businessWriteBoundary: "SUPPORTED_SECURITY_DEFINER_COMMANDS_ONLY" });
  });

  it("replays and concurrent retries without duplicate canonical state", async () => {
    const order = fixtureOrder("replay");
    const first = await database!.admitOrder(token, MANIFEST_SHA, order);
    const afterFirst = await sourceCounts();
    const second = await database!.admitOrder(token, MANIFEST_SHA, order);
    const afterSecond = await sourceCounts();
    expect(second.orderId).toBe(first.orderId);
    expect(second.propertyHubId).toBe(first.propertyHubId);
    expect(second.jobId).toBe(first.jobId);
    expect(afterSecond).toEqual(afterFirst);

    const concurrentOrder = fixtureOrder("concurrent");
    const beforeConcurrent = await sourceCounts();
    const [left, right] = await Promise.all([
      database!.admitOrder(token, MANIFEST_SHA, concurrentOrder),
      database!.admitOrder(token, MANIFEST_SHA, concurrentOrder),
    ]);
    const afterConcurrent = await sourceCounts();
    expect(right.orderId).toBe(left.orderId);
    expect(afterConcurrent.orders - beforeConcurrent.orders).toBe(1);
    expect(afterConcurrent.property_hubs - beforeConcurrent.property_hubs).toBe(1);
    expect(afterConcurrent.jobs - beforeConcurrent.jobs).toBe(1);
    expect(afterConcurrent.appointments - beforeConcurrent.appointments).toBe(1);
  });

  it("rolls an injected failure back completely and remains retryable", async () => {
    const order = fixtureOrder("rollback");
    const before = await sourceCounts();
    await expect(database!.admitOrder(token, MANIFEST_SHA, order, (stage) => {
      if (stage === "after_first_appointment") throw new Error("INJECTED_M23A_FAILURE");
    })).rejects.toThrow("INJECTED_M23A_FAILURE");
    expect(await sourceCounts()).toEqual(before);
    const retry = await database!.admitOrder(token, MANIFEST_SHA, order);
    expect(retry.appointmentCount).toBe(1);
    const after = await sourceCounts();
    expect(after.orders - before.orders).toBe(1);
    expect(after.custom_commercial_snapshots - before.custom_commercial_snapshots).toBe(2);
    expect(after.delivery_financial_eligibility_evidence - before.delivery_financial_eligibility_evidence).toBe(1);
  });
});
