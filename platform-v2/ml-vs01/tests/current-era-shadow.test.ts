import { afterAll, describe, expect, it } from "vitest";
import { runCurrentEraShadow } from "../src/current-shadow/index.js";
import { resetCurrentShadowDatabase } from "../src/current-shadow/database.js";
import { loadCurrentEraCohort, selectPilot } from "../src/current-shadow/source.js";
import { scanHistoricalPrivacyArtifact, scanHistoricalPrivacyArtifacts } from "../src/historical-replay/privacy.js";
import { resolveLocalSourcePath } from "../src/local-source-config.js";

const source = resolveLocalSourcePath("P02_M16_D_SOURCE_PATH");

describe("P02-M16-D current-era controlled shadow", () => {
  afterAll(async () => { await resetCurrentShadowDatabase(); });

  it("establishes the exact 42-member cohort and deterministic six-member structural pilot without raw identities", async () => {
    const first = await loadCurrentEraCohort(source); const second = await loadCurrentEraCohort(source);
    expect(first.sourceProfile.cohortMemberCount).toBe(42);
    expect(first.sourceProfile.postCutoffWithinHorizonRowCount).toBe(44);
    expect(first.identityProof.membership).toHaveLength(42);
    expect(first.identityProof.membership.every((item) => /^[0-9a-f]{64}$/.test(item.opaqueSourceReferenceHash))).toBe(true);
    expect(first.identityProof.rawIdentifiersIncluded).toBe(false);
    expect(selectPilot(first.listings)).toEqual(selectPilot(second.listings));
    expect(selectPilot(first.listings).selected).toHaveLength(6);
  });

  it("executes all 42 through supported Platform commands while preserving the no-Property-Hub and no-market-status boundary", async () => {
    const output = "/tmp/mlvs01-p02m16d-focused-test-output";
    const result = await runCurrentEraShadow(source, output);
    expect(result.receipts).toHaveLength(42);
    expect(result.receipts.every((item) => item.platformBackedAttempted && item.orderCreated && item.orderReadBack)).toBe(true);
    expect(result.receipts.every((item) => item.sourceLineCardinalityRepresented && item.financialEligibilityMeaningRepresented)).toBe(true);
    expect(result.receipts.every((item) => !item.propertyHubCreated && item.marketStatusEvidence === "MARKET_STATUS_NOT_AVAILABLE")).toBe(true);
    expect(result.receipts.every((item) => item.classification === "IMPLEMENTATION_GAP")).toBe(true);
    expect((await scanHistoricalPrivacyArtifacts(output)).hits).toEqual([]);
  });

  it("keeps genuine phone and external-system key controls fail-closed", () => {
    const phone = scanHistoricalPrivacyArtifact("control.json", JSON.stringify({ contact: "202-555-0142" }));
    const externalKey = scanHistoricalPrivacyArtifact("control.json", JSON.stringify({ stripePaymentId: "pi_synthetic123456" }));
    expect(phone.hits.some((hit) => hit.rule === "PHONE_LIKE")).toBe(true);
    expect(externalKey.hits.some((hit) => hit.rule === "PROVIDER_ID_LIKE")).toBe(true);
  });
});
