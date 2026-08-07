import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { runSeed } from '../db/seed.js';
import {
  CATALOG_ACTOR_IDENTITY_ID,
  CATALOG_BRACKET_FIXTURES,
  CATALOG_EXPECTED_ROW_COUNTS,
  CATALOG_EXTERNAL_MAPPING_FIXTURES,
  CATALOG_PACKAGE_ITEM_FIXTURES,
  CATALOG_PACKAGE_VERSION_FIXTURES,
  CATALOG_PRICE_FIXTURES,
  CATALOG_PRODUCT_FIXTURES,
  COMMERCIAL_SNAPSHOT_FIXTURES,
  CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURES,
  SYNTHETIC_SOURCE_SYSTEM
} from '../db/fixtures/current-catalog-price-fixtures.js';
import { CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS } from '../db/fixtures/current-real-estate-catalog-seed.js';
import {
  ORDER_FOUNDATION_ROW_COUNT_INCREMENTS,
  ORDER_FOUNDATION_SOURCE
} from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/property-hub-foundation-fixtures.js';
import { SCHEDULING_APPOINTMENT_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/scheduling-appointment-foundation-fixtures.js';
import { JOB_SERVICE_WORKSTREAM_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/job-service-workstream-foundation-fixtures.js';
import { MISSION_PLAN_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/mission-plan-foundation-fixtures.js';
import { MEDIA_ASSET_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/media-asset-identity-lineage-fixtures.js';
import { MEDIA_OPERATION_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/durable-media-operations-reconciliation-fixtures.js';
import { MEDIA_CAPTURE_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/capture-session-ingest-custody-fixtures.js';
import { MEDIA_CULL_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/media-cull-workspace-selected-media-fixtures.js';
import { MEDIA_EDITOR_HANDOFF_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/editor-handoff-returned-media-fixtures.js';
import { MEDIA_RETURN_REVIEW_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/returned-editor-review-final-source-fixtures.js';

const TEST_DB = 'medialab_p02m13a_test';
const TEST_OWNER_ROLE = 'medialab_p02m13a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m13a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m13a-pg';
const TEST_PORT = 55443;

const OWNER_PERSON_ID = '034a2b54-4665-5917-90a6-ae40adb3c8aa';
const OWNER_IDENTITY_ID = 'e69ced56-a63e-57bf-a6b5-26d5fe6cc5c5';
const OPERATOR_PERSON_ID = 'd43d9499-efbd-5116-b561-67dd34d1df8d';
const OPERATOR_IDENTITY_ID = '87c0043a-334f-548c-95d7-d53939ab054b';

const CATALOG_APIS = [
  'create_catalog_commercial_snapshot',
  'create_catalog_product',
  'create_custom_commercial_snapshot',
  'get_current_catalog_package_inclusions',
  'get_current_selectable_catalog',
  'record_catalog_external_mapping',
  'record_catalog_price',
  'replace_catalog_bracket_set',
  'replace_catalog_package_composition',
  'revise_catalog_product'
];

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('P02-M03-A current catalog and immutable commercial evidence', () => {
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

  async function issueOrdinarySession(identityId: string): Promise<string> {
    const token = randomToken();
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute',
               clock_timestamp() + interval '1 hour', NULL)`,
      [crypto.randomUUID(), identityId, tokenDigest(token)]
    );
    return token;
  }

  async function issueRecoverySession(identityId: string): Promise<string> {
    const token = randomToken();
    await owner.query(
      `INSERT INTO medialab_core.account_recovery_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, external_authentication_reference)
       VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute',
               clock_timestamp() + interval '15 minutes', $4)`,
      [crypto.randomUUID(), identityId, tokenDigest(token), `synthetic-test:${crypto.randomUUID()}`]
    );
    return token;
  }

  async function expectDbError(
    client: pg.Client,
    sql: string,
    values: unknown[] = [],
    expected?: RegExp
  ): Promise<void> {
    try {
      await client.query(sql, values);
      throw new Error('Expected PostgreSQL statement to fail');
    } catch (error: any) {
      if (error.message === 'Expected PostgreSQL statement to fail') throw error;
      if (expected) expect(error.message).toMatch(expected);
    }
  }

  async function inOwnerTransaction(work: () => Promise<void>): Promise<void> {
    await owner.query('BEGIN');
    try {
      await work();
    } finally {
      await owner.query('ROLLBACK');
    }
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_OWNER_ROLE
    });
    runtime = new pg.Client({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_RUNTIME_ROLE
    });
    await owner.connect();
    await runtime.connect();
  });

  afterAll(async () => {
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    await reset();
  });

  it('1. preserves the exact nine-row migration ledger and predecessor checksums', async () => {
    const ledger = await owner.query(
      'SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename'
    );
    expect(ledger.rows).toHaveLength(16);
    expect(ledger.rows.slice(0, 3)).toEqual([
      { filename: '0001_identity_and_tenancy.sql', sha256: '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31' },
      { filename: '0002_property_identity_and_snapshots.sql', sha256: 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83' },
      { filename: '0003_person_contacts_and_account_lifecycle.sql', sha256: '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3' }
    ]);
    expect(ledger.rows[3].filename).toBe('0004_current_catalog_and_price_snapshots.sql');
    expect(ledger.rows[3].sha256).toBe('e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876');
    expect(ledger.rows[4].filename).toBe('0005_catalog_administration_lifecycle.sql');
    expect(ledger.rows[4].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.rows[5].filename).toBe('0006_orders_and_immutable_commercial_evidence.sql');
    expect(ledger.rows[5].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.rows[6].filename).toBe('0007_property_hub_foundation.sql');
    expect(ledger.rows[6].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.rows[7].filename).toBe('0008_scheduling_request_and_appointment_foundation.sql');
    expect(ledger.rows[7].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledger.rows[8].filename).toBe('0009_job_and_service_workstream_foundation.sql');
    expect(ledger.rows[8].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. preserves the exact synthetic packet evidence alongside the canonical catalog', async () => {
    for (const [table, expected] of Object.entries(CATALOG_EXPECTED_ROW_COUNTS)) {
      const count = await owner.query(`SELECT count(*)::int AS count FROM medialab_core.${table}`);
      expect(count.rows[0].count, table).toBe(
        expected +
        (CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS[table as keyof typeof CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS] ?? 0) +
        (ORDER_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof ORDER_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (SCHEDULING_APPOINTMENT_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof SCHEDULING_APPOINTMENT_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (JOB_SERVICE_WORKSTREAM_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof JOB_SERVICE_WORKSTREAM_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (MISSION_PLAN_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof MISSION_PLAN_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (MEDIA_ASSET_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof MEDIA_ASSET_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (MEDIA_OPERATION_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof MEDIA_OPERATION_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (MEDIA_CAPTURE_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof MEDIA_CAPTURE_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (MEDIA_CULL_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof MEDIA_CULL_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (MEDIA_EDITOR_HANDOFF_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof MEDIA_EDITOR_HANDOFF_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0) +
        (MEDIA_RETURN_REVIEW_FOUNDATION_ROW_COUNT_INCREMENTS[table as keyof typeof MEDIA_RETURN_REVIEW_FOUNDATION_ROW_COUNT_INCREMENTS] ?? 0)
      );
    }
    const sources = await owner.query(
      `SELECT DISTINCT source_system FROM (
         SELECT source_system FROM medialab_core.catalog_products
         UNION ALL SELECT source_system FROM medialab_core.commercial_snapshots
         UNION ALL SELECT source_system FROM medialab_core.custom_commercial_snapshots
       ) evidence ORDER BY source_system`
    );
    expect(sources.rows).toEqual([
      { source_system: 'PUBLIC_WEBSITE' },
      { source_system: SYNTHETIC_SOURCE_SYSTEM },
      { source_system: ORDER_FOUNDATION_SOURCE }
    ]);
  });

  it('3. excludes all synthetic packet products from the current selectable projection', async () => {
    const result = await runtime.query(
      `SELECT product_code, product_kind, amount_cents, bracket_code
         FROM medialab_core.get_current_selectable_catalog($1)
        ORDER BY product_code, amount_cents`,
      ['2026-03-28T12:00:00.000Z']
    );
    expect(result.rows).toEqual([]);
  });

  it('4. preserves synthetic package inclusion evidence without exposing it through current catalog reads', async () => {
    const inclusions = await owner.query(
      `SELECT package_version_id, included_product_id, quantity, position
         FROM medialab_core.catalog_package_version_items
        WHERE id = $1`,
      [CATALOG_PACKAGE_ITEM_FIXTURES[0].id]
    );
    expect(inclusions.rows).toEqual([{
      package_version_id: CATALOG_PACKAGE_VERSION_FIXTURES[0].id,
      included_product_id: CATALOG_PRODUCT_FIXTURES[1].id,
      quantity: '1.000',
      position: 1
    }]);
  });

  it('5. chooses deterministic adjacent brackets at 1999, 2000, and 4000', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const cases = [
      [1999, 'SYNTH_SF_0000_1999', '30000'],
      [2000, 'SYNTH_SF_2000_3999', '40000'],
      [4000, 'SYNTH_SF_4000_PLUS', '50000']
    ] as const;
    for (const [basis, expectedBracket, expectedAmount] of cases) {
      const id = crypto.randomUUID();
      await runtime.query(
        `SELECT medialab_core.create_catalog_commercial_snapshot(
           $1, $2, $3, 1, $4, 0, NULL, 0, NULL, $5,
           $6, 'SYNTHETIC_TEST', $7, 0, NULL)`,
        [token, id, CATALOG_PRODUCT_FIXTURES[0].id, basis, '2026-03-28T12:00:00.000Z', SYNTHETIC_SOURCE_SYSTEM, `boundary-${basis}`]
      );
      const snapshot = await owner.query(
        'SELECT bracket_code, unit_price_cents FROM medialab_core.commercial_snapshots WHERE id = $1',
        [id]
      );
      expect(snapshot.rows[0]).toEqual({ bracket_code: expectedBracket, unit_price_cents: expectedAmount });
    }
  });

  it('6. rejects bracket gaps without leaving partial bracket evidence', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const id = crypto.randomUUID();
    await expectDbError(
      runtime,
      `SELECT medialab_core.replace_catalog_bracket_set($1, $2, $3, 'SQUARE_FEET',
         clock_timestamp(), $4, $5::jsonb)`,
      [token, id, CATALOG_PRODUCT_FIXTURES[0].id, SYNTHETIC_SOURCE_SYSTEM, JSON.stringify([
        { id: crypto.randomUUID(), code: 'GAP_A', lower_bound: 0, upper_bound: 1000, lower_inclusive: true, upper_inclusive: false, amount_cents: 1, currency: 'USD' },
        { id: crypto.randomUUID(), code: 'GAP_B', lower_bound: 1001, upper_bound: null, lower_inclusive: true, upper_inclusive: false, amount_cents: 2, currency: 'USD' }
      ])],
      /gap or overlap/
    );
    const residue = await owner.query('SELECT count(*)::int AS count FROM medialab_core.catalog_bracket_sets WHERE id = $1', [id]);
    expect(residue.rows[0].count).toBe(0);
  });

  it('7. rejects bracket overlaps and ambiguous inclusive ties', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await expectDbError(
      runtime,
      `SELECT medialab_core.replace_catalog_bracket_set($1, $2, $3, 'SQUARE_FEET',
         clock_timestamp(), $4, $5::jsonb)`,
      [token, crypto.randomUUID(), CATALOG_PRODUCT_FIXTURES[0].id, SYNTHETIC_SOURCE_SYSTEM, JSON.stringify([
        { id: crypto.randomUUID(), code: 'OVERLAP_A', lower_bound: 0, upper_bound: 1000, lower_inclusive: true, upper_inclusive: true, amount_cents: 1, currency: 'USD' },
        { id: crypto.randomUUID(), code: 'OVERLAP_B', lower_bound: 1000, upper_bound: null, lower_inclusive: true, upper_inclusive: false, amount_cents: 2, currency: 'USD' }
      ])],
      /gap or overlap/
    );
  });

  it('8. selects effective prices deterministically and preserves the earlier price snapshot', async () => {
    const before = await owner.query(
      `SELECT amount_cents FROM medialab_core.catalog_prices
        WHERE product_id = $1 AND effective_at <= $2
        ORDER BY effective_at DESC, recorded_at DESC, id DESC LIMIT 1`,
      [CATALOG_PRODUCT_FIXTURES[2].id, '2026-03-28T12:00:00.000Z']
    );
    const after = await owner.query(
      `SELECT amount_cents FROM medialab_core.catalog_prices
        WHERE product_id = $1 AND effective_at <= $2
        ORDER BY effective_at DESC, recorded_at DESC, id DESC LIMIT 1`,
      [CATALOG_PRODUCT_FIXTURES[2].id, '2026-04-02T12:00:00.000Z']
    );
    const snapshot = await owner.query(
      'SELECT unit_price_cents, catalog_price_id FROM medialab_core.commercial_snapshots WHERE id = $1',
      [COMMERCIAL_SNAPSHOT_FIXTURES[1].id]
    );
    expect(before.rows[0].amount_cents).toBe('15000');
    expect(after.rows[0].amount_cents).toBe('17500');
    expect(snapshot.rows[0]).toEqual({ unit_price_cents: '15000', catalog_price_id: CATALOG_PRICE_FIXTURES[1].id });
  });

  it('9. keeps snapshots unchanged after rename, repricing, retirement, and package restructuring', async () => {
    await inOwnerTransaction(async () => {
      const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
      const before = await owner.query('SELECT * FROM medialab_core.commercial_snapshots WHERE id = $1', [COMMERCIAL_SNAPSHOT_FIXTURES[0].id]);
      const itemsBefore = await owner.query('SELECT * FROM medialab_core.commercial_snapshot_package_items WHERE snapshot_id = $1', [COMMERCIAL_SNAPSHOT_FIXTURES[0].id]);

      await owner.query(
        `SELECT medialab_core.revise_catalog_product($1, $2, 'Synthetic Renamed Package', 'RETIRED', $3, $4)`,
        [token, CATALOG_PRODUCT_FIXTURES[0].id, 'Synthetic test retirement', SYNTHETIC_SOURCE_SYSTEM]
      );
      await owner.query(
        `SELECT medialab_core.record_catalog_price($1, $2, $3, 19999, 'USD', $4, $5, $6)`,
        [token, crypto.randomUUID(), CATALOG_PRODUCT_FIXTURES[2].id, '2026-05-01T00:00:00.000Z', SYNTHETIC_SOURCE_SYSTEM, 'synthetic-reprice-v3']
      );
      await owner.query(
        `SELECT medialab_core.replace_catalog_package_composition($1, $2, $3, $4, $5, $6::jsonb)`,
        [token, crypto.randomUUID(), CATALOG_PRODUCT_FIXTURES[0].id, '2026-05-01T00:00:00.000Z', SYNTHETIC_SOURCE_SYSTEM, JSON.stringify([
          { id: crypto.randomUUID(), product_id: CATALOG_PRODUCT_FIXTURES[2].id, quantity: 1 }
        ])]
      );

      const after = await owner.query('SELECT * FROM medialab_core.commercial_snapshots WHERE id = $1', [COMMERCIAL_SNAPSHOT_FIXTURES[0].id]);
      const itemsAfter = await owner.query('SELECT * FROM medialab_core.commercial_snapshot_package_items WHERE snapshot_id = $1', [COMMERCIAL_SNAPSHOT_FIXTURES[0].id]);
      expect(after.rows[0]).toEqual(before.rows[0]);
      expect(itemsAfter.rows).toEqual(itemsBefore.rows);
    });
  });

  it('10. rejects UPDATE and DELETE for all immutable snapshot evidence', async () => {
    await expectDbError(owner, 'UPDATE medialab_core.commercial_snapshots SET display_name = $1 WHERE id = $2', ['Changed', COMMERCIAL_SNAPSHOT_FIXTURES[0].id], /immutable/);
    await expectDbError(owner, 'DELETE FROM medialab_core.commercial_snapshots WHERE id = $1', [COMMERCIAL_SNAPSHOT_FIXTURES[0].id], /immutable/);
    await expectDbError(owner, 'UPDATE medialab_core.custom_commercial_snapshots SET description = $1 WHERE id = $2', ['Changed', CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURES[0].id], /immutable/);
    await expectDbError(owner, 'DELETE FROM medialab_core.custom_commercial_snapshots WHERE id = $1', [CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURES[0].id], /immutable/);
  });

  it('11. rejects destructive deletion of catalog identity and referenced evidence', async () => {
    await expectDbError(owner, 'DELETE FROM medialab_core.catalog_products WHERE id = $1', [CATALOG_PRODUCT_FIXTURES[2].id], /never-published/);
    await expectDbError(owner, 'DELETE FROM medialab_core.catalog_prices WHERE id = $1', [CATALOG_PRICE_FIXTURES[0].id], /immutable/);
    await expectDbError(owner, 'DELETE FROM medialab_core.catalog_package_versions WHERE id = $1', [CATALOG_PACKAGE_VERSION_FIXTURES[0].id], /immutable/);
  });

  it('12. preserves attributable adjustment, travel basis, and renewed-acceptance evidence', async () => {
    const evidence = await owner.query(
      `SELECT adjustment_amount_cents, adjustment_reason, adjustment_actor_identity_id,
              adjustment_at IS NOT NULL AS adjusted,
              travel_estimate_amount_cents, travel_estimate_basis,
              material_increase_amount_cents, renewed_acceptance_required,
              renewed_accepted_by_identity_id, renewed_accepted_at IS NOT NULL AS accepted
         FROM medialab_core.commercial_snapshots WHERE id = $1`,
      [COMMERCIAL_SNAPSHOT_FIXTURES[0].id]
    );
    expect(evidence.rows[0]).toEqual({
      adjustment_amount_cents: '2500',
      adjustment_reason: 'Synthetic attributable adjustment',
      adjustment_actor_identity_id: CATALOG_ACTOR_IDENTITY_ID,
      adjusted: true,
      travel_estimate_amount_cents: '3500',
      travel_estimate_basis: 'Synthetic manually approved travel estimate',
      material_increase_amount_cents: '2500',
      renewed_acceptance_required: true,
      renewed_accepted_by_identity_id: CATALOG_ACTOR_IDENTITY_ID,
      accepted: true
    });
  });

  it('13. physically separates custom evidence and rejects ordinary catalog promotion', async () => {
    const customId = CUSTOM_COMMERCIAL_SNAPSHOT_FIXTURES[0].id;
    const custom = await owner.query(
      `SELECT id, description, approved_price_cents, currency, quantity, reason,
              adjustment_amount_cents, adjustment_reason, adjustment_actor_identity_id,
              adjustment_at, created_by_identity_id, created_at
         FROM medialab_core.custom_commercial_snapshots WHERE id = $1`,
      [customId]
    );
    expect(custom.rows).toHaveLength(1);
    const catalog = await owner.query('SELECT count(*)::int AS count FROM medialab_core.catalog_products WHERE id = $1', [customId]);
    expect(catalog.rows[0].count).toBe(0);

    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_product($1, $2, 'SYNTH_CUSTOM_PROMOTION',
         'Synthetic Custom Promotion', 'SERVICE', 'SERVICE', 'SESSION', $3)`,
      [token, customId, SYNTHETIC_SOURCE_SYSTEM],
      /cannot be promoted/
    );
  });

  it('14. keeps provider mappings external to canonical MediaLab identity', async () => {
    const mapping = await owner.query(
      `SELECT provider, external_identifier, target_product_id
         FROM medialab_core.catalog_external_mappings WHERE id = $1`,
      [CATALOG_EXTERNAL_MAPPING_FIXTURES[0].id]
    );
    expect(mapping.rows[0]).toEqual({
      provider: 'ARYEO',
      external_identifier: 'synthetic-aryeo-product-001',
      target_product_id: CATALOG_PRODUCT_FIXTURES[2].id
    });
    expect(mapping.rows[0].external_identifier).not.toBe(mapping.rows[0].target_product_id);

    await inOwnerTransaction(async () => {
      await expectDbError(
        owner,
        `INSERT INTO medialab_core.catalog_external_mappings
           (id, provider, external_record_type, external_identifier, target_product_id,
            source_system, observed_at, recorded_by_identity_id)
         VALUES ($1, 'ARYEO', 'PRODUCT', 'synthetic-aryeo-product-001', $2, $3, $4, $5)`,
        [crypto.randomUUID(), CATALOG_PRODUCT_FIXTURES[1].id, SYNTHETIC_SOURCE_SYSTEM, '2026-03-27T12:00:00.000Z', CATALOG_ACTOR_IDENTITY_ID]
      );
    });
  });

  it('15. enforces integer-cent, nonnegative, currency, and quantity constraints', async () => {
    const amountType = await owner.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'medialab_core' AND table_name = 'catalog_prices' AND column_name = 'amount_cents'`
    );
    expect(amountType.rows[0].data_type).toBe('bigint');

    await inOwnerTransaction(async () => {
      await expectDbError(
        owner,
        `INSERT INTO medialab_core.catalog_prices
           (id, product_id, amount_cents, currency, effective_at, source_system, recorded_by_identity_id)
         VALUES ($1, $2, -1, 'USD', clock_timestamp(), $3, $4)`,
        [crypto.randomUUID(), CATALOG_PRODUCT_FIXTURES[2].id, SYNTHETIC_SOURCE_SYSTEM, CATALOG_ACTOR_IDENTITY_ID]
      );
    });
    await inOwnerTransaction(async () => {
      await expectDbError(
        owner,
        `INSERT INTO medialab_core.catalog_prices
           (id, product_id, amount_cents, currency, effective_at, source_system, recorded_by_identity_id)
         VALUES ($1, $2, 1, 'usd', clock_timestamp(), $3, $4)`,
        [crypto.randomUUID(), CATALOG_PRODUCT_FIXTURES[2].id, SYNTHETIC_SOURCE_SYSTEM, CATALOG_ACTOR_IDENTITY_ID]
      );
    });
  });

  it('16. rejects retired and legacy products from new package compositions', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    for (const product of [CATALOG_PRODUCT_FIXTURES[3], CATALOG_PRODUCT_FIXTURES[4]]) {
      await expectDbError(
        runtime,
        `SELECT medialab_core.replace_catalog_package_composition($1, $2, $3,
           clock_timestamp(), $4, $5::jsonb)`,
        [token, crypto.randomUUID(), CATALOG_PRODUCT_FIXTURES[0].id, SYNTHETIC_SOURCE_SYSTEM, JSON.stringify([
          { id: crypto.randomUUID(), product_id: product.id, quantity: 1 }
        ])],
        /current, nonretired/
      );
    }
  });

  it('17. grants the runtime role only the exact separately inventoried APIs and zero table DML', async () => {
    const executable = await owner.query(
      `SELECT p.proname
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND p.proname = ANY($1::text[])
          AND has_function_privilege($2, p.oid, 'EXECUTE')
        ORDER BY p.proname`,
      [CATALOG_APIS, TEST_RUNTIME_ROLE]
    );
    expect(executable.rows.map((row) => row.proname)).toEqual([...CATALOG_APIS].sort());

    const direct = await owner.query(
      `SELECT count(*)::int AS count
         FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core'
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')`,
      [TEST_RUNTIME_ROLE]
    );
    expect(direct.rows[0].count).toBe(0);
    await expectDbError(runtime, 'INSERT INTO medialab_core.catalog_products (id) VALUES ($1)', [crypto.randomUUID()]);
    await expectDbError(runtime, 'UPDATE medialab_core.commercial_snapshots SET display_name = display_name');
    await expectDbError(runtime, 'DELETE FROM medialab_core.catalog_prices');
  });

  it('18. grants PUBLIC no packet table or function authority', async () => {
    const functionGrants = await owner.query(
      `SELECT count(*)::int AS count
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND p.proname = ANY($1::text[])
          AND has_function_privilege('public', p.oid, 'EXECUTE')`,
      [CATALOG_APIS]
    );
    const tableGrants = await owner.query(
      `SELECT count(*)::int AS count FROM information_schema.table_privileges
        WHERE grantee = 'PUBLIC' AND table_schema = 'medialab_core'
          AND table_name LIKE ANY(ARRAY['catalog_%', 'commercial_%', 'custom_commercial_%'])`
    );
    expect(functionGrants.rows[0].count).toBe(0);
    expect(tableGrants.rows[0].count).toBe(0);
  });

  it('19. binds catalog events to the authenticated actor instead of caller-supplied authority', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const productId = crypto.randomUUID();
    await runtime.query(
      `SELECT medialab_core.create_catalog_product($1, $2, 'SYNTH_ACTOR_BINDING',
         'Synthetic Actor Binding', 'ADD_ON', 'SERVICE', 'SESSION', $3)`,
      [token, productId, SYNTHETIC_SOURCE_SYSTEM]
    );
    const event = await owner.query(
      'SELECT actor_identity_id FROM medialab_core.catalog_product_change_events WHERE product_id = $1',
      [productId]
    );
    expect(event.rows[0].actor_identity_id).toBe(OPERATOR_IDENTITY_ID);
    await runtime.query(
      `SELECT medialab_core.revise_catalog_product($1, $2, 'Synthetic Actor Binding',
         'RETIRED', 'Synthetic test cleanup retirement', $3)`,
      [token, productId, SYNTHETIC_SOURCE_SYSTEM]
    );
  });

  it('20. rejects organization-admin identity without explicit catalog permission', async () => {
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_product($1, $2, 'SYNTH_UNAUTHORIZED_OWNER',
         'Synthetic Unauthorized Owner', 'ADD_ON', 'SERVICE', 'SESSION', $3)`,
      [ownerToken, crypto.randomUUID(), SYNTHETIC_SOURCE_SYSTEM],
      /lacks required permission/
    );
  });

  it('21. rejects recovery authority as catalog-administration authority', async () => {
    const recoveryToken = await issueRecoverySession(OPERATOR_IDENTITY_ID);
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_product($1, $2, 'SYNTH_RECOVERY_REJECT',
         'Synthetic Recovery Reject', 'ADD_ON', 'SERVICE', 'SESSION', $3)`,
      [recoveryToken, crypto.randomUUID(), SYNTHETIC_SOURCE_SYSTEM],
      /Ordinary session is missing, expired, revoked, or inactive/
    );
  });

  it('22. uses owner-owned fixed-search-path functions and nonowner runtime transport', async () => {
    const functions = await owner.query(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname = ANY($1::text[])
        ORDER BY p.proname`,
      [CATALOG_APIS]
    );
    expect(functions.rows).toHaveLength(CATALOG_APIS.length);
    for (const fn of functions.rows) {
      expect(fn.owner).toBe(TEST_OWNER_ROLE);
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig).toEqual(['search_path=pg_catalog, medialab_core, pg_temp']);
    }
    const role = await owner.query(
      'SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [TEST_RUNTIME_ROLE]
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
  });

  it('23. keeps Job objects separate from tenant-owned catalog columns', async () => {
    const jobObjects = await owner.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'medialab_core'
          AND table_name LIKE 'job%' ORDER BY table_name`
    );
    const tenantColumns = await owner.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'medialab_core'
          AND table_name LIKE 'catalog_%'
          AND column_name IN ('organization_id', 'tenant_id', 'customer_id')`
    );
    expect(jobObjects.rows.map((row) => row.table_name)).toEqual([
      'job_appointments', 'job_events', 'job_service_command_idempotency',
      'job_service_external_references', 'jobs'
    ]);
    expect(tenantColumns.rows).toEqual([]);
  });

  it('24. reseeds idempotently and reset reconstructs the exact packet fixture state', async () => {
    const reseed = await runSeed({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_OWNER_ROLE
    });
    expect(reseed.inserted).toBe(0);
    expect(reseed.verified).toBeGreaterThanOrEqual(51);
    await reset();
    const count = await owner.query('SELECT count(*)::int AS count FROM medialab_core.catalog_products');
    expect(count.rows[0].count).toBe(
      CATALOG_EXPECTED_ROW_COUNTS.catalog_products + CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS.catalog_products
    );
  });

  it('25. rejects suspended catalog actors even when a permission set remains assigned', async () => {
    const operatorToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    await runtime.query(
      `SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4,
         'SUSPENDED', 'Synthetic catalog authorization test', false)`,
      [crypto.randomUUID(), ownerToken, OPERATOR_PERSON_ID, OPERATOR_IDENTITY_ID]
    );
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_product($1, $2, 'SYNTH_SUSPENDED_REJECT',
         'Synthetic Suspended Reject', 'ADD_ON', 'SERVICE', 'SESSION', $3)`,
      [operatorToken, crypto.randomUUID(), SYNTHETIC_SOURCE_SYSTEM],
      /Ordinary session is missing, expired, revoked, or inactive/
    );
  });
});
