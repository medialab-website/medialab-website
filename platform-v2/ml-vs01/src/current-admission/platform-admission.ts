import { createHash } from "node:crypto";
import pg from "pg";
import {
  deterministicSnapshotUuid,
  OPERATIONS_CONSOLE_DATABASE,
  OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
  OPERATIONS_CONSOLE_ORGANIZATION_ID,
} from "../operations-console/database.js";
import type {
  AryeoAdmissionExceptionCode,
  CurrentOperationsNormalizationV1,
  NormalizedAryeoAppointmentV1,
  NormalizedAryeoOrderV1,
} from "./contracts.js";

const { Pool } = pg;
const SOURCE_SYSTEM = "ARYEO";
const SOURCE_EVIDENCE_PREFIX = "LOCAL_READ_ONLY_SOURCE_EVIDENCE:";
const BLOCKING_EXCEPTIONS = new Set<AryeoAdmissionExceptionCode>([
  "CANCELED_ORDER",
  "MISSING_CUSTOMER",
  "MISSING_LISTING",
  "INCOMPLETE_ADDRESS",
  "NO_ACTIVE_SERVICE_LINES",
  "ORDER_TOTAL_MISMATCH",
  "PARTIALLY_REFUNDED_REQUIRES_RECONCILIATION",
  "INVALID_APPOINTMENT_TIME_EVIDENCE",
]);

export type AdmissionFaultStage =
  | "after_customer"
  | "after_property"
  | "after_first_snapshot"
  | "after_order"
  | "after_hub"
  | "after_job"
  | "after_first_appointment"
  | "before_commit";

export interface CurrentOrderAdmissionObservationV1 {
  orderId: string;
  propertyHubId: string;
  jobId: string;
  customerPersonId: string;
  customerMembershipId: string;
  customerGroupAccountId: string;
  customerTeamAccountId: string | null;
  clientAccountPersonLinkCount: number;
  orderClientAccountLinkCount: number;
  customerPhoneEvidenceCount: number;
  workstreamCount: number;
  serviceItemReferenceCount: number;
  schedulingRequestCount: number;
  appointmentCount: number;
  canceledAppointmentCount: number;
  assignmentReferenceCount: number;
  financialEvidenceId: string;
  exactTotalCents: number;
  structure: NormalizedAryeoOrderV1["structure"];
  replayed: boolean;
}

export interface CurrentOperationsAdmissionReceiptV1 {
  schema: "ML_CURRENT_OPERATIONS_ADMISSION_V1";
  contract: "CurrentOperationsAdmissionReceiptV1";
  sourceManifestSha256: string;
  sourceSemanticSha256: string;
  admittedScope: "CURRENT_HOME_PACKAGE_READY_ONLY";
  sourceOrdersPreserved: number;
  sourceListingsPreserved: number;
  sourceAppointmentsPreserved: number;
  admittedOrders: number;
  deferredOrders: number;
  admittedPropertyHubs: number;
  admittedJobs: number;
  admittedWorkstreams: number;
  admittedSchedulingRequests: number;
  admittedAppointments: number;
  admittedCanceledAppointments: number;
  admittedAssignmentReferences: number;
  admittedClientGroups: number;
  admittedClientTeams: number;
  admittedClientAccountRevisions: number;
  admittedClientAccountPersonLinks: number;
  admittedOrderClientAccountLinks: number;
  admittedCustomerPhoneEvidence: number;
  sourceOrdersWithCustomerPhoneEvidence: number;
  admittedServiceItemReferences: number;
  admittedFinancialEvidence: number;
  exactAdmittedOrderTotalCents: number;
  replayOrderIdsStable: boolean;
  replayCreatedNoDuplicates: boolean;
  authority: {
    businessExecutionRole: string;
    businessWriteBoundary: "SUPPORTED_SECURITY_DEFINER_COMMANDS_ONLY";
    runtimeCanonicalTableDmlGrants: number;
    publicCanonicalTableDmlGrants: number;
    publicFunctionExecutionGrants: number;
  };
  containsCustomerPii: false;
  containsProviderSecret: false;
  providerMutationCount: 0;
}

type CanonicalOrderRecord = {
  order: {
    id: string;
    organization_id: string;
    property_id: string;
    property_snapshot_id: string;
    currency: string;
    total_amount_cents: number | string;
    item_subtotal_cents: number | string;
    travel_amount_cents: number | string;
    source_system: string;
  };
  parties: Array<{ party_role: string; person_id: string | null }>;
  items: Array<{
    id: string;
    position: number;
    custom_commercial_snapshot_id: string | null;
    frozen_description: string;
    quantity: number | string;
    unit_amount_cents: number | string;
    line_total_cents: number | string;
    currency: string;
  }>;
  external_references: Array<{
    provider: string;
    external_record_type: string;
    external_identifier: string;
  }>;
};

