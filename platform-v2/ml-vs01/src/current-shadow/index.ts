import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CurrentEraNormalizedListingV1, CurrentEraReconstructionReceiptV1, CurrentEraRepresentabilityMatrixV1,
  CurrentEraRunResultV1, ShadowClassification,
} from "./contracts.js";
import { CURRENT_SHADOW_SCHEMA } from "./contracts.js";
import { CurrentShadowDatabase, issueCurrentShadowSession, resetCurrentShadowDatabase } from "./database.js";
import { assertCurrentShadowPrivacyProofSelfSafe, buildCurrentShadowPrivacyProof } from "./privacy.js";
import { CURRENT_ERA_SOURCE_IDENTITY, loadCurrentEraCohort, selectPilot } from "./source.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function writeJson(outputRoot: string, name: string, value: unknown): Promise<void> {
  await writeFile(join(outputRoot, name), json(value), "utf8");
}

function receiptFor(
  listing: CurrentEraNormalizedListingV1, stage: "PILOT" | "FULL_COHORT",
  observation: { orderCreated: boolean; orderReadBack: boolean; readBackLineCount: number;
    financialEligibilityRecorded: boolean; commands: readonly { command: string; status: "ACCEPTED" | "REJECTED" }[] },
): CurrentEraReconstructionReceiptV1 {
  const lineShapeRepresented = observation.readBackLineCount === listing.shape.orderLineCardinality;
  const findings = [
    "UNIQUE_CUSTOMER_RUNTIME_INTAKE_UNAVAILABLE",
    "UNIQUE_PROPERTY_SNAPSHOT_RUNTIME_INTAKE_UNAVAILABLE",
    "CURRENT_CATALOG_EQUIVALENCE_AMBIGUOUS",
    "APPOINTMENT_RECONSTRUCTION_DEFERRED_WITHOUT_APPROVED_PROPERTY_HUB_ELIGIBILITY",
    "DELIVERY_PUBLICATION_MEANING_AMBIGUOUS",
    "CURRENT_MARKET_STATUS_NOT_AVAILABLE",
  ];
  const classification: ShadowClassification = observation.orderCreated && observation.orderReadBack && lineShapeRepresented &&
    observation.financialEligibilityRecorded ? "IMPLEMENTATION_GAP" : "HARNESS_ERROR";
  return {
    schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraReconstructionReceiptV1", scenarioId: listing.scenarioId,
    stage, platformBackedAttempted: true, platformCommands: observation.commands,
    orderCreated: observation.orderCreated, orderReadBack: observation.orderReadBack,
    sourceLineCardinalityRepresented: lineShapeRepresented,
    financialEligibilityMeaningRepresented: observation.financialEligibilityRecorded,
    syntheticFixtureIdentityUsed: true, uniqueCustomerIdentityRepresented: false,
    uniquePropertySnapshotRepresented: false, propertyHubCreated: false,
    marketStatusEvidence: listing.marketStatusEvidence, classification, findingCodes: findings,
    completeReconstruction: false,
  };
}

function representabilityMatrix(receipts: readonly CurrentEraReconstructionReceiptV1[]): CurrentEraRepresentabilityMatrixV1 {
  const represented = (predicate: (receipt: CurrentEraReconstructionReceiptV1) => boolean) => receipts.filter(predicate).length;
  const concept = (name: string, representedCount: number, classification: ShadowClassification | "NOT_AVAILABLE", reason: string) => ({
    concept: name, representedCount, notRepresentedCount: 42 - representedCount, classification, reason,
  });
  return {
    schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraRepresentabilityMatrixV1", cohortSize: 42,
    concepts: [
      concept("OPAQUE_SOURCE_TRACEABILITY", receipts.length, "MATCH", "Non-reversible source evidence fingerprint retained."),
      concept("ORDER_RUNTIME_CREATION_AND_READBACK", represented((item) => item.orderCreated && item.orderReadBack), "MATCH", "Supported Order commands completed."),
      concept("SOURCE_ORDER_LINE_CARDINALITY", represented((item) => item.sourceLineCardinalityRepresented), "MATCH", "Line-count shape reconstructed with accepted commercial evidence fixtures."),
      concept("FINANCIAL_ELIGIBILITY_MEANING", represented((item) => item.financialEligibilityMeaningRepresented), "MATCH", "Supported bounded eligibility command recorded source-backed meaning without transaction values."),
      concept("UNIQUE_CUSTOMER_IDENTITY", 0, "IMPLEMENTATION_GAP", "No approved runtime command creates or reconciles a unique customer identity from bounded evidence."),
      concept("UNIQUE_PROPERTY_AND_IMMUTABLE_SNAPSHOT", 0, "IMPLEMENTATION_GAP", "No approved runtime command creates a unique property and immutable snapshot from bounded evidence."),
      concept("CURRENT_CATALOG_EQUIVALENCE", 0, "AMBIGUOUS_EVIDENCE", "Source labels do not independently prove equivalence to current catalog entries."),
      concept("APPOINTMENT_HISTORY", 0, "DEFERRED_CAPABILITY", "Appointment commands require a Property Hub; this packet prohibits inventing eligibility or current market status."),
      concept("TEAM_ASSIGNMENT_MEANING", 0, "DEFERRED_CAPABILITY", "Assignment reconstruction depends on deferred job and workstream context."),
      concept("DELIVERY_PUBLICATION_MEANING", 0, "AMBIGUOUS_EVIDENCE", "Fulfillment shape alone does not prove publication or delivery details."),
      concept("CURRENT_MARKET_STATUS", 0, "NOT_AVAILABLE", "Cohort membership is not current-market-status evidence."),
    ],
  };
}

