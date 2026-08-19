import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import {
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  ORGANIZATION_FIXTURE,
  PEOPLE_FIXTURES
} from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY } from '../db/fixtures/organization-records-dashboard-audited-export-fixtures.js';

const TEST_DB = 'medialab_p02m16a_test';
const OWNER = 'medialab_p02m16a_test_owner';
const RUNTIME = 'medialab_p02m16a_test_app';
const SOCKET = '/tmp/mlvs01-p02m16a-pg';
const PORT = 55447;
const OPERATOR_IDENTITY = IDENTITY_FIXTURES[1].id;
const OPERATOR_PERSON = PEOPLE_FIXTURES[1].id;
const OPERATOR_MEMBERSHIP = MEMBERSHIP_FIXTURES[1].id;
const OWNER_IDENTITY = IDENTITY_FIXTURES[0].id;
const OWNER_PERSON = PEOPLE_FIXTURES[0].id;
const OWNER_MEMBERSHIP = MEMBERSHIP_FIXTURES[0].id;
const ACCEPTED_AT = '2026-08-01T12:00:00.000Z';
const AS_OF = '2099-01-01T00:00:00.000Z';

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

describe('P02-M16-A organization records dashboard and audited export foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;
  const reset = () => resetTestDatabase({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER, runtimeUser: RUNTIME, confirm: TEST_DB });

  async function session(identityId = OPERATOR_IDENTITY): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at)
       VALUES($1,$2,$3,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,
      [crypto.randomUUID(), identityId, digest(token)]
    );
    return token;
  }

  async function order(kind: 'ORGANIZATION' | 'PERSONAL' | 'CONTRADICTORY'): Promise<string> {
    const orderId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO medialab_core.orders
        (id,lane,organization_id,property_id,property_snapshot_id,settlement_mode,currency,item_subtotal_cents,travel_amount_cents,travel_basis,total_amount_cents,current_state,source_system,created_by_identity_id,accepted_by_identity_id,created_at,accepted_at)
       VALUES($1,'COMMERCIAL',$2,NULL,NULL,'PAY_NOW','USD',15000,2500,'Synthetic bounded travel evidence',17500,'ACCEPTED','SYNTHETIC_P02_M15_E_TEST',$3,$3,$4,$4)`,
      [orderId, ORGANIZATION_FIXTURE.id, OPERATOR_IDENTITY, ACCEPTED_AT]
    );
    const parties = kind === 'ORGANIZATION'
      ? [
          ['BILLING_PARTY', 'ORGANIZATION', null, ORGANIZATION_FIXTURE.id, null, 'Synthetic organization payer'],
          ['COMMERCIAL_OWNER', 'ORGANIZATION', null, ORGANIZATION_FIXTURE.id, null, 'Synthetic organization owner']
        ]
      : kind === 'PERSONAL'
        ? [
            ['BILLING_PARTY', 'PERSON', OPERATOR_PERSON, null, OPERATOR_MEMBERSHIP, 'Synthetic personal payer'],
            ['COMMERCIAL_OWNER', 'PERSON', OPERATOR_PERSON, null, OPERATOR_MEMBERSHIP, 'Synthetic personal owner']
          ]
        : [
            ['BILLING_PARTY', 'PERSON', OWNER_PERSON, null, OWNER_MEMBERSHIP, 'Synthetic contradictory payer'],
            ['COMMERCIAL_OWNER', 'PERSON', OPERATOR_PERSON, null, OPERATOR_MEMBERSHIP, 'Synthetic contradictory owner']
          ];
    for (const party of parties) {
      await owner.query(
        `INSERT INTO medialab_core.order_parties
          (id,order_id,party_role,party_kind,person_id,organization_id,membership_id,frozen_display_name,authority_context,source_system,recorded_by_identity_id,recorded_at)
         VALUES($1,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8,'IMMUTABLE_ORDER_PARTY_EVIDENCE','SYNTHETIC_P02_M15_E_TEST',$9,$10)`,
        [crypto.randomUUID(), orderId, ...party, OPERATOR_IDENTITY, ACCEPTED_AT]
      );
    }
    await owner.query(
      `INSERT INTO medialab_core.order_items
        (id,order_id,position,item_kind,commercial_snapshot_id,custom_commercial_snapshot_id,catalog_product_id,frozen_description,quantity,commercial_unit,unit_amount_cents,line_total_cents,currency,source_item_identifier,custom_reason,custom_actor_identity_id,created_at)
       SELECT $1,$2,1,item_kind,commercial_snapshot_id,custom_commercial_snapshot_id,catalog_product_id,
              'Synthetic bounded records service',quantity,commercial_unit,15000,15000,'USD',NULL,NULL,NULL,$3
       FROM medialab_core.order_items WHERE id=$4`,
      [crypto.randomUUID(), orderId, ACCEPTED_AT, ORDER_ITEM_FIXTURES[0].id]
    );
    return orderId;
  }

  async function projection(organization = ORGANIZATION_FIXTURE.id): Promise<any> {
    const result = await owner.query<{ get_internal_organization_records_projection: any }>(
      'SELECT medialab_core.get_internal_organization_records_projection($1,$2,$3,$4)',
      [organization, OWNER_IDENTITY, AS_OF, 'Synthetic owner-only projection evaluation']
    );
    return result.rows[0].get_internal_organization_records_projection;
  }

  async function fails(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
    await expect(promise).rejects.toThrow(pattern);
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER });
    runtime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME });
    await owner.connect();
    await runtime.connect();
  });
  beforeEach(reset);
  afterAll(async () => { await runtime.end(); await owner.end(); await reset(); });

  it('applies 0022 with exact append-only objects, locked functions, and only two runtime commands', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(23);
    expect(ledger.rows[22].filename).toBe('0023_runtime_intake_reconciliation_commands.sql');
    expect(ledger.rows[21].filename).toBe('0022_organization_records_dashboard_audited_export_foundation.sql');

    const tables = await owner.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema='medialab_core' AND table_name LIKE 'organization_record_%' ORDER BY table_name`);
    expect(tables.rows.map(row => row.table_name)).toEqual([
      'organization_record_access_events',
      'organization_record_export_items',
      'organization_record_export_snapshots',
      'organization_record_personal_summary_revocations',
      'organization_record_personal_summary_shares'
    ]);
    const functions = await owner.query(`SELECT p.proname,p.prosecdef,p.proconfig,
        has_function_privilege($1,p.oid,'EXECUTE') runtime,has_function_privilege('public',p.oid,'EXECUTE') public
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='medialab_core' AND p.proname IN (
        'classify_organization_record_order','organization_record_projection_rows','share_personal_order_summary',
        'revoke_personal_order_summary','get_internal_organization_records_projection',
        'create_organization_record_export_snapshot','get_organization_record_export_snapshot'
      ) ORDER BY p.proname`, [RUNTIME]);
    expect(functions.rows).toHaveLength(7);
    expect(functions.rows.filter(row => row.runtime).map(row => row.proname)).toEqual([
      'revoke_personal_order_summary', 'share_personal_order_summary'
    ]);
    expect(functions.rows.some(row => row.public)).toBe(false);
    expect(functions.rows.filter(row => row.prosecdef).every(row => row.proconfig?.[0] === 'search_path=pg_catalog, medialab_core, pg_temp')).toBe(true);
    const dml = await owner.query(`SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('INSERT','UPDATE','DELETE')`, [RUNTIME]);
    expect(dml.rows[0].n).toBe(0);
    expect(ORGANIZATION_RECORDS_AUDITED_EXPORT_FIXTURE_POLICY).toMatchObject({
      customerDashboardRuntimeActivated: false,
      trustedBillingImplemented: false,
      paymentLedgerImplemented: false,
      mediaAuthorityImplemented: false
    });
    await fails(runtime.query('SELECT medialab_core.get_internal_organization_records_projection($1,$2,$3,$4)', [ORGANIZATION_FIXTURE.id, OWNER_IDENTITY, AS_OF, 'Denied customer runtime projection']), /permission denied/i);
  });

  it('classifies only matching immutable payer/owner evidence and fails closed for contradiction or tenant mismatch', async () => {
    const organizationOrder = await order('ORGANIZATION');
    const personalOrder = await order('PERSONAL');
    const contradictoryOrder = await order('CONTRADICTORY');
    const result = await owner.query(
      `SELECT $1::uuid order_id,(medialab_core.classify_organization_record_order($1,$4)).classification classification
       UNION ALL SELECT $2,(medialab_core.classify_organization_record_order($2,$4)).classification
       UNION ALL SELECT $3,(medialab_core.classify_organization_record_order($3,$4)).classification`,
      [organizationOrder, personalOrder, contradictoryOrder, ORGANIZATION_FIXTURE.id]
    );
    expect(result.rows.map(row => row.classification)).toEqual(['ORGANIZATION_FUNDED', 'PERSONAL_FUNDED', 'INELIGIBLE']);
    const wrongTenant = await owner.query(`SELECT classification FROM medialab_core.classify_organization_record_order($1,$2)`, [organizationOrder, crypto.randomUUID()]);
    expect(wrongTenant.rows[0].classification).toBe('INELIGIBLE');
    const rows = (await projection()).rows;
    expect(rows.map((row: any) => row.order_id)).toEqual([organizationOrder]);
    expect(JSON.stringify(rows[0])).toContain('settlement_mode');
    expect(JSON.stringify(rows)).not.toMatch(/property_hub|media_asset|storage_object|credential|provider|filesystem|download/);
  });

  it('keeps personal Orders private, shares only for the exact active owner, and enforces idempotency and denial boundaries', async () => {
    const personalOrder = await order('PERSONAL');
    const operatorToken = await session();
    const ownerToken = await session(OWNER_IDENTITY);
    expect((await projection()).rows).toEqual([]);
    await fails(runtime.query('SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)', [ownerToken, 'foreign-owner', personalOrder, 'Foreign actor denial']), /exact personal commercial owner/i);
    const share = await runtime.query<{ share_personal_order_summary: string }>(
      'SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)',
      [operatorToken, 'stable-share', personalOrder, 'Explicit non-financial organization summary']
    );
    const shareId = share.rows[0].share_personal_order_summary;
    const retry = await runtime.query<{ share_personal_order_summary: string }>(
      'SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)',
      [operatorToken, 'stable-share', personalOrder, 'Explicit non-financial organization summary']
    );
    expect(retry.rows[0].share_personal_order_summary).toBe(shareId);
    await fails(runtime.query('SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)', [operatorToken, 'stable-share', personalOrder, 'Conflicting replay']), /different request/i);
    const sharedRows = (await projection()).rows;
    expect(sharedRows).toHaveLength(1);
    expect(sharedRows[0].record_type).toBe('PERSONAL_SUMMARY_SHARED');
    const serialized = JSON.stringify(sharedRows[0]);
    expect(serialized).not.toMatch(/settlement_mode|_cents|financial|payment|paid|processor|property_hub|media_|storage|credential|provider|download/);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.organization_record_access_events WHERE event_type=$1', ['PERSONAL_SUMMARY_SHARED'])).rows[0].n).toBe(1);
  });

  it('denies suspended or deactivated actors without trusting caller claims', async () => {
    const personalOrder = await order('PERSONAL');
    const token = await session();
    await owner.query(`UPDATE medialab_core.memberships SET status='SUSPENDED',suspended_at=clock_timestamp(),suspension_reason='Synthetic suspension',updated_at=clock_timestamp() WHERE id=$1`, [OPERATOR_MEMBERSHIP]);
    await fails(runtime.query('SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)', [token, 'suspended', personalOrder, 'Suspended denial']), /active membership/i);
    await reset();
    const personalOrder2 = await order('PERSONAL');
    const token2 = await session();
    await owner.query(`UPDATE medialab_core.identities SET status='REVOKED' WHERE id=$1`, [OPERATOR_IDENTITY]);
    await fails(runtime.query('SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)', [token2, 'deactivated', personalOrder2, 'Deactivated denial']), /session is missing|inactive/i);
  });

  it('seals deterministic exports and preserves prior personal rows after later revocation', async () => {
    const organizationOrder = await order('ORGANIZATION');
    const personalOrder = await order('PERSONAL');
    const token = await session();
    const shareId = (await runtime.query<{ share_personal_order_summary: string }>(
      'SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)',
      [token, 'share-for-export', personalOrder, 'Share before sealed export']
    )).rows[0].share_personal_order_summary;
    const exportOne = (await owner.query<{ create_organization_record_export_snapshot: string }>(
      'SELECT medialab_core.create_organization_record_export_snapshot($1,$2,$3,$4,$5,$6)',
      [ORGANIZATION_FIXTURE.id, OWNER_IDENTITY, 'JSON', AS_OF, 'export-one', 'Synthetic deterministic export']
    )).rows[0].create_organization_record_export_snapshot;
    const exportTwo = (await owner.query<{ create_organization_record_export_snapshot: string }>(
      'SELECT medialab_core.create_organization_record_export_snapshot($1,$2,$3,$4,$5,$6)',
      [ORGANIZATION_FIXTURE.id, OWNER_IDENTITY, 'JSON', AS_OF, 'export-two', 'Synthetic deterministic export']
    )).rows[0].create_organization_record_export_snapshot;
    const exports = await owner.query(`SELECT id,row_count,canonical_payload,canonical_payload_sha256 FROM medialab_core.organization_record_export_snapshots WHERE id=ANY($1::uuid[]) ORDER BY id`, [[exportOne, exportTwo]]);
    expect(exports.rows).toHaveLength(2);
    expect(exports.rows.every(row => row.row_count === 2)).toBe(true);
    expect(new Set(exports.rows.map(row => row.canonical_payload_sha256)).size).toBe(1);
    expect(new Set(exports.rows.map(row => row.canonical_payload)).size).toBe(1);
    const membership = await owner.query(`SELECT position,order_id,visibility_basis,personal_summary_share_id,row_payload_sha256 FROM medialab_core.organization_record_export_items WHERE export_snapshot_id=$1 ORDER BY position`, [exportOne]);
    expect(membership.rows.map(row => row.order_id)).toEqual([organizationOrder, personalOrder].sort((a, b) => a.localeCompare(b)));
    expect(membership.rows.find(row => row.order_id === personalOrder)).toMatchObject({ visibility_basis: 'PERSONAL_SUMMARY_SHARED', personal_summary_share_id: shareId });

    const revocation = await runtime.query<{ revoke_personal_order_summary: string }>(
      'SELECT medialab_core.revoke_personal_order_summary($1,$2,$3,$4)',
      [token, 'revoke-after-export', shareId, 'Stop future organization visibility']
    );
    const revokeId = revocation.rows[0].revoke_personal_order_summary;
    const retry = await runtime.query<{ revoke_personal_order_summary: string }>(
      'SELECT medialab_core.revoke_personal_order_summary($1,$2,$3,$4)',
      [token, 'revoke-after-export', shareId, 'Stop future organization visibility']
    );
    expect(retry.rows[0].revoke_personal_order_summary).toBe(revokeId);
    expect((await projection()).rows.map((row: any) => row.order_id)).toEqual([organizationOrder]);
    const frozen = (await owner.query<{ get_organization_record_export_snapshot: any }>(
      'SELECT medialab_core.get_organization_record_export_snapshot($1)', [exportOne]
    )).rows[0].get_organization_record_export_snapshot;
    expect(frozen.items).toHaveLength(2);
    expect(frozen.items.some((item: any) => item.order_id === personalOrder)).toBe(true);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.organization_record_personal_summary_shares WHERE id=$1', [shareId])).rows[0].n).toBe(1);
    expect((await owner.query('SELECT count(*)::int n FROM medialab_core.organization_record_access_events')).rows[0].n).toBeGreaterThanOrEqual(5);
  });

  it('rejects mutation of share, revocation, export, membership, and audit evidence', async () => {
    const personalOrder = await order('PERSONAL');
    const token = await session();
    const shareId = (await runtime.query<{ share_personal_order_summary: string }>('SELECT medialab_core.share_personal_order_summary($1,$2,$3,$4)', [token, 'immutable-share', personalOrder, 'Immutable share'])).rows[0].share_personal_order_summary;
    const exportId = (await owner.query<{ create_organization_record_export_snapshot: string }>('SELECT medialab_core.create_organization_record_export_snapshot($1,$2,$3,$4,$5,$6)', [ORGANIZATION_FIXTURE.id, OWNER_IDENTITY, 'CSV', AS_OF, 'immutable-export', 'Immutable export'])).rows[0].create_organization_record_export_snapshot;
    await fails(owner.query('UPDATE medialab_core.organization_record_personal_summary_shares SET reason=$1 WHERE id=$2', ['Rewrite', shareId]), /append-only and immutable/i);
    await fails(owner.query('UPDATE medialab_core.organization_record_export_snapshots SET row_count=0 WHERE id=$1', [exportId]), /append-only and immutable/i);
    await fails(owner.query('DELETE FROM medialab_core.organization_record_export_items WHERE export_snapshot_id=$1', [exportId]), /append-only and immutable/i);
    await fails(owner.query('DELETE FROM medialab_core.organization_record_access_events'), /append-only and immutable/i);
  });
});
