import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  ARYEO_HOME_PACKAGE_TITLES,
  CURRENT_OPERATIONS_ADMISSION_SCHEMA,
  type AryeoAdmissionExceptionCode,
  type AryeoDatasetSnapshotV1,
  type AryeoSnapshotManifestV1,
  type CurrentOperationsDryRunReceiptV1,
  type CurrentOperationsNormalizationV1,
  type NormalizedAryeoAddressV1,
  type NormalizedAryeoAppointmentV1,
  type NormalizedAryeoClientAccountV1,
  type NormalizedAryeoCustomerV1,
  type NormalizedAryeoOrderItemV1,
  type NormalizedAryeoOrderV1,
} from "./contracts.js";

const REQUIRED_DATASETS = Object.freeze([
  "customer-users", "customers", "company-team-members", "orders", "listings",
  "appointments", "products", "product-categories",
] as const);
const HOME_PACKAGE_TITLE_SET = new Set<string>(ARYEO_HOME_PACKAGE_TITLES);

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredText(value: unknown, label: string): string {
  const normalized = text(value);
  if (!normalized) throw new Error(`ARYEO_SOURCE_SCHEMA_DIVERGENCE: ${label} is missing`);
  return normalized;
}

function exactEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const normalized = requiredText(value, label);
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new Error(`ARYEO_SOURCE_SCHEMA_DIVERGENCE: ${label} has unsupported value ${normalized}`);
  }
  return normalized as T;
}

function tally(values: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of [...values].sort()) result[value] = (result[value] ?? 0) + 1;
  return result;
}

async function readVerifiedSnapshot(
  root: string,
  manifest: AryeoSnapshotManifestV1,
  datasetId: string,
): Promise<AryeoDatasetSnapshotV1> {
  const entry = manifest.datasetFiles.find((candidate) => candidate.datasetId === datasetId);
  if (!entry || entry.relativePath !== `${datasetId}.json`) {
    throw new Error(`ARYEO_SOURCE_FREEZE_FAILURE: manifest entry missing for ${datasetId}`);
  }
  const path = join(root, entry.relativePath);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`ARYEO_SOURCE_FREEZE_FAILURE: ${datasetId} is not a regular source file`);
  }
  const bytes = await readFile(path);
  if (bytes.length !== entry.byteSize || sha256(bytes) !== entry.sha256) {
    throw new Error(`ARYEO_SOURCE_FREEZE_FAILURE: ${datasetId} identity mismatch`);
  }
  const snapshot = JSON.parse(bytes.toString("utf8")) as AryeoDatasetSnapshotV1;
  if (snapshot.schema !== CURRENT_OPERATIONS_ADMISSION_SCHEMA || snapshot.contract !== "AryeoDatasetSnapshotV1" ||
      snapshot.datasetId !== datasetId || snapshot.method !== "GET" || !Array.isArray(snapshot.records) ||
      snapshot.recordCount !== snapshot.records.length || snapshot.reportedTotal !== snapshot.records.length) {
    throw new Error(`ARYEO_SOURCE_SCHEMA_DIVERGENCE: ${datasetId} envelope mismatch`);
  }
  return snapshot;
}

function normalizeCustomer(order: JsonRecord): NormalizedAryeoCustomerV1 | null {
  const membership = record(order.customer_team_membership);
  const user = record(membership?.customer_user);
  const group = record(order.customer);
  const externalCustomerUserId = text(user?.id);
  const displayName = text(user?.full_name) ?? [text(user?.first_name), text(user?.last_name)].filter(Boolean).join(" ").trim();
  if (!externalCustomerUserId || !displayName) return null;
  return {
    externalCustomerUserId,
    displayName,
    email: text(user?.email)?.toLowerCase() ?? text(group?.email)?.toLowerCase() ?? null,
    phone: text(user?.phone) ?? text(group?.phone),
  };
}

