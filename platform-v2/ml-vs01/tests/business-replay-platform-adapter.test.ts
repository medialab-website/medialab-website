import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLATFORM_ADAPTER_COMMANDS } from "../src/business-replay/platform-adapter.js";
import { PLATFORM_SCENARIO_IDS } from "../src/business-replay/synthetic-scenarios.js";

describe("Business Replay R71 Platform adapter", () => {
  it("declares exactly the three required Platform-backed scenarios and accepted command surfaces", () => {
    expect(PLATFORM_SCENARIO_IDS).toEqual([
      "M16B_PLATFORM_BASELINE_QUICK_EDIT_V1", "M16B_PLATFORM_NEEDS_REVIEW_V1", "M16B_PLATFORM_RESCHEDULE_V1",
    ]);
    expect(PLATFORM_ADAPTER_COMMANDS).toContain("M16A_GOLDEN_PATH_QUICK_EDIT_V1");
    expect(PLATFORM_ADAPTER_COMMANDS).toContain("supersede_and_reschedule_appointment");
  });

  it("limits direct DML to accepted synthetic session bootstrap and contains no provider/network client", () => {
    const source = readFileSync(new URL("../src/business-replay/platform-adapter.ts", import.meta.url), "utf8");
    const dml = source.match(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?medialab_core\.[a-z_]+/gi) ?? [];
    expect(dml).toEqual(["INSERT INTO medialab_core.development_sessions"]);
    expect(source).not.toMatch(/\bfetch\s*\(|axios|node-fetch|undici/);
  });
});