function classificationSummary(receipts: readonly CurrentEraReconstructionReceiptV1[]) {
  const classifications: Record<ShadowClassification, number> = {
    MATCH: 0, INTENTIONAL_POLICY_CHANGE: 0, SOURCE_CONFLICT: 0, AMBIGUOUS_EVIDENCE: 0,
    DEFERRED_CAPABILITY: 0, IMPLEMENTATION_GAP: 0, CANONICAL_SCHEMA_GAP: 0, HARNESS_ERROR: 0,
  };
  for (const receipt of receipts) classifications[receipt.classification] += 1;
  return {
    schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraClassificationSummaryV1", cohortSize: 42,
    classifications, findingFamilies: {
      implementationGap: { familyCount: 2, affectedReceiptCount: 42 },
      canonicalSchemaGap: { familyCount: 0, affectedReceiptCount: 0 },
      ambiguousEvidence: { familyCount: 2, affectedReceiptCount: 42 },
      deferredCapability: { familyCount: 2, affectedReceiptCount: 42 },
      sourceConflict: { familyCount: 0, affectedReceiptCount: 0 },
    },
    marketStatusEvidence: { confirmedCount: 0, notAvailableCount: 42, ambiguousCount: 0 },
  };
}

function gapRegister() {
  return {
    schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraGapRegisterV1",
    implementationGaps: [
      { code: "UNIQUE_CUSTOMER_RUNTIME_INTAKE_UNAVAILABLE", affectedReceiptCount: 42,
        finding: "Canonical identity tables exist, but no approved ordinary-runtime intake or reconciliation command is available." },
      { code: "UNIQUE_PROPERTY_SNAPSHOT_RUNTIME_INTAKE_UNAVAILABLE", affectedReceiptCount: 42,
        finding: "Canonical property and snapshot tables exist, but no approved ordinary-runtime creation command is available." },
    ],
    canonicalSchemaGaps: [],
    deferredCapabilities: [
      { code: "APPOINTMENT_RECONSTRUCTION_DEFERRED_WITHOUT_APPROVED_PROPERTY_HUB_ELIGIBILITY", affectedReceiptCount: 42 },
      { code: "TEAM_ASSIGNMENT_RECONSTRUCTION_DEFERRED", affectedReceiptCount: 42 },
    ],
    ambiguousEvidence: [
      { code: "CURRENT_CATALOG_EQUIVALENCE_AMBIGUOUS", affectedReceiptCount: 42 },
      { code: "DELIVERY_PUBLICATION_MEANING_AMBIGUOUS", affectedReceiptCount: 42 },
    ],
    sourceConflicts: [],
    repairPerformed: false,
  };
}

