import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = "platform-v2/ml-vs01/";

export const P02_M17_A_BASE_COMMIT = "2593991bf70e1b8fce4f49998c637c28b6b8decb";
export const P02_M17_A_BASE_TREE = "785511300f717cc8c623862e0066e8676aec1677";
export const P02_M17_A_MAIN_COMMIT = "28517e4d2131014cfdf090fa3aa40d6bcf7b6398";
export const P02_M17_A_BRANCH = "platform-v2-p02-m17-a-internal-operations-console-r01";
export const P02_M17_A_PACKAGE_LOCK_SHA256 = "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a";

export const P02_M17_A_ALLOWLIST = [
  "BUILD_STATE.md",
  "CHANGED_FILES.md",
  "package.json",
  "scripts/p02-m17-a-changed-files.ts",
  "scripts/run-internal-operations-console-new-listing.ts",
  "scripts/verify-internal-operations-console-new-listing.ts",
  "scripts/verify-changed-files.ts",
  "scripts/verify-foundation-closeout.ts",
  "src/operations-console/app.ts",
  "src/operations-console/contracts.ts",
  "src/operations-console/database.ts",
  "src/operations-console/errors.ts",
  "src/operations-console/service.ts",
  "src/operations-console/session.ts",
  "src/operations-console/server.ts",
  "src/operations-console/public/index.html",
  "src/operations-console/public/app.js",
  "src/operations-console/public/styles.css",
  "tests/operations-console-contracts.test.ts",
  "tests/operations-console-catalog.test.ts",
  "tests/operations-console-transaction.test.ts",
  "tests/operations-console-idempotency.test.ts",
  "tests/operations-console-security.test.ts",
  "tests/operations-console-ui.test.ts",
].map((entry) => `${root}${entry}`);

export const P02_M17_A_REQUIRED_ROUTES = [
  "GET /health",
  "POST /session",
  "GET /api/catalog",
  "POST /api/listings/preview",
  "POST /api/listings",
  "GET /api/orders/:orderId",
  "GET /",
  "GET /app.js",
  "GET /styles.css",
] as const;

export const P02_M17_A_REQUIRED_CONTRACTS = [
  "OperationsConsoleHealthV1",
  "DevelopmentOperatorSessionReceiptV1",
  "SelectableCatalogV1",
  "ListingPreviewRequestV1",
  "ListingPreviewV1",
  "CreateListingRequestV1",
  "ListingCreationReceiptV1",
  "CanonicalOrderConfirmationV1",
  "OperationsConsoleErrorV1",
] as const;

export const P02_M17_A_TEST_PATHS = P02_M17_A_ALLOWLIST.filter((entry) => entry.includes("/tests/"));

if (P02_M17_A_ALLOWLIST.length !== 24 || new Set(P02_M17_A_ALLOWLIST).size !== 24) {
  throw new Error("P02-M17-A maximum allowlist must contain exactly 24 unique paths");
}

export interface CandidatePathState {
  kind: "modified" | "untracked" | "unsupported";
  path: string;
  raw: string;
  indexStatus?: string;
  worktreeStatus?: string;
  originalPath?: string;
}

export function readCandidateStatus(repoRoot: string): CandidatePathState[] {
  const raw = execFileSync(
    "git",
    ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const records = raw.split("\0");
  const result: CandidatePathState[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith("1 ")) {
      const match = /^1 ([^ ]{2}) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/s.exec(record);
      if (!match) {
        result.push({ kind: "unsupported", path: "<unparseable>", raw: record });
        continue;
      }
      result.push({
        kind: "modified",
        path: match[8],
        raw: record,
        indexStatus: match[1][0],
        worktreeStatus: match[1][1],
      });
      continue;
    }

    if (record.startsWith("? ")) {
      result.push({ kind: "untracked", path: record.slice(2), raw: record, indexStatus: "?", worktreeStatus: "?" });
      continue;
    }

    if (record.startsWith("2 ")) {
      const path = record.split(" ").slice(9).join(" ");
      const originalPath = records[index + 1] ?? "<missing-original-path>";
      index += 1;
      result.push({ kind: "unsupported", path, originalPath, raw: record });
      continue;
    }

    const path = record.startsWith("u ") ? record.split(" ").slice(11).join(" ") : record.slice(2);
    result.push({ kind: "unsupported", path, raw: record });
  }

  return result;
}

export function validateCandidateStatus(states: CandidatePathState[]): string[] {
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const state of states) {
    if (state.kind === "unsupported") {
      failures.push(`unsupported Git status record for '${state.path}': rename/copy/delete/conflict/type change is prohibited`);
      continue;
    }
    if (state.kind === "modified" && (state.indexStatus !== "." || state.worktreeStatus !== "M")) {
      failures.push(`path '${state.path}' is not an unstaged-only tracked modification (status ${state.indexStatus}${state.worktreeStatus})`);
    }
    if (state.kind === "untracked" && (state.indexStatus !== "?" || state.worktreeStatus !== "?")) {
      failures.push(`path '${state.path}' has an invalid untracked status`);
    }
    if (!P02_M17_A_ALLOWLIST.includes(state.path)) {
      failures.push(`path '${state.path}' is outside the exact P02-M17-A 24-path maximum allowlist`);
    }
    if (seen.has(state.path)) failures.push(`duplicate Git status path '${state.path}'`);
    seen.add(state.path);
    if (/(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.cache|__pycache__)(?:\/|$)/.test(state.path)) {
      failures.push(`vendored or generated path '${state.path}' is prohibited`);
    }
    if (state.path.split("/").some((part) => part.startsWith(".") && part !== ".well-known")) {
      failures.push(`hidden candidate path '${state.path}' is prohibited`);
    }
  }

  return failures;
}

export function readChangedFilesInventory(changedFilesPath: string): string[] {
  const content = readFileSync(changedFilesPath, "utf8");
  const inventory: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const bullet = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (!bullet) continue;
    const value = bullet[1].startsWith("`") && bullet[1].endsWith("`")
      ? bullet[1].slice(1, -1)
      : bullet[1];
    inventory.push(value);
  }
  return inventory;
}

export function compareExactPathSets(actual: string[], documented: string[]): string[] {
  const failures: string[] = [];
  const actualSet = new Set(actual);
  const documentedSet = new Set(documented);
  if (actualSet.size !== actual.length) failures.push("actual Git path set contains duplicates");
  if (documentedSet.size !== documented.length) failures.push("CHANGED_FILES.md contains duplicate bullets");
  for (const entry of actualSet) if (!documentedSet.has(entry)) failures.push(`CHANGED_FILES.md omits '${entry}'`);
  for (const entry of documentedSet) if (!actualSet.has(entry)) failures.push(`CHANGED_FILES.md lists non-candidate path '${entry}'`);
  return failures;
}
