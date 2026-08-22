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
  process.env.P02_M16_E_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16e-output/verify-all");
const compareRootArg = process.argv.find((value) => value.startsWith("--compare-root="))?.slice(15);
const inventoryPath = resolve(process.argv.find((value) => value.startsWith("--coupling-inventory="))?.slice(21) ??
  "/tmp/mlvs01-p02m16e-output/M16E_STALE_MIGRATION_COUPLING_INVENTORY.json");
const sourcePath = resolve(process.argv.find((value) => value.startsWith("--source-path="))?.slice(14) ??
  process.env.P02_M16_E_SOURCE_PATH ??
  "/Volumes/MEDIALAB_OS/MediaLab Clean Room Build/APFS-Workspace/HistoricalReplay/2024_SOURCE_VAULT/ARYEO/Orders - Aug 15 2026.xlsx");
const fail = (message: string): never => { throw new Error("M16E_VALIDATION_FAILURE: " + message); };
const parse = (root: string, name: string) => JSON.parse(readFileSync(join(root, name), "utf8"));

const required = [
  "M16E_RUNTIME_INTAKE_COMMAND_PROOF.json", "M16E_CUSTOMER_RECONCILIATION_SUMMARY.json",
  "M16E_PROPERTY_RECONCILIATION_SUMMARY.json", "M16E_CURRENT_ERA_REPROOF_INDEX.json",
  "M16E_CURRENT_ERA_REPRESENTABILITY_MATRIX.json", "M16E_CURRENT_ERA_CLASSIFICATION_SUMMARY.json",
  "M16E_NEWLY_EXPOSED_GAP_REGISTER.json", "M16E_DETERMINISM_PROOF.json",
  "M16E_PRIVACY_AUTHORITY_PROOF.json", "M16E_VALIDATION_SUMMARY.json",
  "M16E_UI_READINESS_ASSESSMENT.json", "M16E_CURRENT_ERA_REPROOF_REPORT.md",
  "M16E_CURRENT_ERA_REPROOF_REPORT.html",
];
for (const name of required) readFileSync(join(outputRoot, name));
const commands = parse(outputRoot, "M16E_RUNTIME_INTAKE_COMMAND_PROOF.json");
const customers = parse(outputRoot, "M16E_CUSTOMER_RECONCILIATION_SUMMARY.json");
const properties = parse(outputRoot, "M16E_PROPERTY_RECONCILIATION_SUMMARY.json");
const index = parse(outputRoot, "M16E_CURRENT_ERA_REPROOF_INDEX.json");
const classifications = parse(outputRoot, "M16E_CURRENT_ERA_CLASSIFICATION_SUMMARY.json");
const gaps = parse(outputRoot, "M16E_NEWLY_EXPOSED_GAP_REGISTER.json");
const determinism = parse(outputRoot, "M16E_DETERMINISM_PROOF.json");
const privacyAuthority = parse(outputRoot, "M16E_PRIVACY_AUTHORITY_PROOF.json");
const validation = parse(outputRoot, "M16E_VALIDATION_SUMMARY.json");
const ui = parse(outputRoot, "M16E_UI_READINESS_ASSESSMENT.json");
if (commands.status !== "PASS" || commands.signatures.length !== 2 ||
    commands.directRuntimeCanonicalTableDmlGrants !== 0 ||
    commands.publicCanonicalTableDmlGrants !== 0 || commands.publicFunctionExecuteGrants !== 0) {
  fail("runtime intake command authority proof invalid");
}
if (customers.cohortCount !== 42 || customers.emailResolvedCount !== 0 ||
    customers.externalReferenceResolvedCount !== 42 || customers.createdNullEmailPersonCount !== 9 ||
    customers.createdCount !== 9 || customers.reusedCount !== 33 || customers.ambiguousCount !== 0 ||
    customers.conflictCount !== 0 || customers.externalReferenceCreatedCount !== 9 ||
    customers.externalReferenceReusedCount !== 33 || customers.repeatedCustomerReuseProven !== true) {
  fail("customer reconciliation summary differs from exact source-backed outcomes");
}
if (properties.completeEvidenceCount !== 41 || properties.incompleteEvidenceCount !== 1 ||
    properties.propertyCreatedCount !== 40 || properties.propertyReusedCount !== 1 ||
    properties.snapshotCreatedCount !== 40 || properties.snapshotReusedCount !== 1 ||
    properties.repeatedPropertyReuseProven !== true || properties.priorSnapshotMutations !== 0 ||
    properties.propertyHubsCreated !== 0) {
  fail("Property/Snapshot reconciliation summary differs from exact evidence-supported outcomes");
}
if (index.cohortCount !== 42 || index.customerCommandAttemptCount !== 42 ||
    index.propertyCommandAttemptCount !== 41 || index.orderCreateReadbackCount !== 41 ||
    index.fixtureCustomerPersonUsedCount !== 0 || index.fixturePropertyUsedCount !== 0 ||
    index.fixturePropertySnapshotUsedCount !== 0 || index.receipts.length !== 42 ||
    index.receipts.filter((receipt: any) => receipt.classification === "MATCH").length !== 41 ||
    index.receipts.filter((receipt: any) => receipt.classification === "AMBIGUOUS_EVIDENCE").length !== 1) {
  fail("42-member re-proof index invalid");
}
if (readdirSync(join(outputRoot, "m16e-receipts")).filter((name) => name.endsWith(".json")).length !== 42) {
  fail("per-scenario receipt count invalid");
}
if (classifications.classifications.MATCH !== 41 ||
    classifications.classifications.AMBIGUOUS_EVIDENCE !== 1 ||
    classifications.classifications.IMPLEMENTATION_GAP !== 0 ||
    classifications.classifications.CANONICAL_SCHEMA_GAP !== 0 ||
    classifications.classifications.HARNESS_ERROR !== 0 ||
    gaps.implementationGaps.length !== 0 || gaps.canonicalSchemaGaps.length !== 0 ||
    gaps.sourceEvidenceLimitations.length !== 1) {
  fail("classification or newly exposed gap boundary invalid");
}
if (ui.status !== "READY_WITH_EXPLICIT_SOURCE_EVIDENCE_LIMITATION" ||
    ui.materialBackendBlockersToFirstOwnerUsableSlice !== 0 ||
    validation.networkCalls !== 0 || validation.providerCalls !== 0 ||
    validation.currentSystemMutations !== 0 || validation.productionTargets !== 0 ||
    validation.rawUploads !== 0 || privacyAuthority.status !== "PASS") {
  fail("UI-readiness, privacy, or isolation proof invalid");
}
if (!/^[0-9a-f]{64}$/.test(determinism.semanticResultSha256)) fail("semantic SHA-256 invalid");

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
if (inventory.schema !== "M16E_STALE_MIGRATION_COUPLING_INVENTORY_V1" ||
    inventory.createdBeforePredecessorMutation !== true || inventory.inventoryCount !== 49 ||
    inventory.entries.length !== 49 ||
    inventory.entries.some((entry: any) => entry.noNonMigrationAssertionChanges !== true ||
      entry.noSecurityAssertionChanges !== true || entry.noTimeoutChanges !== true ||
      entry.noBehavioralExpectationWeakening !== true)) {
  fail("pre-edit stale migration coupling inventory invalid");
}

