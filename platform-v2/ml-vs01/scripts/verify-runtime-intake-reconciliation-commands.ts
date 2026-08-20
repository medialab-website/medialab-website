import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationName = "0023_runtime_intake_reconciliation_commands.sql";
const migrationBytes = readFileSync(join(base, "db/migrations", migrationName));
const migrationSha256 = createHash("sha256").update(migrationBytes).digest("hex");
const host = process.env.PGHOST ?? "/tmp/mlvs01-p02m16a-pg";
const port = Number(process.env.PGPORT ?? "55447");
const database = process.env.PGDATABASE ?? "medialab_p02m16a_test";
const owner = process.env.PGUSER ?? "medialab_p02m16a_test_owner";
const runtime = process.env.PGRUNTIMEUSER ?? "medialab_p02m16a_test_app";
const fail = (message: string): never => { throw new Error("M16E_RUNTIME_COMMAND_VERIFICATION_FAILURE: " + message); };

if (host !== "/tmp/mlvs01-p02m16a-pg" || port !== 55447 || database !== "medialab_p02m16a_test" ||
    owner !== "medialab_p02m16a_test_owner" || runtime !== "medialab_p02m16a_test_app") {
  fail("unsafe disposable runtime boundary");
}

const client = new pg.Client({ host, port, database, user: owner });
await client.connect();
try {
  const ledger = await client.query<{ filename: string; sha256: string }>(
    "SELECT filename,sha256 FROM medialab_meta.schema_migrations ORDER BY filename",
  );
  if (ledger.rows.length !== 24 || ledger.rows[22]?.filename !== migrationName ||
      ledger.rows[22]?.sha256 !== migrationSha256) fail("migration 0023 ledger identity mismatch");

  const email = await client.query<{ is_nullable: string }>(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema='medialab_core' AND table_name='people' AND column_name='email'",
  );
  if (email.rows[0]?.is_nullable !== "YES") fail("people.email is not nullable");

  const columns = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
    "SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='medialab_core' AND table_name='person_external_references' ORDER BY ordinal_position",
  );
  const expectedColumns = [
    ["id", "uuid", "NO"], ["person_id", "uuid", "NO"], ["source_system", "text", "NO"],
    ["source_scope", "text", "NO"], ["external_record_type", "text", "NO"],
    ["external_identifier", "text", "NO"], ["provenance", "text", "NO"],
    ["recorded_by_identity_id", "uuid", "NO"], ["recorded_at", "timestamp with time zone", "NO"],
  ].map(([column_name, data_type, is_nullable]) => ({ column_name, data_type, is_nullable }));
  if (JSON.stringify(columns.rows) !== JSON.stringify(expectedColumns)) fail("person_external_references column inventory mismatch");

  const constraints = await client.query<{ conname: string }>(
    "SELECT conname FROM pg_constraint WHERE conrelid='medialab_core.person_external_references'::regclass ORDER BY conname",
  );
  const constraintNames = constraints.rows.map((row) => row.conname);
  for (const name of [
    "person_external_references_pkey", "person_external_references_person_id_fkey",
    "person_external_references_recorded_by_identity_id_fkey", "person_external_references_exact_source_key",
  ]) if (!constraintNames.includes(name)) fail("missing external-reference constraint: " + name);

  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname='medialab_core' AND tablename='person_external_references' ORDER BY indexname",
  );
  if (!indexes.rows.some((row) => row.indexname === "person_external_references_person_idx")) fail("person lookup index missing");
  const trigger = await client.query<{ trigger_name: string; function_name: string }>(
    `SELECT t.tgname AS trigger_name,p.proname AS function_name
       FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid='medialab_core.person_external_references'::regclass AND NOT t.tgisinternal`,
  );
  if (JSON.stringify(trigger.rows) !== JSON.stringify([{
    trigger_name: "person_external_references_immutability_guard",
    function_name: "reject_person_external_reference_mutation",
  }])) fail("external-reference immutability trigger mismatch");

  const commands = await client.query<{
    signature: string; prosecdef: boolean; proconfig: string[]; runtime_execute: boolean; public_execute: boolean;
  }>(
    `SELECT p.oid::regprocedure::text AS signature,p.prosecdef,p.proconfig,
            has_function_privilege($1,p.oid,'EXECUTE') AS runtime_execute,
            has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname IN
        ('reconcile_customer_person_intake','reconcile_property_snapshot_intake')
      ORDER BY p.proname`,
    [runtime],
  );
  const signatures = commands.rows.map((row) => row.signature);
  if (JSON.stringify(signatures) !== JSON.stringify([
    "medialab_core.reconcile_customer_person_intake(text,text,uuid,text,text,text,text,text,text,text)",
    "medialab_core.reconcile_property_snapshot_intake(text,text,uuid,text,text,text,text,text,text,text,text,integer)",
  ])) fail("runtime command signatures mismatch");
  if (commands.rows.some((row) => !row.prosecdef || !row.runtime_execute || row.public_execute ||
      JSON.stringify(row.proconfig) !== JSON.stringify(["search_path=pg_catalog, medialab_core, pg_temp"]))) {
    fail("runtime command security or EXECUTE surface mismatch");
  }

  const directDml = await client.query<{ count: string }>(
    `SELECT count(*)::text FROM information_schema.role_table_grants
      WHERE grantee=$1 AND table_schema='medialab_core'
        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`, [runtime],
  );
  const publicTables = await client.query<{ count: string }>(
    `SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
      WHERE n.nspname='medialab_core' AND c.relkind IN ('r','p') AND a.grantee=0
        AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
  );
  const publicFunctions = await client.query<{ count: string }>(
    `SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE n.nspname='medialab_core' AND a.grantee=0 AND a.privilege_type='EXECUTE'`,
  );
  if (Number(directDml.rows[0]?.count) || Number(publicTables.rows[0]?.count) ||
      Number(publicFunctions.rows[0]?.count)) fail("runtime or PUBLIC authority widened");

  const identities = await client.query<{ count: string }>(
    "SELECT count(*)::text FROM medialab_core.identities i JOIN medialab_core.people p ON p.id=i.person_id WHERE p.email IS NULL",
  );
  if (Number(identities.rows[0]?.count) !== 0) fail("null-email customer Person was given authentication identity");
} finally {
  await client.end();
}

process.stdout.write("M16-E runtime intake reconciliation command verification PASSED. migrationSha256=" + migrationSha256 + "\n");
