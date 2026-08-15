import { resolve } from "node:path";
import { runCorpus } from "../src/business-replay/runner.js";
import { writeReplayArtifacts } from "../src/business-replay/report.js";
import { SYNTHETIC_SCENARIOS } from "../src/business-replay/synthetic-scenarios.js";

const outputRoot = resolve(process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ??
  process.env.P02_M16_B_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16b-output/verify-all");

const corpus = await runCorpus(SYNTHETIC_SCENARIOS, outputRoot);
await writeReplayArtifacts(outputRoot, corpus.scenarios, corpus.results, corpus.coverage, corpus.semanticOutcomeSha256);
process.stdout.write(`P02-M16-B synthetic corpus PASS\nscenarios=${corpus.scenarios.length}\nplatformExecuted=${corpus.results.filter((item) => item.executionMode === "PLATFORM_EXECUTED").length}\nsemanticSha256=${corpus.semanticOutcomeSha256}\n`);

