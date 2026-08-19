export interface CustomerPersonIntakeV1 {
  idempotencyKey: string;
  organizationId: string;
  sourceSystem: string;
  sourceScope: string | null;
  externalRecordType: string | null;
  externalIdentifier: string | null;
  sourceEvidenceFingerprint: string;
  displayName: string;
  email: string | null;
}

export interface CustomerPersonIntakeResultV1 {
  outcome: "CREATED" | "REUSED" | "AMBIGUOUS";
  identity_basis: "EMAIL" | "EXTERNAL_REFERENCE" | "INSUFFICIENT_EVIDENCE";
  person_id: string | null;
  membership_id: string | null;
  membership_status: string | null;
  membership_outcome?: "CREATED" | "REUSED";
  external_reference_outcome: "CREATED" | "REUSED" | "NOT_APPLICABLE";
  source_evidence_fingerprint?: string;
}

export interface PropertySnapshotIntakeV1 {
  idempotencyKey: string;
  organizationId: string;
  sourceSystem: string;
  sourceEvidenceFingerprint: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  administrativeArea: string;
  postalCode: string;
  countryCode: string;
  reportedSquareFeet: number | null;
}

export interface PropertySnapshotIntakeResultV1 {
  property_id: string;
  property_snapshot_id: string;
  property_outcome: "PROPERTY_CREATED" | "PROPERTY_REUSED";
  snapshot_outcome: "SNAPSHOT_CREATED" | "SNAPSHOT_REUSED";
  source_evidence_fingerprint: string;
}

export interface PrivateCurrentEraIntakeV1 {
  customer: Omit<CustomerPersonIntakeV1, "idempotencyKey" | "organizationId">;
  property: Omit<PropertySnapshotIntakeV1, "idempotencyKey" | "organizationId"> | null;
  propertyEvidenceStatus: "COMPLETE_EXACT_US_POSTAL_TUPLE" | "INCOMPLETE_ADDRESS_EVIDENCE";
}
