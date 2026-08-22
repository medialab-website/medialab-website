import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareExactPathSets, readCandidateStatus, readChangedFilesInventory } from "./p02-m17-a-changed-files.js";

const MODULE_ROOT = "platform-v2/ml-vs01/";
const EXPECTED_PATH_COUNT = 83;
const EXPECTED_INVENTORY_SHA256 = "f2e96555dbb2a21bc52568e2c2cfa6219d71a6646951593dc542c7d1f7504cbf";
const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(baseDir, "../..");
const states = readCandidateStatus(repoRoot);
const actualPaths = states.map((state) => state.path).sort();
const documentedPaths = readChangedFilesInventory(path.join(baseDir, "CHANGED_FILES.md")).sort();
const documentedHash = createHash("sha256").update(`${documentedPaths.join("\n")}\n`, "utf8").digest("hex");
const failures = compareExactPathSets(actualPaths, documentedPaths);

if (documentedPaths.length !== EXPECTED_PATH_COUNT || documentedHash !== EXPECTED_INVENTORY_SHA256) {
  failures.push(`P02-M22-A exact path inventory mismatch: count=${documentedPaths.length} sha256=${documentedHash}`);
}
for (const state of states) {
  if (state.kind === "unsupported") failures.push(`unsupported Git state for '${state.path}'`);
  if (state.kind === "modified" && (state.indexStatus !== "." || state.worktreeStatus !== "M")) {
    failures.push(`'${state.path}' is not an unstaged tracked modification`);
  }
  if (state.kind === "untracked" && (state.indexStatus !== "?" || state.worktreeStatus !== "?")) {
    failures.push(`'${state.path}' has an invalid untracked state`);
  }
  if (!state.path.startsWith(MODULE_ROOT)) failures.push(`'${state.path}' is outside the bounded module`);
  if (/(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.cache|__pycache__)(?:\/|$)/u.test(state.path)) {
    failures.push(`generated or vendored path '${state.path}' is prohibited`);
  }
  if (state.path.endsWith("package-lock.json")) failures.push("package-lock.json must remain byte-identical");
}
if (actualPaths.length !== EXPECTED_PATH_COUNT) failures.push(`candidate path count is ${actualPaths.length}, expected ${EXPECTED_PATH_COUNT}`);

const result = {
  verifier: "P02-M22-A_CHANGED_FILES_V1",
  pass: failures.length === 0,
  candidateMode: "uncommitted-unstaged-plus-bounded-new-files",
  inventorySha256: documentedHash,
  actualCount: actualPaths.length,
  documentedCount: documentedPaths.length,
  changedPaths: actualPaths,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exit(1);
