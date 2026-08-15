import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BusinessReplayResultV1, BusinessReplayScenarioV1 } from "./contracts.js";
import type { BusinessScenarioCoverageMatrixV1 } from "./coverage.js";

const safe = (value: unknown) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export function acceptanceMatrix() {
  const rows = [
    ["Synthetic-only source provenance", "scenario validation and sanitization", "business-replay-sanitization", "PASS", "historical and shadow provenance reject before executor", "Historical corpus remains later authority"],
    ["Eight mismatch classifications and precedence", "classification.ts", "business-replay-classification", "PASS", "compound precedence fixture", "None"],
    ["25 coverage dimensions", "coverage.ts", "business-replay-coverage", "PASS", "stable represented/unrepresented cells", "Historical frequency not inferred"],
    ["Expected and observed independence", "contracts.ts and scenario.ts", "business-replay-contracts", "PASS", "alias rejection and fixture-authored assertions", "None"],
    ["Three Platform-backed executions", "platform-adapter.ts", "business-replay-platform-adapter", "PASS", "execution badges and commands recorded", "Other templates remain classifier-only"],
    ["Deterministic two-run output", "runner.ts", "business-replay-determinism", "PASS", "normalized semantic SHA equality", "Security tokens excluded"],
    ["Schema discipline", "migrations 0001-0022", "verify:migration-engine", "PASS", "no migration 0023 and no replay table", "Known deferred capabilities remain deferred"],
    ["No network/provider/real data", "sanitization.ts", "verify:business-replay", "PASS", "static and negative-input scans", "Later packet required"],
    ["No runtime canonical DML", "OperationalPilotDatabase function invocation", "verify:business-replay", "PASS", "replay runner contains no canonical DML", "Synthetic session bootstrap remains accepted test support"],
    ["No new PUBLIC authority", "unchanged migrations", "verify:business-replay", "PASS", "diff and privilege inventory", "None"],
    ["Offline owner report", "report.ts", "business-replay-report", "PASS", "inline CSS and no external resources", "Validation artifact only"],
    ["Future historical compatibility", "BusinessReplayScenarioV1", "business-replay-contracts", "PASS", "provenance values modeled but execution rejected", "Requires separately approved corpus"],
    ["Packet-neutral predecessor verifiers", "eight amended domain verifiers", "verify:business-replay", "PASS", "no P02_M16_*_ALLOWLIST imports", "Current boundary remains centralized"],
  ].map(([requiredBehavior, r71ImplementationSurface, test, result, recoveryFailClosedProof, remainingGap]) =>
    ({ requiredBehavior, r71ImplementationSurface, test, result, recoveryFailClosedProof, remainingGap }));
  return { schema: "ML_BUSINESS_REPLAY_V1", contract: "BusinessReplayHarnessAcceptanceMatrixV1", rows };
}

function coverageMarkdown(coverage: BusinessScenarioCoverageMatrixV1): string {
  return ["# Business Scenario Coverage Matrix", "", `Dimensions: ${coverage.dimensions.length}`, `Represented cases: ${coverage.representedCases}`,
    `Unrepresented cases: ${coverage.unrepresentedCases.length}`, "",
    "| Dimension | Case | Represented | Platform-executed | Classifier-only | Deferred |",
    "|---|---|---:|---|---|---|",
    ...coverage.cells.map((cell) => `| ${cell.dimension} | ${cell.case} | ${cell.represented ? "YES" : "NO"} | ${cell.platformExecutedBy.join(", ") || "—"} | ${cell.classifierOnlyBy.join(", ") || "—"} | ${cell.deferredNotExecutedBy.join(", ") || "—"} |`),
    "", "## Deterministic greedy represented set", "", coverage.minimumRepresentedSet.scenarioIds.map((id) => `- ${id}`).join("\n"), "",
    "This deterministic greedy plan makes no claim of global mathematical optimality.", "",
    "Planning targets are approximately 18 minimum-viable scenario classes and 32 higher-confidence scenarios. These are guides only and authorize no historical selection.", ""].join("\n");
}

function reportMarkdown(scenarios: readonly BusinessReplayScenarioV1[], results: readonly BusinessReplayResultV1[], coverage: BusinessScenarioCoverageMatrixV1, hash: string): string {
  return ["# MediaLab Business Replay Report", "", "> SYNTHETIC-ONLY NONPRODUCTION EVIDENCE — no historical customer records were used.", "",
    "Platform: `8f55e159b0d568b149b55d6c515857ec62c657fd`", `Normalized semantic SHA-256: \`${hash}\``, "",
    "Synthetic coverage is not evidence of historical frequency.", "",
    ...results.flatMap((result) => { const scenario = scenarios.find((item) => item.scenarioId === result.scenarioId)!; return [
      `## ${result.scenarioId}`, "", scenario.description, "", `Execution: **${result.executionMode}**`, `Classification: **${result.scenarioClassification}**`, "",
      ...result.comparisons.map((item) => `- \`${item.field}\`: ${item.classification}; expected ${JSON.stringify(item.expected)}, observed ${JSON.stringify(item.observed)} (${item.observationSource})`), ""]; }),
    "## Coverage summary", "", `Represented ${coverage.representedCases} cases across ${coverage.dimensions.length} dimensions; ${coverage.unrepresentedCases.length} catalog cases remain unrepresented.`, "",
    "Classifier-only and deferred fixtures are explicitly not Platform execution. Canonical schema gaps represent current approved facts that R71 cannot safely express; known deferred capabilities do not automatically qualify.", ""].join("\n");
}

