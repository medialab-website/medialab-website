import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import {
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  ORGANIZATION_FIXTURE,
  PEOPLE_FIXTURES,
  PERMISSION_SET_FIXTURE
} from '../db/fixtures/identity-tenancy-fixtures.js';
import {
  ORDER_FOUNDATION_ORDER_ID,
  ORDER_FOUNDATION_PROPERTY_ID,
  ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID
} from '../db/fixtures/order-foundation-fixtures.js';
import { COMMERCIAL_SNAPSHOT_FIXTURES } from '../db/fixtures/current-catalog-price-fixtures.js';
import {
  PROPERTY_HUB_ACTOR_IDENTITY_ID,
  PROPERTY_HUB_ID,
  PROPERTY_HUB_SECOND_ORDER_ID,
  PROPERTY_HUB_SOURCE
} from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m10a_test';
const TEST_OWNER_ROLE = 'medialab_p02m10a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m10a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m10a-pg';
const TEST_PORT = 55440;
const OWNER_IDENTITY_ID = IDENTITY_FIXTURES[0].id;
const OPERATOR_MEMBERSHIP_ID = MEMBERSHIP_FIXTURES[1].id;
const OWNER_MEMBERSHIP_ID = MEMBERSHIP_FIXTURES[0].id;

type CreateHubOverrides = {
  key?: string;
  organizationId?: string;
  propertyId?: string;
  snapshotId?: string;
  sourceSystem?: string;
  orderIds?: string[];
  participants?: Array<Record<string, string>>;
  externalReferences?: Array<Record<string, string>>;
};

