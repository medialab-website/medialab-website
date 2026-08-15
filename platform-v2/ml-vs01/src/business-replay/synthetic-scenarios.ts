import { BUSINESS_REPLAY_SCHEMA, expected, observed, type BusinessReplayObservedOutcomeV1, type BusinessReplayScenarioV1,
  type ExecutionMode, type MismatchClassification, type ObservationSource } from "./contracts.js";
import { tag, type CoverageDimension } from "./coverage.js";
import { syntheticEvidence } from "./evidence.js";

type TagSpec = readonly [CoverageDimension, string];
interface Spec { id: string; description: string; mode?: ExecutionMode; tags: readonly TagSpec[]; classification?: Exclude<MismatchClassification, "MATCH">; source?: ObservationSource }

const BASE: readonly TagSpec[] = [
  ["customer_type", "INDEPENDENT_AGENT"], ["customer_tenure", "REPEAT"], ["organization_structure", "INDIVIDUAL"],
  ["organization_membership", "NONE"], ["billing_model", "PERSONAL"], ["billing_authority", "AUTHORIZED"],
  ["commercial_ownership", "PERSON"], ["appointment_complexity", "SINGLE"], ["cancellation_condition", "NONE"],
  ["travel_condition", "LOCAL"], ["source_conflict", "NONE"], ["data_quality", "CLEAR"],
  ["intentional_policy_change", "NONE"], ["deferred_capability", "NONE"], ["multi_order_day", "SINGLE_ORDER"],
] as const;

