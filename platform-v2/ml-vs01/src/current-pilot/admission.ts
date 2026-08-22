import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
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
  freshAdmissionProof: {
    contract: "FreshAcceptedCohortFailureRetryReceiptV1";
    receiptSha256: string;
    targetSourceOrderReferenceSha256: string;
    injectedStage: "after_first_appointment";
    completeStateVectorTableCount: number;
    baselineStateVectorSha256: string;
    postFailureStateVectorSha256: string;
    postRetryStateVectorSha256: string;
    targetCanonicalStateSha256: string;
  };
  checks: {
    firstPassStable: true;
    sequentialReplayStable: true;
    concurrentReplayStable: true;
    injectedFailureRolledBack: true;
    injectedFailureRetryStable: true;
    freshAcceptedCohortFailureTarget: true;
    freshAdmissionProofReceiptVerified: true;
    noSyntheticOrders: true;
    restrictedRuntimeOnly: true;
  };
  providerMutationCount: 0;
  containsCustomerPii: false;
  containsProviderSecret: false;
}

interface CompleteCanonicalStateVector {
  tableCount: number;
  counts: Record<string, number>;
  contentSha256: Record<string, string>;
  sha256: string;
}

interface TargetCanonicalState {
  orderId: string;
  propertyId: string;
  propertySnapshotId: string;
  propertyHubIds: string[];
  jobIds: string[];
  orderItemCount: number;
  orderPartyCount: number;
  workstreamCount: number;
  schedulingRequestCount: number;
  appointmentCount: number;
  canceledAppointmentCount: number;
  jobAppointmentCount: number;
  jobServiceExternalReferenceCount: number;
  financialEvidenceCount: number;
  orderClientAccountCount: number;
  externalReferenceCount: number;
  exactTotalCents: number;
}

