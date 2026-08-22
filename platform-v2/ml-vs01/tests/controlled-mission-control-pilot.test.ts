import { mkdtemp, mkdir, realpath, readFile, symlink } from "node:fs/promises";
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
      socketRoot: "/tmp/mlvs01-p02m24a-pg",
      statePath: join(roots.pilotRoot, "PILOT_STATE.json"),
      privateExceptionPath: join(roots.pilotRoot, "PRIVATE_EXCEPTION_REGISTER.json"),
    });
    expect(operationsConsoleDatabaseBoundary("ACCEPTED_TEST")).toBe(OPERATIONS_CONSOLE_DATABASE);
    expect(operationsConsoleDatabaseBoundary("CONTROLLED_PILOT")).toBe(CONTROLLED_PILOT_DATABASE);
    expect(CONTROLLED_PILOT_DATABASE).toEqual({
      host: "/tmp/mlvs01-p02m24a-pg",
      port: 55450,
      database: "medialab_p02m24a_pilot",
      user: "medialab_p02m24a_pilot_app",
      applicationName: "p02-m24-a-controlled-mission-control-pilot",
    });
  });

  it("rejects wrong basenames, symlinks, and source/pilot overlap", async () => {
    const roots = await isolatedRoots();
    await expect(resolveControlledPilotPaths({
      sourceRoot: roots.sourceRoot,
      pilotRoot: join(dirname(roots.pilotRoot), "wrong-pilot-name"),
    })).rejects.toThrow(/pilot root must end in PILOT_R01/);

    const aliasParent = await realpath(await mkdtemp(join(tmpdir(), "m24a-source-alias-")));
    const alias = join(aliasParent, CONTROLLED_PILOT_SOURCE_BASENAME);
    await symlink(roots.sourceRoot, alias);
    await expect(resolveControlledPilotPaths({ sourceRoot: alias, pilotRoot: roots.pilotRoot }))
      .rejects.toThrow(/canonical non-symlink directory/);

    const overlappingPilot = join(roots.sourceRoot, CONTROLLED_PILOT_ROOT_BASENAME);
    await expect(resolveControlledPilotPaths({ sourceRoot: roots.sourceRoot, pilotRoot: overlappingPilot }))
      .rejects.toThrow(/source and pilot roots must be isolated/);
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
    expect(admission).toContain("providerMutationCount: 0");
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
  });
});
