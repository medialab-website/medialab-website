export const BUSINESS_REPLAY_SCHEMA = "ML_BUSINESS_REPLAY_V1" as const;
export const PLATFORM_COMMIT = "8f55e159b0d568b149b55d6c515857ec62c657fd" as const;

export type ProvenanceClassification = "SYNTHETIC_FIXTURE" | "HISTORICAL_NORMALIZED" | "CURRENT_SHADOW_NORMALIZED";
export type ExecutionMode = "PLATFORM_EXECUTED" | "CLASSIFIER_ONLY" | "DEFERRED_NOT_EXECUTED";
export type ObservationSource = "PLATFORM_OBSERVED" | "HARNESS_OBSERVED" | "NOT_EXECUTED" | "DEFERRED";
export type MismatchClassification = "MATCH" | "INTENTIONAL_POLICY_CHANGE" | "SOURCE_CONFLICT" |
  "AMBIGUOUS_EVIDENCE" | "DEFERRED_CAPABILITY" | "IMPLEMENTATION_GAP" |
  "CANONICAL_SCHEMA_GAP" | "HARNESS_ERROR";

export interface SourceEvidenceReferenceV1 {
  sourceSystemType: "ARYEO" | "STRIPE" | "QUICKBOOKS" | "HONEYBOOK" | "DRIVE" | "LEGACY_OPERATIONAL_RECORD" | "R71_POLICY";
  sourceRecordType: string;
  opaqueSourceReferenceHash: string;
  sourceArtifactHash?: string;
  observedAt: string;
  evidenceConfidence: "HIGH" | "MEDIUM" | "LOW";
  ambiguityOrConflict: boolean;
  syntheticEvidenceRoleLabel: true;
  fieldClaims: readonly string[];
}

export interface BusinessReplayExpectedAssertionV1 {
  field: string;
  expected: unknown;
  mismatchClassification?: Exclude<MismatchClassification, "MATCH">;
  reason: string;
}

export interface BusinessReplayExpectedOutcomeV1 {
  schema: typeof BUSINESS_REPLAY_SCHEMA;
  contract: "BusinessReplayExpectedOutcomeV1";
  assertions: readonly BusinessReplayExpectedAssertionV1[];
  authoredIndependently: true;
}

export interface BusinessReplayObservedFieldV1 {
  field: string;
  value: unknown;
  source: ObservationSource;
}

export interface BusinessReplayObservedOutcomeV1 {
  schema: typeof BUSINESS_REPLAY_SCHEMA;
  contract: "BusinessReplayObservedOutcomeV1";
  fields: readonly BusinessReplayObservedFieldV1[];
  commandsAttempted: readonly string[];
  commandResults: readonly { command: string; status: "ACCEPTED" | "REJECTED"; reason?: string }[];
}

export interface CoverageTagV1 { dimension: string; case: string }

export interface BusinessReplayScenarioV1 {
  schema: typeof BUSINESS_REPLAY_SCHEMA;
  contract: "BusinessReplayScenarioV1";
  scenarioId: string;
  scenarioVersion: 1;
  lane: "REAL_ESTATE_MEDIA";
  provenanceClassification: ProvenanceClassification;
  policyBaseline: "R71";
  syntheticReferenceDate: string;
  fixtureNamespace: string;
  description: string;
  scenarioTags: readonly string[];
  executionMode: ExecutionMode;
  evidence: readonly SourceEvidenceReferenceV1[];
  actorsAndAuthority: Record<string, unknown>;
  commercialFacts: Record<string, unknown>;
  schedulingAndOperations: Record<string, unknown>;
  financialAndDeliveryFacts: Record<string, unknown>;
  historicallyObservedOutcome: { status: "SYNTHETIC_NOT_APPLICABLE"; fields: readonly BusinessReplayObservedFieldV1[] };
  currentIntendedPolicyOutcome: Record<string, unknown>;
  expectedR71Outcome: BusinessReplayExpectedOutcomeV1;
  syntheticObservedOutcome?: BusinessReplayObservedOutcomeV1;
  intentionalDifferences: readonly string[];
  ambiguities: readonly string[];
  coverage: readonly CoverageTagV1[];
}

export interface FieldComparisonV1 extends BusinessReplayExpectedAssertionV1 {
  observed: unknown;
  observationSource: ObservationSource;
  classification: MismatchClassification;
  pass: boolean;
}

export interface BusinessReplayResultV1 {
  schema: typeof BUSINESS_REPLAY_SCHEMA;
  contract: "BusinessReplayResultV1";
  scenarioId: string;
  executionMode: ExecutionMode;
  scenarioClassification: MismatchClassification;
  comparisons: readonly FieldComparisonV1[];
  observedR71Outcome: BusinessReplayObservedOutcomeV1;
  coverage: readonly CoverageTagV1[];
  semanticResultSha256: string;
}

export function expected(assertions: readonly BusinessReplayExpectedAssertionV1[]): BusinessReplayExpectedOutcomeV1 {
  return { schema: BUSINESS_REPLAY_SCHEMA, contract: "BusinessReplayExpectedOutcomeV1", assertions, authoredIndependently: true };
}

export function observed(fields: readonly BusinessReplayObservedFieldV1[], commandsAttempted: readonly string[] = []): BusinessReplayObservedOutcomeV1 {
  return { schema: BUSINESS_REPLAY_SCHEMA, contract: "BusinessReplayObservedOutcomeV1", fields, commandsAttempted,
    commandResults: commandsAttempted.map((command) => ({ command, status: "ACCEPTED" as const })) };
}

