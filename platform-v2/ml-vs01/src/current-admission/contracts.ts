export const CURRENT_OPERATIONS_ADMISSION_SCHEMA = "ML_CURRENT_OPERATIONS_ADMISSION_V1" as const;

export interface AryeoDatasetDefinition {
  readonly id: string;
  readonly path: `/${string}`;
  readonly query: Readonly<Record<string, string>>;
}

export interface AryeoDatasetSnapshotV1 {
  schema: typeof CURRENT_OPERATIONS_ADMISSION_SCHEMA;
  contract: "AryeoDatasetSnapshotV1";
  datasetId: string;
  endpointPath: string;
  method: "GET";
  acquiredAt: string;
  pageCount: number;
  reportedTotal: number;
  recordCount: number;
  providerTimestamps: string[];
  records: unknown[];
}

export interface AryeoSnapshotManifestFileV1 {
  datasetId: string;
  relativePath: string;
  byteSize: number;
  sha256: string;
  pageCount: number;
  reportedTotal: number;
  recordCount: number;
}

export interface AryeoSnapshotManifestV1 {
  schema: typeof CURRENT_OPERATIONS_ADMISSION_SCHEMA;
  contract: "AryeoSnapshotManifestV1";
  method: "GET_ONLY";
  apiBaseUrl: "https://api.aryeo.com/v1";
  startedAt: string;
  completedAt: string;
  allowlistedDatasetCount: number;
  datasetFiles: AryeoSnapshotManifestFileV1[];
  totalRecords: number;
  secretMaterialIncluded: false;
  providerMutationCount: 0;
}

export const ARYEO_HOME_PACKAGE_TITLES = Object.freeze([
  "Small Home Standard Package (under 1200 sq. ft.)",
  "Medium Home Standard Package",
  "Large Home Standard Package",
  "Luxury Home Standard Package",
  "Prestigious Estate Standard Package",
  "Small Home Package (under 1200 sq. ft.)",
  "Medium Home Package",
  "Large Home Package",
  "Prestigious Estate Package",
] as const);

export type AryeoOrderStructure = "CURRENT_HOME_PACKAGE" | "LEGACY_SERVICES";

export type AryeoPaymentState = "PAID" | "UNPAID" | "PARTIALLY_REFUNDED";
export type AryeoFulfillmentState = "FULFILLED" | "UNFULFILLED";

export interface NormalizedAryeoAddressV1 {
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  administrativeArea: string;
  postalCode: string;
  countryCode: "US";
  timezone: string | null;
  reportedSquareFeet: number | null;
}

export interface NormalizedAryeoCustomerV1 {
  externalCustomerUserId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
}

export interface NormalizedAryeoClientAccountV1 {
  externalCustomerGroupId: string;
  customerGroupName: string;
  externalCustomerTeamId: string | null;
  customerTeamName: string | null;
  brokerageName: string | null;
}

export interface NormalizedAryeoOrderItemV1 {
  externalItemId: string;
  title: string;
  description: string | null;
  quantity: number;
  originalUnitAmountCents: number;
  effectiveUnitAmountCents: number;
  adjustmentAmountCents: number;
  lineTotalCents: number;
  currency: string;
}

export interface NormalizedAryeoAppointmentV1 {
  externalAppointmentId: string;
  status: "SCHEDULED" | "UNSCHEDULED" | "CANCELED";
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  rescheduledAt: string | null;
  previousStartsAt: string | null;
  assignedTeamMemberIds: string[];
}

export type AryeoAdmissionExceptionCode =
  | "CANCELED_ORDER"
  | "MISSING_CUSTOMER"
  | "MISSING_LISTING"
  | "INCOMPLETE_ADDRESS"
  | "NO_ACTIVE_SERVICE_LINES"
  | "ORDER_TOTAL_MISMATCH"
  | "PARTIALLY_REFUNDED_REQUIRES_RECONCILIATION"
  | "INVALID_APPOINTMENT_TIME_EVIDENCE"
  | "UNSCHEDULED_APPOINTMENT";

export interface NormalizedAryeoOrderV1 {
  externalOrderId: string;
  externalOrderIdentifier: string;
  externalListingId: string | null;
  createdAt: string;
  updatedAt: string;
  structure: AryeoOrderStructure;
  sourceRecordType: "ARYEO_CURRENT_HOME_PACKAGE_ORDER" | "ARYEO_LEGACY_SERVICES_ORDER";
  orderStatus: "OPEN" | "CANCELED";
  paymentState: AryeoPaymentState;
  fulfillmentState: AryeoFulfillmentState;
  customer: NormalizedAryeoCustomerV1 | null;
  clientAccount: NormalizedAryeoClientAccountV1 | null;
  property: NormalizedAryeoAddressV1 | null;
  serviceLines: NormalizedAryeoOrderItemV1[];
  appointments: NormalizedAryeoAppointmentV1[];
  totalAmountCents: number;
  exceptionCodes: AryeoAdmissionExceptionCode[];
}

export interface CurrentOperationsNormalizationV1 {
  schema: typeof CURRENT_OPERATIONS_ADMISSION_SCHEMA;
  contract: "CurrentOperationsNormalizationV1";
  sourceManifestSha256: string;
  sourceCompletedAt: string;
  listingCount: number;
  orderCount: number;
  appointmentCount: number;
  orders: NormalizedAryeoOrderV1[];
  semanticSha256: string;
}

export interface CurrentOperationsDryRunReceiptV1 {
  schema: typeof CURRENT_OPERATIONS_ADMISSION_SCHEMA;
  contract: "CurrentOperationsDryRunReceiptV1";
  sourceManifestSha256: string;
  sourceCompletedAt: string;
  sourceCounts: {
    listings: number;
    orders: number;
    appointments: number;
    customers: number;
    customerUsers: number;
    companyTeamMembers: number;
    products: number;
    productCategories: number;
  };
  classificationCounts: Record<AryeoOrderStructure, number>;
  admissionReadiness: {
    currentHomePackageReady: number;
    currentHomePackageExceptionOnly: number;
    legacyServicesReady: number;
    legacyServicesExceptionOnly: number;
  };
  statusCounts: {
    payment: Record<string, number>;
    fulfillment: Record<string, number>;
    order: Record<string, number>;
    appointment: Record<string, number>;
  };
  exceptionCounts: Record<string, number>;
  exactOrderTotalCents: number;
  homePackageTitles: readonly string[];
  semanticSha256: string;
  containsCustomerPii: false;
  providerMutationCount: 0;
}
