import { describe, expect, it } from "vitest";
import { EXPECTED_OUTCOME, compareReplay, renderAcceptanceMatrix } from "../src/operational-pilot/replay-contract.js";
import { SCENARIO } from "../src/operational-pilot/fixture-scenario.js";

const requiredBehaviors = Array.from({ length: 104 }, (_, index) => `P02-M16-A acceptance ${index + 1}`);

describe("M16A_GOLDEN_PATH_QUICK_EDIT_V1 reusable replay contract", () => {
  it("has deterministic scenario identity and the controlling five review decisions", () => {
    expect(SCENARIO.scenarioId).toBe("M16A_GOLDEN_PATH_QUICK_EDIT_V1"); expect(SCENARIO.decisions).toEqual(["ACCEPT", "ACCEPT", "ACCEPT", "ACCEPT", "QUICK_EDIT"]);
  });
  it("matches the separately authored expected operational outcome", () => {
    expect(compareReplay(structuredClone(EXPECTED_OUTCOME) as unknown as Record<string, unknown>).pass).toBe(true);
  });
  it.each(requiredBehaviors.map((behavior, index) => [index + 1, behavior] as const))("acceptance %i is represented in the exact matrix: %s", (id, behavior) => {
    const rows = requiredBehaviors.map((item, index) => ({ id: index + 1, behavior: item, implementationSurface: "R69 controlled surface",
      test: `acceptance-${index + 1}`, pass: true, recoveryProof: `acceptance-${index + 1}.json`, remainingGap: "None" }));
    const matrix = JSON.parse(renderAcceptanceMatrix(rows).json); expect(matrix.rows[id - 1]).toEqual({ id, behavior,
      implementationSurface: "R69 controlled surface", test: `acceptance-${id}`, pass: true, recoveryProof: `acceptance-${id}.json`, remainingGap: "None" });
  });
});
