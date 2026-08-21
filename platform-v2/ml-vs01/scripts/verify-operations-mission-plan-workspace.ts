import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(moduleRoot, "../..");
const base = "9bf956f1ba43cecd3acd412549b65b582bafa55b";
const baseTree = "ffaec955264a81c8a785b95b095a4d97d4a5a6c3";
const branchName = "platform-v2-p02-m20-a-editorial-segment-foundation-r01";
const failures: string[] = [];
const checks: Record<string, string> = {};
const read = (path: string) => readFileSync(join(moduleRoot, path), "utf8");
const git = (args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const pass = (name: string, condition: boolean, observation: string) => {
  checks[name] = observation; if (!condition) failures.push(`${name}: ${observation}`);
};

const head = git(["rev-parse", "HEAD"]); const tree = git(["rev-parse", "HEAD^{tree}"]);
const branch = git(["symbolic-ref", "--short", "HEAD"]); const platform = git(["rev-parse", "refs/remotes/origin/platform"]);
pass("entry", head === base && tree === baseTree && platform === base && branch === branchName,
  `branch=${branch}; HEAD=${head}; tree=${tree}; origin/platform=${platform}`);

const migrations = readdirSync(join(moduleRoot, "db/migrations")).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
pass("migrationInventory", migrations.length === 26 && migrations.every((name, index) => name.startsWith(String(index + 1).padStart(4, "0")))
  && migrations[24] === "0025_operations_mission_plan_draft_controls.sql"
  && migrations[25] === "0026_editorial_segment_foundation.sql", migrations.join(","));
const acceptedMigrationDiff = git(["diff", "--name-only", base, "--", "platform-v2/ml-vs01/db/migrations/0001_identity_and_tenancy.sql",
  "platform-v2/ml-vs01/db/migrations/0002_property_identity_and_snapshots.sql", "platform-v2/ml-vs01/db/migrations/0003_person_contacts_and_account_lifecycle.sql",
  "platform-v2/ml-vs01/db/migrations/0004_current_catalog_and_price_snapshots.sql", "platform-v2/ml-vs01/db/migrations/0005_catalog_administration_lifecycle.sql",
  "platform-v2/ml-vs01/db/migrations/0006_orders_and_immutable_commercial_evidence.sql", "platform-v2/ml-vs01/db/migrations/0007_property_hub_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0008_scheduling_request_and_appointment_foundation.sql", "platform-v2/ml-vs01/db/migrations/0009_job_and_service_workstream_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0010_mission_plan_foundation.sql", "platform-v2/ml-vs01/db/migrations/0011_media_asset_identity_and_lineage_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0012_durable_media_operations_reconciliation_foundation.sql", "platform-v2/ml-vs01/db/migrations/0013_capture_session_ingest_custody_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0014_media_cull_workspace_selected_media_evidence_foundation.sql", "platform-v2/ml-vs01/db/migrations/0015_editor_handoff_returned_media_intake_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0016_returned_editor_review_final_source_decision_foundation.sql", "platform-v2/ml-vs01/db/migrations/0017_publication_delivery_entitlement_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0018_temporary_download_center_external_sharing_foundation.sql", "platform-v2/ml-vs01/db/migrations/0019_temporary_download_center_access_credential_gateway_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0020_disposable_delivery_surface_local_fixture_foundation.sql", "platform-v2/ml-vs01/db/migrations/0021_provider_neutral_file_backed_disposable_delivery_foundation.sql",
  "platform-v2/ml-vs01/db/migrations/0022_organization_records_dashboard_audited_export_foundation.sql", "platform-v2/ml-vs01/db/migrations/0023_runtime_intake_reconciliation_commands.sql",
  "platform-v2/ml-vs01/db/migrations/0024_operations_home_scheduling_assignment_console.sql"]);
pass("acceptedMigrationBytes", acceptedMigrationDiff === "", "accepted migrations 0001-0024 are byte-identical to canonical Platform");
const migration25 = read("db/migrations/0025_operations_mission_plan_draft_controls.sql");
pass("projectionBoundary", ["get_operations_mission_plan_draft_controls", "get_operations_order_customer_contacts"]
  .every((name) => migration25.includes(name))
  && migration25.includes("mission_plan.manage") && migration25.includes("SECURITY DEFINER")
  && migration25.includes("REVOKE ALL ON FUNCTION")
  && !/\b(?:CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|UPDATE |DELETE FROM|GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE))\b/iu.test(migration25),
  "0025 contains permission-checked Mission Plan controls and customer-contact read projections with no storage, canonical mutation, or direct DML grant");

const lockHash = createHash("sha256").update(readFileSync(join(moduleRoot, "package-lock.json"))).digest("hex");
pass("dependencies", lockHash === "2ab08e114391b67604e1c11d6462609616959d6d75cc8acbd90a48c22e59308a",
  `package-lock SHA-256=${lockHash}`);

