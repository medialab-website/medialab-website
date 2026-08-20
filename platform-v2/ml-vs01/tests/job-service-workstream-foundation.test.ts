import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import {
  IDENTITY_FIXTURES,
  ORGANIZATION_FIXTURE
} from '../db/fixtures/identity-tenancy-fixtures.js';
import {
  ORDER_FOUNDATION_ORDER_ID,
  ORDER_ITEM_FIXTURES
} from '../db/fixtures/order-foundation-fixtures.js';
import {
  PROPERTY_HUB_ID,
  PROPERTY_HUB_SECOND_ORDER_ID,
  PROPERTY_HUB_SECOND_ORDER_ITEM_FIXTURE
} from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m16a_test';
const TEST_OWNER_ROLE = 'medialab_p02m16a_test_owner';
const TEST_RUNTIME_ROLE = 'medialab_p02m16a_test_app';
const TEST_SOCKET = '/tmp/mlvs01-p02m16a-pg';
const TEST_PORT = 55447;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M06_A_TEST';

function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('P02-M06-A provider-neutral Job and Service Workstream foundation', () => {
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

  async function createJob(
    token: string,
    key = `job-${crypto.randomUUID()}`,
    orderId = ORDER_FOUNDATION_ORDER_ID,
    hubId: string | null = PROPERTY_HUB_ID,
    organizationId = ORGANIZATION_FIXTURE.id,
    source = SOURCE
  ): Promise<string> {
    const result = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1, $2, $3, $4, $5, $6)',
      [token, key, organizationId, orderId, hubId, source]
    );
    return result.rows[0].create_job;
  }

  async function createWorkstream(
    token: string,
    jobId: string,
    orderItemId: string,
    key = `workstream-${crypto.randomUUID()}`,
    source = SOURCE
  ): Promise<string> {
    const result = await runtime.query<{ create_service_workstream: string }>(
      'SELECT medialab_core.create_service_workstream($1, $2, $3, $4, $5)',
      [token, key, jobId, orderItemId, source]
    );
    return result.rows[0].create_service_workstream;
  }

  async function transitionJob(
    token: string,
    jobId: string,
    target: string,
    key = `job-state-${crypto.randomUUID()}`,
    reason = `Synthetic Job transition to ${target}`
  ): Promise<string> {
    const result = await runtime.query<{ transition_job_state: string }>(
      'SELECT medialab_core.transition_job_state($1, $2, $3, $4, $5)',
      [token, key, jobId, target, reason]
    );
    return result.rows[0].transition_job_state;
  }

  async function transitionWorkstream(
    token: string,
    workstreamId: string,
    target: string,
    key = `workstream-state-${crypto.randomUUID()}`,
    reason = `Synthetic Workstream transition to ${target}`
  ): Promise<string> {
    const result = await runtime.query<{ transition_service_workstream_state: string }>(
      'SELECT medialab_core.transition_service_workstream_state($1, $2, $3, $4, $5)',
      [token, key, workstreamId, target, reason]
    );
    return result.rows[0].transition_service_workstream_state;
  }

  async function confirmAppointment(
    token: string,
    orderId = ORDER_FOUNDATION_ORDER_ID,
    hour = 13
  ): Promise<string> {
    const request = await runtime.query<{ create_scheduling_request: string }>(
      'SELECT medialab_core.create_scheduling_request($1, $2, $3, $4, $5, $6)',
      [token, `request-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, PROPERTY_HUB_ID, orderId, SOURCE]
    );
    const requestId = request.rows[0].create_scheduling_request;
    const start = `2026-10-15T${String(hour).padStart(2, '0')}:00:00.000Z`;
    const end = `2026-10-15T${String(hour + 1).padStart(2, '0')}:00:00.000Z`;
    const localStart = `2026-10-15 ${String(hour - 4).padStart(2, '0')}:00:00`;
    const localEnd = `2026-10-15 ${String(hour - 3).padStart(2, '0')}:00:00`;
    const window = await runtime.query<{ add_scheduling_requested_window: string }>(
      `SELECT medialab_core.add_scheduling_requested_window(
         $1, $2, $3, $4::timestamptz, $5::timestamptz, $6,
         $7::timestamp without time zone, $8::timestamp without time zone)`,
      [token, `window-${crypto.randomUUID()}`, requestId, start, end, 'America/New_York', localStart, localEnd]
    );
    const confirmed = await runtime.query<{ confirm_appointment: string }>(
      'SELECT medialab_core.confirm_appointment($1, $2, $3, $4, $5)',
      [token, `confirm-${crypto.randomUUID()}`, requestId, window.rows[0].add_scheduling_requested_window, 'Synthetic confirmation']
    );
    return confirmed.rows[0].confirm_appointment;
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

  it('1. applies ten immutable migrations while preserving the canonical 0009 predecessor', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(24);
    expect(ledger.rows[22].filename).toBe('0023_runtime_intake_reconciliation_commands.sql');
    expect(ledger.rows[8]).toMatchObject({ filename: '0009_job_and_service_workstream_foundation.sql' });
    expect(ledger.rows[8].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('2. creates Jobs only from accepted organization-scoped Orders, with optional Hubs and multiple Jobs per Order', async () => {
    const token = await issueSession();
    const first = await createJob(token);
    const second = await createJob(token, undefined, ORDER_FOUNDATION_ORDER_ID, null);
    const rows = await owner.query(
      'SELECT id, order_id, property_hub_id, current_state FROM medialab_core.jobs ORDER BY created_at, id'
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.id)).toContain(first);
    expect(rows.rows.map((row) => row.id)).toContain(second);
    expect(rows.rows.every((row) => row.order_id === ORDER_FOUNDATION_ORDER_ID && row.current_state === 'DRAFT')).toBe(true);
    expect(rows.rows.some((row) => row.property_hub_id === null)).toBe(true);
    await expectFailure(
      createJob(token, undefined, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, crypto.randomUUID()),
      /lacks active|outside/
    );
  });

  it('3. creates multiple independently traceable Workstreams from immutable Order Item evidence, including decomposition', async () => {
    const token = await issueSession();
    const jobId = await createJob(token);
    const first = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[0].id);
    const second = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[1].id);
    const decomposed = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[0].id);
    const rows = await owner.query(
      `SELECT id, source_order_item_id, frozen_source_description, current_state
         FROM medialab_core.service_workstreams WHERE job_id = $1 ORDER BY created_at, id`,
      [jobId]
    );
    expect(rows.rows.map((row) => row.id).sort()).toEqual([first, second, decomposed].sort());
    expect(rows.rows.filter((row) => row.source_order_item_id === ORDER_ITEM_FIXTURES[0].id)).toHaveLength(2);
    expect(rows.rows.every((row) => row.frozen_source_description.length > 0 && row.current_state === 'PENDING')).toBe(true);
  });

  it('4. rejects unrelated Order Items and preserves Workstream source meaning against later mutation', async () => {
    const token = await issueSession();
    const jobId = await createJob(token);
    await expectFailure(
      createWorkstream(token, jobId, PROPERTY_HUB_SECOND_ORDER_ITEM_FIXTURE.id),
      /not immutable evidence/
    );
    const workstreamId = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[0].id);
    await expectFailure(
      owner.query('UPDATE medialab_core.service_workstreams SET frozen_source_description = $1 WHERE id = $2', ['Rewritten', workstreamId]),
      /source and relationship evidence is immutable/
    );
  });

  it('5. permits a nonscheduled Job and Workstreams without fabricating an Appointment', async () => {
    const token = await issueSession();
    const jobId = await createJob(token, undefined, ORDER_FOUNDATION_ORDER_ID, null);
    await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[0].id);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.job_appointments WHERE job_id = $1', [jobId])).rows[0].count).toBe(0);
  });

  it('6. links zero, one, or multiple confirmed Appointments explicitly and rejects unrelated Appointments', async () => {
    const token = await issueSession();
    const jobId = await createJob(token);
    const firstAppointment = await confirmAppointment(token, ORDER_FOUNDATION_ORDER_ID, 13);
    const secondAppointment = await confirmAppointment(token, ORDER_FOUNDATION_ORDER_ID, 15);
    const unrelatedAppointment = await confirmAppointment(token, PROPERTY_HUB_SECOND_ORDER_ID, 17);
    const key = `link-${crypto.randomUUID()}`;
    const first = await runtime.query<{ link_job_appointment: string }>(
      'SELECT medialab_core.link_job_appointment($1, $2, $3, $4, $5)',
      [token, key, jobId, firstAppointment, 'Synthetic first link']
    );
    const replay = await runtime.query<{ link_job_appointment: string }>(
      'SELECT medialab_core.link_job_appointment($1, $2, $3, $4, $5)',
      [token, key, jobId, firstAppointment, 'Synthetic first link']
    );
    expect(replay.rows[0].link_job_appointment).toBe(first.rows[0].link_job_appointment);
    await runtime.query(
      'SELECT medialab_core.link_job_appointment($1, $2, $3, $4, $5)',
      [token, `link-${crypto.randomUUID()}`, jobId, secondAppointment, 'Synthetic second link']
    );
    await expectFailure(
      runtime.query('SELECT medialab_core.link_job_appointment($1, $2, $3, $4, $5)',
        [token, `link-${crypto.randomUUID()}`, jobId, unrelatedAppointment, 'Unrelated link']),
      /unrelated/
    );
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.job_appointments WHERE job_id = $1', [jobId])).rows[0].count).toBe(2);
  });

  it('7. progresses sibling Workstreams independently and retains completed evidence when another blocks', async () => {
    const token = await issueSession();
    const jobId = await createJob(token);
    const completed = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[0].id);
    const blocked = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[1].id);
    await transitionWorkstream(token, completed, 'READY');
    await transitionWorkstream(token, completed, 'IN_PROGRESS');
    await transitionWorkstream(token, completed, 'COMPLETED');
    await transitionWorkstream(token, blocked, 'READY');
    await transitionWorkstream(token, blocked, 'BLOCKED');
    const rows = await owner.query('SELECT id, current_state FROM medialab_core.service_workstreams WHERE job_id = $1', [jobId]);
    expect(rows.rows.find((row) => row.id === completed).current_state).toBe('COMPLETED');
    expect(rows.rows.find((row) => row.id === blocked).current_state).toBe('BLOCKED');
  });

  it('8. enforces explicit lifecycle transitions, terminal rules, and validated Job completion', async () => {
    const token = await issueSession();
    const jobId = await createJob(token);
    const workstreamId = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[0].id);
    await expectFailure(transitionJob(token, jobId, 'COMPLETED'), /Invalid Job lifecycle/);
    await transitionJob(token, jobId, 'READY');
    await transitionJob(token, jobId, 'ACTIVE');
    await expectFailure(transitionJob(token, jobId, 'COMPLETED'), /every Workstream to be terminal/);
    await transitionWorkstream(token, workstreamId, 'READY');
    await transitionWorkstream(token, workstreamId, 'IN_PROGRESS');
    await transitionWorkstream(token, workstreamId, 'COMPLETED');
    await transitionJob(token, jobId, 'COMPLETED');
    await expectFailure(transitionJob(token, jobId, 'ACTIVE'), /Invalid Job lifecycle|Terminal Job/);
    await expectFailure(transitionWorkstream(token, workstreamId, 'READY'), /Invalid Service Workstream|Terminal Service Workstream/);
  });

  it('9. makes create and lifecycle retries actor-scoped, replay-safe, and conflict-detecting', async () => {
    const token = await issueSession();
    const createKey = `job-replay-${crypto.randomUUID()}`;
    const firstJob = await createJob(token, createKey);
    expect(await createJob(token, createKey)).toBe(firstJob);
    await expectFailure(createJob(token, createKey, ORDER_FOUNDATION_ORDER_ID, null), /conflicts/);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.jobs')).rows[0].count).toBe(1);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.job_events WHERE job_id = $1', [firstJob])).rows[0].count).toBe(1);
    const workstreamId = await createWorkstream(token, firstJob, ORDER_ITEM_FIXTURES[0].id);
    const stateKey = `state-replay-${crypto.randomUUID()}`;
    const firstEvent = await transitionWorkstream(token, workstreamId, 'READY', stateKey, 'Replay-safe transition');
    expect(await transitionWorkstream(token, workstreamId, 'READY', stateKey, 'Replay-safe transition')).toBe(firstEvent);
    await expectFailure(transitionWorkstream(token, workstreamId, 'CANCELLED', stateKey, 'Different request'), /conflicts/);
  });

  it('10. records provider-neutral external references through commands and rejects conflicting reuse', async () => {
    const token = await issueSession();
    const jobId = await createJob(token);
    const key = `external-${crypto.randomUUID()}`;
    const args = [token, key, jobId, null, 'SYNTHETIC_PROVIDER', 'FULFILLMENT_CASE', 'case-001', 'Synthetic provenance'];
    const first = await runtime.query<{ record_job_service_external_reference: string }>(
      'SELECT medialab_core.record_job_service_external_reference($1, $2, $3, $4, $5, $6, $7, $8)', args
    );
    const replay = await runtime.query<{ record_job_service_external_reference: string }>(
      'SELECT medialab_core.record_job_service_external_reference($1, $2, $3, $4, $5, $6, $7, $8)', args
    );
    expect(replay.rows[0].record_job_service_external_reference).toBe(first.rows[0].record_job_service_external_reference);
    await expectFailure(
      runtime.query('SELECT medialab_core.record_job_service_external_reference($1, $2, $3, $4, $5, $6, $7, $8)',
        [token, key, jobId, null, 'SYNTHETIC_PROVIDER', 'FULFILLMENT_CASE', 'case-002', 'Synthetic provenance']),
      /conflicts/
    );
  });

  it('11. denies cross-organization commands and reads without leaking record existence', async () => {
    const token = await issueSession();
    const foreignOrg = '99000000-0000-5000-8000-000000000001';
    const foreignOrder = '99000000-0000-5000-8000-000000000002';
    const foreignJob = '99000000-0000-5000-8000-000000000003';
    await owner.query('INSERT INTO medialab_core.organizations (id, name) VALUES ($1, $2)', [foreignOrg, 'Synthetic Foreign Organization']);
    await owner.query(
      `INSERT INTO medialab_core.orders
        (id, lane, organization_id, settlement_mode, currency, item_subtotal_cents, travel_amount_cents,
         total_amount_cents, current_state, source_system, created_by_identity_id, accepted_by_identity_id,
         created_at, accepted_at)
       VALUES ($1, 'CREATIVE', $2, 'PAY_NOW', 'USD', 0, 0, 0, 'ACCEPTED', $3, $4, $4, clock_timestamp(), clock_timestamp())`,
      [foreignOrder, foreignOrg, SOURCE, STAFF_IDENTITY_ID]
    );
    await owner.query(
      `INSERT INTO medialab_core.jobs
        (id, organization_id, order_id, current_state, source_system, created_by_identity_id)
       VALUES ($1, $2, $3, 'DRAFT', $4, $5)`,
      [foreignJob, foreignOrg, foreignOrder, SOURCE, STAFF_IDENTITY_ID]
    );
    await expectFailure(createJob(token, undefined, foreignOrder, null, foreignOrg), /lacks active/);
    await expectFailure(runtime.query('SELECT medialab_core.get_job_record($1, $2)', [token, foreignJob]), /missing or unavailable/);
  });

  it('12. denies runtime and PUBLIC direct DML while keeping only approved command execution', async () => {
    await expectFailure(
      runtime.query(
        `INSERT INTO medialab_core.jobs
          (id, organization_id, order_id, current_state, source_system, created_by_identity_id)
         VALUES ($1, $2, $3, 'DRAFT', $4, $5)`,
        [crypto.randomUUID(), ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, SOURCE, STAFF_IDENTITY_ID]
      ),
      /permission denied/
    );
    const privileges = await owner.query(
      `SELECT c.relname,
              has_table_privilege($1, c.oid, 'INSERT,UPDATE,DELETE') AS runtime_dml,
              has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS public_access
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'medialab_core' AND c.relname = ANY($2::text[])
        ORDER BY c.relname`,
      [TEST_RUNTIME_ROLE, [
        'jobs', 'service_workstreams', 'job_appointments', 'job_service_external_references',
        'job_service_command_idempotency', 'job_events', 'service_workstream_events'
      ]]
    );
    expect(privileges.rows).toHaveLength(7);
    expect(privileges.rows.every((row) => !row.runtime_dml && !row.public_access)).toBe(true);
  });

  it('13. keeps event history append-only and reconciled with current state and immutable references', async () => {
    const token = await issueSession();
    const jobId = await createJob(token);
    const workstreamId = await createWorkstream(token, jobId, ORDER_ITEM_FIXTURES[0].id);
    await transitionWorkstream(token, workstreamId, 'READY');
    await transitionJob(token, jobId, 'READY');
    const reconciliation = await owner.query(
      `SELECT j.current_state AS job_state,
              (SELECT resulting_state FROM medialab_core.job_events WHERE job_id = j.id ORDER BY occurred_at DESC, id DESC LIMIT 1) AS job_event_state,
              w.current_state AS workstream_state,
              (SELECT resulting_state FROM medialab_core.service_workstream_events WHERE service_workstream_id = w.id ORDER BY occurred_at DESC, id DESC LIMIT 1) AS workstream_event_state,
              w.source_order_item_id,
              (SELECT source_order_item_id FROM medialab_core.service_workstream_events WHERE service_workstream_id = w.id ORDER BY occurred_at LIMIT 1) AS event_source_item
         FROM medialab_core.jobs j JOIN medialab_core.service_workstreams w ON w.job_id = j.id
        WHERE j.id = $1`,
      [jobId]
    );
    expect(reconciliation.rows[0].job_event_state).toBe(reconciliation.rows[0].job_state);
    expect(reconciliation.rows[0].workstream_event_state).toBe(reconciliation.rows[0].workstream_state);
    expect(reconciliation.rows[0].event_source_item).toBe(reconciliation.rows[0].source_order_item_id);
    await expectFailure(owner.query('DELETE FROM medialab_core.job_events WHERE job_id = $1', [jobId]), /append-only/);
    await expectFailure(owner.query('UPDATE medialab_core.service_workstream_events SET reason = $1 WHERE service_workstream_id = $2', ['Rewrite', workstreamId]), /append-only/);
  });
});
