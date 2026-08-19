import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE } from "../db/fixtures/identity-tenancy-fixtures.js";
import { resetCurrentShadowDatabase } from "../src/current-shadow/database.js";
import { reconcileCustomerPersonIntake, reconcilePropertySnapshotIntake } from "../src/runtime-intake/index.js";

const connection = { host: "/tmp/mlvs01-p02m16a-pg", port: 55447, database: "medialab_p02m16a_test" };
const owner = new pg.Client({ ...connection, user: "medialab_p02m16a_test_owner" });
const runtime = new pg.Pool({ ...connection, user: "medialab_p02m16a_test_app", max: 8 });

async function session(identityId = IDENTITY_FIXTURES[1].id): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await owner.query(
    `INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at)
     VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
    [randomUUID(), identityId, createHash("sha256").update(token).digest("hex")],
  );
  return token;
}

const customerInput = (suffix: string, overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "customer-" + suffix, organizationId: ORGANIZATION_FIXTURE.id,
  sourceSystem: "SYNTHETIC_SOURCE", sourceScope: "SYNTHETIC_ACCOUNT",
  externalRecordType: "CUSTOMER", externalIdentifier: "synthetic-customer-" + suffix,
  sourceEvidenceFingerprint: createHash("sha256").update("customer:" + suffix).digest("hex"),
  displayName: "Synthetic Customer " + suffix, email: null, ...overrides,
});
const propertyInput = (suffix: string, overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "property-" + suffix, organizationId: ORGANIZATION_FIXTURE.id,
  sourceSystem: "SYNTHETIC_SOURCE",
  sourceEvidenceFingerprint: createHash("sha256").update("property:" + suffix).digest("hex"),
  addressLine1: "100 " + suffix + " Test Lane", addressLine2: null, locality: "Synthetic City",
  administrativeArea: "NC", postalCode: "28000", countryCode: "US",
  reportedSquareFeet: null, ...overrides,
});

describe("P02-M16-E runtime intake reconciliation", () => {
  beforeAll(async () => { await resetCurrentShadowDatabase(); await owner.connect(); });
  afterAll(async () => { await runtime.end(); await owner.end(); });

  it("accepts multiple NULL-email Persons without contact, Identity, or account creation", async () => {
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      await owner.query("INSERT INTO medialab_core.people(id,display_name,email) VALUES($1,$2,NULL)",
        [id, "Synthetic Null Email " + index]);
    }
    const proof = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM medialab_core.people WHERE id=ANY($1::uuid[])) people,
         (SELECT count(*)::int FROM medialab_core.contact_methods WHERE person_id=ANY($1::uuid[])) contacts,
         (SELECT count(*)::int FROM medialab_core.identities WHERE person_id=ANY($1::uuid[])) identities,
         (SELECT count(*)::int FROM medialab_core.person_account_states WHERE person_id=ANY($1::uuid[])) accounts`,
      [ids],
    );
    expect(proof.rows[0]).toEqual({ people: 2, contacts: 0, identities: 0, accounts: 0 });
  });

  it("preserves normalized non-null email validation, bootstrap, and uniqueness", async () => {
    const first = randomUUID();
    await owner.query("INSERT INTO medialab_core.people(id,display_name,email) VALUES($1,$2,$3)",
      [first, "Synthetic Email Person", "normalized@synthetic.invalid"]);
    expect((await owner.query("SELECT count(*)::int n FROM medialab_core.contact_methods WHERE person_id=$1", [first])).rows[0].n).toBe(1);
    await expect(owner.query("INSERT INTO medialab_core.people(id,display_name,email) VALUES($1,$2,$3)",
      [randomUUID(), "Duplicate Synthetic Email", "normalized@synthetic.invalid"])).rejects.toThrow();
    await expect(owner.query("INSERT INTO medialab_core.people(id,display_name,email) VALUES($1,$2,$3)",
      [randomUUID(), "Invalid Synthetic Email", "UPPER@synthetic.invalid"])).rejects.toThrow();
  });

  it("creates and reuses one NULL-email Person from an exact external reference with minimum membership only", async () => {
    const token = await session();
    const created = await reconcileCustomerPersonIntake(runtime, token, customerInput("external-reuse"));
    const reused = await reconcileCustomerPersonIntake(runtime, token,
      customerInput("external-reuse", { idempotencyKey: "customer-external-reuse-retry", displayName: "Harmless Display Variation" }));
    expect(created).toMatchObject({ outcome: "CREATED", identity_basis: "EXTERNAL_REFERENCE", external_reference_outcome: "CREATED" });
    expect(reused.person_id).toBe(created.person_id);
    expect(reused).toMatchObject({ outcome: "REUSED", external_reference_outcome: "REUSED" });
    const proof = await owner.query(
      `SELECT p.email,m.status,m.is_organization_admin,
        (SELECT count(*)::int FROM medialab_core.identities WHERE person_id=p.id) identities,
        (SELECT count(*)::int FROM medialab_core.person_account_states WHERE person_id=p.id) accounts,
        (SELECT count(*)::int FROM medialab_core.membership_permission_sets WHERE membership_id=m.id) permission_sets
       FROM medialab_core.people p JOIN medialab_core.memberships m ON m.person_id=p.id
       WHERE p.id=$1`, [created.person_id]);
    expect(proof.rows[0]).toEqual({ email: null, status: "ACTIVE", is_organization_admin: false,
      identities: 0, accounts: 0, permission_sets: 0 });
  });

  it("keeps evidence-free intake ambiguous and never merges by name", async () => {
    const token = await session();
    const ambiguous = await reconcileCustomerPersonIntake(runtime, token, customerInput("ambiguous", {
      sourceScope: null, externalRecordType: null, externalIdentifier: null, email: null,
    }));
    expect(ambiguous).toMatchObject({ outcome: "AMBIGUOUS", identity_basis: "INSUFFICIENT_EVIDENCE", person_id: null });
  });

  it("fails closed when email and external-reference evidence resolve to different Persons", async () => {
    const token = await session();
    const external = await reconcileCustomerPersonIntake(runtime, token, customerInput("conflict-external"));
    const email = await reconcileCustomerPersonIntake(runtime, token, customerInput("conflict-email", {
      email: "conflict@synthetic.invalid",
    }));
    expect(external.person_id).not.toBe(email.person_id);
    await expect(reconcileCustomerPersonIntake(runtime, token, customerInput("conflict-external", {
      idempotencyKey: "customer-conflict-cross-evidence", email: "conflict@synthetic.invalid",
    }))).rejects.toThrow(/different Persons/i);
  });

  it("serializes concurrent equivalent external-reference attempts to one Person", async () => {
    const token = await session();
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      reconcileCustomerPersonIntake(runtime, token, customerInput("concurrent", {
        idempotencyKey: "customer-concurrent-" + index,
      }))));
    expect(new Set(results.map((result) => result.person_id)).size).toBe(1);
    expect(results.filter((result) => result.outcome === "CREATED")).toHaveLength(1);
    expect((await owner.query(
      `SELECT count(*)::int n FROM medialab_core.person_external_references
       WHERE source_system='SYNTHETIC_SOURCE' AND source_scope='SYNTHETIC_ACCOUNT'
         AND external_record_type='CUSTOMER' AND external_identifier='synthetic-customer-concurrent'`,
    )).rows[0].n).toBe(1);
  });

  it("does not reactivate suspended membership and keeps external references immutable", async () => {
    const token = await session();
    const created = await reconcileCustomerPersonIntake(runtime, token, customerInput("suspended"));
    await owner.query(
      `UPDATE medialab_core.memberships SET status='SUSPENDED',suspended_at=clock_timestamp(),
       suspension_reason='Synthetic suspension',updated_at=clock_timestamp() WHERE id=$1`,
      [created.membership_id]);
    await expect(reconcileCustomerPersonIntake(runtime, token, customerInput("suspended", {
      idempotencyKey: "customer-suspended-retry",
    }))).rejects.toThrow(/cannot be reactivated/i);
    expect((await owner.query("SELECT status FROM medialab_core.memberships WHERE id=$1", [created.membership_id])).rows[0].status).toBe("SUSPENDED");
    const reference = await owner.query("SELECT id FROM medialab_core.person_external_references WHERE person_id=$1", [created.person_id]);
    await expect(owner.query("UPDATE medialab_core.person_external_references SET provenance='Changed' WHERE id=$1", [reference.rows[0].id])).rejects.toThrow(/immutable/i);
    await expect(owner.query("DELETE FROM medialab_core.person_external_references WHERE id=$1", [reference.rows[0].id])).rejects.toThrow(/immutable/i);
  });

  it("creates/reuses exact Property and Snapshot and appends changed immutable facts", async () => {
    const token = await session();
    const created = await reconcilePropertySnapshotIntake(runtime, token, propertyInput("exact"));
    const reused = await reconcilePropertySnapshotIntake(runtime, token,
      propertyInput("exact", { idempotencyKey: "property-exact-retry" }));
    const changed = await reconcilePropertySnapshotIntake(runtime, token,
      propertyInput("exact", { idempotencyKey: "property-exact-square-feet", reportedSquareFeet: 2400 }));
    expect(reused.property_id).toBe(created.property_id);
    expect(reused.property_snapshot_id).toBe(created.property_snapshot_id);
    expect(reused.snapshot_outcome).toBe("SNAPSHOT_REUSED");
    expect(changed.property_id).toBe(created.property_id);
    expect(changed.property_snapshot_id).not.toBe(created.property_snapshot_id);
    const snapshots = await owner.query(
      "SELECT id,reported_square_feet FROM medialab_core.property_snapshots WHERE property_id=$1 ORDER BY created_at,id",
      [created.property_id]);
    expect(snapshots.rows).toHaveLength(2);
    expect(snapshots.rows.find((row) => row.id === created.property_snapshot_id)?.reported_square_feet).toBeNull();
  });

  it("never fuzzy-merges a near address", async () => {
    const token = await session();
    const first = await reconcilePropertySnapshotIntake(runtime, token, propertyInput("near"));
    const near = await reconcilePropertySnapshotIntake(runtime, token, propertyInput("near-other", {
      addressLine1: "100 Near Test Lane Unit A",
    }));
    expect(near.property_id).not.toBe(first.property_id);
  });

  it("serializes concurrent exact-address attempts without duplicate Property or Snapshot", async () => {
    const token = await session();
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
      reconcilePropertySnapshotIntake(runtime, token, propertyInput("concurrent", {
        idempotencyKey: "property-concurrent-" + index,
      }))));
    expect(new Set(results.map((result) => result.property_id)).size).toBe(1);
    expect(new Set(results.map((result) => result.property_snapshot_id)).size).toBe(1);
    expect(results.filter((result) => result.property_outcome === "PROPERTY_CREATED")).toHaveLength(1);
  });

  it("fails closed when duplicate exact-address candidates already exist", async () => {
    const token = await session();
    for (const id of [randomUUID(), randomUUID()]) {
      await owner.query("INSERT INTO medialab_core.properties(id,organization_id) VALUES($1,$2)", [id, ORGANIZATION_FIXTURE.id]);
      await owner.query(
        `INSERT INTO medialab_core.property_snapshots(
           id,property_id,organization_id,address_line_1,locality,administrative_area,postal_code,country_code)
         VALUES($1,$2,$3,'100 Duplicate Test Lane','Synthetic City','NC','28000','US')`,
        [randomUUID(), id, ORGANIZATION_FIXTURE.id]);
    }
    await expect(reconcilePropertySnapshotIntake(runtime, token, propertyInput("duplicate", {
      addressLine1: "100 Duplicate Test Lane",
    }))).rejects.toThrow(/multiple canonical Properties/i);
  });

  it("preserves restricted authority and rejects invalid sessions and insufficient permission", async () => {
    await expect(runtime.query("INSERT INTO medialab_core.people(id,display_name,email) VALUES($1,$2,NULL)",
      [randomUUID(), "Forbidden Runtime DML"])).rejects.toThrow(/permission denied/i);
    await expect(reconcileCustomerPersonIntake(runtime, "invalid-session", customerInput("invalid-session"))).rejects.toThrow(/session/i);
    const ownerToken = await session(IDENTITY_FIXTURES[0].id);
    await expect(reconcileCustomerPersonIntake(runtime, ownerToken, customerInput("insufficient"))).rejects.toThrow(/permission/i);
    const authority = await owner.query(
      `SELECT
       (SELECT count(*)::int FROM information_schema.role_table_grants
        WHERE grantee='medialab_p02m16a_test_app' AND table_schema='medialab_core'
          AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')) runtime_dml,
       (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE n.nspname='medialab_core' AND a.grantee=0 AND a.privilege_type='EXECUTE') public_execute`);
    expect(authority.rows[0]).toEqual({ runtime_dml: 0, public_execute: 0 });
    const runtimeFunctions = await owner.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='medialab_core' AND p.proname LIKE 'reconcile_%_intake'
         AND has_function_privilege('medialab_p02m16a_test_app',p.oid,'EXECUTE')
       ORDER BY p.proname`);
    expect(runtimeFunctions.rows.map((row) => row.proname)).toEqual([
      "reconcile_customer_person_intake", "reconcile_property_snapshot_intake",
    ]);
  });
});
