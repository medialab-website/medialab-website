import { OperationsConsoleRequestValidationError } from "./contracts.js";

export const OPERATIONS_SCHEMA = "ML_INTERNAL_OPERATIONS_CONSOLE_V1" as const;
export type OperationalRole = "PRIMARY_OPERATOR" | "ADDITIONAL_OPERATOR" | "COORDINATOR";
export type AcceptanceMethod = "PHONE" | "TEXT" | "EMAIL" | "IN_PERSON" | "OTHER";
export type MissionPlanVisibility = "INTERNAL_STAFF_ONLY" | "ASSIGNED_CREW_ONLY" | "POTENTIALLY_CUSTOMER_VISIBLE";

export interface OperationsWindowInput {
  startsAt: string;
  endsAt: string;
  ianaTimezone: string;
  localStartsAt: string;
  localEndsAt: string;
  reason?: string;
}
export interface ConfirmAppointmentInput { windowId: string; reason: string }
export interface AcceptProposalInput { windowId: string; acceptanceMethod: AcceptanceMethod; note?: string }
export interface CancelAppointmentInput { reason: string }
export interface RescheduleAppointmentInput extends OperationsWindowInput {
  acceptanceMethod: AcceptanceMethod;
  reason: string;
  note?: string;
}
export interface AssignmentInput { personId: string; operationalRole: OperationalRole }
export interface ReplacementInput { replacementPersonId: string; reason: string }
export interface MissionPlanSectionInput { label: string; content: string; visibility: MissionPlanVisibility }
export interface ReviseMissionPlanInput { sections: MissionPlanSectionInput[] }
export interface MissionPlanNoteInput { note: string; visibility: MissionPlanVisibility }
export interface MissionPlanVersionSelectionInput { versionId: string }
export interface MissionPlanWorkstreamSelectionInput { workstreamIds: string[] }
export interface MissionPlanContactSelectionInput { contacts: Array<{
  personId: string; contactMethodId: string; contactRole: string; visibility: MissionPlanVisibility;
}> }

export interface MissionPlanRecord {
  mission_plan_id: string;
  organization_id: string;
  order_id: string;
  property_hub_id: string;
  job_id: string;
  appointment_id: string;
  job_appointment_id: string;
  audience_scope: "INTERNAL_STAFF" | "ASSIGNED_CREW";
  draft: null | {
    schema_version: number;
    draft_generation: number;
    source_fingerprint_sha256: string;
    content: { sections: MissionPlanSectionInput[] };
    weather_status: "AVAILABLE" | "UNAVAILABLE" | "NOT_REQUESTED";
    weather_evidence: Record<string, unknown> | null;
    weather_unavailable_reason: string | null;
  };
  versions: Array<{
    mission_plan_version_id: string;
    version_number: number;
    supersedes_version_id: string | null;
    canonical_json_sha256: string;
    issued_at: string;
    content: {
      schema_version: number;
      mission_plan_id: string;
      mission_plan_version_id: string;
      version_number: number;
      relationship: Record<string, unknown>;
      weather: Record<string, unknown>;
      selected_workstreams: Array<Record<string, unknown>>;
      sections: MissionPlanSectionInput[];
      contacts: Array<Record<string, unknown>>;
      notes: Array<Record<string, unknown>>;
    };
  }>;
  open_events: Array<Record<string, unknown>>;
}

export interface MissionPlanWorkspace {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "MissionPlanWorkspaceV1";
  readiness: "READY" | "NEEDS_CONFIRMED_APPOINTMENT" | "NEEDS_JOB_APPOINTMENT_LINK";
  context: OperationsContext;
  plan: MissionPlanRecord | null;
  controls: MissionPlanDraftControls | null;
}
export interface MissionPlanDraftControls {
  missionPlanId: string;
  stale: boolean;
  eligibleWorkstreams: Array<{ workstreamId: string; displayName: string; state: string; selected: boolean }>;
  eligibleContacts: Array<{ personId: string; contactMethodId: string; displayName: string; contactType: string;
    displayValue: string; contactRole: string; selected: boolean; visibility: MissionPlanVisibility }>;
  notes: Array<{ noteId: string; visibility: MissionPlanVisibility; text: string; authoredAt: string }>;
}
export interface MissionPlanActionReceipt {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "MissionPlanActionReceiptV1";
  action: string;
  replaySafe: true;
  plan: MissionPlanRecord;
}
export interface MissionPlanOfflinePacket { filename: string; html: string }

