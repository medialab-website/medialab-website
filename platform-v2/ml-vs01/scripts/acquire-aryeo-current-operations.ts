import { resolve } from "node:path";
import { acquireAryeoCurrentOperations, readAryeoApiKeyFromEnvFile } from "../src/current-admission/aryeo-acquisition.js";

function requiredArgument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`ARYEO_ACQUISITION_ARGUMENT_REQUIRED: --${name}=...`);
  return resolve(value);
}

const envFile = requiredArgument("env-file");
const outputRoot = requiredArgument("output-root");
const apiKey = await readAryeoApiKeyFromEnvFile(envFile);
const manifest = await acquireAryeoCurrentOperations({ apiKey, outputRoot });

process.stdout.write([
  "Aryeo current-operations acquisition PASS",
  `datasets=${manifest.allowlistedDatasetCount}`,
  `records=${manifest.totalRecords}`,
  ...manifest.datasetFiles.map((file) => `${file.datasetId}=${file.recordCount}`),
  "providerMutations=0",
  "secretMaterialIncluded=false",
  "",
].join("\n"));
