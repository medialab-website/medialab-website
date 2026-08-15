const root = "platform-v2/ml-vs01/";

export const P02_M16_C_ALLOWLIST = [
  "BUILD_STATE.md",
  "CHANGED_FILES.md",
  "package.json",
  "scripts/p02-m16-c-changed-files.ts",
  "scripts/run-historical-business-replay.ts",
  "scripts/verify-business-replay-harness.ts",
  "scripts/verify-changed-files.ts",
  "scripts/verify-foundation-closeout.ts",
  "scripts/verify-historical-business-replay.ts",
  "src/business-replay/contracts.ts",
  "src/business-replay/platform-adapter.ts",
  "src/business-replay/sanitization.ts",
  "src/business-replay/scenario.ts",
  "src/historical-replay/index.ts",
  "src/historical-replay/privacy.ts",
  "tests/historical-business-replay.test.ts",
].map((entry) => `${root}${entry}`);

if (P02_M16_C_ALLOWLIST.length !== 16 || new Set(P02_M16_C_ALLOWLIST).size !== 16) {
  throw new Error("P02-M16-C allowlist must contain exactly 16 unique paths");
}
