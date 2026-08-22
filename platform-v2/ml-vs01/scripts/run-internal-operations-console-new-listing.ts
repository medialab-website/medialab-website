import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import {
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  MEMBERSHIP_PERMISSION_SET_FIXTURES,
  ORGANIZATION_FIXTURE,
  PEOPLE_FIXTURES,
  PERMISSION_FIXTURES,
  PERMISSION_SET_FIXTURE,
  PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/identity-tenancy-fixtures.js";
import {
  CATALOG_PERMISSION_FIXTURES,
  CATALOG_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/current-catalog-price-fixtures.js";
import { CURRENT_REAL_ESTATE_CATALOG_TABLES } from "../db/fixtures/current-real-estate-catalog-seed.js";
import {
  ORDER_PERMISSION_FIXTURES,
  ORDER_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/order-foundation-fixtures.js";
import {
  PROPERTY_HUB_PERMISSION_FIXTURES,
  PROPERTY_HUB_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/property-hub-foundation-fixtures.js";
import {
  SCHEDULING_PERMISSION_FIXTURES,
  SCHEDULING_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/scheduling-appointment-foundation-fixtures.js";
import {
  JOB_SERVICE_PERMISSION_FIXTURES,
  JOB_SERVICE_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/job-service-workstream-foundation-fixtures.js";
import {
  MISSION_PLAN_PERMISSION_FIXTURES,
  MISSION_PLAN_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/mission-plan-foundation-fixtures.js";
import {
  MEDIA_ASSET_PERMISSION_FIXTURES,
  MEDIA_ASSET_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/media-asset-identity-lineage-fixtures.js";
import {
  MEDIA_CAPTURE_PERMISSION_FIXTURES,
  MEDIA_CAPTURE_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/capture-session-ingest-custody-fixtures.js";
import {
  MEDIA_CULL_PERMISSION_FIXTURES,
  MEDIA_CULL_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/media-cull-workspace-selected-media-fixtures.js";
import {
  MEDIA_EDITOR_HANDOFF_PERMISSION_FIXTURES,
  MEDIA_EDITOR_HANDOFF_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/editor-handoff-returned-media-fixtures.js";
import {
  MEDIA_RETURN_REVIEW_PERMISSION_FIXTURES,
  MEDIA_RETURN_REVIEW_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/returned-editor-review-final-source-fixtures.js";
import { startOperationsConsole } from "../src/operations-console/server.js";
import { OperationsConsoleService } from "../src/operations-console/service.js";
import { ReviewMediaStore } from "../src/operations-console/review-media-store.js";
import {
  commercialFingerprint,
  OperationsConsoleDatabase,
  OPERATIONS_CONSOLE_DATABASE,
  OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
  OPERATIONS_CONSOLE_ORGANIZATION_ID,
  resolveCatalogSelections,
  sha256Evidence,
  type CreateListingTransactionCommand,
  type TransactionFaultStage,
} from "../src/operations-console/database.js";
import { DevelopmentOperatorSessionManager, type ServerBoundDevelopmentOperatorContext } from "../src/operations-console/session.js";

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = resolve(MODULE_ROOT, "db/migrations");
export const OPERATIONS_CONSOLE_OUTPUT_ROOT = "/tmp/mlvs01-p02m17a-output";
const VERIFICATION_DIR = resolve(OPERATIONS_CONSOLE_OUTPUT_ROOT, "verification");
const RUNTIME_OBSERVATIONS_PATH = resolve(VERIFICATION_DIR, "RUNTIME_OBSERVATIONS.json");
const RUNTIME_VERIFICATION_PATH = resolve(VERIFICATION_DIR, "RUNTIME_VERIFICATION.json");
const STATIC_MATRIX_PATH = resolve(VERIFICATION_DIR, "BEHAVIOR_ACCEPTANCE_MATRIX.json");
const DEDICATED_VERIFIER_PATH = resolve(VERIFICATION_DIR, "DEDICATED_VERIFIER.json");
const VERIFY_ALL_LOG_PATH = resolve(VERIFICATION_DIR, "VERIFY_ALL.log");
const M17_DATA_DIRECTORY = "/tmp/mlvs01-p02m17a-pg-data";
const PG_CTL = "/Applications/Postgres.app/Contents/Versions/latest/bin/pg_ctl";
const OWNER_ROLE = "medialab_p02m17a_test_owner";
const RUNTIME_ROLE = "medialab_p02m17a_test_app";
const OPERATOR_MEMBERSHIP_ID = "50d8b321-7b99-5bd9-b1a4-cecb924ecc39";
const OPERATOR_IDENTITY_ID = "87c0043a-334f-548c-95d7-d53939ab054b";

interface BootstrapObservation {
  ledger: Array<{ filename: string; sha256: string }>;
  resetNumber: number;
  seededRows: number;
}

interface CountObservation {
  [table: string]: number;
}

interface HttpFlowObservation {
  catalogChoiceCount: number;
  selectedChoiceCount: number;
  previewSubtotalCents: number;
  concurrentOrderIdsEqual: boolean;
  replayResponses: number;
  canonicalOrderReadBack: boolean;
  canonicalPartyCount: number;
  canonicalItemCount: number;
}

interface RuntimeObservations {
  schema: "P02_M17_A_RUNTIME_OBSERVATIONS_V1";
  observationId: string;
  generatedAt: string;
  boundary: {
    host: "127.0.0.1";
    port: 4317;
    databaseSocket: string;
    databasePort: number;
    database: string;
    runtimeRole: string;
  };
  bootstrap: { firstReset: BootstrapObservation; secondReset: BootstrapObservation };
  transactionProofs: Awaited<ReturnType<typeof runTransactionProofs>>;
  httpFlow: HttpFlowObservation;
  authority: Awaited<ReturnType<typeof authorityProof>>;
  sensitiveValuesExcluded: true;
}

interface StaticAcceptanceRow {
  id: number;
  statement: string;
  pass: boolean;
  staticCoveragePass: boolean;
  staticObservations: string[];
  runtimeRequired: boolean;
}

interface StaticAcceptanceMatrix {
  schema: "P02-M17-A_ACCEPTANCE_MATRIX_V1";
  mode: "static-coverage";
  rows: StaticAcceptanceRow[];
}

interface ListenerCloseoutProof {
  databaseStatusBefore: "absent" | "running" | "stopped";
  databaseStatusAfter: "absent" | "stopped";
  noApplicationListener: true;
  noM17DatabaseListener: true;
}

interface AcceptanceSource {
  category: string;
  detail: string;
  passed: true;
}

interface RuntimeAcceptanceObservation {
  passed: boolean;
  observation: string;
  evidence: {
    statement: string;
    sourceCategories: string[];
    staticObservations: string[];
    directRuntimeObservations: string[];
    verifyAllLog: "VERIFY_ALL.log";
  };
}

interface FinalRuntimeVerification {
  schema: "P02_M17_A_RUNTIME_VERIFICATION_V1";
  generatedAt: string;
  verifyAll: { command: "npm run verify:all"; exitCode: 0; log: "VERIFY_ALL.log" };
  observations: { schema: RuntimeObservations["schema"]; file: "RUNTIME_OBSERVATIONS.json" };
  staticMatrix: { schema: StaticAcceptanceMatrix["schema"]; file: "BEHAVIOR_ACCEPTANCE_MATRIX.json" };
  listenerCloseout: ListenerCloseoutProof;
  acceptanceIds: number[];
  acceptance: Record<string, RuntimeAcceptanceObservation>;
}

const ACCEPTANCE_IDS = Array.from({ length: 120 }, (_unused, index) => index + 1);

const EVIDENCE_PRIVACY_PATTERN = /\/(?:Users|Volumes|home)\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bbearer\s+[A-Za-z0-9._~-]{12,}|\b(?:AIza|AKIA|gh[pousr]_|sk-)[0-9A-Za-z_-]{12,}/iu;

function assertEvidencePrivacy(label: string, serialized: string): void {
  if (EVIDENCE_PRIVACY_PATTERN.test(serialized)) throw new Error(`M17A_${label}_PRIVACY_FAILURE`);
}

function exactMigrationLedger(ledger: BootstrapObservation["ledger"]): boolean {
  return Array.isArray(ledger)
    && ledger.length === 28
    && ledger.every((entry, index) => (
      typeof entry?.filename === "string"
      && entry.filename.startsWith(`${String(index + 1).padStart(4, "0")}_`)
      && typeof entry.sha256 === "string"
      && /^[a-f0-9]{64}$/u.test(entry.sha256)
    ));
}

function assertDirectObservations(
  observations: RuntimeObservations,
  evidenceTimes: {
    logBirthtimeMs: number;
    logMtimeMs: number;
    observationsMtimeMs: number;
    matrixMtimeMs: number;
    dedicatedMtimeMs: number;
  },
): void {
  if (observations.schema !== "P02_M17_A_RUNTIME_OBSERVATIONS_V1") throw new Error("M17A_OBSERVATIONS_SCHEMA_FAILURE");
  const generatedAt = Date.parse(observations.generatedAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(observations.observationId)
      || !Number.isFinite(generatedAt)
      || generatedAt < evidenceTimes.logBirthtimeMs - 2_000
      || generatedAt > evidenceTimes.observationsMtimeMs + 2_000
      || evidenceTimes.observationsMtimeMs > evidenceTimes.matrixMtimeMs + 2_000
      || evidenceTimes.observationsMtimeMs > evidenceTimes.dedicatedMtimeMs + 2_000
      || evidenceTimes.matrixMtimeMs > evidenceTimes.logMtimeMs + 2_000
      || evidenceTimes.dedicatedMtimeMs > evidenceTimes.logMtimeMs + 2_000) {
    throw new Error("M17A_OBSERVATIONS_FRESHNESS_FAILURE");
  }
  if (observations.boundary.host !== "127.0.0.1" || observations.boundary.port !== 4317
      || observations.boundary.databaseSocket !== OPERATIONS_CONSOLE_DATABASE.host
      || observations.boundary.databasePort !== OPERATIONS_CONSOLE_DATABASE.port
      || observations.boundary.database !== OPERATIONS_CONSOLE_DATABASE.database
      || observations.boundary.runtimeRole !== RUNTIME_ROLE) {
    throw new Error("M17A_OBSERVATIONS_BOUNDARY_FAILURE");
  }
  const first = observations.bootstrap.firstReset;
  const second = observations.bootstrap.secondReset;
  if (first.resetNumber !== 1 || second.resetNumber !== 2 || first.seededRows <= 0 || second.seededRows <= 0
      || !exactMigrationLedger(first.ledger) || !exactMigrationLedger(second.ledger)
      || first.ledger.some((entry, index) => entry.filename !== second.ledger[index]?.filename || entry.sha256 !== second.ledger[index]?.sha256)) {
    throw new Error("M17A_OBSERVATIONS_BOOTSTRAP_FAILURE");
  }
  const expectedRollbackStages: TransactionFaultStage[] = [
    "after_customer",
    "after_property",
    "after_first_commercial_snapshot",
    "before_order",
    "after_order_before_readback",
    "after_readback_before_commit",
  ];
  const rollback = observations.transactionProofs.rollback;
  if (JSON.stringify(Object.keys(rollback)) !== JSON.stringify(expectedRollbackStages)
      || expectedRollbackStages.some((stage) => rollback[stage]?.rejected !== true || rollback[stage]?.countsExact !== true)) {
    throw new Error("M17A_OBSERVATIONS_ROLLBACK_FAILURE");
  }
  const transaction = observations.transactionProofs;
  if (!transaction.exactReplay.orderIdsEqual || !transaction.exactReplay.countsExact || !transaction.exactReplay.snapshotsReused
      || !transaction.conflict.rejected || !transaction.conflict.countsExact
      || !transaction.concurrency.orderIdsEqual || !transaction.independence.orderIdsDifferent) {
    throw new Error("M17A_OBSERVATIONS_REPLAY_FAILURE");
  }
  const http = observations.httpFlow;
  if (http.catalogChoiceCount <= 0 || http.selectedChoiceCount !== 2 || http.previewSubtotalCents <= 0
      || !http.concurrentOrderIdsEqual || !http.canonicalOrderReadBack
      || http.canonicalPartyCount !== 6 || http.canonicalItemCount !== 2) {
    throw new Error("M17A_OBSERVATIONS_HTTP_FAILURE");
  }
  const authority = observations.authority;
  if (authority.runtimeTableDml !== 0 || authority.runtimeSequenceAuthority !== 0
      || authority.publicTableDml !== 0 || authority.publicFunctionExecution !== 0
      || authority.runtimeFunctionExecutionCount <= 0
      || authority.actorPermissions["media_capture.read"] !== true
      || authority.actorPermissions["media_capture.manage"] !== false
      || authority.actorPermissions["media_cull.read"] !== true
      || authority.actorPermissions["media_cull.manage"] !== false
      || authority.actorPermissions["media_editor_handoff.read"] !== true
      || authority.actorPermissions["media_editor_handoff.manage"] !== false
      || authority.actorPermissions["media_return_review.read"] !== true
      || authority.actorPermissions["media_return_review.manage"] !== true
      || authority.actorPermissions["media_asset.read"] !== true
      || authority.actorPermissions["media_asset.manage"] !== true
      || observations.sensitiveValuesExcluded !== true) {
    throw new Error("M17A_OBSERVATIONS_AUTHORITY_FAILURE");
  }
}

function staticCategory(observation: string): string {
  const separator = observation.indexOf(":");
  const name = separator === -1 ? "dedicated-static" : observation.slice(0, separator).trim();
  return `dedicated-static:${name}`;
}

function directRuntimeSources(
  id: number,
  observations: RuntimeObservations,
  listenerCloseout: ListenerCloseoutProof,
): AcceptanceSource[] {
  const sources: AcceptanceSource[] = [];
  const add = (category: string, detail: string): void => {
    sources.push({ category, detail, passed: true });
  };
  const transaction = observations.transactionProofs;
  const http = observations.httpFlow;
  const authority = observations.authority;

  if (id === 5) add("runtime:migration-ledger", "Both fresh reset ledgers contain the exact ordered 0001 through 0028 inventory with matching hashes.");
  if (id === 6) add("runtime:double-reset", `Fresh reset observations 1 and 2 each seeded deterministic rows (${observations.bootstrap.firstReset.seededRows}, ${observations.bootstrap.secondReset.seededRows}).`);
  if (id === 13) add("runtime:loopback-http", "The complete HTTP scenario succeeded on the fixed 127.0.0.1:4317 boundary.");
  if (id === 14) add("runtime:restricted-role", `Business execution used the fixed ${observations.boundary.runtimeRole} role boundary.`);
  if (id === 16) add("runtime:canonical-dml-authority", `Restricted runtime canonical-table DML grants observed: ${authority.runtimeTableDml}.`);
  if (id === 17) add("runtime:sequence-authority", `Restricted runtime sequence authority observed: ${authority.runtimeSequenceAuthority}.`);
  if (id === 18) add("runtime:public-dml-authority", `PUBLIC canonical-table DML grants observed: ${authority.publicTableDml}.`);
  if (id === 19) add("runtime:public-function-authority", `PUBLIC function execution grants observed: ${authority.publicFunctionExecution}.`);
  if (id === 24) add("closeout:listener-proof", `Application and exact M17 database listener probes are absent; database status is ${listenerCloseout.databaseStatusAfter}.`);
  if (id === 25) add("runtime:evidence-privacy", "Direct observations exclude session tokens and passed the bounded evidence privacy scan.");
  if (id >= 37 && id <= 50) add("runtime:catalog-preview", `The runtime catalog exposed ${http.catalogChoiceCount} choices and the server-resolved two-line preview subtotal was ${http.previewSubtotalCents} cents.`);
  if (id === 51 || id === 61 || id === 71) add("runtime:transaction-commit", "The synthetic listing transaction committed and its canonical order was read back successfully.");
  if (id === 52 || id === 80) add("runtime:exact-replay", `Exact replay reused the order identity: ${transaction.exactReplay.orderIdsEqual}.`);
  if (id === 58 || id === 82) add("runtime:conflicting-replay", "A changed payload under the same submission identity was rejected with exact pre/post canonical counts.");
  if (id === 63 || id === 81 || id === 85) add("runtime:snapshot-replay", `Exact replay reused deterministic snapshots without count drift: ${transaction.exactReplay.snapshotsReused}.`);
  const rollbackStages: Partial<Record<number, TransactionFaultStage>> = {
    72: "after_customer",
    73: "after_property",
    74: "after_first_commercial_snapshot",
    75: "before_order",
    76: "after_order_before_readback",
    77: "after_readback_before_commit",
  };
  const rollbackStage = rollbackStages[id];
  if (rollbackStage) add(`runtime:rollback:${rollbackStage}`, `Injected ${rollbackStage} failure was rejected and left exact canonical counts.`);
  if (id === 79 || id === 97 || id === 98) add("runtime:canonical-readback", `Authenticated canonical order readback matched the created identity: ${http.canonicalOrderReadBack}.`);
  if (id === 83 || id === 87) add("runtime:identical-concurrency", `Simultaneous identical submissions returned one order identity: ${transaction.concurrency.orderIdsEqual}.`);
  if (id === 84) add("runtime:independent-concurrency", `Simultaneous different submissions retained different identities: ${transaction.independence.orderIdsDifferent}.`);
  if (id === 88) add("runtime:party-cardinality", `Canonical readback contained exactly ${http.canonicalPartyCount} derived parties.`);
  if (id === 94) add("runtime:item-cardinality", `Canonical readback contained exactly ${http.canonicalItemCount} immutable commercial lines.`);
  if (id === 101) add("runtime:complete-http-flow", "The session, catalog, preview, concurrent create, confirmation, and authenticated readback flow completed.");
  if (id === 119) add("closeout:evidence-privacy", "Fresh observations, static matrix, dedicated result, and strict-chain log passed the bounded privacy scan.");
  return sources;
}

function buildFinalRuntimeVerification(
  observations: RuntimeObservations,
  matrix: StaticAcceptanceMatrix,
  listenerCloseout: ListenerCloseoutProof,
): FinalRuntimeVerification {
  const acceptance = Object.fromEntries(matrix.rows.map((row) => {
    const staticSources: AcceptanceSource[] = row.staticObservations.map((detail) => ({
      category: staticCategory(detail),
      detail,
      passed: true,
    }));
    const directSources = directRuntimeSources(row.id, observations, listenerCloseout);
    const sources: AcceptanceSource[] = [
      { category: "strict-verify-all", detail: "The unmodified npm run verify:all chain exited 0 with fail-fast propagation.", passed: true },
      ...staticSources,
      ...directSources,
    ];
    const sourceCategories = [...new Set(sources.map((source) => source.category))];
    const passed = row.pass && row.staticCoveragePass && sources.every((source) => source.passed);
    return [String(row.id), {
      passed,
      observation: `Acceptance ${row.id} passed for “${row.statement}” Sources: ${sourceCategories.join(", ")}.`,
      evidence: {
        statement: row.statement,
        sourceCategories,
        staticObservations: row.staticObservations,
        directRuntimeObservations: directSources.map((source) => source.detail),
        verifyAllLog: "VERIFY_ALL.log" as const,
      },
    } satisfies RuntimeAcceptanceObservation];
  }));
  const result: FinalRuntimeVerification = {
    schema: "P02_M17_A_RUNTIME_VERIFICATION_V1",
    generatedAt: new Date().toISOString(),
    verifyAll: { command: "npm run verify:all", exitCode: 0, log: "VERIFY_ALL.log" },
    observations: { schema: observations.schema, file: "RUNTIME_OBSERVATIONS.json" },
    staticMatrix: { schema: matrix.schema, file: "BEHAVIOR_ACCEPTANCE_MATRIX.json" },
    listenerCloseout,
    acceptanceIds: ACCEPTANCE_IDS,
    acceptance,
  };
  if (Object.values(result.acceptance).some((entry) => !entry.passed)) throw new Error("M17A_ACCEPTANCE_DERIVATION_FAILURE");
  assertEvidencePrivacy("FINAL_RUNTIME_VERIFICATION", JSON.stringify(result));
  return result;
}

function assertStrictVerifyAllLog(log: string, observationId: string): void {
  const runtimeMarker = `"status":"P02_M17_A_RUNTIME_OBSERVATIONS_PASSED","observationId":"${observationId}"`;
  const runtimeIndex = log.lastIndexOf(runtimeMarker);
  const dedicatedMarker = '"verifier": "P02-M17-A_INTERNAL_OPERATIONS_CONSOLE_NEW_LISTING_V1"';
  const dedicatedIndex = log.lastIndexOf(dedicatedMarker);
  const foundationMarker = '"verifier": "P02-M17-A_FOUNDATION_CLOSEOUT_V1"';
  const foundationIndex = log.lastIndexOf(foundationMarker);
  const dedicatedPassed = dedicatedIndex !== -1 && log.slice(dedicatedIndex, dedicatedIndex + 300).includes('"pass": true');
  const foundationPassed = foundationIndex !== -1 && log.slice(foundationIndex, foundationIndex + 300).includes('"pass": true');
  if (runtimeIndex === -1 || dedicatedIndex <= runtimeIndex || foundationIndex <= dedicatedIndex
      || !dedicatedPassed || !foundationPassed
      || log.includes("P02_M17_A_RUNTIME_OBSERVATIONS_FAILED")) {
    throw new Error("M17A_VERIFY_ALL_LOG_FAILURE");
  }
}

async function readFreshCloseoutEvidence(): Promise<{
  observations: RuntimeObservations;
  matrix: StaticAcceptanceMatrix;
}> {
  if (existsSync(RUNTIME_VERIFICATION_PATH)) throw new Error("M17A_PREMATURE_RUNTIME_VERIFICATION_FAILURE");
  const [observationsText, matrixText, dedicatedText, verifyAllLog, observationsStat, matrixStat, dedicatedStat, logStat] = await Promise.all([
    readFile(RUNTIME_OBSERVATIONS_PATH, "utf8"),
    readFile(STATIC_MATRIX_PATH, "utf8"),
    readFile(DEDICATED_VERIFIER_PATH, "utf8"),
    readFile(VERIFY_ALL_LOG_PATH, "utf8"),
    stat(RUNTIME_OBSERVATIONS_PATH),
    stat(STATIC_MATRIX_PATH),
    stat(DEDICATED_VERIFIER_PATH),
    stat(VERIFY_ALL_LOG_PATH),
  ]);
  if (observationsStat.size === 0 || matrixStat.size === 0 || dedicatedStat.size === 0 || logStat.size === 0) {
    throw new Error("M17A_CLOSEOUT_EVIDENCE_EMPTY");
  }
  assertEvidencePrivacy("RUNTIME_OBSERVATIONS", observationsText);
  assertEvidencePrivacy("STATIC_MATRIX", matrixText);
  assertEvidencePrivacy("DEDICATED_VERIFIER", dedicatedText);
  assertEvidencePrivacy("VERIFY_ALL_LOG", verifyAllLog);

  const observations = JSON.parse(observationsText) as RuntimeObservations;
  assertStrictVerifyAllLog(verifyAllLog, observations.observationId);
  assertDirectObservations(observations, {
    logBirthtimeMs: logStat.birthtimeMs,
    logMtimeMs: logStat.mtimeMs,
    observationsMtimeMs: observationsStat.mtimeMs,
    matrixMtimeMs: matrixStat.mtimeMs,
    dedicatedMtimeMs: dedicatedStat.mtimeMs,
  });
  const matrix = JSON.parse(matrixText) as StaticAcceptanceMatrix;
  if (matrix.schema !== "P02-M17-A_ACCEPTANCE_MATRIX_V1" || matrix.mode !== "static-coverage"
      || !Array.isArray(matrix.rows) || matrix.rows.length !== 120
      || JSON.stringify(matrix.rows.map((row) => row.id)) !== JSON.stringify(ACCEPTANCE_IDS)
      || matrix.rows.some((row) => row.pass !== true || row.staticCoveragePass !== true
        || row.runtimeRequired !== false || typeof row.statement !== "string" || row.statement.trim().length === 0
        || !Array.isArray(row.staticObservations) || row.staticObservations.length === 0
        || row.staticObservations.some((observation) => typeof observation !== "string" || observation.trim().length === 0))) {
    throw new Error("M17A_STATIC_MATRIX_FAILURE");
  }
  const dedicated = JSON.parse(dedicatedText) as {
    verifier?: unknown;
    mode?: unknown;
    pass?: unknown;
    acceptanceCount?: unknown;
    acceptancePassed?: unknown;
    runtimeEvidenceLoaded?: unknown;
    failures?: unknown;
    acceptance?: Array<{ id?: unknown; statement?: unknown; pass?: unknown }>;
  };
  if (dedicated.verifier !== "P02-M17-A_INTERNAL_OPERATIONS_CONSOLE_NEW_LISTING_V1"
      || dedicated.mode !== "static-coverage" || dedicated.pass !== true
      || dedicated.acceptanceCount !== 120 || dedicated.acceptancePassed !== 120
      || dedicated.runtimeEvidenceLoaded !== false || !Array.isArray(dedicated.failures) || dedicated.failures.length !== 0
      || !Array.isArray(dedicated.acceptance) || dedicated.acceptance.length !== 120
      || dedicated.acceptance.some((row, index) => row.id !== index + 1 || row.pass !== true || row.statement !== matrix.rows[index]?.statement)) {
    throw new Error("M17A_DEDICATED_VERIFIER_FAILURE");
  }
  return { observations, matrix };
}

type M17DatabaseStatus = "absent" | "running" | "stopped";

function m17DatabaseStatus(): M17DatabaseStatus {
  if (!existsSync(M17_DATA_DIRECTORY)) return "absent";
  const status = spawnSync(PG_CTL, ["-D", M17_DATA_DIRECTORY, "status"], { stdio: "ignore", timeout: 10_000 });
  if (status.error || status.signal !== null) throw new Error("M17A_DATABASE_STATUS_INDETERMINATE");
  if (status.status === 0) return "running";
  if (status.status === 3) return "stopped";
  throw new Error("M17A_DATABASE_STATUS_INDETERMINATE");
}

function stopExactM17Database(): { before: M17DatabaseStatus; after: "absent" | "stopped" } {
  const before = m17DatabaseStatus();
  if (before === "running") {
    const stopped = spawnSync(PG_CTL, ["-D", M17_DATA_DIRECTORY, "-m", "fast", "-w", "stop"], {
      stdio: "ignore",
      timeout: 30_000,
    });
    if (stopped.error || stopped.signal !== null || stopped.status !== 0) throw new Error("M17A_DATABASE_STOP_FAILURE");
  }
  const after = m17DatabaseStatus();
  if (after === "running") throw new Error("M17A_DATABASE_STOP_FAILURE");
  return { before, after };
}

async function probeListener(options: { host: string; port: number } | { path: string }): Promise<"absent" | "listening"> {
  return new Promise((resolveProbe, rejectProbe) => {
    const socket = createConnection(options);
    let settled = false;
    const finish = (result: "absent" | "listening" | Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (result instanceof Error) rejectProbe(result);
      else resolveProbe(result);
    };
    socket.once("connect", () => finish("listening"));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") finish("absent");
      else finish(new Error("M17A_LISTENER_PROBE_INDETERMINATE"));
    });
    socket.setTimeout(2_000, () => finish(new Error("M17A_LISTENER_PROBE_INDETERMINATE")));
  });
}

async function proveListenerAbsent(options: { host: string; port: number } | { path: string }): Promise<true> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await probeListener(options) !== "absent") throw new Error("M17A_LISTENER_REMAINS_ACTIVE");
  }
  return true;
}

async function closeoutExactM17Listeners(): Promise<ListenerCloseoutProof> {
  const errors: unknown[] = [];
  let databaseStatus: { before: M17DatabaseStatus; after: "absent" | "stopped" } | undefined;
  let noApplicationListener: true | undefined;
  let noM17DatabaseListener: true | undefined;
  try {
    databaseStatus = stopExactM17Database();
  } catch (error) {
    errors.push(error);
  }
  try {
    noApplicationListener = await proveListenerAbsent({ host: "127.0.0.1", port: 4317 });
  } catch (error) {
    errors.push(error);
  }
  try {
    const socketPath = `${OPERATIONS_CONSOLE_DATABASE.host}/.s.PGSQL.${OPERATIONS_CONSOLE_DATABASE.port}`;
    noM17DatabaseListener = await proveListenerAbsent({ path: socketPath });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0 || !databaseStatus || !noApplicationListener || !noM17DatabaseListener) {
    throw new AggregateError(errors, "M17A_LISTENER_CLOSEOUT_FAILURE");
  }
  return {
    databaseStatusBefore: databaseStatus.before,
    databaseStatusAfter: databaseStatus.after,
    noApplicationListener,
    noM17DatabaseListener,
  };
}

export async function finalizeInternalOperationsConsoleNewListing(logPath: string): Promise<FinalRuntimeVerification> {
  if (logPath !== VERIFY_ALL_LOG_PATH) throw new Error("M17A_FINALIZE_LOG_PATH_FAILURE");
  await rm(RUNTIME_VERIFICATION_PATH, { force: true });
  let closeoutEvidence: { observations: RuntimeObservations; matrix: StaticAcceptanceMatrix } | undefined;
  let validationError: unknown;
  try {
    closeoutEvidence = await readFreshCloseoutEvidence();
  } catch (error) {
    validationError = error;
  }

  let listenerCloseout: ListenerCloseoutProof | undefined;
  let listenerError: unknown;
  try {
    listenerCloseout = await closeoutExactM17Listeners();
  } catch (error) {
    listenerError = error;
  }
  if (validationError || listenerError) {
    await rm(RUNTIME_VERIFICATION_PATH, { force: true });
    throw new AggregateError([...(validationError ? [validationError] : []), ...(listenerError ? [listenerError] : [])], "M17A_FINALIZE_FAILURE");
  }
  if (!closeoutEvidence || !listenerCloseout) throw new Error("M17A_FINALIZE_INCOMPLETE");
  const result = buildFinalRuntimeVerification(closeoutEvidence.observations, closeoutEvidence.matrix, listenerCloseout);
  await writeFile(RUNTIME_VERIFICATION_PATH, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

function ownerClient(): pg.Client {
  return new pg.Client({
    ...OPERATIONS_CONSOLE_DATABASE,
    user: OWNER_ROLE,
    application_name: "p02-m17-a-deterministic-setup",
  });
}

async function insertRows(client: pg.Client, table: string, rows: readonly Record<string, unknown>[]): Promise<number> {
  if (!/^[a-z_][a-z0-9_]*$/u.test(table)) throw new Error("M17A_SETUP_INVALID_TABLE");
  let inserted = 0;
  for (const row of rows) {
    const columns = Object.keys(row);
    if (columns.length === 0 || columns.some((column) => !/^[a-z_][a-z0-9_]*$/u.test(column))) {
      throw new Error("M17A_SETUP_INVALID_COLUMN");
    }
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(",");
    await client.query(
      `INSERT INTO medialab_core."${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${placeholders})`,
      columns.map((column) => row[column]),
    );
    inserted += 1;
  }
  return inserted;
}

async function seedMinimumAcceptedEvidence(client: pg.Client): Promise<number> {
  let inserted = 0;
  inserted += await insertRows(client, "organizations", [ORGANIZATION_FIXTURE]);
  inserted += await insertRows(client, "people", PEOPLE_FIXTURES);
  inserted += await insertRows(client, "identities", IDENTITY_FIXTURES);
  inserted += await insertRows(client, "memberships", MEMBERSHIP_FIXTURES);
  inserted += await insertRows(client, "permissions", [
    ...PERMISSION_FIXTURES,
    ...CATALOG_PERMISSION_FIXTURES,
    ...ORDER_PERMISSION_FIXTURES,
    ...PROPERTY_HUB_PERMISSION_FIXTURES,
    ...SCHEDULING_PERMISSION_FIXTURES,
    ...JOB_SERVICE_PERMISSION_FIXTURES,
    ...MISSION_PLAN_PERMISSION_FIXTURES,
    ...MEDIA_ASSET_PERMISSION_FIXTURES,
    ...MEDIA_CAPTURE_PERMISSION_FIXTURES,
    ...MEDIA_CULL_PERMISSION_FIXTURES,
    ...MEDIA_EDITOR_HANDOFF_PERMISSION_FIXTURES,
    ...MEDIA_RETURN_REVIEW_PERMISSION_FIXTURES,
  ]);
  inserted += await insertRows(client, "permission_sets", [PERMISSION_SET_FIXTURE]);
  inserted += await insertRows(client, "permission_set_permissions", [
    ...PERMISSION_SET_PERMISSION_FIXTURES,
    ...CATALOG_PERMISSION_SET_PERMISSION_FIXTURES,
    ...ORDER_PERMISSION_SET_PERMISSION_FIXTURES,
    ...PROPERTY_HUB_PERMISSION_SET_PERMISSION_FIXTURES,
    ...SCHEDULING_PERMISSION_SET_PERMISSION_FIXTURES,
    ...JOB_SERVICE_PERMISSION_SET_PERMISSION_FIXTURES,
    ...MISSION_PLAN_PERMISSION_SET_PERMISSION_FIXTURES,
    ...MEDIA_ASSET_PERMISSION_SET_PERMISSION_FIXTURES,
    ...MEDIA_CAPTURE_PERMISSION_SET_PERMISSION_FIXTURES.filter((binding) =>
      binding.permission_id === MEDIA_CAPTURE_PERMISSION_FIXTURES.find((permission) => permission.code === "media_capture.read")!.id),
    ...MEDIA_CULL_PERMISSION_SET_PERMISSION_FIXTURES.filter((binding) =>
      binding.permission_id === MEDIA_CULL_PERMISSION_FIXTURES.find((permission) => permission.code === "media_cull.read")!.id),
    ...MEDIA_EDITOR_HANDOFF_PERMISSION_SET_PERMISSION_FIXTURES.filter((binding) =>
      binding.permission_id === MEDIA_EDITOR_HANDOFF_PERMISSION_FIXTURES.find((permission) => permission.code === "media_editor_handoff.read")!.id),
    ...MEDIA_RETURN_REVIEW_PERMISSION_SET_PERMISSION_FIXTURES,
  ]);
  inserted += await insertRows(client, "membership_permission_sets", MEMBERSHIP_PERMISSION_SET_FIXTURES);
  for (const fixtureTable of CURRENT_REAL_ESTATE_CATALOG_TABLES) {
    inserted += await insertRows(
      client,
      fixtureTable.table,
      fixtureTable.rows as unknown as readonly Record<string, unknown>[],
    );
  }
  return inserted;
}

export async function resetAndSeedOperationsConsoleDatabase(resetNumber = 1): Promise<BootstrapObservation> {
  const client = ownerClient();
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS medialab_core CASCADE");
    await client.query("DROP SCHEMA IF EXISTS medialab_meta CASCADE");
    const migration = await runMigrations({
      migrationsDir: MIGRATIONS_DIR,
      client,
      runtimeUser: RUNTIME_ROLE,
      database: OPERATIONS_CONSOLE_DATABASE.database,
      user: OWNER_ROLE,
    });
    if (migration.failed || migration.applied.length !== 28 || migration.skipped.length !== 0) {
      throw new Error("M17A_SETUP_MIGRATION_LEDGER_FAILURE");
    }
    await client.query("BEGIN");
    let seededRows = 0;
    try {
      seededRows = await seedMinimumAcceptedEvidence(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const ledger = await client.query<{ filename: string; sha256: string }>(
      "SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename",
    );
    if (ledger.rows.length !== 28 || !ledger.rows[0]?.filename.startsWith("0001_") ||
        !ledger.rows[24]?.filename.startsWith("0025_") || !ledger.rows[25]?.filename.startsWith("0026_") ||
        ledger.rows[26]?.filename !== "0027_contextual_editor_review_mobile_quick_edit_web_bridge.sql" ||
        ledger.rows[27]?.filename !== "0028_client_account_and_operator_contact_intake_foundation.sql" ||
        ledger.rows[27]?.filename !== "0028_client_account_and_operator_contact_intake_foundation.sql") {
      throw new Error("M17A_SETUP_MIGRATION_LEDGER_FAILURE");
    }
    return { ledger: ledger.rows, resetNumber, seededRows };
  } finally {
    await client.end();
  }
}

export async function issueOperationsConsoleDatabaseSession(): Promise<{
  context: ServerBoundDevelopmentOperatorContext;
  databaseSessionToken: string;
}> {
  const databaseSessionToken = randomBytes(32).toString("base64url");
  const tokenSha256 = createHash("sha256").update(databaseSessionToken, "utf8").digest("hex");
  const client = ownerClient();
  await client.connect();
  try {
    await client.query(
      `INSERT INTO medialab_core.development_sessions(
        id,identity_id,token_sha256,issued_at,expires_at,revoked_at
      ) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 hours',NULL)`,
      [randomUUID(), OPERATOR_IDENTITY_ID, tokenSha256],
    );
  } finally {
    await client.end();
  }
  return {
    databaseSessionToken,
    context: Object.freeze({
      databaseSessionToken,
      organizationId: OPERATIONS_CONSOLE_ORGANIZATION_ID,
      actorPersonId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
      membershipId: OPERATOR_MEMBERSHIP_ID,
    }),
  };
}

async function canonicalCounts(): Promise<CountObservation> {
  const client = ownerClient();
  await client.connect();
  try {
    const tables = [
      "people", "identities", "memberships", "person_external_references", "properties", "property_snapshots",
      "commercial_snapshots", "commercial_snapshot_package_items", "orders", "order_parties", "order_items",
      "order_external_references", "order_idempotency_records", "order_events", "order_relationships",
    ] as const;
    const result: CountObservation = {};
    for (const table of tables) {
      const count = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM medialab_core."${table}"`);
      result[table] = count.rows[0]!.count;
    }
    return result;
  } finally {
    await client.end();
  }
}

function exactCounts(left: CountObservation, right: CountObservation): boolean {
  const keys = Object.keys(left).sort();
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

async function buildCommand(
  database: OperationsConsoleDatabase,
  databaseSessionToken: string,
  suffix: string,
): Promise<CreateListingTransactionCommand> {
  const property = {
    addressLine1: `${suffix.toUpperCase()} Verification Lane`,
    addressLine2: null,
    locality: "Example City",
    administrativeArea: "NY",
    postalCode: "10001",
    countryCode: "US",
    squareFeet: 1800,
  };
  const customer = { displayName: `Candidate ${suffix}`, email: `candidate-${suffix}@example.invalid` };
  const selections = [
    { productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 },
    { productCode: "VIRTUAL_TWILIGHT_PHOTO", quantity: 2 },
  ];
  const projection = await database.getCatalog(databaseSessionToken);
  const lines = resolveCatalogSelections(projection, selections, property.squareFeet);
  return {
    databaseSessionToken,
    submissionId: `proof-${suffix}`,
    requestFingerprint: sha256Evidence({ customer, property, selections }),
    expectedCommercialFingerprint: commercialFingerprint(lines),
    customer,
    property,
    selections,
  };
}

async function runTransactionProofs(databaseSessionToken: string) {
  const database = new OperationsConsoleDatabase();
  try {
    const faultStages: TransactionFaultStage[] = [
      "after_customer",
      "after_property",
      "after_first_commercial_snapshot",
      "before_order",
      "after_order_before_readback",
      "after_readback_before_commit",
    ];
    const rollback: Record<string, { rejected: boolean; countsExact: boolean }> = {};
    for (const [index, stage] of faultStages.entries()) {
      const before = await canonicalCounts();
      const command = await buildCommand(database, databaseSessionToken, `rollback-${index + 1}`);
      let rejected = false;
      try {
        await database.createListing({ ...command, fault: (observed) => {
          if (observed === stage) throw new Error("M17A_INJECTED_TRANSACTION_FAILURE");
        } });
      } catch {
        rejected = true;
      }
      const after = await canonicalCounts();
      rollback[stage] = { rejected, countsExact: exactCounts(before, after) };
      if (!rejected || !rollback[stage].countsExact) throw new Error("M17A_ROLLBACK_PROOF_FAILURE");
    }

    const replayCommand = await buildCommand(database, databaseSessionToken, "replay");
    const replayFirst = await database.createListing(replayCommand);
    const replayCounts = await canonicalCounts();
    const replaySecond = await database.createListing(replayCommand);
    const replayCountsAfter = await canonicalCounts();
    if (replayFirst.orderId !== replaySecond.orderId || !replaySecond.snapshotsReused || !exactCounts(replayCounts, replayCountsAfter)) {
      throw new Error("M17A_EXACT_REPLAY_PROOF_FAILURE");
    }

    const beforeConflict = await canonicalCounts();
    const changed = {
      ...replayCommand,
      customer: { ...replayCommand.customer, email: "candidate-replay-changed@example.invalid" },
      requestFingerprint: sha256Evidence({ changed: true, original: replayCommand.requestFingerprint }),
    };
    let conflictRejected = false;
    try { await database.createListing(changed); } catch { conflictRejected = true; }
    const afterConflict = await canonicalCounts();
    if (!conflictRejected || !exactCounts(beforeConflict, afterConflict)) throw new Error("M17A_CONFLICT_ROLLBACK_PROOF_FAILURE");

    const concurrentCommand = await buildCommand(database, databaseSessionToken, "concurrent");
    const [concurrentOne, concurrentTwo] = await Promise.all([
      database.createListing(concurrentCommand),
      database.createListing(concurrentCommand),
    ]);
    if (concurrentOne.orderId !== concurrentTwo.orderId) throw new Error("M17A_CONCURRENT_REPLAY_PROOF_FAILURE");

    const [independentOne, independentTwo] = await Promise.all([
      database.createListing(await buildCommand(database, databaseSessionToken, "independent-a")),
      database.createListing(await buildCommand(database, databaseSessionToken, "independent-b")),
    ]);
    if (independentOne.orderId === independentTwo.orderId) throw new Error("M17A_INDEPENDENT_SUBMISSION_PROOF_FAILURE");

    return {
      rollback,
      exactReplay: {
        orderIdsEqual: replayFirst.orderId === replaySecond.orderId,
        countsExact: exactCounts(replayCounts, replayCountsAfter),
        snapshotsReused: replaySecond.snapshotsReused,
      },
      conflict: { rejected: conflictRejected, countsExact: exactCounts(beforeConflict, afterConflict) },
      concurrency: { orderIdsEqual: concurrentOne.orderId === concurrentTwo.orderId },
      independence: { orderIdsDifferent: independentOne.orderId !== independentTwo.orderId },
    };
  } finally {
    await database.close();
  }
}

async function jsonRequest(url: string, cookie: string | null, method = "GET", body?: unknown) {
  const headers: Record<string, string> = { origin: "http://127.0.0.1:4317" };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const responseBody = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`M17A_HTTP_FLOW_FAILURE_${response.status}`);
  return { response, body: responseBody };
}

async function runHttpFlow(context: ServerBoundDevelopmentOperatorContext): Promise<HttpFlowObservation> {
  const database = new OperationsConsoleDatabase();
  const reviewMediaRoot = resolve(OPERATIONS_CONSOLE_OUTPUT_ROOT, "review-media-store");
  await rm(reviewMediaRoot, { recursive: true, force: true });
  await mkdir(reviewMediaRoot, { recursive: true, mode: 0o700 });
  const service = new OperationsConsoleService(database, {
    reviewMediaStore: new ReviewMediaStore({ root: reviewMediaRoot }),
  });
  const sessions = new DevelopmentOperatorSessionManager({ ttlSeconds: 900 });
  const app = await startOperationsConsole({ service, sessions, developmentOperatorContext: context });
  try {
    const sessionResponse = await jsonRequest("http://127.0.0.1:4317/session", null, "POST", {});
    const setCookie = sessionResponse.response.headers.get("set-cookie");
    const cookie = setCookie?.split(";", 1)[0] ?? null;
    if (!cookie || String(sessionResponse.body.contract) !== "DevelopmentOperatorSessionReceiptV1") {
      throw new Error("M17A_HTTP_SESSION_FAILURE");
    }
    const catalog = (await jsonRequest("http://127.0.0.1:4317/api/catalog", cookie)).body as {
      choices: Array<{ choiceHandle: string; displayName: string }>;
    };
    const names = ["Medium Home Package", "Virtual Twilight Photo"];
    const selected = names.map((name) => catalog.choices.find((choice) => choice.displayName === name));
    if (selected.some((choice) => !choice)) throw new Error("M17A_HTTP_CATALOG_FAILURE");
    const previewRequest = {
      customer: { displayName: "HTTP Candidate", email: "http-candidate@example.invalid" },
      property: {
        addressLine1: "1700 Verification Lane",
        addressLine2: null,
        locality: "Example City",
        administrativeArea: "NY",
        postalCode: "10001",
        countryCode: "US",
        squareFeet: 1800,
      },
      services: [
        { choiceHandle: selected[0]!.choiceHandle, quantity: 1 },
        { choiceHandle: selected[1]!.choiceHandle, quantity: 2 },
      ],
    };
    const preview = (await jsonRequest("http://127.0.0.1:4317/api/listings/preview", cookie, "POST", previewRequest)).body as {
      previewReceipt: string;
      subtotalCents: number;
    };
    const createBody = { previewReceipt: preview.previewReceipt };
    const [createdOne, createdTwo] = await Promise.all([
      jsonRequest("http://127.0.0.1:4317/api/listings", cookie, "POST", createBody),
      jsonRequest("http://127.0.0.1:4317/api/listings", cookie, "POST", createBody),
    ]);
    const receiptOne = createdOne.body as { replayed: boolean; confirmation: { orderId: string; parties: unknown[]; items: unknown[] } };
    const receiptTwo = createdTwo.body as { replayed: boolean; confirmation: { orderId: string } };
    const readback = (await jsonRequest(
      `http://127.0.0.1:4317/api/orders/${receiptOne.confirmation.orderId}`, cookie,
    )).body as { orderId: string; parties: unknown[]; items: unknown[] };
    if (receiptOne.confirmation.orderId !== receiptTwo.confirmation.orderId || readback.orderId !== receiptOne.confirmation.orderId) {
      throw new Error("M17A_HTTP_REPLAY_READBACK_FAILURE");
    }
    return {
      catalogChoiceCount: catalog.choices.length,
      selectedChoiceCount: selected.length,
      previewSubtotalCents: preview.subtotalCents,
      concurrentOrderIdsEqual: receiptOne.confirmation.orderId === receiptTwo.confirmation.orderId,
      replayResponses: Number(receiptOne.replayed) + Number(receiptTwo.replayed),
      canonicalOrderReadBack: readback.orderId === receiptOne.confirmation.orderId,
      canonicalPartyCount: readback.parties.length,
      canonicalItemCount: readback.items.length,
    };
  } finally {
    await app.close();
  }
}

async function authorityProof() {
  const client = ownerClient();
  await client.connect();
  try {
    const runtimeTableDml = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.role_table_grants
       WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [RUNTIME_ROLE],
    );
    const runtimeSequence = await client.query<{ count: number }>(
      `SELECT count(*) FILTER (
         WHERE CASE WHEN c.relkind='S' THEN has_sequence_privilege($1,c.oid,'USAGE,UPDATE') ELSE false END
       )::int AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='medialab_core'`,
      [RUNTIME_ROLE],
    );
    const publicTableDml = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='medialab_core' AND c.relkind IN ('r','p')
         AND (has_table_privilege('public',c.oid,'INSERT') OR has_table_privilege('public',c.oid,'UPDATE') OR has_table_privilege('public',c.oid,'DELETE'))`,
    );
    const publicFunctions = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='medialab_core' AND has_function_privilege('public',p.oid,'EXECUTE')`,
    );
    const runtimeFunctions = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='medialab_core' AND has_function_privilege($1,p.oid,'EXECUTE')`,
      [RUNTIME_ROLE],
    );
    const permissionCodes = [
      "media_capture.read",
      "media_capture.manage",
      "media_cull.read",
      "media_cull.manage",
      "media_editor_handoff.read",
      "media_editor_handoff.manage",
      "media_return_review.read",
      "media_return_review.manage",
      "media_asset.read",
      "media_asset.manage",
    ] as const;
    const actorPermissionRows = await client.query<{ code: string; allowed: boolean }>(
      `SELECT code, medialab_core.actor_has_permission($1,$2,code) AS allowed
         FROM unnest($3::text[]) AS requested(code)`,
      [OPERATOR_IDENTITY_ID, OPERATIONS_CONSOLE_ORGANIZATION_ID, permissionCodes],
    );
    return {
      runtimeTableDml: runtimeTableDml.rows[0]!.count,
      runtimeSequenceAuthority: runtimeSequence.rows[0]!.count,
      publicTableDml: publicTableDml.rows[0]!.count,
      publicFunctionExecution: publicFunctions.rows[0]!.count,
      runtimeFunctionExecutionCount: runtimeFunctions.rows[0]!.count,
      actorPermissions: Object.fromEntries(actorPermissionRows.rows.map((row) => [row.code, row.allowed])),
    };
  } finally {
    await client.end();
  }
}

export async function runInternalOperationsConsoleNewListing(): Promise<RuntimeObservations> {
  await mkdir(VERIFICATION_DIR, { recursive: true });
  await Promise.all([
    rm(RUNTIME_OBSERVATIONS_PATH, { force: true }),
    rm(RUNTIME_VERIFICATION_PATH, { force: true }),
  ]);
  const firstReset = await resetAndSeedOperationsConsoleDatabase(1);
  const secondReset = await resetAndSeedOperationsConsoleDatabase(2);
  const issued = await issueOperationsConsoleDatabaseSession();
  const transactionProofs = await runTransactionProofs(issued.databaseSessionToken);
  const httpFlow = await runHttpFlow(issued.context);
  const authority = await authorityProof();
  if (authority.runtimeTableDml !== 0 || authority.runtimeSequenceAuthority !== 0 ||
      authority.publicTableDml !== 0 || authority.publicFunctionExecution !== 0 ||
      authority.actorPermissions["media_capture.read"] !== true ||
      authority.actorPermissions["media_capture.manage"] !== false ||
      authority.actorPermissions["media_cull.read"] !== true ||
      authority.actorPermissions["media_cull.manage"] !== false ||
      authority.actorPermissions["media_editor_handoff.read"] !== true ||
      authority.actorPermissions["media_editor_handoff.manage"] !== false ||
      authority.actorPermissions["media_return_review.read"] !== true ||
      authority.actorPermissions["media_return_review.manage"] !== true ||
      authority.actorPermissions["media_asset.read"] !== true ||
      authority.actorPermissions["media_asset.manage"] !== true) {
    throw new Error("M17A_RUNTIME_AUTHORITY_PROOF_FAILURE");
  }
  const result: RuntimeObservations = {
    schema: "P02_M17_A_RUNTIME_OBSERVATIONS_V1",
    observationId: randomUUID(),
    generatedAt: new Date().toISOString(),
    boundary: { host: "127.0.0.1", port: 4317, databaseSocket: OPERATIONS_CONSOLE_DATABASE.host,
      databasePort: OPERATIONS_CONSOLE_DATABASE.port, database: OPERATIONS_CONSOLE_DATABASE.database,
      runtimeRole: RUNTIME_ROLE },
    bootstrap: { firstReset, secondReset },
    transactionProofs,
    httpFlow,
    authority,
    sensitiveValuesExcluded: true,
  };
  await writeFile(RUNTIME_OBSERVATIONS_PATH, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

const currentPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentPath === invokedPath) {
  const argumentsList = process.argv.slice(2);
  const finalizePrefix = "--finalize=";
  const finalizeArgument = argumentsList.length === 1 && argumentsList[0]?.startsWith(finalizePrefix)
    ? argumentsList[0].slice(finalizePrefix.length)
    : undefined;
  const operation = finalizeArgument !== undefined
    ? finalizeInternalOperationsConsoleNewListing(finalizeArgument).then((result) => {
      process.stdout.write(`${JSON.stringify({
        status: "P02_M17_A_RUNTIME_FINALIZATION_PASSED",
        acceptancePassed: Object.values(result.acceptance).filter((entry) => entry.passed).length,
        noApplicationListener: result.listenerCloseout.noApplicationListener,
        noM17DatabaseListener: result.listenerCloseout.noM17DatabaseListener,
      })}\n`);
    })
    : argumentsList.length === 0
      ? runInternalOperationsConsoleNewListing().then((result) => {
        process.stdout.write(`${JSON.stringify({
          status: "P02_M17_A_RUNTIME_OBSERVATIONS_PASSED",
          observationId: result.observationId,
          resets: 2,
          rollbackStages: Object.keys(result.transactionProofs.rollback).length,
          canonicalOrderReadBack: result.httpFlow.canonicalOrderReadBack,
        })}\n`);
      })
      : Promise.reject(new Error("M17A_RUNNER_ARGUMENT_FAILURE"));
  operation.catch(() => {
    process.stderr.write(finalizeArgument !== undefined
      ? "P02_M17_A_RUNTIME_FINALIZATION_FAILED\n"
      : "P02_M17_A_RUNTIME_OBSERVATIONS_FAILED\n");
    process.exitCode = 1;
  });
}
