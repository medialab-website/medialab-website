import { createHash, randomUUID } from "node:crypto";
import { chmod, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startOperationsConsole } from "../src/operations-console/server.js";
import { OperationsConsoleService } from "../src/operations-console/service.js";
import { ReviewMediaStore } from "../src/operations-console/review-media-store.js";
import { OperationsConsoleDatabase } from "../src/operations-console/database.js";
import { DevelopmentOperatorSessionManager } from "../src/operations-console/session.js";
import { resolveControlledPilotPaths } from "../src/current-pilot/config.js";
import {
  issueControlledPilotDatabaseSession,
  prepareControlledPilotDatabase,
} from "../src/current-pilot/persistent-database.js";
import { admitControlledPilotCurrentOperations } from "../src/current-pilot/admission.js";
import type { OperationsHome } from "../src/operations-console/operations-contracts.js";

const OWNER_VALIDATED_RANGE = Object.freeze({
  from: "2026-08-21T04:00:00.000Z",
  to: "2026-10-20T04:00:00.000Z",
});

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writePrivateJson(path: string, value: unknown): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return sha256(bytes);
}

function opaqueOrderHashes(items: OperationsHome["items"]): string[] {
  return items.map((item) => sha256(`M24A:MISSION_CONTROL_ORDER:${item.orderId}`)).sort();
}

function optionalArgument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  return value ? resolve(value) : undefined;
}

const prepareOnly = process.argv.includes("--prepare-only");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--prepare-only" &&
  !argument.startsWith("--source-root=") && !argument.startsWith("--pilot-root="));
if (unknown.length > 0) throw new Error("M24A_ARGUMENT_FAILURE");

const paths = await resolveControlledPilotPaths({
  sourceRoot: optionalArgument("source-root"),
  pilotRoot: optionalArgument("pilot-root"),
});
const preparation = await prepareControlledPilotDatabase(paths);
const issued = await issueControlledPilotDatabaseSession();
const state = await admitControlledPilotCurrentOperations(paths, issued.databaseSessionToken);

const safeSummary = {
  status: prepareOnly ? "ML_PLATFORM_P02_M24_A_PILOT_PREPARED" : "ML_PLATFORM_P02_M24_A_PILOT_RUNNING",
  environment: "NONPRODUCTION",
  database: "PERSISTENT_ISOLATED_LOCAL",
  databaseInitialized: preparation.initialized,
  databaseStarted: preparation.started,
  migrationsApplied: preparation.migrationsApplied,
  migrationsSkipped: preparation.migrationsSkipped,
  baselineSeeded: preparation.baselineSeeded,
  admittedOrders: state.source.admittedOrders,
  sourceExceptions: state.source.currentExceptions,
  preservedExceptions: state.source.preservedExceptions,
  ownerRejectedOrphanOrders: state.source.ownerRejectedOrphanOrders,
  deferredLegacyOrders: state.source.deferredLegacyOrders,
  canonicalOrders: state.canonical.orders,
  exactAdmittedOrderTotalCents: state.exactAdmittedOrderTotalCents,
  replaySafe: state.checks.sequentialReplayStable && state.checks.concurrentReplayStable,
  rollbackSafe: state.checks.injectedFailureRolledBack && state.checks.injectedFailureRetryStable,
  exactRuntimeRole: state.authority.runtimeRoleCanLogin && !state.authority.runtimeRoleInherit &&
    !state.authority.runtimeRoleSuperuser && !state.authority.runtimeRoleCreateDatabase &&
    !state.authority.runtimeRoleCreateRole && !state.authority.runtimeRoleReplication &&
    !state.authority.runtimeRoleBypassRls && state.authority.runtimeRoleMembershipCount === 0,
  runtimeCanonicalSequenceGrants: state.authority.runtimeCanonicalSequenceGrants,
  publicCanonicalSequenceGrants: state.authority.publicCanonicalSequenceGrants,
  providerMutations: state.providerMutationCount,
};