const specs: readonly Spec[] = [
  { id: "M16B_PLATFORM_BASELINE_QUICK_EDIT_V1", description: "R71 complete synthetic Quick Edit operating cycle", mode: "PLATFORM_EXECUTED",
    tags: [["package_family","PHOTO_ONLY"],["service_workstream_family","PHOTO"],["addon_family","NONE"],["pricing_tier","BELOW_BOUNDARY"],["scope_timing","PRE_PUBLICATION"],["reschedule_condition","NONE"],["payment_evidence","BOUNDED_ELIGIBLE"],["delivery_entitlement","ENTITLED"],["correction_revision","QUICK_EDIT"],["quick_edit","ACTIONABLE"]] },
  { id: "M16B_PLATFORM_NEEDS_REVIEW_V1", description: "R71 corrected-media successor remains Needs Review with no final designation", mode: "PLATFORM_EXECUTED",
    tags: [["package_family","PHOTO_ONLY"],["service_workstream_family","PHOTO"],["addon_family","NONE"],["pricing_tier","BELOW_BOUNDARY"],["scope_timing","PRE_PUBLICATION"],["reschedule_condition","NONE"],["payment_evidence","BOUNDED_ELIGIBLE"],["delivery_entitlement","WITHHELD"],["correction_revision","NEEDS_REVIEW"],["quick_edit","ACTIONABLE"]] },
  { id: "M16B_PLATFORM_RESCHEDULE_V1", description: "R71 superseded appointment and confirmed replacement preserve immutable evidence", mode: "PLATFORM_EXECUTED",
    tags: [["package_family","PHOTO_ONLY"],["service_workstream_family","PHOTO"],["addon_family","NONE"],["pricing_tier","BELOW_BOUNDARY"],["scope_timing","PRE_PUBLICATION"],["reschedule_condition","SUPERSEDED_AND_REPLACED"],["payment_evidence","BOUNDED_ELIGIBLE"],["delivery_entitlement","ENTITLED"],["correction_revision","NONE"],["quick_edit","NONE"]] },
  { id: "M16B_INDEPENDENT_AGENT_PHOTO_ONLY_V1", description: "Independent agent, photo-only, normal local appointment", tags: [["package_family","PHOTO_ONLY"],["service_workstream_family","PHOTO"],["addon_family","NONE"],["pricing_tier","BELOW_BOUNDARY"],["scope_timing","PRE_PUBLICATION"],["reschedule_condition","NONE"],["payment_evidence","BOUNDED_ELIGIBLE"],["delivery_entitlement","ENTITLED"],["correction_revision","NONE"],["quick_edit","NONE"]] },
  { id: "M16B_AGENCY_MEMBER_PERSONAL_PAY_V1", description: "Agency member pays personally", tags: [["customer_type","AGENCY_MEMBER"],["organization_structure","AGENCY"],["organization_membership","ACTIVE_MEMBER"],["billing_model","PERSONAL"],["commercial_ownership","PERSON"],["package_family","PHOTO_ONLY"]] },
  { id: "M16B_ORGANIZATION_FUNDED_V1", description: "Organization-funded synthetic order", tags: [["customer_type","ORGANIZATION"],["organization_structure","FUNDED_ORGANIZATION"],["organization_membership","ACTIVE_MEMBER"],["billing_model","ORGANIZATION_FUNDED"],["commercial_ownership","ORGANIZATION"]] },
  { id: "M16B_ORGANIZATION_PAYMENT_UNAUTHORIZED_V1", description: "Organization payment rejected without required authority", tags: [["customer_type","ORGANIZATION"],["organization_structure","FUNDED_ORGANIZATION"],["organization_membership","ACTIVE_MEMBER"],["billing_model","ORGANIZATION_FUNDED"],["billing_authority","MISSING_REQUIRED_AUTHORITY"],["delivery_entitlement","WITHHELD"]] },
  { id: "M16B_PRICING_BELOW_BOUNDARY_V1", description: "Below pricing-tier boundary", tags: [["pricing_tier","BELOW_BOUNDARY"],["package_family","PHOTO_ONLY"]] },
  { id: "M16B_PRICING_AT_ABOVE_BOUNDARY_V1", description: "At or above pricing-tier boundary", tags: [["pricing_tier","AT_OR_ABOVE_BOUNDARY"],["package_family","PHOTO_ONLY"]] },
  { id: "M16B_PHOTO_DRONE_V1", description: "Photo plus drone", tags: [["package_family","PHOTO_DRONE"],["service_workstream_family","PHOTO"],["service_workstream_family","DRONE"],["addon_family","DRONE"]] },
  { id: "M16B_PHOTO_VIDEO_V1", description: "Photo plus video", tags: [["package_family","PHOTO_VIDEO"],["service_workstream_family","PHOTO"],["service_workstream_family","VIDEO"]] },
  { id: "M16B_FLOOR_PLAN_COMBINATION_V1", description: "Photo and floor-plan combination", tags: [["package_family","PHOTO_ONLY"],["service_workstream_family","PHOTO"],["service_workstream_family","FLOOR_PLAN"],["addon_family","FLOOR_PLAN"]] },
  { id: "M16B_LAND_ACREAGE_V1", description: "Land and acreage package", tags: [["package_family","LAND_ACREAGE"],["service_workstream_family","PHOTO"],["pricing_tier","AT_OR_ABOVE_BOUNDARY"]] },
  { id: "M16B_RURAL_TRAVEL_V1", description: "Rural travel condition", tags: [["travel_condition","RURAL_TRAVEL"],["package_family","PHOTO_ONLY"]] },
  { id: "M16B_RESCHEDULE_COVERAGE_V1", description: "Classifier coverage for rescheduled appointment", tags: [["reschedule_condition","SUPERSEDED_AND_REPLACED"],["appointment_complexity","MULTIPLE"]] },
  { id: "M16B_CANCELLATION_UNABLE_V1", description: "Cancellation or unable-to-complete outcome", tags: [["cancellation_condition","CANCELLED_OR_UNABLE"],["delivery_entitlement","WITHHELD"]] },
  { id: "M16B_MULTIPLE_APPOINTMENTS_V1", description: "Multiple appointments", tags: [["appointment_complexity","MULTIPLE"],["multi_order_day","MULTIPLE_ORDERS"]] },
  { id: "M16B_ADDON_PRE_PUBLICATION_V1", description: "Add-on before first publication", tags: [["scope_timing","PRE_PUBLICATION"],["addon_family","DRONE"]] },
  { id: "M16B_LATER_SCOPE_SEPARATE_V1", description: "Later scope after publication remains separate", tags: [["scope_timing","POST_PUBLICATION_SEPARATE"],["addon_family","LATER_SCOPE"]] },
  { id: "M16B_UNPAID_ENTITLEMENT_V1", description: "Incomplete payment evidence withholds entitlement", tags: [["payment_evidence","INCOMPLETE"],["delivery_entitlement","WITHHELD"]] },
  { id: "M16B_QUICK_EDIT_COVERAGE_V1", description: "Quick Edit correction classifier", tags: [["correction_revision","QUICK_EDIT"],["quick_edit","ACTIONABLE"]] },
  { id: "M16B_NEEDS_REVIEW_COVERAGE_V1", description: "Needs Review correction classifier", tags: [["correction_revision","NEEDS_REVIEW"],["quick_edit","NONE"]] },
  { id: "M16B_SOURCE_CONFLICT_V1", description: "Conflicting synthetic evidence claims", classification: "SOURCE_CONFLICT", tags: [["source_conflict","CONFLICT"]] },
  { id: "M16B_AMBIGUOUS_EVIDENCE_V1", description: "Ambiguous synthetic evidence", classification: "AMBIGUOUS_EVIDENCE", tags: [["data_quality","AMBIGUOUS"]] },
  { id: "M16B_INTENTIONAL_POLICY_CHANGE_V1", description: "Intentional current-policy difference", classification: "INTENTIONAL_POLICY_CHANGE", tags: [["intentional_policy_change","PRESENT"]] },
  { id: "M16B_DEFERRED_PROCESSOR_SETTLEMENT_V1", description: "Processor settlement is explicitly deferred", mode: "DEFERRED_NOT_EXECUTED", classification: "DEFERRED_CAPABILITY", source: "DEFERRED", tags: [["deferred_capability","PROCESSOR_SETTLEMENT"],["payment_evidence","PROCESSOR_DEFERRED"]] },
  { id: "M16B_IMPLEMENTATION_GAP_CLASSIFIER_V1", description: "Implementation-gap classifier fixture", classification: "IMPLEMENTATION_GAP", tags: [["customer_tenure","NEW"]] },
  { id: "M16B_CANONICAL_SCHEMA_GAP_CLASSIFIER_V1", description: "Canonical-schema-gap classifier fixture", classification: "CANONICAL_SCHEMA_GAP", tags: [["customer_tenure","NEW"]] },
  { id: "M16B_HARNESS_ERROR_CLASSIFIER_V1", description: "Harness-error classifier fixture", classification: "HARNESS_ERROR", tags: [["customer_tenure","NEW"]] },
] as const;