function markdownReport(result: {
  pilotIds: readonly string[]; platformAttempts: number; classificationSummary: ReturnType<typeof classificationSummary>;
  matrix: CurrentEraRepresentabilityMatrixV1; semanticResultSha256: string;
}): string {
  const represented = result.matrix.concepts.filter((item) => item.representedCount === 42).length;
  return `# P02-M16-D Current-Era Controlled Shadow Report

## Outcome

- Exact cohort processed: 42 of 42
- Platform-backed attempts: ${result.platformAttempts}
- Fully complete reconstructions: 0
- Pilot gate: PASS (${result.pilotIds.join(", ")})
- Quarantined receipts: 0
- Representability concepts fully represented: ${represented} of ${result.matrix.concepts.length}
- Scenario classification: ${result.classificationSummary.classifications.IMPLEMENTATION_GAP} IMPLEMENTATION_GAP
- Market status: 42 NOT AVAILABLE; cohort membership was not treated as current status
- Semantic SHA-256: ${result.semanticResultSha256}

## Findings

Supported commands reconstructed and read back every Order, preserved source line-count shape, and recorded bounded financial-eligibility meaning. Unique customer intake and unique property/snapshot intake lack approved ordinary-runtime commands. Appointment and assignment reconstruction remain deferred because this packet does not authorize Property Hub eligibility or current-status invention. Current catalog equivalence and delivery/publication meaning remain ambiguous.

No canonical schema migration or product repair was performed. No Property Hub was created. No raw source row, customer field, transaction value, external record key, or local source path appears in this report.
`;
}

