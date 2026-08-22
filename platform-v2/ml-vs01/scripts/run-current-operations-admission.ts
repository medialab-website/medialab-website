import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import pg from "pg";
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
} from "./run-internal-operations-console-new-listing.js";
import { loadAndNormalizeAryeoSnapshot } from "../src/current-admission/normalization.js";
import {
  CurrentOperationsAdmissionDatabase,
  currentHomePackageAdmissionCohort,
  type CurrentOrderAdmissionObservationV1,
  type CurrentOperationsAdmissionReceiptV1,
} from "../src/current-admission/platform-admission.js";
import { OPERATIONS_CONSOLE_DATABASE } from "../src/operations-console/database.js";

const OWNER = "medialab_p02m17a_test_owner";

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`M23A_ARGUMENT_REQUIRED: --${name}=...`);
  return value;
}

async function newOutputRoot(input: string): Promise<{ root: string; temporaryRoot: string }> {
  if (!isAbsolute(input)) throw new Error("M23A_OUTPUT_BOUNDARY_FAILURE: output root must be absolute");
  const root = resolve(input);
  const parent = dirname(root);
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error("M23A_OUTPUT_BOUNDARY_FAILURE: output parent must be a canonical non-symlink directory");
  }
  try {
    await lstat(root);
    throw new Error("M23A_OUTPUT_BOUNDARY_FAILURE: output root already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { root, temporaryRoot: join(parent, `.${root.split("/").at(-1)}.partial-${process.pid}-${randomUUID()}`) };
}

function ownerClient(): pg.Client {
  return new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER,
    application_name: "p02-m23-a-admission-evidence" });
}

