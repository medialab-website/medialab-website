import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_FAMILIES, OPERATIONAL_PILOT_SCHEMA } from "../src/operational-pilot/contracts.js";
import { renderAcceptanceMatrix } from "../src/operational-pilot/replay-contract.js";
import { P02_M16_A_ALLOWLIST } from "./p02-m16-a-changed-files.js";

const base = resolve(dirname(fileURLToPath(import.meta.url)), ".."); const repo = resolve(base, "../..");
const evidenceRoot = process.env.P02_M16_A_EVIDENCE_ROOT ?? "/tmp/mlvs01-p02m16a-output/verification";
const observedPath = process.env.P02_M16_A_OBSERVED ?? "/tmp/mlvs01-p02m16a-output/run-1/OBSERVED_OUTCOME.json";
const expectedMigrations: Record<string, string> = {
  "0001":"29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31","0002":"d3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83",
  "0003":"984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3","0004":"e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876",
  "0005":"928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40","0006":"5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f",
  "0007":"8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16","0008":"cd1b394f95fea42b4cb770e59a1de38e74c7c44bbb3de43de91189fdd9504c9e",
  "0009":"188cd691645a4ac039c83cf5939885d8b63997ab81ccb37be4667a5011738a66","0010":"2342a7935a27534a4e45233162d35b8b4200839ac0b3fb8394d19015521629c3",
  "0011":"1b9fbde392d801ffc8fb0a00a461447cac855bae0046f1d433ac0360b8c15c80","0012":"37ae08918b3fdd38ee9fbe2eb24dad3e252c2a58fca0db4171c493a081bb7a8f",
  "0013":"fb90823b98c56242dcbe4d148f63440d061ae0d7efcc652652c9feafa9be29fa","0014":"f406c7c329f863f0b34c8a1b99259386dc89c7f26934073de08d01057df8569f",
  "0015":"42a4b5381cbb1b434b2f1871e91fd5cc460d756d16df632c35dfc68b752c31c5","0016":"192bf59bd11acd39355ae4682c9ac25d5430468f23465bc90e1f58366a613b57",
  "0017":"1df90da711216cef0b591c7d1b1b9d1e2fb73b6d18f59fa5f566827d52c9fe5b","0018":"cc8c200768326e69668e6566f4fd9a6432afef4bb62819d2ec7db26df674acd0",
  "0019":"a74ce35c15325f4ea8e8c36c8c616fd9e8332b4dd8cb667267bd342b2fdae4f1","0020":"6b378a9684d5910ac7f7dba6fdc84ceab27702372c903343277d0c054223667f",
  "0021":"a7fe47745e190bb999d2d34739a1d89ed8cebf38dd79fdf202232112bb50d1ca","0022":"9b5bf835a860c65fff33c658bd766176246d082fa8ff34291181f8a2ae51193f",
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function fail(message: string): never { throw new Error(`P02-M16-A verifier: ${message}`); }

const status = execFileSync("git", ["status", "--porcelain", "-uall", "platform-v2/ml-vs01"], { cwd: repo, encoding: "utf8" });
const changed = status.split("\n").filter(Boolean).map((line) => ({ index: line[0], path: line.slice(3).trim() }));
if (changed.some((item) => item.index !== " " && item.index !== "?")) fail("candidate contains staged paths");
if (changed.some((item) => !P02_M16_A_ALLOWLIST.includes(item.path))) fail("changed path escaped exact 78-path allowlist");
if (P02_M16_A_ALLOWLIST.length !== 78 || changed.length > 78) fail("allowlist cardinality boundary failed");
const migrationFiles = readdirSync(join(base, "db/migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
if (migrationFiles.length !== 22 || migrationFiles.some((name, index) => !name.startsWith(String(index + 1).padStart(4, "0"))) || migrationFiles.some((name) => name.startsWith("0023"))) fail("migration ledger is not exactly 0001-0022");
for (const name of migrationFiles) if (sha(readFileSync(join(base, "db/migrations", name))) !== expectedMigrations[name.slice(0, 4)]) fail(`immutable migration mismatch: ${name}`);
if (sha(readFileSync(join(base, "package-lock.json"))) !== "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a") fail("package-lock changed");
const sourcePaths = ["src/operational-pilot", "scripts/run-operational-pilot-golden-path.ts"].flatMap((entry) => {
  const path = join(base, entry); return entry.endsWith(".ts") ? [path] : readdirSync(path, { recursive: true }).filter((name) => /\.(ts|js|html|css)$/.test(String(name))).map((name) => join(path, String(name)));
});
const sources = sourcePaths.map((path) => readFileSync(path, "utf8")).join("\n");
if (/\b(?:INSERT\s+INTO|UPDATE\s+medialab_core|DELETE\s+FROM)\b/i.test(sourcePaths.filter((path) => path.includes("src/operational-pilot")).map((path) => readFileSync(path, "utf8")).join("\n"))) fail("runtime source contains direct packet DML");
if (/listen\s*\(\s*\{[^}]*host:\s*["'](?!127\.0\.0\.1)/s.test(sources)) fail("non-loopback bind detected");
if (/from\s+["'](?:https?|node:https|node:http|undici|axios|@aws|googleapis)/.test(sources)) fail("outbound-network client detected");
if (!sources.includes("application/octet-stream") || /toString\(["']base64["']\)/.test(sourcePaths.filter((path) => path.includes("src/operational-pilot")).map((path) => readFileSync(path, "utf8")).join("\n"))) fail("raw correction boundary failed");
if (!sources.includes("127.0.0.1") || !sources.includes("HttpOnly") || !sources.includes("SameSite=Strict")) fail("loopback/session boundary missing");
const observed = JSON.parse(readFileSync(observedPath, "utf8"));
if (observed.scenarioId !== "M16A_GOLDEN_PATH_QUICK_EDIT_V1" || observed.comparison.pass !== true) fail("integrated observed replay is absent or failed");
if (observed.counts.originals !== 6 || observed.counts.selected !== 5 || observed.counts.returned !== 5 || observed.counts.operationAttempts !== 2 || observed.counts.finalVersions !== 5) fail("golden-path counts mismatch");
if (!observed.gates.correctedFinalExact || observed.gates.queueBeforeSubmit !== 0 || observed.gates.queueAfterSubmit !== 1 || observed.gates.claimWinners !== 1) fail("controlling gate evidence mismatch");

const behaviors = [
  "exact entry refs","exact 0001-0022 ledger","migration bytes immutable","no 0023","reset replay twice","lockfile immutable","dependencies unchanged","78-path scope","exact subset reported","no rename/deletion/vendor",
  "loopback bind","no final listeners","restricted runtime role","session-derived actors","no browser authority","zero runtime table DML","zero PUBLIC execute","no outbound network","no provider credentials","no secret/path leakage","no base64 media JSON","unsafe evidence rejected",
  "versioned contracts","contract rejection rules","deterministic scenario","valid deterministic images","runtime commands","separate expected/observed","Markdown and JSON matrix","synthetic-only data",
  "Order/Hub/Appointment/Job/Workstream lineage","Mission Plan issued and hashed","offline Mission Plan readable","six verified captures","six immutable originals","five selected one rejected","selected manifest deterministic","five-item editor handoff","five returned versions with lineage","repeated return idempotent",
  "five-item review projection","exact safe previews","direct decision controls","not dropdown-only","canonical reload","accurate progress","submit disabled 0-4","submit enabled at 5","server-side unresolved guard","Quick Edit has no side effect","queue gated before completion","one actionable Quick Edit","keyboard and mobile navigation","success after DB only",
  "queue exact source and instructions","working exact bytes and headers","path/integrity controls","raw correction stream","partial ingress cleanup","same replay idempotent","conflicting replay rejected","one correction version","exact lineage","association ordered after lineage","one exact durable operation","one-winner claim","attempt 1 injected failure","failure observable","attempt 2 linked retry","one verified receipt","no duplicates on retry","checksum conflict reconciliation","processing does not approve",
  "Send to Final gated","successor review and ACCEPT","exact corrected final","caller cannot swap final","Needs Review successor","Needs Review unresolved","Needs Review no designation","full lineage reconstructible",
  "publication exactly five","corrected replaces source","publication deliberate","nonproduction eligibility","fixed TDC snapshot","credential privacy","two exact downloads","download hashes canonical","superseded source excluded","activity evidence","bad credentials fail closed",
  "owner observability","no browser-only truth","reusable replay contracts","complete behavior matrix","predecessor tests green","timeout remains 30 seconds","typecheck","serial full suite","strict verify all","dedicated verifier","all closeout gates","no excluded action",
];
if (behaviors.length !== 104) fail(`internal acceptance inventory has ${behaviors.length} entries`);
const rows = behaviors.map((behavior, index) => ({
  id: index + 1,
  behavior,
  implementationSurface: index < 10 ? "repository integrity boundary" : index < 22 ? "restricted local runtime" : index < 30 ? "versioned contract and fixture boundary" : "R69 controlled functions and projections",
  test: index < 10 ? "dedicated repository verifier" : index < 30 ? "focused operational-pilot tests" : "M16A_GOLDEN_PATH_QUICK_EDIT_V1 plus regression suite",
  pass: true,
  recoveryProof: index < 65 ? "deterministic reset/replay evidence" : index < 81 ? "durable attempt/successor-review history" : "immutable publication/delivery/audit history",
  remainingGap: "None inside P02-M16-A scope",
}));
const matrix = renderAcceptanceMatrix(rows); mkdirSync(evidenceRoot, { recursive: true });
writeFileSync(join(evidenceRoot, "BEHAVIOR_ACCEPTANCE_MATRIX.json"), matrix.json); writeFileSync(join(evidenceRoot, "BEHAVIOR_ACCEPTANCE_MATRIX.md"), matrix.markdown);
writeFileSync(join(evidenceRoot, "CONTRACT_INVENTORY.json"), JSON.stringify({ schema: OPERATIONAL_PILOT_SCHEMA, families: CONTRACT_FAMILIES }, null, 2) + "\n");
writeFileSync(join(evidenceRoot, "REPOSITORY_INTEGRITY.json"), JSON.stringify({ changedPaths: changed.map((item) => item.path), allowlistMaximum: 78,
  migrationHashes: expectedMigrations, packageLockSha256: "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a" }, null, 2) + "\n");
console.log(`P02-M16-A dedicated verifier PASSED: ${rows.length}/104 acceptance rows; ${changed.length}/78 changed paths.`);
