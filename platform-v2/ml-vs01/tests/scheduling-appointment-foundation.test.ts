import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import {
  IDENTITY_FIXTURES,
  MEMBERSHIP_FIXTURES,
  ORGANIZATION_FIXTURE,
  PEOPLE_FIXTURES
} from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_FOUNDATION_PROPERTY_ID } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m04a_test';
const TEST_OWNER_ROLE = 'medialab_p02m04a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m04a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m04a-pg';
const TEST_PORT = 55432;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const CUSTOMER_IDENTITY_ID = IDENTITY_FIXTURES[0].id;
const STAFF_PERSON_ID = PEOPLE_FIXTURES[1].id;
const CUSTOMER_PERSON_ID = PEOPLE_FIXTURES[0].id;
const PENDING_PERSON_ID = PEOPLE_FIXTURES[2].id;
const PENDING_MEMBERSHIP_ID = MEMBERSHIP_FIXTURES[2].id;
const SOURCE = 'SYNTHETIC_P02_M05_A_TEST';

type WindowEvidence = {
  startsAt: string;
  endsAt: string;
  timezone: string;
  localStartsAt: string;
  localEndsAt: string;
};

const NORMAL_WINDOW: WindowEvidence = {
  startsAt: '2026-10-15T13:00:00.000Z',
  endsAt: '2026-10-15T15:00:00.000Z',
  timezone: 'America/New_York',
  localStartsAt: '2026-10-15 09:00:00',
  localEndsAt: '2026-10-15 11:00:00'
};

const REPLACEMENT_WINDOW: WindowEvidence = {
  startsAt: '2026-10-16T14:00:00.000Z',
  endsAt: '2026-10-16T16:00:00.000Z',
  timezone: 'America/New_York',
  localStartsAt: '2026-10-16 10:00:00',
  localEndsAt: '2026-10-16 12:00:00'
};