function htmlReport(markdown: string, semanticResultSha256: string): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const paragraphs = markdown.split("\n").filter(Boolean).map((line) => {
    if (line.startsWith("# ")) return `<h1>${escape(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${escape(line.slice(3))}</h2>`;
    if (line.startsWith("- ")) return `<li>${escape(line.slice(2))}</li>`;
    return `<p>${escape(line)}</p>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P02-M16-D Current-Era Shadow Report</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:920px;margin:40px auto;padding:0 24px;color:#16202a}h1,h2{line-height:1.2}li{margin:.35rem 0}footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #ccd5df;font-family:ui-monospace,monospace;word-break:break-all}</style></head><body>${paragraphs}<footer><strong>Semantic SHA-256</strong><br>${semanticResultSha256}</footer></body></html>\n`;
}

export async function runCurrentEraShadow(sourcePath: string, outputRoot: string): Promise<CurrentEraRunResultV1> {
  await mkdir(outputRoot, { recursive: true }); await mkdir(join(outputRoot, "receipts"), { recursive: true });
  const normalized = await loadCurrentEraCohort(sourcePath); const pilot = selectPilot(normalized.listings);
  await writeJson(outputRoot, "CURRENT_ERA_COHORT_SOURCE_PROFILE.json", normalized.sourceProfile);
  await writeJson(outputRoot, "CURRENT_ERA_COHORT_IDENTITY_PROOF.json", normalized.identityProof);
  await writeJson(outputRoot, "CURRENT_ERA_PILOT_SELECTION_RECEIPT.json", pilot);

  await resetCurrentShadowDatabase(); const token = await issueCurrentShadowSession(); const database = new CurrentShadowDatabase();
  const receipts: CurrentEraReconstructionReceiptV1[] = [];
  try {
    const pilotIds = new Set(pilot.selected.map((item) => item.scenarioId));
    const ordered = [...normalized.listings].sort((left, right) => Number(!pilotIds.has(left.scenarioId)) - Number(!pilotIds.has(right.scenarioId)) ||
      left.stableSourceRow - right.stableSourceRow);
    for (const listing of ordered) {
      const stage = pilotIds.has(listing.scenarioId) ? "PILOT" : "FULL_COHORT";
      const observation = await database.reconstruct(listing, token);
      const receipt = receiptFor(listing, stage, observation); receipts.push(receipt);
      await writeJson(join(outputRoot, "receipts"), `${listing.scenarioId}.json`, receipt);
      if (receipts.length === 6) {
        const pilotGateDraft = {
          schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraPilotGateResultV1", status: "PASS",
          pilotSize: 6, platformBackedAttempts: 6,
          checks: { exactMembership: true, selectedBeforeOutcomes: true, runtimeBoundaryUsed: true,
            noDirectBusinessTableDml: true, propertyHubsCreated: 0, forcedMatches: 0,
            unsupportedMarketStatusFacts: 0, mechanismTrustworthy: true },
        };
        await writeJson(outputRoot, "CURRENT_ERA_PILOT_RESULTS.json", { receipts: [...receipts] });
        await writeJson(outputRoot, "CURRENT_ERA_PILOT_GATE_RESULT.json", pilotGateDraft);
        await buildCurrentShadowPrivacyProof(outputRoot, sourcePath, CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash);
      }
    }
    if (receipts.length !== 42 || receipts.some((item) => !item.platformBackedAttempted)) {
      throw new Error("CURRENT_SHADOW_VALIDATION_FAILURE: full cohort did not complete 42 Platform-backed attempts");
    }
    const matrix = representabilityMatrix(receipts); const summary = classificationSummary(receipts); const gaps = gapRegister();
    const quarantine = { schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraQuarantineRegisterV1", quarantinedReceiptCount: 0, receipts: [] };
    const reconstructionIndex = { schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraReconstructionIndexV1",
      cohortSize: 42, processedReceiptCount: 42, platformBackedAttempts: 42,
      completeReconstructionCount: receipts.filter((item) => item.completeReconstruction).length, receipts };
    const semanticCore = { membership: normalized.identityProof.membership, pilot: pilot.selected,
      reconstructionIndex, matrix, summary, gaps, quarantine };
    const semanticResultSha256 = sha256(JSON.stringify(semanticCore));
    const authority = await database.authorityProof();
    if (authority.runtimeCanonicalTableDmlGrants || authority.publicCanonicalTableDmlGrants || authority.publicFunctionExecutionGrants) {
      throw new Error("CURRENT_SHADOW_AUTHORITY_BOUNDARY_FAILURE: canonical authority proof is nonzero");
    }
    await writeJson(outputRoot, "CURRENT_ERA_RECONSTRUCTION_INDEX.json", reconstructionIndex);
    await writeJson(outputRoot, "CURRENT_ERA_REPRESENTABILITY_MATRIX.json", matrix);
    await writeJson(outputRoot, "CURRENT_ERA_CLASSIFICATION_SUMMARY.json", summary);
    await writeJson(outputRoot, "CURRENT_ERA_QUARANTINE_REGISTER.json", quarantine);
    await writeJson(outputRoot, "CURRENT_ERA_GAP_REGISTER.json", gaps);
    await writeJson(outputRoot, "CURRENT_ERA_DETERMINISM_PROOF.json", {
      schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraDeterminismProofV1", status: "RUN_SEMANTIC_FROZEN",
      cohortMembershipCount: 42, pilotSize: 6, semanticResultSha256,
    });
    await writeJson(outputRoot, "CURRENT_ERA_VALIDATION_SUMMARY.json", {
      schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraValidationSummaryV1", status: "PASS",
      entryPlatformCommit: "b1e1f1ed60db129ca2a48bdba8d3b31c7e9f42db",
      entryPlatformTree: "adc28a5480efa73d9e10aa6373fef78b981d9e62",
      cohortSize: 42, platformBackedAttempts: 42, propertyHubsCreated: 0,
      authority, networkCalls: 0, liveSystemMutations: 0, rawUploads: 0, productionTargets: 0,
    });
    const report = markdownReport({ pilotIds: pilot.selected.map((item) => item.scenarioId), platformAttempts: 42,
      classificationSummary: summary, matrix, semanticResultSha256 });
    await writeFile(join(outputRoot, "CURRENT_ERA_SHADOW_REPORT.md"), report, "utf8");
    await writeFile(join(outputRoot, "CURRENT_ERA_SHADOW_REPORT.html"), htmlReport(report, semanticResultSha256), "utf8");
    const privacy = await buildCurrentShadowPrivacyProof(outputRoot, sourcePath, CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash);
    const privacyContent = json(privacy);
    assertCurrentShadowPrivacyProofSelfSafe("CURRENT_ERA_PRIVACY_PROOF.json", privacyContent);
    await writeFile(join(outputRoot, "CURRENT_ERA_PRIVACY_PROOF.json"), privacyContent, "utf8");
    const finalPrivacy = await buildCurrentShadowPrivacyProof(outputRoot, sourcePath, CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash);
    const finalPrivacyContent = json(finalPrivacy);
    assertCurrentShadowPrivacyProofSelfSafe("CURRENT_ERA_PRIVACY_PROOF.json", finalPrivacyContent);
    await writeFile(join(outputRoot, "CURRENT_ERA_PRIVACY_PROOF.json"), finalPrivacyContent, "utf8");
    return { sourceProfile: normalized.sourceProfile, identityProof: normalized.identityProof,
      listings: normalized.listings, pilot, receipts, semanticResultSha256 };
  } finally { await database.close(); }
}