type CustomerReconciliation = {
  outcome: "CREATED" | "REUSED" | "AMBIGUOUS";
  person_id: string | null;
  membership_id: string | null;
};

type PropertyReconciliation = {
  property_id: string;
  property_snapshot_id: string;
};

type ClientAccountReconciliation = {
  clientAccountId: string;
  revisionId: string;
  accountOutcome: "CREATED" | "REUSED";
  revisionOutcome: "CREATED" | "REUSED";
  replayed: boolean;
};

type CustomerContactReconciliation = {
  contactMethodId: string;
  sourceEvidenceId: string;
  contactOutcome: "CREATED" | "REUSED";
  replayed: boolean;
};

type ClientRelationship = { relationshipId: string; replayed: boolean };

type ClientAccountRecord = {
  clientAccount: { id: string; organizationId: string; accountType: "CUSTOMER_GROUP" | "CUSTOMER_TEAM" };
  currentRevision: {
    parentClientAccountId: string | null;
    displayName: string;
    brokerageName: string | null;
  };
  revisions: Array<{
    parentClientAccountId: string | null;
    displayName: string;
    brokerageName: string | null;
    sourceEvidenceFingerprint: string;
  }>;
  externalReferences: Array<{ sourceSystem: string; externalRecordType: string; externalIdentifier: string }>;
  people: Array<{ personId: string; displayName: string; relationshipRole: string }>;
  orders: Array<{ orderId: string; relationshipRole: string }>;
};

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function key(prefix: string, value: unknown): string {
  return `m23a-${prefix}-${sha256(value)}`;
}

function evidence(manifestSha256: string): string {
  return `${SOURCE_EVIDENCE_PREFIX}${manifestSha256}`;
}

function assertReady(order: NormalizedAryeoOrderV1): asserts order is NormalizedAryeoOrderV1 & {
  customer: NonNullable<NormalizedAryeoOrderV1["customer"]>;
  clientAccount: NonNullable<NormalizedAryeoOrderV1["clientAccount"]>;
  property: NonNullable<NormalizedAryeoOrderV1["property"]>;
  externalListingId: string;
} {
  if (order.structure !== "CURRENT_HOME_PACKAGE" || order.exceptionCodes.some((code) => BLOCKING_EXCEPTIONS.has(code)) ||
      !order.customer || !order.clientAccount || !order.property || !order.externalListingId || order.serviceLines.length === 0) {
    throw new Error("M23A_ADMISSION_SCOPE_FAILURE: Order is outside the exact ready Home Package cohort");
  }
}

