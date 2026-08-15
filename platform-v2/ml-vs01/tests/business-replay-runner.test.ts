import { describe, expect, it, vi } from "vitest";
import { observed } from "../src/business-replay/contracts.js";
import { runCorpus, runScenario } from "../src/business-replay/runner.js";
import { SYNTHETIC_SCENARIOS } from "../src/business-replay/synthetic-scenarios.js";

describe("Business Replay runner", () => {
  it("compares independently authored expected and observed outcomes", async () => {
    const scenario = SYNTHETIC_SCENARIOS.find((item) => item.scenarioId === "M16B_SOURCE_CONFLICT_V1")!;
    const result = await runScenario(scenario, "synthetic-output", vi.fn());
    expect(result.scenarioClassification).toBe("SOURCE_CONFLICT");
    expect(result.executionMode).toBe("CLASSIFIER_ONLY");
    expect(result.comparisons[0]!.observationSource).toBe("HARNESS_OBSERVED");
  });

  it("records Platform execution distinctly and creates a stable semantic result", async () => {
    const scenario = SYNTHETIC_SCENARIOS.find((item) => item.scenarioId === "M16B_PLATFORM_NEEDS_REVIEW_V1")!;
    const executor = vi.fn(async () => observed([
      { field: "unresolved", value: 1, source: "PLATFORM_OBSERVED" },
      { field: "finalDesignationCreatedByNeedsReview", value: false, source: "PLATFORM_OBSERVED" },
    ], ["accepted-command"]));
    const first = await runCorpus([scenario], "synthetic-output", executor);
    const second = await runCorpus([scenario], "synthetic-output", executor);
    expect(first.semanticOutcomeSha256).toBe(second.semanticOutcomeSha256);
    expect(first.results[0]!.executionMode).toBe("PLATFORM_EXECUTED");
    expect(first.results[0]!.scenarioClassification).toBe("MATCH");
  });
});

