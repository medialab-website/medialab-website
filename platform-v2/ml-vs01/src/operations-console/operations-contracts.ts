import { OperationsConsoleRequestValidationError } from "./contracts.js";

export const OPERATIONS_SCHEMA = "ML_INTERNAL_OPERATIONS_CONSOLE_V1" as const;
export type OperationalRole = "PRIMARY_OPERATOR" | "ADDITIONAL_OPERATOR" | "COORDINATOR";
export type AcceptanceMethod = "PHONE" | "TEXT" | "EMAIL" | "IN_PERSON" | "OTHER";

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

export interface OperationsContext {
  orderId: string;
  organizationId: string;
  orderStatus: string;
  createdAt: string;
  customer: { personId: string; displayName: string; email: string };
  property: {
    propertyId: string; propertySnapshotId: string; addressLine1: string; addressLine2: string | null;
    locality: string; administrativeArea: string; postalCode: string; countryCode: string; squareFeet: number | null;
  };
  services: Array<{ orderItemId: string; position: number; displayName: string; quantity: number; commercialUnit: string }>;
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
