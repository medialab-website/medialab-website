import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSIFICATION_PRECEDENCE } from "../src/business-replay/classification.js";
import { COVERAGE_DIMENSIONS } from "../src/business-replay/coverage.js";
import { P02_M16_B_ALLOWLIST } from "./p02-m16-b-changed-files.js";
import { P02_M16_C_ALLOWLIST } from "./p02-m16-c-changed-files.js";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(base, "../..");
const outputRoot = resolve(process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ??
  process.env.P02_M16_B_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16b-output/verify-all");
const fail = (message: string): never => { throw new Error(`P02-M16-B_VERIFICATION_FAILED: ${message}`); };

const requiredArtifacts = ["BUSINESS_REPLAY_SYNTHETIC_CORPUS.json", "BUSINESS_REPLAY_RESULTS.json", "BUSINESS_REPLAY_COVERAGE_MATRIX.json",
  "BUSINESS_REPLAY_COVERAGE_MATRIX.md", "BUSINESS_REPLAY_REPORT.md", "BUSINESS_REPLAY_REPORT.html", "BUSINESS_REPLAY_SEMANTIC_SHA256.txt",
  "BUSINESS_REPLAY_HARNESS_ACCEPTANCE_MATRIX.json", "BUSINESS_REPLAY_HARNESS_ACCEPTANCE_MATRIX.md"];
for (const artifact of requiredArtifacts) readFileSync(join(outputRoot, artifact));
const corpus = JSON.parse(readFileSync(join(outputRoot, "BUSINESS_REPLAY_SYNTHETIC_CORPUS.json"), "utf8"));
const results = JSON.parse(readFileSync(join(outputRoot, "BUSINESS_REPLAY_RESULTS.json"), "utf8"));
const coverage = JSON.parse(readFileSync(join(outputRoot, "BUSINESS_REPLAY_COVERAGE_MATRIX.json"), "utf8"));
const report = readFileSync(join(outputRoot, "BUSINESS_REPLAY_REPORT.html"), "utf8");
const semanticHash = readFileSync(join(outputRoot, "BUSINESS_REPLAY_SEMANTIC_SHA256.txt"), "utf8").trim();
if (corpus.scenarios.length < 26 || corpus.scenarios.some((item: any) => item.provenanceClassification !== "SYNTHETIC_FIXTURE")) fail("corpus is not 26-or-more synthetic-only scenarios");
if (results.results.filter((item: any) => item.executionMode === "PLATFORM_EXECUTED").length < 3) fail("three Platform executions not proven");
for (const id of ["M16B_PLATFORM_BASELINE_QUICK_EDIT_V1", "M16B_PLATFORM_NEEDS_REVIEW_V1", "M16B_PLATFORM_RESCHEDULE_V1"]) {
  if (!results.results.some((item: any) => item.scenarioId === id && item.executionMode === "PLATFORM_EXECUTED")) fail(`missing Platform scenario ${id}`);
}
const classifications = new Set(results.results.map((item: any) => item.scenarioClassification));
for (const classification of CLASSIFICATION_PRECEDENCE) if (!classifications.has(classification)) fail(`classification not represented: ${classification}`);
if (coverage.dimensions.length !== 25 || JSON.stringify(coverage.dimensions) !== JSON.stringify(COVERAGE_DIMENSIONS)) fail("coverage dimension law mismatch");
if (coverage.minimumRepresentedSet.globalOptimalityClaimed !== false || coverage.minimumRepresentedSet.algorithm !== "DETERMINISTIC_GREEDY_REPRESENTED_SET") fail("set-cover claim is unsafe");
if (!/SYNTHETIC-ONLY/.test(report) || !/No historical customer records/.test(report) || /<script\s+src=|<link\s+[^>]*href=/i.test(report)) fail("offline owner report boundary failed");
if (!/^[0-9a-f]{64}$/.test(semanticHash)) fail("semantic hash invalid");

const eight = ["verify-catalog-administration-lifecycle-schema.ts", "verify-current-catalog-price-reconstruction-schema.ts",
  "verify-disposable-delivery-surface-local-fixture.ts", "verify-operational-pilot-golden-path.ts", "verify-order-foundation-schema.ts",
  "verify-property-hub-foundation-schema.ts", "verify-provider-neutral-file-backed-delivery.ts", "verify-scheduling-appointment-foundation-schema.ts"];
for (const name of eight) {
  const source = readFileSync(join(base, "scripts", name), "utf8");
  if (/P02_M16_[A-Z0-9_]*ALLOWLIST/.test(source)) fail(`${name} imports packet-specific changed-path law`);
}
const packageJson = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
for (const name of eight) {
  const scriptName = Object.entries(packageJson.scripts).find(([, command]) => String(command).includes(name))?.[0];
  if (!scriptName || !String(packageJson.scripts["verify:all"]).includes(`npm run ${scriptName}`)) fail(`${name} omitted from strict verify:all`);
}
if (P02_M16_B_ALLOWLIST.length !== 50 || P02_M16_B_ALLOWLIST.some((item) => !item.startsWith("platform-v2/ml-vs01/"))) fail("amended 50-path boundary invalid");
if (P02_M16_C_ALLOWLIST.length !== 16 || P02_M16_C_ALLOWLIST.some((item) => !item.startsWith("platform-v2/ml-vs01/"))) fail("M16-C boundary invalid");
const changedFilesVerifier = readFileSync(join(base, "scripts/verify-changed-files.ts"), "utf8");
for (const required of ["readCandidateStatus", "readChangedFilesInventory", "compareExactPathSets"]) {
  if (!changedFilesVerifier.includes(required)) fail("current boundary is not centralized");
}
if (!String(packageJson.scripts["verify:all"]).includes("npm run verify:changed-files")) fail("current boundary is not in strict verify:all");

const replayFiles = readdirSync(join(base, "src/business-replay")).map((name) => join(base, "src/business-replay", name));
const replaySource = replayFiles.map((file) => readFileSync(file, "utf8")).join("\n");
if (/\b(?:fetch|axios|request)\s*\(/.test(replaySource) || /from ["'](?:https?|undici|node-fetch|axios)/.test(replaySource)) fail("network client detected");
const runnerSource = readFileSync(join(base, "src/business-replay/runner.ts"), "utf8");
if (/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?medialab_core\./i.test(runnerSource)) fail("replay runner contains direct canonical DML");
const adapterSource = readFileSync(join(base, "src/business-replay/platform-adapter.ts"), "utf8");
const adapterDml = adapterSource.match(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?medialab_core\.[a-z_]+/gi) ?? [];
if (adapterDml.length !== 1 || !/INSERT INTO medialab_core\.development_sessions/i.test(adapterDml[0]!)) fail("Platform adapter exceeds accepted synthetic session bootstrap DML");
const diff = BunLikeGitDiff();
if (/\bGRANT\b[^;]*\bPUBLIC\b/i.test(diff)) fail("new PUBLIC authority detected");
const migrations = readdirSync(join(base, "db/migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
if (migrations.length !== 24 || migrations[22] !== "0023_runtime_intake_reconciliation_commands.sql" || migrations[23] !== "0024_operations_home_scheduling_assignment_console.sql") fail("migration inventory is not exact 0001-0024");
for (const name of migrations.slice(0, 22)) {
  const predecessor = requireChildProcess().execFileSync("git", ["show", "5f456d2ae5e9262a7a2b6595ed33d92ade19767c:platform-v2/ml-vs01/db/migrations/" + name], { cwd: repo });
  if (!readFileSync(join(base, "db/migrations", name)).equals(predecessor)) fail(`predecessor migration changed: ${name}`);
}
const lockHash = createHash("sha256").update(readFileSync(join(base, "package-lock.json"))).digest("hex");
if (lockHash !== "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a") fail("package-lock changed");
for (const artifact of requiredArtifacts) {
  const content = readFileSync(join(outputRoot, artifact), "utf8");
  if (/\/Users\/|\/home\/|file:\/\//.test(content)) fail(`absolute path leaked into ${artifact}`);
  if (/\b[A-Z0-9._%+-]+@(?!fixture\.|synthetic\.)[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(content)) fail(`email-like PII leaked into ${artifact}`);
}
process.stdout.write(`Business Replay verification PASSED. scenarios=${corpus.scenarios.length} platformExecuted=3 semanticSha256=${semanticHash}\n`);

function BunLikeGitDiff(): string {
  const { execFileSync } = requireChildProcess();
  return execFileSync("git", ["diff", "--", "platform-v2/ml-vs01"], { cwd: repo, encoding: "utf8" });
}
function requireChildProcess(): typeof import("node:child_process") {
  // Kept local so the replay runtime itself remains free of shell execution.
  return globalThis.process.getBuiltinModule("node:child_process") as typeof import("node:child_process");
}