function normalizeClientAccount(order: JsonRecord): NormalizedAryeoClientAccountV1 | null {
  const group = record(order.customer);
  const membership = record(order.customer_team_membership);
  const team = record(membership?.customer_team);
  const externalCustomerGroupId = text(group?.id);
  const customerGroupName = text(group?.name);
  if (!externalCustomerGroupId || !customerGroupName) return null;
  return {
    externalCustomerGroupId,
    customerGroupName,
    externalCustomerTeamId: text(team?.id),
    customerTeamName: text(team?.name),
    brokerageName: text(team?.brokerage_name),
  };
}

function normalizeAddress(order: JsonRecord, listing: JsonRecord | null): NormalizedAryeoAddressV1 | null {
  const building = record(listing?.building);
  const squareFeet = integer(building?.square_feet);
  for (const source of [record(order.address), record(listing?.address)]) {
    if (!source) continue;
    const streetNumber = text(source.street_number);
    const streetName = text(source.street_name);
    const composed = [streetNumber, streetName].filter(Boolean).join(" ").trim();
    const addressLine1 = text(source.unparsed_address_part_one) ?? (composed || null) ?? text(source.unparsed_address);
    const locality = text(source.city);
    const administrativeArea = text(source.state_or_province)?.toUpperCase() ?? null;
    const postalCode = text(source.postal_code)?.toUpperCase() ?? null;
    if (!addressLine1 || !locality || !administrativeArea || !postalCode) continue;
    return {
      addressLine1,
      addressLine2: text(source.unparsed_address_part_two) ?? text(source.unit_number),
      locality,
      administrativeArea,
      postalCode,
      // MediaLab's accepted current-era intake law and operating territory are US-only.
      // Aryeo omits this field from the account's otherwise complete postal tuples.
      countryCode: "US",
      timezone: text(source.timezone),
      reportedSquareFeet: squareFeet && squareFeet > 0 ? squareFeet : null,
    };
  }
  return null;
}

function normalizeItem(value: unknown, currency: string): NormalizedAryeoOrderItemV1 | null {
  const source = record(value);
  if (!source || source.is_canceled === true) return null;
  const externalItemId = text(source.id);
  const title = text(source.title);
  const quantity = integer(source.quantity);
  const originalUnitAmountCents = integer(source.unit_price_amount);
  const lineTotalCents = integer(source.gross_total_amount);
  if (!externalItemId || !title || !quantity || quantity <= 0 || originalUnitAmountCents === null ||
      originalUnitAmountCents < 0 || lineTotalCents === null || lineTotalCents < 0 || lineTotalCents % quantity !== 0) {
    return null;
  }
  const effectiveUnitAmountCents = lineTotalCents / quantity;
  return {
    externalItemId,
    title,
    description: text(source.description) ?? text(source.subtitle) ?? text(source.sub_title),
    quantity,
    originalUnitAmountCents,
    effectiveUnitAmountCents,
    adjustmentAmountCents: effectiveUnitAmountCents - originalUnitAmountCents,
    lineTotalCents,
    currency,
  };
}

function normalizeAppointment(value: unknown, timezone: string | null): NormalizedAryeoAppointmentV1 {
  const source = record(value);
  if (!source) throw new Error("ARYEO_SOURCE_SCHEMA_DIVERGENCE: appointment is not an object");
  const status = exactEnum(source.status, ["SCHEDULED", "UNSCHEDULED", "CANCELED"] as const, "appointment.status");
  const startsAt = text(source.start_at);
  const durationMinutes = integer(source.duration);
  let endsAt = text(source.end_at);
  if (!endsAt && startsAt && durationMinutes !== null && durationMinutes > 0) {
    endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
  }
  const assigned = [
    ...array(source.company_team_members),
    ...array(source.users),
  ].map((candidate) => text(record(candidate)?.id)).filter((id): id is string => Boolean(id));
  return {
    externalAppointmentId: requiredText(source.id, "appointment.id"),
    status,
    startsAt,
    endsAt,
    durationMinutes: durationMinutes !== null && durationMinutes > 0 ? durationMinutes : null,
    timezone,
    rescheduledAt: text(source.rescheduled_at),
    previousStartsAt: text(source.previous_start_at),
    assignedTeamMemberIds: [...new Set(assigned)].sort(),
  };
}