export type ProductionLane = "PHOTO" | "VIDEO";
export type ProductionLaneStage =
  | "NOT_ORDERED"
  | "NOT_STARTED"
  | "CAPTURED"
  | "CULLING"
  | "READY_FOR_HANDOFF"
  | "EDITOR_HANDOFF"
  | "RETURNING"
  | "READY_FOR_REVIEW"
  | "REVIEW"
  | "COMPLETE"
  | "EXCEPTION";

export interface ProductionLaneWorkspace {
  lane: ProductionLane;
  expected: boolean;
  workstreams: Array<{ workstreamId: string; displayName: string; state: string }>;
  stage: ProductionLaneStage;
  stageLabel: string;
  nextAction: string;
  capture: { sessionCount: number; states: string[] };
  cull: { workspaceCount: number; currentState: string | null; inventorySealed: boolean;
    activeCandidateCount: number; hasCurrentSelection: boolean };
  handoff: { batchCount: number; currentState: string | null; itemCount: number;
    returnedSourceCount: number; outstandingSourceCount: number; unresolvedReturnCount: number };
  review: { batchCount: number; currentState: string | null; itemCount: number;
    resolvedCount: number; unresolvedCount: number; finalSourceCount: number;
    revisionRoutedCount: number; quickEditRoutedCount: number };
  exceptions: string[];
}

export interface ProductionWorkspace {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "ProductionWorkspaceV1";
  evidenceClassification: "NONPRODUCTION_CANONICAL_READ_ONLY";
  disclosure: string;
  context: OperationsContext;
  missionPlan: null | {
    missionPlanId: string;
    issuedVersionId: string;
    versionNumber: number;
    integritySha256: string;
    issuedAt: string;
  };
  desktopWorkPacketReady: boolean;
  lanes: [ProductionLaneWorkspace, ProductionLaneWorkspace];
  exceptions: string[];
}

export interface DesktopWorkPacket {
  schema: "ML_DESKTOP_WORK_PACKET_V1";
  contract: "DesktopWorkPacketV1";
  contractVersion: 1;
  evidenceClassification: "NONPRODUCTION_CANONICAL_READ_ONLY";
  organizationId: string;
  job: { jobId: string; orderId: string; propertyDisplayReference: string };
  missionPlan: { missionPlanId: string; issuedVersionId: string; versionNumber: number;
    integritySha256: string; issuedAt: string; readAuthority: "IMMUTABLE_ISSUED_VERSION" };
  workstreams: ReadonlyArray<{ workstreamId: string; displayName: string; state: string;
    laneExpectations: readonly ProductionLane[] }>;
  allowedNativeCapabilities: readonly string[];
  prohibitedEffects: readonly string[];
  packetFingerprintSha256: string;
}

export interface DesktopWorkPacketDownload { filename: string; packet: DesktopWorkPacket }

export type ReturnedReviewDisposition =
  | "ACCEPT"
  | "REJECT_REVISION"
  | "USE_ORIGINAL"
  | "QUICK_EDIT"
  | "SKIP_QUICK_EDIT";

export type ReviewAttentionCode =
  | "EDITOR_REVIEW_READY"
  | "EDITOR_REVIEW_IN_PROGRESS"
  | "EDITOR_REVISION_REQUIRED"
  | "QUICK_EDIT_REQUIRED";

export interface ReviewAttentionAction {
  code: ReviewAttentionCode;
  label: string;
  lane: ProductionLane;
  reviewBatchId: string | null;
  reviewItemId: string | null;
  quickEditRequestId: string | null;
}

export interface OperationsReviewAttentionItem {
  orderId: string;
  jobId: string;
  actions: ReviewAttentionAction[];
}

export interface OperationsReviewAttention {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "OperationsReviewAttentionV1";
  items: OperationsReviewAttentionItem[];
}

export interface EditorReviewVersionSummary {
  mediaAssetId: string;
  versionId: string;
  versionKind: string;
  observedFilename: string;
  byteSize: number;
  mediaType: string;
  checksumSha256: string;
}

export interface EditorReviewItem {
  reviewItemId: string;
  ordinal: number;
  sourceKind: string;
  decisionGeneration: number;
  currentDecisionId: string | null;
  currentDisposition: ReturnedReviewDisposition | null;
  currentRouteState: string | null;
  instructions: string | null;
  version: EditorReviewVersionSummary;
  previewAvailable: boolean;
}

