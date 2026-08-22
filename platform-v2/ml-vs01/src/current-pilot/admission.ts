import { createHash, randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CurrentOperationsAdmissionDatabase,
  currentHomePackageAdmissionCohort,
  type CurrentOrderAdmissionObservationV1,
} from "../current-admission/platform-admission.js";
import { loadAndNormalizeAryeoSnapshot } from "../current-admission/normalization.js";
import type { NormalizedAryeoOrderV1 } from "../current-admission/contracts.js";
import type { ControlledPilotPaths } from "./config.js";
import { controlledPilotOwnerConnection } from "./persistent-database.js";

export const ACCEPTED_M23_SOURCE_MANIFEST_SHA256 = "02e3a65bdbfe77479dd61206a40a5b5fb6bf14cac0a34332d85eef942ebaeb53" as const;
export const ACCEPTED_M23_SOURCE_SEMANTIC_SHA256 = "9b3ce42f419459e553909912a6132dbbf23a8517eb95aabe21ddf42544024583" as const;

const EXPECTED = Object.freeze({
  listings: 306,
  sourceOrders: 324,
  sourceAppointments: 327,
  currentHomePackage: 77,
  admittedOrders: 71,
  currentExceptions: 6,
  legacyOrders: 247,
  propertyHubs: 71,
  jobs: 71,
  workstreams: 168,
  schedulingRequests: 76,
  appointments: 74,
  canceledAppointments: 2,
  clientAccounts: 35,
  clientAccountRevisions: 42,
  clientAccountPeople: 42,
  orderClientAccounts: 142,
  customerPhoneEvidence: 20,
  financialEvidence: 71,
  exactAdmittedOrderTotalCents: 2_631_600,
});

const OWNER_REJECTED_ORPHAN_ORDER_HASHES = new Set([
  "290035fabd815ab021e23a09a92de7ca8f289f0b4a8d6c2280baba7dad93e8ac",
  "adc1252bc37cab1d8d2cb5acc24f3c9f40bfc65be79daf3dc0af3b20714adeab",
  "6dce8fd873d239718d6925cece60c4bd597184b8ab96fc645f34888b53ebaca7",
]);

export interface ControlledPilotCanonicalCounts {
  orders: number;
  propertyHubs: number;
  jobs: number;
  workstreams: number;
  schedulingRequests: number;
  appointments: number;
  canceledAppointments: number;
  clientAccounts: number;
  clientAccountRevisions: number;
  clientAccountPeople: number;
  orderClientAccounts: number;
  customerPhoneEvidence: number;
  financialEvidence: number;
  nonAryeoOrders: number;
}

