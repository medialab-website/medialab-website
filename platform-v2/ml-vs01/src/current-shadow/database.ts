import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { resetTestDatabase } from "../../db/reset-test-database.js";
import { COMMERCIAL_SNAPSHOT_FIXTURES } from "../../db/fixtures/current-catalog-price-fixtures.js";
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PEOPLE_FIXTURES } from "../../db/fixtures/identity-tenancy-fixtures.js";
import { ORDER_FOUNDATION_PROPERTY_ID, ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID } from "../../db/fixtures/order-foundation-fixtures.js";
import type { CurrentEraNormalizedListingV1 } from "./contracts.js";

export const CURRENT_SHADOW_DATABASE = Object.freeze({
  host: "/tmp/mlvs01-p02m16a-pg", port: 55447, database: "medialab_p02m16a_test",
  owner: "medialab_p02m16a_test_owner", runtime: "medialab_p02m16a_test_app",
});

export interface PlatformShadowObservationV1 {
  orderCreated: boolean;
  orderReadBack: boolean;
  readBackLineCount: number;
  financialEligibilityRecorded: boolean;
  commands: readonly { command: string; status: "ACCEPTED" | "REJECTED" }[];
}

function assertDatabaseBoundary(): void {
  const db = CURRENT_SHADOW_DATABASE;
  if (db.host !== "/tmp/mlvs01-p02m16a-pg" || db.port !== 55447 || db.database !== "medialab_p02m16a_test" ||
      db.owner !== "medialab_p02m16a_test_owner" || db.runtime !== "medialab_p02m16a_test_app") {
    throw new Error("CURRENT_SHADOW_AUTHORITY_BOUNDARY_FAILURE: disposable database identity changed");
  }
}

export async function resetCurrentShadowDatabase(): Promise<void> {
  assertDatabaseBoundary();
  await resetTestDatabase({ host: CURRENT_SHADOW_DATABASE.host, port: CURRENT_SHADOW_DATABASE.port,
    database: CURRENT_SHADOW_DATABASE.database, user: CURRENT_SHADOW_DATABASE.owner,
    runtimeUser: CURRENT_SHADOW_DATABASE.runtime, confirm: CURRENT_SHADOW_DATABASE.database });
}

export async function issueCurrentShadowSession(): Promise<string> {
  assertDatabaseBoundary();
  const token = randomBytes(32).toString("base64url");
  const owner = new pg.Client({ host: CURRENT_SHADOW_DATABASE.host, port: CURRENT_SHADOW_DATABASE.port,
    database: CURRENT_SHADOW_DATABASE.database, user: CURRENT_SHADOW_DATABASE.owner,
    application_name: "p02-m16-d-session-bootstrap" });
  await owner.connect();
  try {
    await owner.query(
      `INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at,revoked_at)
       VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 hours',NULL)`,
      [randomUUID(), IDENTITY_FIXTURES[1].id, createHash("sha256").update(token).digest("hex")],
    );
  } finally { await owner.end(); }
  return token;
}

function fixtureParties(): Array<Record<string, string>> {
  return [
    { role: "ORDERING_PERSON", person_id: PEOPLE_FIXTURES[1].id },
    { role: "CUSTOMER", person_id: PEOPLE_FIXTURES[0].id },
    { role: "BILLING_PARTY", person_id: PEOPLE_FIXTURES[0].id },
    { role: "COMMERCIAL_OWNER", person_id: PEOPLE_FIXTURES[1].id },
    { role: "ORGANIZATION", organization_id: ORGANIZATION_FIXTURE.id },
    { role: "AUTHORIZED_ACTOR", person_id: PEOPLE_FIXTURES[1].id },
  ];
}

export class CurrentShadowDatabase {
  readonly pool: pg.Pool;
  constructor() {
    assertDatabaseBoundary();
    if (/owner/i.test(CURRENT_SHADOW_DATABASE.runtime)) throw new Error("CURRENT_SHADOW_AUTHORITY_BOUNDARY_FAILURE: business execution cannot use owner role");
    this.pool = new pg.Pool({ host: CURRENT_SHADOW_DATABASE.host, port: CURRENT_SHADOW_DATABASE.port,
      database: CURRENT_SHADOW_DATABASE.database, user: CURRENT_SHADOW_DATABASE.runtime, max: 4,
      application_name: "p02-m16-d-current-shadow", statement_timeout: 30_000 });
  }