function platformExpected(id: string) {
  if (id === "M16B_PLATFORM_BASELINE_QUICK_EDIT_V1") return expected([
    { field: "comparisonPass", expected: true, reason: "Accepted M16-A replay comparison remains green" },
    { field: "originals", expected: 6, reason: "Six deterministic originals" },
    { field: "selected", expected: 5, reason: "Five selected media" },
    { field: "finalVersions", expected: 5, reason: "Five final versions" },
    { field: "exactDownloads", expected: 2, reason: "Two exact local downloads sampled" },
  ]);
  if (id === "M16B_PLATFORM_NEEDS_REVIEW_V1") return expected([
    { field: "unresolved", expected: 1, reason: "Corrected successor remains unresolved" },
    { field: "finalDesignationCreatedByNeedsReview", expected: false, reason: "Needs Review cannot create final designation" },
  ]);
  return expected([
    { field: "originalState", expected: "SUPERSEDED", reason: "Original appointment is append-only superseded evidence" },
    { field: "replacementState", expected: "CONFIRMED", reason: "Replacement appointment is current confirmed state" },
    { field: "originalStartsAt", expected: "2026-10-20T14:00:00.000Z", reason: "Original time remains immutable" },
    { field: "replacementStartsAt", expected: "2026-10-22T15:00:00.000Z", reason: "Replacement uses explicit synthetic clock" },
    { field: "supersessionEvidence", expected: true, reason: "Original evidence names its replacement" },
  ]);
}

