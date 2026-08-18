import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { scanHistoricalPrivacyArtifact, scanHistoricalPrivacyArtifacts } from "../historical-replay/privacy.js";

export interface CurrentShadowPrivacyProofV1 {
  schema: "ML_CURRENT_ERA_SHADOW_V1";
  contract: "CurrentShadowPrivacyProofV1";
  status: "PASS";
  checks: {
    directEmailAbsent: true;
    phoneAbsent: true;
    externalPathAbsent: true;
    credentialMaterialAbsent: true;
    rawExternalRecordKeyAbsent: true;
    transactionValuesAbsent: true;
    frozenSourceIdentityUnchanged: true;
    rawUploads: 0;
    networkCalls: 0;
    liveSystemMutations: 0;
  };
  scannedArtifactCount: number;
  sourceArtifactHash: string;
}

export async function buildCurrentShadowPrivacyProof(
  outputRoot: string, sourcePath: string, expectedSourceHash: string,
): Promise<CurrentShadowPrivacyProofV1> {
  const sourceArtifactHash = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
  if (sourceArtifactHash !== expectedSourceHash) {
    throw new Error("CURRENT_SHADOW_PRIVACY_BOUNDARY_FAILURE: frozen source bytes changed during the bounded run");
  }
  const scan = await scanHistoricalPrivacyArtifacts(outputRoot);
  if (scan.hits.length || Object.values(scan.checks).some((value) => value !== true)) {
    throw new Error(`CURRENT_SHADOW_PRIVACY_BOUNDARY_FAILURE: ${scan.hits.length} sanitized-artifact scan hits`);
  }
  return {
    schema: "ML_CURRENT_ERA_SHADOW_V1", contract: "CurrentShadowPrivacyProofV1", status: "PASS",
    checks: { directEmailAbsent: true, phoneAbsent: true, externalPathAbsent: true,
      credentialMaterialAbsent: true, rawExternalRecordKeyAbsent: true, transactionValuesAbsent: true,
      frozenSourceIdentityUnchanged: true, rawUploads: 0, networkCalls: 0, liveSystemMutations: 0 },
    scannedArtifactCount: scan.scannedArtifactCount, sourceArtifactHash,
  };
}

export function assertCurrentShadowPrivacyProofSelfSafe(relativePath: string, content: string): void {
  const scan = scanHistoricalPrivacyArtifact(relativePath, content);
  if (scan.hits.length) throw new Error("CURRENT_SHADOW_PRIVACY_BOUNDARY_FAILURE: privacy proof is not self-safe");
}
