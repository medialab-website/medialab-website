import { BUSINESS_REPLAY_SCHEMA, type BusinessReplayObservedOutcomeV1, type BusinessReplayResultV1, type BusinessReplayScenarioV1 } from "./contracts.js";
import { compareOutcomes, scenarioClassification } from "./classification.js";
import { calculateCoverage } from "./coverage.js";
import { semanticSha256 } from "./deterministic-ids.js";
import { executePlatformScenario } from "./platform-adapter.js";
import { validateScenario } from "./scenario.js";

export type PlatformExecutor = (scenario: BusinessReplayScenarioV1, outputRoot: string) => Promise<BusinessReplayObservedOutcomeV1>;

export async function runScenario(scenario: BusinessReplayScenarioV1, outputRoot: string,
  platformExecutor: PlatformExecutor = executePlatformScenario): Promise<BusinessReplayResultV1> {
  validateScenario(scenario);
  const observed = scenario.executionMode === "PLATFORM_EXECUTED"
    ? await platformExecutor(scenario, outputRoot)
    : structuredClone(scenario.syntheticObservedOutcome!);
  const comparisons = compareOutcomes(scenario.expectedR71Outcome, observed);
  const body = { schema: BUSINESS_REPLAY_SCHEMA, contract: "BusinessReplayResultV1" as const, scenarioId: scenario.scenarioId,
    executionMode: scenario.executionMode, scenarioClassification: scenarioClassification(comparisons), comparisons,
    observedR71Outcome: observed, coverage: scenario.coverage };
  return { ...body, semanticResultSha256: semanticSha256(body) };
}

export async function runCorpus(scenarios: readonly BusinessReplayScenarioV1[], outputRoot: string,
  platformExecutor: PlatformExecutor = executePlatformScenario) {
  const validated = scenarios.map((scenario) => validateScenario(structuredClone(scenario))).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
  const results: BusinessReplayResultV1[] = [];
  for (const scenario of validated) results.push(await runScenario(scenario, outputRoot, platformExecutor));
  const coverage = calculateCoverage(validated);
  const semanticOutcomeSha256 = semanticSha256({ results, coverage });
  return { scenarios: validated, results, coverage, semanticOutcomeSha256 };
}