function classifierObserved(classification: Exclude<MismatchClassification, "MATCH"> | undefined, source: ObservationSource): BusinessReplayObservedOutcomeV1 {
  return observed([{ field: "outcome", value: classification ? `SYNTHETIC_OBSERVED_${classification}` : "CURRENT_POLICY", source }]);
}

function build(spec: Spec): BusinessReplayScenarioV1 {
  const mode = spec.mode ?? "CLASSIFIER_ONLY";
  const classification = spec.classification;
  const allTags = [...BASE, ...spec.tags].map(([dimension, caseName]) => tag(dimension, caseName));
  const uniqueTags = [...new Map(allTags.map((item) => [`${item.dimension}:${item.case}`, item])).values()];
  return {
    schema: BUSINESS_REPLAY_SCHEMA, contract: "BusinessReplayScenarioV1", scenarioId: spec.id, scenarioVersion: 1,
    lane: "REAL_ESTATE_MEDIA", provenanceClassification: "SYNTHETIC_FIXTURE", policyBaseline: "R71",
    syntheticReferenceDate: "2026-08-14T12:00:00.000Z", fixtureNamespace: `M16B_SYNTHETIC_${spec.id}`, description: spec.description,
    scenarioTags: uniqueTags.map((item) => `${item.dimension}:${item.case}`).sort(), executionMode: mode,
    evidence: [syntheticEvidence(classification === "SOURCE_CONFLICT" ? "ARYEO" : "R71_POLICY", spec.id, ["synthetic scenario facts"],
      { ambiguityOrConflict: classification === "SOURCE_CONFLICT" || classification === "AMBIGUOUS_EVIDENCE", evidenceConfidence: classification === "AMBIGUOUS_EVIDENCE" ? "LOW" : "HIGH" })],
    actorsAndAuthority: { identity: "SYNTHETIC_PERSON", expectedCurrentAuthority: "BOUNDED_SCENARIO_AUTHORITY" },
    commercialFacts: { currency: "USD", syntheticAcceptedPriceMinor: 25000 },
    schedulingAndOperations: { referenceClock: "2026-08-14T12:00:00.000Z", networkRetrievalIntent: false },
    financialAndDeliveryFacts: { processorSettlement: "NOT_CLAIMED", currentBoundedEligibility: true },
    historicallyObservedOutcome: { status: "SYNTHETIC_NOT_APPLICABLE", fields: [] },
    currentIntendedPolicyOutcome: { outcome: "CURRENT_POLICY" },
    expectedR71Outcome: mode === "PLATFORM_EXECUTED" ? platformExpected(spec.id) : expected([{ field: "outcome", expected: "CURRENT_POLICY",
      mismatchClassification: classification, reason: classification ? `Synthetic positive fixture for ${classification}` : "Synthetic policy match" }]),
    syntheticObservedOutcome: mode === "PLATFORM_EXECUTED" ? undefined : classifierObserved(classification, spec.source ?? (mode === "DEFERRED_NOT_EXECUTED" ? "DEFERRED" : "HARNESS_OBSERVED")),
    intentionalDifferences: classification === "INTENTIONAL_POLICY_CHANGE" ? ["Synthetic earlier behavior differs from R71 policy"] : [],
    ambiguities: classification === "AMBIGUOUS_EVIDENCE" ? ["Synthetic claims do not determine one outcome"] : [], coverage: uniqueTags,
  };
}

export const SYNTHETIC_SCENARIOS: readonly BusinessReplayScenarioV1[] = specs.map(build).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
export const PLATFORM_SCENARIO_IDS = SYNTHETIC_SCENARIOS.filter((scenario) => scenario.executionMode === "PLATFORM_EXECUTED").map((scenario) => scenario.scenarioId);

if (SYNTHETIC_SCENARIOS.length < 26 || PLATFORM_SCENARIO_IDS.length < 3) throw new Error("synthetic scenario library is incomplete");