export interface EditorReviewBatchWorkspace {
  reviewBatchId: string;
  lane: ProductionLane;
  reviewCycleNumber: number;
  currentState: string;
  lifecycleGeneration: number;
  itemCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  finalSourceCount: number;
  revisionRoutedCount: number;
  quickEditRoutedCount: number;
  items: EditorReviewItem[];
}

export interface QuickEditWorkspaceItem {
  quickEditRequestId: string;
  reviewBatchId: string;
  reviewItemId: string;
  lane: ProductionLane;
  instructions: string | null;
  expectedReviewLifecycleGeneration: number;
  expectedDecisionGeneration: number;
  sourceVersion: EditorReviewVersionSummary;
  uploadState: "AWAITING_UPLOAD" | "UPLOADING" | "RETRY_REQUIRED" | "CORRECTION_REGISTERED" | "FINALIZED";
  uploadMessage: string;
  downloadAvailable: boolean;
  correctedVersionId: string | null;
  successorReviewBatchId: string | null;
}

export interface CompletedReviewHistorySummary {
  reviewBatchId: string;
  lane: ProductionLane;
  reviewCycleNumber: number;
  completedAt: string;
  itemCount: number;
  finalSourceCount: number;
  revisionRoutedCount: number;
  quickEditRoutedCount: number;
  decisions: Array<{
    reviewItemId: string;
    disposition: ReturnedReviewDisposition;
    reason: string | null;
    instructions: string | null;
    decidedAt: string;
  }>;
}

export interface OperationsReviewWorkspace {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "OperationsReviewWorkspaceV1";
  evidenceClassification: "NONPRODUCTION_CANONICAL_REVIEW";
  disclosure: string;
  context: OperationsContext;
  actions: ReviewAttentionAction[];
  activeReview: EditorReviewBatchWorkspace | null;
  quickEdits: QuickEditWorkspaceItem[];
  completedHistory: CompletedReviewHistorySummary[];
}

export interface ReviewStartInput {
  idempotencyKey: string;
  lane: ProductionLane;
}

export interface ReviewSubmissionInput {
  idempotencyKey: string;
  expectedGeneration: number;
  decisions: Array<{
    reviewItemId: string;
    disposition: "ACCEPT" | "REJECT_REVISION" | "QUICK_EDIT";
    instructions: string | null;
    expectedGeneration: number;
    currentDecisionId: string | null;
  }>;
}

export interface ReviewActionReceipt {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "ReviewActionReceiptV1";
  action: "REVIEW_STARTED" | "DECISION_RECORDED" | "REVIEW_SUBMITTED";
  replaySafe: true;
  workspace: OperationsReviewWorkspace;
}

export interface QuickEditUploadReceipt {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "QuickEditUploadReceiptV1";
  accepted: true;
  replaySafe: true;
  requestId: string;
  correctedVersionId: string;
  successorReviewBatchId: string;
  successorDecisionId: string;
  successorCompletionEventId: string;
  finalSourceVersionId: string;
  uploadState: "FINALIZED";
  workspace: OperationsReviewWorkspace;
}

export interface ReviewMediaDownload {
  filename: string;
  mediaType: "image/jpeg" | "image/png";
  byteSize: number;
  checksumSha256: string;
  bytes: Buffer;
}

export interface OperationsContext {
  orderId: string;
  organizationId: string;
  orderStatus: string;
  createdAt: string;
  customer: { personId: string; displayName: string; email: string; contacts?: Array<{
    contactType: "EMAIL" | "PHONE"; displayValue: string;
  }> };
  property: {
    propertyId: string; propertySnapshotId: string; addressLine1: string; addressLine2: string | null;
    locality: string; administrativeArea: string; postalCode: string; countryCode: string; squareFeet: number | null;
  };
  services: Array<{ orderItemId: string; position: number; displayName: string; quantity: number; commercialUnit: string;
    description?: string; unitAmountCents?: number; lineTotalCents?: number; currency?: string }>;
  propertyHubId: string | null;
  scheduling: null | { requestId: string; state: string; creationMode: string; createdAt: string; windows: Array<{
    windowId: string; kind: "REQUESTED" | "STAFF_PROPOSED"; startsAt: string; endsAt: string;
    ianaTimezone: string; localStartsAt: string; localEndsAt: string; accepted: boolean;
  }> };
  appointment: null | { appointmentId: string; state: string; startsAt: string; endsAt: string; ianaTimezone: string;
    localStartsAt: string; localEndsAt: string; assignments: Array<{ assignmentId: string; personId: string;
      displayName: string; operationalRole: OperationalRole; assignedAt: string }> };
  job: null | { jobId: string; state: string; workstreams: Array<{ workstreamId: string; sourceOrderItemId: string;
    displayName: string; state: string }> };
  attention: string[];
}

