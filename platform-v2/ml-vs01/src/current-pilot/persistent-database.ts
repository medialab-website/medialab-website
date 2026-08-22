import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { runMigrations, type MigrationResult } from "../../db/migrate.js";
import {
  PUBLICATION_DELIVERY_PERMISSION_FIXTURES,
  PUBLICATION_DELIVERY_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../../db/fixtures/publication-delivery-entitlement-fixtures.js";
import {
  CLIENT_ACCOUNT_PERMISSION_FIXTURES,
  CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../../db/fixtures/client-account-contact-foundation-fixtures.js";
import { seedMinimumAcceptedEvidence } from "../../scripts/run-internal-operations-console-new-listing.js";
import {
  CONTROLLED_PILOT_DATABASE,
  OPERATIONS_CONSOLE_OPERATOR_IDENTITY_ID,
  OPERATIONS_CONSOLE_OPERATOR_MEMBERSHIP_ID,
  OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
  OPERATIONS_CONSOLE_ORGANIZATION_ID,
} from "../operations-console/database.js";
import type { ServerBoundDevelopmentOperatorContext } from "../operations-console/session.js";
import {
  CONTROLLED_PILOT_OWNER_ROLE,
  CONTROLLED_PILOT_RUNTIME_ROLE,
  ensureControlledPilotDirectories,
  type ControlledPilotPaths,
} from "./config.js";

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_ROOT = resolve(MODULE_ROOT, "db/migrations");
const POSTGRES_BIN = "/Applications/Postgres.app/Contents/Versions/latest/bin";
const INITDB = `${POSTGRES_BIN}/initdb`;
const PG_CTL = `${POSTGRES_BIN}/pg_ctl`;
const EXPECTED_MIGRATION_COUNT = 28;

function runExact(label: string, executable: string, argumentsList: string[]): void {
  const result = spawnSync(executable, argumentsList, { stdio: "pipe", encoding: "utf8", timeout: 120_000 });
  if (result.error || result.signal !== null || result.status !== 0) {
    throw new Error(`M24A_${label}_FAILURE`);
  }
}

function clusterStatus(dataRoot: string): "ABSENT" | "RUNNING" | "STOPPED" {
  if (!existsSync(dataRoot)) return "ABSENT";
  const result = spawnSync(PG_CTL, ["-D", dataRoot, "status"], { stdio: "ignore", timeout: 10_000 });
  if (result.error || result.signal !== null) throw new Error("M24A_DATABASE_STATUS_FAILURE");
  if (result.status === 0) return "RUNNING";
  if (result.status === 3) return "STOPPED";
  throw new Error("M24A_DATABASE_STATUS_FAILURE");
}

async function assertDataRoot(paths: ControlledPilotPaths): Promise<void> {
  const info = await lstat(paths.dataRoot);
  const currentUid = process.getuid?.();
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(paths.dataRoot) !== paths.dataRoot ||
      (info.mode & 0o777) !== 0o700 || (currentUid !== undefined && info.uid !== currentUid)) {
    throw new Error("M24A_DATABASE_BOUNDARY_FAILURE: data root ownership or mode diverged");
  }
  const version = await lstat(resolve(paths.dataRoot, "PG_VERSION"));
  if (!version.isFile() || version.isSymbolicLink()) {
    throw new Error("M24A_DATABASE_BOUNDARY_FAILURE: PG_VERSION is invalid");
  }
}

async function startCluster(paths: ControlledPilotPaths): Promise<{ initialized: boolean; started: boolean }> {
  await ensureControlledPilotDirectories(paths);
  let status = clusterStatus(paths.dataRoot);
  let initialized = false;
  if (status === "ABSENT") {
    runExact("DATABASE_INIT", INITDB, [
      "-D", paths.dataRoot,
      "-U", CONTROLLED_PILOT_OWNER_ROLE,
      "--auth-local=trust",
      "--auth-host=reject",
      "--encoding=UTF8",
      "--locale=C",
      "--no-instructions",
    ]);
    initialized = true;
    status = "STOPPED";
  }
  await assertDataRoot(paths);
  if (status === "STOPPED") {
    const serverOptions = [
      `-k ${paths.socketRoot}`,
      `-p ${CONTROLLED_PILOT_DATABASE.port}`,
      "-c listen_addresses=''",
      "-c unix_socket_permissions=0700",
      "-c max_connections=32",
    ].join(" ");
    runExact("DATABASE_START", PG_CTL, [
      "-D", paths.dataRoot,
      "-l", paths.postgresLogPath,
      "-o", serverOptions,
      "-w", "start",
    ]);
    return { initialized, started: true };
  }
  return { initialized, started: false };
}

function ownerClient(database = "postgres"): pg.Client {
  return new pg.Client({
    host: CONTROLLED_PILOT_DATABASE.host,
    port: CONTROLLED_PILOT_DATABASE.port,
    database,
    user: CONTROLLED_PILOT_OWNER_ROLE,
    application_name: "p02-m24-a-r05-proof-final-provisioner",
  });
}

async function ensureRolesAndDatabase(): Promise<{ roleCreated: boolean; databaseCreated: boolean }> {
  const client = ownerClient();
  await client.connect();
  try {
    const role = await client.query<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
      rolcanlogin: boolean; rolinherit: boolean; rolreplication: boolean; rolbypassrls: boolean }>(
      `SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin,rolinherit,rolreplication,rolbypassrls
       FROM pg_roles WHERE rolname=$1`, [CONTROLLED_PILOT_RUNTIME_ROLE],
    );
    let roleCreated = false;
    if (role.rowCount === 0) {
      await client.query(`CREATE ROLE ${CONTROLLED_PILOT_RUNTIME_ROLE}
        LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
      roleCreated = true;
    } else {
      const existing = role.rows[0]!;
      const memberships = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM pg_auth_members m
         JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid
         WHERE r.rolname=$1`, [CONTROLLED_PILOT_RUNTIME_ROLE],
      );
      if (existing.rolsuper || existing.rolcreatedb || existing.rolcreaterole || !existing.rolcanlogin ||
          existing.rolinherit || existing.rolreplication || existing.rolbypassrls || memberships.rows[0]!.count !== 0) {
        throw new Error("M24A_RUNTIME_ROLE_DIVERGENCE");
      }
    }
    const database = await client.query<{ owner_name: string }>(
      `SELECT r.rolname AS owner_name FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=$1`,
      [CONTROLLED_PILOT_DATABASE.database],
    );
    let databaseCreated = false;
    if (database.rowCount === 0) {
      await client.query(`CREATE DATABASE ${CONTROLLED_PILOT_DATABASE.database} OWNER ${CONTROLLED_PILOT_OWNER_ROLE}`);
      databaseCreated = true;
    } else if (database.rows[0]!.owner_name !== CONTROLLED_PILOT_OWNER_ROLE) {
      throw new Error("M24A_DATABASE_OWNER_DIVERGENCE");
    }
    return { roleCreated, databaseCreated };
  } finally {
    await client.end();
  }
}

