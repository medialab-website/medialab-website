import type { SourceEvidenceReferenceV1 } from "./contracts.js";
import { semanticSha256 } from "./deterministic-ids.js";

export const SYNTHETIC_EVIDENCE_ROLES = ["ARYEO", "STRIPE", "QUICKBOOKS", "HONEYBOOK", "DRIVE", "LEGACY_OPERATIONAL_RECORD", "R71_POLICY"] as const;

export function syntheticEvidence(sourceSystemType: SourceEvidenceReferenceV1["sourceSystemType"], scenarioId: string,
  fieldClaims: readonly string[], options: { ambiguityOrConflict?: boolean; evidenceConfidence?: "HIGH" | "MEDIUM" | "LOW" } = {}): SourceEvidenceReferenceV1 {
  return {
    sourceSystemType,
    sourceRecordType: "SYNTHETIC_BUSINESS_EVIDENCE",
    opaqueSourceReferenceHash: semanticSha256({ scenarioId, sourceSystemType, role: "SYNTHETIC_EVIDENCE_ONLY" }),
    sourceArtifactHash: semanticSha256({ scenarioId, fieldClaims }),
    observedAt: "2026-08-14T12:00:00.000Z",
    evidenceConfidence: options.evidenceConfidence ?? "HIGH",
    ambiguityOrConflict: options.ambiguityOrConflict ?? false,
    syntheticEvidenceRoleLabel: true,
    fieldClaims: [...fieldClaims],
  };
}

