export const OPERATIONAL_PILOT_SCHEMA = "ML_OPERATIONAL_PILOT_V1" as const;

export const CONTRACT_FAMILIES = [
  "OperationalPilotScenarioV1",
  "PilotJobSummaryV1",
  "DesktopHandoffPacketV1",
  "DesktopResultManifestV1",
  "ReturnedMediaObservationManifestV1",
  "ListingReviewProjectionV1",
  "ReviewDecisionCommandV1",
  "ReviewSubmissionCommandV1",
  "QuickEditWorkingFileV1",
  "QuickEditCorrectionStagingReceiptV1",
  "MediaOperationStatusV1",
  "QuickEditDispositionCommandV1",
  "PublicationSummaryV1",
  "DeliverySummaryV1",
  "ObservedOutcomeV1",
  "BehaviorAcceptanceMatrixV1",
  "OperationalPilotExpectedV1",
  "OperationalPilotObservedV1",
  "OperationalPilotComparisonV1",
  "OperationalPilotCoverageV1",
  "MissionPlanOfflinePacketV1",
  "PlatformToMediaPacketV1",
  "MediaToPlatformResultV1",
  "WholeListingReviewV1",
  "QuickEditQueueItemV1",
  "QuickEditIngressReceiptV1",
  "QuickEditOperationV1",
  "QuickEditDispositionV1",
  "PublicationSnapshotV1",
  "TemporaryDownloadSnapshotV1",
  "OwnerObservabilityV1",
  "AcceptanceMatrixV1",
  "OperationalPilotHealthV1",
  "DevelopmentSessionReceiptV1",
  "OperationalPilotErrorV1",
] as const;

export type ContractFamily = (typeof CONTRACT_FAMILIES)[number];

export interface VersionedContract {
  schema: typeof OPERATIONAL_PILOT_SCHEMA;
  contract: ContractFamily;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEY = /(role|authority|password|secret|credential|token|absolute_path|database_url|provider_payload)/i;
const FORBIDDEN_VALUE = /(^|[\s"'])(https?:\/\/|file:\/\/|\/Users\/|\/home\/|[A-Za-z]:\\)|password|service.?account|oauth|bearer\s/i;

export function assertVersionedContract(value: unknown, requiredIds: readonly string[] = []): asserts value is VersionedContract & Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("contract must be an object");
  const object = value as Record<string, unknown>;
  if (object.schema !== OPERATIONAL_PILOT_SCHEMA) throw new Error("unknown operational-pilot schema");
  if (!CONTRACT_FAMILIES.includes(object.contract as ContractFamily)) throw new Error("unknown operational-pilot contract family");
  for (const id of requiredIds) {
    if (typeof object[id] !== "string" || !UUID.test(object[id] as string)) throw new Error(`missing canonical id: ${id}`);
  }
  assertSafeEvidence(object);
}

export function assertSafeEvidence(value: unknown, path = "$"): void {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (value.length > 8_192) throw new Error(`unbounded evidence at ${path}`);
    if (FORBIDDEN_VALUE.test(value)) throw new Error(`unsafe evidence at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error(`unbounded array at ${path}`);
    value.forEach((item, index) => assertSafeEvidence(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") throw new Error(`unsupported evidence at ${path}`);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`caller authority is forbidden at ${path}.${key}`);
    assertSafeEvidence(item, `${path}.${key}`);
  }
}

export function contract<T extends Record<string, unknown>>(family: ContractFamily, value: T): T & VersionedContract {
  const result = { schema: OPERATIONAL_PILOT_SCHEMA, contract: family, ...value } as T & VersionedContract;
  assertVersionedContract(result);
  return result;
}
