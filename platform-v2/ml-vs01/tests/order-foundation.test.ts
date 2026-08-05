import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import {
  ORDER_FOUNDATION_ACTOR_IDENTITY_ID,
  ORDER_FOUNDATION_CUSTOM_SNAPSHOT_ID,
  ORDER_FOUNDATION_ORDER_ID,
  ORDER_FOUNDATION_PROPERTY_ID,
  ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
  ORDER_FOUNDATION_SOURCE
} from '../db/fixtures/order-foundation-fixtures.js';
import { COMMERCIAL_SNAPSHOT_FIXTURES } from '../db/fixtures/current-catalog-price-fixtures.js';
import { ORGANIZATION_FIXTURE, PEOPLE_FIXTURES } from '../db/fixtures/identity-tenancy-fixtures.js';

const TEST_DB = 'medialab_p02m04a_test';
const TEST_OWNER_ROLE = 'medialab_p02m04a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m04a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m04a-pg';
const TEST_PORT = 55432;
const OPERATOR_PERSON_ID = PEOPLE_FIXTURES[1].id;
const OWNER_PERSON_ID = PEOPLE_FIXTURES[0].id;
const OWNER_IDENTITY_ID = 'e69ced56-a63e-57bf-a6b5-26d5fe6cc5c5';

type CreateOverrides = {
  key?: string;
  organizationId?: string;
  propertyId?: string | null;
  propertySnapshotId?: string | null;
  currency?: string;
  sourceIdentifier?: string;
  parties?: Array<Record<string, string>>;
  items?: Array<Record<string, string | number>>;
  travelAmount?: number;
  travelBasis?: string | null;
  relatedOrderId?: string | null;
  relationshipType?: string | null;
  relationshipReason?: string | null;
};

function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function defaultParties(): Array<Record<string, string>> {
  return [
    { role: 'ORDERING_PERSON', person_id: OPERATOR_PERSON_ID },
    { role: 'CUSTOMER', person_id: OWNER_PERSON_ID },
    { role: 'BILLING_PARTY', person_id: OWNER_PERSON_ID },
    { role: 'COMMERCIAL_OWNER', person_id: OPERATOR_PERSON_ID },
    { role: 'ORGANIZATION', organization_id: ORGANIZATION_FIXTURE.id },
    { role: 'AUTHORIZED_ACTOR', person_id: OPERATOR_PERSON_ID }
  ];
}

function defaultItems(): Array<Record<string, string | number>> {
  return [{ position: 1, commercial_snapshot_id: COMMERCIAL_SNAPSHOT_FIXTURES[1].id }];
}