function localTimestamp(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const result = `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
  if (result.includes("undefined")) throw new Error("M23A_APPOINTMENT_TIME_FAILURE: local time could not be reconstructed");
  return result;
}

function exactReadback(
  record: CanonicalOrderRecord | null,
  orderId: string,
  order: NormalizedAryeoOrderV1,
  property: PropertyReconciliation,
  snapshotIds: readonly string[],
): CanonicalOrderRecord {
  if (!record || record.order.id !== orderId || record.order.organization_id !== OPERATIONS_CONSOLE_ORGANIZATION_ID ||
      record.order.property_id !== property.property_id || record.order.property_snapshot_id !== property.property_snapshot_id ||
      record.order.currency !== order.serviceLines[0]?.currency || record.order.source_system !== SOURCE_SYSTEM ||
      Number(record.order.total_amount_cents) !== order.totalAmountCents ||
      Number(record.order.item_subtotal_cents) !== order.totalAmountCents || Number(record.order.travel_amount_cents) !== 0 ||
      record.items.length !== order.serviceLines.length) {
    throw new Error("M23A_CANONICAL_READBACK_FAILURE: Order identity or totals diverged");
  }
  const expectedRoles = ["AUTHORIZED_ACTOR", "BILLING_PARTY", "COMMERCIAL_OWNER", "CUSTOMER", "ORDERING_PERSON", "ORGANIZATION"];
  const roles = record.parties.map((party) => party.party_role).sort();
  if (roles.length !== expectedRoles.length || roles.some((role, index) => role !== expectedRoles[index])) {
    throw new Error("M23A_CANONICAL_READBACK_FAILURE: Order parties diverged");
  }
  const items = [...record.items].sort((left, right) => left.position - right.position);
  for (let index = 0; index < order.serviceLines.length; index += 1) {
    const item = items[index]!;
    const line = order.serviceLines[index]!;
    if (item.position !== index + 1 || item.custom_commercial_snapshot_id !== snapshotIds[index] ||
        item.frozen_description !== line.title || Number(item.quantity) !== line.quantity ||
        Number(item.unit_amount_cents) !== line.effectiveUnitAmountCents ||
        Number(item.line_total_cents) !== line.lineTotalCents || item.currency !== line.currency) {
      throw new Error("M23A_CANONICAL_READBACK_FAILURE: immutable service-line evidence diverged");
    }
  }
  if (!record.external_references.some((reference) => reference.provider === SOURCE_SYSTEM &&
      reference.external_record_type === order.sourceRecordType && reference.external_identifier === order.externalOrderId)) {
    throw new Error("M23A_CANONICAL_READBACK_FAILURE: exact Aryeo Order identity is missing");
  }
  return record;
}

function exactClientAccountReadback(
  record: ClientAccountRecord | null,
  expected: {
    accountId: string;
    accountType: "CUSTOMER_GROUP" | "CUSTOMER_TEAM";
    displayName: string;
    brokerageName: string | null;
    parentClientAccountId: string | null;
    externalRecordType: "CUSTOMER_GROUP" | "CUSTOMER_TEAM";
    externalIdentifier: string;
    customerPersonId: string;
    orderId: string;
  },
): void {
  if (!record || record.clientAccount.id !== expected.accountId ||
      record.clientAccount.organizationId !== OPERATIONS_CONSOLE_ORGANIZATION_ID ||
      record.clientAccount.accountType !== expected.accountType ||
      !record.revisions.some((revision) => revision.displayName === expected.displayName &&
        revision.brokerageName === expected.brokerageName &&
        revision.parentClientAccountId === expected.parentClientAccountId) ||
      !record.externalReferences.some((reference) => reference.sourceSystem === SOURCE_SYSTEM &&
        reference.externalRecordType === expected.externalRecordType &&
        reference.externalIdentifier === expected.externalIdentifier) ||
      !record.people.some((person) => person.personId === expected.customerPersonId &&
        person.relationshipRole === "ACCOUNT_MEMBER") ||
      !record.orders.some((order) => order.orderId === expected.orderId &&
        order.relationshipRole === expected.accountType)) {
    throw new Error("M23A_CLIENT_ACCOUNT_READBACK_FAILURE: client identity or relationship evidence diverged");
  }
}

async function admitAppointment(
  client: pg.PoolClient,
  token: string,
  order: NormalizedAryeoOrderV1,
  appointment: NormalizedAryeoAppointmentV1,
  propertyHubId: string,
  orderId: string,
  jobId: string,
): Promise<{ requestId: string; appointmentId: string | null; canceled: boolean; assignmentReferences: number }> {
  const requestResult = await client.query<{ create_scheduling_request: string }>(
    "SELECT medialab_core.create_scheduling_request($1,$2,$3::uuid,$4::uuid,$5::uuid,$6)",
    [token, key("schedule-request", appointment.externalAppointmentId), OPERATIONS_CONSOLE_ORGANIZATION_ID,
      propertyHubId, orderId, SOURCE_SYSTEM],
  );
  const requestId = requestResult.rows[0]!.create_scheduling_request;
  if (appointment.status === "UNSCHEDULED" || !appointment.startsAt || !appointment.endsAt) {
    return { requestId, appointmentId: null, canceled: false, assignmentReferences: 0 };
  }
  const requestReadback = await client.query<{ get_scheduling_request_record: {
    current_state: string;
    appointments: Array<{ id: string; starts_at: string; ends_at: string }>;
  } }>("SELECT medialab_core.get_scheduling_request_record($1,$2::uuid)", [token, requestId]);
  const existingAppointment = requestReadback.rows[0]!.get_scheduling_request_record.appointments[0];
  if (existingAppointment) {
    if (new Date(existingAppointment.starts_at).toISOString() !== new Date(appointment.startsAt).toISOString() ||
        new Date(existingAppointment.ends_at).toISOString() !== new Date(appointment.endsAt).toISOString()) {
      throw new Error("M23A_APPOINTMENT_READBACK_FAILURE: replayed appointment time diverged");
    }
    await client.query("SELECT medialab_core.link_job_appointment($1,$2,$3::uuid,$4::uuid,$5)", [
      token, key("job-appointment", appointment.externalAppointmentId), jobId, existingAppointment.id,
      "Linked from exact read-only Aryeo appointment evidence.",
    ]);
    if (appointment.status === "CANCELED") {
      await client.query("SELECT medialab_core.cancel_appointment($1,$2,$3::uuid,$4)", [
        token, key("cancel-appointment", appointment.externalAppointmentId), existingAppointment.id,
        "Aryeo source appointment is canceled.",
      ]);
    }
    let assignmentReferences = 0;
    for (const externalTeamMemberId of appointment.assignedTeamMemberIds) {
      await client.query(
        "SELECT medialab_core.record_job_service_external_reference($1,$2,$3::uuid,NULL,$4,$5,$6,$7)",
        [token, key("appointment-assignment", { appointment: appointment.externalAppointmentId, externalTeamMemberId }),
          jobId, SOURCE_SYSTEM, "APPOINTMENT_TEAM_ASSIGNMENT",
          `${appointment.externalAppointmentId}:${externalTeamMemberId}`,
          "Exact Aryeo team identity retained; canonical assignment deferred until authenticated Person identity exists."],
      );
      assignmentReferences += 1;
    }
    return { requestId, appointmentId: existingAppointment.id,
      canceled: appointment.status === "CANCELED", assignmentReferences };
  }
  if (requestReadback.rows[0]!.get_scheduling_request_record.current_state !== "REQUESTED") {
    throw new Error("M23A_APPOINTMENT_READBACK_FAILURE: replayed request has no usable Appointment");
  }
  const timeZone = appointment.timezone ?? order.property?.timezone;
  if (!timeZone) throw new Error("M23A_APPOINTMENT_TIME_FAILURE: source timezone is missing");
  const windowResult = await client.query<{ add_scheduling_requested_window: string }>(
    `SELECT medialab_core.add_scheduling_requested_window(
      $1,$2,$3::uuid,$4::timestamptz,$5::timestamptz,$6,$7::timestamp,$8::timestamp)`,
    [token, key("schedule-window", appointment.externalAppointmentId), requestId, appointment.startsAt,
      appointment.endsAt, timeZone, localTimestamp(appointment.startsAt, timeZone), localTimestamp(appointment.endsAt, timeZone)],
  );
  const appointmentResult = await client.query<{ confirm_appointment: string }>(
    "SELECT medialab_core.confirm_appointment($1,$2,$3::uuid,$4::uuid,$5)",
    [token, key("confirm-appointment", appointment.externalAppointmentId), requestId,
      windowResult.rows[0]!.add_scheduling_requested_window, "Imported from exact read-only Aryeo appointment evidence."],
  );
  const appointmentId = appointmentResult.rows[0]!.confirm_appointment;
  await client.query("SELECT medialab_core.link_job_appointment($1,$2,$3::uuid,$4::uuid,$5)", [
    token, key("job-appointment", appointment.externalAppointmentId), jobId, appointmentId,
    "Linked from exact read-only Aryeo appointment evidence.",
  ]);
  if (appointment.status === "CANCELED") {
    await client.query("SELECT medialab_core.cancel_appointment($1,$2,$3::uuid,$4)", [
      token, key("cancel-appointment", appointment.externalAppointmentId), appointmentId,
      "Aryeo source appointment is canceled.",
    ]);
  }
  let assignmentReferences = 0;
  for (const externalTeamMemberId of appointment.assignedTeamMemberIds) {
    await client.query(
      "SELECT medialab_core.record_job_service_external_reference($1,$2,$3::uuid,NULL,$4,$5,$6,$7)",
      [token, key("appointment-assignment", { appointment: appointment.externalAppointmentId, externalTeamMemberId }),
        jobId, SOURCE_SYSTEM, "APPOINTMENT_TEAM_ASSIGNMENT",
        `${appointment.externalAppointmentId}:${externalTeamMemberId}`,
        "Exact Aryeo team identity retained; canonical assignment deferred until authenticated Person identity exists."],
    );
    assignmentReferences += 1;
  }
  return { requestId, appointmentId, canceled: appointment.status === "CANCELED", assignmentReferences };
}

export function currentHomePackageAdmissionCohort(normalized: CurrentOperationsNormalizationV1): NormalizedAryeoOrderV1[] {
  return normalized.orders.filter((order) => order.structure === "CURRENT_HOME_PACKAGE" &&
    !order.exceptionCodes.some((code) => BLOCKING_EXCEPTIONS.has(code))).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.externalOrderId.localeCompare(right.externalOrderId));
}

export class CurrentOperationsAdmissionDatabase {
  readonly pool: pg.Pool;

  constructor(pool?: pg.Pool) {
    if (OPERATIONS_CONSOLE_DATABASE.host !== "/tmp/mlvs01-p02m17a-pg" || OPERATIONS_CONSOLE_DATABASE.port !== 55448 ||
        OPERATIONS_CONSOLE_DATABASE.database !== "medialab_p02m17a_test" ||
        OPERATIONS_CONSOLE_DATABASE.user !== "medialab_p02m17a_test_app") {
      throw new Error("M23A_AUTHORITY_BOUNDARY_FAILURE: isolated Operations database changed");
    }
    this.pool = pool ?? new Pool({ ...OPERATIONS_CONSOLE_DATABASE, max: 4, statement_timeout: 30_000,
      application_name: "p02-m23-a-current-operations-admission" });
  }

  async admitOrder(
    token: string,
    sourceManifestSha256: string,
    order: NormalizedAryeoOrderV1,
    fault?: (stage: AdmissionFaultStage) => void | Promise<void>,
  ): Promise<CurrentOrderAdmissionObservationV1> {
    assertReady(order);
    const client = await this.pool.connect();
    let open = false;
    try {
      await client.query("BEGIN"); open = true;
      await client.query("SET LOCAL statement_timeout = '30000ms'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`M23A:${order.externalListingId}`]);
      const customerFingerprint = sha256({
        customer: order.customer,
        clientAccount: order.clientAccount,
        sourceManifestSha256,
      });
      const customerResult = await client.query<{ reconcile_customer_person_intake: CustomerReconciliation }>(
        `SELECT medialab_core.reconcile_customer_person_intake(
          $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10)`,
        [token, key("customer", order.customer.externalCustomerUserId), OPERATIONS_CONSOLE_ORGANIZATION_ID,
          SOURCE_SYSTEM, `CUSTOMER_TEAM:${order.clientAccount.externalCustomerTeamId ?? order.clientAccount.externalCustomerGroupId}`,
          "ARYEO_CUSTOMER_USER", order.customer.externalCustomerUserId, customerFingerprint,
          order.customer.displayName, order.customer.email],
      );
      const customer = customerResult.rows[0]!.reconcile_customer_person_intake;
      if (!customer.person_id || !customer.membership_id || customer.outcome === "AMBIGUOUS") {
        throw new Error("M23A_CUSTOMER_RECONCILIATION_FAILURE: exact customer identity is ambiguous");
      }

      let customerPhoneEvidenceCount = 0;
      if (order.customer.phone) {
        const contactFingerprint = sha256({ sourceManifestSha256, externalCustomerUserId: order.customer.externalCustomerUserId,
          contactType: "PHONE", submittedValue: order.customer.phone });
        const contactResult = await client.query<{ reconcile_customer_contact_intake: CustomerContactReconciliation }>(
          `SELECT medialab_core.reconcile_customer_contact_intake(
            $1,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)`,
          [token, key("customer-phone", { customer: order.customer.externalCustomerUserId, contactFingerprint }),
            OPERATIONS_CONSOLE_ORGANIZATION_ID, customer.person_id, SOURCE_SYSTEM, "CUSTOMER_USER",
            order.customer.externalCustomerUserId, contactFingerprint, "PHONE", order.customer.phone],
        );
        if (!contactResult.rows[0]?.reconcile_customer_contact_intake.sourceEvidenceId) {
          throw new Error("M23A_CUSTOMER_CONTACT_RECONCILIATION_FAILURE: phone source evidence was not recorded");
        }
        customerPhoneEvidenceCount = 1;
      }

      const groupFingerprint = sha256({ sourceManifestSha256, accountType: "CUSTOMER_GROUP",
        externalIdentifier: order.clientAccount.externalCustomerGroupId,
        displayName: order.clientAccount.customerGroupName });
      const groupResult = await client.query<{ reconcile_client_account_intake: ClientAccountReconciliation }>(
        `SELECT medialab_core.reconcile_client_account_intake(
          $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
        [token, key("client-group", { externalIdentifier: order.clientAccount.externalCustomerGroupId,
          sourceEvidenceFingerprint: groupFingerprint }), OPERATIONS_CONSOLE_ORGANIZATION_ID,
          SOURCE_SYSTEM, "CUSTOMER_GROUP", order.clientAccount.externalCustomerGroupId, groupFingerprint,
          "CUSTOMER_GROUP", order.clientAccount.customerGroupName, null, null],
      );
      const customerGroupAccountId = groupResult.rows[0]!.reconcile_client_account_intake.clientAccountId;

      let customerTeamAccountId: string | null = null;
      if (order.clientAccount.externalCustomerTeamId && order.clientAccount.customerTeamName) {
        const teamFingerprint = sha256({ sourceManifestSha256, accountType: "CUSTOMER_TEAM",
          externalIdentifier: order.clientAccount.externalCustomerTeamId,
          displayName: order.clientAccount.customerTeamName, brokerageName: order.clientAccount.brokerageName,
          parentClientAccountId: customerGroupAccountId });
        const teamResult = await client.query<{ reconcile_client_account_intake: ClientAccountReconciliation }>(
          `SELECT medialab_core.reconcile_client_account_intake(
            $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
          [token, key("client-team", { externalIdentifier: order.clientAccount.externalCustomerTeamId,
            sourceEvidenceFingerprint: teamFingerprint }), OPERATIONS_CONSOLE_ORGANIZATION_ID,
            SOURCE_SYSTEM, "CUSTOMER_TEAM", order.clientAccount.externalCustomerTeamId, teamFingerprint,
            "CUSTOMER_TEAM", order.clientAccount.customerTeamName, order.clientAccount.brokerageName,
            customerGroupAccountId],
        );
        customerTeamAccountId = teamResult.rows[0]!.reconcile_client_account_intake.clientAccountId;
      }

      let clientAccountPersonLinkCount = 0;
      const accountLinks = [customerGroupAccountId, customerTeamAccountId].filter((value): value is string => Boolean(value));
      for (const clientAccountId of accountLinks) {
        const relationshipFingerprint = sha256({ sourceManifestSha256, clientAccountId,
          customerPersonId: customer.person_id, relationshipRole: "ACCOUNT_MEMBER" });
        const linkResult = await client.query<{ link_client_account_person: ClientRelationship }>(
          "SELECT medialab_core.link_client_account_person($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7)",
          [token, key("client-person", { clientAccountId, personId: customer.person_id }),
            OPERATIONS_CONSOLE_ORGANIZATION_ID, clientAccountId, customer.person_id, "ACCOUNT_MEMBER",
            relationshipFingerprint],
        );
        if (!linkResult.rows[0]?.link_client_account_person.relationshipId) {
          throw new Error("M23A_CLIENT_PERSON_LINK_FAILURE: client membership evidence was not recorded");
        }
        clientAccountPersonLinkCount += 1;
      }
      await fault?.("after_customer");

      const propertyFingerprint = sha256({ property: order.property, listing: order.externalListingId, sourceManifestSha256 });
      const propertyResult = await client.query<{ reconcile_property_snapshot_intake: PropertyReconciliation }>(
        `SELECT medialab_core.reconcile_property_snapshot_intake(
          $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [token, key("property", order.externalListingId), OPERATIONS_CONSOLE_ORGANIZATION_ID, SOURCE_SYSTEM,
          propertyFingerprint, order.property.addressLine1, order.property.addressLine2, order.property.locality,
          order.property.administrativeArea, order.property.postalCode, order.property.countryCode,
          order.property.reportedSquareFeet],
      );
      const property = propertyResult.rows[0]!.reconcile_property_snapshot_intake;
      await fault?.("after_property");

      const snapshotIds = order.serviceLines.map((line) => deterministicSnapshotUuid(
        `M23A:${sourceManifestSha256}:${order.externalOrderId}:${line.externalItemId}`,
      ));
      for (let index = 0; index < order.serviceLines.length; index += 1) {
        const line = order.serviceLines[index]!;
        await client.query(`SAVEPOINT m23a_snapshot_${index}`);
        try {
          await client.query(
            `SELECT medialab_core.create_custom_commercial_snapshot(
              $1,$2::uuid,$3,$4::bigint,$5,$6::numeric,$7,$8::bigint,$9,0,NULL,$10,$11::timestamptz,0,NULL)`,
            [token, snapshotIds[index], line.title, line.originalUnitAmountCents, line.currency, line.quantity,
              line.description ?? "Exact Aryeo source service line.", line.adjustmentAmountCents,
              line.adjustmentAmountCents === 0 ? null : "Exact Aryeo line adjustment preserved.", SOURCE_SYSTEM, order.createdAt],
          );
          await client.query(`RELEASE SAVEPOINT m23a_snapshot_${index}`);
        } catch (error) {
          const postgresError = error as { code?: string; constraint?: string };
          if (postgresError.code !== "23505" || postgresError.constraint !== "custom_commercial_snapshots_pkey") throw error;
          await client.query(`ROLLBACK TO SAVEPOINT m23a_snapshot_${index}`);
          await client.query(`RELEASE SAVEPOINT m23a_snapshot_${index}`);
        }
        if (index === 0) await fault?.("after_first_snapshot");
      }

      const parties = [
        { role: "ORDERING_PERSON", person_id: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID },
        { role: "CUSTOMER", person_id: customer.person_id },
        { role: "BILLING_PARTY", person_id: customer.person_id },
        { role: "COMMERCIAL_OWNER", person_id: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID },
        { role: "ORGANIZATION", organization_id: OPERATIONS_CONSOLE_ORGANIZATION_ID },
        { role: "AUTHORIZED_ACTOR", person_id: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID },
      ];
      const items = snapshotIds.map((snapshotId, index) => ({ position: index + 1, custom_commercial_snapshot_id: snapshotId }));
      const orderResult = await client.query<{ create_order: string }>(
        `SELECT medialab_core.create_order(
          $1,$2,'REAL_ESTATE',$3::uuid,$4::uuid,$5::uuid,'PAY_NOW',$6,$7,$8,$9,$10::jsonb,$11::jsonb,0,NULL,NULL,NULL,NULL)`,
        [token, key("order", order.externalOrderId), OPERATIONS_CONSOLE_ORGANIZATION_ID, property.property_id,
          property.property_snapshot_id, order.serviceLines[0]!.currency, SOURCE_SYSTEM, order.sourceRecordType,
          order.externalOrderId, JSON.stringify(parties), JSON.stringify(items)],
      );
      const orderId = orderResult.rows[0]!.create_order;
      const readbackResult = await client.query<{ get_order_record: CanonicalOrderRecord | null }>(
        "SELECT medialab_core.get_order_record($1,$2::uuid)", [token, orderId],
      );
      const readback = exactReadback(readbackResult.rows[0]?.get_order_record ?? null, orderId, order, property, snapshotIds);

      let orderClientAccountLinkCount = 0;
      const orderAccountLinks: Array<{ id: string; role: "CUSTOMER_GROUP" | "CUSTOMER_TEAM" }> = [
        { id: customerGroupAccountId, role: "CUSTOMER_GROUP" },
        ...(customerTeamAccountId ? [{ id: customerTeamAccountId, role: "CUSTOMER_TEAM" as const }] : []),
      ];
      for (const account of orderAccountLinks) {
        const relationshipFingerprint = sha256({ sourceManifestSha256, orderId, clientAccountId: account.id,
          relationshipRole: account.role });
        const linkResult = await client.query<{ link_order_client_account: ClientRelationship }>(
          "SELECT medialab_core.link_order_client_account($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7)",
          [token, key("order-client", { externalOrderId: order.externalOrderId, role: account.role }),
            OPERATIONS_CONSOLE_ORGANIZATION_ID, orderId, account.id, account.role, relationshipFingerprint],
        );
        if (!linkResult.rows[0]?.link_order_client_account.relationshipId) {
          throw new Error("M23A_ORDER_CLIENT_LINK_FAILURE: order client-account evidence was not recorded");
        }
        orderClientAccountLinkCount += 1;
      }
      await fault?.("after_order");

      const hubResult = await client.query<{ create_property_hub: string }>(
        `SELECT medialab_core.create_property_hub(
          $1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7::jsonb,$8::jsonb,$9::jsonb)`,
        [token, key("hub", order.externalListingId), OPERATIONS_CONSOLE_ORGANIZATION_ID, property.property_id,
          property.property_snapshot_id, SOURCE_SYSTEM, JSON.stringify([orderId]),
          JSON.stringify([{ membership_id: customer.membership_id, role: "HUB_PARTICIPANT" }]),
          JSON.stringify([{ provider: SOURCE_SYSTEM, external_record_type: "LISTING",
            external_identifier: order.externalListingId, provenance: evidence(sourceManifestSha256) }])],
      );
      const propertyHubId = hubResult.rows[0]!.create_property_hub;
      await fault?.("after_hub");

      const jobResult = await client.query<{ create_job: string }>(
        "SELECT medialab_core.create_job($1,$2,$3::uuid,$4::uuid,$5::uuid,$6)",
        [token, key("job", order.externalOrderId), OPERATIONS_CONSOLE_ORGANIZATION_ID, orderId, propertyHubId, SOURCE_SYSTEM],
      );
      const jobId = jobResult.rows[0]!.create_job;
      let serviceItemReferenceCount = 0;
      const orderedItems = [...readback.items].sort((left, right) => left.position - right.position);
      for (let index = 0; index < orderedItems.length; index += 1) {
        const item = orderedItems[index]!;
        const line = order.serviceLines[index]!;
        const workstreamResult = await client.query<{ create_service_workstream: string }>(
          "SELECT medialab_core.create_service_workstream($1,$2,$3::uuid,$4::uuid,$5)", [
          token, key("workstream", { order: order.externalOrderId, item: item.id }), jobId, item.id, SOURCE_SYSTEM,
        ]);
        await client.query(
          "SELECT medialab_core.record_job_service_external_reference($1,$2,NULL,$3::uuid,$4,$5,$6,$7)",
          [token, key("service-item-reference", line.externalItemId),
            workstreamResult.rows[0]!.create_service_workstream, SOURCE_SYSTEM, "ORDER_ITEM",
            line.externalItemId, evidence(sourceManifestSha256)],
        );
        serviceItemReferenceCount += 1;
      }
      const provenance = evidence(sourceManifestSha256);
      await client.query(
        "SELECT medialab_core.record_job_service_external_reference($1,$2,$3::uuid,NULL,$4,$5,$6,$7)",
        [token, key("fulfillment", order.externalOrderId), jobId, SOURCE_SYSTEM, "ORDER_FULFILLMENT_STATE",
          `${order.externalOrderId}:${order.fulfillmentState}`, provenance],
      );
      await client.query(
        "SELECT medialab_core.record_job_service_external_reference($1,$2,$3::uuid,NULL,$4,$5,$6,$7)",
        [token, key("client-context", order.externalOrderId), jobId, SOURCE_SYSTEM, "CLIENT_ACCOUNT_CONTEXT",
          `${order.externalOrderId}:${order.clientAccount.externalCustomerGroupId}:${order.clientAccount.externalCustomerTeamId ?? "NONE"}`,
          provenance],
      );
      await fault?.("after_job");

      let schedulingRequestCount = 0;
      let appointmentCount = 0;
      let canceledAppointmentCount = 0;
      let assignmentReferenceCount = 0;
      for (let index = 0; index < order.appointments.length; index += 1) {
        const admitted = await admitAppointment(client, token, order, order.appointments[index]!, propertyHubId, orderId, jobId);
        schedulingRequestCount += 1;
        appointmentCount += admitted.appointmentId ? 1 : 0;
        canceledAppointmentCount += admitted.canceled ? 1 : 0;
        assignmentReferenceCount += admitted.assignmentReferences;
        if (index === 0) await fault?.("after_first_appointment");
      }
      if (order.appointments.length === 0) {
        await client.query("SELECT medialab_core.create_scheduling_request($1,$2,$3::uuid,$4::uuid,$5::uuid,$6)", [
          token, key("schedule-request", { order: order.externalOrderId, noAppointment: true }),
          OPERATIONS_CONSOLE_ORGANIZATION_ID, propertyHubId, orderId, SOURCE_SYSTEM,
        ]);
        schedulingRequestCount = 1;
      }

      const financialResult = await client.query<{ record_delivery_financial_eligibility: string }>(
        `SELECT medialab_core.record_delivery_financial_eligibility(
          $1,$2,$3::uuid,$4,'BOUNDED_SETTLEMENT_AUTHORITY',$5,NULL,$6)`,
        [token, key("financial", order.externalOrderId), orderId,
          order.paymentState === "PAID" ? "ELIGIBLE" : "INELIGIBLE",
          `ARYEO.ORDER.${sha256(order.externalOrderId).slice(0, 32).toUpperCase()}`,
          "Exact read-only Aryeo payment status preserved for isolated nonproduction eligibility."],
      );
      await fault?.("before_commit");
      await client.query("COMMIT"); open = false;
      const postCommit = await this.pool.query<{ get_order_record: CanonicalOrderRecord | null }>(
        "SELECT medialab_core.get_order_record($1,$2::uuid)", [token, orderId],
      );
      exactReadback(postCommit.rows[0]?.get_order_record ?? null, orderId, order, property, snapshotIds);
      const groupReadback = await this.pool.query<{ get_client_account_record: ClientAccountRecord | null }>(
        "SELECT medialab_core.get_client_account_record($1,$2::uuid)", [token, customerGroupAccountId],
      );
      exactClientAccountReadback(groupReadback.rows[0]?.get_client_account_record ?? null, {
        accountId: customerGroupAccountId, accountType: "CUSTOMER_GROUP",
        displayName: order.clientAccount.customerGroupName, brokerageName: null, parentClientAccountId: null,
        externalRecordType: "CUSTOMER_GROUP", externalIdentifier: order.clientAccount.externalCustomerGroupId,
        customerPersonId: customer.person_id, orderId,
      });
      if (customerTeamAccountId && order.clientAccount.externalCustomerTeamId && order.clientAccount.customerTeamName) {
        const teamReadback = await this.pool.query<{ get_client_account_record: ClientAccountRecord | null }>(
          "SELECT medialab_core.get_client_account_record($1,$2::uuid)", [token, customerTeamAccountId],
        );
        exactClientAccountReadback(teamReadback.rows[0]?.get_client_account_record ?? null, {
          accountId: customerTeamAccountId, accountType: "CUSTOMER_TEAM",
          displayName: order.clientAccount.customerTeamName, brokerageName: order.clientAccount.brokerageName,
          parentClientAccountId: customerGroupAccountId, externalRecordType: "CUSTOMER_TEAM",
          externalIdentifier: order.clientAccount.externalCustomerTeamId,
          customerPersonId: customer.person_id, orderId,
        });
      }
      return {
        orderId,
        propertyHubId,
        jobId,
        customerPersonId: customer.person_id,
        customerMembershipId: customer.membership_id,
        customerGroupAccountId,
        customerTeamAccountId,
        clientAccountPersonLinkCount,
        orderClientAccountLinkCount,
        customerPhoneEvidenceCount,
        workstreamCount: readback.items.length,
        serviceItemReferenceCount,
        schedulingRequestCount,
        appointmentCount,
        canceledAppointmentCount,
        assignmentReferenceCount,
        financialEvidenceId: financialResult.rows[0]!.record_delivery_financial_eligibility,
        exactTotalCents: order.totalAmountCents,
        structure: order.structure,
        replayed: false,
      };
    } catch (error) {
      if (open) { try { await client.query("ROLLBACK"); } catch { /* preserve the primary safe failure */ } }
      throw error;
    } finally {
      client.release();
    }
  }

  async authorityProof(): Promise<CurrentOperationsAdmissionReceiptV1["authority"]> {
    const runtime = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text FROM information_schema.role_table_grants
       WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [OPERATIONS_CONSOLE_DATABASE.user],
    );
    const publicTable = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
       WHERE n.nspname='medialab_core' AND c.relkind IN ('r','p') AND a.grantee=0
         AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
    );
    const publicFunctions = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
       WHERE n.nspname='medialab_core' AND a.grantee=0 AND a.privilege_type='EXECUTE'`,
    );
    return {
      runtimeCanonicalTableDmlGrants: Number(runtime.rows[0]!.count),
      publicCanonicalTableDmlGrants: Number(publicTable.rows[0]!.count),
      publicFunctionExecutionGrants: Number(publicFunctions.rows[0]!.count),
      businessExecutionRole: OPERATIONS_CONSOLE_DATABASE.user,
      businessWriteBoundary: "SUPPORTED_SECURITY_DEFINER_COMMANDS_ONLY",
    };
  }

  async close(): Promise<void> { await this.pool.end(); }
}
