import type { BusinessReplayExpectedOutcomeV1, BusinessReplayObservedOutcomeV1, FieldComparisonV1, MismatchClassification } from "./contracts.js";
import { stableJson } from "./deterministic-ids.js";

export const CLASSIFICATION_PRECEDENCE: readonly MismatchClassification[] = [
  "HARNESS_ERROR", "CANONICAL_SCHEMA_GAP", "IMPLEMENTATION_GAP", "SOURCE_CONFLICT",
  "AMBIGUOUS_EVIDENCE", "DEFERRED_CAPABILITY", "INTENTIONAL_POLICY_CHANGE", "MATCH",
] as const;

export function compareOutcomes(expected: BusinessReplayExpectedOutcomeV1, observed: BusinessReplayObservedOutcomeV1): FieldComparisonV1[] {
  const observedByField = new Map(observed.fields.map((field) => [field.field, field]));
  return expected.assertions.map((assertion) => {
    const actual = observedByField.get(assertion.field);
    const equal = actual !== undefined && stableJson(actual.value) === stableJson(assertion.expected);
    const classification: MismatchClassification = equal ? "MATCH" : (assertion.mismatchClassification ?? "IMPLEMENTATION_GAP");
    return { ...assertion, observed: actual?.value, observationSource: actual?.source ?? "NOT_EXECUTED", classification, pass: equal ||
      ["INTENTIONAL_POLICY_CHANGE", "SOURCE_CONFLICT", "AMBIGUOUS_EVIDENCE", "DEFERRED_CAPABILITY"].includes(classification) };
  });
}

export function scenarioClassification(comparisons: readonly FieldComparisonV1[]): MismatchClassification {
  const present = new Set(comparisons.map((item) => item.classification));
  return CLASSIFICATION_PRECEDENCE.find((classification) => present.has(classification)) ?? "HARNESS_ERROR";
}