export interface OperationsHome {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "OperationsHomeV1";
  generatedAt: string;
  rangeStartsAt: string;
  rangeEndsAt: string;
  items: OperationsContext[];
  sections: { today: OperationsContext[]; upcoming: OperationsContext[]; needsAttention: OperationsContext[] };
  counts: { today: number; upcoming: number; needsAttention: number };
}
export interface AssignmentCandidates {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "OperationsAssignmentCandidatesV1";
  organizationId: string;
  candidates: Array<{ personId: string; displayName: string; title: string | null }>;
}
export interface OperationsActionReceipt {
  schema: typeof OPERATIONS_SCHEMA;
  contract: "OperationsActionReceiptV1";
  action: string;
  replaySafe: true;
  context: OperationsContext;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/u;

function fail(path: string, message: string): never {
  throw new OperationsConsoleRequestValidationError(`${path} ${message}`);
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("$", "must be an object");
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return fail("$", `must contain exactly ${expected.join(", ")}`);
  }
  return result;
}
function objectWithOptional(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail("$", "must be an object");
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const missing = requiredKeys.filter((key) => !Object.hasOwn(result, key));
  const unexpected = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    return fail("$", `must contain required ${requiredKeys.join(", ")} and only optional ${optionalKeys.join(", ")}`);
  }
  return result;
}
function string(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > max) {
    return fail(path, `must be a trimmed string of 1-${max} characters`);
  }
  return value;
}
function uuid(value: unknown, path: string): string {
  const result = string(value, path, 36).toLowerCase();
  if (!UUID.test(result)) return fail(path, "must be a canonical UUID");
  return result;
}

function databaseUuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !DATABASE_UUID.test(value)) return fail(path, "must be a database UUID");
  return value.toLowerCase();
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(path, "must be a nonnegative safe integer");
  return Number(value);
}

function idempotencyKey(value: unknown, path: string): string {
  const result = string(value, path, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/u.test(result)) return fail(path, "must be a bounded opaque key");
  return result;
}

function nullableReviewText(value: unknown, path: string, maximum: number): string | null {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return null;
  return string(value, path, maximum);
}
function instant(value: unknown, path: string): string {
  const result = string(value, path, 40);
  const date = new Date(result);
  if (!Number.isFinite(date.valueOf()) || !/[zZ]|[+-]\d{2}:\d{2}$/u.test(result)) return fail(path, "must be an ISO timestamp with an offset");
  return date.toISOString();
}
function local(value: unknown, path: string): string {
  const result = string(value, path, 32);
  if (!LOCAL.test(result)) return fail(path, "must be an offset-free local timestamp");
  return result;
}
function window(value: unknown, reasonRequired: boolean): OperationsWindowInput {
  const root = object(value, reasonRequired
    ? ["startsAt", "endsAt", "ianaTimezone", "localStartsAt", "localEndsAt", "reason"]
    : ["startsAt", "endsAt", "ianaTimezone", "localStartsAt", "localEndsAt"]);
  const startsAt = instant(root.startsAt, "$.startsAt");
  const endsAt = instant(root.endsAt, "$.endsAt");
  if (endsAt <= startsAt) return fail("$.endsAt", "must follow startsAt");
  return {
    startsAt, endsAt, ianaTimezone: string(root.ianaTimezone, "$.ianaTimezone", 100),
    localStartsAt: local(root.localStartsAt, "$.localStartsAt"),
    localEndsAt: local(root.localEndsAt, "$.localEndsAt"),
    ...(reasonRequired ? { reason: string(root.reason, "$.reason", 1000) } : {}),
  };
}

export function parseEmpty(value: unknown): Record<string, never> { object(value, []); return Object.freeze({}); }

export function parseReviewStart(value: unknown): ReviewStartInput {
  const root = object(value, ["idempotencyKey", "lane"]);
  const lane = string(root.lane, "$.lane", 10) as ProductionLane;
  if (lane !== "PHOTO" && lane !== "VIDEO") return fail("$.lane", "is invalid");
  return Object.freeze({ idempotencyKey: idempotencyKey(root.idempotencyKey, "$.idempotencyKey"), lane });
}