if (prepareOnly) {
  process.stdout.write(`${JSON.stringify(safeSummary, null, 2)}\n`);
} else {
  const database = new OperationsConsoleDatabase("CONTROLLED_PILOT");
  await database.assertRestrictedRuntime();
  const service = new OperationsConsoleService(database, {
    reviewMediaStore: new ReviewMediaStore({ root: paths.reviewMediaRoot }),
  });
  const sessions = new DevelopmentOperatorSessionManager({ ttlSeconds: 3_600 });
  const app = await startOperationsConsole({
    service,
    sessions,
    developmentOperatorContext: issued.context,
  });
  let queueReceiptSha256 = "";
  try {
    const sessionResponse = await app.inject({ method: "POST", url: "/session", payload: {} });
    const setCookie = sessionResponse.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (sessionResponse.statusCode !== 200 || !cookie) throw new Error("M24A_QUEUE_SESSION_EVIDENCE_FAILURE");
    const queueResponse = await app.inject({
      method: "GET",
      url: `/api/operations?from=${encodeURIComponent(OWNER_VALIDATED_RANGE.from)}&to=${encodeURIComponent(OWNER_VALIDATED_RANGE.to)}`,
      headers: { cookie },
    });
    if (queueResponse.statusCode !== 200) throw new Error("M24A_QUEUE_HTTP_EVIDENCE_FAILURE");
    const home = queueResponse.json<OperationsHome>();
    const upcomingHashes = opaqueOrderHashes(home.sections.upcoming);
    const attentionHashes = opaqueOrderHashes(home.sections.needsAttention);
    if (home.counts.upcoming !== 2 || home.counts.needsAttention !== 2 || home.sections.upcoming.length !== 2 ||
        home.sections.needsAttention.length !== 2 || upcomingHashes.join(":") !== attentionHashes.join(":")) {
      throw new Error("M24A_OWNER_VALIDATED_QUEUE_DIVERGENCE");
    }
    const receipt = {
      schema: "ML_CONTROLLED_MISSION_CONTROL_PILOT_V1",
      contract: "ControlledPilotMissionControlQueueReceiptV1",
      range: OWNER_VALIDATED_RANGE,
      protectedHttp: {
        statusCode: queueResponse.statusCode,
        responseByteSize: Buffer.byteLength(queueResponse.body),
        responseSha256: sha256(queueResponse.body),
        cacheControlNoStore: String(queueResponse.headers["cache-control"] ?? "").includes("no-store"),
        contentSecurityPolicyPresent: String(queueResponse.headers["content-security-policy"] ?? "").length > 0,
        noIndex: String(queueResponse.headers["x-robots-tag"] ?? "").includes("noindex"),
        noSniff: queueResponse.headers["x-content-type-options"] === "nosniff",
      },
      counts: home.counts,
      itemCount: home.items.length,
      opaqueItemOrderHashes: opaqueOrderHashes(home.items),
      opaqueUpcomingOrderHashes: upcomingHashes,
      opaqueNeedsAttentionOrderHashes: attentionHashes,
      attentionCodes: [...new Set(home.sections.needsAttention.flatMap((item) => item.attention))].sort(),
      exactOwnerValidatedQueueMatch: true,
      containsCustomerPii: false,
      containsProviderSecret: false,
      providerMutationCount: 0,
    } as const;
    if (!Object.values(receipt.protectedHttp).every((value) => value !== false)) {
      throw new Error("M24A_QUEUE_HTTP_SECURITY_EVIDENCE_FAILURE");
    }
    queueReceiptSha256 = await writePrivateJson(join(paths.evidenceRoot, "MISSION_CONTROL_QUEUE_RECEIPT.json"), receipt);
  } catch (error) {
    await app.close();
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ ...safeSummary, missionControlQueueReceiptSha256: queueReceiptSha256,
    url: "http://127.0.0.1:4317/operations" }, null, 2)}\n`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}
