import type { BusinessReplayScenarioV1, CoverageTagV1, ExecutionMode } from "./contracts.js";

export const COVERAGE_DIMENSIONS = [
  "customer_type", "customer_tenure", "organization_structure", "organization_membership", "billing_model",
  "billing_authority", "commercial_ownership", "package_family", "service_workstream_family", "addon_family",
  "pricing_tier", "scope_timing", "appointment_complexity", "reschedule_condition", "cancellation_condition",
  "travel_condition", "payment_evidence", "delivery_entitlement", "correction_revision", "quick_edit",
  "multi_order_day", "source_conflict", "data_quality", "intentional_policy_change", "deferred_capability",
] as const;

export type CoverageDimension = (typeof COVERAGE_DIMENSIONS)[number];

export const COVERAGE_CASE_CATALOG: Record<CoverageDimension, readonly string[]> = {
  customer_type: ["INDEPENDENT_AGENT", "AGENCY_MEMBER", "ORGANIZATION"],
  customer_tenure: ["NEW", "REPEAT"],
  organization_structure: ["INDIVIDUAL", "AGENCY", "FUNDED_ORGANIZATION"],
  organization_membership: ["NONE", "ACTIVE_MEMBER"],
  billing_model: ["PERSONAL", "ORGANIZATION_FUNDED"],
  billing_authority: ["AUTHORIZED", "MISSING_REQUIRED_AUTHORITY"],
  commercial_ownership: ["PERSON", "ORGANIZATION"],
  package_family: ["PHOTO_ONLY", "PHOTO_DRONE", "PHOTO_VIDEO", "LAND_ACREAGE"],
  service_workstream_family: ["PHOTO", "DRONE", "VIDEO", "FLOOR_PLAN"],
  addon_family: ["NONE", "DRONE", "FLOOR_PLAN", "LATER_SCOPE"],
  pricing_tier: ["BELOW_BOUNDARY", "AT_OR_ABOVE_BOUNDARY"],
  scope_timing: ["PRE_PUBLICATION", "POST_PUBLICATION_SEPARATE"],
  appointment_complexity: ["SINGLE", "MULTIPLE"],
  reschedule_condition: ["NONE", "SUPERSEDED_AND_REPLACED"],
  cancellation_condition: ["NONE", "CANCELLED_OR_UNABLE"],
  travel_condition: ["LOCAL", "RURAL_TRAVEL"],
  payment_evidence: ["BOUNDED_ELIGIBLE", "INCOMPLETE", "PROCESSOR_DEFERRED"],
  delivery_entitlement: ["ENTITLED", "WITHHELD"],
  correction_revision: ["NONE", "QUICK_EDIT", "NEEDS_REVIEW"],
  quick_edit: ["NONE", "ACTIONABLE"],
  multi_order_day: ["SINGLE_ORDER", "MULTIPLE_ORDERS"],
  source_conflict: ["NONE", "CONFLICT"],
  data_quality: ["CLEAR", "AMBIGUOUS"],
  intentional_policy_change: ["NONE", "PRESENT"],
  deferred_capability: ["NONE", "PROCESSOR_SETTLEMENT"],
};

export interface CoverageCellV1 {
  dimension: CoverageDimension;
  case: string;
  representedBy: string[];
  platformExecutedBy: string[];
  classifierOnlyBy: string[];
  deferredNotExecutedBy: string[];
  represented: boolean;
  duplicateCoverage: boolean;
}

export interface BusinessScenarioCoverageMatrixV1 {
  schema: "ML_BUSINESS_REPLAY_V1";
  contract: "BusinessScenarioCoverageMatrixV1";
  dimensions: readonly CoverageDimension[];
  cells: CoverageCellV1[];
  representedCases: number;
  unrepresentedCases: { dimension: CoverageDimension; case: string }[];
  duplicateCases: { dimension: CoverageDimension; case: string }[];
  minimumRepresentedSet: { algorithm: "DETERMINISTIC_GREEDY_REPRESENTED_SET"; globalOptimalityClaimed: false; scenarioIds: string[] };
  planningTargets: { minimumViableScenarioClasses: 18; higherConfidenceScenarios: 32; authorityStatement: string };
}

function modeList(scenarios: readonly BusinessReplayScenarioV1[], ids: readonly string[], mode: ExecutionMode): string[] {
  return ids.filter((id) => scenarios.find((scenario) => scenario.scenarioId === id)?.executionMode === mode);
}

export function calculateCoverage(scenarios: readonly BusinessReplayScenarioV1[]): BusinessScenarioCoverageMatrixV1 {
  const sorted = [...scenarios].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
  const cells: CoverageCellV1[] = [];
  for (const dimension of COVERAGE_DIMENSIONS) {
    for (const caseName of COVERAGE_CASE_CATALOG[dimension]) {
      const representedBy = sorted.filter((scenario) => scenario.coverage.some((tag) => tag.dimension === dimension && tag.case === caseName)).map((scenario) => scenario.scenarioId);
      cells.push({ dimension, case: caseName, representedBy,
        platformExecutedBy: modeList(sorted, representedBy, "PLATFORM_EXECUTED"),
        classifierOnlyBy: modeList(sorted, representedBy, "CLASSIFIER_ONLY"),
        deferredNotExecutedBy: modeList(sorted, representedBy, "DEFERRED_NOT_EXECUTED"),
        represented: representedBy.length > 0, duplicateCoverage: representedBy.length > 1 });
    }
  }
  const represented = cells.filter((cell) => cell.represented);
  const remaining = new Set(represented.map((cell) => `${cell.dimension}:${cell.case}`));
  const selected: string[] = [];
  while (remaining.size > 0) {
    const ranked = sorted.map((scenario) => ({ scenario, gain: scenario.coverage.filter((tag) => remaining.has(`${tag.dimension}:${tag.case}`)).length }))
      .filter((entry) => entry.gain > 0).sort((a, b) => b.gain - a.gain || a.scenario.scenarioId.localeCompare(b.scenario.scenarioId));
    if (!ranked[0]) break;
    selected.push(ranked[0].scenario.scenarioId);
    for (const tag of ranked[0].scenario.coverage) remaining.delete(`${tag.dimension}:${tag.case}`);
  }
  return { schema: "ML_BUSINESS_REPLAY_V1", contract: "BusinessScenarioCoverageMatrixV1", dimensions: COVERAGE_DIMENSIONS, cells,
    representedCases: represented.length,
    unrepresentedCases: cells.filter((cell) => !cell.represented).map(({ dimension, case: caseName }) => ({ dimension, case: caseName })),
    duplicateCases: cells.filter((cell) => cell.duplicateCoverage).map(({ dimension, case: caseName }) => ({ dimension, case: caseName })),
    minimumRepresentedSet: { algorithm: "DETERMINISTIC_GREEDY_REPRESENTED_SET", globalOptimalityClaimed: false, scenarioIds: selected },
    planningTargets: { minimumViableScenarioClasses: 18, higherConfidenceScenarios: 32,
      authorityStatement: "Planning guides only; they do not authorize arbitrary historical selection or any historical-data access." } };
}

export function tag(dimension: CoverageDimension, caseName: string): CoverageTagV1 {
  if (!COVERAGE_CASE_CATALOG[dimension].includes(caseName)) throw new Error(`unknown coverage case ${dimension}:${caseName}`);
  return { dimension, case: caseName };
}