export function parseReviewSubmission(value: unknown): ReviewSubmissionInput {
  const root = object(value, ["idempotencyKey", "expectedGeneration", "decisions"]);
  if (!Array.isArray(root.decisions) || root.decisions.length < 1 || root.decisions.length > 500) {
    return fail("$.decisions", "must be an array of 1-500 complete review decisions");
  }
  const decisions = root.decisions.map((value, index) => {
    const decision = objectWithOptional(
      value,
      ["reviewItemId", "disposition", "expectedGeneration", "currentDecisionId"],
      ["instructions"],
    );
    const disposition = string(decision.disposition, `$.decisions[${index}].disposition`, 30);
    if (!["ACCEPT", "REJECT_REVISION", "QUICK_EDIT"].includes(disposition)) {
      return fail(`$.decisions[${index}].disposition`, "is invalid for whole-review submission");
    }
    const instructions = nullableReviewText(
      decision.instructions, `$.decisions[${index}].instructions`, 2000,
    );
    if (disposition === "ACCEPT" && instructions !== null) {
      return fail(`$.decisions[${index}].instructions`, "is available only for Send back and Quick Edit");
    }
    if (decision.currentDecisionId !== null && typeof decision.currentDecisionId !== "string") {
      return fail(`$.decisions[${index}].currentDecisionId`, "must be a canonical UUID or null");
    }
    return Object.freeze({
      reviewItemId: uuid(decision.reviewItemId, `$.decisions[${index}].reviewItemId`),
      disposition: disposition as "ACCEPT" | "REJECT_REVISION" | "QUICK_EDIT",
      instructions,
      expectedGeneration: nonnegativeInteger(
        decision.expectedGeneration, `$.decisions[${index}].expectedGeneration`,
      ),
      currentDecisionId: decision.currentDecisionId === null
        ? null
        : uuid(decision.currentDecisionId, `$.decisions[${index}].currentDecisionId`),
    });
  });
  if (new Set(decisions.map((decision) => decision.reviewItemId)).size !== decisions.length) {
    return fail("$.decisions", "must contain each review item at most once");
  }
  return Object.freeze({
    idempotencyKey: idempotencyKey(root.idempotencyKey, "$.idempotencyKey"),
    expectedGeneration: nonnegativeInteger(root.expectedGeneration, "$.expectedGeneration"),
    decisions,
  });
}
export function parseRequestedWindow(value: unknown): OperationsWindowInput { return Object.freeze(window(value, false)); }
export function parseProposedWindow(value: unknown): OperationsWindowInput { return Object.freeze(window(value, true)); }
export function parseConfirm(value: unknown): ConfirmAppointmentInput {
  const root = object(value, ["windowId", "reason"]);
  return Object.freeze({ windowId: uuid(root.windowId, "$.windowId"), reason: string(root.reason, "$.reason", 1000) });
}
export function parseAcceptProposal(value: unknown): AcceptProposalInput {
  const hasNote = value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "note");
  const root = object(value, ["windowId", "acceptanceMethod", ...(hasNote ? ["note"] : [])]);
  const acceptanceMethod = string(root.acceptanceMethod, "$.acceptanceMethod", 20) as AcceptanceMethod;
  if (!["PHONE", "TEXT", "EMAIL", "IN_PERSON", "OTHER"].includes(acceptanceMethod)) return fail("$.acceptanceMethod", "is invalid");
  return Object.freeze({ windowId: uuid(root.windowId, "$.windowId"), acceptanceMethod,
    ...(root.note === undefined ? {} : { note: string(root.note, "$.note", 1000) }) });
}
export function parseCancel(value: unknown): CancelAppointmentInput {
  const root = object(value, ["reason"]); return Object.freeze({ reason: string(root.reason, "$.reason", 1000) });
}
export function parseReschedule(value: unknown): RescheduleAppointmentInput {
  const hasNote = value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "note");
  const root = object(value, ["startsAt", "endsAt", "ianaTimezone", "localStartsAt", "localEndsAt", "acceptanceMethod", "reason", ...(hasNote ? ["note"] : [])]);
  const startsAt = instant(root.startsAt, "$.startsAt"); const endsAt = instant(root.endsAt, "$.endsAt");
  if (endsAt <= startsAt) return fail("$.endsAt", "must follow startsAt");
  const acceptanceMethod = string(root.acceptanceMethod, "$.acceptanceMethod", 20) as AcceptanceMethod;
  if (!["PHONE", "TEXT", "EMAIL", "IN_PERSON", "OTHER"].includes(acceptanceMethod)) return fail("$.acceptanceMethod", "is invalid");
  return Object.freeze({ startsAt, endsAt, ianaTimezone: string(root.ianaTimezone, "$.ianaTimezone", 100),
    localStartsAt: local(root.localStartsAt, "$.localStartsAt"), localEndsAt: local(root.localEndsAt, "$.localEndsAt"),
    acceptanceMethod, reason: string(root.reason, "$.reason", 1000),
    ...(root.note === undefined ? {} : { note: string(root.note, "$.note", 1000) }) });
}
export function parseAssignment(value: unknown): AssignmentInput {
  const root = object(value, ["personId", "operationalRole"]);
  const operationalRole = string(root.operationalRole, "$.operationalRole", 30) as OperationalRole;
  if (!["PRIMARY_OPERATOR", "ADDITIONAL_OPERATOR", "COORDINATOR"].includes(operationalRole)) return fail("$.operationalRole", "is invalid");
  return Object.freeze({ personId: uuid(root.personId, "$.personId"), operationalRole });
}
export function parseReplacement(value: unknown): ReplacementInput {
  const root = object(value, ["replacementPersonId", "reason"]);
  return Object.freeze({ replacementPersonId: uuid(root.replacementPersonId, "$.replacementPersonId"),
    reason: string(root.reason, "$.reason", 500) });
}

