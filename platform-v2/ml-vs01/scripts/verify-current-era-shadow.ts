import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanHistoricalPrivacyArtifact, scanHistoricalPrivacyArtifacts } from "../src/historical-replay/privacy.js";
import { CURRENT_ERA_SOURCE_IDENTITY } from "../src/current-shadow/source.js";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(base, "../..");
const outputRoot = resolve(process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ??
  process.env.P02_M16_D_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16d-output/verify-all");
const comparisonRootArg = process.argv.find((value) => value.startsWith("--compare-root="))?.slice(15);
const sourcePath = resolve(process.argv.find((value) => value.startsWith("--source-path="))?.slice(14) ??
  process.env.P02_M16_D_SOURCE_PATH ??
  "/Volumes/MEDIALAB_OS/MediaLab Clean Room Build/APFS-Workspace/HistoricalReplay/2024_SOURCE_VAULT/ARYEO/Orders - Aug 15 2026.xlsx");
const fail = (message: string): never => { throw new Error(`CURRENT_SHADOW_VALIDATION_FAILURE: ${message}`); };
const parse = (root: string, name: string) => JSON.parse(readFileSync(join(root, name), "utf8"));

const required = [
  "CURRENT_ERA_COHORT_SOURCE_PROFILE.json", "CURRENT_ERA_COHORT_IDENTITY_PROOF.json",
  "CURRENT_ERA_PILOT_SELECTION_RECEIPT.json", "CURRENT_ERA_PILOT_GATE_RESULT.json",
  "CURRENT_ERA_RECONSTRUCTION_INDEX.json", "CURRENT_ERA_REPRESENTABILITY_MATRIX.json",
  "CURRENT_ERA_CLASSIFICATION_SUMMARY.json", "CURRENT_ERA_QUARANTINE_REGISTER.json",
  "CURRENT_ERA_GAP_REGISTER.json", "CURRENT_ERA_DETERMINISM_PROOF.json",
  "CURRENT_ERA_PRIVACY_PROOF.json", "CURRENT_ERA_VALIDATION_SUMMARY.json",
  "CURRENT_ERA_SHADOW_REPORT.html", "CURRENT_ERA_SHADOW_REPORT.md",
];
for (const name of required) readFileSync(join(outputRoot, name));
const profile = parse(outputRoot, "CURRENT_ERA_COHORT_SOURCE_PROFILE.json");
const identity = parse(outputRoot, "CURRENT_ERA_COHORT_IDENTITY_PROOF.json");
const pilot = parse(outputRoot, "CURRENT_ERA_PILOT_SELECTION_RECEIPT.json");
const gate = parse(outputRoot, "CURRENT_ERA_PILOT_GATE_RESULT.json");
const index = parse(outputRoot, "CURRENT_ERA_RECONSTRUCTION_INDEX.json");
const matrix = parse(outputRoot, "CURRENT_ERA_REPRESENTABILITY_MATRIX.json");
const classifications = parse(outputRoot, "CURRENT_ERA_CLASSIFICATION_SUMMARY.json");
const quarantine = parse(outputRoot, "CURRENT_ERA_QUARANTINE_REGISTER.json");
const gaps = parse(outputRoot, "CURRENT_ERA_GAP_REGISTER.json");
const determinism = parse(outputRoot, "CURRENT_ERA_DETERMINISM_PROOF.json");
const privacy = parse(outputRoot, "CURRENT_ERA_PRIVACY_PROOF.json");
const validation = parse(outputRoot, "CURRENT_ERA_VALIDATION_SUMMARY.json");

if (profile.identityVerified !== true || profile.cohortMemberCount !== 42 || profile.postCutoffWithinHorizonRowCount !== 44 ||
    profile.sourceArtifactHash !== CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash) fail("source/cohort identity proof mismatch");
if (identity.cohortMemberCount !== 42 || identity.membership.length !== 42 || identity.rawIdentifiersIncluded !== false || identity.forcedMatches !== 0 ||
    new Set(identity.membership.map((item: any) => item.scenarioId)).size !== 42 ||
    identity.membership.some((item: any) => !/^[0-9a-f]{64}$/.test(item.opaqueSourceReferenceHash))) fail("sanitized membership proof invalid");
if (pilot.pilotSize !== 6 || pilot.selected.length !== 6 || pilot.selectedBeforeOutcomeObservation !== true ||
    pilot.method !== "GREEDY_MAX_NEW_SHAPE_TOKENS_STABLE_SOURCE_ROW_TIEBREAK") fail("pilot selection law invalid");
if (gate.status !== "PASS" || gate.platformBackedAttempts !== 6 || gate.checks.propertyHubsCreated !== 0 || gate.checks.forcedMatches !== 0) fail("pilot gate invalid");
if (index.cohortSize !== 42 || index.processedReceiptCount !== 42 || index.platformBackedAttempts !== 42 || index.receipts.length !== 42 ||
    index.receipts.some((item: any) => item.platformBackedAttempted !== true || item.orderCreated !== true || item.orderReadBack !== true ||
      item.sourceLineCardinalityRepresented !== true || item.financialEligibilityMeaningRepresented !== true || item.propertyHubCreated !== false)) {
  fail("full Platform-backed reconstruction inventory invalid");
}
if (readdirSync(join(outputRoot, "receipts")).filter((name) => name.endsWith(".json")).length !== 42) fail("per-listing receipt count invalid");
if (matrix.cohortSize !== 42 || matrix.concepts.length < 10 || !matrix.concepts.some((item: any) => item.classification === "IMPLEMENTATION_GAP")) fail("representability matrix invalid");
if (classifications.classifications.IMPLEMENTATION_GAP !== 42 || gaps.implementationGaps.length !== 2 || gaps.canonicalSchemaGaps.length !== 0 ||
    quarantine.quarantinedReceiptCount !== 0) fail("classification/gap boundary mismatch");
if (classifications.marketStatusEvidence.notAvailableCount !== 42 || classifications.marketStatusEvidence.confirmedCount !== 0) fail("market-status evidence law failed");
if (!/^[0-9a-f]{64}$/.test(determinism.semanticResultSha256) || privacy.status !== "PASS" || validation.status !== "PASS") fail("determinism/privacy/validation evidence invalid");
if (validation.authority.runtimeCanonicalTableDmlGrants !== 0 || validation.authority.publicCanonicalTableDmlGrants !== 0 ||
    validation.authority.publicFunctionExecutionGrants !== 0 || validation.networkCalls !== 0 || validation.liveSystemMutations !== 0 ||
    validation.productionTargets !== 0 || validation.propertyHubsCreated !== 0) fail("authority or isolation proof invalid");

const phoneControl = scanHistoricalPrivacyArtifact("control.json", JSON.stringify({ contact: "202-555-0142" }));
const externalKeyControl = scanHistoricalPrivacyArtifact("control.json", JSON.stringify({ stripePaymentId: "pi_synthetic123456" }));
if (!phoneControl.hits.some((hit) => hit.rule === "PHONE_LIKE") || !externalKeyControl.hits.some((hit) => hit.rule === "PROVIDER_ID_LIKE")) {
  fail("accepted privacy scanner no longer fails closed for genuine control patterns");
}
const privacyScan = await scanHistoricalPrivacyArtifacts(outputRoot);
if (privacyScan.hits.length || Object.values(privacyScan.checks).some((value) => value !== true)) fail(`privacy scan returned ${privacyScan.hits.length} hits`);
const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
if (sourceHash !== CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash) fail("frozen source changed after run");

const currentShadowSources = readdirSync(join(base, "src/current-shadow")).filter((name) => name.endsWith(".ts"))
  .map((name) => readFileSync(join(base, "src/current-shadow", name), "utf8")).join("\n");
if (/\bfetch\s*\(|from ["'](?:https?|undici|node-fetch|axios)/.test(currentShadowSources)) fail("network client detected in current-shadow source");
const directCanonicalDml = [...currentShadowSources.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+medialab_core\.([a-z_]+)/gi)]
  .map((match) => match[1]);
if (directCanonicalDml.some((table) => table !== "development_sessions")) fail("direct canonical business-table DML detected");

const migrations = readdirSync(join(base, "db/migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
if (migrations.length !== 26 || migrations[0]?.slice(0, 4) !== "0001" || migrations[22] !== "0023_runtime_intake_reconciliation_commands.sql" || migrations[23] !== "0024_operations_home_scheduling_assignment_console.sql" || migrations[24] !== "0025_operations_mission_plan_draft_controls.sql" || migrations[25] !== "0026_editorial_segment_foundation.sql") fail("migration inventory changed");
for (const name of migrations.slice(0, 22)) {
  const predecessor = execFileSync("git", ["show", "5f456d2ae5e9262a7a2b6595ed33d92ade19767c:platform-v2/ml-vs01/db/migrations/" + name], { cwd: repo });
  if (!readFileSync(join(base, "db/migrations", name)).equals(predecessor)) fail(`predecessor migration changed: ${name}`);
}
const lockHash = createHash("sha256").update(readFileSync(join(base, "package-lock.json"))).digest("hex");
if (lockHash !== "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a") fail("package-lock changed");
const packageManifest = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
if (/testTimeout|hookTimeout|--passWithNoTests/.test(packageManifest.scripts.test) ||
    !/for file in tests\/\*\.test\.ts/.test(packageManifest.scripts.test) ||
    !/dropdb[^;]+medialab_p02m16a_test/.test(packageManifest.scripts.test) ||
    !/createdb[^;]+medialab_p02m16a_test/.test(packageManifest.scripts.test) ||
    !/tsx db\/reset-test-database\.ts --confirm=medialab_p02m16a_test/.test(packageManifest.scripts.test)) {
  fail("serial predecessor test isolation or frozen timeout boundary changed");
}

if (comparisonRootArg) {
  const comparisonRoot = resolve(comparisonRootArg);
  const byteIdentityFiles = ["CURRENT_ERA_COHORT_IDENTITY_PROOF.json", "CURRENT_ERA_PILOT_SELECTION_RECEIPT.json",
    "CURRENT_ERA_RECONSTRUCTION_INDEX.json", "CURRENT_ERA_CLASSIFICATION_SUMMARY.json",
    "CURRENT_ERA_REPRESENTABILITY_MATRIX.json", "CURRENT_ERA_GAP_REGISTER.json"];
  for (const name of byteIdentityFiles) {
    if (!readFileSync(join(outputRoot, name)).equals(readFileSync(join(comparisonRoot, name)))) {
      throw new Error(`CURRENT_SHADOW_DETERMINISM_FAILURE: normalized semantic artifact differs: ${name}`);
    }
  }
  const other = parse(comparisonRoot, "CURRENT_ERA_DETERMINISM_PROOF.json");
  if (other.semanticResultSha256 !== determinism.semanticResultSha256) throw new Error("CURRENT_SHADOW_DETERMINISM_FAILURE: semantic hashes differ");
  const proof = { schema: "ML_CURRENT_ERA_SHADOW_V1", contract: "CurrentEraDeterminismProofV1", status: "PASS",
    cohortMembershipCount: 42, pilotSize: 6, comparedCleanRuns: 2,
    byteIdenticalSemanticArtifactCount: byteIdentityFiles.length, semanticResultSha256: determinism.semanticResultSha256 };
  writeFileSync(join(outputRoot, "CURRENT_ERA_DETERMINISM_PROOF.json"), `${JSON.stringify(proof, null, 2)}\n`);
  writeFileSync(join(comparisonRoot, "CURRENT_ERA_DETERMINISM_PROOF.json"), `${JSON.stringify(proof, null, 2)}\n`);
}

process.stdout.write(`Current-Era Shadow verification PASSED. cohort=42 platformBacked=42 semanticSha256=${determinism.semanticResultSha256}\n`);
