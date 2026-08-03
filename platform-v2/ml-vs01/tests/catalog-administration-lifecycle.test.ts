import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import {
  CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE
} from '../db/fixtures/current-real-estate-catalog-seed.js';

const TEST_DB = 'medialab_p02m03a_test';
const TEST_OWNER_ROLE = 'medialab_p02m03a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m03a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m03a-pg';
const TEST_PORT = 55432;
const TEST_SOURCE = 'SYNTHETIC_P02_M03_B_TEST';

const OWNER_PERSON_ID = '034a2b54-4665-5917-90a6-ae40adb3c8aa';
const OWNER_IDENTITY_ID = 'e69ced56-a63e-57bf-a6b5-26d5fe6cc5c5';
const OPERATOR_PERSON_ID = 'd43d9499-efbd-5116-b561-67dd34d1df8d';
const OPERATOR_IDENTITY_ID = '87c0043a-334f-548c-95d7-d53939ab054b';

const ADMIN_APIS = [
  'create_catalog_draft_product',
  'delete_catalog_draft_product',
  'get_catalog_administration_products',
  'publish_catalog_draft_product',
  'revise_catalog_draft_product',
  'revise_published_catalog_product_definition',
  'set_catalog_product_archived'
];

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('P02-M03-B catalog administration lifecycle', () => {
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

  async function createDraft(
    token: string,
    code: string,
    kind: 'ADD_ON' | 'PACKAGE' | 'SERVICE' = 'ADD_ON',
    duplicatedFrom: string | null = null
  ): Promise<string> {
    const id = crypto.randomUUID();
    await runtime.query(
      `SELECT medialab_core.create_catalog_draft_product(
         $1, $2, $3, $4, $5, 'SERVICE', 'SESSION', $6,
         'ADMINISTRATIVE', NULL, $4, NULL, NULL, $7)`,
      [token, id, code, `Synthetic ${code}`, kind, TEST_SOURCE, duplicatedFrom]
    );
    return id;
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_OWNER_ROLE });
    runtime = new pg.Client({ host: TEST_SOCKET, port: TEST_PORT, database: TEST_DB, user: TEST_RUNTIME_ROLE });
    await owner.connect();
    await runtime.connect();
  });

  afterAll(async () => {
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    await reset();
  });

  it('1. applies the exact five-migration ledger while preserving the accepted 0004 hash', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(5);
    expect(ledger.rows[3]).toEqual({
      filename: '0004_current_catalog_and_price_snapshots.sql',
      sha256: 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876'
    });
    expect(ledger.rows[4].filename).toBe('0005_catalog_administration_lifecycle.sql');
    expect(ledger.rows[4].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. keeps authoring, commercial lifecycle, and administrative visibility independent', async () => {
    const product = await owner.query(
      `SELECT authoring_state, lifecycle_state, archived_at
         FROM medialab_core.catalog_products WHERE product_code = 'ADDITIONAL_AERIAL_EXTERIOR_PHOTO'`
    );
    expect(product.rows[0]).toEqual({ authoring_state: 'PUBLISHED', lifecycle_state: 'ACTIVE', archived_at: null });

    const constraints = await owner.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'medialab_core.catalog_products'::regclass
          AND conname IN ('catalog_products_authoring_state_check',
                          'catalog_products_draft_nonselectable_check',
                          'catalog_products_archive_evidence_check')
        ORDER BY conname`
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      'catalog_products_archive_evidence_check',
      'catalog_products_authoring_state_check',
      'catalog_products_draft_nonselectable_check'
    ]);
  });

  it('3. creates a nonselectable draft with authenticated actor evidence', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const id = await createDraft(token, 'SYNTH_DRAFT_CREATE');
    const product = await owner.query(
      `SELECT authoring_state, lifecycle_state, archived_at, created_by_identity_id
         FROM medialab_core.catalog_products WHERE id = $1`,
      [id]
    );
    expect(product.rows[0]).toEqual({
      authoring_state: 'DRAFT',
      lifecycle_state: 'NONSELECTABLE',
      archived_at: null,
      created_by_identity_id: OPERATOR_IDENTITY_ID
    });
    const selectable = await runtime.query(
      'SELECT count(*)::int AS count FROM medialab_core.get_current_selectable_catalog(clock_timestamp()) WHERE product_id = $1',
      [id]
    );
    expect(selectable.rows[0].count).toBe(0);
    const event = await owner.query(
      'SELECT event_type, actor_identity_id FROM medialab_core.catalog_administration_events WHERE product_id = $1',
      [id]
    );
    expect(event.rows[0]).toEqual({ event_type: 'DRAFT_CREATED', actor_identity_id: OPERATOR_IDENTITY_ID });
  });

  it('4. duplicates only editable identity data into a new draft with no inherited commercial history', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const source = CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE.ADDITIONAL_AERIAL_EXTERIOR_PHOTO;
    const sourceRead = await runtime.query(
      `SELECT display_name, product_kind, classification, commercial_unit
         FROM medialab_core.get_catalog_administration_products($1, true)
        WHERE product_id = $2`,
      [token, source.id]
    );
    const duplicateId = crypto.randomUUID();
    await runtime.query(
      `SELECT medialab_core.create_catalog_draft_product(
         $1, $2, 'SYNTH_DUPLICATE_DRAFT', $3, $4, $5, $6, $7,
         'ADMINISTRATIVE', NULL, $3, NULL, NULL, $8)`,
      [
        token,
        duplicateId,
        sourceRead.rows[0].display_name,
        sourceRead.rows[0].product_kind,
        sourceRead.rows[0].classification,
        sourceRead.rows[0].commercial_unit,
        TEST_SOURCE,
        source.id
      ]
    );
    const duplicate = await owner.query(
      `SELECT id, display_name, product_kind, classification, commercial_unit,
              authoring_state, lifecycle_state, duplicated_from_product_id
         FROM medialab_core.catalog_products WHERE id = $1`,
      [duplicateId]
    );
    expect(duplicate.rows[0]).toEqual({
      id: duplicateId,
      ...sourceRead.rows[0],
      authoring_state: 'DRAFT',
      lifecycle_state: 'NONSELECTABLE',
      duplicated_from_product_id: source.id
    });
    for (const query of [
      'SELECT count(*)::int AS count FROM medialab_core.catalog_prices WHERE product_id = $1',
      'SELECT count(*)::int AS count FROM medialab_core.catalog_external_mappings WHERE target_product_id = $1',
      'SELECT count(*)::int AS count FROM medialab_core.commercial_snapshots WHERE catalog_product_id = $1',
      'SELECT count(*)::int AS count FROM medialab_core.catalog_product_change_events WHERE product_id = $1'
    ]) {
      const result = await owner.query(query, [duplicateId]);
      expect(result.rows[0].count).toBe(0);
    }
    const event = await owner.query(
      `SELECT event_type, duplicated_from_product_id
         FROM medialab_core.catalog_administration_events WHERE product_id = $1`,
      [duplicateId]
    );
    expect(event.rows[0]).toEqual({ event_type: 'DRAFT_DUPLICATED', duplicated_from_product_id: source.id });
  });

  it('5. revises a draft, rejects premature activation, then publishes and activates through attributable actions', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const id = await createDraft(token, 'SYNTH_DRAFT_PUBLISH');
    await runtime.query(
      `SELECT medialab_core.revise_catalog_draft_product(
         $1, $2, 'Synthetic Revised Draft', 'ADD_ON', 'SERVICE', 'EACH', $3,
         'ADMINISTRATIVE', NULL, 'Synthetic Revised Draft', NULL, NULL, 'Draft correction')`,
      [token, id, TEST_SOURCE]
    );
    await expectDbError(
      runtime,
      `SELECT medialab_core.revise_catalog_product(
         $1, $2, 'Synthetic Revised Draft', 'ACTIVE', 'Premature activation', $3)`,
      [token, id, TEST_SOURCE],
      /draft_nonselectable|violates check constraint/
    );

    await runtime.query(
      'SELECT medialab_core.publish_catalog_draft_product($1, $2, $3, $4)',
      [token, id, 'Approved synthetic publication', TEST_SOURCE]
    );
    const published = await owner.query(
      'SELECT authoring_state, lifecycle_state, published_by_identity_id FROM medialab_core.catalog_products WHERE id = $1',
      [id]
    );
    expect(published.rows[0]).toEqual({
      authoring_state: 'PUBLISHED',
      lifecycle_state: 'NONSELECTABLE',
      published_by_identity_id: OPERATOR_IDENTITY_ID
    });

    await runtime.query(
      `SELECT medialab_core.record_catalog_price(
         $1, $2, $3, 1234, 'USD', clock_timestamp() - interval '1 second', $4, 'synthetic-publish-price')`,
      [token, crypto.randomUUID(), id, TEST_SOURCE]
    );
    await runtime.query(
      `SELECT medialab_core.revise_catalog_product(
         $1, $2, 'Synthetic Revised Draft', 'ACTIVE', 'Activate published draft', $3)`,
      [token, id, TEST_SOURCE]
    );
    const selected = await runtime.query(
      'SELECT product_id FROM medialab_core.get_current_selectable_catalog(clock_timestamp()) WHERE product_id = $1',
      [id]
    );
    expect(selected.rows).toEqual([{ product_id: id }]);

    await runtime.query(
      `SELECT medialab_core.revise_catalog_product(
         $1, $2, 'Synthetic Revised Draft', 'NONSELECTABLE', 'Temporary deactivation', $3)`,
      [token, id, TEST_SOURCE]
    );
    const deactivated = await runtime.query(
      'SELECT count(*)::int AS count FROM medialab_core.get_current_selectable_catalog(clock_timestamp()) WHERE product_id = $1',
      [id]
    );
    expect(deactivated.rows[0].count).toBe(0);
    await runtime.query(
      `SELECT medialab_core.revise_catalog_product(
         $1, $2, 'Synthetic Revised Draft', 'ACTIVE', 'Reactivate eligible product', $3)`,
      [token, id, TEST_SOURCE]
    );
  });

  it('6. revises a published definition through attributable before-and-after evidence', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const id = await createDraft(token, 'SYNTH_PUBLISHED_DEFINITION');
    await runtime.query(
      'SELECT medialab_core.publish_catalog_draft_product($1, $2, $3, $4)',
      [token, id, 'Publish for definition revision', TEST_SOURCE]
    );
    await runtime.query(
      `SELECT medialab_core.record_catalog_price(
         $1, $2, $3, 2222, 'USD', clock_timestamp() - interval '1 second', $4, 'synthetic-definition-price')`,
      [token, crypto.randomUUID(), id, TEST_SOURCE]
    );
    await runtime.query(
      `SELECT medialab_core.revise_catalog_product(
         $1, $2, 'Synthetic SYNTH_PUBLISHED_DEFINITION', 'ACTIVE', 'Activate revision proof', $3)`,
      [token, id, TEST_SOURCE]
    );
    const snapshotId = crypto.randomUUID();
    await runtime.query(
      `SELECT medialab_core.create_catalog_commercial_snapshot(
         $1, $2, $3, 1, NULL, 0, NULL, 0, NULL, clock_timestamp(),
         $4, 'SYNTHETIC_TEST', 'published-definition-revision', 0, NULL)`,
      [token, snapshotId, id, TEST_SOURCE]
    );

    await runtime.query(
      `SELECT medialab_core.revise_published_catalog_product_definition(
         $1, $2, 'Synthetic Revised Published Definition', 'ADD_ON', 'PRODUCT', 'EACH', $3, $4)`,
      [token, id, 'Approved published definition revision', TEST_SOURCE]
    );
    const product = await owner.query(
      `SELECT display_name, product_kind, classification, commercial_unit
         FROM medialab_core.catalog_products WHERE id = $1`,
      [id]
    );
    expect(product.rows[0]).toEqual({
      display_name: 'Synthetic Revised Published Definition',
      product_kind: 'ADD_ON',
      classification: 'PRODUCT',
      commercial_unit: 'EACH'
    });
    const event = await owner.query(
      `SELECT event_type, previous_definition, new_definition, actor_identity_id
         FROM medialab_core.catalog_administration_events
        WHERE product_id = $1 AND event_type = 'PUBLISHED_REVISED'`,
      [id]
    );
    expect(event.rows[0]).toEqual({
      event_type: 'PUBLISHED_REVISED',
      previous_definition: {
        display_name: 'Synthetic SYNTH_PUBLISHED_DEFINITION',
        product_kind: 'ADD_ON',
        classification: 'SERVICE',
        commercial_unit: 'SESSION'
      },
      new_definition: {
        display_name: 'Synthetic Revised Published Definition',
        product_kind: 'ADD_ON',
        classification: 'PRODUCT',
        commercial_unit: 'EACH'
      },
      actor_identity_id: OPERATOR_IDENTITY_ID
    });
    const snapshot = await owner.query(
      `SELECT display_name, classification, commercial_unit
         FROM medialab_core.commercial_snapshots WHERE id = $1`,
      [snapshotId]
    );
    expect(snapshot.rows[0]).toEqual({
      display_name: 'Synthetic SYNTH_PUBLISHED_DEFINITION',
      classification: 'SERVICE',
      commercial_unit: 'SESSION'
    });
  });

  it('7. archives and unarchives without changing commercial selectability or immutable snapshots', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const product = CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE.ADDITIONAL_AERIAL_EXTERIOR_PHOTO;
    const snapshotsBefore = await owner.query('SELECT * FROM medialab_core.commercial_snapshots ORDER BY id');

    await runtime.query(
      'SELECT medialab_core.set_catalog_product_archived($1, $2, true, $3, $4)',
      [token, product.id, 'Archive for administrative organization', TEST_SOURCE]
    );
    const selected = await runtime.query(
      'SELECT product_id FROM medialab_core.get_current_selectable_catalog(clock_timestamp()) WHERE product_id = $1',
      [product.id]
    );
    expect(selected.rows).toEqual([{ product_id: product.id }]);
    const ordinaryAdmin = await runtime.query(
      'SELECT product_id FROM medialab_core.get_catalog_administration_products($1, false) WHERE product_id = $2',
      [token, product.id]
    );
    const archivedAdmin = await runtime.query(
      'SELECT product_id, is_archived FROM medialab_core.get_catalog_administration_products($1, true) WHERE product_id = $2',
      [token, product.id]
    );
    expect(ordinaryAdmin.rows).toEqual([]);
    expect(archivedAdmin.rows).toEqual([{ product_id: product.id, is_archived: true }]);

    await runtime.query(
      'SELECT medialab_core.set_catalog_product_archived($1, $2, false, $3, $4)',
      [token, product.id, 'Restore ordinary administration visibility', TEST_SOURCE]
    );
    const snapshotsAfter = await owner.query('SELECT * FROM medialab_core.commercial_snapshots ORDER BY id');
    expect(snapshotsAfter.rows).toEqual(snapshotsBefore.rows);
  });

  it('8. retires and restores an eligible product without changing price or snapshot history', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const product = CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE.VIRTUAL_TWILIGHT_PHOTO;
    const pricesBefore = await owner.query('SELECT * FROM medialab_core.catalog_prices WHERE product_id = $1 ORDER BY id', [product.id]);
    const snapshotsBefore = await owner.query('SELECT * FROM medialab_core.commercial_snapshots ORDER BY id');
    await runtime.query(
      `SELECT medialab_core.revise_catalog_product(
         $1, $2, $3, 'RETIRED', 'Synthetic retirement proof', $4)`,
      [token, product.id, product.display_name, TEST_SOURCE]
    );
    await runtime.query(
      `SELECT medialab_core.revise_catalog_product(
         $1, $2, $3, 'ACTIVE', 'Synthetic restoration proof', $4)`,
      [token, product.id, product.display_name, TEST_SOURCE]
    );
    const pricesAfter = await owner.query('SELECT * FROM medialab_core.catalog_prices WHERE product_id = $1 ORDER BY id', [product.id]);
    const snapshotsAfter = await owner.query('SELECT * FROM medialab_core.commercial_snapshots ORDER BY id');
    expect(pricesAfter.rows).toEqual(pricesBefore.rows);
    expect(snapshotsAfter.rows).toEqual(snapshotsBefore.rows);
  });

  it('9. permanently deletes only a clean draft and preserves a durable tombstone event', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const id = await createDraft(token, 'SYNTH_DELETE_CLEAN');
    const result = await runtime.query(
      'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4) AS deleted_id',
      [token, id, 'Delete unused synthetic draft', TEST_SOURCE]
    );
    expect(result.rows[0].deleted_id).toBe(id);
    const product = await owner.query('SELECT count(*)::int AS count FROM medialab_core.catalog_products WHERE id = $1', [id]);
    expect(product.rows[0].count).toBe(0);
    const tombstone = await owner.query(
      `SELECT id, event_type, product_id, actor_identity_id
         FROM medialab_core.catalog_administration_events
        WHERE product_id = $1 AND event_type = 'DRAFT_DELETED'`,
      [id]
    );
    expect(tombstone.rows[0]).toMatchObject({
      event_type: 'DRAFT_DELETED',
      product_id: id,
      actor_identity_id: OPERATOR_IDENTITY_ID,
    });
    await expectDbError(
      owner,
      `UPDATE medialab_core.catalog_administration_events SET reason = 'Changed' WHERE id = $1`,
      [tombstone.rows[0].id],
      /immutable/
    );
  });

  it('10. rejects draft deletion after every directly representable protected-reference class', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);

    const priced = await createDraft(token, 'SYNTH_DELETE_PRICE');
    await runtime.query(
      `SELECT medialab_core.record_catalog_price(
         $1, $2, $3, 100, 'USD', clock_timestamp(), $4, 'synthetic-protected-price')`,
      [token, crypto.randomUUID(), priced, TEST_SOURCE]
    );
    await expectDbError(runtime, 'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)', [token, priced, 'Reject price', TEST_SOURCE], /protected/);

    const packageDraft = await createDraft(token, 'SYNTH_DELETE_PACKAGE_VERSION', 'PACKAGE');
    await runtime.query(
      `SELECT medialab_core.replace_catalog_package_composition(
         $1, $2, $3, clock_timestamp(), $4, $5::jsonb)`,
      [token, crypto.randomUUID(), packageDraft, TEST_SOURCE, JSON.stringify([{
        id: crypto.randomUUID(),
        product_id: CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE.INCLUDED_2D_FLOOR_PLAN.id,
        quantity: 1
      }])]
    );
    await expectDbError(runtime, 'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)', [token, packageDraft, 'Reject package version', TEST_SOURCE], /protected/);

    const inclusion = await createDraft(token, 'SYNTH_DELETE_INCLUDED', 'SERVICE');
    await runtime.query(
      `SELECT medialab_core.replace_catalog_package_composition(
         $1, $2, $3, clock_timestamp() + interval '1 day', $4, $5::jsonb)`,
      [token, crypto.randomUUID(), CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE.HOME_PACKAGE_SMALL.id, TEST_SOURCE, JSON.stringify([{
        id: crypto.randomUUID(), product_id: inclusion, quantity: 1
      }])]
    );
    await expectDbError(runtime, 'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)', [token, inclusion, 'Reject inclusion', TEST_SOURCE], /protected/);

    const bracketed = await createDraft(token, 'SYNTH_DELETE_BRACKET', 'PACKAGE');
    await runtime.query(
      `SELECT medialab_core.replace_catalog_bracket_set(
         $1, $2, $3, 'SQUARE_FEET', clock_timestamp(), $4, $5::jsonb)`,
      [token, crypto.randomUUID(), bracketed, TEST_SOURCE, JSON.stringify([{
        id: crypto.randomUUID(), code: 'SYNTH_ONLY', lower_bound: 0, upper_bound: null,
        lower_inclusive: true, upper_inclusive: false, amount_cents: 100, currency: 'USD'
      }])]
    );
    await expectDbError(runtime, 'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)', [token, bracketed, 'Reject bracket', TEST_SOURCE], /protected/);

    const mapped = await createDraft(token, 'SYNTH_DELETE_MAPPING');
    await runtime.query(
      `SELECT medialab_core.record_catalog_external_mapping(
         $1, $2, 'SYNTHETIC_PROVIDER', 'PRODUCT', $3, $4, $5, clock_timestamp())`,
      [token, crypto.randomUUID(), `synthetic-${crypto.randomUUID()}`, mapped, TEST_SOURCE]
    );
    await expectDbError(runtime, 'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)', [token, mapped, 'Reject mapping', TEST_SOURCE], /protected/);

    const snapshotProduct = await createDraft(token, 'SYNTH_DELETE_SNAPSHOT');
    await runtime.query(
      `SELECT medialab_core.record_catalog_price(
         $1, $2, $3, 100, 'USD', clock_timestamp() - interval '1 second', $4, 'synthetic-snapshot-price')`,
      [token, crypto.randomUUID(), snapshotProduct, TEST_SOURCE]
    );
    const snapshotId = crypto.randomUUID();
    await runtime.query(
      `SELECT medialab_core.create_catalog_commercial_snapshot(
         $1, $2, $3, 1, NULL, 0, NULL, 0, NULL, clock_timestamp(),
         $4, 'SYNTHETIC_TEST', $5, 0, NULL)`,
      [token, snapshotId, snapshotProduct, TEST_SOURCE, `synthetic-${snapshotId}`]
    );
    const snapshot = await owner.query('SELECT id FROM medialab_core.commercial_snapshots WHERE id = $1', [snapshotId]);
    expect(snapshot.rows).toEqual([{ id: snapshotId }]);
    await expectDbError(runtime, 'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)', [token, snapshotProduct, 'Reject snapshot', TEST_SOURCE], /protected/);

    const provenanceSource = await createDraft(token, 'SYNTH_DELETE_PROVENANCE_SOURCE');
    await createDraft(token, 'SYNTH_DELETE_PROVENANCE_CHILD', 'ADD_ON', provenanceSource);
    await expectDbError(runtime, 'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)', [token, provenanceSource, 'Reject provenance', TEST_SOURCE], /protected/);
  });

  it('11. fails closed when a protected reference wins a concurrent deletion race', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const id = await createDraft(token, 'SYNTH_DELETE_RACE');
    await owner.query('BEGIN');
    try {
      await owner.query('SELECT id FROM medialab_core.catalog_products WHERE id = $1 FOR UPDATE', [id]);
      const pendingDelete = runtime.query(
        'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)',
        [token, id, 'Concurrent deletion attempt', TEST_SOURCE]
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await owner.query(
        `INSERT INTO medialab_core.catalog_prices
           (id, product_id, amount_cents, currency, effective_at, source_system, recorded_by_identity_id)
         VALUES ($1, $2, 100, 'USD', clock_timestamp(), $3, $4)`,
        [crypto.randomUUID(), id, TEST_SOURCE, OPERATOR_IDENTITY_ID]
      );
      await owner.query('COMMIT');
      await expect(pendingDelete).rejects.toThrow(/protected/);
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
    const remains = await owner.query('SELECT count(*)::int AS count FROM medialab_core.catalog_products WHERE id = $1', [id]);
    expect(remains.rows[0].count).toBe(1);
  });

  it('12. rejects published, active, and retired product deletion', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    for (const code of ['ADDITIONAL_AERIAL_EXTERIOR_PHOTO', 'MATTERPORT_UNDER_2500']) {
      const product = CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE[code];
      await expectDbError(
        runtime,
        'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)',
        [token, product.id, 'Invalid delete', TEST_SOURCE],
        /never-published/
      );
    }
    const retired = CURRENT_REAL_ESTATE_PRODUCTS_BY_CODE.VIRTUAL_STAGING;
    await runtime.query(
      `SELECT medialab_core.revise_catalog_product($1, $2, $3, 'RETIRED', 'Retire for deletion test', $4)`,
      [token, retired.id, retired.display_name, TEST_SOURCE]
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)',
      [token, retired.id, 'Invalid retired delete', TEST_SOURCE],
      /never-published/
    );
  });

  it('13. restricts administration to internal catalog permission and rejects recovery authority', async () => {
    const customerAdminToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_draft_product(
         $1, $2, 'SYNTH_CUSTOMER_REJECT', 'Synthetic Customer Reject', 'ADD_ON',
         'SERVICE', 'SESSION', $3, 'ADMINISTRATIVE', NULL, NULL, NULL, NULL, NULL)`,
      [customerAdminToken, crypto.randomUUID(), TEST_SOURCE],
      /lacks required permission/
    );
    const recoveryToken = await issueRecoverySession(OPERATOR_IDENTITY_ID);
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_draft_product(
         $1, $2, 'SYNTH_RECOVERY_REJECT', 'Synthetic Recovery Reject', 'ADD_ON',
         'SERVICE', 'SESSION', $3, 'ADMINISTRATIVE', NULL, NULL, NULL, NULL, NULL)`,
      [recoveryToken, crypto.randomUUID(), TEST_SOURCE],
      /Ordinary session is missing, expired, revoked, or inactive/
    );
  });

  it('14. exposes exact runtime APIs with fixed paths and zero direct table or PUBLIC authority', async () => {
    const functions = await owner.query(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname = ANY($2::text[])
        ORDER BY p.proname`,
      [TEST_RUNTIME_ROLE, ADMIN_APIS]
    );
    expect(functions.rows).toHaveLength(ADMIN_APIS.length);
    for (const fn of functions.rows) {
      expect(fn.owner).toBe(TEST_OWNER_ROLE);
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig).toEqual(['search_path=pg_catalog, medialab_core, pg_temp']);
      expect(fn.runtime_execute).toBe(true);
      expect(fn.public_execute).toBe(false);
    }
    const direct = await owner.query(
      `SELECT count(*)::int AS count FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core'
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')`,
      [TEST_RUNTIME_ROLE]
    );
    expect(direct.rows[0].count).toBe(0);
    await expectDbError(runtime, 'DELETE FROM medialab_core.catalog_products');
  });

  it('15. resists temporary-schema shadowing under the fixed SECURITY DEFINER search path', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await runtime.query('CREATE TEMP TABLE catalog_products (id uuid)');
    const id = await createDraft(token, 'SYNTH_SHADOW_PROOF');
    const real = await owner.query('SELECT authoring_state FROM medialab_core.catalog_products WHERE id = $1', [id]);
    expect(real.rows).toEqual([{ authoring_state: 'DRAFT' }]);
    await runtime.query(
      'SELECT medialab_core.delete_catalog_draft_product($1, $2, $3, $4)',
      [token, id, 'Shadowing test cleanup', TEST_SOURCE]
    );
  });

  it('16. rejects suspended and deactivated catalog actors even when permission membership remains', async () => {
    const operatorToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    await runtime.query(
      `SELECT medialab_core.transition_account_lifecycle(
         $1, $2, $3, $4, 'SUSPENDED', 'Synthetic lifecycle authorization proof', false)`,
      [crypto.randomUUID(), ownerToken, OPERATOR_PERSON_ID, OPERATOR_IDENTITY_ID]
    );
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_draft_product(
         $1, $2, 'SYNTH_SUSPENDED_REJECT', 'Synthetic Suspended Reject', 'ADD_ON',
         'SERVICE', 'SESSION', $3, 'ADMINISTRATIVE', NULL, NULL, NULL, NULL, NULL)`,
      [operatorToken, crypto.randomUUID(), TEST_SOURCE],
      /Ordinary session is missing, expired, revoked, or inactive/
    );
    await runtime.query(
      `SELECT medialab_core.transition_account_lifecycle(
         $1, $2, $3, $4, 'DEACTIVATED', 'Synthetic lifecycle authorization proof', false)`,
      [crypto.randomUUID(), ownerToken, OPERATOR_PERSON_ID, OPERATOR_IDENTITY_ID]
    );
    await expectDbError(
      runtime,
      `SELECT medialab_core.create_catalog_draft_product(
         $1, $2, 'SYNTH_DEACTIVATED_REJECT', 'Synthetic Deactivated Reject', 'ADD_ON',
         'SERVICE', 'SESSION', $3, 'ADMINISTRATIVE', NULL, NULL, NULL, NULL, NULL)`,
      [operatorToken, crypto.randomUUID(), TEST_SOURCE],
      /Ordinary session is missing, expired, revoked, or inactive/
    );
  });
});
