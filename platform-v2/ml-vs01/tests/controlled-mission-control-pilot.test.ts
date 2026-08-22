import { chmod, mkdtemp, mkdir, realpath, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTROLLED_PILOT_ROOT_BASENAME,
  CONTROLLED_PILOT_SOURCE_BASENAME,
  ensureControlledPilotDirectories,
  resolveControlledPilotPaths,
} from "../src/current-pilot/config.js";
import {
  CONTROLLED_PILOT_DATABASE,
  OPERATIONS_CONSOLE_DATABASE,
  operationsConsoleDatabaseBoundary,
} from "../src/operations-console/database.js";

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function isolatedRoots(): Promise<{ parent: string; sourceRoot: string; pilotRoot: string }> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "m24a-controlled-pilot-")));
  const sourceRoot = join(parent, CONTROLLED_PILOT_SOURCE_BASENAME);
  const pilotParent = join(parent, "private-pilot-state");
  const pilotRoot = join(pilotParent, CONTROLLED_PILOT_ROOT_BASENAME);
  await mkdir(sourceRoot, { mode: 0o700 });
  await mkdir(pilotParent, { mode: 0o700 });
  return { parent, sourceRoot, pilotRoot };
}

describe("P02-M24-A controlled Mission Control pilot boundaries", () => {
  it("admits only the exact isolated source, pilot, socket, and database identities", async () => {
    const roots = await isolatedRoots();
    const paths = await resolveControlledPilotPaths(roots);
    await ensureControlledPilotDirectories(paths);

    expect(paths).toMatchObject({
      sourceRoot: roots.sourceRoot,
      pilotRoot: roots.pilotRoot,
      socketRoot: "/tmp/mlvs01-p02m24a-r05-proof-final-pg",
      statePath: join(roots.pilotRoot, "PILOT_STATE.json"),
      freshAdmissionProofPath: join(roots.pilotRoot, "evidence", "FRESH_ACCEPTED_COHORT_FAILURE_RETRY_RECEIPT.json"),
      privateExceptionPath: join(roots.pilotRoot, "PRIVATE_EXCEPTION_REGISTER.json"),
    });
    expect(operationsConsoleDatabaseBoundary("ACCEPTED_TEST")).toBe(OPERATIONS_CONSOLE_DATABASE);
    expect(operationsConsoleDatabaseBoundary("CONTROLLED_PILOT")).toBe(CONTROLLED_PILOT_DATABASE);
    expect(CONTROLLED_PILOT_DATABASE).toEqual({
      host: "/tmp/mlvs01-p02m24a-r05-proof-final-pg",
      port: 55453,
      database: "medialab_p02m24a_r05_proof_final",
      user: "medialab_p02m24a_r05_proof_final_app",
      applicationName: "p02-m24-a-r05-proof-final-controlled-mission-control-pilot",
    });
  });

  it("rejects wrong basenames, symlinks, and source/pilot overlap", async () => {
    const roots = await isolatedRoots();
    await expect(resolveControlledPilotPaths({
      sourceRoot: roots.sourceRoot,
      pilotRoot: join(dirname(roots.pilotRoot), "wrong-pilot-name"),
    })).rejects.toThrow(/pilot root must end in PILOT_R04/);

    const aliasParent = await realpath(await mkdtemp(join(tmpdir(), "m24a-source-alias-")));
    const alias = join(aliasParent, CONTROLLED_PILOT_SOURCE_BASENAME);
    await symlink(roots.sourceRoot, alias);
    await expect(resolveControlledPilotPaths({ sourceRoot: alias, pilotRoot: roots.pilotRoot }))
      .rejects.toThrow(/canonical non-symlink directory/);

    const overlappingPilot = join(roots.sourceRoot, CONTROLLED_PILOT_ROOT_BASENAME);
    await expect(resolveControlledPilotPaths({ sourceRoot: roots.sourceRoot, pilotRoot: overlappingPilot }))
      .rejects.toThrow(/source and pilot roots must be isolated/);
  });

  it("rejects private pilot directory mode drift", async () => {
    const roots = await isolatedRoots();
    const paths = await resolveControlledPilotPaths(roots);
    await ensureControlledPilotDirectories(paths);
    await chmod(paths.evidenceRoot, 0o755);
    await expect(ensureControlledPilotDirectories(paths)).rejects.toThrow(/ownership or mode diverged/);
  });

  it("keeps the pilot persistent, loopback-only, secretless, and provider-nonmutating", async () => {
    const [launcher, persistence, admission, localConfig] = await Promise.all([
      readFile(join(MODULE_ROOT, "scripts/run-controlled-mission-control-pilot.ts"), "utf8"),
      readFile(join(MODULE_ROOT, "src/current-pilot/persistent-database.ts"), "utf8"),
      readFile(join(MODULE_ROOT, "src/current-pilot/admission.ts"), "utf8"),
      readFile(join(MODULE_ROOT, "src/local-source-config.ts"), "utf8"),
    ]);

    expect(launcher).toContain('url: "http://127.0.0.1:4317/operations"');
    expect(launcher).toContain('new OperationsConsoleDatabase("CONTROLLED_PILOT")');
    expect(launcher).not.toMatch(/ARYEO_API_KEY|acquireAryeo|fetch\s*\(/u);
    expect(persistence).not.toMatch(/resetTestDatabase|DROP\s+(?:DATABASE|SCHEMA)/u);
    expect(persistence).toContain("migrationsSkipped");
    expect(persistence).toContain("rolcanlogin,rolinherit,rolreplication,rolbypassrls");
    expect(persistence).toContain("pg_auth_members");
    expect(admission).toContain("providerMutationCount: 0");
    expect(admission).toContain('contract: "FreshAcceptedCohortFailureRetryReceiptV1"');
    expect(admission).toContain("completeCanonicalStateVector");
    expect(admission).toContain("contentSha256");
    expect(admission).toContain("targetAbsentBeforeAttempt: true");
    expect(admission).toContain("targetAbsentAfterFailure: true");
    expect(admission).toContain("rollbackExactAcrossEveryCanonicalTable: true");
    expect(admission).toContain('stage === "after_first_appointment"');
    expect(admission).toContain("cohort.slice(1)");
    expect(admission.indexOf('stage === "after_first_appointment"'))
      .toBeLessThan(admission.indexOf("cohort.slice(1)"));
    expect(admission).not.toContain('stage === "after_property"');
    expect(admission).toContain("runtimeCanonicalSequenceGrants === 0");
    expect(admission).toContain("runtimeRoleMembershipCount === 0");
    expect(admission).toContain("containsCustomerPii: false");
    expect(admission).toContain('contract: "ControlledPilotPrivateExceptionRegisterV1"');
    expect(admission).toContain('contract: "ControlledPilotOwnerExclusionReceiptV1"');
    expect(admission).toContain('disposition: "OWNER_REJECTED_ACCIDENTAL_ORPHAN_CREATION"');
    expect(admission).toContain("eligibleForFutureConsolidation: false");
    expect(admission).toContain("reviewEvidenceEligible: false");
    expect(admission).toContain("localOwnerOnly: true");
    const ownerDisposition = admission.match(/const OWNER_REJECTED_ORPHAN_ORDER_HASHES = new Set\(\[([\s\S]*?)\]\);/u);
    expect(ownerDisposition?.[1]?.match(/[0-9a-f]{64}/gu)).toHaveLength(3);
    expect(admission).not.toContain("Order #");
    expect(admission).not.toMatch(/ARYEO_API_KEY|Bearer\s+/u);
    expect(localConfig).toContain("P02_M24_A_SOURCE_ROOT");
    expect(localConfig).toContain("P02_M24_A_PILOT_ROOT");
    expect(launcher).toContain('contract: "ControlledPilotMissionControlQueueReceiptV1"');
    expect(launcher).toContain("opaqueUpcomingOrderHashes");
    expect(launcher).toContain("missionControlQueueReceiptSha256");
    expect(persistence).not.toContain("medialab_p02m24a_pilot_owner");
    expect(launcher).not.toContain("PILOT_R01");
  });
});
