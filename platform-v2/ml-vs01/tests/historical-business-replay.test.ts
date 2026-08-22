import { describe, expect, it, vi } from "vitest";
import { observed } from "../src/business-replay/contracts.js";
import { runCorpus } from "../src/business-replay/runner.js";
import { assertReplayScenarioSafety } from "../src/business-replay/sanitization.js";
import { normalizeHistoricalCorpus } from "../src/historical-replay/index.js";
import { scanHistoricalPrivacyArtifact, scanHistoricalPrivacyArtifacts } from "../src/historical-replay/privacy.js";
import { resolveLocalSourcePath } from "../src/local-source-config.js";

const vault = resolveLocalSourcePath("P02_M16_C_SOURCE_VAULT");

describe("P02-M16-C historical normalization", () => {
  it("accepts only sanitized historical-normalized scenarios and preserves source limitations", async () => {
    const normalized = await normalizeHistoricalCorpus(vault);
    expect(normalized.scenarios.length).toBeGreaterThanOrEqual(18);
    expect(normalized.scenarios.every((scenario) => scenario.provenanceClassification === "HISTORICAL_NORMALIZED")).toBe(true);
    expect(normalized.profile.aggregateFacts.itemizedProcessorRows).toBe(0);
    expect(normalized.reconciliation.balanceSummaryUsage).toBe("AGGREGATE_FALLBACK_ONLY");
    expect(normalized.reconciliation.forcedMatches).toBe(0);
    for (const scenario of normalized.scenarios) expect(() => assertReplayScenarioSafety(scenario)).not.toThrow();
  });

  it("rejects shadow, direct PII, provider identifiers, paths, network intent, and production targets before execution", async () => {
    const normalized = await normalizeHistoricalCorpus(vault);
    const base = normalized.scenarios.find((scenario) => scenario.executionMode === "CLASSIFIER_ONLY")!;
    const mutations: ((scenario: any) => void)[] = [
      (scenario) => scenario.provenanceClassification = "CURRENT_SHADOW_NORMALIZED",
      (scenario) => scenario.actorsAndAuthority.email = "person@example.com",
      (scenario) => scenario.actorsAndAuthority.phone = "212-555-0199",
      (scenario) => scenario.commercialFacts.providerRecordId = "raw-provider-id",
      (scenario) => scenario.commercialFacts.sourcePath = "/Users/someone/raw.csv",
      (scenario) => scenario.schedulingAndOperations.networkRetrievalIntent = true,
      (scenario) => scenario.commercialFacts.databaseTarget = "production",
    ];
    for (const mutate of mutations) {
      const scenario = structuredClone(base); mutate(scenario);
      const executor = vi.fn();
      await expect(runCorpus([scenario], "historical-output", executor)).rejects.toThrow();
      expect(executor).not.toHaveBeenCalled();
    }
  });

  it("produces identical semantic results across two clean normalized runs", async () => {
    const first = await normalizeHistoricalCorpus(vault); const second = await normalizeHistoricalCorpus(vault);
    const fake = async (scenario: any) => observed([
      { field: "comparisonPass", value: true, source: "PLATFORM_OBSERVED" },
      { field: "originals", value: 6, source: "PLATFORM_OBSERVED" },
      { field: "selected", value: 5, source: "PLATFORM_OBSERVED" },
      { field: "finalVersions", value: 5, source: "PLATFORM_OBSERVED" },
      { field: "exactDownloads", value: 2, source: "PLATFORM_OBSERVED" },
    ], [scenario.platformExecutionTemplateId]);
    const run1 = await runCorpus(first.scenarios, "/tmp/m16c-test-run-1", fake);
    const run2 = await runCorpus(second.scenarios, "/tmp/m16c-test-run-2", fake);
    expect(run1.semanticOutcomeSha256).toBe(run2.semanticOutcomeSha256);
    expect(run1.scenarios).toEqual(run2.scenarios);
  });

  it("recognizes only complete validated hashes in exact canonical hash fields", () => {
    const hashWithPhoneLikeRun = `abcd1234567890${"a".repeat(50)}`;
    const accepted = scanHistoricalPrivacyArtifact("evidence.json", JSON.stringify({ artifactSha256: hashWithPhoneLikeRun }));
    expect(accepted.hits).toEqual([]);
    expect(accepted.validatedCanonicalHashValueCount).toBe(1);

    const nonHashField = scanHistoricalPrivacyArtifact("evidence.json", JSON.stringify({ note: hashWithPhoneLikeRun }));
    expect(nonHashField.hits.some((hit) => hit.rule === "PHONE_LIKE")).toBe(true);

    const malformedHash = scanHistoricalPrivacyArtifact("evidence.json", JSON.stringify({ artifactSha256: `${hashWithPhoneLikeRun}z` }));
    expect(malformedHash.validatedCanonicalHashValueCount).toBe(0);
    expect(malformedHash.hits.some((hit) => hit.rule === "PHONE_LIKE")).toBe(true);
  });

  it("keeps genuine phone and provider identifiers fail-closed while bounding HTML text nodes", () => {
    const phone = scanHistoricalPrivacyArtifact("fixture.json", JSON.stringify({ contact: "202-555-0142" }));
    expect(phone.hits.some((hit) => hit.rule === "PHONE_LIKE")).toBe(true);

    const providerJson = scanHistoricalPrivacyArtifact("fixture.json", JSON.stringify({ stripePaymentId: "pi_synthetic123456" }));
    expect(providerJson.hits.some((hit) => hit.rule === "PROVIDER_ID_LIKE")).toBe(true);

    const visibleProvider = scanHistoricalPrivacyArtifact("fixture.html", "<p>Aryeo payment ID: synthetic-value</p>");
    expect(visibleProvider.hits.some((hit) => hit.rule === "PROVIDER_ID_LIKE")).toBe(true);

    const crossTag = scanHistoricalPrivacyArtifact("fixture.html", "<p>provider-neutral</p><section>customer identity</section>");
    expect(crossTag.hits.some((hit) => hit.rule === "PROVIDER_ID_LIKE")).toBe(false);
  });

  it("clears all 14 original false-positive occurrences in the preserved first-run artifacts", async () => {
    const output = process.env.P02_M16_C_PRESERVED_RUN_1 ?? "/tmp/mlvs01-p02m16c-output/run-1";
    const scan = await scanHistoricalPrivacyArtifacts(output);
    expect(scan.hits).toEqual([]);
    expect(scan.scannedArtifactCount).toBe(34);
    expect(scan.validatedCanonicalHashValueCount).toBeGreaterThan(0);
  });
});
