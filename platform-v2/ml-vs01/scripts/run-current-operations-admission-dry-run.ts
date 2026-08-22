import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { loadAndNormalizeAryeoSnapshot } from "../src/current-admission/normalization.js";

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`M23A_ARGUMENT_REQUIRED: --${name}=...`);
  return value;
}

async function newOutputRoot(input: string): Promise<{ root: string; temporaryRoot: string }> {
  if (!isAbsolute(input)) throw new Error("M23A_OUTPUT_BOUNDARY_FAILURE: output root must be absolute");
  const root = resolve(input);
  const parent = dirname(root);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error("M23A_OUTPUT_BOUNDARY_FAILURE: output parent must be a canonical non-symlink directory");
  }
  try {
    await lstat(root);
    throw new Error("M23A_OUTPUT_BOUNDARY_FAILURE: output root already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { root, temporaryRoot: join(parent, `.${root.split("/").at(-1)}.partial-${process.pid}-${randomUUID()}`) };
}

const sourceRoot = argument("source-root");
const boundary = await newOutputRoot(argument("output-root"));
try {
  const { receipt } = await loadAndNormalizeAryeoSnapshot(sourceRoot);
  await mkdir(boundary.temporaryRoot, { mode: 0o700 });
  await writeFile(join(boundary.temporaryRoot, "ADMISSION_DRY_RUN_RECEIPT.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8", mode: 0o600, flag: "wx",
  });
  const summary = [
    "# P02-M23-A Current Operations Admission Dry Run",
    "",
    `- Aryeo Listings preserved: ${receipt.sourceCounts.listings}`,
    `- Aryeo Orders preserved: ${receipt.sourceCounts.orders}`,
    `- Aryeo Appointments preserved: ${receipt.sourceCounts.appointments}`,
    `- Current Home Package Orders: ${receipt.classificationCounts.CURRENT_HOME_PACKAGE}`,
    `- Current Home Package Orders ready for canonical admission: ${receipt.admissionReadiness.currentHomePackageReady}`,
    `- Legacy-service Orders: ${receipt.classificationCounts.LEGACY_SERVICES}`,
    `- Legacy-service Orders ready for canonical admission: ${receipt.admissionReadiness.legacyServicesReady}`,
    `- Exact source Order total: $${(receipt.exactOrderTotalCents / 100).toFixed(2)}`,
    `- Provider mutations: ${receipt.providerMutationCount}`,
    `- Customer PII in receipt: ${receipt.containsCustomerPii}`,
    `- Semantic SHA-256: ${receipt.semanticSha256}`,
    "",
    "Every Order remains preserved. Home Package classification selects the current operating model; older and one-off service structures remain explicitly classified as legacy rather than being rewritten.",
    "",
  ].join("\n");
  await writeFile(join(boundary.temporaryRoot, "OWNER_SUMMARY.md"), summary, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(boundary.temporaryRoot, boundary.root);
  console.log("Current operations admission dry run PASS");
  console.log(`listings=${receipt.sourceCounts.listings}`);
  console.log(`orders=${receipt.sourceCounts.orders}`);
  console.log(`appointments=${receipt.sourceCounts.appointments}`);
  console.log(`currentHomePackageOrders=${receipt.classificationCounts.CURRENT_HOME_PACKAGE}`);
  console.log(`currentHomePackageReady=${receipt.admissionReadiness.currentHomePackageReady}`);
  console.log(`legacyServiceOrders=${receipt.classificationCounts.LEGACY_SERVICES}`);
  console.log(`legacyServicesReady=${receipt.admissionReadiness.legacyServicesReady}`);
  console.log(`semanticSha256=${receipt.semanticSha256}`);
} catch (error) {
  await rm(boundary.temporaryRoot, { recursive: true, force: true });
  throw error;
}
