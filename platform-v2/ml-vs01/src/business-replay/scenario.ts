import { BUSINESS_REPLAY_SCHEMA, type BusinessReplayScenarioV1 } from "./contracts.js";
import { assertSyntheticOnlyScenario } from "./sanitization.js";

const ID = /^M16B_[A-Z0-9_]+_V1$/;
const HASH = /^[0-9a-f]{64}$/;

export function validateScenario(scenario: BusinessReplayScenarioV1): BusinessReplayScenarioV1 {
  if (scenario.schema !== BUSINESS_REPLAY_SCHEMA || scenario.contract !== "BusinessReplayScenarioV1" || scenario.scenarioVersion !== 1) {
    throw new Error("BUSINESS_REPLAY_CONTRACT_VERSION_REJECTED");
  }
  if (!ID.test(scenario.scenarioId) || scenario.lane !== "REAL_ESTATE_MEDIA" || scenario.policyBaseline !== "R71") {
    throw new Error("BUSINESS_REPLAY_SCENARIO_IDENTITY_REJECTED");
  }
  if (!Number.isFinite(Date.parse(scenario.syntheticReferenceDate))) throw new Error("BUSINESS_REPLAY_CLOCK_REJECTED");
  if (!scenario.fixtureNamespace.startsWith("M16B_SYNTHETIC_")) throw new Error("BUSINESS_REPLAY_NAMESPACE_REJECTED");
  if (scenario.expectedR71Outcome.authoredIndependently !== true || scenario.expectedR71Outcome.assertions.length === 0) {
    throw new Error("BUSINESS_REPLAY_EXPECTED_OUTCOME_REJECTED");
  }
  if (scenario.syntheticObservedOutcome && Object.is(scenario.expectedR71Outcome.assertions, scenario.syntheticObservedOutcome.fields)) {
    throw new Error("BUSINESS_REPLAY_EXPECTED_OBSERVED_ALIAS_REJECTED");
  }
  for (const evidence of scenario.evidence) {
    if (!HASH.test(evidence.opaqueSourceReferenceHash) || (evidence.sourceArtifactHash && !HASH.test(evidence.sourceArtifactHash))) {
      throw new Error("BUSINESS_REPLAY_EVIDENCE_HASH_REJECTED");
    }
  }
  assertSyntheticOnlyScenario(scenario);
  return scenario;
}

export function serializeScenario(scenario: BusinessReplayScenarioV1): string {
  return JSON.stringify(validateScenario(scenario));
}

export function deserializeScenario(serialized: string): BusinessReplayScenarioV1 {
  return validateScenario(JSON.parse(serialized) as BusinessReplayScenarioV1);
}

