import { describe, expect, it } from "vitest";
import { calculateCoverage, COVERAGE_DIMENSIONS } from "../src/business-replay/coverage.js";
import { SYNTHETIC_SCENARIOS } from "../src/business-replay/synthetic-scenarios.js";

describe("Business Scenario Coverage Matrix", () => {
  it("reports all 25 dimensions, execution distinctions, duplicates, and stable ordering", () => {
    const first = calculateCoverage(SYNTHETIC_SCENARIOS);
    const second = calculateCoverage([...SYNTHETIC_SCENARIOS].reverse());
    expect(first.dimensions).toEqual(COVERAGE_DIMENSIONS);
    expect(first.dimensions).toHaveLength(25);
    expect(first.cells.some((cell) => cell.platformExecutedBy.length > 0)).toBe(true);
    expect(first.cells.some((cell) => cell.classifierOnlyBy.length > 0)).toBe(true);
    expect(first.cells.some((cell) => cell.deferredNotExecutedBy.length > 0)).toBe(true);
    expect(first.duplicateCases.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it("builds a deterministic greedy represented set without a global-optimality claim", () => {
    const matrix = calculateCoverage(SYNTHETIC_SCENARIOS);
    expect(matrix.minimumRepresentedSet.algorithm).toBe("DETERMINISTIC_GREEDY_REPRESENTED_SET");
    expect(matrix.minimumRepresentedSet.globalOptimalityClaimed).toBe(false);
    expect(matrix.minimumRepresentedSet.scenarioIds.length).toBeGreaterThan(0);
  });
});