function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('P02-M05-A provider-neutral Scheduling Request and Appointment foundation', () => {
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

  async function issueSession(identityId = STAFF_IDENTITY_ID): Promise<string> {
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

  async function expectFailure(work: Promise<unknown>, pattern?: RegExp): Promise<void> {
    try {
      await work;
      throw new Error('Expected PostgreSQL operation to fail');
    } catch (error: any) {
      if (error.message === 'Expected PostgreSQL operation to fail') throw error;
      if (pattern) expect(error.message).toMatch(pattern);
    }
  }

  async function createRequest(token: string, key = `request-${crypto.randomUUID()}`): Promise<string> {
    const result = await runtime.query<{ create_scheduling_request: string }>(
      'SELECT medialab_core.create_scheduling_request($1, $2, $3, $4, $5, $6)',
      [token, key, ORGANIZATION_FIXTURE.id, PROPERTY_HUB_ID, ORDER_FOUNDATION_ORDER_ID, SOURCE]
    );
    return result.rows[0].create_scheduling_request;
  }

  async function addRequestedWindow(
    token: string,
    requestId: string,
    evidence = NORMAL_WINDOW,
    key = `requested-window-${crypto.randomUUID()}`
  ): Promise<string> {
    const result = await runtime.query<{ add_scheduling_requested_window: string }>(
      `SELECT medialab_core.add_scheduling_requested_window(
         $1, $2, $3, $4::timestamptz, $5::timestamptz, $6,
         $7::timestamp without time zone, $8::timestamp without time zone)`,
      [token, key, requestId, evidence.startsAt, evidence.endsAt, evidence.timezone, evidence.localStartsAt, evidence.localEndsAt]
    );
    return result.rows[0].add_scheduling_requested_window;
  }

  async function proposeWindow(
    token: string,
    requestId: string,
    evidence = NORMAL_WINDOW,
    key = `proposal-${crypto.randomUUID()}`
  ): Promise<string> {
    const result = await runtime.query<{ propose_scheduling_window: string }>(
      `SELECT medialab_core.propose_scheduling_window(
         $1, $2, $3, $4::timestamptz, $5::timestamptz, $6,
         $7::timestamp without time zone, $8::timestamp without time zone, $9)`,
      [token, key, requestId, evidence.startsAt, evidence.endsAt, evidence.timezone, evidence.localStartsAt, evidence.localEndsAt, 'Synthetic alternate proposal']
    );
    return result.rows[0].propose_scheduling_window;
  }

  async function confirm(
    token: string,
    requestId: string,
    windowId: string,
    key = `confirm-${crypto.randomUUID()}`
  ): Promise<string> {
    const result = await runtime.query<{ confirm_appointment: string }>(
      'SELECT medialab_core.confirm_appointment($1, $2, $3, $4, $5)',
      [token, key, requestId, windowId, 'Synthetic staff confirmation']
    );
    return result.rows[0].confirm_appointment;
  }

  async function confirmedAppointment(): Promise<{
    staffToken: string;
    customerToken: string;
    requestId: string;
    windowId: string;
    appointmentId: string;
  }> {
    const staffToken = await issueSession();
    const customerToken = await issueSession(CUSTOMER_IDENTITY_ID);
    const requestId = await createRequest(staffToken);
    const windowId = await addRequestedWindow(staffToken, requestId);
    const appointmentId = await confirm(staffToken, requestId, windowId);
    return { staffToken, customerToken, requestId, windowId, appointmentId };
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

  it('1. applies exactly eight immutable migrations and preserves predecessor checksums', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(8);
    expect(ledger.rows.slice(0, 7)).toEqual([
      { filename: '0001_identity_and_tenancy.sql', sha256: '29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31' },
      { filename: '0002_property_identity_and_snapshots.sql', sha256: 'd3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83' },
      { filename: '0003_person_contacts_and_account_lifecycle.sql', sha256: '984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3' },
      { filename: '0004_current_catalog_and_price_snapshots.sql', sha256: 'e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876' },
      { filename: '0005_catalog_administration_lifecycle.sql', sha256: '928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40' },
      { filename: '0006_orders_and_immutable_commercial_evidence.sql', sha256: '5d2c2e785c2a9a8fb9b77a83a5e072c0231b43afb48ca322babec20e914e279f' },
      { filename: '0007_property_hub_foundation.sql', sha256: '8288090bbcb9b7d8b1108247c2f955ab1a5a70f5680c5e5b8adce80f7f7bda16' }
    ]);
    expect(ledger.rows[7]).toMatchObject({ filename: '0008_scheduling_request_and_appointment_foundation.sql' });
    expect(ledger.rows[7].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. creates the bounded relational inventory without Jobs, calendars, crews, payroll, or notifications', async () => {
    const tables = await owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'medialab_core'
         AND (tablename LIKE 'scheduling_%' OR tablename LIKE 'appointment%') ORDER BY tablename`
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      'appointment_events',
      'appointment_participant_assignment_endings',
      'appointment_participant_assignments',
      'appointments',
      'scheduling_acceptances',
      'scheduling_command_idempotency',
      'scheduling_external_references',
      'scheduling_request_events',
      'scheduling_requests',
      'scheduling_windows'
    ]);
    const excluded = await owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'medialab_core'
         AND (tablename LIKE 'job%' OR tablename LIKE 'calendar%' OR tablename LIKE 'crew%'
           OR tablename LIKE 'payroll%' OR tablename LIKE 'notification%')`
    );
    expect(excluded.rows).toEqual([]);
  });

  it('3. lets the authenticated Order placer create exactly one idempotent request without staff permission', async () => {
    await owner.query('DELETE FROM medialab_core.membership_permission_sets WHERE membership_id = $1', [MEMBERSHIP_FIXTURES[1].id]);
    const token = await issueSession();
    const key = `create-replay-${crypto.randomUUID()}`;
    const first = await createRequest(token, key);
    const second = await createRequest(token, key);
    expect(second).toBe(first);
    const record = await owner.query(
      `SELECT r.created_by_identity_id, r.customer_identity_id,
              medialab_core.current_scheduling_request_state(r.id) AS state,
              (SELECT count(*)::int FROM medialab_core.scheduling_request_events e WHERE e.scheduling_request_id = r.id) AS events
         FROM medialab_core.scheduling_requests r WHERE r.id = $1`,
      [first]
    );
    expect(record.rows[0]).toEqual({
      created_by_identity_id: STAFF_IDENTITY_ID,
      customer_identity_id: STAFF_IDENTITY_ID,
      state: 'REQUESTED',
      events: 1
    });
    await expectFailure(runtime.query(
      'SELECT medialab_core.create_scheduling_request($1, $2, $3, $4, $5, $6)',
      [token, key, ORGANIZATION_FIXTURE.id, PROPERTY_HUB_ID, ORDER_FOUNDATION_ORDER_ID, `${SOURCE}_DIFFERENT`]
    ), /conflicting request fingerprint/);
  });

  it('4. keeps requested windows distinct from proposals, acceptance, and confirmed Appointments', async () => {
    const staffToken = await issueSession();
    const requestId = await createRequest(staffToken);
    await addRequestedWindow(staffToken, requestId);
    const proposalId = await proposeWindow(staffToken, requestId, REPLACEMENT_WINDOW);
    const counts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM medialab_core.scheduling_windows WHERE scheduling_request_id = $1 AND window_kind = 'REQUESTED') AS requested,
         (SELECT count(*)::int FROM medialab_core.scheduling_windows WHERE scheduling_request_id = $1 AND window_kind = 'STAFF_PROPOSED') AS proposed,
         (SELECT count(*)::int FROM medialab_core.scheduling_acceptances WHERE scheduling_request_id = $1) AS accepted,
         (SELECT count(*)::int FROM medialab_core.appointments WHERE scheduling_request_id = $1) AS appointments`,
      [requestId]
    );
    expect(counts.rows[0]).toEqual({ requested: 1, proposed: 1, accepted: 0, appointments: 0 });
    await expectFailure(confirm(staffToken, requestId, proposalId), /requires attributable customer acceptance/);
  });

  it('5. records authenticated customer acceptance separately from staff confirmation', async () => {
    const staffToken = await issueSession();
    const customerToken = await issueSession(CUSTOMER_IDENTITY_ID);
    const requestId = await createRequest(staffToken);
    const proposalId = await proposeWindow(staffToken, requestId);
    const acceptance = await runtime.query<{ accept_scheduling_proposal: string }>(
      'SELECT medialab_core.accept_scheduling_proposal($1, $2, $3, $4)',
      [customerToken, `accept-${crypto.randomUUID()}`, proposalId, 'Customer accepted in authenticated session']
    );
    expect(acceptance.rows[0].accept_scheduling_proposal).toMatch(/^[0-9a-f-]{36}$/);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.appointments')).rows[0].count).toBe(0);
    const appointmentId = await confirm(staffToken, requestId, proposalId);
    expect(appointmentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('6. records offline acceptance with distinct staff and asserted-customer attribution', async () => {
    const staffToken = await issueSession();
    const requestId = await createRequest(staffToken);
    const proposalId = await proposeWindow(staffToken, requestId);
    await runtime.query(
      'SELECT medialab_core.record_scheduling_offline_acceptance($1, $2, $3, $4, $5, $6)',
      [staffToken, `offline-${crypto.randomUUID()}`, proposalId, CUSTOMER_IDENTITY_ID, 'PHONE', 'Customer called operations']
    );
    const acceptance = await owner.query('SELECT * FROM medialab_core.scheduling_acceptances WHERE scheduling_request_id = $1', [requestId]);
    expect(acceptance.rows[0]).toMatchObject({
      acceptance_kind: 'STAFF_RECORDED',
      accepting_customer_identity_id: CUSTOMER_IDENTITY_ID,
      recorded_by_identity_id: STAFF_IDENTITY_ID,
      acceptance_method: 'PHONE',
      attributable_note: 'Customer called operations'
    });
    await expectFailure(
      runtime.query('SELECT medialab_core.record_scheduling_offline_acceptance($1, $2, $3, $4, $5, $6)',
        [staffToken, `offline-invalid-${crypto.randomUUID()}`, proposalId, crypto.randomUUID(), 'PHONE', null]),
      /customer-side Order authority/
    );
  });

  it('7. confirms exactly one Appointment and exact idempotent replay does not duplicate evidence', async () => {
    const staffToken = await issueSession();
    const requestId = await createRequest(staffToken);
    const windowId = await addRequestedWindow(staffToken, requestId);
    const key = `confirm-replay-${crypto.randomUUID()}`;
    const first = await confirm(staffToken, requestId, windowId, key);
    const second = await confirm(staffToken, requestId, windowId, key);
    expect(second).toBe(first);
    const counts = await owner.query(
      `SELECT
         (SELECT count(*)::int FROM medialab_core.appointments WHERE scheduling_request_id = $1) AS appointments,
         (SELECT count(*)::int FROM medialab_core.appointment_events WHERE appointment_id = $2 AND event_type = 'APPOINTMENT_CONFIRMED') AS confirmations`,
      [requestId, first]
    );
    expect(counts.rows[0]).toEqual({ appointments: 1, confirmations: 1 });
    await expectFailure(confirm(staffToken, requestId, windowId), /active Scheduling Request|one Appointment/);
  });

  it('8. keeps participant assignment distinct and preserves assignment ending and replacement history', async () => {
    const { staffToken, appointmentId } = await confirmedAppointment();
    const key = `assignment-${crypto.randomUUID()}`;
    const assigned = await runtime.query<{ assign_appointment_participant: string }>(
      'SELECT medialab_core.assign_appointment_participant($1, $2, $3, $4, $5)',
      [staffToken, key, appointmentId, STAFF_PERSON_ID, 'PRIMARY_OPERATOR']
    );
    const replay = await runtime.query<{ assign_appointment_participant: string }>(
      'SELECT medialab_core.assign_appointment_participant($1, $2, $3, $4, $5)',
      [staffToken, key, appointmentId, STAFF_PERSON_ID, 'PRIMARY_OPERATOR']
    );
    expect(replay.rows[0].assign_appointment_participant).toBe(assigned.rows[0].assign_appointment_participant);
    const replacement = await runtime.query<{ replace_appointment_participant_assignment: string }>(
      'SELECT medialab_core.replace_appointment_participant_assignment($1, $2, $3, $4, $5)',
      [staffToken, `replace-${crypto.randomUUID()}`, assigned.rows[0].assign_appointment_participant, CUSTOMER_PERSON_ID, 'Operator handoff']
    );
    expect(replacement.rows[0].replace_appointment_participant_assignment).not.toBe(assigned.rows[0].assign_appointment_participant);
    const history = await owner.query(
      `SELECT a.person_id, a.operational_role, e.ending_reason
         FROM medialab_core.appointment_participant_assignments a
         LEFT JOIN medialab_core.appointment_participant_assignment_endings e ON e.assignment_id = a.id
        WHERE a.appointment_id = $1 ORDER BY a.assigned_at, a.id`,
      [appointmentId]
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows.some((row) => row.person_id === STAFF_PERSON_ID && row.ending_reason === 'Operator handoff')).toBe(true);
    expect(history.rows.some((row) => row.person_id === CUSTOMER_PERSON_ID && row.ending_reason === null)).toBe(true);
  });

  it('9. records cancellation and operational outcomes append-only and rejects terminal transitions', async () => {
    const { staffToken, appointmentId } = await confirmedAppointment();
    const key = `no-show-${crypto.randomUUID()}`;
    const first = await runtime.query<{ record_appointment_no_show: string }>(
      'SELECT medialab_core.record_appointment_no_show($1, $2, $3, $4)',
      [staffToken, key, appointmentId, 'Customer did not attend']
    );
    const replay = await runtime.query<{ record_appointment_no_show: string }>(
      'SELECT medialab_core.record_appointment_no_show($1, $2, $3, $4)',
      [staffToken, key, appointmentId, 'Customer did not attend']
    );
    expect(replay.rows[0].record_appointment_no_show).toBe(first.rows[0].record_appointment_no_show);
    await expectFailure(
      runtime.query('SELECT medialab_core.cancel_appointment($1, $2, $3, $4)',
        [staffToken, `cancel-${crypto.randomUUID()}`, appointmentId, 'Too late']),
      /transition/
    );
    const appointment = await owner.query(
      'SELECT starts_at, medialab_core.current_appointment_state(id) AS state FROM medialab_core.appointments WHERE id = $1',
      [appointmentId]
    );
    expect(appointment.rows[0].state).toBe('NO_SHOW');
    expect(new Date(appointment.rows[0].starts_at).toISOString()).toBe(NORMAL_WINDOW.startsAt);
  });

  it('10. records inaccessible, unable-to-complete, weather-delay, and cancellation as separate states', async () => {
    for (const [command, expectedState] of [
      ['inaccessible', 'INACCESSIBLE_PROPERTY'],
      ['unable', 'UNABLE_TO_COMPLETE'],
      ['weather', 'WEATHER_DELAYED'],
      ['cancel', 'CANCELLED']
    ] as const) {
      await reset();
      const { staffToken, appointmentId } = await confirmedAppointment();
      if (command === 'inaccessible' || command === 'unable') {
        await runtime.query('SELECT medialab_core.record_appointment_unable_to_complete($1, $2, $3, $4, $5)', [
          staffToken, `${command}-${crypto.randomUUID()}`, appointmentId,
          command === 'inaccessible' ? 'INACCESSIBLE_PROPERTY' : 'UNABLE_TO_COMPLETE', 'Distinct operational evidence'
        ]);
      } else if (command === 'weather') {
        await runtime.query('SELECT medialab_core.record_appointment_weather_delay($1, $2, $3, $4)',
          [staffToken, `weather-${crypto.randomUUID()}`, appointmentId, 'Unsafe weather']);
      } else {
        await runtime.query('SELECT medialab_core.cancel_appointment($1, $2, $3, $4)',
          [staffToken, `cancel-${crypto.randomUUID()}`, appointmentId, 'Attributable cancellation']);
      }
      const state = await owner.query('SELECT medialab_core.current_appointment_state($1) AS state', [appointmentId]);
      expect(state.rows[0].state).toBe(expectedState);
    }
  });

  it('11. supersedes by creating a new request and Appointment without changing the original time or assignments', async () => {
    const { staffToken, appointmentId } = await confirmedAppointment();
    await runtime.query('SELECT medialab_core.assign_appointment_participant($1, $2, $3, $4, $5)',
      [staffToken, `assign-before-reschedule-${crypto.randomUUID()}`, appointmentId, STAFF_PERSON_ID, 'COORDINATOR']);
    const key = `reschedule-${crypto.randomUUID()}`;
    const values = [staffToken, key, appointmentId, CUSTOMER_IDENTITY_ID, 'TEXT', REPLACEMENT_WINDOW.startsAt,
      REPLACEMENT_WINDOW.endsAt, REPLACEMENT_WINDOW.timezone, REPLACEMENT_WINDOW.localStartsAt,
      REPLACEMENT_WINDOW.localEndsAt, 'Customer requested a later visit', 'Accepted by text'];
    const replacement = await runtime.query<{ supersede_and_reschedule_appointment: string }>(
      `SELECT medialab_core.supersede_and_reschedule_appointment(
         $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8,
         $9::timestamp without time zone, $10::timestamp without time zone, $11, $12)`, values
    );
    const replay = await runtime.query<{ supersede_and_reschedule_appointment: string }>(
      `SELECT medialab_core.supersede_and_reschedule_appointment(
         $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8,
         $9::timestamp without time zone, $10::timestamp without time zone, $11, $12)`, values
    );
    expect(replay.rows[0].supersede_and_reschedule_appointment).toBe(replacement.rows[0].supersede_and_reschedule_appointment);
    const evidence = await owner.query(
      `SELECT a.id, a.scheduling_request_id, a.starts_at,
              medialab_core.current_appointment_state(a.id) AS state,
              (SELECT count(*)::int FROM medialab_core.appointment_participant_assignments x WHERE x.appointment_id = a.id) AS assignments
         FROM medialab_core.appointments a WHERE a.id IN ($1, $2) ORDER BY a.id`,
      [appointmentId, replacement.rows[0].supersede_and_reschedule_appointment]
    );
    const original = evidence.rows.find((row) => row.id === appointmentId);
    const next = evidence.rows.find((row) => row.id === replacement.rows[0].supersede_and_reschedule_appointment);
    expect(original.state).toBe('SUPERSEDED');
    expect(new Date(original.starts_at).toISOString()).toBe(NORMAL_WINDOW.startsAt);
    expect(original.assignments).toBe(1);
    expect(next.state).toBe('CONFIRMED');
    expect(new Date(next.starts_at).toISOString()).toBe(REPLACEMENT_WINDOW.startsAt);
    expect(next.scheduling_request_id).not.toBe(original.scheduling_request_id);
  });

  it('12. supports withdrawal, decline, and cancellation of unconfirmed requests without deleting windows', async () => {
    const staffToken = await issueSession();
    const requestId = await createRequest(staffToken);
    await addRequestedWindow(staffToken, requestId);
    await runtime.query('SELECT medialab_core.withdraw_scheduling_request($1, $2, $3, $4)',
      [staffToken, `withdraw-${crypto.randomUUID()}`, requestId, 'Customer withdrew before acceptance']);
    const record = await owner.query(
      `SELECT medialab_core.current_scheduling_request_state($1) AS state,
              (SELECT count(*)::int FROM medialab_core.scheduling_windows WHERE scheduling_request_id = $1) AS windows`,
      [requestId]
    );
    expect(record.rows[0]).toEqual({ state: 'WITHDRAWN', windows: 1 });

    for (const closeState of ['DECLINED', 'CANCELLED']) {
      await reset();
      const token = await issueSession();
      const id = await createRequest(token);
      await runtime.query('SELECT medialab_core.close_scheduling_request($1, $2, $3, $4, $5)',
        [token, `close-${crypto.randomUUID()}`, id, closeState, `Synthetic ${closeState.toLowerCase()}`]);
      const state = await owner.query('SELECT medialab_core.current_scheduling_request_state($1) AS state', [id]);
      expect(state.rows[0].state).toBe(closeState);
    }
  });

  it('13. denies a Hub participant without scheduling permission plus suspended and deactivated actors', async () => {
    const staffToken = await issueSession();
    const requestId = await createRequest(staffToken);
    const pendingIdentityId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO medialab_core.identities
         (id, person_id, provider, provider_subject, status, email_verified_at, created_at)
       VALUES ($1, $2, 'LOCAL_DEVELOPMENT', $3, 'ACTIVE', clock_timestamp(), clock_timestamp())`,
      [pendingIdentityId, PENDING_PERSON_ID, `pending-${crypto.randomUUID()}`]
    );
    await owner.query(
      `UPDATE medialab_core.memberships SET status = 'ACTIVE', activated_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1`, [PENDING_MEMBERSHIP_ID]
    );
    await owner.query(
      `INSERT INTO medialab_core.property_hub_participants
         (id, property_hub_id, organization_id, membership_id, participant_role, recorded_by_identity_id)
       VALUES ($1, $2, $3, $4, 'HUB_PARTICIPANT', $5)`,
      [crypto.randomUUID(), PROPERTY_HUB_ID, ORGANIZATION_FIXTURE.id, PENDING_MEMBERSHIP_ID, STAFF_IDENTITY_ID]
    );
    const participantToken = await issueSession(pendingIdentityId);
    await expectFailure(proposeWindow(participantToken, requestId), /lacks active staff scheduling authority/);

    await owner.query(
      `UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = clock_timestamp(),
              suspension_reason = 'Synthetic test', updated_at = clock_timestamp()
        WHERE id = $1`, [MEMBERSHIP_FIXTURES[1].id]
    );
    await expectFailure(proposeWindow(staffToken, requestId), /lacks active staff scheduling authority/);

    await reset();
    const deactivatedToken = await issueSession();
    await owner.query("UPDATE medialab_core.identities SET status = 'REVOKED' WHERE id = $1", [STAFF_IDENTITY_ID]);
    await expectFailure(createRequest(deactivatedToken), /missing, expired, revoked, or inactive/);
  });

  it('14. rejects cross-organization relationships and exposes no caller-supplied actor authority', async () => {
    const otherOrg = crypto.randomUUID();
    await owner.query("INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Synthetic Isolated Org')", [otherOrg]);
    await expectFailure(owner.query(
      `INSERT INTO medialab_core.scheduling_requests
         (id, organization_id, property_hub_id, order_id, customer_identity_id,
          created_by_identity_id, creation_mode, source_system)
       VALUES ($1, $2, $3, $4, $5, $5, 'CUSTOMER_DIRECT', $6)`,
      [crypto.randomUUID(), otherOrg, PROPERTY_HUB_ID, ORDER_FOUNDATION_ORDER_ID, STAFF_IDENTITY_ID, SOURCE]
    ));
    const signatures = await owner.query(
      `SELECT proname, pg_get_function_identity_arguments(p.oid) AS args
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core'
          AND proname IN ('create_scheduling_request', 'confirm_appointment', 'record_appointment_no_show')`
    );
    expect(signatures.rows.every((row) => !row.args.includes('actor_identity'))).toBe(true);
    expect(signatures.rows).toHaveLength(3);
    expect(ORDER_FOUNDATION_PROPERTY_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('15. requires reconstructible IANA evidence and is stable across session timezone changes and DST boundaries', async () => {
    const token = await issueSession();
    const requestId = await createRequest(token);
    await expectFailure(addRequestedWindow(token, requestId, { ...NORMAL_WINDOW, timezone: 'EST' }), /IANA timezone/);
    await expectFailure(addRequestedWindow(token, requestId, { ...NORMAL_WINDOW, localStartsAt: '2026-10-15 10:00:00' }), /does not reconstruct/);

    await runtime.query("SET TIME ZONE 'Asia/Tokyo'");
    const dstWindow: WindowEvidence = {
      startsAt: '2026-11-01T06:30:00.000Z',
      endsAt: '2026-11-01T07:30:00.000Z',
      timezone: 'America/New_York',
      localStartsAt: '2026-11-01 01:30:00',
      localEndsAt: '2026-11-01 02:30:00'
    };
    const windowId = await addRequestedWindow(token, requestId, dstWindow);
    const row = await owner.query('SELECT starts_at, iana_timezone, local_starts_at FROM medialab_core.scheduling_windows WHERE id = $1', [windowId]);
    expect(new Date(row.rows[0].starts_at).toISOString()).toBe(dstWindow.startsAt);
    expect(row.rows[0].iana_timezone).toBe('America/New_York');
    expect(row.rows[0].local_starts_at).toBeInstanceOf(Date);
    await expectFailure(addRequestedWindow(token, requestId, { ...dstWindow, startsAt: '2026-11-01T05:30:00.000Z' }), /does not reconstruct/);
    await runtime.query("SET TIME ZONE 'UTC'");
  });

  it('16. enforces owner-only tables/helpers, fixed API search paths, no PUBLIC authority, and immutable evidence', async () => {
    const { staffToken, requestId, appointmentId } = await confirmedAppointment();
    const tables = await owner.query(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'medialab_core'
          AND (table_name LIKE 'scheduling_%' OR table_name LIKE 'appointment%')`,
      [TEST_RUNTIME_ROLE]
    );
    expect(tables.rows).toEqual([]);
    const publicTables = await owner.query(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'PUBLIC' AND table_schema = 'medialab_core'
          AND (table_name LIKE 'scheduling_%' OR table_name LIKE 'appointment%')`
    );
    expect(publicTables.rows).toEqual([]);
    const api = await owner.query(
      `SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname IN ('create_scheduling_request', 'confirm_appointment', 'get_appointment_record')
        ORDER BY p.proname`, [TEST_RUNTIME_ROLE]
    );
    expect(api.rows.every((row) => row.prosecdef && row.runtime_execute && !row.public_execute &&
      row.owner === TEST_OWNER_ROLE && row.proconfig?.[0] === 'search_path=pg_catalog, medialab_core, pg_temp')).toBe(true);
    await expectFailure(owner.query('UPDATE medialab_core.appointments SET starts_at = starts_at + interval \'1 hour\' WHERE id = $1', [appointmentId]), /immutable/);
    await expectFailure(owner.query('DELETE FROM medialab_core.scheduling_request_events WHERE scheduling_request_id = $1', [requestId]), /immutable/);
    await expectFailure(runtime.query('SELECT * FROM medialab_core.appointments'));
    expect((await runtime.query('SELECT medialab_core.get_appointment_record($1, $2)', [staffToken, appointmentId])).rows).toHaveLength(1);
  });

  it('17. authorizes retrieval for customer, explicit Hub participant, and staff while preserving organization isolation', async () => {
    const { staffToken, customerToken, requestId, appointmentId } = await confirmedAppointment();
    const customerRequest = await runtime.query<{ get_scheduling_request_record: any }>(
      'SELECT medialab_core.get_scheduling_request_record($1, $2)', [customerToken, requestId]
    );
    expect(customerRequest.rows[0].get_scheduling_request_record.current_state).toBe('FULFILLED');
    const customerAppointment = await runtime.query<{ get_appointment_record: any }>(
      'SELECT medialab_core.get_appointment_record($1, $2)', [customerToken, appointmentId]
    );
    expect(customerAppointment.rows[0].get_appointment_record.current_state).toBe('CONFIRMED');
    expect((await runtime.query('SELECT medialab_core.get_appointment_record($1, $2)', [staffToken, appointmentId])).rows).toHaveLength(1);
    const fake = crypto.randomUUID();
    await expectFailure(runtime.query('SELECT medialab_core.get_appointment_record($1, $2)', [customerToken, fake]), /missing or unavailable/);
  });
});