const app = read("src/operations-console/app.ts"); const database = read("src/operations-console/database.ts");
const service = read("src/operations-console/service.ts"); const contracts = read("src/operations-console/operations-contracts.ts");
const html = read("src/operations-console/public/index.html"); const client = read("src/operations-console/public/app.js");
const css = read("src/operations-console/public/styles.css");
pass("routes", ["/mission-plan", "/revise", "/notes", "/workstreams", "/contacts", "/refresh", "/issue", "/supersede", "/offline-packet"]
  .every((route) => app.includes(route)), "complete order-bound Mission Plan route family");
pass("canonicalCommands", ["create_mission_plan_draft", "revise_mission_plan_draft", "replace_mission_plan_draft_workstreams",
  "replace_mission_plan_draft_contacts", "add_mission_plan_note", "refresh_mission_plan_draft", "issue_mission_plan_version",
  "create_mission_plan_superseding_draft", "record_mission_plan_open_event", "get_mission_plan_record", "list_mission_plans"]
  .every((command) => database.includes(command)), "accepted 0010 command and readback functions are reused");
pass("authority", !/INSERT INTO medialab_core|UPDATE medialab_core|DELETE FROM medialab_core/iu.test(database + service)
  && !/process\.env|https?:\/\//iu.test(database + service), "request runtime has no direct canonical DML, environment authority, or external network path");
pass("contracts", ["MissionPlanWorkspaceV1", "MissionPlanActionReceiptV1", "MissionPlanDraftControls", "ASSIGNED_CREW_ONLY",
  "POTENTIALLY_CUSTOMER_VISIBLE", "INTERNAL_STAFF_ONLY"].every((value) => contracts.includes(value)),
  "strict Mission Plan workspace, action, selection, and visibility contracts");
pass("offlinePacket", ["canonical_json_sha256", "localStartsAt", "ianaTimezone", "mailto:", "tel:", "weather.status",
  "recordMissionPlanDownload", "INTERNAL_STAFF_ONLY"].every((value) => service.includes(value))
  && !/<script|https?:\/\//iu.test(service.slice(service.indexOf("<!doctype html>"))),
  "self-contained versioned field packet includes hash, canonical local time, safe contact links, weather honesty, filtering, and open evidence");
pass("brandAndLayout", html.includes('/brand-logo.jpg') && existsSync(resolve(moduleRoot, "../../assets/logos/flatlogo.jpg"))
  && ["#121212", "#1e1e1e", "#ffc107", "36fr", "64fr"].every((value) => css.includes(value))
  && client.includes("missionControlSummary") && !client.includes("operationalTabs"),
  "repository logo, approved brand palette, 36/64 master-detail layout, responsive fallback, and one-page Mission Control detail");
pass("ownerVisibleWorkflow", ["Choose a property package", "Choose à la carte", "What’s included", "Recommended for this square footage"]
  .every((value) => client.includes(value))
  && client.includes('["Video", "Photo", "Matterport", "Zillow 3D Home", "CubiCasa & floor plans"]')
  && ["Needs attention", "Today", "Upcoming", "Completed"].every((value) => html.includes(value))
  && ["Confirm this appointment", "Crew assignment saved.", "Edit Mission Plan", "Save Mission Plan Offline", "Get Directions"].every((value) => client.includes(value))
  && css.includes('.field input[type="text"]') && css.includes(".operations-dialog") && css.includes(".mission-control-summary"),
  "package-first ordering, grouped add-ons, high-contrast controls, four Mission Control views, focused confirmation, hidden edit controls, and collapsible Mission Plan");
pass("contactIdentifierCompatibility", contracts.includes("DATABASE_UUID") && contracts.includes("databaseUuid(contact.contactMethodId")
  && contracts.includes("uuid(contact.personId"),
  "database-issued contact-method UUIDs are accepted without weakening canonical person and authority identifiers");
pass("safeBrowser", !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(/u.test(client)
  && !/localStorage|sessionStorage|indexedDB/u.test(client), "safe DOM construction and no browser-retained operational authority");

const test = read("tests/operations-mission-plan-workspace.test.ts");
pass("targetedTests", (test.match(/\bit\(/gu) ?? []).length >= 3 && ["stale", "refresh", "supersedes_version_id", "42501",
  "INTERNAL_STAFF_ONLY", "mailto:", "canonical evidence", "order/plan mismatches", "REPLACE_MISSION_PLAN_CONTACTS"].every((value) => test.includes(value))
  && !/\.skip\(|\.todo\(/u.test(test), "focused runtime coverage includes lifecycle, authority, filtering, and offline evidence");

const status = git(["status", "--porcelain=v2", "-z", "--untracked-files=all"]); const records = status.split("\0").filter(Boolean);
const unsafe = records.some((record) => !record.startsWith("1 .M ") && !record.startsWith("? "));
pass("candidateState", records.length > 0 && !unsafe && !records.some((record) => /(?:^|\/)(?:node_modules|dist|coverage|vendor)(?:\/|$)/u.test(record)),
  `${records.length} unstaged modified/untracked paths; no deletion, rename, staging, or generated payload`);

const result = { verifier: "P02-M19-A_OPERATIONS_MISSION_PLAN_WORKSPACE_V1", pass: failures.length === 0,
  entry: { branch, head, tree, platform }, checks, failures };
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exit(1);