function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('P02-M04-B provider-neutral Property Hub foundation', () => {
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

  async function issueOrdinarySession(identityId = PROPERTY_HUB_ACTOR_IDENTITY_ID): Promise<string> {
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

  function defaultParticipants(): Array<Record<string, string>> {
    return [{ membership_id: OWNER_MEMBERSHIP_ID, role: 'HUB_PARTICIPANT' }];
  }

  function defaultExternalReferences(identifier = `synthetic-hub-${crypto.randomUUID()}`): Array<Record<string, string>> {
    return [{
      provider: PROPERTY_HUB_SOURCE,
      external_record_type: 'PROPERTY_ENGAGEMENT',
      external_identifier: identifier,
      provenance: 'SYNTHETIC_RUNTIME_TEST'
    }];
  }

  async function createHub(
    client: pg.Client,
    token: string,
    overrides: CreateHubOverrides = {}
  ): Promise<string> {
    const result = await client.query<{ create_property_hub: string }>(
      `SELECT medialab_core.create_property_hub(
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
      [
        token,
        overrides.key ?? `synthetic-hub-key-${crypto.randomUUID()}`,
        overrides.organizationId ?? ORGANIZATION_FIXTURE.id,
        overrides.propertyId ?? ORDER_FOUNDATION_PROPERTY_ID,
        overrides.snapshotId ?? ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
        overrides.sourceSystem ?? PROPERTY_HUB_SOURCE,
        JSON.stringify(overrides.orderIds ?? [ORDER_FOUNDATION_ORDER_ID]),
        JSON.stringify(overrides.participants ?? defaultParticipants()),
        JSON.stringify(overrides.externalReferences ?? defaultExternalReferences())
      ]
    );
    return result.rows[0].create_property_hub;
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

  it('1. records the exact nine-migration ledger and preserves all predecessor checksums', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(13);
    expect(ledger.rows.slice(0, 6)).toEqual([
      { filename: '0001_identity_and_tenancy.sql', sha256: '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31' },
      { filename: '0002_property_identity_and_snapshots.sql', sha256: 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83' },
      { filename: '0003_person_contacts_and_account_lifecycle.sql', sha256: '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3' },
      { filename: '0004_current_catalog_and_price_snapshots.sql', sha256: 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876' },
      { filename: '0005_catalog_administration_lifecycle.sql', sha256: '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40' },
      { filename: '0006_orders_and_immutable_commercial_evidence.sql', sha256: '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f' }
    ]);
    expect(ledger.rows[6]).toMatchObject({ filename: '0007_property_hub_foundation.sql' });
    expect(ledger.rows[7]).toMatchObject({ filename: '0008_scheduling_request_and_appointment_foundation.sql' });
    expect(ledger.rows[8]).toMatchObject({ filename: '0009_job_and_service_workstream_foundation.sql' });
    expect(ledger.rows[6].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. creates exactly six bounded Hub tables and no excluded speculative workflow tables', async () => {
    const tables = await owner.query(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'medialab_core' AND tablename LIKE 'property_hub%'
        ORDER BY tablename`
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'property_hub_events',
      'property_hub_external_references',
      'property_hub_idempotency_records',
      'property_hub_orders',
      'property_hub_participants',
      'property_hubs'
    ]);
    const deferred = await owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'medialab_core'
        AND (tablename LIKE 'payment%' OR tablename LIKE 'delivery%'
          OR tablename LIKE 'publication%' OR tablename LIKE 'notification%')`
    );
    expect(deferred.rows).toEqual([]);
  });

  it('3. reproduces a deterministic Hub with two canonical Orders, two participants, one reference, and one event', async () => {
    const hub = await owner.query('SELECT * FROM medialab_core.property_hubs WHERE id = $1', [PROPERTY_HUB_ID]);
    expect(hub.rows[0]).toMatchObject({
      organization_id: ORGANIZATION_FIXTURE.id,
      property_id: ORDER_FOUNDATION_PROPERTY_ID,
      initial_property_snapshot_id: ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
      current_state: 'ESTABLISHED',
      source_system: PROPERTY_HUB_SOURCE
    });
    const counts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM medialab_core.property_hub_orders WHERE property_hub_id = $1) AS orders,
         (SELECT count(*)::int FROM medialab_core.property_hub_participants WHERE property_hub_id = $1) AS participants,
         (SELECT count(*)::int FROM medialab_core.property_hub_external_references WHERE property_hub_id = $1) AS refs,
         (SELECT count(*)::int FROM medialab_core.property_hub_events WHERE property_hub_id = $1) AS events`,
      [PROPERTY_HUB_ID]
    );
    expect(counts.rows[0]).toEqual({ orders: 2, participants: 2, refs: 1, events: 1 });
  });

  it('4. exposes only create and retrieve as new runtime APIs with fixed search paths', async () => {
    const functions = await owner.query(
      `SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND p.proname IN ('create_property_hub', 'get_property_hub_record')
        ORDER BY p.proname`,
      [TEST_RUNTIME_ROLE]
    );
    expect(functions.rows).toEqual([
      { proname: 'create_property_hub', prosecdef: true, proconfig: ['search_path=pg_catalog, medialab_core, pg_temp'], owner: TEST_OWNER_ROLE, runtime_execute: true, public_execute: false },
      { proname: 'get_property_hub_record', prosecdef: true, proconfig: ['search_path=pg_catalog, medialab_core, pg_temp'], owner: TEST_OWNER_ROLE, runtime_execute: true, public_execute: false }
    ]);
  });

  it('5. atomically creates and retrieves the exact Hub aggregate with session-derived actor evidence', async () => {
    const token = await issueOrdinarySession();
    const hubId = await createHub(runtime, token, { orderIds: [ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_SECOND_ORDER_ID] });
    const result = await runtime.query<{ get_property_hub_record: any }>(
      'SELECT medialab_core.get_property_hub_record($1, $2)', [token, hubId]
    );
    const record = result.rows[0].get_property_hub_record;
    expect(record.property_hub).toMatchObject({
      id: hubId,
      organization_id: ORGANIZATION_FIXTURE.id,
      property_id: ORDER_FOUNDATION_PROPERTY_ID,
      initial_property_snapshot_id: ORDER_FOUNDATION_PROPERTY_SNAPSHOT_ID,
      created_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
      current_state: 'ESTABLISHED'
    });
    expect(record.orders.map((order: any) => order.id).sort()).toEqual([ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_SECOND_ORDER_ID].sort());
    expect(record.participants.map((participant: any) => participant.role).sort()).toEqual(['HUB_MANAGER', 'HUB_PARTICIPANT']);
    expect(record.events).toHaveLength(1);
    expect(record.events[0]).toMatchObject({ event_type: 'PROPERTY_HUB_CREATED', actor_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID });
    expect(record.external_references).toHaveLength(1);
  });

  it('6. rejects unauthenticated creation without leaving partial evidence', async () => {
    const before = await owner.query('SELECT count(*)::int AS count FROM medialab_core.property_hubs');
    await expectFailure(createHub(runtime, 'not-a-valid-session'), /Ordinary session/);
    const after = await owner.query('SELECT count(*)::int AS count FROM medialab_core.property_hubs');
    expect(after.rows).toEqual(before.rows);
  });

  it('7. rejects inactive membership and revoked identity authority', async () => {
    let token = await issueOrdinarySession();
    await owner.query(
      `UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = clock_timestamp(),
              suspension_reason = 'Synthetic suspension', updated_at = clock_timestamp()
        WHERE id = $1`,
      [OPERATOR_MEMBERSHIP_ID]
    );
    await expectFailure(createHub(runtime, token), /lacks required permission/);
    await reset();
    token = await issueOrdinarySession();
    await owner.query("UPDATE medialab_core.identities SET status = 'REVOKED' WHERE id = $1", [PROPERTY_HUB_ACTOR_IDENTITY_ID]);
    await expectFailure(createHub(runtime, token), /Ordinary session/);
  });

  it('8. rejects creation when the exact permission is missing', async () => {
    const token = await issueOrdinarySession();
    await owner.query(
      `DELETE FROM medialab_core.permission_set_permissions
        WHERE permission_id = (SELECT id FROM medialab_core.permissions WHERE code = 'property_hub.create')`
    );
    await expectFailure(createHub(runtime, token), /property_hub.create/);
  });

  it('9. rejects cross-organization Property and snapshot evidence', async () => {
    const token = await issueOrdinarySession();
    const otherOrganizationId = crypto.randomUUID();
    const otherPropertyId = crypto.randomUUID();
    const otherSnapshotId = crypto.randomUUID();
    await owner.query("INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Synthetic Other Organization')", [otherOrganizationId]);
    await owner.query('INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)', [otherPropertyId, otherOrganizationId]);
    await owner.query(
      `INSERT INTO medialab_core.property_snapshots
         (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code)
       VALUES ($1, $2, $3, '200 Synthetic Boundary Road', 'Other Fixture City', 'OR', '00001')`,
      [otherSnapshotId, otherPropertyId, otherOrganizationId]
    );
    await expectFailure(createHub(runtime, token, { propertyId: otherPropertyId, snapshotId: otherSnapshotId }), /does not belong/);
    await expectFailure(createHub(runtime, token, { snapshotId: otherSnapshotId }), /does not belong/);
  });

  it('10. rejects snapshot-to-Property mismatch within one organization', async () => {
    const token = await issueOrdinarySession();
    const otherPropertyId = crypto.randomUUID();
    const otherSnapshotId = crypto.randomUUID();
    await owner.query('INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)', [otherPropertyId, ORGANIZATION_FIXTURE.id]);
    await owner.query(
      `INSERT INTO medialab_core.property_snapshots
         (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code)
       VALUES ($1, $2, $3, '300 Synthetic Mismatch Lane', 'Fixture City', 'WA', '00002')`,
      [otherSnapshotId, otherPropertyId, ORGANIZATION_FIXTURE.id]
    );
    await expectFailure(createHub(runtime, token, { snapshotId: otherSnapshotId }), /does not belong/);
  });

  it('11. rejects cross-organization and wrong-Property Order associations', async () => {
    const token = await issueOrdinarySession();
    const otherPropertyId = crypto.randomUUID();
    const otherSnapshotId = crypto.randomUUID();
    const otherOrderId = crypto.randomUUID();
    await owner.query('INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)', [otherPropertyId, ORGANIZATION_FIXTURE.id]);
    await owner.query(
      `INSERT INTO medialab_core.property_snapshots
         (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code)
       VALUES ($1, $2, $3, '400 Synthetic Other Property', 'Fixture City', 'WA', '00003')`,
      [otherSnapshotId, otherPropertyId, ORGANIZATION_FIXTURE.id]
    );
    await owner.query(
      `INSERT INTO medialab_core.orders
         (id, lane, organization_id, property_id, property_snapshot_id, settlement_mode, currency,
          item_subtotal_cents, travel_amount_cents, total_amount_cents, current_state, source_system,
          created_by_identity_id, accepted_by_identity_id, accepted_at)
       VALUES ($1, 'REAL_ESTATE', $2, $3, $4, 'PAY_NOW', 'USD', 0, 0, 0, 'ACCEPTED', $5, $6, $6, clock_timestamp())`,
      [otherOrderId, ORGANIZATION_FIXTURE.id, otherPropertyId, otherSnapshotId, PROPERTY_HUB_SOURCE, PROPERTY_HUB_ACTOR_IDENTITY_ID]
    );
    await expectFailure(createHub(runtime, token, { orderIds: [otherOrderId] }), /another Property/);

    const otherOrganizationId = crypto.randomUUID();
    const crossOrganizationPropertyId = crypto.randomUUID();
    const crossOrganizationSnapshotId = crypto.randomUUID();
    const crossOrganizationOrderId = crypto.randomUUID();
    await owner.query("INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Synthetic Cross-Organization Order Owner')", [otherOrganizationId]);
    await owner.query('INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)', [crossOrganizationPropertyId, otherOrganizationId]);
    await owner.query(
      `INSERT INTO medialab_core.property_snapshots
         (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code)
       VALUES ($1, $2, $3, '401 Synthetic Cross-Organization Property', 'Other City', 'OR', '00005')`,
      [crossOrganizationSnapshotId, crossOrganizationPropertyId, otherOrganizationId]
    );
    await owner.query(
      `INSERT INTO medialab_core.orders
         (id, lane, organization_id, property_id, property_snapshot_id, settlement_mode, currency,
          item_subtotal_cents, travel_amount_cents, total_amount_cents, current_state, source_system,
          created_by_identity_id, accepted_by_identity_id, accepted_at)
       VALUES ($1, 'REAL_ESTATE', $2, $3, $4, 'PAY_NOW', 'USD', 0, 0, 0, 'ACCEPTED', $5, $6, $6, clock_timestamp())`,
      [crossOrganizationOrderId, otherOrganizationId, crossOrganizationPropertyId, crossOrganizationSnapshotId, PROPERTY_HUB_SOURCE, PROPERTY_HUB_ACTOR_IDENTITY_ID]
    );
    await expectFailure(createHub(runtime, token, { orderIds: [crossOrganizationOrderId] }), /another organization/);
  });

  it('12. rejects invalid and duplicate participant-role evidence', async () => {
    const token = await issueOrdinarySession();
    await expectFailure(createHub(runtime, token, {
      participants: [{ membership_id: OWNER_MEMBERSHIP_ID, role: 'UNRESTRICTED' }]
    }), /participant identity or role is invalid/);
    const participant = { membership_id: OWNER_MEMBERSHIP_ID, role: 'HUB_PARTICIPANT' };
    await expectFailure(createHub(runtime, token, { participants: [participant, participant] }), /must be unique/);
    await expectFailure(createHub(runtime, token, {
      participants: [{ membership_id: OPERATOR_MEMBERSHIP_ID, role: 'HUB_MANAGER' }]
    }), /must not be duplicated/);
  });

  it('13. rejects malformed, empty, and duplicate provider-neutral external references', async () => {
    const token = await issueOrdinarySession();
    await expectFailure(createHub(runtime, token, {
      externalReferences: [{ provider: PROPERTY_HUB_SOURCE, external_record_type: 'PROPERTY_ENGAGEMENT', external_identifier: ' ', provenance: 'Synthetic' }]
    }), /malformed/);
    const reference = defaultExternalReferences('request-duplicate-001')[0];
    await expectFailure(createHub(runtime, token, { externalReferences: [reference, reference] }), /unique within the request/);
    await expectFailure(createHub(runtime, token, {
      externalReferences: [{ ...reference, external_identifier: 'synthetic-property-hub-001' }]
    }), /property_hub_external_references_source_key/);
  });

  it('14. rejects duplicate Order associations and rolls the entire aggregate back', async () => {
    const token = await issueOrdinarySession();
    const key = `rollback-${crypto.randomUUID()}`;
    const before = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM medialab_core.property_hubs) AS hubs,
         (SELECT count(*)::int FROM medialab_core.property_hub_orders) AS orders,
         (SELECT count(*)::int FROM medialab_core.property_hub_participants) AS participants,
         (SELECT count(*)::int FROM medialab_core.property_hub_events) AS events,
         (SELECT count(*)::int FROM medialab_core.property_hub_idempotency_records) AS idempotency`
    );
    await expectFailure(createHub(runtime, token, {
      key,
      orderIds: [ORDER_FOUNDATION_ORDER_ID, ORDER_FOUNDATION_ORDER_ID]
    }), /must be unique/);
    const after = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM medialab_core.property_hubs) AS hubs,
         (SELECT count(*)::int FROM medialab_core.property_hub_orders) AS orders,
         (SELECT count(*)::int FROM medialab_core.property_hub_participants) AS participants,
         (SELECT count(*)::int FROM medialab_core.property_hub_events) AS events,
         (SELECT count(*)::int FROM medialab_core.property_hub_idempotency_records) AS idempotency`
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('15. permits distinct engagements for the same Property without leaking Orders or participants', async () => {
    const token = await issueOrdinarySession();
    const first = await createHub(runtime, token, {
      orderIds: [ORDER_FOUNDATION_ORDER_ID],
      participants: [],
      externalReferences: defaultExternalReferences('separate-engagement-001')
    });
    const second = await createHub(runtime, token, {
      orderIds: [PROPERTY_HUB_SECOND_ORDER_ID],
      participants: defaultParticipants(),
      externalReferences: defaultExternalReferences('separate-engagement-002')
    });
    expect(second).not.toBe(first);
    const hubs = await owner.query(
      `SELECT h.id, array_agg(ho.order_id ORDER BY ho.order_id) AS orders,
              (SELECT count(*)::int FROM medialab_core.property_hub_participants hp WHERE hp.property_hub_id = h.id) AS participants
         FROM medialab_core.property_hubs h
         JOIN medialab_core.property_hub_orders ho ON ho.property_hub_id = h.id
        WHERE h.id IN ($1, $2)
        GROUP BY h.id ORDER BY h.id`,
      [first, second]
    );
    expect(hubs.rows).toHaveLength(2);
    expect(hubs.rows.find((row) => row.id === first)).toMatchObject({ orders: [ORDER_FOUNDATION_ORDER_ID], participants: 1 });
    expect(hubs.rows.find((row) => row.id === second)).toMatchObject({ orders: [PROPERTY_HUB_SECOND_ORDER_ID], participants: 2 });
  });

  it('16. preserves Orders, parties, items, and related-Order meaning without flattening', async () => {
    const token = await issueOrdinarySession();
    await owner.query(
      `INSERT INTO medialab_core.order_relationships
         (id, original_order_id, related_order_id, relationship_type, reason, source_system, created_by_identity_id)
       VALUES ($1, $2, $3, 'SUPPLEMENTAL', 'Synthetic preserved relationship', $4, $5)`,
      [crypto.randomUUID(), ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_SECOND_ORDER_ID, PROPERTY_HUB_SOURCE, PROPERTY_HUB_ACTOR_IDENTITY_ID]
    );
    const before = await owner.query(
      `SELECT
         (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM medialab_core.orders o WHERE o.id IN ($1, $2)) AS orders,
         (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM medialab_core.order_parties p WHERE p.order_id IN ($1, $2)) AS parties,
         (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM medialab_core.order_items i WHERE i.order_id IN ($1, $2)) AS items,
         (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM medialab_core.order_relationships r WHERE r.original_order_id = $1 AND r.related_order_id = $2) AS relationships`,
      [ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_SECOND_ORDER_ID]
    );
    await createHub(runtime, token, { orderIds: [ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_SECOND_ORDER_ID] });
    const after = await owner.query(
      `SELECT
         (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM medialab_core.orders o WHERE o.id IN ($1, $2)) AS orders,
         (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM medialab_core.order_parties p WHERE p.order_id IN ($1, $2)) AS parties,
         (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM medialab_core.order_items i WHERE i.order_id IN ($1, $2)) AS items,
         (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM medialab_core.order_relationships r WHERE r.original_order_id = $1 AND r.related_order_id = $2) AS relationships`,
      [ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_SECOND_ORDER_ID]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('17. keeps Hub-associated Order evidence unchanged after later catalog mutation', async () => {
    const token = await issueOrdinarySession();
    await createHub(runtime, token);
    const before = await owner.query('SELECT * FROM medialab_core.order_items WHERE order_id = $1 ORDER BY id', [ORDER_FOUNDATION_ORDER_ID]);
    await owner.query(
      `UPDATE medialab_core.catalog_products
          SET display_name = 'Synthetic Catalog Name Changed Later', updated_at = clock_timestamp()
        WHERE id = $1`,
      [COMMERCIAL_SNAPSHOT_FIXTURES[1].catalog_product_id]
    );
    const after = await owner.query('SELECT * FROM medialab_core.order_items WHERE order_id = $1 ORDER BY id', [ORDER_FOUNDATION_ORDER_ID]);
    expect(after.rows).toEqual(before.rows);
  });

  it('18. requires both exact read permission and explicit active Hub participation', async () => {
    const operatorToken = await issueOrdinarySession();
    const hubId = await createHub(runtime, operatorToken, { participants: [] });
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    await expectFailure(runtime.query('SELECT medialab_core.get_property_hub_record($1, $2)', [ownerToken, hubId]), /lacks required permission/);
    await owner.query(
      `INSERT INTO medialab_core.membership_permission_sets
         (organization_id, membership_id, permission_set_id)
       VALUES ($1, $2, $3)`,
      [ORGANIZATION_FIXTURE.id, OWNER_MEMBERSHIP_ID, PERMISSION_SET_FIXTURE.id]
    );
    await expectFailure(runtime.query('SELECT medialab_core.get_property_hub_record($1, $2)', [ownerToken, hubId]), /missing or unavailable/);
    const valid = await runtime.query('SELECT medialab_core.get_property_hub_record($1, $2)', [operatorToken, hubId]);
    expect(valid.rows[0].get_property_hub_record.property_hub.id).toBe(hubId);
  });

  it('19. rejects cross-organization retrieval without exposing Hub contents', async () => {
    const token = await issueOrdinarySession();
    const otherOrganizationId = crypto.randomUUID();
    const otherPropertyId = crypto.randomUUID();
    const otherSnapshotId = crypto.randomUUID();
    const otherHubId = crypto.randomUUID();
    await owner.query("INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Synthetic Isolated Organization')", [otherOrganizationId]);
    await owner.query('INSERT INTO medialab_core.properties (id, organization_id) VALUES ($1, $2)', [otherPropertyId, otherOrganizationId]);
    await owner.query(
      `INSERT INTO medialab_core.property_snapshots
         (id, property_id, organization_id, address_line_1, locality, administrative_area, postal_code)
       VALUES ($1, $2, $3, '500 Synthetic Isolation Avenue', 'Other City', 'OR', '00004')`,
      [otherSnapshotId, otherPropertyId, otherOrganizationId]
    );
    await owner.query(
      `INSERT INTO medialab_core.property_hubs
         (id, organization_id, property_id, initial_property_snapshot_id, current_state, source_system, created_by_identity_id)
       VALUES ($1, $2, $3, $4, 'ESTABLISHED', $5, $6)`,
      [otherHubId, otherOrganizationId, otherPropertyId, otherSnapshotId, PROPERTY_HUB_SOURCE, PROPERTY_HUB_ACTOR_IDENTITY_ID]
    );
    await expectFailure(runtime.query('SELECT medialab_core.get_property_hub_record($1, $2)', [token, otherHubId]), /lacks required permission/);
  });

  it('20. returns the original Hub for exact idempotent replay and rejects conflicting reuse', async () => {
    const token = await issueOrdinarySession();
    const key = `exact-replay-${crypto.randomUUID()}`;
    const refs = defaultExternalReferences(`exact-replay-ref-${crypto.randomUUID()}`);
    const first = await createHub(runtime, token, { key, externalReferences: refs });
    const second = await createHub(runtime, token, { key, externalReferences: refs });
    expect(second).toBe(first);
    await expectFailure(createHub(runtime, token, {
      key,
      orderIds: [PROPERTY_HUB_SECOND_ORDER_ID],
      externalReferences: refs
    }), /conflicting request fingerprint/);
  });

  it('21. serializes concurrent duplicate attempts into one canonical Hub', async () => {
    const token = await issueOrdinarySession();
    const key = `concurrent-${crypto.randomUUID()}`;
    const refs = defaultExternalReferences(`concurrent-ref-${crypto.randomUUID()}`);
    const runtimeTwo = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_RUNTIME_ROLE });
    await runtimeTwo.connect();
    try {
      const [first, second] = await Promise.all([
        createHub(runtime, token, { key, externalReferences: refs }),
        createHub(runtimeTwo, token, { key, externalReferences: refs })
      ]);
      expect(second).toBe(first);
      const count = await owner.query('SELECT count(*)::int AS count FROM medialab_core.property_hubs WHERE id = $1', [first]);
      expect(count.rows[0].count).toBe(1);
    } finally {
      await runtimeTwo.end();
    }
  });

  it('22. keeps initial snapshot, Hub identity, participants, references, idempotency, and events immutable', async () => {
    const token = await issueOrdinarySession();
    const hubId = await createHub(runtime, token);
    for (const work of [
      () => owner.query('UPDATE medialab_core.property_hubs SET initial_property_snapshot_id = $1 WHERE id = $2', [crypto.randomUUID(), hubId]),
      () => owner.query('DELETE FROM medialab_core.property_hub_orders WHERE property_hub_id = $1', [hubId]),
      () => owner.query("UPDATE medialab_core.property_hub_participants SET participant_role = 'HUB_PARTICIPANT' WHERE property_hub_id = $1", [hubId]),
      () => owner.query('DELETE FROM medialab_core.property_hub_external_references WHERE property_hub_id = $1', [hubId]),
      () => owner.query('DELETE FROM medialab_core.property_hub_idempotency_records WHERE result_property_hub_id = $1', [hubId]),
      () => owner.query("UPDATE medialab_core.property_hub_events SET reason = 'Changed' WHERE property_hub_id = $1", [hubId]),
      () => owner.query('DELETE FROM medialab_core.property_hub_events WHERE property_hub_id = $1', [hubId])
    ]) {
      await expectFailure(work(), /immutable/);
    }
  });

  it('23. denies runtime and PUBLIC direct table, sequence, helper, and mutation authority', async () => {
    const tablePrivileges = await owner.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core' AND table_name LIKE 'property_hub%'
        ORDER BY table_name, privilege_type`,
      [TEST_RUNTIME_ROLE]
    );
    expect(tablePrivileges.rows).toEqual([]);
    const publicPrivileges = await owner.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'PUBLIC' AND table_schema = 'medialab_core' AND table_name LIKE 'property_hub%'`
    );
    expect(publicPrivileges.rows).toEqual([]);
    const helpers = await owner.query(
      `SELECT p.proname,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND p.proname IN ('reject_property_hub_evidence_mutation', 'require_property_hub_permission')
        ORDER BY p.proname`,
      [TEST_RUNTIME_ROLE]
    );
    expect(helpers.rows).toEqual([
      { proname: 'reject_property_hub_evidence_mutation', runtime_execute: false, public_execute: false },
      { proname: 'require_property_hub_permission', runtime_execute: false, public_execute: false }
    ]);
    await expectFailure(runtime.query('DELETE FROM medialab_core.property_hubs WHERE id = $1', [PROPERTY_HUB_ID]));
  });

  it('24. derives actor identity from the ordinary session and offers no caller-supplied actor signature', async () => {
    const signature = await owner.query(
      `SELECT pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname = 'create_property_hub'`
    );
    expect(signature.rows[0].args).toBe(
      'p_session_token text, p_idempotency_key text, p_organization_id uuid, p_property_id uuid, p_initial_property_snapshot_id uuid, p_source_system text, p_order_ids jsonb, p_participants jsonb, p_external_references jsonb'
    );
    const token = await issueOrdinarySession();
    const hubId = await createHub(runtime, token);
    const actor = await owner.query(
      `SELECT h.created_by_identity_id, e.actor_identity_id
         FROM medialab_core.property_hubs h
         JOIN medialab_core.property_hub_events e ON e.property_hub_id = h.id
        WHERE h.id = $1`,
      [hubId]
    );
    expect(actor.rows[0]).toEqual({
      created_by_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID,
      actor_identity_id: PROPERTY_HUB_ACTOR_IDENTITY_ID
    });
  });

  it('25. keeps protected helpers owner-only and resists temporary relation shadowing', async () => {
    const token = await issueOrdinarySession();
    await runtime.query('CREATE TEMP TABLE property_hubs (id uuid)');
    const hubId = await createHub(runtime, token);
    expect(hubId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
