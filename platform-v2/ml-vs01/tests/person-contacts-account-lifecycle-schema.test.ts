import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { runMigrations } from '../db/migrate.js';

const TEST_DB = 'medialab_p02m08a_test';
const TEST_OWNER_ROLE = 'medialab_p02m08a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m08a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m08a-pg';
const TEST_PORT = 55438;

const OWNER_PERSON_ID = '034a2b54-4665-5917-90a6-ae40adb3c8aa';
const OWNER_IDENTITY_ID = 'e69ced56-a63e-57bf-a6b5-26d5fe6cc5c5';
const OPERATOR_PERSON_ID = 'd43d9499-efbd-5116-b561-67dd34d1df8d';
const OPERATOR_IDENTITY_ID = '87c0043a-334f-548c-95d7-d53939ab054b';

const PUBLIC_APIS = [
  'correct_contact_method',
  'create_contact_method',
  'invalidate_contact_verification',
  'record_contact_verification',
  'replace_primary_email',
  'retire_contact_method',
  'transition_account_lifecycle'
];

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

const CATALOG_ADMIN_APIS = [
  'create_catalog_draft_product',
  'delete_catalog_draft_product',
  'get_catalog_administration_products',
  'publish_catalog_draft_product',
  'revise_catalog_draft_product',
  'revise_published_catalog_product_definition',
  'set_catalog_product_archived'
];

const ORDER_APIS = ['create_order', 'get_order_record'];
const PROPERTY_HUB_APIS = ['create_property_hub', 'get_property_hub_record'];
const SCHEDULING_APIS = [
  'accept_scheduling_proposal',
  'add_scheduling_requested_window',
  'assign_appointment_participant',
  'cancel_appointment',
  'close_scheduling_request',
  'confirm_appointment',
  'create_scheduling_request',
  'end_appointment_participant_assignment',
  'get_appointment_record',
  'get_scheduling_request_record',
  'propose_scheduling_window',
  'record_appointment_no_show',
  'record_appointment_unable_to_complete',
  'record_appointment_weather_delay',
  'record_scheduling_offline_acceptance',
  'replace_appointment_participant_assignment',
  'supersede_and_reschedule_appointment',
  'withdraw_scheduling_request'
];

const JOB_SERVICE_APIS = [
  'create_job',
  'create_service_workstream',
  'get_job_record',
  'get_service_workstream_record',
  'link_job_appointment',
  'record_job_service_external_reference',
  'transition_job_state',
  'transition_service_workstream_state'
];

const MISSION_PLAN_APIS = [
  'add_mission_plan_note',
  'create_mission_plan_draft',
  'create_mission_plan_superseding_draft',
  'get_mission_plan_record',
  'get_mission_plan_sensitive_envelopes',
  'issue_mission_plan_version',
  'list_mission_plans',
  'record_mission_plan_open_event',
  'record_mission_plan_sensitive_envelope',
  'refresh_mission_plan_draft',
  'replace_mission_plan_draft_contacts',
  'replace_mission_plan_draft_workstreams',
  'revise_mission_plan_draft'
];

const MEDIA_ASSET_APIS = [
  'add_media_asset_version',
  'create_media_asset',
  'create_media_manifest',
  'designate_media_approved_source',
  'get_media_asset_record',
  'get_media_manifest',
  'record_media_capture_relationship',
  'record_media_lineage',
  'record_media_location_observation',
  'record_media_storage_object',
  'record_media_transfer_event',
  'record_media_verification_event'
];