interface FreshAcceptedCohortFailureRetryReceiptV1 {
  schema: "ML_CONTROLLED_MISSION_CONTROL_PILOT_FRESH_ADMISSION_PROOF_V1";
  contract: "FreshAcceptedCohortFailureRetryReceiptV1";
  sourceManifestSha256: typeof ACCEPTED_M23_SOURCE_MANIFEST_SHA256;
  targetSourceOrderReferenceSha256: string;
  injectedStage: "after_first_appointment";
  injectedFailureCode: "M24A_FRESH_ACCEPTED_COHORT_ADMISSION_FAILURE";
  targetAbsentBeforeAttempt: true;
  targetAbsentAfterFailure: true;
  rollbackExactAcrossEveryCanonicalTable: true;
  retryCreatedExactTargetState: true;
  completeStateVectorTableCount: number;
  baseline: CompleteCanonicalStateVector;
  postFailure: CompleteCanonicalStateVector;
  postRetry: CompleteCanonicalStateVector;
  retryDelta: Record<string, number>;
  expectedTarget: {
    serviceLineCount: number;
    schedulingRequestCount: number;
    appointmentCount: number;
    canceledAppointmentCount: number;
    assignmentReferenceCount: number;
    exactTotalCents: number;
  };
  observedTarget: Omit<TargetCanonicalState, "orderId" | "propertyId" | "propertySnapshotId" |
    "propertyHubIds" | "jobIds">;
  targetCanonicalStateSha256: string;
  containsCustomerPii: false;
  containsProviderSecret: false;
  providerMutationCount: 0;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameCounts(left: ControlledPilotCanonicalCounts, right: ControlledPilotCanonicalCounts): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function orderedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function stateVectorSha256(counts: Record<string, number>, contentSha256: Record<string, string>): string {
  return sha256(JSON.stringify({ counts: orderedRecord(counts), contentSha256: orderedRecord(contentSha256) }));
}

function exactStateVector(left: CompleteCanonicalStateVector, right: CompleteCanonicalStateVector): boolean {
  return left.tableCount === right.tableCount && left.sha256 === right.sha256 &&
    JSON.stringify(left.counts) === JSON.stringify(right.counts) &&
    JSON.stringify(left.contentSha256) === JSON.stringify(right.contentSha256);
}

function stateVectorDelta(
  before: CompleteCanonicalStateVector,
  after: CompleteCanonicalStateVector,
): Record<string, number> {
  if (before.tableCount !== after.tableCount || Object.keys(before.counts).join(":") !== Object.keys(after.counts).join(":") ||
      Object.keys(before.contentSha256).join(":") !== Object.keys(after.contentSha256).join(":")) {
    throw new Error("M24A_COMPLETE_STATE_VECTOR_TABLE_DIVERGENCE");
  }
  return Object.fromEntries(Object.keys(before.counts).map((table) => [table, after.counts[table]! - before.counts[table]!]));
}

async function completeCanonicalStateVector(): Promise<CompleteCanonicalStateVector> {
  const client = controlledPilotOwnerConnection();
  await client.connect();
  try {
    const inventory = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='medialab_core' ORDER BY tablename`,
    );
    const counts: Record<string, number> = {};
    const contentSha256: Record<string, string> = {};
    for (const { tablename } of inventory.rows) {
      if (!/^[a-z][a-z0-9_]*$/u.test(tablename)) throw new Error("M24A_COMPLETE_STATE_VECTOR_TABLE_NAME_DIVERGENCE");
      const result = await client.query<{ row_json: string }>(
        `SELECT to_jsonb(candidate)::text AS row_json FROM medialab_core."${tablename}" candidate`,
      );
      const canonicalRows = result.rows.map((row) => row.row_json).sort();
      counts[tablename] = canonicalRows.length;
      contentSha256[tablename] = sha256(JSON.stringify(canonicalRows));
    }
    if (Object.keys(counts).length === 0) throw new Error("M24A_COMPLETE_STATE_VECTOR_EMPTY");
    return Object.freeze({
      tableCount: Object.keys(counts).length,
      counts,
      contentSha256,
      sha256: stateVectorSha256(counts, contentSha256),
    });
  } finally {
    await client.end();
  }
}

async function targetCanonicalState(order: NormalizedAryeoOrderV1): Promise<TargetCanonicalState | null> {
  const client = controlledPilotOwnerConnection();
  await client.connect();
  try {
    const result = await client.query<{
      order_id: string;
      property_id: string;
      property_snapshot_id: string;
      property_hub_ids: string[];
      job_ids: string[];
      order_item_count: number;
      order_party_count: number;
      workstream_count: number;
      scheduling_request_count: number;
      appointment_count: number;
      canceled_appointment_count: number;
      job_appointment_count: number;
      job_service_external_reference_count: number;
      financial_evidence_count: number;
      order_client_account_count: number;
      external_reference_count: number;
      exact_total_cents: number | string;
    }>(
      `WITH target AS (
         SELECT o.id,o.property_id,o.property_snapshot_id,o.total_amount_cents
         FROM medialab_core.order_external_references r
         JOIN medialab_core.orders o ON o.id=r.order_id
         WHERE r.provider='ARYEO' AND r.external_record_type=$1 AND r.external_identifier=$2
       )
       SELECT t.id AS order_id,t.property_id,t.property_snapshot_id,t.total_amount_cents AS exact_total_cents,
         ARRAY(SELECT pho.property_hub_id::text FROM medialab_core.property_hub_orders pho
           WHERE pho.order_id=t.id ORDER BY pho.property_hub_id) AS property_hub_ids,
         ARRAY(SELECT j.id::text FROM medialab_core.jobs j WHERE j.order_id=t.id ORDER BY j.id) AS job_ids,
         (SELECT count(*)::int FROM medialab_core.order_items oi WHERE oi.order_id=t.id) AS order_item_count,
         (SELECT count(*)::int FROM medialab_core.order_parties op WHERE op.order_id=t.id) AS order_party_count,
         (SELECT count(*)::int FROM medialab_core.service_workstreams sw JOIN medialab_core.jobs j ON j.id=sw.job_id
           WHERE j.order_id=t.id) AS workstream_count,
         (SELECT count(*)::int FROM medialab_core.scheduling_requests sr WHERE sr.order_id=t.id) AS scheduling_request_count,
         (SELECT count(*)::int FROM medialab_core.appointments a JOIN medialab_core.scheduling_requests sr
           ON sr.id=a.scheduling_request_id WHERE sr.order_id=t.id) AS appointment_count,
         (SELECT count(*)::int FROM medialab_core.appointments a JOIN medialab_core.scheduling_requests sr
           ON sr.id=a.scheduling_request_id WHERE sr.order_id=t.id
           AND medialab_core.current_appointment_state(a.id)='CANCELLED') AS canceled_appointment_count,
         (SELECT count(*)::int FROM medialab_core.job_appointments ja JOIN medialab_core.jobs j ON j.id=ja.job_id
           WHERE j.order_id=t.id) AS job_appointment_count,
         (SELECT count(*)::int FROM medialab_core.job_service_external_references r
           LEFT JOIN medialab_core.service_workstreams sw ON sw.id=r.service_workstream_id
           LEFT JOIN medialab_core.jobs j ON j.id=COALESCE(r.job_id,sw.job_id)
           WHERE j.order_id=t.id) AS job_service_external_reference_count,
         (SELECT count(*)::int FROM medialab_core.delivery_financial_eligibility_evidence e
           WHERE e.order_id=t.id) AS financial_evidence_count,
         (SELECT count(*)::int FROM medialab_core.order_client_accounts a WHERE a.order_id=t.id) AS order_client_account_count,
         (SELECT count(*)::int FROM medialab_core.order_external_references r WHERE r.order_id=t.id) AS external_reference_count
       FROM target t`,
      [order.sourceRecordType, order.externalOrderId],
    );
    if (result.rowCount === 0) return null;
    if (result.rowCount !== 1) throw new Error("M24A_FRESH_TARGET_IDENTITY_AMBIGUOUS");
    const row = result.rows[0]!;
    return Object.freeze({
      orderId: row.order_id,
      propertyId: row.property_id,
      propertySnapshotId: row.property_snapshot_id,
      propertyHubIds: row.property_hub_ids,
      jobIds: row.job_ids,
      orderItemCount: row.order_item_count,
      orderPartyCount: row.order_party_count,
      workstreamCount: row.workstream_count,
      schedulingRequestCount: row.scheduling_request_count,
      appointmentCount: row.appointment_count,
      canceledAppointmentCount: row.canceled_appointment_count,
      jobAppointmentCount: row.job_appointment_count,
      jobServiceExternalReferenceCount: row.job_service_external_reference_count,
      financialEvidenceCount: row.financial_evidence_count,
      orderClientAccountCount: row.order_client_account_count,
      externalReferenceCount: row.external_reference_count,
      exactTotalCents: Number(row.exact_total_cents),
    });
  } finally {
    await client.end();
  }
}

function expectedTarget(order: NormalizedAryeoOrderV1): FreshAcceptedCohortFailureRetryReceiptV1["expectedTarget"] {
  return {
    serviceLineCount: order.serviceLines.length,
    schedulingRequestCount: order.appointments.length === 0 ? 1 : order.appointments.length,
    appointmentCount: order.appointments.filter((appointment) => appointment.status !== "UNSCHEDULED" &&
      Boolean(appointment.startsAt && appointment.endsAt)).length,
    canceledAppointmentCount: order.appointments.filter((appointment) => appointment.status === "CANCELED").length,
    assignmentReferenceCount: order.appointments.reduce((count, appointment) =>
      count + appointment.assignedTeamMemberIds.length, 0),
    exactTotalCents: order.totalAmountCents,
  };
}

function assertExactTargetState(
  state: TargetCanonicalState,
  observation: CurrentOrderAdmissionObservationV1,
  expected: FreshAcceptedCohortFailureRetryReceiptV1["expectedTarget"],
): void {
  if (state.orderId !== observation.orderId || state.propertyId.length === 0 || state.propertySnapshotId.length === 0 ||
      state.propertyHubIds.length !== 1 || state.propertyHubIds[0] !== observation.propertyHubId ||
      state.jobIds.length !== 1 || state.jobIds[0] !== observation.jobId ||
      state.orderItemCount !== expected.serviceLineCount || state.orderPartyCount !== 6 ||
      state.workstreamCount !== expected.serviceLineCount ||
      state.schedulingRequestCount !== expected.schedulingRequestCount ||
      state.appointmentCount !== expected.appointmentCount ||
      state.canceledAppointmentCount !== expected.canceledAppointmentCount ||
      state.jobAppointmentCount !== expected.appointmentCount ||
      state.jobServiceExternalReferenceCount !== expected.serviceLineCount + 2 + expected.assignmentReferenceCount ||
      state.financialEvidenceCount !== 1 || state.orderClientAccountCount !== observation.orderClientAccountLinkCount ||
      state.externalReferenceCount !== 1 || state.exactTotalCents !== expected.exactTotalCents ||
      observation.workstreamCount !== expected.serviceLineCount ||
      observation.schedulingRequestCount !== expected.schedulingRequestCount ||
      observation.appointmentCount !== expected.appointmentCount ||
      observation.canceledAppointmentCount !== expected.canceledAppointmentCount ||
      observation.assignmentReferenceCount !== expected.assignmentReferenceCount) {
    throw new Error("M24A_FRESH_TARGET_CANONICAL_STATE_DIVERGENCE");
  }
}

function sanitizedTargetState(state: TargetCanonicalState): FreshAcceptedCohortFailureRetryReceiptV1["observedTarget"] {
  const { orderId: _orderId, propertyId: _propertyId, propertySnapshotId: _propertySnapshotId,
    propertyHubIds: _propertyHubIds, jobIds: _jobIds, ...sanitized } = state;
  return sanitized;
}

function targetCanonicalStateSha256(state: TargetCanonicalState): string {
  return sha256(JSON.stringify(state));
}

async function writeFreshAdmissionProof(
  path: string,
  receipt: FreshAcceptedCohortFailureRetryReceiptV1,
): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
  return sha256(bytes.toString("utf8"));
}

async function loadFreshAdmissionProof(
  path: string,
  order: NormalizedAryeoOrderV1,
): Promise<{ receipt: FreshAcceptedCohortFailureRetryReceiptV1; fileSha256: string } | null> {
  if (!existsSync(path)) return null;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600) {
    throw new Error("M24A_FRESH_ADMISSION_PROOF_BOUNDARY_DIVERGENCE");
  }
  const bytes = await readFile(path);
  let receipt: FreshAcceptedCohortFailureRetryReceiptV1;
  try {
    receipt = JSON.parse(bytes.toString("utf8")) as FreshAcceptedCohortFailureRetryReceiptV1;
  } catch {
    throw new Error("M24A_FRESH_ADMISSION_PROOF_PARSE_FAILURE");
  }
  const targetHash = sha256(order.externalOrderId);
  if (receipt.schema !== "ML_CONTROLLED_MISSION_CONTROL_PILOT_FRESH_ADMISSION_PROOF_V1" ||
      receipt.contract !== "FreshAcceptedCohortFailureRetryReceiptV1" ||
      receipt.sourceManifestSha256 !== ACCEPTED_M23_SOURCE_MANIFEST_SHA256 ||
      receipt.targetSourceOrderReferenceSha256 !== targetHash ||
      receipt.injectedStage !== "after_first_appointment" ||
      receipt.injectedFailureCode !== "M24A_FRESH_ACCEPTED_COHORT_ADMISSION_FAILURE" ||
      receipt.targetAbsentBeforeAttempt !== true || receipt.targetAbsentAfterFailure !== true ||
      receipt.rollbackExactAcrossEveryCanonicalTable !== true || receipt.retryCreatedExactTargetState !== true ||
      receipt.containsCustomerPii !== false || receipt.containsProviderSecret !== false ||
      receipt.providerMutationCount !== 0 || receipt.completeStateVectorTableCount !== receipt.baseline.tableCount ||
      receipt.baseline.tableCount !== receipt.postFailure.tableCount ||
      receipt.baseline.tableCount !== receipt.postRetry.tableCount ||
      receipt.baseline.tableCount !== Object.keys(receipt.baseline.counts).length ||
      receipt.postFailure.tableCount !== Object.keys(receipt.postFailure.counts).length ||
      receipt.postRetry.tableCount !== Object.keys(receipt.postRetry.counts).length ||
      Object.keys(receipt.baseline.counts).join(":") !== Object.keys(receipt.baseline.contentSha256).join(":") ||
      Object.keys(receipt.postFailure.counts).join(":") !== Object.keys(receipt.postFailure.contentSha256).join(":") ||
      Object.keys(receipt.postRetry.counts).join(":") !== Object.keys(receipt.postRetry.contentSha256).join(":") ||
      Object.values(receipt.baseline.counts).some((count) => !Number.isInteger(count) || count < 0) ||
      Object.values(receipt.postFailure.counts).some((count) => !Number.isInteger(count) || count < 0) ||
      Object.values(receipt.postRetry.counts).some((count) => !Number.isInteger(count) || count < 0) ||
      Object.values(receipt.baseline.contentSha256).some((hash) => !/^[a-f0-9]{64}$/u.test(hash)) ||
      Object.values(receipt.postFailure.contentSha256).some((hash) => !/^[a-f0-9]{64}$/u.test(hash)) ||
      Object.values(receipt.postRetry.contentSha256).some((hash) => !/^[a-f0-9]{64}$/u.test(hash)) ||
      receipt.baseline.sha256 !== stateVectorSha256(receipt.baseline.counts, receipt.baseline.contentSha256) ||
      receipt.postFailure.sha256 !== stateVectorSha256(receipt.postFailure.counts, receipt.postFailure.contentSha256) ||
      receipt.postRetry.sha256 !== stateVectorSha256(receipt.postRetry.counts, receipt.postRetry.contentSha256) ||
      !exactStateVector(receipt.baseline, receipt.postFailure) ||
      JSON.stringify(receipt.retryDelta) !== JSON.stringify(stateVectorDelta(receipt.baseline, receipt.postRetry)) ||
      receipt.targetCanonicalStateSha256.length !== 64) {
    throw new Error("M24A_FRESH_ADMISSION_PROOF_DIVERGENCE");
  }
  return { receipt, fileSha256: sha256(bytes.toString("utf8")) };
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
  const freshTarget = cohort[0]!;
  const targetExpected = expectedTarget(freshTarget);
  if (targetExpected.appointmentCount === 0) throw new Error("M24A_FRESH_TARGET_STAGE_UNAVAILABLE");

  const database = new CurrentOperationsAdmissionDatabase("CONTROLLED_PILOT");
  try {
    const first: CurrentOrderAdmissionObservationV1[] = [];
    let proof = await loadFreshAdmissionProof(paths.freshAdmissionProofPath, freshTarget);
    if (proof === null) {
      const baselineCanonical = await canonicalCounts();
      if (baselineCanonical.orders !== 0 || baselineCanonical.propertyHubs !== 0 || baselineCanonical.jobs !== 0 ||
          baselineCanonical.workstreams !== 0 || baselineCanonical.schedulingRequests !== 0 ||
          baselineCanonical.appointments !== 0 || baselineCanonical.canceledAppointments !== 0 ||
          baselineCanonical.financialEvidence !== 0 || baselineCanonical.nonAryeoOrders !== 0 ||
          await targetCanonicalState(freshTarget) !== null) {
        throw new Error("M24A_FRESH_ADMISSION_PROOF_REQUIRES_EMPTY_OPERATIONAL_PILOT");
      }
      const baseline = await completeCanonicalStateVector();
      let injectedFailureRejected = false;
      try {
        await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, freshTarget, (stage) => {
          if (stage === "after_first_appointment") {
            throw new Error("M24A_FRESH_ACCEPTED_COHORT_ADMISSION_FAILURE");
          }
        });
      } catch (error) {
        if ((error as Error).message === "M24A_FRESH_ACCEPTED_COHORT_ADMISSION_FAILURE") {
          injectedFailureRejected = true;
        } else {
          throw error;
        }
      }
      const postFailure = await completeCanonicalStateVector();
      const targetAfterFailure = await targetCanonicalState(freshTarget);
      if (!injectedFailureRejected || targetAfterFailure !== null || !exactStateVector(baseline, postFailure)) {
        throw new Error("M24A_FRESH_ACCEPTED_COHORT_ROLLBACK_DIVERGENCE");
      }
      const retry = await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, freshTarget);
      const retryTarget = await targetCanonicalState(freshTarget);
      if (retryTarget === null) throw new Error("M24A_FRESH_ACCEPTED_COHORT_RETRY_MISSING");
      assertExactTargetState(retryTarget, retry, targetExpected);
      const postRetry = await completeCanonicalStateVector();
      const retryDelta = stateVectorDelta(baseline, postRetry);
      const requiredDelta: Record<string, number> = {
        properties: 1,
        property_snapshots: 1,
        custom_commercial_snapshots: targetExpected.serviceLineCount,
        orders: 1,
        order_items: targetExpected.serviceLineCount,
        order_parties: 6,
        order_external_references: 1,
        property_hubs: 1,
        property_hub_orders: 1,
        jobs: 1,
        service_workstreams: targetExpected.serviceLineCount,
        scheduling_requests: targetExpected.schedulingRequestCount,
        appointments: targetExpected.appointmentCount,
        job_appointments: targetExpected.appointmentCount,
        job_service_external_references: targetExpected.serviceLineCount + 2 + targetExpected.assignmentReferenceCount,
        delivery_financial_eligibility_evidence: 1,
      };
      if (Object.values(retryDelta).some((delta) => delta < 0) ||
          Object.entries(requiredDelta).some(([table, delta]) => retryDelta[table] !== delta)) {
        throw new Error("M24A_FRESH_ACCEPTED_COHORT_RETRY_DELTA_DIVERGENCE");
      }
      const receipt: FreshAcceptedCohortFailureRetryReceiptV1 = {
        schema: "ML_CONTROLLED_MISSION_CONTROL_PILOT_FRESH_ADMISSION_PROOF_V1",
        contract: "FreshAcceptedCohortFailureRetryReceiptV1",
        sourceManifestSha256: ACCEPTED_M23_SOURCE_MANIFEST_SHA256,
        targetSourceOrderReferenceSha256: sha256(freshTarget.externalOrderId),
        injectedStage: "after_first_appointment",
        injectedFailureCode: "M24A_FRESH_ACCEPTED_COHORT_ADMISSION_FAILURE",
        targetAbsentBeforeAttempt: true,
        targetAbsentAfterFailure: true,
        rollbackExactAcrossEveryCanonicalTable: true,
        retryCreatedExactTargetState: true,
        completeStateVectorTableCount: baseline.tableCount,
        baseline,
        postFailure,
        postRetry,
        retryDelta,
        expectedTarget: targetExpected,
        observedTarget: sanitizedTargetState(retryTarget),
        targetCanonicalStateSha256: targetCanonicalStateSha256(retryTarget),
        containsCustomerPii: false,
        containsProviderSecret: false,
        providerMutationCount: 0,
      };
      const fileSha256 = await writeFreshAdmissionProof(paths.freshAdmissionProofPath, receipt);
      proof = { receipt, fileSha256 };
      first.push(retry);
      for (const order of cohort.slice(1)) {
        first.push(await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, order));
      }
    } else {
      const existingTarget = await targetCanonicalState(freshTarget);
      if (existingTarget === null || targetCanonicalStateSha256(existingTarget) !== proof.receipt.targetCanonicalStateSha256) {
        throw new Error("M24A_FRESH_ADMISSION_PROOF_TARGET_READBACK_DIVERGENCE");
      }
      for (const order of cohort) {
        first.push(await database.admitOrder(databaseSessionToken, normalized.sourceManifestSha256, order));
      }
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

    const proofTargetReadback = await targetCanonicalState(freshTarget);
    if (proofTargetReadback === null ||
        targetCanonicalStateSha256(proofTargetReadback) !== proof.receipt.targetCanonicalStateSha256) {
      throw new Error("M24A_FRESH_ADMISSION_PROOF_FINAL_READBACK_DIVERGENCE");
    }

    const authority = await database.authorityProof();
    const restrictedRuntimeOnly = authority.runtimeCanonicalTableDmlGrants === 0 &&
      authority.runtimeCanonicalSequenceGrants === 0 && authority.publicCanonicalTableDmlGrants === 0 &&
      authority.publicCanonicalSequenceGrants === 0 && authority.publicFunctionExecutionGrants === 0 &&
      authority.runtimeRoleCanLogin && !authority.runtimeRoleInherit && !authority.runtimeRoleSuperuser &&
      !authority.runtimeRoleCreateDatabase && !authority.runtimeRoleCreateRole && !authority.runtimeRoleReplication &&
      !authority.runtimeRoleBypassRls && authority.runtimeRoleMembershipCount === 0 &&
      authority.businessExecutionRole === "medialab_p02m24a_r05_proof_final_app";
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
      canonical: concurrentCounts,
      exactAdmittedOrderTotalCents: 2_631_600,
      authority,
      freshAdmissionProof: {
        contract: proof.receipt.contract,
        receiptSha256: proof.fileSha256,
        targetSourceOrderReferenceSha256: proof.receipt.targetSourceOrderReferenceSha256,
        injectedStage: proof.receipt.injectedStage,
        completeStateVectorTableCount: proof.receipt.completeStateVectorTableCount,
        baselineStateVectorSha256: proof.receipt.baseline.sha256,
        postFailureStateVectorSha256: proof.receipt.postFailure.sha256,
        postRetryStateVectorSha256: proof.receipt.postRetry.sha256,
        targetCanonicalStateSha256: proof.receipt.targetCanonicalStateSha256,
      },
      checks: {
        firstPassStable: true,
        sequentialReplayStable: true,
        concurrentReplayStable: true,
        injectedFailureRolledBack: true,
        injectedFailureRetryStable: true,
        freshAcceptedCohortFailureTarget: true,
        freshAdmissionProofReceiptVerified: true,
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