function orderAppointmentsByOrder(appointments: readonly unknown[]): Map<string, unknown[]> {
  const result = new Map<string, unknown[]>();
  for (const value of appointments) {
    const source = record(value);
    const orderId = text(record(source?.order)?.id);
    if (!orderId) continue;
    const values = result.get(orderId) ?? [];
    values.push(value);
    result.set(orderId, values);
  }
  return result;
}

function normalizeOrder(
  value: unknown,
  listingById: ReadonlyMap<string, JsonRecord>,
  appointmentsByOrder: ReadonlyMap<string, unknown[]>,
): NormalizedAryeoOrderV1 {
  const source = record(value);
  if (!source) throw new Error("ARYEO_SOURCE_SCHEMA_DIVERGENCE: order is not an object");
  const externalOrderId = requiredText(source.id, "order.id");
  const externalListingId = text(record(source.listing)?.id);
  const listing = externalListingId ? listingById.get(externalListingId) ?? null : null;
  const currency = requiredText(source.currency, "order.currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("ARYEO_SOURCE_SCHEMA_DIVERGENCE: order.currency is invalid");
  const serviceLines = array(source.items).map((item) => normalizeItem(item, currency))
    .filter((item): item is NormalizedAryeoOrderItemV1 => item !== null);
  const structure = serviceLines.some((line) => HOME_PACKAGE_TITLE_SET.has(line.title))
    ? "CURRENT_HOME_PACKAGE" as const : "LEGACY_SERVICES" as const;
  const orderStatus = exactEnum(source.order_status, ["OPEN", "CANCELED"] as const, "order.order_status");
  const paymentState = exactEnum(source.payment_status, ["PAID", "UNPAID", "PARTIALLY_REFUNDED"] as const, "order.payment_status");
  const fulfillmentState = exactEnum(source.fulfillment_status, ["FULFILLED", "UNFULFILLED"] as const, "order.fulfillment_status");
  const totalAmountCents = integer(source.total_amount);
  if (totalAmountCents === null || totalAmountCents < 0) throw new Error("ARYEO_SOURCE_SCHEMA_DIVERGENCE: order.total_amount is invalid");
  const customer = normalizeCustomer(source);
  const clientAccount = normalizeClientAccount(source);
  const property = normalizeAddress(source, listing);
  const appointmentValues = appointmentsByOrder.get(externalOrderId) ?? array(source.appointments);
  const timezone = property?.timezone ?? null;
  const appointments = appointmentValues.map((appointment) => normalizeAppointment(appointment, timezone))
    .sort((left, right) => (left.startsAt ?? "9999").localeCompare(right.startsAt ?? "9999") ||
      left.externalAppointmentId.localeCompare(right.externalAppointmentId));
  const exceptionCodes = new Set<AryeoAdmissionExceptionCode>();
  if (orderStatus === "CANCELED") exceptionCodes.add("CANCELED_ORDER");
  if (!customer) exceptionCodes.add("MISSING_CUSTOMER");
  if (!externalListingId) exceptionCodes.add("MISSING_LISTING");
  if (!property) exceptionCodes.add("INCOMPLETE_ADDRESS");
  if (serviceLines.length === 0) exceptionCodes.add("NO_ACTIVE_SERVICE_LINES");
  if (serviceLines.reduce((sum, line) => sum + line.lineTotalCents, 0) !== totalAmountCents) {
    exceptionCodes.add("ORDER_TOTAL_MISMATCH");
  }
  if (paymentState === "PARTIALLY_REFUNDED") exceptionCodes.add("PARTIALLY_REFUNDED_REQUIRES_RECONCILIATION");
  if (appointments.some((appointment) => appointment.status !== "UNSCHEDULED" &&
      (!appointment.startsAt || !appointment.endsAt ||
       !Number.isFinite(Date.parse(appointment.startsAt)) || !Number.isFinite(Date.parse(appointment.endsAt)) ||
       Date.parse(appointment.endsAt) <= Date.parse(appointment.startsAt)))) {
    exceptionCodes.add("INVALID_APPOINTMENT_TIME_EVIDENCE");
  }
  if (appointments.some((appointment) => appointment.status === "UNSCHEDULED" || !appointment.startsAt)) {
    exceptionCodes.add("UNSCHEDULED_APPOINTMENT");
  }
  return {
    externalOrderId,
    externalOrderIdentifier: text(source.identifier) ?? text(source.number) ?? externalOrderId,
    externalListingId,
    createdAt: requiredText(source.created_at, "order.created_at"),
    updatedAt: requiredText(source.updated_at, "order.updated_at"),
    structure,
    sourceRecordType: structure === "CURRENT_HOME_PACKAGE"
      ? "ARYEO_CURRENT_HOME_PACKAGE_ORDER" : "ARYEO_LEGACY_SERVICES_ORDER",
    orderStatus,
    paymentState,
    fulfillmentState,
    customer,
    clientAccount,
    property,
    serviceLines,
    appointments,
    totalAmountCents,
    exceptionCodes: [...exceptionCodes].sort(),
  };
}

export function buildCurrentOperationsDryRunReceipt(
  normalized: CurrentOperationsNormalizationV1,
  counts: CurrentOperationsDryRunReceiptV1["sourceCounts"],
): CurrentOperationsDryRunReceiptV1 {
  const appointments = normalized.orders.flatMap((order) => order.appointments);
  const exceptionCodes = normalized.orders.flatMap((order) => order.exceptionCodes);
  const blocking = new Set<AryeoAdmissionExceptionCode>([
    "CANCELED_ORDER", "MISSING_CUSTOMER", "MISSING_LISTING", "INCOMPLETE_ADDRESS",
    "NO_ACTIVE_SERVICE_LINES", "ORDER_TOTAL_MISMATCH", "PARTIALLY_REFUNDED_REQUIRES_RECONCILIATION",
    "INVALID_APPOINTMENT_TIME_EVIDENCE",
  ]);
  const ready = (order: NormalizedAryeoOrderV1) => !order.exceptionCodes.some((code) => blocking.has(code));
  const current = normalized.orders.filter((order) => order.structure === "CURRENT_HOME_PACKAGE");
  const legacy = normalized.orders.filter((order) => order.structure === "LEGACY_SERVICES");
  return {
    schema: CURRENT_OPERATIONS_ADMISSION_SCHEMA,
    contract: "CurrentOperationsDryRunReceiptV1",
    sourceManifestSha256: normalized.sourceManifestSha256,
    sourceCompletedAt: normalized.sourceCompletedAt,
    sourceCounts: counts,
    classificationCounts: {
      CURRENT_HOME_PACKAGE: current.length,
      LEGACY_SERVICES: legacy.length,
    },
    admissionReadiness: {
      currentHomePackageReady: current.filter(ready).length,
      currentHomePackageExceptionOnly: current.filter((order) => !ready(order)).length,
      legacyServicesReady: legacy.filter(ready).length,
      legacyServicesExceptionOnly: legacy.filter((order) => !ready(order)).length,
    },
    statusCounts: {
      payment: tally(normalized.orders.map((order) => order.paymentState)),
      fulfillment: tally(normalized.orders.map((order) => order.fulfillmentState)),
      order: tally(normalized.orders.map((order) => order.orderStatus)),
      appointment: tally(appointments.map((appointment) => appointment.status)),
    },
    exceptionCounts: tally(exceptionCodes),
    exactOrderTotalCents: normalized.orders.reduce((sum, order) => sum + order.totalAmountCents, 0),
    homePackageTitles: ARYEO_HOME_PACKAGE_TITLES,
    semanticSha256: normalized.semanticSha256,
    containsCustomerPii: false,
    providerMutationCount: 0,
  };
}

export async function loadAndNormalizeAryeoSnapshot(rootInput: string): Promise<{
  normalized: CurrentOperationsNormalizationV1;
  receipt: CurrentOperationsDryRunReceiptV1;
}> {
  if (!isAbsolute(rootInput)) throw new Error("ARYEO_SOURCE_BOUNDARY_FAILURE: snapshot root must be absolute");
  const root = resolve(rootInput);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) {
    throw new Error("ARYEO_SOURCE_BOUNDARY_FAILURE: snapshot root must be a canonical non-symlink directory");
  }
  const manifestBytes = await readFile(join(root, "MANIFEST.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as AryeoSnapshotManifestV1;
  if (manifest.schema !== CURRENT_OPERATIONS_ADMISSION_SCHEMA || manifest.contract !== "AryeoSnapshotManifestV1" ||
      manifest.method !== "GET_ONLY" || manifest.providerMutationCount !== 0 || manifest.secretMaterialIncluded !== false ||
      manifest.allowlistedDatasetCount !== REQUIRED_DATASETS.length || manifest.datasetFiles.length !== REQUIRED_DATASETS.length) {
    throw new Error("ARYEO_SOURCE_FREEZE_FAILURE: manifest boundary mismatch");
  }
  const datasetIds = [...manifest.datasetFiles.map((file) => file.datasetId)].sort();
  if (datasetIds.join("\n") !== [...REQUIRED_DATASETS].sort().join("\n")) {
    throw new Error("ARYEO_SOURCE_FREEZE_FAILURE: dataset allowlist mismatch");
  }
  const snapshots = new Map<string, AryeoDatasetSnapshotV1>();
  for (const datasetId of REQUIRED_DATASETS) {
    snapshots.set(datasetId, await readVerifiedSnapshot(root, manifest, datasetId));
  }
  const listings = snapshots.get("listings")!.records;
  const appointments = snapshots.get("appointments")!.records;
  const appointmentsByOrder = orderAppointmentsByOrder(appointments);
  const listingById = new Map<string, JsonRecord>();
  for (const value of listings) {
    const source = record(value);
    const id = text(source?.id);
    if (!source || !id || listingById.has(id)) throw new Error("ARYEO_SOURCE_SCHEMA_DIVERGENCE: listing identity is invalid or duplicated");
    listingById.set(id, source);
  }
  const normalizedOrders = snapshots.get("orders")!.records
    .map((order) => normalizeOrder(order, listingById, appointmentsByOrder))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.externalOrderId.localeCompare(right.externalOrderId));
  if (new Set(normalizedOrders.map((order) => order.externalOrderId)).size !== normalizedOrders.length) {
    throw new Error("ARYEO_SOURCE_SCHEMA_DIVERGENCE: duplicate order identity");
  }
  const semanticSha256 = sha256(stableJson(normalizedOrders));
  const normalized: CurrentOperationsNormalizationV1 = {
    schema: CURRENT_OPERATIONS_ADMISSION_SCHEMA,
    contract: "CurrentOperationsNormalizationV1",
    sourceManifestSha256: sha256(manifestBytes),
    sourceCompletedAt: manifest.completedAt,
    listingCount: listings.length,
    orderCount: normalizedOrders.length,
    appointmentCount: appointments.length,
    orders: normalizedOrders,
    semanticSha256,
  };
  const receipt = buildCurrentOperationsDryRunReceipt(normalized, {
    listings: listings.length,
    orders: normalizedOrders.length,
    appointments: appointments.length,
    customers: snapshots.get("customers")!.records.length,
    customerUsers: snapshots.get("customer-users")!.records.length,
    companyTeamMembers: snapshots.get("company-team-members")!.records.length,
    products: snapshots.get("products")!.records.length,
    productCategories: snapshots.get("product-categories")!.records.length,
  });
  return { normalized, receipt };
}
