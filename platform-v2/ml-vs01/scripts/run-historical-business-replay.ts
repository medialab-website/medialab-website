import { resolve } from "node:path";
import { runHistoricalReplay } from "../src/historical-replay/index.js";
import { resolveLocalSourcePath } from "../src/local-source-config.js";

const vaultRoot = resolveLocalSourcePath("P02_M16_C_SOURCE_VAULT",
  process.argv.find((value) => value.startsWith("--vault-root="))?.slice(13));
const outputRoot = resolve(process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ??
  process.env.P02_M16_C_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16c-output/verify-all");

const result = await runHistoricalReplay(vaultRoot, outputRoot);
process.stdout.write(`P02-M16-C historical replay PASS\nscenarios=${result.scenarios.length}\nplatformExecuted=${result.results.filter((item) => item.executionMode === "PLATFORM_EXECUTED").length}\nsemanticSha256=${result.semanticOutcomeSha256}\n`);
