import { resolve } from "node:path";
import { runCurrentEraShadow } from "../src/current-shadow/index.js";

const sourcePath = resolve(process.argv.find((value) => value.startsWith("--source-path="))?.slice(14) ??
  process.env.P02_M16_D_SOURCE_PATH ??
  "/Volumes/MEDIALAB_OS/MediaLab Clean Room Build/APFS-Workspace/HistoricalReplay/2024_SOURCE_VAULT/ARYEO/Orders - Aug 15 2026.xlsx");
const outputRoot = resolve(process.argv.find((value) => value.startsWith("--output-root="))?.slice(14) ??
  process.env.P02_M16_D_OUTPUT_ROOT ?? "/tmp/mlvs01-p02m16d-output/verify-all");

const result = await runCurrentEraShadow(sourcePath, outputRoot);
process.stdout.write(`P02-M16-D current-era shadow PASS\ncohort=${result.listings.length}\nplatformBacked=${result.receipts.length}\npilot=${result.pilot.selected.length}\nsemanticSha256=${result.semanticResultSha256}\n`);
