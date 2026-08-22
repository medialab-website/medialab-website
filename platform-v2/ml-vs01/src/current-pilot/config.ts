import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveLocalSourcePath } from "../local-source-config.js";
import { CONTROLLED_PILOT_DATABASE } from "../operations-console/database.js";

export const CONTROLLED_PILOT_OWNER_ROLE = "medialab_p02m24a_pilot_owner" as const;
export const CONTROLLED_PILOT_RUNTIME_ROLE = CONTROLLED_PILOT_DATABASE.user;
export const CONTROLLED_PILOT_ROOT_BASENAME = "PILOT_R01" as const;
export const CONTROLLED_PILOT_SOURCE_BASENAME = "ARYEO_API_SNAPSHOT_R01" as const;

export interface ControlledPilotPaths {
  readonly sourceRoot: string;
  readonly pilotRoot: string;
  readonly dataRoot: string;
  readonly socketRoot: string;
  readonly reviewMediaRoot: string;
  readonly evidenceRoot: string;
  readonly statePath: string;
  readonly privateExceptionPath: string;
  readonly postgresLogPath: string;
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function canonicalExistingDirectory(path: string, label: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(`M24A_${label}_BOUNDARY_FAILURE: path must be absolute`);
  const resolved = resolve(path);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(resolved) !== resolved) {
    throw new Error(`M24A_${label}_BOUNDARY_FAILURE: path must be a canonical non-symlink directory`);
  }
  return resolved;
}

async function narrowPilotRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("M24A_PILOT_BOUNDARY_FAILURE: pilot root must be absolute");
  const resolved = resolve(path);
  if (basename(resolved) !== CONTROLLED_PILOT_ROOT_BASENAME) {
    throw new Error(`M24A_PILOT_BOUNDARY_FAILURE: pilot root must end in ${CONTROLLED_PILOT_ROOT_BASENAME}`);
  }
  await canonicalExistingDirectory(dirname(resolved), "PILOT_PARENT");
  try {
    const info = await lstat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(resolved) !== resolved) {
      throw new Error("M24A_PILOT_BOUNDARY_FAILURE: existing pilot root is not canonical");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolved;
}

export async function resolveControlledPilotPaths(
  overrides: { sourceRoot?: string; pilotRoot?: string } = {},
): Promise<ControlledPilotPaths> {
  const sourceRoot = await canonicalExistingDirectory(
    resolveLocalSourcePath("P02_M24_A_SOURCE_ROOT", overrides.sourceRoot), "SOURCE",
  );
  if (basename(sourceRoot) !== CONTROLLED_PILOT_SOURCE_BASENAME) {
    throw new Error(`M24A_SOURCE_BOUNDARY_FAILURE: source root must end in ${CONTROLLED_PILOT_SOURCE_BASENAME}`);
  }
  const pilotRoot = await narrowPilotRoot(resolveLocalSourcePath("P02_M24_A_PILOT_ROOT", overrides.pilotRoot));
  if (inside(sourceRoot, pilotRoot) || inside(pilotRoot, sourceRoot)) {
    throw new Error("M24A_PILOT_BOUNDARY_FAILURE: source and pilot roots must be isolated");
  }
  return Object.freeze({
    sourceRoot,
    pilotRoot,
    dataRoot: join(pilotRoot, "postgres-data"),
    socketRoot: CONTROLLED_PILOT_DATABASE.host,
    reviewMediaRoot: join(pilotRoot, "review-media-store"),
    evidenceRoot: join(pilotRoot, "evidence"),
    statePath: join(pilotRoot, "PILOT_STATE.json"),
    privateExceptionPath: join(pilotRoot, "PRIVATE_EXCEPTION_REGISTER.json"),
    postgresLogPath: join(pilotRoot, "postgres.log"),
  });
}

export async function ensureControlledPilotDirectories(paths: ControlledPilotPaths): Promise<void> {
  await mkdir(paths.pilotRoot, { mode: 0o700, recursive: true });
  await mkdir(paths.socketRoot, { mode: 0o700, recursive: true });
  await Promise.all([
    mkdir(paths.reviewMediaRoot, { mode: 0o700, recursive: true }),
    mkdir(paths.evidenceRoot, { mode: 0o700, recursive: true }),
  ]);
  for (const [label, path] of [
    ["PILOT", paths.pilotRoot],
    ["REVIEW_MEDIA", paths.reviewMediaRoot],
    ["EVIDENCE", paths.evidenceRoot],
  ] as const) {
    await canonicalExistingDirectory(path, label);
  }
  const socketInfo = await lstat(paths.socketRoot);
  if (!socketInfo.isDirectory() || socketInfo.isSymbolicLink()) {
    throw new Error("M24A_SOCKET_BOUNDARY_FAILURE: socket root must be a non-symlink directory");
  }
}
