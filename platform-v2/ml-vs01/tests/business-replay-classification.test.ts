import { describe, expect, it } from "vitest";
import { compareOutcomes, scenarioClassification } from "../src/business-replay/classification.js";
import { expected, observed, type MismatchClassification } from "../src/business-replay/contracts.js";

const classifications: readonly MismatchClassification[] = ["MATCH", "INTENTIONAL_POLICY_CHANGE", "SOURCE_CONFLICT", "AMBIGUOUS_EVIDENCE",
  "DEFERRED_CAPABILITY", "IMPLEMENTATION_GAP", "CANONICAL_SCHEMA_GAP", "HARNESS_ERROR"];

describe("Business Replay mismatch classification", () => {
  it.each(classifications)("positively classifies %s", (classification) => {
    const assertions = expected([{ field: "fact", expected: "EXPECTED", mismatchClassification: classification === "MATCH" ? undefined : classification, reason: "positive fixture" }]);
    const actual = observed([{ field: "fact", value: classification === "MATCH" ? "EXPECTED" : "OBSERVED", source: "HARNESS_OBSERVED" }]);
    expect(compareOutcomes(assertions, actual)[0]!.classification).toBe(classification);
  });

  it("applies the exact deterministic compound precedence", () => {
    const assertions = expected([
      { field: "deferred", expected: true, mismatchClassification: "DEFERRED_CAPABILITY", reason: "fixture" },
      { field: "harness", expected: true, mismatchClassification: "HARNESS_ERROR", reason: "fixture" },
      { field: "schema", expected: true, mismatchClassification: "CANONICAL_SCHEMA_GAP", reason: "fixture" },
    ]);
    const actual = observed(["deferred", "harness", "schema"].map((field) => ({ field, value: false, source: "HARNESS_OBSERVED" as const })));
    expect(scenarioClassification(compareOutcomes(assertions, actual))).toBe("HARNESS_ERROR");
  });
});