describe('P02-M04-A provider-neutral Order foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_OWNER_ROLE,
      runtimeUser: TEST_RUNTIME_ROLE,
      confirm: TEST_DB
    });
  }

  async function issueOrdinarySession(identityId = ORDER_FOUNDATION_ACTOR_IDENTITY_ID): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute',
               clock_timestamp() + interval '1 hour', NULL)`,
      [crypto.randomUUID(), identityId, tokenDigest(token)]
    );
    return token;
  }

  async function issueRecoverySession(identityId = ORDER_FOUNDATION_ACTOR_IDENTITY_ID): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.account_recovery_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, external_authentication_reference)
       VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute',
               clock_timestamp() + interval '15 minutes', $4)`,
      [crypto.randomUUID(), identityId, tokenDigest(token), `synthetic-recovery:${crypto.randomUUID()}`]
    );
    return token;
  }

  async function createOrder(
    client: pg.Client,
    token: string,
    overrides: CreateOverrides = {}
  ): Promise<string> {
    const key = overrides.key ?? `synthetic-key-${crypto.randomUUID()}`;
    const sourceIdentifier = overrides.sourceIdentifier ?? `synthetic-source-${crypto.randomUUID()}`;
    const result = await client.query<{ create_order: string }>(
      `SELECT medialab_core.create_order(
         $1, $2, 'REAL_ESTATE', $3, $4, $5, 'PAY_NOW', $6,
         $7, 'ORDER', $8, $9::jsonb, $10::jsonb, $11, $12,
         $13, $14, $15)`,
      [
        token,
        key,
        overrides.organizationId ?? ORGANIZATION_FIXTURE.id,
        overrides.propertyId === undefined ? ORDER_FOUNDATION_PROPERTY_ID : overrides.propertyId,
        overrides.propertySnapshotId === undefined ? ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID : overrides.propertySnapshotId,
        overrides.currency ?? 'USD',
        ORDER_FOUNDATION_SOURCE,
        sourceIdentifier,
        JSON.stringify(overrides.parties ?? defaultParties()),
        JSON.stringify(overrides.items ?? defaultItems()),
        overrides.travelAmount ?? 0,
        overrides.travelBasis === undefined ? null : overrides.travelBasis,
        overrides.relatedOrderId ?? null,
        overrides.relationshipType ?? null,
        overrides.relationshipReason ?? null
      ]
    );
    return result.rows[0].create_order;
  }

  async function expectFailure(work: Promise<unknown>, pattern?: RegExp): Promise<void> {
    try {
      await work;
      throw new Error('Expected PostgreSQL operation to fail');
    } catch (error: any) {
      if (error.message === 'Expected PostgreSQL operation to fail') throw error;
      if (pattern) expect(error.message).toMatch(pattern);
    }
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_OWNER_ROLE });
    runtime = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_RUNTIME_ROLE });
    await owner.connect();
    await runtime.connect();
  });

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    await reset();
  });

  it('1. records the exact nine-migration ledger while preserving 0001 through 0006', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(9);
    expect(ledger.rows.slice(0, 5)).toEqual([
      { filename: '0001_identity_and_tenancy.sql', sha256: '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31' },
      { filename: '0002_property_identity_and_snapshots.sql', sha256: 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83' },
      { filename: '0003_person_contacts_and_account_lifecycle.sql', sha256: '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3' },
      { filename: '0004_current_catalog_and_price_snapshots.sql', sha256: 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876' },
      { filename: '0005_catalog_administration_lifecycle.sql', sha256: '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40' }
    ]);
    expect(ledger.rows[5].filename).toBe('0006_orders_and_immutable_commercial_evidence.sql');
    expect(ledger.rows[5].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.rows[6].filename).toBe('0007_property_hub_foundation.sql');
    expect(ledger.rows[7].filename).toBe('0008_scheduling_request_and_appointment_foundation.sql');
    expect(ledger.rows[8].filename).toBe('0009_job_and_service_workstream_foundation.sql');
    expect(ledger.rows[6].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. creates exactly the seven bounded Order tables with no views, types, or sequences', async () => {
    const tables = await owner.query(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'medialab_core' AND tablename LIKE 'order%'
        ORDER BY tablename`
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'order_events',
      'order_external_references',
      'order_idempotency_records',
      'order_items',
      'order_parties',
      'order_relationships',
      'orders'
    ]);
    const extras = await owner.query(
      `SELECT count(*)::int AS count FROM (
         SELECT viewname AS name FROM pg_views WHERE schemaname = 'medialab_core'
         UNION ALL SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'medialab_core'
         UNION ALL SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'medialab_core' AND t.typtype = 'e'
       ) extra`
    );
    expect(extras.rows[0].count).toBe(0);
  });

  it('3. seeds one visibly synthetic Order with six distinct frozen party roles and two items', async () => {
    const order = await owner.query('SELECT * FROM medialab_core.orders WHERE id = $1', [ORDER_FOUNDATION_ORDER_ID]);
    expect(order.rows[0]).toMatchObject({
      lane: 'REAL_ESTATE',
      organization_id: ORGANIZATION_FIXTURE.id,
      currency: 'USD',
      item_subtotal_cents: '37500',
      travel_amount_cents: '3500',
      total_amount_cents: '41000',
      current_state: 'ACCEPTED',
      source_system: ORDER_FOUNDATION_SOURCE
    });
    const roles = await owner.query(
      'SELECT party_role FROM medialab_core.order_parties WHERE order_id = $1 ORDER BY party_role',
      [ORDER_FOUNDATION_ORDER_ID]
    );
    expect(roles.rows.map((row) => row.party_role)).toEqual([
      'AUTHORIZED_ACTOR', 'BILLING_PARTY', 'COMMERCIAL_OWNER',
      'CUSTOMER', 'ORDERING_PERSON', 'ORGANIZATION'
    ]);
    const items = await owner.query(
      'SELECT item_kind, position FROM medialab_core.order_items WHERE order_id = $1 ORDER BY position',
      [ORDER_FOUNDATION_ORDER_ID]
    );
    expect(items.rows).toEqual([{ item_kind: 'CATALOG', position: 1 }, { item_kind: 'CUSTOM', position: 2 }]);
  });

  it('4. exposes only create_order and get_order_record as new runtime APIs', async () => {
    const functions = await owner.query(
      `SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND p.proname IN ('create_order', 'get_order_record')
        ORDER BY p.proname`,
      [TEST_RUNTIME_ROLE]
    );
    expect(functions.rows).toEqual([
      { proname: 'create_order', prosecdef: true, proconfig: ['search_path=pg_catalog, medialab_core, pg_temp'], owner: TEST_OWNER_ROLE, runtime_execute: true, public_execute: false },
      { proname: 'get_order_record', prosecdef: true, proconfig: ['search_path=pg_catalog, medialab_core, pg_temp'], owner: TEST_OWNER_ROLE, runtime_execute: true, public_execute: false }
    ]);
  });

  it('5. creates and reads an accepted Order through tenant-scoped runtime APIs', async () => {
    const token = await issueOrdinarySession();
    const orderId = await createOrder(runtime, token);
    const record = await runtime.query<{ get_order_record: any }>(
      'SELECT medialab_core.get_order_record($1, $2)',
      [token, orderId]
    );
    expect(record.rows[0].get_order_record.order.id).toBe(orderId);
    expect(record.rows[0].get_order_record.parties).toHaveLength(6);
    expect(record.rows[0].get_order_record.items).toHaveLength(1);
    expect(record.rows[0].get_order_record.events.map((event: any) => event.event_type).sort()).toEqual([
      'ORDER_ACCEPTED', 'ORDER_CREATED'
    ]);
  });

  it('6. rejects cross-organization creation before canonical records are written', async () => {
    const token = await issueOrdinarySession();
    const otherOrganizationId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Synthetic Other Organization')`,
      [otherOrganizationId]
    );
    await expectFailure(createOrder(runtime, token, {
      organizationId: otherOrganizationId,
      propertyId: null,
      propertySnapshotId: null,
      parties: defaultParties().map((party) => party.role === 'ORGANIZATION'
        ? { role: 'ORGANIZATION', organization_id: otherOrganizationId }
        : party)
    }), /lacks required permission/);
  });

  it('7. rejects inactive and cross-organization party assertions', async () => {
    const token = await issueOrdinarySession();
    const parties = defaultParties();
    parties[1] = { role: 'CUSTOMER', person_id: PEOPLE_FIXTURES[2].id };
    await expectFailure(createOrder(runtime, token, { parties }), /not an active member/);
  });

  it('8. rejects customer Organization Admin and recovery authority without Order permission', async () => {
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    await expectFailure(createOrder(runtime, ownerToken), /lacks required permission/);
    const recoveryToken = await issueRecoverySession();
    await expectFailure(createOrder(runtime, recoveryToken), /Ordinary session/);
  });

  it('9. rejects suspended membership and revoked identity authority', async () => {
    const token = await issueOrdinarySession();
    await owner.query(
      `UPDATE medialab_core.memberships
          SET status = 'SUSPENDED', suspended_at = clock_timestamp(),
              suspension_reason = 'Synthetic suspension', updated_at = clock_timestamp()
        WHERE person_id = $1 AND organization_id = $2`,
      [OPERATOR_PERSON_ID, ORGANIZATION_FIXTURE.id]
    );
    await expectFailure(createOrder(runtime, token), /lacks required permission/);
    await reset();
    const revokedToken = await issueOrdinarySession();
    await owner.query("UPDATE medialab_core.identities SET status = 'REVOKED' WHERE id = $1", [ORDER_FOUNDATION_ACTOR_IDENTITY_ID]);
    await expectFailure(createOrder(runtime, revokedToken), /Ordinary session/);
  });

  it('10. freezes distinct party roles after person and membership changes', async () => {
    const token = await issueOrdinarySession();
    const orderId = await createOrder(runtime, token);
    const before = await owner.query(
      'SELECT party_role, frozen_display_name FROM medialab_core.order_parties WHERE order_id = $1 ORDER BY party_role',
      [orderId]
    );
    await owner.query("UPDATE medialab_core.people SET display_name = 'Changed Later', updated_at = clock_timestamp() WHERE id = $1", [OWNER_PERSON_ID]);
    await owner.query(
      `UPDATE medialab_core.memberships SET status = 'REMOVED', removed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE person_id = $1 AND organization_id = $2`,
      [OWNER_PERSON_ID, ORGANIZATION_FIXTURE.id]
    );
    const after = await owner.query(
      'SELECT party_role, frozen_display_name FROM medialab_core.order_parties WHERE order_id = $1 ORDER BY party_role',
      [orderId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('11. deep-copies catalog item meaning and rejects item update or deletion', async () => {
    const token = await issueOrdinarySession();
    const orderId = await createOrder(runtime, token);
    const before = await owner.query('SELECT * FROM medialab_core.order_items WHERE order_id = $1', [orderId]);
    await expectFailure(owner.query("UPDATE medialab_core.order_items SET frozen_description = 'Changed' WHERE order_id = $1", [orderId]), /immutable/);
    await expectFailure(owner.query('DELETE FROM medialab_core.order_items WHERE order_id = $1', [orderId]), /immutable/);
    const after = await owner.query('SELECT * FROM medialab_core.order_items WHERE order_id = $1', [orderId]);
    expect(after.rows).toEqual(before.rows);
  });

  it('12. preserves item meaning after catalog rename, repricing, retirement, and package evidence changes', async () => {
    const token = await issueOrdinarySession();
    const orderId = await createOrder(runtime, token);
    const before = await owner.query('SELECT frozen_description, unit_amount_cents FROM medialab_core.order_items WHERE order_id = $1', [orderId]);
    const productId = COMMERCIAL_SNAPSHOT_FIXTURES[1].catalog_product_id;
    await owner.query(
      `UPDATE medialab_core.catalog_products
          SET display_name = 'Synthetic Renamed Later', lifecycle_state = 'RETIRED', updated_at = clock_timestamp()
        WHERE id = $1`,
      [productId]
    );
    await owner.query(
      `INSERT INTO medialab_core.catalog_prices
         (id, product_id, amount_cents, currency, effective_at, source_system,
          recorded_by_identity_id, recorded_at)
       VALUES ($1, $2, 99999, 'USD', clock_timestamp() + interval '1 day', $3, $4, clock_timestamp())`,
      [crypto.randomUUID(), productId, ORDER_FOUNDATION_SOURCE, ORDER_FOUNDATION_ACTOR_IDENTITY_ID]
    );
    const after = await owner.query('SELECT frozen_description, unit_amount_cents FROM medialab_core.order_items WHERE order_id = $1', [orderId]);
    expect(after.rows).toEqual(before.rows);
    const packageItems = await owner.query(
      'SELECT * FROM medialab_core.commercial_snapshot_package_items WHERE snapshot_id = $1 ORDER BY position',
      [COMMERCIAL_SNAPSHOT_FIXTURES[0].id]
    );
    expect(packageItems.rows).toHaveLength(1);
    await expectFailure(owner.query(
      'UPDATE medialab_core.commercial_snapshot_package_items SET included_display_name = $1 WHERE snapshot_id = $2',
      ['Changed', COMMERCIAL_SNAPSHOT_FIXTURES[0].id]
    ), /immutable/);
  });

  it('13. accepts an authorized custom item without creating a catalog product', async () => {
    const token = await issueOrdinarySession();
    const before = await owner.query('SELECT count(*)::int AS count FROM medialab_core.catalog_products');
    const orderId = await createOrder(runtime, token, {
      items: [{ position: 1, custom_commercial_snapshot_id: ORDER_FOUNDATION_CUSTOM_SNAPSHOT_ID }]
    });
    const item = await owner.query('SELECT * FROM medialab_core.order_items WHERE order_id = $1', [orderId]);
    expect(item.rows[0]).toMatchObject({
      item_kind: 'CUSTOM',
      frozen_description: 'Synthetic one-order custom commercial line',
      unit_amount_cents: '22500',
      currency: 'USD',
      custom_actor_identity_id: ORDER_FOUNDATION_ACTOR_IDENTITY_ID
    });
    const after = await owner.query('SELECT count(*)::int AS count FROM medialab_core.catalog_products');
    expect(after.rows).toEqual(before.rows);
  });

  it('14. rejects custom evidence authorized by another actor', async () => {
    const otherSnapshotId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO medialab_core.custom_commercial_snapshots
         (id, description, approved_price_cents, currency, quantity, reason,
          source_system, effective_at, created_by_identity_id, created_at)
       VALUES ($1, 'Synthetic unauthorized custom line', 1000, 'USD', 1,
               'Synthetic unauthorized actor case', $2, clock_timestamp(), $3, clock_timestamp())`,
      [otherSnapshotId, ORDER_FOUNDATION_SOURCE, OWNER_IDENTITY_ID]
    );
    const token = await issueOrdinarySession();
    await expectFailure(createOrder(runtime, token, {
      items: [{ position: 1, custom_commercial_snapshot_id: otherSnapshotId }]
    }), /not authorized by the authenticated actor/);
  });

  it('15. returns the original Order for exact idempotent replay', async () => {
    const token = await issueOrdinarySession();
    const key = `exact-replay-${crypto.randomUUID()}`;
    const sourceIdentifier = `exact-source-${crypto.randomUUID()}`;
    const first = await createOrder(runtime, token, { key, sourceIdentifier });
    const second = await createOrder(runtime, token, { key, sourceIdentifier });
    expect(second).toBe(first);
    const count = await owner.query('SELECT count(*)::int AS count FROM medialab_core.orders WHERE id = $1', [first]);
    expect(count.rows[0].count).toBe(1);
  });

  it('16. rejects a reused key with a conflicting request fingerprint', async () => {
    const token = await issueOrdinarySession();
    const key = `conflict-${crypto.randomUUID()}`;
    const sourceIdentifier = `conflict-source-${crypto.randomUUID()}`;
    await createOrder(runtime, token, { key, sourceIdentifier });
    await expectFailure(createOrder(runtime, token, { key, sourceIdentifier, travelAmount: 1000, travelBasis: 'Synthetic changed request' }), /conflicting request fingerprint/);
  });

  it('17. serializes concurrent identical requests into one canonical Order', async () => {
    const token = await issueOrdinarySession();
    const key = `concurrent-${crypto.randomUUID()}`;
    const sourceIdentifier = `concurrent-source-${crypto.randomUUID()}`;
    const runtimeTwo = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_RUNTIME_ROLE });
    await runtimeTwo.connect();
    try {
      const [first, second] = await Promise.all([
        createOrder(runtime, token, { key, sourceIdentifier }),
        createOrder(runtimeTwo, token, { key, sourceIdentifier })
      ]);
      expect(second).toBe(first);
      const count = await owner.query(
        `SELECT count(*)::int AS count FROM medialab_core.order_external_references
          WHERE provider = $1 AND external_record_type = 'ORDER' AND external_identifier = $2`,
        [ORDER_FOUNDATION_SOURCE, sourceIdentifier]
      );
      expect(count.rows[0].count).toBe(1);
    } finally {
      await runtimeTwo.end();
    }
  });

  it('18. rolls back every canonical record on failure and permits deterministic retry', async () => {
    const token = await issueOrdinarySession();
    const key = `retry-${crypto.randomUUID()}`;
    const sourceIdentifier = `retry-source-${crypto.randomUUID()}`;
    await expectFailure(createOrder(runtime, token, {
      key,
      sourceIdentifier,
      items: [{ position: 1, commercial_snapshot_id: crypto.randomUUID() }]
    }), /does not exist/);
    const partial = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM medialab_core.order_idempotency_records WHERE idempotency_key = $1) AS idempotency_count,
         (SELECT count(*)::int FROM medialab_core.order_external_references WHERE external_identifier = $2) AS reference_count`,
      [key, sourceIdentifier]
    );
    expect(partial.rows[0]).toEqual({ idempotency_count: 0, reference_count: 0 });
    const retried = await createOrder(runtime, token, { key, sourceIdentifier });
    expect(retried).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('19. prevents one external source identity from being reassigned to another Order', async () => {
    const token = await issueOrdinarySession();
    const sourceIdentifier = `unique-source-${crypto.randomUUID()}`;
    await createOrder(runtime, token, { sourceIdentifier });
    await expectFailure(createOrder(runtime, token, { sourceIdentifier }), /order_external_references_source_key/);
  });

  it('20. keeps Order and critical event history append-only', async () => {
    const token = await issueOrdinarySession();
    const orderId = await createOrder(runtime, token);
    await expectFailure(owner.query("UPDATE medialab_core.orders SET current_state = 'ACCEPTED' WHERE id = $1", [orderId]), /immutable/);
    await expectFailure(owner.query("UPDATE medialab_core.order_events SET reason = 'Changed' WHERE order_id = $1", [orderId]), /immutable/);
    await expectFailure(owner.query('DELETE FROM medialab_core.order_events WHERE order_id = $1', [orderId]), /immutable/);
  });

  it('21. records every approved related-Order class without rewriting the original', async () => {
    const token = await issueOrdinarySession();
    const originalBefore = await owner.query('SELECT * FROM medialab_core.orders WHERE id = $1', [ORDER_FOUNDATION_ORDER_ID]);
    for (const relationshipType of ['CORRECTION', 'SUPPLEMENTAL', 'REPLACEMENT', 'CUSTOMER_ADDED_SCOPE', 'MEDIALAB_RESPONSIBLE_RETURN']) {
      const relatedId = await createOrder(runtime, token, {
        relatedOrderId: ORDER_FOUNDATION_ORDER_ID,
        relationshipType,
        relationshipReason: `Synthetic ${relationshipType} evidence`
      });
      const relationship = await owner.query(
        'SELECT relationship_type FROM medialab_core.order_relationships WHERE original_order_id = $1 AND related_order_id = $2',
        [ORDER_FOUNDATION_ORDER_ID, relatedId]
      );
      expect(relationship.rows[0].relationship_type).toBe(relationshipType);
    }
    const originalAfter = await owner.query('SELECT * FROM medialab_core.orders WHERE id = $1', [ORDER_FOUNDATION_ORDER_ID]);
    expect(originalAfter.rows).toEqual(originalBefore.rows);
  });

  it('22. rejects self-reference and relationship cycles', async () => {
    await expectFailure(owner.query(
      `INSERT INTO medialab_core.order_relationships
         (id, original_order_id, related_order_id, relationship_type, reason,
          source_system, created_by_identity_id)
       VALUES ($1, $2, $2, 'CORRECTION', 'Synthetic self reference', $3, $4)`,
      [crypto.randomUUID(), ORDER_FOUNDATION_ORDER_ID, ORDER_FOUNDATION_SOURCE, ORDER_FOUNDATION_ACTOR_IDENTITY_ID]
    ));
    const token = await issueOrdinarySession();
    const relatedId = await createOrder(runtime, token, {
      relatedOrderId: ORDER_FOUNDATION_ORDER_ID,
      relationshipType: 'CORRECTION',
      relationshipReason: 'Synthetic forward relation'
    });
    await expectFailure(owner.query(
      `INSERT INTO medialab_core.order_relationships
         (id, original_order_id, related_order_id, relationship_type, reason,
          source_system, created_by_identity_id)
       VALUES ($1, $2, $3, 'REPLACEMENT', 'Synthetic cycle attempt', $4, $5)`,
      [crypto.randomUUID(), relatedId, ORDER_FOUNDATION_ORDER_ID, ORDER_FOUNDATION_SOURCE, ORDER_FOUNDATION_ACTOR_IDENTITY_ID]
    ), /cycle/);
  });

  it('23. denies runtime direct DML on every packet table and sequence', async () => {
    const grants = await owner.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core' AND table_name LIKE 'order%'
        ORDER BY table_name, privilege_type`,
      [TEST_RUNTIME_ROLE]
    );
    expect(grants.rows).toEqual([]);
    const owned = await owner.query(
      `SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'medialab_core' AND pg_get_userbyid(c.relowner) = $1`,
      [TEST_RUNTIME_ROLE]
    );
    expect(owned.rows[0].count).toBe(0);
    await expectFailure(runtime.query('DELETE FROM medialab_core.orders WHERE id = $1', [ORDER_FOUNDATION_ORDER_ID]));
  });

  it('24. keeps protected helpers owner-only with fixed search paths and resists temporary shadowing', async () => {
    const helpers = await owner.query(
      `SELECT p.proname, p.prosecdef, p.proconfig,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND p.proname IN ('guard_order_relationship_insert', 'reject_order_evidence_mutation', 'require_order_permission')
        ORDER BY p.proname`,
      [TEST_RUNTIME_ROLE]
    );
    expect(helpers.rows).toEqual([
      { proname: 'guard_order_relationship_insert', prosecdef: false, proconfig: ['search_path=pg_catalog, medialab_core, pg_temp'], runtime_execute: false },
      { proname: 'reject_order_evidence_mutation', prosecdef: false, proconfig: ['search_path=pg_catalog, medialab_core, pg_temp'], runtime_execute: false },
      { proname: 'require_order_permission', prosecdef: true, proconfig: ['search_path=pg_catalog, medialab_core, pg_temp'], runtime_execute: false }
    ]);
    const token = await issueOrdinarySession();
    await runtime.query('CREATE TEMP TABLE orders (id uuid)');
    const created = await createOrder(runtime, token);
    expect(created).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('25. rejects invalid currency, negative travel, duplicate positions, and missing property evidence', async () => {
    const token = await issueOrdinarySession();
    await expectFailure(createOrder(runtime, token, { currency: 'EUR' }), /currency/);
    await expectFailure(createOrder(runtime, token, { travelAmount: -1, travelBasis: null }));
    await expectFailure(createOrder(runtime, token, {
      items: [
        { position: 1, commercial_snapshot_id: COMMERCIAL_SNAPSHOT_FIXTURES[1].id },
        { position: 1, commercial_snapshot_id: COMMERCIAL_SNAPSHOT_FIXTURES[2].id }
      ]
    }), /positions must be unique/);
    await expectFailure(createOrder(runtime, token, { propertyId: null, propertySnapshotId: null }), /require immutable property evidence/);
  });

  it('26. creates no deferred payment, delivery, publication, or UI objects', async () => {
    const deferred = await owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'medialab_core'
        AND (tablename LIKE 'payment%' OR tablename LIKE 'invoice%' OR tablename LIKE 'delivery%'
          OR tablename LIKE 'publication%' OR tablename LIKE 'download%')
        ORDER BY tablename`
    );
    expect(deferred.rows).toEqual([]);
  });
});
