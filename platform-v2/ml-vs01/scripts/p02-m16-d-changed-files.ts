const root = "platform-v2/ml-vs01/";

export const P02_M16_D_ALLOWLIST = [
  "BUILD_STATE.md",
  "CHANGED_FILES.md",
  "package.json",
  "scripts/p02-m16-d-changed-files.ts",
  "scripts/run-current-era-shadow.ts",
  "scripts/verify-changed-files.ts",
  "scripts/verify-current-era-shadow.ts",
  "scripts/verify-foundation-closeout.ts",
  "src/current-shadow/contracts.ts",
  "src/current-shadow/database.ts",
  "src/current-shadow/index.ts",
  "src/current-shadow/privacy.ts",
  "src/current-shadow/source.ts",
  "tests/current-era-shadow.test.ts",
].map((entry) => `${root}${entry}`);

if (P02_M16_D_ALLOWLIST.length !== 14 || new Set(P02_M16_D_ALLOWLIST).size !== 14) {
  throw new Error("P02-M16-D allowlist must contain exactly 14 unique paths");
}