async function seedAdmissionPermissions(): Promise<void> {
  const owner = ownerClient();
  await owner.connect();
  try {
    await owner.query("BEGIN");
    const financialPermission = PUBLICATION_DELIVERY_PERMISSION_FIXTURES.find(
      (candidate) => candidate.code === "delivery_financial_evidence.record",
    );
    const clientPermission = CLIENT_ACCOUNT_PERMISSION_FIXTURES.find(
      (candidate) => candidate.code === "client_account.manage",
    );
    if (!financialPermission || !clientPermission) throw new Error("M23A_PERMISSION_FIXTURE_DIVERGENCE");
    const permissions = [financialPermission, clientPermission];
    for (const permission of permissions) {
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
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  } finally {
    await owner.end();
  }
}

const COUNT_TABLES = [
  "people", "person_external_references", "properties", "property_snapshots", "custom_commercial_snapshots",
  "orders", "order_items", "property_hubs", "property_hub_orders", "jobs", "service_workstreams",
  "scheduling_requests", "appointments", "job_appointments", "job_service_external_references",
  "delivery_financial_eligibility_evidence", "client_accounts", "client_account_external_references",
  "client_account_revisions", "client_account_people", "order_client_accounts", "contact_methods",
  "client_contact_source_evidence", "client_intake_idempotency_records",
] as const;

async function canonicalCounts(): Promise<Record<(typeof COUNT_TABLES)[number], number>> {
  const owner = ownerClient();
  await owner.connect();
  try {
    const result = {} as Record<(typeof COUNT_TABLES)[number], number>;
    for (const table of COUNT_TABLES) {
      const count = await owner.query<{ count: number }>(`SELECT count(*)::int AS count FROM medialab_core."${table}"`);
      result[table] = count.rows[0]!.count;
    }
    return result;
  } finally {
    await owner.end();
  }
}

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

const sourceRoot = argument("source-root");
const boundary = await newOutputRoot(argument("output-root"));
let database: CurrentOperationsAdmissionDatabase | undefined;
try {
  const { normalized, receipt: dryRun } = await loadAndNormalizeAryeoSnapshot(sourceRoot);
  const cohort = currentHomePackageAdmissionCohort(normalized);
  if (cohort.length !== dryRun.admissionReadiness.currentHomePackageReady) {
    throw new Error("M23A_COHORT_DIVERGENCE: dry-run and admission membership differ");
  }
  await resetAndSeedOperationsConsoleDatabase(1);
  await seedAdmissionPermissions();
  const issued = await issueOperationsConsoleDatabaseSession();
  database = new CurrentOperationsAdmissionDatabase();
  const baseline = await canonicalCounts();
  const first: CurrentOrderAdmissionObservationV1[] = [];
  for (const order of cohort) first.push(await database.admitOrder(
    issued.databaseSessionToken, normalized.sourceManifestSha256, order,
  ));
  const admitted = await canonicalCounts();
  const replay: CurrentOrderAdmissionObservationV1[] = [];
  for (const order of cohort) replay.push(await database.admitOrder(
    issued.databaseSessionToken, normalized.sourceManifestSha256, order,
  ));
  const afterReplay = await canonicalCounts();
  const replayOrderIdsStable = replay.every((result, index) => result.orderId === first[index]?.orderId &&
    result.propertyHubId === first[index]?.propertyHubId && result.jobId === first[index]?.jobId);
  const replayCreatedNoDuplicates = JSON.stringify(admitted) === JSON.stringify(afterReplay);
  if (!replayOrderIdsStable || !replayCreatedNoDuplicates) {
    throw new Error("M23A_REPLAY_FAILURE: repeated admission changed canonical identity or counts");
  }
  const authority = await database.authorityProof();
  if (authority.runtimeCanonicalTableDmlGrants || authority.runtimeCanonicalSequenceGrants ||
      authority.publicCanonicalTableDmlGrants || authority.publicCanonicalSequenceGrants ||
      authority.publicFunctionExecutionGrants) {
    throw new Error("M23A_AUTHORITY_BOUNDARY_FAILURE: canonical write authority is excessive");
  }
  const admittedAppointments = first.reduce((sum, value) => sum + value.appointmentCount, 0);
  const admittedSchedulingRequests = first.reduce((sum, value) => sum + value.schedulingRequestCount, 0);
  const admittedWorkstreams = first.reduce((sum, value) => sum + value.workstreamCount, 0);
  const admittedAssignmentReferences = first.reduce((sum, value) => sum + value.assignmentReferenceCount, 0);
  const sourceOrdersWithCustomerPhoneEvidence = first.reduce((sum, value) => sum + value.customerPhoneEvidenceCount, 0);
  const admittedServiceItemReferences = first.reduce((sum, value) => sum + value.serviceItemReferenceCount, 0);
  const admittedCanceledAppointments = first.reduce((sum, value) => sum + value.canceledAppointmentCount, 0);
  const exactAdmittedOrderTotalCents = first.reduce((sum, value) => sum + value.exactTotalCents, 0);
  const publicReceipt: CurrentOperationsAdmissionReceiptV1 = {
    schema: "ML_CURRENT_OPERATIONS_ADMISSION_V1",
    contract: "CurrentOperationsAdmissionReceiptV1",
    sourceManifestSha256: normalized.sourceManifestSha256,
    sourceSemanticSha256: normalized.semanticSha256,
    admittedScope: "CURRENT_HOME_PACKAGE_READY_ONLY",
    sourceOrdersPreserved: normalized.orderCount,
    sourceListingsPreserved: normalized.listingCount,
    sourceAppointmentsPreserved: normalized.appointmentCount,
    admittedOrders: first.length,
    deferredOrders: normalized.orderCount - first.length,
    admittedPropertyHubs: admitted.property_hubs - baseline.property_hubs,
    admittedJobs: admitted.jobs - baseline.jobs,
    admittedWorkstreams,
    admittedSchedulingRequests,
    admittedAppointments,
    admittedCanceledAppointments,
    admittedAssignmentReferences,
    admittedClientGroups: new Set(first.map((value) => value.customerGroupAccountId)).size,
    admittedClientTeams: new Set(first.map((value) => value.customerTeamAccountId).filter(Boolean)).size,
    admittedClientAccountRevisions: admitted.client_account_revisions - baseline.client_account_revisions,
    admittedClientAccountPersonLinks: admitted.client_account_people - baseline.client_account_people,
    admittedOrderClientAccountLinks: admitted.order_client_accounts - baseline.order_client_accounts,
    admittedCustomerPhoneEvidence: admitted.client_contact_source_evidence - baseline.client_contact_source_evidence,
    sourceOrdersWithCustomerPhoneEvidence,
    admittedServiceItemReferences,
    admittedFinancialEvidence: admitted.delivery_financial_eligibility_evidence - baseline.delivery_financial_eligibility_evidence,
    exactAdmittedOrderTotalCents,
    replayOrderIdsStable,
    replayCreatedNoDuplicates,
    authority,
    containsCustomerPii: false,
    containsProviderSecret: false,
    providerMutationCount: 0,
  };
  const privateIndex = {
    schema: "ML_CURRENT_OPERATIONS_ADMISSION_V1",
    contract: "CurrentOperationsPrivateCanonicalIndexV1",
    handling: "LOCAL_PRIVATE_SOURCE_EVIDENCE_DO_NOT_PACKAGE",
    sourceManifestSha256: normalized.sourceManifestSha256,
    records: cohort.map((order, index) => ({
      externalOrderId: order.externalOrderId,
      externalListingId: order.externalListingId,
      canonicalOrderId: first[index]!.orderId,
      canonicalPropertyHubId: first[index]!.propertyHubId,
      canonicalJobId: first[index]!.jobId,
      canonicalCustomerPersonId: first[index]!.customerPersonId,
      canonicalCustomerGroupAccountId: first[index]!.customerGroupAccountId,
      canonicalCustomerTeamAccountId: first[index]!.customerTeamAccountId,
    })),
  };
  const exceptionRegister = {
    schema: "ML_CURRENT_OPERATIONS_ADMISSION_V1",
    contract: "CurrentOperationsExceptionRegisterV1",
    records: normalized.orders.filter((order) => !cohort.some((candidate) => candidate.externalOrderId === order.externalOrderId))
      .map((order) => ({ sourceOrderReferenceSha256: sha256(order.externalOrderId), structure: order.structure,
        exceptionCodes: order.exceptionCodes.length ? order.exceptionCodes : ["LEGACY_SERVICES_DEFERRED_FROM_CURRENT_COHORT"] }))
      .sort((left, right) => left.sourceOrderReferenceSha256.localeCompare(right.sourceOrderReferenceSha256)),
    containsCustomerPii: false,
  };
  await mkdir(boundary.temporaryRoot, { mode: 0o700 });
  await writeFile(join(boundary.temporaryRoot, "ADMISSION_RECEIPT.json"), json(publicReceipt), { mode: 0o600, flag: "wx" });
  await writeFile(join(boundary.temporaryRoot, "EXCEPTION_REGISTER.json"), json(exceptionRegister), { mode: 0o600, flag: "wx" });
  await writeFile(join(boundary.temporaryRoot, "PRIVATE_CANONICAL_INDEX.json"), json(privateIndex), { mode: 0o600, flag: "wx" });
  const summary = [
    "# P02-M23-A Current Operations Admission",
    "",
    `- Source Listings preserved: ${publicReceipt.sourceListingsPreserved}`,
    `- Source Orders preserved: ${publicReceipt.sourceOrdersPreserved}`,
    `- Source Appointments preserved: ${publicReceipt.sourceAppointmentsPreserved}`,
    `- Ready Home Package Orders admitted: ${publicReceipt.admittedOrders}`,
    `- Exact admitted value: $${(publicReceipt.exactAdmittedOrderTotalCents / 100).toFixed(2)}`,
    `- Property Hubs / Jobs admitted: ${publicReceipt.admittedPropertyHubs} / ${publicReceipt.admittedJobs}`,
    `- Appointments admitted: ${publicReceipt.admittedAppointments}`,
    `- Client groups / teams consolidated: ${publicReceipt.admittedClientGroups} / ${publicReceipt.admittedClientTeams}`,
    `- Unique customer phone records / source Orders carrying phone evidence: ${publicReceipt.admittedCustomerPhoneEvidence} / ${publicReceipt.sourceOrdersWithCustomerPhoneEvidence}`,
    `- Replay stable / no duplicates: ${publicReceipt.replayOrderIdsStable} / ${publicReceipt.replayCreatedNoDuplicates}`,
    `- Provider mutations: ${publicReceipt.providerMutationCount}`,
    "",
    "Legacy-service and exception records remain preserved in the source freeze and explicit exception register. They were not rewritten into current Home Package meaning.",
    "",
  ].join("\n");
  await writeFile(join(boundary.temporaryRoot, "OWNER_SUMMARY.md"), summary, { mode: 0o600, flag: "wx" });
  await rename(boundary.temporaryRoot, boundary.root);
  process.stdout.write(`${JSON.stringify({
    status: "ML_PLATFORM_P02_M23_A_CURRENT_COHORT_ADMISSION_PASS",
    outputRoot: boundary.root,
    receipt: publicReceipt,
  }, null, 2)}\n`);
} catch (error) {
  await rm(boundary.temporaryRoot, { recursive: true, force: true });
  throw error;
} finally {
  await database?.close().catch(() => undefined);
}
