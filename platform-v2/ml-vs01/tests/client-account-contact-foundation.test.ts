import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLIENT_ACCOUNT_PERMISSION_FIXTURES,
  CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES,
} from "../db/fixtures/client-account-contact-foundation-fixtures.js";
import {
  issueOperationsConsoleDatabaseSession,
  resetAndSeedOperationsConsoleDatabase,
} from "../scripts/run-internal-operations-console-new-listing.js";
import {
  OPERATIONS_CONSOLE_DATABASE,
  OPERATIONS_CONSOLE_ORGANIZATION_ID,
} from "../src/operations-console/database.js";

const OWNER = "medialab_p02m17a_test_owner";
const RUNTIME = OPERATIONS_CONSOLE_DATABASE.user;

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seedClientManagePermission(): Promise<void> {
  const owner = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER });
  await owner.connect();
  try {
    const permission = CLIENT_ACCOUNT_PERMISSION_FIXTURES.find((candidate) => candidate.code === "client_account.manage");
    const binding = permission && CLIENT_ACCOUNT_PERMISSION_SET_PERMISSION_FIXTURES.find(
      (candidate) => candidate.permission_id === permission.id,
    );
    if (!permission || !binding) throw new Error("CLIENT_ACCOUNT_PERMISSION_FIXTURE_DIVERGENCE");
    await owner.query(
      `INSERT INTO medialab_core.permissions(id,code,description,is_active,created_at)
       VALUES($1,$2,$3,$4,$5)`,
      [permission.id, permission.code, permission.description, permission.is_active, permission.created_at],
    );
    await owner.query(
      `INSERT INTO medialab_core.permission_set_permissions(permission_set_id,permission_id,created_at)
       VALUES($1,$2,$3)`,
      [binding.permission_set_id, binding.permission_id, binding.created_at],
    );
  } finally {
    await owner.end();
  }
}

