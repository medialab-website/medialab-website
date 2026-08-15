import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCorpus } from "../src/business-replay/runner.js";
import { writeReplayArtifacts } from "../src/business-replay/report.js";
import { SYNTHETIC_SCENARIOS } from "../src/business-replay/synthetic-scenarios.js";

describe("offline Business Replay report", () => {
  it("writes JSON, Markdown, HTML, coverage, and acceptance artifacts without external resources", async () => {
    const scenarios = SYNTHETIC_SCENARIOS.filter((item) => item.executionMode !== "PLATFORM_EXECUTED");
    const corpus = await runCorpus(scenarios, "synthetic-output");
    const root = await mkdtemp(join(tmpdir(), "m16b-report-"));
    await writeReplayArtifacts(root, corpus.scenarios, corpus.results, corpus.coverage, corpus.semanticOutcomeSha256);
    const html = await readFile(join(root, "BUSINESS_REPLAY_REPORT.html"), "utf8");
    expect(html).toContain("SYNTHETIC-ONLY");
    expect(html).toContain("CLASSIFIER_ONLY");
    expect(html).toContain("DEFERRED_NOT_EXECUTED");
    expect(html).not.toMatch(/<script\s+src=|<link\s+[^>]*href=/i);
    expect(await readFile(join(root, "BUSINESS_REPLAY_COVERAGE_MATRIX.json"), "utf8")).toContain("BusinessScenarioCoverageMatrixV1");
    expect(await readFile(join(root, "BUSINESS_REPLAY_HARNESS_ACCEPTANCE_MATRIX.md"), "utf8")).toContain("REQUIRED BEHAVIOR");
  });
});

