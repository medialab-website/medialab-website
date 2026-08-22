import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COVERAGE_DIMENSIONS } from "../src/business-replay/coverage.js";
import { FROZEN_SOURCES } from "../src/historical-replay/index.js";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(base, "../..");
const outputRoot = resolve(process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ??
  process.env.P02_M16_C_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16c-output/verify-all");
const vaultRoot = resolve(process.argv.find((value) => value.startsWith("--vault-root="))?.slice(13) ??
  process.env.P02_M16_C_SOURCE_VAULT ?? "/Volumes/MEDIALAB_OS/MediaLab Clean Room Build/APFS-Workspace/HistoricalReplay/2024_SOURCE_VAULT");
const fail = (message: string): never => { throw new Error(`HISTORICAL_VALIDATION_FAILURE: ${message}`); };
const parse = (name: string) => JSON.parse(readFileSync(join(outputRoot, name), "utf8"));

const required = ["HISTORICAL_SOURCE_PROFILE.json","HISTORICAL_NORMALIZATION_MAP.md","HISTORICAL_EVIDENCE_RECONCILIATION.json",
  "HISTORICAL_REPLAY_SCENARIO_INDEX.json","HISTORICAL_SCENARIO_COVERAGE_MATRIX.json","HISTORICAL_SCENARIO_COVERAGE_MATRIX.md",
  "HISTORICAL_REPLAY_RESULTS.json","HISTORICAL_CLASSIFICATION_SUMMARY.json","HISTORICAL_GAP_REGISTER.json",
  "HISTORICAL_BUSINESS_REPLAY_REPORT.html","HISTORICAL_BUSINESS_REPLAY_SUMMARY.md","HISTORICAL_PRIVACY_SANITIZATION_SCAN.json",
  "HISTORICAL_REPLAY_SEMANTIC_SHA256.txt"];
for (const name of required) readFileSync(join(outputRoot, name));
const profile = parse("HISTORICAL_SOURCE_PROFILE.json"); const reconciliation = parse("HISTORICAL_EVIDENCE_RECONCILIATION.json");
const index = parse("HISTORICAL_REPLAY_SCENARIO_INDEX.json"); const coverage = parse("HISTORICAL_SCENARIO_COVERAGE_MATRIX.json");
const results = parse("HISTORICAL_REPLAY_RESULTS.json"); const classifications = parse("HISTORICAL_CLASSIFICATION_SUMMARY.json");
const gaps = parse("HISTORICAL_GAP_REGISTER.json"); const privacy = parse("HISTORICAL_PRIVACY_SANITIZATION_SCAN.json");
const report = readFileSync(join(outputRoot, "HISTORICAL_BUSINESS_REPLAY_REPORT.html"), "utf8");
const semantic = readFileSync(join(outputRoot, "HISTORICAL_REPLAY_SEMANTIC_SHA256.txt"), "utf8").trim();
if (profile.identityVerified !== true || profile.rawFiles.length !== 5 || profile.aggregateFacts.inRangeOrders !== 142) fail("source profile identity/count boundary mismatch");
if (profile.aggregateFacts.itemizedProcessorRows !== 0 || reconciliation.balanceSummaryUsage !== "AGGREGATE_FALLBACK_ONLY") fail("Stripe aggregate/itemized boundary failed");
if (reconciliation.forcedMatches !== 0 || !reconciliation.relationships.some((item: any) => item.classification === "CONFLICTING")) fail("reconciliation confidence law failed");
if (index.scenarioIds.length < 18 || index.scenarioIds.some((id: string) => !/^M16C_HISTORICAL_[A-Z0-9_]+_V1$/.test(id))) fail("historical scenario inventory invalid");
if (results.results.length !== index.scenarioIds.length || results.results.filter((item: any) => item.executionMode === "PLATFORM_EXECUTED").length < 1) fail("replay execution inventory invalid");
if (coverage.dimensions.length !== 25 || JSON.stringify(coverage.dimensions) !== JSON.stringify(COVERAGE_DIMENSIONS)) fail("25-dimension coverage law failed");
if (coverage.minimumRepresentedSet.globalOptimalityClaimed !== false) fail("unsafe set-cover optimality claim");
for (const classification of ["MATCH","SOURCE_CONFLICT","AMBIGUOUS_EVIDENCE","DEFERRED_CAPABILITY","INTENTIONAL_POLICY_CHANGE"]) {
  if (!classifications.classifications[classification]) fail(`required evidence classification missing: ${classification}`);
}
if (gaps.implementationGaps.length || gaps.canonicalSchemaGaps.length) fail("unreviewed product gap asserted");
if (!/No raw customer rows/.test(report) || /<script\s+src=|<link\s+[^>]*href=/i.test(report)) fail("offline sanitized report boundary failed");
if (!/^[0-9a-f]{64}$/.test(semantic) || privacy.rawHashesReverifiedAfterRun !== true || Object.values(privacy.checks).some((value) => value !== true)) fail("privacy/determinism evidence invalid");
for (const scenarioFile of readdirSync(join(outputRoot, "scenarios"))) {
  const scenario = JSON.parse(readFileSync(join(outputRoot, "scenarios", scenarioFile), "utf8"));
  if (scenario.provenanceClassification !== "HISTORICAL_NORMALIZED" || scenario.evidence.some((item: any) => !/^[0-9a-f]{64}$/.test(item.opaqueSourceReferenceHash))) fail(`unsafe scenario ${scenarioFile}`);
}
for (const source of Object.values(FROZEN_SOURCES)) {
  const hash = createHash("sha256").update(readFileSync(join(vaultRoot, source.relativePath))).digest("hex");
  if (hash !== source.sha256) fail(`post-run raw identity changed: ${source.relativePath}`);
}
const migrations = readdirSync(join(base, "db/migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
if (migrations.length !== 28 || migrations[22] !== "0023_runtime_intake_reconciliation_commands.sql" || migrations[23] !== "0024_operations_home_scheduling_assignment_console.sql" || migrations[24] !== "0025_operations_mission_plan_draft_controls.sql" || migrations[25] !== "0026_editorial_segment_foundation.sql" || migrations[26] !== "0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql" || migrations[27] !== "0028_client_account_and_operator_contact_intake_foundation.sql") fail("migration inventory is not exact 0001-0028");
for (const name of migrations.slice(0, 22)) {
  const predecessor = execFileSync("git", ["show", "5f456d2ae5e9262a7a2b6595ed33d92ade19767c:platform-v2/ml-vs01/db/migrations/" + name], { cwd: repo });
  if (!readFileSync(join(base, "db/migrations", name)).equals(predecessor)) fail(`predecessor migration changed: ${name}`);
}
const lockHash = createHash("sha256").update(readFileSync(join(base, "package-lock.json"))).digest("hex");
if (lockHash !== "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a") fail("package-lock changed");
const source = readFileSync(join(base, "src/historical-replay/index.ts"), "utf8");
if (/\bfetch\s*\(|from ["'](?:https?|undici|node-fetch|axios)/.test(source)) fail("network client detected");
process.stdout.write(`Historical Business Replay verification PASSED. scenarios=${index.scenarioIds.length} semanticSha256=${semantic}\n`);
