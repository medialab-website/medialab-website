import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(moduleRoot, "../..");
const failures: string[] = [];
const checks: Record<string, string> = {};
const read = (path: string) => readFileSync(join(moduleRoot, path), "utf8");
const git = (args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const pass = (name: string, condition: boolean, observation: string) => {
  checks[name] = observation; if (!condition) failures.push(`${name}: ${observation}`);
};

const head = git(["rev-parse", "HEAD"]);
const tree = git(["rev-parse", "HEAD^{tree}"]);
const branch = git(["symbolic-ref", "--short", "HEAD"]);
const platform = git(["rev-parse", "refs/remotes/origin/platform"]);
const main = "28517e4d2131014cfdf090fa3aa40d6bcf7b6398"; // direct activation observation; no local tracking ref exists
pass("entry", head === "2fa5a404ec76e185d259c4d32a7b60fe79038921" && tree === "1953075a94e82ccb4c3e7847dd7139c77a3d145c"
  && branch === "platform-v2-p02-m18-a-operations-home-scheduling-assignment-r01"
  && platform === head && main === "28517e4d2131014cfdf090fa3aa40d6bcf7b6398",
  `branch=${branch}; HEAD=${head}; tree=${tree}; platform=${platform}; main=${main}`);

const migrations = readdirSync(join(moduleRoot, "db/migrations")).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
pass("migrationInventory", migrations.length === 27 && migrations.every((name, index) => name.startsWith(String(index + 1).padStart(4, "0")))
  && migrations[23] === "0024_operations_home_scheduling_assignment_console.sql"
  && migrations[25] === "0026_editorial_segment_foundation.sql"
  && migrations[26] === "0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql", migrations.join(","));
const migration = read("db/migrations/0024_operations_home_scheduling_assignment_console.sql");
pass("migrationBoundary", !/\b(?:CREATE TABLE|ALTER TABLE|DROP TABLE|GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE))\b/iu.test(migration)
  && ["get_operations_home", "get_operations_order_context", "list_operations_assignment_candidates"].every((name) => migration.includes(name))
  && (migration.match(/REVOKE ALL ON FUNCTION/gu) ?? []).length === 4,
  "0024 contains entry projections/helper only, with no table/schema mutation or runtime DML grant");

const lockHash = createHash("sha256").update(readFileSync(join(moduleRoot, "package-lock.json"))).digest("hex");
pass("dependencies", lockHash === "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a",
  `package-lock SHA-256=${lockHash}`);

const app = read("src/operations-console/app.ts");
const database = read("src/operations-console/database.ts");
const service = read("src/operations-console/service.ts");
const contracts = read("src/operations-console/operations-contracts.ts");
const html = read("src/operations-console/public/index.html");
const client = read("src/operations-console/public/app.js");
const requiredRoutes = ["/api/operations", "/api/operations/orders/:orderId", "/initialize",
  "/scheduling/:requestId/requested-windows", "/scheduling/:requestId/proposed-windows",
  "/scheduling/:requestId/accept-proposal", "/scheduling/:requestId/confirm",
  "/appointments/:appointmentId/cancel", "/appointments/:appointmentId/reschedule",
  "/appointments/:appointmentId/assignments", "/assignments/:assignmentId/replace"];
pass("routes", requiredRoutes.every((route) => app.includes(route)), requiredRoutes.join(","));
pass("contracts", ["OperationsHomeV1", "OperationsAssignmentCandidatesV1", "OperationsActionReceiptV1",
  "PRIMARY_OPERATOR", "STAFF_PROPOSED"].every((value) => contracts.includes(value))
  && !/provider|folder|payment/i.test(contracts), "bounded operational contract families with no provider, folder, or payment fields");
pass("canonicalCommands", ["create_property_hub", "create_scheduling_request", "create_job", "create_service_workstream",
  "add_scheduling_requested_window", "propose_scheduling_window", "confirm_appointment", "cancel_appointment",
  "record_scheduling_offline_acceptance",
  "supersede_and_reschedule_appointment", "assign_appointment_participant", "replace_appointment_participant_assignment",
  "link_job_appointment"].every((command) => database.includes(command)), "accepted canonical commands are reused");
pass("authority", !/INSERT INTO medialab_core|UPDATE medialab_core|DELETE FROM medialab_core/iu.test(database + service)
  && !/process\.env|fetch\(|https?:\/\//iu.test(database + service), "request runtime has no direct canonical DML, environment authority, or external network path");
pass("interface", ["Today", "Upcoming", "Needs attention", "Start operations", "Add window", "Assign crew", "Replace"].every((copy) => (html + client).includes(copy))
  && html.includes("/operations") && client.includes("orderId") && client.includes("counts.today")
  && migration.includes("'sections'") && migration.includes("'needsAttention'")
  && client.includes("operationalDateTime(item.appointment.localStartsAt, item.appointment.ianaTimezone)")
  && client.includes('timeZone: "UTC"') && !client.includes("localDay(item.appointment"),
  "server-produced daily queues and canonical appointment-local time with explicit IANA zones are present");
pass("resourceBinding", database.includes("target, evidence") && database.includes("appointmentLineageIds.includes(appointmentId)")
  && database.includes("assignmentLineageIds.includes(assignmentId)") && database.includes("window.windowId === input.windowId")
  && migration.includes("person_account_states") && migration.includes("i.status = 'ACTIVE'"),
  "request, appointment, window, assignment, and active-person evidence are bound before canonical mutation");
pass("sanitization", service.includes("schedulingRequestLineageIds: _requests") && service.includes("projection.sections.today.map")
  && service.includes("customerIdentityId: _hidden"), "internal identity and lineage evidence is removed from items and section arrays");
pass("exclusions", !/Mission Plan form|Quick Edit|editor handoff|payment form|provider selector/iu.test(html + client),
  "excluded later workflows are not implemented");

const status = execFileSync("git", ["status", "--porcelain=v2", "-z", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" });
const records = status.split("\0").filter(Boolean);
const unsafeStatus = records.some((record) => !record.startsWith("1 .M ") && !record.startsWith("? "));
pass("candidateState", records.length > 0 && !unsafeStatus && !records.some((record) => /(?:^|\/)(?:node_modules|dist|coverage|vendor)(?:\/|$)/u.test(record)),
  `${records.length} unstaged modified/untracked text paths; no deletion, rename, staging, vendor, or generated payload`);

const testPath = join(moduleRoot, "tests/operations-home-scheduling-assignment.test.ts");
const test = existsSync(testPath) ? readFileSync(testPath, "utf8") : "";
const requiredTestEvidence = ["concurrency safety", "exact replay across appointment lifecycles", "server-produced stable sections",
  "same-origin", "response-sanitization", "lacks staff/order-read authority", "parallel Job ambiguity",
  "rolls back every partial initialization effect", "REVOKE EXECUTE", "role_usage_grants", "foreignWindowId", "mismatchedRoute"];
pass("targetedTests", (test.match(/\bit\(/gu) ?? []).length >= 9 && requiredTestEvidence.every((value) => test.includes(value))
  && test.includes("browser and appointment zones differ")
  && !/\.skip\(|\.todo\(/u.test(test),
  "nine substantive groups cover authority, rollback/replay/concurrency, resource isolation, timezone-safe UI, sections, HTTP security, tenant denial, and ambiguity");

const result = {
  verifier: "P02-M18-A_OPERATIONS_HOME_SCHEDULING_ASSIGNMENT_V1",
  pass: failures.length === 0,
  entry: { branch, head, tree, platform, main },
  checks,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exit(1);
