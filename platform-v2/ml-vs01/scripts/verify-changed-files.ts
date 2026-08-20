import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  P02_M17_A_ALLOWLIST,
  compareExactPathSets,
  readCandidateStatus,
  readChangedFilesInventory,
  validateCandidateStatus,
} from "./p02-m17-a-changed-files.js";
import { P02_M16_C_ALLOWLIST } from "./p02-m16-c-changed-files.js";

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(baseDir, "../..");
const states = readCandidateStatus(repoRoot);
const actualPaths = states.map((state) => state.path).sort();
const documentedPaths = readChangedFilesInventory(path.join(baseDir, "CHANGED_FILES.md")).sort();
const failures = [
  ...validateCandidateStatus(states),
  ...compareExactPathSets(actualPaths, documentedPaths),
];

if (
  P02_M16_C_ALLOWLIST.length !== 16 ||
  P02_M16_C_ALLOWLIST.some((candidatePath) => !candidatePath.startsWith("platform-v2/ml-vs01/"))
) {
  failures.push("predecessor P02-M16-C centralized boundary invalid");
}

if (actualPaths.length === 0) failures.push("candidate has no changed paths");
for (const documented of documentedPaths) {
  if (!P02_M17_A_ALLOWLIST.includes(documented)) {
    failures.push(`CHANGED_FILES.md path '${documented}' is outside the exact P02-M17-A allowlist`);
  }
}

const result = {
  verifier: "P02-M17-A_CHANGED_FILES_V1",
  pass: failures.length === 0,
  porcelain: "v2-z-repository-wide",
  candidateMode: "uncommitted-unstaged-only",
  allowlistMaximum: P02_M17_A_ALLOWLIST.length,
  actualCount: actualPaths.length,
  documentedCount: documentedPaths.length,
  changedPaths: actualPaths,
  allOtherPathsUnchanged: states.length === actualPaths.length && failures.every((failure) => !failure.includes("outside")),
  failures,
};

console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exit(1);