const migrationFiles = readdirSync(join(base, "db/migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
if (migrationFiles.length !== 27 ||
    migrationFiles[22] !== "0023_runtime_intake_reconciliation_commands.sql" ||
    migrationFiles[23] !== "0024_operations_home_scheduling_assignment_console.sql" ||
    migrationFiles[24] !== "0025_operations_mission_plan_draft_controls.sql" ||
    migrationFiles[25] !== "0026_editorial_segment_foundation.sql" ||
    migrationFiles[26] !== "0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql" ||
    migrationFiles.some((name, index) => !name.startsWith(String(index + 1).padStart(4, "0")))) {
  fail("canonical migration inventory is not exact 0001-0027");
}
for (const name of migrationFiles.slice(0, 22)) {
  const current = readFileSync(join(base, "db/migrations", name));
  const predecessor = execFileSync("git", ["show", "5f456d2ae5e9262a7a2b6595ed33d92ade19767c:platform-v2/ml-vs01/db/migrations/" + name], { cwd: repo });
  if (!current.equals(predecessor)) fail("predecessor migration bytes changed: " + name);
}
const migration0023 = readFileSync(join(base, "db/migrations/0023_runtime_intake_reconciliation_commands.sql"), "utf8");
if (/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX)\b/i.test(migration0023.replace(
  /ALTER TABLE medialab_core\.people[\s\S]*?ADD CONSTRAINT people_email_check[\s\S]*?\);/i, ""
).replace(
  /CREATE TABLE medialab_core\.person_external_references[\s\S]*?\n\);/i, ""
).replace(
  /CREATE INDEX person_external_references_person_idx[\s\S]*?;/i, ""
))) {
  fail("migration 0023 contains structural DDL outside the reconciled Person/table boundary");
}
if ((migration0023.match(/CREATE TABLE/gi) ?? []).length !== 1 ||
    !/ALTER TABLE medialab_core\.people\s+ALTER COLUMN email DROP NOT NULL/i.test(migration0023) ||
    !/CREATE TABLE medialab_core\.person_external_references/i.test(migration0023) ||
    /CREATE TABLE medialab_core\.(?!person_external_references)/i.test(migration0023)) {
  fail("migration 0023 exact structural boundary invalid");
}
const lockHash = createHash("sha256").update(readFileSync(join(base, "package-lock.json"))).digest("hex");
if (lockHash !== "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a") fail("package-lock changed");
const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
if (sourceHash !== CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash) fail("frozen source changed");
const controls = [
  scanHistoricalPrivacyArtifact("control.json", JSON.stringify({ contact: "202-555-0142" })),
  scanHistoricalPrivacyArtifact("control.json", JSON.stringify({ stripePaymentId: "pi_synthetic123456" })),
];
if (!controls[0].hits.some((hit) => hit.rule === "PHONE_LIKE") ||
    !controls[1].hits.some((hit) => hit.rule === "PROVIDER_ID_LIKE")) {
  fail("privacy scanner no longer fails closed for genuine control patterns");
}
const privacyScan = await scanHistoricalPrivacyArtifacts(outputRoot);
if (privacyScan.hits.length || Object.values(privacyScan.checks).some((value) => value !== true)) {
  fail("sanitized output privacy scan returned " + privacyScan.hits.length + " hits");
}