async function migratePilotDatabase(): Promise<MigrationResult> {
  const client = ownerClient(CONTROLLED_PILOT_DATABASE.database);
  await client.connect();
  try {
    const result = await runMigrations({
      migrationsDir: MIGRATIONS_ROOT,
      client,
      database: CONTROLLED_PILOT_DATABASE.database,
      user: CONTROLLED_PILOT_OWNER_ROLE,
      runtimeUser: CONTROLLED_PILOT_RUNTIME_ROLE,
    });
    if (result.failed || result.applied.length + result.skipped.length !== EXPECTED_MIGRATION_COUNT) {
      throw new Error("M24A_MIGRATION_LEDGER_FAILURE");
    }
    const ledger = await client.query<{ filename: string }>(
      "SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename",
    );
    if (ledger.rowCount !== EXPECTED_MIGRATION_COUNT ||
        ledger.rows.some((row, index) => !row.filename.startsWith(`${String(index + 1).padStart(4, "0")}_`))) {
      throw new Error("M24A_MIGRATION_LEDGER_FAILURE");
    }
    return result;
  } finally {
    await client.end();
  }
}

async function seedAdmissionPermissions(client: pg.Client): Promise<number> {
  const permissions = [
    PUBLICATION_DELIVERY_PERMISSION_FIXTURES.find((entry) => entry.code === "delivery_financial_evidence.record"),
    CLIENT_ACCOUNT_PERMISSION_FIXTURES.find((entry) => entry.code === "client_account.manage"),
  ];
  if (permissions.some((entry) => !entry)) throw new Error("M24A_PERMISSION_FIXTURE_DIVERGENCE");
  let inserted = 0;
  for (const permission of permissions) {
    const binding = [
      ...PUBLICATION_DELIVERY_PERMISSION_SET_PERMISSION_FIXTURES,
      ...CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES,
    ].find((entry) => entry.permission_id === permission!.id);
    if (!binding) throw new Error("M24A_PERMISSION_BINDING_DIVERGENCE");
    await client.query(
      `INSERT INTO medialab_core.permissions(id,code,description,is_active,created_at) VALUES($1,$2,$3,$4,$5)`,
      [permission!.id, permission!.code, permission!.description, permission!.is_active, permission!.created_at],
    );
    await client.query(
      `INSERT INTO medialab_core.permission_set_permissions(permission_set_id,permission_id,created_at) VALUES($1,$2,$3)`,
      [binding.permission_set_id, binding.permission_id, binding.created_at],
    );
    inserted += 2;
  }
  return inserted;
}

