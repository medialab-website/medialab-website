import { resolve } from "node:path";
import { runCurrentEraIntakeReproof } from "../src/current-shadow/index.js";
import { resolveLocalSourcePath } from "../src/local-source-config.js";

const sourcePath = resolveLocalSourcePath("P02_M16_E_SOURCE_PATH",
  process.argv.find((value) => value.startsWith("--source-path="))?.slice(14));
const outputRoot = resolve(process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ??
  process.env.P02_M16_E_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16e-output/verify-all");

const result = await runCurrentEraIntakeReproof(sourcePath, outputRoot);
process.stdout.write([
  "P02-M16-E current-era intake re-proof PASS",
  "cohort=" + result.receipts.length,
  "orderReadback=" + result.receipts.filter((receipt) => receipt.orderCreated && receipt.orderReadBack).length,
  "semanticSha256=" + result.semanticResultSha256,
  "",
].join("\n"));