  async reconstruct(listing: CurrentEraNormalizedListingV1, token: string): Promise<PlatformShadowObservationV1> {
    const ordinal = listing.scenarioId.match(/_(\d{3})_V1$/)?.[1];
    if (!ordinal) throw new Error("CURRENT_SHADOW_HARNESS_SCOPE_RECONCILIATION_REQUIRED: invalid scenario identity");
    const lineItems = Array.from({ length: listing.shape.orderLineCardinality }, (_, index) => ({
      position: index + 1, commercial_snapshot_id: COMMERCIAL_SNAPSHOT_FIXTURES[1].id,
    }));
    const commands: { command: string; status: "ACCEPTED" | "REJECTED" }[] = [];
    try {
      const created = await this.pool.query<{ create_order: string }>(
        `SELECT medialab_core.create_order(
           $1,$2,'REAL_ESTATE',$3,$4,$5,'PAY_NOW','USD',
           'CURRENT_SHADOW_LOCAL_EVIDENCE','ORDER',$6,$7::jsonb,$8::jsonb,0,NULL,NULL,NULL,NULL)`,
        [token, `m16d-order-${ordinal}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_PROPERTY_ID,
          ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID, listing.opaqueSourceReferenceHash,
          JSON.stringify(fixtureParties()), JSON.stringify(lineItems)],
      );
      commands.push({ command: "create_order", status: "ACCEPTED" });
      const orderId = created.rows[0]?.create_order;
      if (!orderId) throw new Error("create_order returned no opaque local result");
      const record = await this.pool.query<{ get_order_record: { order: { id: string }; items: unknown[] } }>(
        "SELECT medialab_core.get_order_record($1,$2::uuid)", [token, orderId],
      );
      commands.push({ command: "get_order_record", status: "ACCEPTED" });
      const readBack = record.rows[0]?.get_order_record;
      if (!readBack || readBack.order.id !== orderId) throw new Error("order read-back failed");
      await this.pool.query(
        `SELECT medialab_core.record_delivery_financial_eligibility(
           $1,$2,$3::uuid,'ELIGIBLE','BOUNDED_SETTLEMENT_AUTHORITY',$4,NULL,$5)`,
        [token, `m16d-financial-${ordinal}`, orderId, `CURRENT_SHADOW.${ordinal}`,
          "Local read-only current-era settlement evidence; external values withheld."],
      );
      commands.push({ command: "record_delivery_financial_eligibility", status: "ACCEPTED" });
      return { orderCreated: true, orderReadBack: true, readBackLineCount: readBack.items.length,
        financialEligibilityRecorded: true, commands };
    } catch (error) {
      commands.push({ command: "current_shadow_reconstruction", status: "REJECTED" });
      const message = error instanceof Error ? error.message : "unknown runtime error";
      throw new Error(`CURRENT_SHADOW_VALIDATION_FAILURE: Platform reconstruction rejected for ${listing.scenarioId}: ${message.replace(/[A-Fa-f0-9]{16,}/g, "[REDACTED]")}`);
    }
  }

  async authorityProof(): Promise<{
    runtimeCanonicalTableDmlGrants: number;
    publicCanonicalTableDmlGrants: number;
    publicFunctionExecutionGrants: number;
    businessExecutionRole: string;
    businessWriteBoundary: string;
  }> {
    const runtime = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text FROM information_schema.role_table_grants
       WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [CURRENT_SHADOW_DATABASE.runtime],
    );
    const publicTable = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
       WHERE n.nspname='medialab_core' AND c.relkind IN ('r','p') AND a.grantee=0
         AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
    );
    const publicFunctions = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
       WHERE n.nspname='medialab_core' AND a.grantee=0 AND a.privilege_type='EXECUTE'`,
    );
    return {
      runtimeCanonicalTableDmlGrants: Number(runtime.rows[0]!.count),
      publicCanonicalTableDmlGrants: Number(publicTable.rows[0]!.count),
      publicFunctionExecutionGrants: Number(publicFunctions.rows[0]!.count),
      businessExecutionRole: CURRENT_SHADOW_DATABASE.runtime,
      businessWriteBoundary: "SUPPORTED_SECURITY_DEFINER_COMMANDS_ONLY",
    };
  }

  async close(): Promise<void> { await this.pool.end(); }
}