export interface ControlledPilotStateV1 {
  schema: "ML_CONTROLLED_MISSION_CONTROL_PILOT_V1";
  contract: "ControlledPilotStateV1";
  generatedAt: string;
  source: {
    manifestSha256: typeof ACCEPTED_M23_SOURCE_MANIFEST_SHA256;
    semanticSha256: typeof ACCEPTED_M23_SOURCE_SEMANTIC_SHA256;
    listings: 306;
    orders: 324;
    appointments: 327;
    currentHomePackageOrders: 77;
    admittedOrders: 71;
    currentExceptions: 6;
    preservedExceptions: 3;
    ownerRejectedOrphanOrders: 3;
    deferredLegacyOrders: 247;
  };
  canonical: ControlledPilotCanonicalCounts;
  exactAdmittedOrderTotalCents: 2631600;
  authority: Awaited<ReturnType<CurrentOperationsAdmissionDatabase["authorityProof"]>>;
  checks: {
    firstPassStable: true;
    sequentialReplayStable: true;
    concurrentReplayStable: true;
    injectedFailureRolledBack: true;
    injectedFailureRetryStable: true;
    noSyntheticOrders: true;
    restrictedRuntimeOnly: true;
  };
  providerMutationCount: 0;
  containsCustomerPii: false;
  containsProviderSecret: false;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameCounts(left: ControlledPilotCanonicalCounts, right: ControlledPilotCanonicalCounts): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function canonicalCounts(): Promise<ControlledPilotCanonicalCounts> {
  const client = controlledPilotOwnerConnection();
  await client.connect();
  try {
    const result = await client.query<ControlledPilotCanonicalCounts>(
      `SELECT
        (SELECT count(*)::int FROM medialab_core.orders) AS "orders",
        (SELECT count(*)::int FROM medialab_core.property_hubs) AS "propertyHubs",
        (SELECT count(*)::int FROM medialab_core.jobs) AS "jobs",
        (SELECT count(*)::int FROM medialab_core.service_workstreams) AS "workstreams",
        (SELECT count(*)::int FROM medialab_core.scheduling_requests) AS "schedulingRequests",
        (SELECT count(*)::int FROM medialab_core.appointments) AS "appointments",
        (SELECT count(*)::int FROM medialab_core.appointments a
          WHERE medialab_core.current_appointment_state(a.id)='CANCELLED') AS "canceledAppointments",
        (SELECT count(*)::int FROM medialab_core.client_accounts) AS "clientAccounts",
        (SELECT count(*)::int FROM medialab_core.client_account_revisions) AS "clientAccountRevisions",
        (SELECT count(*)::int FROM medialab_core.client_account_people) AS "clientAccountPeople",
        (SELECT count(*)::int FROM medialab_core.order_client_accounts) AS "orderClientAccounts",
        (SELECT count(*)::int FROM medialab_core.client_contact_source_evidence) AS "customerPhoneEvidence",
        (SELECT count(*)::int FROM medialab_core.delivery_financial_eligibility_evidence) AS "financialEvidence",
        (SELECT count(*)::int FROM medialab_core.orders WHERE source_system <> 'ARYEO') AS "nonAryeoOrders"`,
    );
    return result.rows[0]!;
  } finally {
    await client.end();
  }
}

function exactObservationIdentity(
  left: CurrentOrderAdmissionObservationV1,
  right: CurrentOrderAdmissionObservationV1,
): boolean {
  return left.orderId === right.orderId && left.propertyHubId === right.propertyHubId &&
    left.jobId === right.jobId && left.customerPersonId === right.customerPersonId &&
    left.customerGroupAccountId === right.customerGroupAccountId &&
    left.customerTeamAccountId === right.customerTeamAccountId;
}

function assertCanonicalCounts(counts: ControlledPilotCanonicalCounts): void {
  const expected: ControlledPilotCanonicalCounts = {
    orders: EXPECTED.admittedOrders,
    propertyHubs: EXPECTED.propertyHubs,
    jobs: EXPECTED.jobs,
    workstreams: EXPECTED.workstreams,
    schedulingRequests: EXPECTED.schedulingRequests,
    appointments: EXPECTED.appointments,
    canceledAppointments: EXPECTED.canceledAppointments,
    clientAccounts: EXPECTED.clientAccounts,
    clientAccountRevisions: EXPECTED.clientAccountRevisions,
    clientAccountPeople: EXPECTED.clientAccountPeople,
    orderClientAccounts: EXPECTED.orderClientAccounts,
    customerPhoneEvidence: EXPECTED.customerPhoneEvidence,
    financialEvidence: EXPECTED.financialEvidence,
    nonAryeoOrders: 0,
  };
  if (!sameCounts(counts, expected)) throw new Error("M24A_CANONICAL_COUNT_DIVERGENCE");
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.${path.split("/").at(-1)}.partial-${process.pid}-${randomUUID()}`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function currentExceptions(
  orders: readonly NormalizedAryeoOrderV1[],
  readyOrders: readonly NormalizedAryeoOrderV1[],
): Array<{
  sourceOrderReferenceSha256: string;
  exceptionCodes: string[];
}> {
  const ready = new Set(readyOrders.map((order) => order.externalOrderId));
  return orders.filter((order) => order.structure === "CURRENT_HOME_PACKAGE" && !ready.has(order.externalOrderId))
    .map((order) => ({
      sourceOrderReferenceSha256: sha256(order.externalOrderId),
      exceptionCodes: [...order.exceptionCodes].sort(),
    }))
    .sort((left, right) => left.sourceOrderReferenceSha256.localeCompare(right.sourceOrderReferenceSha256));
}

function privateCurrentExceptions(
  orders: readonly NormalizedAryeoOrderV1[],
  readyOrders: readonly NormalizedAryeoOrderV1[],
): Array<{
  sourceOrderId: string;
  orderIdentifier: string;
  customer: { displayName: string; email: string | null } | null;
  property: { addressLine1: string; addressLine2: string | null; locality: string;
    administrativeArea: string; postalCode: string } | null;
  appointments: NormalizedAryeoOrderV1["appointments"];
  exceptionCodes: string[];
}> {
  const ready = new Set(readyOrders.map((order) => order.externalOrderId));
  return orders.filter((order) => order.structure === "CURRENT_HOME_PACKAGE" && !ready.has(order.externalOrderId))
    .filter((order) => !OWNER_REJECTED_ORPHAN_ORDER_HASHES.has(sha256(order.externalOrderId)))
    .map((order) => ({
      sourceOrderId: order.externalOrderId,
      orderIdentifier: order.externalOrderIdentifier,
      customer: order.customer === null ? null : {
        displayName: order.customer.displayName,
        email: order.customer.email,
      },
      property: order.property === null ? null : {
        addressLine1: order.property.addressLine1,
        addressLine2: order.property.addressLine2,
        locality: order.property.locality,
        administrativeArea: order.property.administrativeArea,
        postalCode: order.property.postalCode,
      },
      appointments: order.appointments,
      exceptionCodes: [...order.exceptionCodes].sort(),
    }))
    .sort((left, right) => left.orderIdentifier.localeCompare(right.orderIdentifier));
}

export async function admitControlledPilotCurrentOperations(
  paths: ControlledPilotPaths,
  databaseSessionToken: string,
): Promise<ControlledPilotStateV1> {
  const { normalized, receipt } = await loadAndNormalizeAryeoSnapshot(paths.sourceRoot);
  if (normalized.sourceManifestSha256 !== ACCEPTED_M23_SOURCE_MANIFEST_SHA256 ||
      normalized.semanticSha256 !== ACCEPTED_M23_SOURCE_SEMANTIC_SHA256 ||
      normalized.listingCount !== EXPECTED.listings || normalized.orderCount !== EXPECTED.sourceOrders ||
      normalized.appointmentCount !== EXPECTED.sourceAppointments ||
      receipt.classificationCounts.CURRENT_HOME_PACKAGE !== EXPECTED.currentHomePackage ||
      receipt.classificationCounts.LEGACY_SERVICES !== EXPECTED.legacyOrders ||
      receipt.admissionReadiness.currentHomePackageReady !== EXPECTED.admittedOrders ||
      receipt.admissionReadiness.currentHomePackageExceptionOnly !== EXPECTED.currentExceptions) {
    throw new Error("M24A_ACCEPTED_SOURCE_IDENTITY_DIVERGENCE");
  }
  const cohort = currentHomePackageAdmissionCohort(normalized);
  const exceptions = currentExceptions(normalized.orders, cohort);
  const preservedExceptions = exceptions.filter((record) =>
    !OWNER_REJECTED_ORPHAN_ORDER_HASHES.has(record.sourceOrderReferenceSha256));
  const ownerRejectedOrphans = exceptions.filter((record) =>
    OWNER_REJECTED_ORPHAN_ORDER_HASHES.has(record.sourceOrderReferenceSha256));
  const privateExceptions = privateCurrentExceptions(normalized.orders, cohort);
  if (cohort.length !== EXPECTED.admittedOrders || exceptions.length !== EXPECTED.currentExceptions ||
      preservedExceptions.length !== 3 || ownerRejectedOrphans.length !== 3 || privateExceptions.length !== 3) {
    throw new Error("M24A_COHORT_DIVERGENCE");
  }

  const database = new CurrentOperationsAdmissionDatabase("CONTROLLED_PILOT");
  try {
    const first: CurrentOrderAdmissionObservationV1[] = [];
    for (const order of cohort) {
      first.push(await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, order));
    }
    const firstCounts = await canonicalCounts();
    assertCanonicalCounts(firstCounts);

    const replay: CurrentOrderAdmissionObservationV1[] = [];
    for (const order of cohort) {
      replay.push(await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, order));
    }
    const replayCounts = await canonicalCounts();
    const sequentialReplayStable = sameCounts(firstCounts, replayCounts) &&
      replay.every((result, index) => exactObservationIdentity(result, first[index]!));
    if (!sequentialReplayStable) throw new Error("M24A_SEQUENTIAL_REPLAY_DIVERGENCE");

    const concurrentReplay: CurrentOrderAdmissionObservationV1[] = [];
    for (let offset = 0; offset < cohort.length; offset += 4) {
      concurrentReplay.push(...await Promise.all(cohort.slice(offset, offset + 4).map((order) =>
        database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, order))));
    }
    const concurrentCounts = await canonicalCounts();
    const concurrentReplayStable = concurrentReplay.every((result, index) =>
      exactObservationIdentity(result, first[index]!)) && sameCounts(replayCounts, concurrentCounts);
    if (!concurrentReplayStable) throw new Error("M24A_CONCURRENT_REPLAY_DIVERGENCE");

    let injectedFailureRejected = false;
    try {
      await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, cohort[0]!, (stage) => {
        if (stage === "after_property") throw new Error("M24A_INJECTED_ADMISSION_FAILURE");
      });
    } catch (error) {
      if ((error as Error).message === "M24A_INJECTED_ADMISSION_FAILURE") injectedFailureRejected = true;
      else throw error;
    }
    const failureCounts = await canonicalCounts();
    const injectedFailureRolledBack = injectedFailureRejected && sameCounts(concurrentCounts, failureCounts);
    if (!injectedFailureRolledBack) throw new Error("M24A_INJECTED_FAILURE_ROLLBACK_DIVERGENCE");
    const retry = await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, cohort[0]!);
    const retryCounts = await canonicalCounts();
    const injectedFailureRetryStable = exactObservationIdentity(retry, first[0]!) && sameCounts(failureCounts, retryCounts);
    if (!injectedFailureRetryStable) throw new Error("M24A_INJECTED_FAILURE_RETRY_DIVERGENCE");

    const authority = await database.authorityProof();
    const restrictedRuntimeOnly = authority.runtimeCanonicalTableDmlGrants === 0 &&
      authority.runtimeCanonicalSequenceGrants === 0 && authority.publicCanonicalTableDmlGrants === 0 &&
      authority.publicCanonicalSequenceGrants === 0 && authority.publicFunctionExecutionGrants === 0 &&
      authority.runtimeRoleCanLogin && !authority.runtimeRoleInherit && !authority.runtimeRoleSuperuser &&
      !authority.runtimeRoleCreateDatabase && !authority.runtimeRoleCreateRole && !authority.runtimeRoleReplication &&
      !authority.runtimeRoleBypassRls && authority.runtimeRoleMembershipCount === 0 &&
      authority.businessExecutionRole === "medialab_p02m24a_pilot_app";
    if (!restrictedRuntimeOnly) throw new Error("M24A_RUNTIME_AUTHORITY_DIVERGENCE");

    const exactTotal = first.reduce((sum, item) => sum + item.exactTotalCents, 0);
    if (exactTotal !== EXPECTED.exactAdmittedOrderTotalCents) throw new Error("M24A_ADMITTED_TOTAL_DIVERGENCE");
    const state: ControlledPilotStateV1 = {
      schema: "ML_CONTROLLED_MISSION_CONTROL_PILOT_V1",
      contract: "ControlledPilotStateV1",
      generatedAt: new Date().toISOString(),
      source: {
        manifestSha256: ACCEPTED_M23_SOURCE_MANIFEST_SHA256,
        semanticSha256: ACCEPTED_M23_SOURCE_SEMANTIC_SHA256,
        listings: 306,
        orders: 324,
        appointments: 327,
        currentHomePackageOrders: 77,
        admittedOrders: 71,
        currentExceptions: 6,
        preservedExceptions: 3,
        ownerRejectedOrphanOrders: 3,
        deferredLegacyOrders: 247,
      },
      canonical: failureCounts,
      exactAdmittedOrderTotalCents: 2_631_600,
      authority,
      checks: {
        firstPassStable: true,
        sequentialReplayStable: true,
        concurrentReplayStable: true,
        injectedFailureRolledBack: true,
        injectedFailureRetryStable: true,
        noSyntheticOrders: true,
        restrictedRuntimeOnly: true,
      },
      providerMutationCount: 0,
      containsCustomerPii: false,
      containsProviderSecret: false,
    };
    await Promise.all([
      writeAtomic(paths.statePath, state),
      writeAtomic(join(paths.evidenceRoot, "EXCEPTION_REGISTER.json"), {
        schema: state.schema,
        contract: "ControlledPilotExceptionRegisterV1",
        sourceManifestSha256: state.source.manifestSha256,
        sourceExceptionCount: exceptions.length,
        preservedExceptionCount: preservedExceptions.length,
        ownerRejectedOrphanOrderCount: ownerRejectedOrphans.length,
        deferredLegacyOrderCount: EXPECTED.legacyOrders,
        records: preservedExceptions,
        containsCustomerPii: false,
      }),
      writeAtomic(join(paths.evidenceRoot, "OWNER_EXCLUSION_RECEIPT.json"), {
        schema: state.schema,
        contract: "ControlledPilotOwnerExclusionReceiptV1",
        sourceManifestSha256: state.source.manifestSha256,
        disposition: "OWNER_REJECTED_ACCIDENTAL_ORPHAN_CREATION",
        excludedFromPilot: true,
        eligibleForFutureConsolidation: false,
        recordCount: ownerRejectedOrphans.length,
        sourceOrderReferenceSha256: ownerRejectedOrphans.map((record) => record.sourceOrderReferenceSha256).sort(),
        containsCustomerPii: false,
      }),
      writeAtomic(paths.privateExceptionPath, {
        schema: state.schema,
        contract: "ControlledPilotPrivateExceptionRegisterV1",
        sourceManifestSha256: state.source.manifestSha256,
        sourceExceptionCount: exceptions.length,
        preservedExceptionCount: privateExceptions.length,
        ownerRejectedOrphanOrderCount: ownerRejectedOrphans.length,
        records: privateExceptions,
        localOwnerOnly: true,
        reviewEvidenceEligible: false,
        containsCustomerPii: true,
        containsProviderSecret: false,
      }),
    ]);
    return Object.freeze(state);
  } finally {
    await database.close();
  }
}
