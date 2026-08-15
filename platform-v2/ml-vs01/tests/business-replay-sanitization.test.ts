import { describe, expect, it, vi } from "vitest";
import { runCorpus } from "../src/business-replay/runner.js";
import { assertSyntheticOnlyScenario } from "../src/business-replay/sanitization.js";
import { SYNTHETIC_SCENARIOS } from "../src/business-replay/synthetic-scenarios.js";

const base = () => structuredClone(SYNTHETIC_SCENARIOS.find((item) => item.executionMode === "PLATFORM_EXECUTED")!);

describe("Business Replay synthetic-only fail-closed guard", () => {
  it.each([
    ["historical", (item: any) => item.provenanceClassification = "HISTORICAL_NORMALIZED"],
    ["shadow", (item: any) => item.provenanceClassification = "CURRENT_SHADOW_NORMALIZED"],
    ["provider URL", (item: any) => item.commercialFacts.source = "https://example.aryeo.com/record"],
    ["provider identifier", (item: any) => item.commercialFacts.providerRecordId = "raw-123"],
    ["credential", (item: any) => item.commercialFacts.accessToken = "secret-material"],
    ["email", (item: any) => item.actorsAndAuthority.contact = "person@example.com"],
    ["phone", (item: any) => item.actorsAndAuthority.phone = "212-555-0199"],
    ["external path", (item: any) => item.commercialFacts.input = "/Users/someone/export.json"],
    ["production target", (item: any) => item.commercialFacts.databaseTarget = "production"],
    ["network intent", (item: any) => item.schedulingAndOperations.networkRetrievalIntent = true],
  ])("rejects %s before execution", async (_label, mutate) => {
    const scenario = base(); mutate(scenario);
    expect(() => assertSyntheticOnlyScenario(scenario)).toThrow();
    const executor = vi.fn();
    await expect(runCorpus([scenario], "synthetic-output", executor)).rejects.toThrow();
    expect(executor).not.toHaveBeenCalled();
  });
});