describe.sequential("P02-M23-A client-account and operator-contact foundation", () => {
  let owner: pg.Client;
  let runtime: pg.Client;
  let token: string;
  let customerPersonId: string;

  beforeAll(async () => {
    await resetAndSeedOperationsConsoleDatabase(1);
    await seedClientManagePermission();
    token = (await issueOperationsConsoleDatabaseSession()).databaseSessionToken;
    owner = new pg.Client({ ...OPERATIONS_CONSOLE_DATABASE, user: OWNER });
    runtime = new pg.Client(OPERATIONS_CONSOLE_DATABASE);
    await owner.connect();
    await runtime.connect();
    const person = await runtime.query<{ reconcile_customer_person_intake: { person_id: string } }>(
      `SELECT medialab_core.reconcile_customer_person_intake(
        $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10)`,
      [token, "m23a-client-foundation-person", OPERATIONS_CONSOLE_ORGANIZATION_ID,
        "ARYEO", "CUSTOMER_TEAM:synthetic-team", "ARYEO_CUSTOMER_USER", "synthetic-user",
        fingerprint("synthetic-person-v1"), "Synthetic Client", "client@example.invalid"],
    );
    customerPersonId = person.rows[0]!.reconcile_customer_person_intake.person_id;
  }, 120_000);

  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
  });

  it("grants only the exact restricted command surface and no table DML or PUBLIC execution", async () => {
    const ledger = await owner.query<{ filename: string }>(
      "SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename",
    );
    expect(ledger.rows).toHaveLength(28);
    expect(ledger.rows.at(-1)?.filename).toBe("0028_client_account_and_operator_contact_intake_foundation.sql");
    const functions = await owner.query<{ proname: string; runtime: boolean; public: boolean }>(
      `SELECT p.proname,has_function_privilege($1,p.oid,'EXECUTE') AS runtime,
              has_function_privilege('public',p.oid,'EXECUTE') AS public
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='medialab_core' AND p.proname IN (
          'reconcile_client_account_intake','reconcile_customer_contact_intake',
          'link_client_account_person','link_order_client_account',
          'get_client_account_record','list_client_accounts') ORDER BY p.proname`,
      [RUNTIME],
    );
    expect(functions.rows).toHaveLength(6);
    expect(functions.rows.every((row) => row.runtime && !row.public)).toBe(true);
    const dml = await owner.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.role_table_grants
        WHERE grantee=$1 AND table_schema='medialab_core'
          AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [RUNTIME],
    );
    expect(dml.rows[0]!.count).toBe(0);
    await expect(runtime.query(
      "INSERT INTO medialab_core.client_accounts(id,organization_id,account_type) VALUES($1,$2,'CUSTOMER_GROUP')",
      [randomUUID(), OPERATIONS_CONSOLE_ORGANIZATION_ID],
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("reconciles stable client identity with append-only revisions and exact replay", async () => {
    const firstFingerprint = fingerprint("synthetic-client-account-v1");
    const first = await runtime.query<{ reconcile_client_account_intake: Record<string, unknown> }>(
      `SELECT medialab_core.reconcile_client_account_intake(
        $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
      [token, "m23a-client-group-v1", OPERATIONS_CONSOLE_ORGANIZATION_ID, "ARYEO", "CUSTOMER_GROUP",
        "synthetic-group", firstFingerprint, "CUSTOMER_GROUP", "Synthetic Agency", null, null],
    );
    const accountId = String(first.rows[0]!.reconcile_client_account_intake.clientAccountId);
    const replay = await runtime.query<{ reconcile_client_account_intake: Record<string, unknown> }>(
      `SELECT medialab_core.reconcile_client_account_intake(
        $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
      [token, "m23a-client-group-v1", OPERATIONS_CONSOLE_ORGANIZATION_ID, "ARYEO", "CUSTOMER_GROUP",
        "synthetic-group", firstFingerprint, "CUSTOMER_GROUP", "Synthetic Agency", null, null],
    );
    expect(replay.rows[0]!.reconcile_client_account_intake).toMatchObject({ clientAccountId: accountId, replayed: true });

    const secondFingerprint = fingerprint("synthetic-client-account-v2");
    const revised = await runtime.query<{ reconcile_client_account_intake: Record<string, unknown> }>(
      `SELECT medialab_core.reconcile_client_account_intake(
        $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
      [token, "m23a-client-group-v2", OPERATIONS_CONSOLE_ORGANIZATION_ID, "ARYEO", "CUSTOMER_GROUP",
        "synthetic-group", secondFingerprint, "CUSTOMER_GROUP", "Synthetic Agency Updated", null, null],
    );
    expect(revised.rows[0]!.reconcile_client_account_intake).toMatchObject({ clientAccountId: accountId,
      accountOutcome: "REUSED", revisionOutcome: "CREATED", replayed: false });
    const record = await runtime.query<{ get_client_account_record: { revisions: unknown[] } }>(
      "SELECT medialab_core.get_client_account_record($1,$2::uuid)", [token, accountId],
    );
    expect(record.rows[0]!.get_client_account_record.revisions).toHaveLength(2);
    await expect(runtime.query(
      `SELECT medialab_core.reconcile_client_account_intake(
        $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
      [token, "m23a-client-group-v2", OPERATIONS_CONSOLE_ORGANIZATION_ID, "ARYEO", "CUSTOMER_GROUP",
        "synthetic-group", fingerprint("drift"), "CUSTOMER_GROUP", "Drift", null, null],
    )).rejects.toMatchObject({ code: "23505" });
  });

  it("records unverified source-backed phones, supersedes changed evidence, and fails closed cross-organization", async () => {
    const first = await runtime.query<{ reconcile_customer_contact_intake: Record<string, unknown> }>(
      `SELECT medialab_core.reconcile_customer_contact_intake(
        $1,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)`,
      [token, "m23a-phone-v1", OPERATIONS_CONSOLE_ORGANIZATION_ID, customerPersonId, "ARYEO",
        "CUSTOMER_USER", "synthetic-user", fingerprint("phone-v1"), "PHONE", "+14235550100"],
    );
    const firstContactId = String(first.rows[0]!.reconcile_customer_contact_intake.contactMethodId);
    const second = await runtime.query<{ reconcile_customer_contact_intake: Record<string, unknown> }>(
      `SELECT medialab_core.reconcile_customer_contact_intake(
        $1,$2,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)`,
      [token, "m23a-phone-v2", OPERATIONS_CONSOLE_ORGANIZATION_ID, customerPersonId, "ARYEO",
        "CUSTOMER_USER", "synthetic-user", fingerprint("phone-v2"), "PHONE", "+14235550101"],
    );
    const secondContactId = String(second.rows[0]!.reconcile_customer_contact_intake.contactMethodId);
    expect(secondContactId).not.toBe(firstContactId);
    const contacts = await owner.query<{ id: string; lifecycle_state: string; creation_authority: string }>(
      `SELECT id,lifecycle_state,creation_authority FROM medialab_core.contact_methods
        WHERE id=ANY($1::uuid[]) ORDER BY id`, [[firstContactId, secondContactId]],
    );
    expect(contacts.rows.find((row) => row.id === firstContactId)).toMatchObject({ lifecycle_state: "SUPERSEDED",
      creation_authority: "ORGANIZATION_OPERATOR" });
    expect(contacts.rows.find((row) => row.id === secondContactId)).toMatchObject({ lifecycle_state: "ACTIVE",
      creation_authority: "ORGANIZATION_OPERATOR" });
    const verification = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM medialab_core.contact_verification_evidence WHERE contact_method_id=ANY($1::uuid[])",
      [[firstContactId, secondContactId]],
    );
    expect(verification.rows[0]!.count).toBe(0);
    await expect(runtime.query(
      `SELECT medialab_core.reconcile_client_account_intake(
        $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11::uuid)`,
      [token, "m23a-cross-org", "00000000-0000-4000-8000-000000000001", "ARYEO", "CUSTOMER_GROUP",
        "cross-org", fingerprint("cross-org"), "CUSTOMER_GROUP", "Unavailable", null, null],
    )).rejects.toMatchObject({ code: "42501" });
  });
});
