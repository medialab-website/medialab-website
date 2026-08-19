import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCurrentEraIntakeReproof } from "../src/current-shadow/index.js";

const SOURCE_PATH = "/Volumes/MEDIALAB_OS/MediaLab Clean Room Build/APFS-Workspace/HistoricalReplay/2024_SOURCE_VAULT/ARYEO/Orders - Aug 15 2026.xlsx";

describe("P02-M16-E current-era runtime-intake re-proof", () => {
  it("reconstructs the exact 42-member cohort with returned canonical identities and no fixture substitution", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "m16e-focused-reproof-"));
    const result = await runCurrentEraIntakeReproof(SOURCE_PATH, outputRoot);

    expect(result.receipts).toHaveLength(42);
    expect(result.receipts.filter((receipt) => receipt.customerOutcome === "CREATED")).toHaveLength(9);
    expect(result.receipts.filter((receipt) => receipt.customerOutcome === "REUSED")).toHaveLength(33);
    expect(result.receipts.filter((receipt) => receipt.propertyOutcome === "PROPERTY_CREATED")).toHaveLength(40);
    expect(result.receipts.filter((receipt) => receipt.propertyOutcome === "PROPERTY_REUSED")).toHaveLength(1);
    expect(result.receipts.filter((receipt) => receipt.snapshotOutcome === "SNAPSHOT_CREATED")).toHaveLength(40);
    expect(result.receipts.filter((receipt) => receipt.snapshotOutcome === "SNAPSHOT_REUSED")).toHaveLength(1);
    expect(result.receipts.filter((receipt) => receipt.orderCreated && receipt.orderReadBack)).toHaveLength(41);
    expect(result.receipts.filter((receipt) => receipt.classification === "MATCH")).toHaveLength(41);
    expect(result.receipts.filter((receipt) => receipt.classification === "AMBIGUOUS_EVIDENCE")).toHaveLength(1);
    expect(result.receipts.every((receipt) => !receipt.fixtureCustomerPersonUsed &&
      !receipt.fixturePropertyUsed && !receipt.fixturePropertySnapshotUsed && !receipt.propertyHubCreated)).toBe(true);
    expect(result.receipts.filter((receipt) => receipt.orderReadBack).every((receipt) =>
      receipt.customerPartyReferenceMatches && receipt.propertyReferenceMatches &&
      receipt.snapshotReferenceMatches && receipt.sourceLineCardinalityRepresented)).toBe(true);
    expect(result.semanticResultSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