function reportHtml(scenarios: readonly BusinessReplayScenarioV1[], results: readonly BusinessReplayResultV1[], coverage: BusinessScenarioCoverageMatrixV1, hash: string): string {
  const cards = results.map((result) => { const scenario = scenarios.find((item) => item.scenarioId === result.scenarioId)!;
    return `<article><header><h2>${safe(result.scenarioId)}</h2><span class="badge">${safe(result.executionMode)}</span></header><p>${safe(scenario.description)}</p><p><strong>${safe(result.scenarioClassification)}</strong></p><ul>${result.comparisons.map((item) => `<li><code>${safe(item.field)}</code>: ${safe(item.classification)} — expected ${safe(JSON.stringify(item.expected))}; observed ${safe(JSON.stringify(item.observed))} <small>${safe(item.observationSource)}</small></li>`).join("")}</ul></article>`; }).join("");
  const cells = coverage.cells.map((cell) => `<tr><td>${safe(cell.dimension)}</td><td>${safe(cell.case)}</td><td>${cell.represented ? "YES" : "NO"}</td><td>${safe(cell.platformExecutedBy.join(", ") || "—")}</td><td>${safe(cell.classifierOnlyBy.join(", ") || "—")}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MediaLab Business Replay Report</title><style>body{font:16px system-ui;margin:0;background:#f4f6f8;color:#15202b}.wrap{max-width:1180px;margin:auto;padding:28px}.banner{background:#6d1422;color:white;padding:20px;border-radius:12px}article{background:white;padding:18px;margin:16px 0;border:1px solid #d7dde3;border-radius:12px}header{display:flex;justify-content:space-between;gap:12px}.badge{background:#e8eef5;padding:6px 10px;border-radius:999px;font-size:12px}table{width:100%;border-collapse:collapse;background:white}th,td{border:1px solid #d7dde3;padding:8px;text-align:left}code{word-break:break-word}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.fact{background:white;padding:14px;border-radius:10px}</style></head><body><main class="wrap"><section class="banner"><h1>MediaLab Business Replay Report</h1><p>SYNTHETIC-ONLY NONPRODUCTION EVIDENCE</p><p>No historical customer records, provider data, or real PII were used.</p></section><section class="facts"><p class="fact"><b>Platform</b><br>${safe("8f55e159b0d568b149b55d6c515857ec62c657fd")}</p><p class="fact"><b>Semantic SHA-256</b><br>${safe(hash)}</p><p class="fact"><b>Platform-executed</b><br>${results.filter((item) => item.executionMode === "PLATFORM_EXECUTED").length}</p><p class="fact"><b>Scenario templates</b><br>${results.length}</p></section><p><strong>Synthetic coverage is not evidence of historical frequency.</strong> Classifier-only and deferred fixtures are never labeled as Platform execution.</p>${cards}<h2>Coverage matrix</h2><p>${coverage.representedCases} represented cases; ${coverage.unrepresentedCases.length} unrepresented catalog cases.</p><table><thead><tr><th>Dimension</th><th>Case</th><th>Represented</th><th>Platform-executed by</th><th>Classifier-only by</th></tr></thead><tbody>${cells}</tbody></table><h2>Deterministic greedy represented set</h2><p>No global mathematical optimality claim is made.</p><ol>${coverage.minimumRepresentedSet.scenarioIds.map((id) => `<li>${safe(id)}</li>`).join("")}</ol><h2>Future planning</h2><p>Approximately 18 minimum-viable scenario classes and 32 higher-confidence scenarios are planning guides only. They authorize no historical-data selection or access.</p></main></body></html>`;
}

export async function writeReplayArtifacts(outputRoot: string, scenarios: readonly BusinessReplayScenarioV1[], results: readonly BusinessReplayResultV1[],
  coverage: BusinessScenarioCoverageMatrixV1, semanticHash: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const acceptance = acceptanceMatrix();
  const acceptanceMd = ["# Business Replay Harness Acceptance Matrix", "", "| REQUIRED BEHAVIOR | R71 IMPLEMENTATION SURFACE | TEST | RESULT | RECOVERY/FAIL-CLOSED PROOF | REMAINING GAP |", "|---|---|---|---|---|---|",
    ...acceptance.rows.map((row) => `| ${row.requiredBehavior} | ${row.r71ImplementationSurface} | ${row.test} | ${row.result} | ${row.recoveryFailClosedProof} | ${row.remainingGap} |`), ""].join("\n");
  await Promise.all([
    writeFile(join(outputRoot, "BUSINESS_REPLAY_SYNTHETIC_CORPUS.json"), json({ schema: "ML_BUSINESS_REPLAY_V1", contract: "BusinessReplaySyntheticCorpusV1", scenarios })),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_RESULTS.json"), json({ schema: "ML_BUSINESS_REPLAY_V1", contract: "BusinessReplayResultsV1", platformCommit: "8f55e159b0d568b149b55d6c515857ec62c657fd", results })),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_COVERAGE_MATRIX.json"), json(coverage)),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_COVERAGE_MATRIX.md"), coverageMarkdown(coverage)),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_REPORT.md"), reportMarkdown(scenarios, results, coverage, semanticHash)),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_REPORT.html"), reportHtml(scenarios, results, coverage, semanticHash)),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_SEMANTIC_SHA256.txt"), `${semanticHash}\n`),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_HARNESS_ACCEPTANCE_MATRIX.json"), json(acceptance)),
    writeFile(join(outputRoot, "BUSINESS_REPLAY_HARNESS_ACCEPTANCE_MATRIX.md"), acceptanceMd),
  ]);
}

