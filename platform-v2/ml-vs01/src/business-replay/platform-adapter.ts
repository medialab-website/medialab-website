import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { IDENTITY_FIXTURES } from "../../db/fixtures/identity-tenancy-fixtures.js";
import { DEFAULT_RUNTIME_DATABASE, OperationalPilotDatabase } from "../operational-pilot/database.js";
import { observed, type BusinessReplayObservedOutcomeV1, type BusinessReplayScenarioV1 } from "./contracts.js";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let goldenRoot: string | undefined;

async function issueSyntheticTestSession(identityId: string): Promise<string> {
  const config = { ...DEFAULT_RUNTIME_DATABASE, user: "medialab_p02m16a_test_owner" };
  if (config.host !== "/tmp/mlvs01-p02m16a-pg" || config.port !== 55447 || config.database !== "medialab_p02m16a_test" ||
      config.user !== "medialab_p02m16a_test_owner") throw new Error("synthetic session bootstrap boundary rejected");
  const token = randomBytes(32).toString("base64url");
  const owner = new pg.Client(config);
  await owner.connect();
  try {
    await owner.query(
      `INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at,revoked_at)
       VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour',NULL)`,
      [randomUUID(), identityId, createHash("sha256").update(token).digest("hex")]
    );
  } finally { await owner.end(); }
  return token;
}

async function ensureGoldenPath(outputRoot: string): Promise<string> {
  if (goldenRoot === outputRoot) return outputRoot;
  const executable = join(base, "node_modules/.bin/tsx");
  execFileSync(executable, [join(base, "scripts/run-operational-pilot-golden-path.ts"), `--output-root=${outputRoot}`], {
    cwd: base, stdio: "pipe", env: { ...process.env, NO_PROXY: "*", no_proxy: "*" },
  });
  goldenRoot = outputRoot;
  return outputRoot;
}

async function readJson(path: string): Promise<any> { return JSON.parse(await readFile(path, "utf8")); }

export async function executePlatformScenario(scenario: BusinessReplayScenarioV1, outputRoot: string): Promise<BusinessReplayObservedOutcomeV1> {
  const platformRoot = join(outputRoot, "platform-baseline");
  await ensureGoldenPath(platformRoot);
  const executionTemplateId = scenario.platformExecutionTemplateId ?? scenario.scenarioId;
  if (executionTemplateId === "M16B_PLATFORM_BASELINE_QUICK_EDIT_V1") {
    const outcome = await readJson(join(platformRoot, "OBSERVED_OUTCOME.json"));
    return observed([
      { field: "comparisonPass", value: outcome.comparison.pass, source: "PLATFORM_OBSERVED" },
      { field: "originals", value: outcome.counts.originals, source: "PLATFORM_OBSERVED" },
      { field: "selected", value: outcome.counts.selected, source: "PLATFORM_OBSERVED" },
      { field: "finalVersions", value: outcome.counts.finalVersions, source: "PLATFORM_OBSERVED" },
      { field: "exactDownloads", value: outcome.counts.exactDownloads, source: "PLATFORM_OBSERVED" },
    ], ["M16A_GOLDEN_PATH_QUICK_EDIT_V1"]);
  }
  if (executionTemplateId === "M16B_PLATFORM_NEEDS_REVIEW_V1") {
    const snapshot = await readJson(join(platformRoot, "NEEDS_REVIEW_SNAPSHOT.json"));
    return observed([
      { field: "unresolved", value: snapshot.unresolved, source: "PLATFORM_OBSERVED" },
      { field: "finalDesignationCreatedByNeedsReview", value: snapshot.finalDesignationCreatedByNeedsReview, source: "PLATFORM_OBSERVED" },
    ], ["M16A_GOLDEN_PATH_QUICK_EDIT_V1", "get_returned_review_lineage"]);
  }
  if (executionTemplateId !== "M16B_PLATFORM_RESCHEDULE_V1") throw new Error(`unsupported Platform scenario: ${scenario.scenarioId}`);

  const golden = await readJson(join(platformRoot, "OBSERVED_OUTCOME.json"));
  const originalAppointment = golden.ids.appointment as string;
  const staffToken = await issueSyntheticTestSession(IDENTITY_FIXTURES[1].id);
  const runtime = new OperationalPilotDatabase();
  try {
    const replacementAppointment = await runtime.invoke<string>("supersede_and_reschedule_appointment", [
      staffToken, "m16b-reschedule", originalAppointment, IDENTITY_FIXTURES[0].id, "TEXT",
      "2026-10-22T15:00:00.000Z", "2026-10-22T17:00:00.000Z", "America/New_York",
      "2026-10-22 11:00:00", "2026-10-22 13:00:00", "Synthetic accepted reschedule", "Synthetic acceptance evidence",
    ], ["", "", "::uuid", "::uuid", "", "::timestamptz", "::timestamptz", "", "::timestamp without time zone", "::timestamp without time zone"]);
    const original = await runtime.invoke<any>("get_appointment_record", [staffToken, originalAppointment], ["", "::uuid"]);
    const replacement = await runtime.invoke<any>("get_appointment_record", [staffToken, replacementAppointment], ["", "::uuid"]);
    const supersessionEvidence = original.events.some((event: any) => event.event_type === "APPOINTMENT_SUPERSEDED" && event.replacement_appointment_id === replacementAppointment);
    return observed([
      { field: "originalState", value: original.current_state, source: "PLATFORM_OBSERVED" },
      { field: "replacementState", value: replacement.current_state, source: "PLATFORM_OBSERVED" },
      { field: "originalStartsAt", value: new Date(original.appointment.starts_at).toISOString(), source: "PLATFORM_OBSERVED" },
      { field: "replacementStartsAt", value: new Date(replacement.appointment.starts_at).toISOString(), source: "PLATFORM_OBSERVED" },
      { field: "supersessionEvidence", value: supersessionEvidence, source: "PLATFORM_OBSERVED" },
    ], ["supersede_and_reschedule_appointment", "get_appointment_record"]);
  } finally { await runtime.close(); }
}

export const PLATFORM_ADAPTER_COMMANDS = Object.freeze([
  "M16A_GOLDEN_PATH_QUICK_EDIT_V1", "get_returned_review_lineage", "supersede_and_reschedule_appointment", "get_appointment_record",
]);
