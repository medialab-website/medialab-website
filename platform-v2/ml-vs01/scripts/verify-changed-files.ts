import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareExactPathSets, readCandidateStatus, readChangedFilesInventory } from "./p02-m17-a-changed-files.js";

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(baseDir, "../..");
const states = readCandidateStatus(repoRoot);
const actualPaths = states.map((state) => state.path).sort();
const documentedPaths = readChangedFilesInventory(path.join(baseDir, "CHANGED_FILES.md")).sort();
const failures = compareExactPathSets(actualPaths, documentedPaths);
const root = "platform-v2/ml-vs01/";

for (const state of states) {
  if (state.kind === "unsupported") failures.push(`unsupported Git state for '${state.path}'`);
  if (state.kind === "modified" && (state.indexStatus !== "." || state.worktreeStatus !== "M")) {
    failures.push(`'${state.path}' is not an unstaged tracked modification`);
  }
  if (!state.path.startsWith(root)) failures.push(`'${state.path}' is outside the bounded module`);
  if (/(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.cache|__pycache__)(?:\/|$)/u.test(state.path)) {
    failures.push(`generated or vendored path '${state.path}' is prohibited`);
  }
  if (state.path.endsWith("package-lock.json")) failures.push("package-lock.json must remain byte-identical");
  const relative = state.path.slice(root.length);
  const allowed = ["BUILD_STATE.md", "CHANGED_FILES.md", "package.json", "db/migrate.ts",
    "db/migrations/0024_operations_home_scheduling_assignment_console.sql",
    "db/migrations/0025_operations_mission_plan_draft_controls.sql"].includes(relative)
    || relative.startsWith("src/operations-console/")
    || (relative.startsWith("tests/") && relative.endsWith(".test.ts"))
    || (relative.startsWith("scripts/") && relative.endsWith(".ts"));
  if (!allowed) failures.push(`'${state.path}' is outside the M18-A file-category boundary`);
}
if (actualPaths.length === 0) failures.push("candidate has no changed paths");

const result = {
  verifier: "P02-M19-A_CHANGED_FILES_V1",
  pass: failures.length === 0,
  candidateMode: "uncommitted-unstaged-only",
  actualCount: actualPaths.length,
  documentedCount: documentedPaths.length,
  changedPaths: actualPaths,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exit(1);