if (compareRootArg) {
  const otherRoot = resolve(compareRootArg);
  const byteIdentityFiles = [
    "M16E_CUSTOMER_RECONCILIATION_SUMMARY.json", "M16E_PROPERTY_RECONCILIATION_SUMMARY.json",
    "M16E_CURRENT_ERA_REPROOF_INDEX.json", "M16E_CURRENT_ERA_REPRESENTABILITY_MATRIX.json",
    "M16E_CURRENT_ERA_CLASSIFICATION_SUMMARY.json", "M16E_NEWLY_EXPOSED_GAP_REGISTER.json",
    "M16E_UI_READINESS_ASSESSMENT.json",
  ];
  for (const name of byteIdentityFiles) {
    if (!readFileSync(join(outputRoot, name)).equals(readFileSync(join(otherRoot, name)))) {
      throw new Error("M16E_DETERMINISM_FAILURE: normalized semantic artifact differs: " + name);
    }
  }
  const other = parse(otherRoot, "M16E_DETERMINISM_PROOF.json");
  if (other.semanticResultSha256 !== determinism.semanticResultSha256) {
    throw new Error("M16E_DETERMINISM_FAILURE: semantic hashes differ");
  }
  const proof = {
    schema: "ML_CURRENT_ERA_INTAKE_REPROOF_V1",
    contract: "M16EDeterminismProofV1",
    status: "PASS",
    cohortCount: 42,
    comparedCleanRuns: 2,
    byteIdenticalSemanticArtifactCount: byteIdentityFiles.length,
    semanticResultSha256: determinism.semanticResultSha256,
  };
  const content = JSON.stringify(proof, null, 2) + "\n";
  writeFileSync(join(outputRoot, "M16E_DETERMINISM_PROOF.json"), content);
  writeFileSync(join(otherRoot, "M16E_DETERMINISM_PROOF.json"), content);
}

process.stdout.write("M16-E current-era intake re-proof verification PASSED. cohort=42 orderReadback=41 semanticSha256=" +
  determinism.semanticResultSha256 + "\n");
