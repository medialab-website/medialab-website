import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTRACT_FAMILIES, OPERATIONAL_PILOT_SCHEMA, assertSafeEvidence, assertVersionedContract, contract } from "../src/operational-pilot/contracts.js";
import { createSyntheticMedia, deterministicPng } from "../src/operational-pilot/fixture-media.js";
import { EXPECTED_OUTCOME, compareReplay, renderAcceptanceMatrix } from "../src/operational-pilot/replay-contract.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("P02-M16-A versioned contracts and deterministic fixtures", () => {
  it("declares every required contract family under one explicit schema", () => {
    expect(OPERATIONAL_PILOT_SCHEMA).toBe("ML_OPERATIONAL_PILOT_V1"); expect(CONTRACT_FAMILIES.length).toBeGreaterThanOrEqual(32);
    expect(new Set(CONTRACT_FAMILIES).size).toBe(CONTRACT_FAMILIES.length);
  });
  it("rejects unknown versions, missing IDs, paths, URLs, secrets, and caller authority", () => {
    expect(() => assertVersionedContract({ schema: "V2", contract: "OperationalPilotScenarioV1" })).toThrow(/unknown/);
    expect(() => assertVersionedContract(contract("OperationalPilotScenarioV1", {}), ["jobId"])).toThrow(/canonical id/);
    for (const unsafe of [{ role: "owner" }, { path: "/Users/example/media.png" }, { link: "https://example.invalid" }, { sessionToken: "value" }, { provider_payload: "value" }]) {
      expect(() => assertSafeEvidence(unsafe)).toThrow(/unsafe|authority|forbidden/);
    }
  });
  it("generates byte-identical valid bounded PNG fixtures", async () => {
    const first = await mkdtemp(join(tmpdir(), "m16a-fixture-a-")); const second = await mkdtemp(join(tmpdir(), "m16a-fixture-b-")); roots.push(first, second);
    const one = await createSyntheticMedia(first); const two = await createSyntheticMedia(second); expect(one).toEqual(two); expect(one).toHaveLength(12);
    for (const item of one) { const bytes = await readFile(join(first, item.objectIdentifier)); expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10])); expect(bytes.length).toBeLessThan(1_048_576); }
    expect(deterministicPng(9)).toEqual(deterministicPng(9)); expect(deterministicPng(9)).not.toEqual(deterministicPng(10));
  });
  it("keeps expected outcomes separate and rejects incomplete acceptance matrices", () => {
    const observed = structuredClone(EXPECTED_OUTCOME) as unknown as Record<string, unknown>; expect(compareReplay(observed).pass).toBe(true);
    expect(compareReplay({ ...observed, originals: 5 }).pass).toBe(false);
    expect(() => renderAcceptanceMatrix([])).toThrow(/incomplete/);
    const rows = Array.from({ length: 104 }, (_, index) => ({ id: index + 1, behavior: `Required behavior ${index + 1}`,
      implementationSurface: "R69 surface", test: "Focused test", pass: true, recoveryProof: "Replay evidence", remainingGap: "None" }));
    const matrix = renderAcceptanceMatrix(rows); expect(JSON.parse(matrix.json).rows).toHaveLength(104); expect(matrix.markdown.match(/\| PASS \|/g)).toHaveLength(104);
    expect(matrix.markdown).toContain("| REQUIRED BEHAVIOR | R69 IMPLEMENTATION SURFACE | TEST | RESULT | RECOVERY PROOF | REMAINING GAP |");
  });
});
