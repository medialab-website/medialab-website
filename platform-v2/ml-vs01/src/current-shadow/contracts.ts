export const CURRENT_SHADOW_SCHEMA = "ML_CURRENT_ERA_SHADOW_V1" as const;

export type ShadowClassification = "MATCH" | "INTENTIONAL_POLICY_CHANGE" | "SOURCE_CONFLICT" |
  "AMBIGUOUS_EVIDENCE" | "DEFERRED_CAPABILITY" | "IMPLEMENTATION_GAP" |
  "CANONICAL_SCHEMA_GAP" | "HARNESS_ERROR";

export type MarketStatusEvidence = "MARKET_STATUS_CONFIRMED" | "MARKET_STATUS_NOT_AVAILABLE" | "MARKET_STATUS_AMBIGUOUS";

export interface CurrentEraShapeV1 {
  orderLineCardinality: number;
  appointmentCardinality: number;
  paymentEvidenceCardinality: number;
  teamAssociationPresent: boolean;
  orderFormAssociationPresent: boolean;
  serviceFamilies: readonly string[];
  shapeTokens: readonly string[];
}

export interface CurrentEraNormalizedListingV1 {
  schema: typeof CURRENT_SHADOW_SCHEMA;
  contract: "CurrentEraNormalizedListingV1";
  scenarioId: string;
  stableSourceRow: number;
  opaqueSourceReferenceHash: string;
  shape: CurrentEraShapeV1;
  marketStatusEvidence: MarketStatusEvidence;
}

export interface CurrentEraSourceProfileV1 {
  schema: typeof CURRENT_SHADOW_SCHEMA;
  contract: "CurrentEraSourceProfileV1";
  sourceArtifactName: string;
  sourceArtifactHash: string;
  sourceArtifactByteSize: number;
  sourceRole: "LOCAL_READ_ONLY_FROZEN_SUPERSET";
  providerTimezoneContext: "America/New_York";
  worksheets: readonly { worksheetRole: string; rawRowCount: number }[];
  cutoffDateInclusive: "2026-03-27";
  reviewedSnapshotHorizonInclusive: "2026-08-02";
  postCutoffWithinHorizonRowCount: number;
  cohortMemberCount: 42;
  excludedStatusShapeCount: number;
  identityVerified: true;
  privacyStatement: string;
}

export interface CurrentEraCohortIdentityProofV1 {
  schema: typeof CURRENT_SHADOW_SCHEMA;
  contract: "CurrentEraCohortIdentityProofV1";
  sourceArtifactHash: string;
  selectionLaw: string;
  cutoffDecision: "ML-D059";
  exactCohortDecision: "ML-D302";
  cohortMemberCount: 42;
  membership: readonly { scenarioId: string; opaqueSourceReferenceHash: string }[];
  rejectedWithinHorizonShapeCounts: Readonly<Record<string, number>>;
  rawIdentifiersIncluded: false;
  forcedMatches: 0;
}

export interface CurrentEraPilotSelectionReceiptV1 {
  schema: typeof CURRENT_SHADOW_SCHEMA;
  contract: "CurrentEraPilotSelectionReceiptV1";
  method: "GREEDY_MAX_NEW_SHAPE_TOKENS_STABLE_SOURCE_ROW_TIEBREAK";
  selectedBeforeOutcomeObservation: true;
  pilotSize: 6;
  selected: readonly { scenarioId: string; stableSourceRow: number; newShapeTokens: readonly string[]; shape: CurrentEraShapeV1 }[];
}

export interface CurrentEraReconstructionReceiptV1 {
  schema: typeof CURRENT_SHADOW_SCHEMA;
  contract: "CurrentEraReconstructionReceiptV1";
  scenarioId: string;
  stage: "PILOT" | "FULL_COHORT";
  platformBackedAttempted: true;
  platformCommands: readonly { command: string; status: "ACCEPTED" | "REJECTED" }[];
  orderCreated: boolean;
  orderReadBack: boolean;
  sourceLineCardinalityRepresented: boolean;
  financialEligibilityMeaningRepresented: boolean;
  syntheticFixtureIdentityUsed: true;
  uniqueCustomerIdentityRepresented: false;
  uniquePropertySnapshotRepresented: false;
  propertyHubCreated: false;
  marketStatusEvidence: MarketStatusEvidence;
  classification: ShadowClassification;
  findingCodes: readonly string[];
  completeReconstruction: boolean;
}

export interface CurrentEraRepresentabilityMatrixV1 {
  schema: typeof CURRENT_SHADOW_SCHEMA;
  contract: "CurrentEraRepresentabilityMatrixV1";
  cohortSize: 42;
  concepts: readonly {
    concept: string;
    representedCount: number;
    notRepresentedCount: number;
    classification: ShadowClassification | "NOT_AVAILABLE";
    reason: string;
  }[];
}

export interface CurrentEraRunResultV1 {
  sourceProfile: CurrentEraSourceProfileV1;
  identityProof: CurrentEraCohortIdentityProofV1;
  listings: readonly CurrentEraNormalizedListingV1[];
  pilot: CurrentEraPilotSelectionReceiptV1;
  receipts: readonly CurrentEraReconstructionReceiptV1[];
  semanticResultSha256: string;
}
