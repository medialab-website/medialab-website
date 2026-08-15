import { describe, expect, it, vi } from "vitest";
import { deterministicUuid, semanticSha256, stableJson } from "../src/business-replay/deterministic-ids.js";
import { runCorpus } from "../src/business-replay/runner.js";
import { SYNTHETIC_SCENARIOS } from "../src/business-replay/synthetic-scenarios.js";

describe("Business Replay determinism", () => {
  it("stabilizes IDs, object ordering, and complete classifier corpus semantics", async () => {
    expect(deterministicUuid("M16B", "scenario")).toBe(deterministicUuid("M16B", "scenario"));
    expect(stableJson({ b: 2, a: 1 })).toBe(stableJson({ a: 1, b: 2 }));
    expect(semanticSha256({ b: 2, a: 1 })).toBe(semanticSha256({ a: 1, b: 2 }));
    const scenarios = SYNTHETIC_SCENARIOS.filter((item) => item.executionMode !== "PLATFORM_EXECUTED");
    const first = await runCorpus(scenarios, "synthetic-output", vi.fn());
    const second = await runCorpus([...scenarios].reverse(), "synthetic-output", vi.fn());
    expect(first.semanticOutcomeSha256).toBe(second.semanticOutcomeSha256);
  });
});