const ALL_RUNTIME_APIS = [
  ...PUBLIC_APIS,
  ...CATALOG_APIS,
  ...CATALOG_ADMIN_APIS,
  ...ORDER_APIS,
  ...PROPERTY_HUB_APIS,
  ...SCHEDULING_APIS,
  ...JOB_SERVICE_APIS,
  ...MISSION_PLAN_APIS,
  ...MEDIA_ASSET_APIS
].sort();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function waitForBlockingPid(
  observer: pg.Client,
  blockedPid: number,
  blockerPid: number
): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ is_blocked: boolean }>(
      'SELECT $1::integer = ANY(pg_catalog.pg_blocking_pids($2::integer)) AS is_blocked',
      [blockerPid, blockedPid]
    );
    if (result.rows[0].is_blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for backend ${blockedPid} to be blocked by backend ${blockerPid}`);
}

describe('P02-M02-A Person Contacts and Account Lifecycle', () => {
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

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await owner.end();
    await runtime.end();
    await reset();
  });

  async function expectDbError(client: pg.Client, sql: string, params: unknown[] = []): Promise<void> {
    await expect(client.query(sql, params)).rejects.toThrow();
  }

  async function issueOrdinarySession(
    identityId: string,
    options: { expired?: boolean; revoked?: boolean } = {}
  ): Promise<string> {
    const token = randomToken();
    const now = Date.now();
    const issuedAt = new Date(now - 60_000);
    const expiresAt = options.expired ? new Date(now - 1_000) : new Date(now + 3_600_000);
    const revokedAt = options.revoked ? new Date(now - 500) : null;
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), identityId, tokenDigest(token), issuedAt, expiresAt, revokedAt]
    );
    return token;
  }

  async function issueRecoverySession(
    identityId: string,
    options: { expired?: boolean; revoked?: boolean; consumed?: boolean } = {}
  ): Promise<{ id: string; token: string }> {
    const id = crypto.randomUUID();
    const token = randomToken();
    const now = Date.now();
    const issuedAt = new Date(now - 60_000);
    const expiresAt = options.expired ? new Date(now - 1_000) : new Date(now + 900_000);
    const revokedAt = options.revoked ? new Date(now - 500) : null;
    const consumedAt = options.consumed ? new Date(now - 500) : null;
    await owner.query(
      `INSERT INTO medialab_core.account_recovery_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, revoked_at, consumed_at,
          external_authentication_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        identityId,
        tokenDigest(token),
        issuedAt,
        expiresAt,
        revokedAt,
        consumedAt,
        `local-test-auth:${id}`
      ]
    );
    return { id, token };
  }

  async function activeEmailContact(personId: string): Promise<{ id: string; normalized_value: string }> {
    const result = await owner.query(
      `SELECT id, normalized_value
         FROM medialab_core.contact_methods
        WHERE person_id = $1
          AND contact_type = 'EMAIL'
          AND lifecycle_state = 'ACTIVE'`,
      [personId]
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0] as { id: string; normalized_value: string };
  }

  async function createContact(
    sessionToken: string,
    personId: string,
    contactType: 'EMAIL' | 'PHONE',
    submittedValue: string
  ): Promise<string> {
    const id = crypto.randomUUID();
    await runtime.query(
      'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
      [id, sessionToken, personId, contactType, submittedValue]
    );
    return id;
  }

  async function verifyContact(
    sessionToken: string,
    contactMethodId: string,
    channel = 'EMAIL_LINK'
  ): Promise<string> {
    const id = crypto.randomUUID();
    await runtime.query(
      'SELECT medialab_core.record_contact_verification($1, $2, $3, $4, $5, $6)',
      [id, sessionToken, contactMethodId, new Date().toISOString(), channel, `evidence:${id}`]
    );
    return id;
  }

  async function transition(
    bearerToken: string,
    personId: string,
    identityId: string,
    newState: string,
    reason: string,
    startFresh = false
  ): Promise<string> {
    const id = crypto.randomUUID();
    await runtime.query(
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [id, bearerToken, personId, identityId, newState, reason, startFresh]
    );
    return id;
  }

  async function deactivateOperator(): Promise<void> {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await transition(
      token,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'DEACTIVATED',
      'Holder deactivation'
    );
  }

  it('1 & 2. fresh reset applies 0001 through 0011 and an identical rerun skips all eleven', async () => {
    const ledger = await owner.query('SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows.map((row) => row.filename)).toEqual([
      '0001_identity_and_tenancy.sql',
      '0002_property_identity_and_snapshots.sql',
      '0003_person_contacts_and_account_lifecycle.sql',
      '0004_current_catalog_and_price_snapshots.sql',
      '0005_catalog_administration_lifecycle.sql',
      '0006_orders_and_immutable_commercial_evidence.sql',
      '0007_property_hub_foundation.sql',
      '0008_scheduling_request_and_appointment_foundation.sql',
      '0009_job_and_service_workstream_foundation.sql',
      '0010_mission_plan_foundation.sql',
      '0011_media_asset_identity_and_lineage_foundation.sql'
    ]);

    const result = await runMigrations({
      migrationsDir: path.resolve(__dirname, '../db/migrations'),
      client: owner,
      runtimeUser: TEST_RUNTIME_ROLE
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([
      '0001_identity_and_tenancy.sql',
      '0002_property_identity_and_snapshots.sql',
      '0003_person_contacts_and_account_lifecycle.sql',
      '0004_current_catalog_and_price_snapshots.sql',
      '0005_catalog_administration_lifecycle.sql',
      '0006_orders_and_immutable_commercial_evidence.sql',
      '0007_property_hub_foundation.sql',
      '0008_scheduling_request_and_appointment_foundation.sql',
      '0009_job_and_service_workstream_foundation.sql',
      '0010_mission_plan_foundation.sql',
      '0011_media_asset_identity_and_lineage_foundation.sql'
    ]);
  });

  it('3 & 4. ordinary bearer authentication normalizes contacts and rejects duplicate email', async () => {
    const token = await issueOrdinarySession(OWNER_IDENTITY_ID);
    const phoneId = await createContact(token, OWNER_PERSON_ID, 'PHONE', '  +1 (212) 555-0100  ');
    const phone = await owner.query(
      'SELECT submitted_value, normalized_value FROM medialab_core.contact_methods WHERE id = $1',
      [phoneId]
    );
    expect(phone.rows[0]).toEqual({
      submitted_value: '  +1 (212) 555-0100  ',
      normalized_value: '+1 (212) 555-0100'
    });

    await expectDbError(
      runtime,
      'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), token, OWNER_PERSON_ID, 'EMAIL', '  OWNER@fixture.medialab.invalid  ']
    );
  });

  it('5, 8, 9 & 10. verified replacement preserves Person, Identity, contact history, and separate evidence', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const oldContact = await activeEmailContact(OPERATOR_PERSON_ID);
    const newContactId = await createContact(
      token,
      OPERATOR_PERSON_ID,
      'EMAIL',
      '  replacement@fixture.medialab.invalid '
    );
    await verifyContact(token, newContactId);
    const before = await owner.query(
      `SELECT p.id AS person_id, p.email, i.id AS identity_id
         FROM medialab_core.people p
         JOIN medialab_core.identities i ON i.person_id = p.id
        WHERE p.id = $1`,
      [OPERATOR_PERSON_ID]
    );

    await runtime.query(
      'SELECT medialab_core.replace_primary_email($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), token, OPERATOR_PERSON_ID, newContactId, 'Verified replacement']
    );

    const after = await owner.query(
      `SELECT p.id AS person_id, p.email, i.id AS identity_id
         FROM medialab_core.people p
         JOIN medialab_core.identities i ON i.person_id = p.id
        WHERE p.id = $1`,
      [OPERATOR_PERSON_ID]
    );
    expect(after.rows[0].person_id).toBe(before.rows[0].person_id);
    expect(after.rows[0].identity_id).toBe(before.rows[0].identity_id);
    expect(after.rows[0].email).toBe('replacement@fixture.medialab.invalid');

    const contacts = await owner.query(
      'SELECT id, lifecycle_state FROM medialab_core.contact_methods WHERE id IN ($1, $2)',
      [oldContact.id, newContactId]
    );
    expect(contacts.rows).toHaveLength(2);
    expect(contacts.rows.find((row) => row.id === oldContact.id)?.lifecycle_state).toBe('SUPERSEDED');
    expect(contacts.rows.find((row) => row.id === newContactId)?.lifecycle_state).toBe('ACTIVE');

    const evidence = await owner.query(
      `SELECT contact_method_id
         FROM medialab_core.contact_verification_evidence
        WHERE contact_method_id IN ($1, $2)`,
      [oldContact.id, newContactId]
    );
    expect(evidence.rows.some((row) => row.contact_method_id === oldContact.id)).toBe(true);
    expect(evidence.rows.filter((row) => row.contact_method_id === newContactId)).toHaveLength(1);
  });

  it('6 & 23. unverified primary replacement fails without partial evidence or state writes', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const newContactId = await createContact(
      token,
      OPERATOR_PERSON_ID,
      'EMAIL',
      'unverified@fixture.medialab.invalid'
    );
    const before = await owner.query(
      `SELECT email,
              (SELECT count(*)::int FROM medialab_core.primary_email_replacements) AS replacement_count,
              (SELECT count(*)::int FROM medialab_core.contact_method_supersessions) AS supersession_count
         FROM medialab_core.people WHERE id = $1`,
      [OPERATOR_PERSON_ID]
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.replace_primary_email($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), token, OPERATOR_PERSON_ID, newContactId, 'Must fail']
    );
    const after = await owner.query(
      `SELECT email,
              (SELECT count(*)::int FROM medialab_core.primary_email_replacements) AS replacement_count,
              (SELECT count(*)::int FROM medialab_core.contact_method_supersessions) AS supersession_count
         FROM medialab_core.people WHERE id = $1`,
      [OPERATOR_PERSON_ID]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('7 & 14. another Person contact and another Person session cannot authorize a protected mutation', async () => {
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    const operatorToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const ownerContact = await activeEmailContact(OWNER_PERSON_ID);
    await expectDbError(
      runtime,
      'SELECT medialab_core.replace_primary_email($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), operatorToken, OPERATOR_PERSON_ID, ownerContact.id, 'Cross-person attempt']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), ownerToken, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0199']
    );
  });

  it('8 & 15. direct people.email update and a caller-controlled custom setting cannot bypass protection', async () => {
    await runtime.query("SELECT set_config('medialab.allow_primary_email_update', 'true', true)");
    await expectDbError(
      runtime,
      'UPDATE medialab_core.people SET email = $1, updated_at = clock_timestamp() WHERE id = $2',
      ['spoofed@fixture.medialab.invalid', OPERATOR_PERSON_ID]
    );
  });

  it('11 & 12. verification evidence cannot be updated or deleted', async () => {
    const evidence = await owner.query(
      `SELECT v.id
         FROM medialab_core.contact_verification_evidence v
         JOIN medialab_core.contact_methods c ON c.id = v.contact_method_id
        WHERE c.person_id = $1 LIMIT 1`,
      [OWNER_PERSON_ID]
    );
    await expectDbError(
      owner,
      "UPDATE medialab_core.contact_verification_evidence SET verified_at = verified_at + interval '1 second' WHERE id = $1",
      [evidence.rows[0].id]
    );
    await expectDbError(
      owner,
      'DELETE FROM medialab_core.contact_verification_evidence WHERE id = $1',
      [evidence.rows[0].id]
    );
  });

  it('13. correction creates a new contact and immutable supersession evidence without transferring verification', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const oldPhoneId = await createContact(token, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0101');
    await verifyContact(token, oldPhoneId, 'SMS_CODE');
    const newPhoneId = crypto.randomUUID();
    const supersessionId = crypto.randomUUID();
    await runtime.query(
      'SELECT medialab_core.correct_contact_method($1, $2, $3, $4, $5, $6)',
      [supersessionId, newPhoneId, token, oldPhoneId, '+1 212 555 0102', 'Corrected digit']
    );

    const contacts = await owner.query(
      'SELECT id, lifecycle_state FROM medialab_core.contact_methods WHERE id IN ($1, $2)',
      [oldPhoneId, newPhoneId]
    );
    expect(contacts.rows.find((row) => row.id === oldPhoneId)?.lifecycle_state).toBe('SUPERSEDED');
    expect(contacts.rows.find((row) => row.id === newPhoneId)?.lifecycle_state).toBe('ACTIVE');
    const relation = await owner.query(
      `SELECT previous_contact_method_id, replacement_contact_method_id, recorded_by_identity_id
         FROM medialab_core.contact_method_supersessions WHERE id = $1`,
      [supersessionId]
    );
    expect(relation.rows[0]).toEqual({
      previous_contact_method_id: oldPhoneId,
      replacement_contact_method_id: newPhoneId,
      recorded_by_identity_id: OPERATOR_IDENTITY_ID
    });
    const newEvidence = await owner.query(
      'SELECT count(*)::int AS count FROM medialab_core.contact_verification_evidence WHERE contact_method_id = $1',
      [newPhoneId]
    );
    expect(newEvidence.rows[0].count).toBe(0);
    await expectDbError(
      owner,
      'DELETE FROM medialab_core.contact_method_supersessions WHERE id = $1',
      [supersessionId]
    );
  });

  it('ordinary actor binding accepts only a valid, current, unrevoked bearer token', async () => {
    const validToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await createContact(validToken, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0110');

    await expectDbError(
      runtime,
      'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), randomToken(), OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0111']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), `${validToken}wrong`, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0112']
    );

    const expiredToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID, { expired: true });
    const revokedToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID, { revoked: true });
    for (const token of [expiredToken, revokedToken]) {
      await expectDbError(
        runtime,
        'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
        [crypto.randomUUID(), token, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0113']
      );
    }
  });

  it('ordinary session FOR SHARE blocks concurrent revocation until the authorized mutation commits', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const digest = tokenDigest(token);
    const committedContactId = crypto.randomUUID();
    const rejectedContactId = crypto.randomUUID();
    const revoker = new pg.Client({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_OWNER_ROLE
    });
    let revokerConnected = false;
    let runtimeTransactionOpen = false;
    let revocation: Promise<pg.QueryResult<{ revoked_at: Date }>> | null = null;

    const personState = async (): Promise<Record<string, number>> => {
      const result = await owner.query(
        `SELECT
           (SELECT count(*)::int FROM medialab_core.contact_methods WHERE person_id = $1) AS contact_count,
           (SELECT count(*)::int FROM medialab_core.contact_verification_evidence v
             JOIN medialab_core.contact_methods c ON c.id = v.contact_method_id
            WHERE c.person_id = $1) AS verification_count,
           (SELECT count(*)::int FROM medialab_core.contact_method_supersessions s
             JOIN medialab_core.contact_methods c ON c.id = s.previous_contact_method_id
            WHERE c.person_id = $1) AS supersession_count,
           (SELECT count(*)::int FROM medialab_core.contact_method_retirements r
             JOIN medialab_core.contact_methods c ON c.id = r.contact_method_id
            WHERE c.person_id = $1) AS retirement_count,
           (SELECT count(*)::int FROM medialab_core.primary_email_replacements WHERE person_id = $1) AS replacement_count,
           (SELECT count(*)::int FROM medialab_core.account_lifecycle_transitions WHERE person_id = $1) AS transition_count`,
        [OPERATOR_PERSON_ID]
      );
      return result.rows[0] as Record<string, number>;
    };

    const before = await personState();
    try {
      await revoker.connect();
      revokerConnected = true;
      await revoker.query("SET statement_timeout = '5000ms'");
      const runtimePid = Number((await runtime.query('SELECT pg_catalog.pg_backend_pid() AS pid')).rows[0].pid);
      const revokerPid = Number((await revoker.query('SELECT pg_catalog.pg_backend_pid() AS pid')).rows[0].pid);

      await runtime.query('BEGIN');
      runtimeTransactionOpen = true;
      await runtime.query(
        'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
        [committedContactId, token, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0160']
      );

      let revocationSettled = false;
      revocation = revoker
        .query<{ revoked_at: Date }>(
          `UPDATE medialab_core.development_sessions
              SET revoked_at = pg_catalog.clock_timestamp()
            WHERE token_sha256 = $1
          RETURNING revoked_at`,
          [digest]
        )
        .finally(() => {
          revocationSettled = true;
        });

      await waitForBlockingPid(owner, revokerPid, runtimePid);
      expect(revocationSettled).toBe(false);
      const invisibleBeforeCommit = await owner.query(
        'SELECT count(*)::int AS count FROM medialab_core.contact_methods WHERE id = $1',
        [committedContactId]
      );
      expect(invisibleBeforeCommit.rows[0].count).toBe(0);

      await runtime.query('COMMIT');
      runtimeTransactionOpen = false;
      const revocationResult = await revocation;
      expect(revocationResult.rowCount).toBe(1);
      expect(revocationSettled).toBe(true);

      await expectDbError(
        runtime,
        'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
        [rejectedContactId, token, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0161']
      );

      const committed = await owner.query(
        `SELECT person_id, created_by_identity_id, lifecycle_state
           FROM medialab_core.contact_methods WHERE id = $1`,
        [committedContactId]
      );
      expect(committed.rows[0]).toEqual({
        person_id: OPERATOR_PERSON_ID,
        created_by_identity_id: OPERATOR_IDENTITY_ID,
        lifecycle_state: 'ACTIVE'
      });
      const finalSession = await owner.query(
        `SELECT revoked_at IS NOT NULL AS revoked,
                (SELECT count(*)::int FROM medialab_core.contact_methods WHERE id = $2) AS rejected_count
           FROM medialab_core.development_sessions WHERE token_sha256 = $1`,
        [digest, rejectedContactId]
      );
      expect(finalSession.rows[0]).toEqual({ revoked: true, rejected_count: 0 });

      const after = await personState();
      expect(after).toEqual({ ...before, contact_count: before.contact_count + 1 });
    } finally {
      if (runtimeTransactionOpen) await runtime.query('ROLLBACK');
      if (revocation) await revocation.catch(() => undefined);
      if (revokerConnected) await revoker.end();
    }
  });

  it('temporary relation shadowing cannot alter protected authentication, authorization, evidence, or mutation results', async () => {
    const validToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const forgedToken = randomToken();
    const forgedContactId = crypto.randomUUID();
    const validContactId = crypto.randomUUID();
    const now = Date.now();

    try {
      await runtime.query(
        `CREATE TEMP TABLE development_sessions (
           id uuid PRIMARY KEY,
           identity_id uuid NOT NULL,
           token_sha256 text NOT NULL,
           issued_at timestamptz NOT NULL,
           expires_at timestamptz NOT NULL,
           revoked_at timestamptz NULL
         )`
      );
      await runtime.query('CREATE TEMP TABLE contact_methods (id uuid PRIMARY KEY, marker text NULL)');
      await runtime.query(
        `INSERT INTO pg_temp.development_sessions
           (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, NULL)`,
        [
          crypto.randomUUID(),
          OWNER_IDENTITY_ID,
          tokenDigest(forgedToken),
          new Date(now - 60_000),
          new Date(now + 3_600_000)
        ]
      );

      await expectDbError(
        runtime,
        'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
        [forgedContactId, forgedToken, OWNER_PERSON_ID, 'PHONE', '+1 212 555 0170']
      );
      await runtime.query(
        'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
        [validContactId, validToken, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0171']
      );

      const temporary = await runtime.query(
        `SELECT
           (SELECT count(*)::int FROM pg_temp.development_sessions) AS authentication_rows,
           (SELECT count(*)::int FROM pg_temp.contact_methods) AS mutation_rows`
      );
      expect(temporary.rows[0]).toEqual({ authentication_rows: 1, mutation_rows: 0 });

      const canonical = await owner.query(
        `SELECT id, person_id, created_by_identity_id, lifecycle_state,
                (SELECT count(*)::int FROM medialab_core.contact_verification_evidence
                  WHERE contact_method_id IN ($1, $2)) AS evidence_count
           FROM medialab_core.contact_methods
          WHERE id IN ($1, $2)
          ORDER BY id`,
        [forgedContactId, validContactId]
      );
      expect(canonical.rows).toEqual([
        {
          id: validContactId,
          person_id: OPERATOR_PERSON_ID,
          created_by_identity_id: OPERATOR_IDENTITY_ID,
          lifecycle_state: 'ACTIVE',
          evidence_count: 0
        }
      ]);

      const searchPaths = await owner.query(
        `SELECT p.proname, p.proconfig
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'medialab_core' AND p.prosecdef
          ORDER BY p.proname`
      );
      expect(searchPaths.rows).toHaveLength(128);
      for (const row of searchPaths.rows) {
        expect(row.proconfig).toEqual(['search_path=pg_catalog, medialab_core, pg_temp']);
      }
    } finally {
      await runtime.query('DROP TABLE IF EXISTS pg_temp.contact_methods');
      await runtime.query('DROP TABLE IF EXISTS pg_temp.development_sessions');
    }
  });

  it('invalidated verification cannot authorize primary replacement', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const contactId = await createContact(
      token,
      OPERATOR_PERSON_ID,
      'EMAIL',
      'invalidated@fixture.medialab.invalid'
    );
    const verificationId = await verifyContact(token, contactId);
    await runtime.query(
      'SELECT medialab_core.invalidate_contact_verification($1, $2, $3, $4)',
      [crypto.randomUUID(), token, verificationId, 'Evidence withdrawn']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.replace_primary_email($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), token, OPERATOR_PERSON_ID, contactId, 'Must fail']
    );
  });

  it('16 & 18. valid admin lifecycle transitions append evidence and revoke target sessions', async () => {
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    const operatorToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await transition(
      ownerToken,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'SUSPENDED',
      'Administrative suspension'
    );
    await transition(
      ownerToken,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'ACTIVE',
      'Administrative reinstatement'
    );
    const evidence = await owner.query(
      `SELECT previous_state, new_state, recorded_by_identity_id
         FROM medialab_core.account_lifecycle_transitions
        WHERE person_id = $1 ORDER BY transitioned_at, id`,
      [OPERATOR_PERSON_ID]
    );
    expect(evidence.rows).toEqual([
      { previous_state: 'ACTIVE', new_state: 'SUSPENDED', recorded_by_identity_id: OWNER_IDENTITY_ID },
      { previous_state: 'SUSPENDED', new_state: 'ACTIVE', recorded_by_identity_id: OWNER_IDENTITY_ID }
    ]);
    const session = await owner.query(
      `SELECT revoked_at IS NOT NULL AS revoked
         FROM medialab_core.development_sessions WHERE token_sha256 = $1`,
      [tokenDigest(operatorToken)]
    );
    expect(session.rows[0].revoked).toBe(true);
  });

  it('17 & 23. invalid lifecycle transitions fail without state, evidence, or partial writes', async () => {
    const token = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const before = await owner.query(
      `SELECT current_state,
              (SELECT count(*)::int FROM medialab_core.account_lifecycle_transitions WHERE person_id = $1) AS transition_count
         FROM medialab_core.person_account_states WHERE person_id = $1`,
      [OPERATOR_PERSON_ID]
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [crypto.randomUUID(), token, OPERATOR_PERSON_ID, OPERATOR_IDENTITY_ID, 'RECOVERED', 'Invalid', false]
    );
    const after = await owner.query(
      `SELECT current_state,
              (SELECT count(*)::int FROM medialab_core.account_lifecycle_transitions WHERE person_id = $1) AS transition_count
         FROM medialab_core.person_account_states WHERE person_id = $1`,
      [OPERATOR_PERSON_ID]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('18. lifecycle transition evidence cannot be updated or deleted', async () => {
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    const transitionId = await transition(
      ownerToken,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'SUSPENDED',
      'Immutable evidence test'
    );
    await expectDbError(
      owner,
      'UPDATE medialab_core.account_lifecycle_transitions SET reason = $1 WHERE id = $2',
      ['Tampered', transitionId]
    );
    await expectDbError(
      owner,
      'DELETE FROM medialab_core.account_lifecycle_transitions WHERE id = $1',
      [transitionId]
    );
  });

  it('19 & 20. single-use recovery retains Person and Identity and records start-fresh intent', async () => {
    const before = await owner.query(
      `SELECT p.id AS person_id, i.id AS identity_id,
              (SELECT count(*)::int FROM medialab_core.memberships WHERE person_id = p.id) AS membership_count,
              (SELECT count(*)::int FROM medialab_core.contact_methods WHERE person_id = p.id) AS contact_count
         FROM medialab_core.people p
         JOIN medialab_core.identities i ON i.person_id = p.id
        WHERE p.id = $1`,
      [OPERATOR_PERSON_ID]
    );
    await deactivateOperator();
    const recovery = await issueRecoverySession(OPERATOR_IDENTITY_ID);
    const recoveryId = await transition(
      recovery.token,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'RECOVERED',
      'Externally authenticated recovery',
      true
    );

    const after = await owner.query(
      `SELECT p.id AS person_id, i.id AS identity_id,
              (SELECT count(*)::int FROM medialab_core.memberships WHERE person_id = p.id) AS membership_count,
              (SELECT count(*)::int FROM medialab_core.contact_methods WHERE person_id = p.id) AS contact_count
         FROM medialab_core.people p
         JOIN medialab_core.identities i ON i.person_id = p.id
        WHERE p.id = $1`,
      [OPERATOR_PERSON_ID]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const evidence = await owner.query(
      `SELECT previous_state, new_state, recovery_mode, recorded_by_identity_id
         FROM medialab_core.account_lifecycle_transitions WHERE id = $1`,
      [recoveryId]
    );
    expect(evidence.rows[0]).toEqual({
      previous_state: 'DEACTIVATED',
      new_state: 'RECOVERED',
      recovery_mode: 'START_FRESH',
      recorded_by_identity_id: OPERATOR_IDENTITY_ID
    });
    const consumed = await owner.query(
      'SELECT consumed_at IS NOT NULL AS consumed FROM medialab_core.account_recovery_sessions WHERE id = $1',
      [recovery.id]
    );
    expect(consumed.rows[0].consumed).toBe(true);
    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [
        crypto.randomUUID(),
        recovery.token,
        OPERATOR_PERSON_ID,
        OPERATOR_IDENTITY_ID,
        'ACTIVE',
        'Consumed token cannot activate',
        false
      ]
    );
  });

  it('ordinary and recovery bearer types cannot cross their authorized mutation boundaries', async () => {
    const ordinaryToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const phoneId = await createContact(ordinaryToken, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0120');
    const emailId = await createContact(
      ordinaryToken,
      OPERATOR_PERSON_ID,
      'EMAIL',
      'recovery-boundary@fixture.medialab.invalid'
    );
    await verifyContact(ordinaryToken, emailId);
    await transition(
      ordinaryToken,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'DEACTIVATED',
      'Boundary test deactivation'
    );
    const recovery = await issueRecoverySession(OPERATOR_IDENTITY_ID);

    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [
        crypto.randomUUID(),
        ordinaryToken,
        OPERATOR_PERSON_ID,
        OPERATOR_IDENTITY_ID,
        'RECOVERED',
        'Ordinary session cannot recover',
        false
      ]
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.create_contact_method($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), recovery.token, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0120']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.record_contact_verification($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), recovery.token, phoneId, new Date().toISOString(), 'SMS_CODE', null]
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.correct_contact_method($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), crypto.randomUUID(), recovery.token, phoneId, '+1 212 555 0121', 'Rejected']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.retire_contact_method($1, $2, $3, $4)',
      [crypto.randomUUID(), recovery.token, phoneId, 'Rejected']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.replace_primary_email($1, $2, $3, $4, $5)',
      [crypto.randomUUID(), recovery.token, OPERATOR_PERSON_ID, emailId, 'Rejected']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [
        crypto.randomUUID(),
        recovery.token,
        OPERATOR_PERSON_ID,
        OPERATOR_IDENTITY_ID,
        'ACTIVE',
        'Recovery token cannot perform ordinary transition',
        false
      ]
    );
  });

  it('recovery tokens reject another Identity, expiration, revocation, consumption, and reuse', async () => {
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    await transition(ownerToken, OWNER_PERSON_ID, OWNER_IDENTITY_ID, 'DEACTIVATED', 'Owner deactivation');
    const operatorRecovery = await issueRecoverySession(OPERATOR_IDENTITY_ID);
    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [
        crypto.randomUUID(),
        operatorRecovery.token,
        OWNER_PERSON_ID,
        OWNER_IDENTITY_ID,
        'RECOVERED',
        'Wrong identity',
        false
      ]
    );

    await reset();
    await deactivateOperator();
    const invalidRecoveries = [
      await issueRecoverySession(OPERATOR_IDENTITY_ID, { expired: true }),
      await issueRecoverySession(OPERATOR_IDENTITY_ID, { revoked: true }),
      await issueRecoverySession(OPERATOR_IDENTITY_ID, { consumed: true })
    ];
    for (const recovery of invalidRecoveries) {
      await expectDbError(
        runtime,
        'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
        [
          crypto.randomUUID(),
          recovery.token,
          OPERATOR_PERSON_ID,
          OPERATOR_IDENTITY_ID,
          'RECOVERED',
          'Invalid recovery credential',
          false
        ]
      );
    }

    const validRecovery = await issueRecoverySession(OPERATOR_IDENTITY_ID);
    await transition(
      validRecovery.token,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'RECOVERED',
      'Consume once'
    );
    const newOrdinaryToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await transition(
      newOrdinaryToken,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'ACTIVE',
      'Activate after recovery'
    );
    await transition(
      newOrdinaryToken,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'DEACTIVATED',
      'Deactivate again'
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [
        crypto.randomUUID(),
        validRecovery.token,
        OPERATOR_PERSON_ID,
        OPERATOR_IDENTITY_ID,
        'RECOVERED',
        'Consumed recovery token cannot be reused',
        false
      ]
    );
  });

  it('failed recovery rolls back token consumption', async () => {
    await deactivateOperator();
    const recovery = await issueRecoverySession(OPERATOR_IDENTITY_ID);
    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [
        crypto.randomUUID(),
        recovery.token,
        OPERATOR_PERSON_ID,
        OPERATOR_IDENTITY_ID,
        'RECOVERED',
        ' ',
        false
      ]
    );
    const state = await owner.query(
      `SELECT s.current_state, r.consumed_at
         FROM medialab_core.person_account_states s
         CROSS JOIN medialab_core.account_recovery_sessions r
        WHERE s.identity_id = $1 AND r.id = $2`,
      [OPERATOR_IDENTITY_ID, recovery.id]
    );
    expect(state.rows[0]).toEqual({ current_state: 'DEACTIVATED', consumed_at: null });
  });

  it('RECOVERED to ACTIVE rejects recovery credentials and requires a newly issued ordinary session', async () => {
    await deactivateOperator();
    const recovery = await issueRecoverySession(OPERATOR_IDENTITY_ID);
    await transition(
      recovery.token,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'RECOVERED',
      'Recovery'
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.transition_account_lifecycle($1, $2, $3, $4, $5, $6, $7)',
      [
        crypto.randomUUID(),
        recovery.token,
        OPERATOR_PERSON_ID,
        OPERATOR_IDENTITY_ID,
        'ACTIVE',
        'Recovery token rejected',
        false
      ]
    );
    const newOrdinaryToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    await transition(
      newOrdinaryToken,
      OPERATOR_PERSON_ID,
      OPERATOR_IDENTITY_ID,
      'ACTIVE',
      'New ordinary session activates'
    );
    const state = await owner.query(
      'SELECT current_state FROM medialab_core.person_account_states WHERE identity_id = $1',
      [OPERATOR_IDENTITY_ID]
    );
    expect(state.rows[0].current_state).toBe('ACTIVE');
  });

  it('retirement is authenticated, attributable, immutable, history-preserving, and primary-safe', async () => {
    const operatorToken = await issueOrdinarySession(OPERATOR_IDENTITY_ID);
    const ownerToken = await issueOrdinarySession(OWNER_IDENTITY_ID);
    const phoneId = await createContact(operatorToken, OPERATOR_PERSON_ID, 'PHONE', '+1 212 555 0130');
    await verifyContact(operatorToken, phoneId, 'SMS_CODE');
    const retirementId = crypto.randomUUID();
    await runtime.query(
      'SELECT medialab_core.retire_contact_method($1, $2, $3, $4)',
      [retirementId, operatorToken, phoneId, 'Number withdrawn']
    );

    const retired = await owner.query(
      `SELECT c.lifecycle_state, c.normalized_value, r.recorded_by_identity_id, r.reason
         FROM medialab_core.contact_methods c
         JOIN medialab_core.contact_method_retirements r ON r.contact_method_id = c.id
        WHERE c.id = $1`,
      [phoneId]
    );
    expect(retired.rows[0]).toEqual({
      lifecycle_state: 'RETIRED',
      normalized_value: '+1 212 555 0130',
      recorded_by_identity_id: OPERATOR_IDENTITY_ID,
      reason: 'Number withdrawn'
    });
    await expectDbError(
      owner,
      'UPDATE medialab_core.contact_method_retirements SET reason = $1 WHERE id = $2',
      ['Tampered', retirementId]
    );
    await expectDbError(
      owner,
      'DELETE FROM medialab_core.contact_method_retirements WHERE id = $1',
      [retirementId]
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.retire_contact_method($1, $2, $3, $4)',
      [crypto.randomUUID(), operatorToken, phoneId, 'Retire twice']
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.retire_contact_method($1, $2, $3, $4)',
      [crypto.randomUUID(), ownerToken, phoneId, 'Wrong actor']
    );

    const primary = await activeEmailContact(OPERATOR_PERSON_ID);
    const before = await owner.query(
      'SELECT count(*)::int AS count FROM medialab_core.contact_method_retirements'
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.retire_contact_method($1, $2, $3, $4)',
      [crypto.randomUUID(), operatorToken, primary.id, 'Primary must remain']
    );
    const after = await owner.query(
      'SELECT count(*)::int AS count FROM medialab_core.contact_method_retirements'
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('restricted runtime owns nothing and can execute exactly the seven public APIs plus separately inventoried additive APIs', async () => {
    const ownership = await owner.query(
      `SELECT
         (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS database_owner,
         (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'medialab_core') AS schema_owner,
         (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'medialab_core' AND pg_get_userbyid(c.relowner) = $1) AS runtime_relations,
         (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'medialab_core' AND pg_get_userbyid(p.proowner) = $1) AS runtime_functions`,
      [TEST_RUNTIME_ROLE]
    );
    expect(ownership.rows[0]).toEqual({
      database_owner: TEST_OWNER_ROLE,
      schema_owner: TEST_OWNER_ROLE,
      runtime_relations: 0,
      runtime_functions: 0
    });

    const executable = await owner.query(
      `SELECT p.proname
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND has_function_privilege($1, p.oid, 'EXECUTE')
        ORDER BY p.proname`,
      [TEST_RUNTIME_ROLE]
    );
    expect(executable.rows.map((row) => row.proname)).toEqual(ALL_RUNTIME_APIS);
    const publicExecutable = await owner.query(
      `SELECT count(*)::int AS count
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND has_function_privilege('public', p.oid, 'EXECUTE')`
    );
    expect(publicExecutable.rows[0].count).toBe(0);

    const signatures = await owner.query(
      `SELECT p.proname, pg_get_function_arguments(p.oid) AS arguments
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname = ANY($1::text[])
        ORDER BY p.proname`,
      [PUBLIC_APIS]
    );
    expect(signatures.rows).toHaveLength(7);
    for (const row of signatures.rows) {
      expect(row.arguments).toContain('token text');
      expect(row.arguments).not.toContain('actor_identity');
    }

    const role = await owner.query(
      `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
         FROM pg_roles WHERE rolname = $1`,
      [TEST_RUNTIME_ROLE]
    );
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false
    });
    const memberships = await owner.query(
      `SELECT count(*)::int AS count FROM pg_auth_members m
        JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = $1`,
      [TEST_RUNTIME_ROLE]
    );
    expect(memberships.rows[0].count).toBe(0);
  });

  it('restricted runtime cannot read credentials, mutate tables, alter guards, or execute helpers', async () => {
    await expectDbError(runtime, 'SELECT token_sha256 FROM medialab_core.development_sessions');
    await expectDbError(runtime, 'SELECT token_sha256 FROM medialab_core.account_recovery_sessions');
    await expectDbError(
      runtime,
      `INSERT INTO medialab_core.contact_methods
         (id, person_id, contact_type, submitted_value, normalized_value, created_by_identity_id)
       VALUES ($1, $2, 'PHONE', 'x', 'x', $3)`,
      [crypto.randomUUID(), OPERATOR_PERSON_ID, OPERATOR_IDENTITY_ID]
    );
    await expectDbError(
      runtime,
      "UPDATE medialab_core.contact_methods SET lifecycle_state = 'RETIRED', superseded_at = clock_timestamp() WHERE person_id = $1",
      [OPERATOR_PERSON_ID]
    );
    await expectDbError(runtime, 'DELETE FROM medialab_core.contact_verification_evidence');
    await expectDbError(runtime, 'ALTER TABLE medialab_core.contact_methods ADD COLUMN bypass_attempt text');
    await expectDbError(runtime, 'ALTER TABLE medialab_core.contact_methods DISABLE TRIGGER ALL');
    await expectDbError(runtime, 'DROP TRIGGER contact_methods_update_guard ON medialab_core.contact_methods');
    await expectDbError(
      runtime,
      `CREATE OR REPLACE FUNCTION medialab_core.guard_contact_method_update()
       RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`
    );
    await expectDbError(
      runtime,
      'SELECT * FROM medialab_core.resolve_ordinary_session($1)',
      [randomToken()]
    );
    await expectDbError(
      runtime,
      'SELECT medialab_core.actor_can_administer_person($1, $2)',
      [OWNER_IDENTITY_ID, OPERATOR_PERSON_ID]
    );
  });

  it('21 & 22. released identity-tenancy and property-snapshot objects remain present', async () => {
    const tables = await owner.query(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname = 'medialab_core'
          AND tablename IN ('people', 'identities', 'memberships', 'properties', 'property_snapshots')
        ORDER BY tablename`
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'identities',
      'memberships',
      'people',
      'properties',
      'property_snapshots'
    ]);
  });
});