function visibility(value: unknown, path: string): MissionPlanVisibility {
  const result = string(value, path, 40) as MissionPlanVisibility;
  if (!["INTERNAL_STAFF_ONLY", "ASSIGNED_CREW_ONLY", "POTENTIALLY_CUSTOMER_VISIBLE"].includes(result)) {
    return fail(path, "is invalid");
  }
  return result;
}

export function parseMissionPlanRevision(value: unknown): ReviseMissionPlanInput {
  const root = object(value, ["sections"]);
  if (!Array.isArray(root.sections) || root.sections.length < 1 || root.sections.length > 12) {
    return fail("$.sections", "must contain 1-12 sections");
  }
  const sections = root.sections.map((candidate, index) => {
    const section = object(candidate, ["label", "content", "visibility"]);
    return Object.freeze({
      label: string(section.label, `$.sections[${index}].label`, 120),
      content: string(section.content, `$.sections[${index}].content`, 5000),
      visibility: visibility(section.visibility, `$.sections[${index}].visibility`),
    });
  });
  return Object.freeze({ sections: Object.freeze(sections) as MissionPlanSectionInput[] });
}

export function parseMissionPlanNote(value: unknown): MissionPlanNoteInput {
  const root = object(value, ["note", "visibility"]);
  return Object.freeze({ note: string(root.note, "$.note", 4000), visibility: visibility(root.visibility, "$.visibility") });
}

export function parseMissionPlanVersionSelection(value: unknown): MissionPlanVersionSelectionInput {
  const root = object(value, ["versionId"]);
  return Object.freeze({ versionId: uuid(root.versionId, "$.versionId") });
}

export function parseMissionPlanWorkstreamSelection(value: unknown): MissionPlanWorkstreamSelectionInput {
  const root = object(value, ["workstreamIds"]);
  if (!Array.isArray(root.workstreamIds) || root.workstreamIds.length < 1 || root.workstreamIds.length > 100) {
    return fail("$.workstreamIds", "must contain 1-100 canonical Workstream IDs");
  }
  const workstreamIds = root.workstreamIds.map((value, index) => uuid(value, `$.workstreamIds[${index}]`));
  if (new Set(workstreamIds).size !== workstreamIds.length) return fail("$.workstreamIds", "must not contain duplicates");
  return Object.freeze({ workstreamIds: Object.freeze(workstreamIds) as string[] });
}

export function parseMissionPlanContactSelection(value: unknown): MissionPlanContactSelectionInput {
  const root = object(value, ["contacts"]);
  if (!Array.isArray(root.contacts) || root.contacts.length > 20) return fail("$.contacts", "must contain no more than 20 contacts");
  const contacts = root.contacts.map((candidate, index) => {
    const contact = object(candidate, ["personId", "contactMethodId", "contactRole", "visibility"]);
    return Object.freeze({ personId: uuid(contact.personId, `$.contacts[${index}].personId`),
      contactMethodId: databaseUuid(contact.contactMethodId, `$.contacts[${index}].contactMethodId`),
      contactRole: string(contact.contactRole, `$.contacts[${index}].contactRole`, 100),
      visibility: visibility(contact.visibility, `$.contacts[${index}].visibility`) });
  });
  return Object.freeze({ contacts: Object.freeze(contacts) as MissionPlanContactSelectionInput["contacts"] });
}
