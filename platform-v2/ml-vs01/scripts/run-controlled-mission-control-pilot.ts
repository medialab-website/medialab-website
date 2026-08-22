import { resolve } from "node:path";
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
  rollbackSafe: state.checks.injectedFailureRolledBack,
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
  process.stdout.write(`${JSON.stringify({ ...safeSummary, url: "http://127.0.0.1:4317/operations" }, null, 2)}\n`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await app.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}
