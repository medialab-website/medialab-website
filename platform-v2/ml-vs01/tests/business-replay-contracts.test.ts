import { describe, expect, it } from "vitest";
import { SYNTHETIC_SCENARIOS } from "../src/business-replay/synthetic-scenarios.js";
import { deserializeScenario, serializeScenario, validateScenario } from "../src/business-replay/scenario.js";

describe("BusinessReplayScenarioV1 contracts", () => {
  it("validates versioned provider-neutral scenarios and round-trips exactly", () => {
    const scenario = SYNTHETIC_SCENARIOS[0]!;
    expect(validateScenario(structuredClone(scenario)).scenarioVersion).toBe(1);
    expect(deserializeScenario(serializeScenario(scenario))).toEqual(scenario);
    expect(scenario.evidence[0]).toMatchObject({ syntheticEvidenceRoleLabel: true });
    expect(scenario.historicallyObservedOutcome.status).toBe("SYNTHETIC_NOT_APPLICABLE");
  });

  it("rejects unknown versions and keeps expected/observed structures independent", () => {
    const invalid = structuredClone(SYNTHETIC_SCENARIOS.find((item) => item.executionMode === "CLASSIFIER_ONLY")!);
    (invalid as any).scenarioVersion = 2;
    expect(() => validateScenario(invalid)).toThrow("CONTRACT_VERSION_REJECTED");
    const scenario = SYNTHETIC_SCENARIOS.find((item) => item.executionMode === "CLASSIFIER_ONLY")!;
    expect(scenario.expectedR71Outcome.assertions).not.toBe(scenario.syntheticObservedOutcome!.fields);
  });
});

