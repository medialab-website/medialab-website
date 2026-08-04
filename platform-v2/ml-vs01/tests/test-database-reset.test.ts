import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { EXPECTED_ROW_COUNTS } from '../db/fixtures/identity-tenancy-fixtures.js';
import { CATALOG_EXPECTED_ROW_COUNTS } from '../db/fixtures/current-catalog-price-fixtures.js';
import { CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS } from '../db/fixtures/current-real-estate-catalog-seed.js';
import { ORDER_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m04a_test';
const TEST_ROLE = 'medialab_p02m04a_test_owner';
const TEST_SOCKET = '/tmp/mlvs01-p02m04a-pg';
const TEST_PORT = 55432;

const EXACT_ROUTINE_NAMES = [
  'actor_can_administer_person',
  'apply_account_lifecycle_transition',
  'apply_catalog_product_administration_defaults',
  'apply_contact_retirement',
  'apply_contact_supersession',
  'apply_primary_email_replacement',
  'bootstrap_identity_account',
  'bootstrap_person_contact',
  'correct_contact_method',
  'create_catalog_commercial_snapshot',
  'create_catalog_draft_product',
  'create_catalog_product',
  'create_contact_method',
  'create_custom_commercial_snapshot',
  'create_order',
  'create_property_hub',
  'delete_catalog_draft_product',
  'get_catalog_administration_products',
  'get_current_catalog_package_inclusions',
  'get_current_selectable_catalog',
  'get_order_record',
  'get_property_hub_record',
  'guard_account_lifecycle_transition_insert',
  'guard_account_state_insert',
  'guard_account_state_update',
  'guard_catalog_draft_product_delete',
  'guard_contact_method_insert',
  'guard_contact_method_update',
  'guard_contact_retirement_insert',
  'guard_contact_supersession_insert',
  'guard_contact_verification_insert',
  'guard_order_relationship_insert',
  'guard_people_primary_email_update',
  'guard_primary_email_replacement_insert',
  'guard_verification_invalidation_insert',
  'invalidate_contact_verification',
  'normalize_contact_value',
  'publish_catalog_draft_product',
  'record_catalog_external_mapping',
  'record_catalog_price',
  'record_contact_verification',
  'reject_catalog_evidence_mutation',
  'reject_catalog_product_delete',
  'reject_contact_history_mutation',
  'reject_order_evidence_mutation',
  'reject_property_hub_evidence_mutation',
  'reject_property_snapshot_mutation',
  'replace_catalog_bracket_set',
  'replace_catalog_package_composition',
  'replace_primary_email',
  'require_catalog_permission',
  'require_identity_person',
  'require_order_permission',
  'require_property_hub_permission',
  'resolve_account_recovery_session',
  'resolve_ordinary_session',
  'retire_contact_method',
  'revise_catalog_draft_product',
  'revise_catalog_product',
  'revise_published_catalog_product_definition',
  'set_catalog_product_archived',
  'transition_account_lifecycle'
];

const EXACT_TRIGGERS = [
  ['account_lifecycle_transitions_apply', 'account_lifecycle_transitions', 'apply_account_lifecycle_transition'],
  ['account_lifecycle_transitions_immutability_guard', 'account_lifecycle_transitions', 'reject_contact_history_mutation'],
  ['account_lifecycle_transitions_insert_guard', 'account_lifecycle_transitions', 'guard_account_lifecycle_transition_insert'],
  ['catalog_administration_events_immutability_guard', 'catalog_administration_events', 'reject_catalog_evidence_mutation'],
  ['catalog_bracket_sets_immutability_guard', 'catalog_bracket_sets', 'reject_catalog_evidence_mutation'],
  ['catalog_external_mappings_immutability_guard', 'catalog_external_mappings', 'reject_catalog_evidence_mutation'],
  ['catalog_package_version_items_immutability_guard', 'catalog_package_version_items', 'reject_catalog_evidence_mutation'],
  ['catalog_package_versions_immutability_guard', 'catalog_package_versions', 'reject_catalog_evidence_mutation'],
  ['catalog_price_brackets_immutability_guard', 'catalog_price_brackets', 'reject_catalog_evidence_mutation'],
  ['catalog_prices_immutability_guard', 'catalog_prices', 'reject_catalog_evidence_mutation'],
  ['catalog_product_change_events_immutability_guard', 'catalog_product_change_events', 'reject_catalog_evidence_mutation'],
  ['catalog_products_administration_defaults', 'catalog_products', 'apply_catalog_product_administration_defaults'],
  ['catalog_products_delete_guard', 'catalog_products', 'guard_catalog_draft_product_delete'],
  ['commercial_snapshot_package_items_immutability_guard', 'commercial_snapshot_package_items', 'reject_catalog_evidence_mutation'],
  ['commercial_snapshots_immutability_guard', 'commercial_snapshots', 'reject_catalog_evidence_mutation'],
  ['contact_method_retirements_apply', 'contact_method_retirements', 'apply_contact_retirement'],
  ['contact_method_retirements_immutability_guard', 'contact_method_retirements', 'reject_contact_history_mutation'],
  ['contact_method_retirements_insert_guard', 'contact_method_retirements', 'guard_contact_retirement_insert'],
  ['contact_method_supersessions_apply', 'contact_method_supersessions', 'apply_contact_supersession'],
  ['contact_method_supersessions_immutability_guard', 'contact_method_supersessions', 'reject_contact_history_mutation'],
  ['contact_method_supersessions_insert_guard', 'contact_method_supersessions', 'guard_contact_supersession_insert'],
  ['contact_methods_delete_guard', 'contact_methods', 'reject_contact_history_mutation'],
  ['contact_methods_insert_guard', 'contact_methods', 'guard_contact_method_insert'],
  ['contact_methods_update_guard', 'contact_methods', 'guard_contact_method_update'],
  ['contact_verification_evidence_immutability_guard', 'contact_verification_evidence', 'reject_contact_history_mutation'],
  ['contact_verification_evidence_insert_guard', 'contact_verification_evidence', 'guard_contact_verification_insert'],
  ['contact_verification_invalidations_immutability_guard', 'contact_verification_invalidations', 'reject_contact_history_mutation'],
  ['contact_verification_invalidations_insert_guard', 'contact_verification_invalidations', 'guard_verification_invalidation_insert'],
  ['custom_commercial_snapshots_immutability_guard', 'custom_commercial_snapshots', 'reject_catalog_evidence_mutation'],
  ['identities_account_bootstrap', 'identities', 'bootstrap_identity_account'],
  ['order_events_immutability_guard', 'order_events', 'reject_order_evidence_mutation'],
  ['order_external_references_immutability_guard', 'order_external_references', 'reject_order_evidence_mutation'],
  ['order_idempotency_records_immutability_guard', 'order_idempotency_records', 'reject_order_evidence_mutation'],
  ['order_items_immutability_guard', 'order_items', 'reject_order_evidence_mutation'],
  ['order_parties_immutability_guard', 'order_parties', 'reject_order_evidence_mutation'],
  ['order_relationships_immutability_guard', 'order_relationships', 'reject_order_evidence_mutation'],
  ['order_relationships_insert_guard', 'order_relationships', 'guard_order_relationship_insert'],
  ['orders_immutability_guard', 'orders', 'reject_order_evidence_mutation'],
  ['people_contact_bootstrap', 'people', 'bootstrap_person_contact'],
  ['people_primary_email_update_guard', 'people', 'guard_people_primary_email_update'],
  ['person_account_states_delete_guard', 'person_account_states', 'reject_contact_history_mutation'],
  ['person_account_states_insert_guard', 'person_account_states', 'guard_account_state_insert'],
  ['person_account_states_update_guard', 'person_account_states', 'guard_account_state_update'],
  ['primary_email_replacements_apply', 'primary_email_replacements', 'apply_primary_email_replacement'],
  ['primary_email_replacements_immutability_guard', 'primary_email_replacements', 'reject_contact_history_mutation'],
  ['primary_email_replacements_insert_guard', 'primary_email_replacements', 'guard_primary_email_replacement_insert'],
  ['property_hub_events_immutability_guard', 'property_hub_events', 'reject_property_hub_evidence_mutation'],
  ['property_hub_external_references_immutability_guard', 'property_hub_external_references', 'reject_property_hub_evidence_mutation'],
  ['property_hub_idempotency_records_immutability_guard', 'property_hub_idempotency_records', 'reject_property_hub_evidence_mutation'],
  ['property_hub_orders_immutability_guard', 'property_hub_orders', 'reject_property_hub_evidence_mutation'],
  ['property_hub_participants_immutability_guard', 'property_hub_participants', 'reject_property_hub_evidence_mutation'],
  ['property_hubs_immutability_guard', 'property_hubs', 'reject_property_hub_evidence_mutation'],
  ['property_snapshots_immutability_guard', 'property_snapshots', 'reject_property_snapshot_mutation']
].map(([trigger_name, table_name, function_name]) => ({
  trigger_name,
  table_name,
  schema_name: 'medialab_core',
  function_name
}));

describe('P01C Test Database Reset Tooling Tests', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_ROLE
    });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  it('1. reset refuses development database targets under any flag/alias', async () => {
    await expect(
      resetTestDatabase({
        database: 'medialab_p02m04a',
        confirm: 'medialab_p02m04a',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('2. reset refuses missing or incorrect confirmation values', async () => {
    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: '',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);

    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: 'WRONG_CONFIRMATION',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('3. reset refuses TCP or external host connection targets', async () => {
    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: TEST_DB,
        host: '127.0.0.1',
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('4. reset removes deliberate disposable drift and reconstructs exact schema and fixtures', async () => {
    // Introduce deliberate disposable drift: create a dummy table in medialab_core
    await client.query('CREATE TABLE medialab_core.__disposable_test_drift (id int PRIMARY KEY);');
    const checkDriftBefore = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'medialab_core' AND table_name = '__disposable_test_drift';"
    );
    expect(checkDriftBefore.rows).toHaveLength(1);

    // Execute reset
    await resetTestDatabase({
      database: TEST_DB,
      confirm: TEST_DB,
      host: TEST_SOCKET,
      port: TEST_PORT,
      user: TEST_ROLE
    });

    // Verify disposable drift table is completely gone
    const checkDriftAfter = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'medialab_core' AND table_name = '__disposable_test_drift';"
    );
    expect(checkDriftAfter.rows).toHaveLength(0);

    // Verify canonical migration ledger
    const ledgerRes = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename ASC;');
    expect(ledgerRes.rows).toHaveLength(7);
    expect(ledgerRes.rows[0].filename).toBe('0001_identity_and_tenancy.sql');
    expect(ledgerRes.rows[0].sha256).toBe('29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31');
    expect(ledgerRes.rows[1].filename).toBe('0002_property_identity_and_snapshots.sql');
    expect(ledgerRes.rows[1].sha256).toBe('d3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83');
    expect(ledgerRes.rows[2].filename).toBe('0003_person_contacts_and_account_lifecycle.sql');
    expect(ledgerRes.rows[2].sha256).toBe('984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3');
    expect(ledgerRes.rows[3].filename).toBe('0004_current_catalog_and_price_snapshots.sql');
    expect(ledgerRes.rows[3].sha256).toBe('e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876');
    expect(ledgerRes.rows[4].filename).toBe('0005_catalog_administration_lifecycle.sql');
    expect(ledgerRes.rows[4].sha256).toBe('928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40');
    expect(ledgerRes.rows[5].filename).toBe('0006_orders_and_immutable_commercial_evidence.sql');
    expect(ledgerRes.rows[5].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerRes.rows[6].filename).toBe('0007_property_hub_foundation.sql');
    expect(ledgerRes.rows[6].sha256).toMatch(/^[0-9a-f]{64}$/);

    // Verify row counts across the predecessor and packet fixture inventories.
    const expectedCounts: Record<string, number> = { ...EXPECTED_ROW_COUNTS, ...CATALOG_EXPECTED_ROW_COUNTS };
    for (const [table, count] of Object.entries(CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(ORDER_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, expectedCount] of Object.entries(expectedCounts)) {
      const countRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM medialab_core.${table};`);
      expect(countRes.rows[0].cnt).toBe(expectedCount);
    }

    // Verify no extra views or sequences exist
    const viewsRes = await client.query(
      "SELECT table_name FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(viewsRes.rows).toHaveLength(0);

    const seqRes = await client.query(
      "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(seqRes.rows).toHaveLength(0);

    // Verify the exact released and additive routine inventory.
    const routRes = await client.query(
      `SELECT routine_schema, routine_name, routine_type
       FROM information_schema.routines
       WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY routine_schema, routine_name;`
    );
    expect(routRes.rows).toEqual(
      EXACT_ROUTINE_NAMES.map((routine_name) => ({
        routine_schema: 'medialab_core',
        routine_name,
        routine_type: 'FUNCTION'
      }))
    );

    // Verify the exact released and additive trigger inventory.
    const trigRes = await client.query(
      `SELECT 
          t.tgname AS trigger_name,
          c.relname AS table_name,
          n.nspname AS schema_name,
          p.proname AS function_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY n.nspname, c.relname, t.tgname;`
    );
    expect(trigRes.rows).toEqual(EXACT_TRIGGERS);

    // Verify trigger timing and manipulation events
    const trigEventRes = await client.query(
      `SELECT event_manipulation, action_timing
       FROM information_schema.triggers
       WHERE event_object_schema = 'medialab_core'
         AND event_object_table = 'property_snapshots'
         AND trigger_name = 'property_snapshots_immutability_guard'
       ORDER BY event_manipulation;`
    );
    expect(trigEventRes.rows).toHaveLength(2);
    expect(trigEventRes.rows[0].action_timing).toBe('BEFORE');
    expect(trigEventRes.rows[0].event_manipulation).toBe('DELETE');
    expect(trigEventRes.rows[1].action_timing).toBe('BEFORE');
    expect(trigEventRes.rows[1].event_manipulation).toBe('UPDATE');
  });
});