async function seedBaseline(): Promise<{ seeded: boolean; insertedRows: number }> {
  const client = ownerClient(CONTROLLED_PILOT_DATABASE.database);
  await client.connect();
  try {
    const counts = await client.query<{ organizations: number; people: number; orders: number }>(
      `SELECT
        (SELECT count(*)::int FROM medialab_core.organizations) AS organizations,
        (SELECT count(*)::int FROM medialab_core.people) AS people,
        (SELECT count(*)::int FROM medialab_core.orders) AS orders`,
    );
    const current = counts.rows[0]!;
    if (current.organizations > 0) {
      const baseline = await client.query<{ valid: boolean }>(
        `SELECT EXISTS(
          SELECT 1 FROM medialab_core.organizations o
          JOIN medialab_core.people p ON p.id=$2::uuid
          JOIN medialab_core.identities i ON i.id=$3::uuid AND i.person_id=p.id
          JOIN medialab_core.memberships m ON m.id=$4::uuid AND m.person_id=p.id AND m.organization_id=o.id
          WHERE o.id=$1::uuid
        ) AS valid`,
        [OPERATIONS_CONSOLE_ORGANIZATION_ID, OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
          OPERATIONS_CONSOLE_OPERATOR_IDENTITY_ID, OPERATIONS_CONSOLE_OPERATOR_MEMBERSHIP_ID],
      );
      if (!baseline.rows[0]!.valid) throw new Error("M24A_BASELINE_DIVERGENCE");
      return { seeded: false, insertedRows: 0 };
    }
    if (current.people !== 0 || current.orders !== 0) throw new Error("M24A_PARTIAL_BASELINE_DIVERGENCE");
    await client.query("BEGIN");
    try {
      const insertedRows = await seedMinimumAcceptedEvidence(client) + await seedAdmissionPermissions(client);
      await client.query("COMMIT");
      return { seeded: true, insertedRows };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

export interface ControlledPilotDatabasePreparation {
  initialized: boolean;
  started: boolean;
  roleCreated: boolean;
  databaseCreated: boolean;
  migrationsApplied: number;
  migrationsSkipped: number;
  baselineSeeded: boolean;
  baselineRowsInserted: number;
}

export async function prepareControlledPilotDatabase(
  paths: ControlledPilotPaths,
): Promise<ControlledPilotDatabasePreparation> {
  const cluster = await startCluster(paths);
  const identity = await ensureRolesAndDatabase();
  const migration = await migratePilotDatabase();
  const baseline = await seedBaseline();
  return Object.freeze({
    ...cluster,
    ...identity,
    migrationsApplied: migration.applied.length,
    migrationsSkipped: migration.skipped.length,
    baselineSeeded: baseline.seeded,
    baselineRowsInserted: baseline.insertedRows,
  });
}

export async function issueControlledPilotDatabaseSession(): Promise<{
  context: ServerBoundDevelopmentOperatorContext;
  databaseSessionToken: string;
}> {
  const databaseSessionToken = randomBytes(32).toString("base64url");
  const tokenSha256 = createHash("sha256").update(databaseSessionToken, "utf8").digest("hex");
  const client = ownerClient(CONTROLLED_PILOT_DATABASE.database);
  await client.connect();
  try {
    await client.query(
      `INSERT INTO medialab_core.development_sessions(
        id,identity_id,token_sha256,issued_at,expires_at,revoked_at
      ) VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '24 hours',NULL)`,
      [randomUUID(), OPERATIONS_CONSOLE_OPERATOR_IDENTITY_ID, tokenSha256],
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
      membershipId: OPERATIONS_CONSOLE_OPERATOR_MEMBERSHIP_ID,
    }),
  };
}

export function controlledPilotOwnerConnection(): pg.Client {
  return ownerClient(CONTROLLED_PILOT_DATABASE.database);
}
