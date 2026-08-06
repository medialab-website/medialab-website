import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'crypto';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { IDENTITY_FIXTURES, ORGANIZATION_FIXTURE, PEOPLE_FIXTURES } from '../db/fixtures/identity-tenancy-fixtures.js';
import { ORDER_FOUNDATION_ORDER_ID, ORDER_ITEM_FIXTURES } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_ID } from '../db/fixtures/property-hub-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m08a_test';
const OWNER_ROLE = 'medialab_p02m08a_test_owner';
const RUNTIME_ROLE = 'medialab_p02m08a_test_app';
const SOCKET = '/tmp/mlvs01-p02m08a-pg';
const PORT = 55438;
const STAFF_IDENTITY_ID = IDENTITY_FIXTURES[1].id;
const SOURCE = 'SYNTHETIC_P02_M07_A_TEST';

const internalSection = { label: 'Staff instructions', visibility: 'INTERNAL_STAFF_ONLY', content: { arrive_early_minutes: 15 } };
const crewSection = { label: 'Crew instructions', visibility: 'ASSIGNED_CREW_ONLY', content: { entry: 'front door' } };
const potentialCustomerSection = { label: 'Preparation', visibility: 'POTENTIALLY_CUSTOMER_VISIBLE', content: { lights: 'on' } };
const content = { sections: [internalSection, crewSection, potentialCustomerSection] };

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function bufferDigest(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('P02-M07-A Mission Plan foundation', () => {
  let owner: pg.Client;
  let runtime: pg.Client;

  async function reset(): Promise<void> {
    await resetTestDatabase({
      host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE,
      runtimeUser: RUNTIME_ROLE, confirm: TEST_DB
    });
  }

  async function issueSession(identityId = STAFF_IDENTITY_ID): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO medialab_core.development_sessions
         (id, identity_id, token_sha256, issued_at, expires_at, revoked_at)
       VALUES ($1, $2, $3, clock_timestamp() - interval '1 minute', clock_timestamp() + interval '1 hour', NULL)`,
      [crypto.randomUUID(), identityId, digest(token)]
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

  async function setupMissionInputs(token: string, workstreamCount = 2): Promise<{
    jobId: string; appointmentId: string; jobAppointmentId: string; workstreamIds: string[];
  }> {
    const job = await runtime.query<{ create_job: string }>(
      'SELECT medialab_core.create_job($1, $2, $3, $4, $5, $6)',
      [token, `job-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, ORDER_FOUNDATION_ORDER_ID, PROPERTY_HUB_ID, SOURCE]
    );
    const jobId = job.rows[0].create_job;
    const workstreamIds: string[] = [];
    for (let index = 0; index < workstreamCount; index++) {
      const workstream = await runtime.query<{ create_service_workstream: string }>(
        'SELECT medialab_core.create_service_workstream($1, $2, $3, $4, $5)',
        [token, `workstream-${crypto.randomUUID()}`, jobId, ORDER_ITEM_FIXTURES[index % ORDER_ITEM_FIXTURES.length].id, SOURCE]
      );
      workstreamIds.push(workstream.rows[0].create_service_workstream);
    }
    const request = await runtime.query<{ create_scheduling_request: string }>(
      'SELECT medialab_core.create_scheduling_request($1, $2, $3, $4, $5, $6)',
      [token, `request-${crypto.randomUUID()}`, ORGANIZATION_FIXTURE.id, PROPERTY_HUB_ID, ORDER_FOUNDATION_ORDER_ID, SOURCE]
    );
    const window = await runtime.query<{ add_scheduling_requested_window: string }>(
      `SELECT medialab_core.add_scheduling_requested_window(
         $1, $2, $3, $4::timestamptz, $5::timestamptz, $6,
         $7::timestamp without time zone, $8::timestamp without time zone)`,
      [token, `window-${crypto.randomUUID()}`, request.rows[0].create_scheduling_request,
       '2026-10-20T14:00:00.000Z', '2026-10-20T16:00:00.000Z', 'America/New_York',
       '2026-10-20 10:00:00', '2026-10-20 12:00:00']
    );
    const appointment = await runtime.query<{ confirm_appointment: string }>(
      'SELECT medialab_core.confirm_appointment($1, $2, $3, $4, $5)',
      [token, `confirm-${crypto.randomUUID()}`, request.rows[0].create_scheduling_request,
       window.rows[0].add_scheduling_requested_window, 'Synthetic Mission Plan appointment']
    );
    const appointmentId = appointment.rows[0].confirm_appointment;
    const link = await runtime.query<{ link_job_appointment: string }>(
      'SELECT medialab_core.link_job_appointment($1, $2, $3, $4, $5)',
      [token, `link-${crypto.randomUUID()}`, jobId, appointmentId, 'Synthetic Mission Plan relationship']
    );
    return { jobId, appointmentId, jobAppointmentId: link.rows[0].link_job_appointment, workstreamIds };
  }

  async function createDraft(
    token: string,
    jobAppointmentId: string,
    key = `draft-${crypto.randomUUID()}`,
    draftContent: any = content,
    weatherStatus = 'UNAVAILABLE',
    weatherEvidence: any = null,
    unavailableReason: string | null = 'Synthetic provider returned no attributable forecast'
  ): Promise<string> {
    const result = await runtime.query<{ create_mission_plan_draft: string }>(
      'SELECT medialab_core.create_mission_plan_draft($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)',
      [token, key, jobAppointmentId, JSON.stringify(draftContent), weatherStatus,
       weatherEvidence === null ? null : JSON.stringify(weatherEvidence), unavailableReason]
    );
    return result.rows[0].create_mission_plan_draft;
  }

  async function issueVersion(token: string, planId: string, key = `issue-${crypto.randomUUID()}`): Promise<string> {
    const result = await runtime.query<{ issue_mission_plan_version: string }>(
      'SELECT medialab_core.issue_mission_plan_version($1, $2, $3)', [token, key, planId]
    );
    return result.rows[0].issue_mission_plan_version;
  }

  beforeAll(async () => {
    await reset();
    owner = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: OWNER_ROLE });
    runtime = new pg.Client({ host: SOCKET, port: PORT, database: TEST_DB, user: RUNTIME_ROLE });
    await owner.connect();
    await runtime.connect();
  });

  beforeEach(async () => { await reset(); });

  afterAll(async () => {
    if (runtime) await runtime.end();
    if (owner) await owner.end();
    await reset();
  });

  it('1. applies ten immutable migrations and preserves the accepted 0009 predecessor hash', async () => {
    const ledger = await owner.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename');
    expect(ledger.rows).toHaveLength(11);
    expect(ledger.rows[8]).toEqual({
      filename: '0009_job_and_service_workstream_foundation.sql',
      sha256: '188cd691645a4ac039c83cf5939885d8b63997ab81ccb37be4667a5011738a66'
    });
    expect(ledger.rows[9].filename).toBe('0010_mission_plan_foundation.sql');
    expect(ledger.rows[10].filename).toBe('0011_media_asset_identity_and_lineage_foundation.sql');
  });

  it('2. creates exactly one draft per consistent Job-Appointment relationship and defaults all eligible nonterminal Workstreams', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token);
    const key = `draft-${crypto.randomUUID()}`;
    const planId = await createDraft(token, inputs.jobAppointmentId, key);
    expect(await createDraft(token, inputs.jobAppointmentId, key)).toBe(planId);
    expect((await owner.query(
      'SELECT count(*)::int AS count FROM medialab_core.mission_plan_draft_workstreams WHERE mission_plan_id = $1', [planId]
    )).rows[0].count).toBe(2);
    const draftWeather = (await owner.query(
      'SELECT weather_status, weather_evidence, weather_unavailable_reason FROM medialab_core.mission_plan_drafts WHERE mission_plan_id = $1', [planId]
    )).rows[0];
    expect(draftWeather.weather_status).toBe('UNAVAILABLE');
    expect(draftWeather.weather_evidence).toBeNull();
    expect(draftWeather.weather_unavailable_reason).toMatch(/no attributable forecast/);
    await expectFailure(createDraft(token, inputs.jobAppointmentId, key, {
      sections: [{ label: 'Conflict', visibility: 'ASSIGNED_CREW_ONLY', content: {} }]
    }), /Idempotency key conflicts/);
    await expectFailure(createDraft(token, inputs.jobAppointmentId), /already exists/);
  });

  it('3. supports explicit staff selection and rejects cross-Job, missing, and terminal Workstreams', async () => {
    const token = await issueSession();
    const first = await setupMissionInputs(token);
    const second = await setupMissionInputs(token, 1);
    const planId = await createDraft(token, first.jobAppointmentId);
    await runtime.query('SELECT medialab_core.replace_mission_plan_draft_workstreams($1, $2, $3, $4::uuid[])',
      [token, `select-${crypto.randomUUID()}`, planId, [first.workstreamIds[0]]]);
    expect((await owner.query(
      'SELECT service_workstream_id FROM medialab_core.mission_plan_draft_workstreams WHERE mission_plan_id = $1', [planId]
    )).rows).toEqual([{ service_workstream_id: first.workstreamIds[0] }]);
    await expectFailure(
      runtime.query('SELECT medialab_core.replace_mission_plan_draft_workstreams($1, $2, $3, $4::uuid[])',
        [token, `select-${crypto.randomUUID()}`, planId, [second.workstreamIds[0]]]),
      /cross-tenant, cross-Job, missing, or terminal/
    );
  });

  it('4. detects stale source evidence, requires refresh, and freezes Workstream evidence on issue', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token, 1);
    const planId = await createDraft(token, inputs.jobAppointmentId);
    await runtime.query('SELECT medialab_core.transition_service_workstream_state($1, $2, $3, $4, $5)',
      [token, `transition-${crypto.randomUUID()}`, inputs.workstreamIds[0], 'READY', 'Synthetic source change']);
    await expectFailure(issueVersion(token, planId), /draft is stale/);
    await runtime.query('SELECT medialab_core.refresh_mission_plan_draft($1, $2, $3)',
      [token, `refresh-${crypto.randomUUID()}`, planId]);
    const versionId = await issueVersion(token, planId);
    expect((await owner.query(
      'SELECT frozen_state FROM medialab_core.mission_plan_version_workstreams WHERE mission_plan_version_id = $1', [versionId]
    )).rows[0].frozen_state).toBe('READY');
  });

  it('5. issues deterministic canonical JSON, verifies readback, and supersedes without overwriting version one', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token, 1);
    const planId = await createDraft(token, inputs.jobAppointmentId);
    const first = await issueVersion(token, planId);
    await runtime.query('SELECT medialab_core.create_mission_plan_superseding_draft($1, $2, $3, $4)',
      [token, `superseding-draft-${crypto.randomUUID()}`, planId, first]);
    await runtime.query(
      'SELECT medialab_core.revise_mission_plan_draft($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)',
      [token, `revise-${crypto.randomUUID()}`, planId,
       JSON.stringify({ sections: [internalSection, potentialCustomerSection] }),
       'AVAILABLE', JSON.stringify({ provider: 'SYNTHETIC', observed_at: '2026-10-20T12:00:00Z', summary: 'Clear' }), null]
    );
    const second = await issueVersion(token, planId);
    const versions = await owner.query(
      `SELECT id, version_number, supersedes_version_id,
              canonical_json_sha256 = encode(sha256(convert_to(canonical_json::text, 'UTF8')), 'hex') AS hash_matches
         FROM medialab_core.mission_plan_versions WHERE mission_plan_id = $1 ORDER BY version_number`, [planId]
    );
    expect(versions.rows).toEqual([
      { id: first, version_number: 1, supersedes_version_id: null, hash_matches: true },
      { id: second, version_number: 2, supersedes_version_id: first, hash_matches: true }
    ]);
  });

  it('6. freezes historical contact values with canonical identity references and visibility', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token, 1);
    const planId = await createDraft(token, inputs.jobAppointmentId);
    const contact = await owner.query(
      'SELECT id, person_id FROM medialab_core.contact_methods WHERE person_id = $1 AND lifecycle_state = $2 ORDER BY created_at LIMIT 1',
      [PEOPLE_FIXTURES[1].id, 'ACTIVE']
    );
    await runtime.query('SELECT medialab_core.replace_mission_plan_draft_contacts($1, $2, $3, $4::jsonb)',
      [token, `contacts-${crypto.randomUUID()}`, planId, JSON.stringify([{
        person_id: contact.rows[0].person_id,
        contact_method_id: contact.rows[0].id,
        contact_role: 'PRIMARY_OPERATOR',
        visibility_classification: 'ASSIGNED_CREW_ONLY'
      }])]);
    const versionId = await issueVersion(token, planId);
    const snapshot = await owner.query(
      'SELECT person_id, contact_method_id, snapshot_normalized_value FROM medialab_core.mission_plan_version_contacts WHERE mission_plan_version_id = $1',
      [versionId]
    );
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].person_id).toBe(PEOPLE_FIXTURES[1].id);
    expect(snapshot.rows[0].snapshot_normalized_value.length).toBeGreaterThan(0);
  });

  it('7. stores only opaque protected envelopes and excludes ciphertext from ordinary and canonical projections', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token, 1);
    const planId = await createDraft(token, inputs.jobAppointmentId);
    const encrypted = Buffer.from('synthetic-opaque-encrypted-payload');
    const ciphertextHash = bufferDigest(encrypted);
    const key = `envelope-${crypto.randomUUID()}`;
    const envelope = await runtime.query<{ record_mission_plan_sensitive_envelope: string }>(
      `SELECT medialab_core.record_mission_plan_sensitive_envelope(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [token, key, planId, null, 'ML-OPAQUE-1', 'AES-256-GCM', 'provider-neutral-key-ref', 'synthetic-iv',
       encrypted.toString('base64'), ciphertextHash, digest('trusted-payload')]
    );
    const replay = await runtime.query<{ record_mission_plan_sensitive_envelope: string }>(
      `SELECT medialab_core.record_mission_plan_sensitive_envelope(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [token, key, planId, null, 'ML-OPAQUE-1', 'AES-256-GCM', 'provider-neutral-key-ref', 'synthetic-iv',
       encrypted.toString('base64'), ciphertextHash, digest('trusted-payload')]
    );
    expect(replay.rows[0].record_mission_plan_sensitive_envelope).toBe(envelope.rows[0].record_mission_plan_sensitive_envelope);
    const replacementBytes = Buffer.from('synthetic-replacement-encrypted-payload');
    const replacement = await runtime.query<{ record_mission_plan_sensitive_envelope: string }>(
      `SELECT medialab_core.record_mission_plan_sensitive_envelope(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [token, `replacement-${crypto.randomUUID()}`, planId,
       envelope.rows[0].record_mission_plan_sensitive_envelope, 'ML-OPAQUE-1', 'AES-256-GCM',
       'provider-neutral-key-ref-v2', 'synthetic-iv-v2', replacementBytes.toString('base64'),
       bufferDigest(replacementBytes), null]
    );
    expect(replacement.rows[0].record_mission_plan_sensitive_envelope).not.toBe(envelope.rows[0].record_mission_plan_sensitive_envelope);
    const versionId = await issueVersion(token, planId);
    const canonical = (await owner.query('SELECT canonical_json FROM medialab_core.mission_plan_versions WHERE id = $1', [versionId])).rows[0].canonical_json;
    expect(JSON.stringify(canonical)).not.toContain(encrypted.toString('base64'));
    expect(JSON.stringify(canonical)).not.toContain('opaque_ciphertext');
    const ordinary = await runtime.query<{ get_mission_plan_record: any }>(
      'SELECT medialab_core.get_mission_plan_record($1, $2)', [token, planId]
    );
    expect(JSON.stringify(ordinary.rows[0].get_mission_plan_record)).not.toContain(encrypted.toString('base64'));
    const protectedResult = await runtime.query<{ get_mission_plan_sensitive_envelopes: any[] }>(
      'SELECT medialab_core.get_mission_plan_sensitive_envelopes($1, $2)', [token, planId]
    );
    expect(protectedResult.rows[0].get_mission_plan_sensitive_envelopes).toHaveLength(2);
    expect(protectedResult.rows[0].get_mission_plan_sensitive_envelopes[0].opaque_ciphertext_base64).toBe(encrypted.toString('base64'));
    expect(protectedResult.rows[0].get_mission_plan_sensitive_envelopes[1].supersedes_envelope_id)
      .toBe(envelope.rows[0].record_mission_plan_sensitive_envelope);
  });

  it('8. rejects protected-secret keys in draft content and rejects incorrect ciphertext hashes', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token, 1);
    await expectFailure(createDraft(token, inputs.jobAppointmentId, undefined, {
      sections: [{ label: 'Bad', visibility: 'INTERNAL_STAFF_ONLY', content: { password: 'not-allowed' } }]
    }), /Protected secret material/);
    await expectFailure(createDraft(token, inputs.jobAppointmentId, undefined, {
      sections: [{ label: 'Missing visibility', content: { safe: true } }]
    }), /approved visibility classification/);
    const planId = await createDraft(token, inputs.jobAppointmentId);
    await expectFailure(runtime.query(
      `SELECT medialab_core.record_mission_plan_sensitive_envelope(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [token, `bad-envelope-${crypto.randomUUID()}`, planId, null, 'ML-OPAQUE-1', 'AES-256-GCM', 'key-ref', null,
       Buffer.from('ciphertext').toString('base64'), '0'.repeat(64), null]
    ), /ciphertext hash/);
  });

  it('9. enforces tenant isolation and filters internal sections from assigned-crew projections', async () => {
    const staffToken = await issueSession();
    const inputs = await setupMissionInputs(staffToken, 1);
    const planId = await createDraft(staffToken, inputs.jobAppointmentId);
    await issueVersion(staffToken, planId);

    const crewPersonId = crypto.randomUUID();
    const crewIdentityId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO medialab_core.people (id, display_name, email, title, created_at, updated_at)
       VALUES ($1, 'Synthetic Assigned Crew', 'crew@mission-plan.invalid', NULL, clock_timestamp(), clock_timestamp())`, [crewPersonId]
    );
    await owner.query(
      `INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, status, email_verified_at, created_at)
       VALUES ($1, $2, 'LOCAL_DEVELOPMENT', $3, 'ACTIVE', clock_timestamp(), clock_timestamp())`,
      [crewIdentityId, crewPersonId, `crew-${crypto.randomUUID()}`]
    );
    await owner.query(
      `INSERT INTO medialab_core.memberships
         (id, organization_id, person_id, status, is_organization_admin, activated_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', false, clock_timestamp(), clock_timestamp(), clock_timestamp())`,
      [crypto.randomUUID(), ORGANIZATION_FIXTURE.id, crewPersonId]
    );
    await runtime.query('SELECT medialab_core.assign_appointment_participant($1, $2, $3, $4, $5)',
      [staffToken, `assign-${crypto.randomUUID()}`, inputs.appointmentId, crewPersonId, 'PRIMARY_OPERATOR']);
    const crewToken = await issueSession(crewIdentityId);
    const crewRecord = (await runtime.query<{ get_mission_plan_record: any }>(
      'SELECT medialab_core.get_mission_plan_record($1, $2)', [crewToken, planId]
    )).rows[0].get_mission_plan_record;
    const crewSections = crewRecord.versions[0].content.sections;
    expect(crewSections.map((section: any) => section.visibility)).toEqual([
      'ASSIGNED_CREW_ONLY', 'POTENTIALLY_CUSTOMER_VISIBLE'
    ]);
    const staffRecord = (await runtime.query<{ get_mission_plan_record: any }>(
      'SELECT medialab_core.get_mission_plan_record($1, $2)', [staffToken, planId]
    )).rows[0].get_mission_plan_record;
    expect(staffRecord.versions[0].content.sections).toHaveLength(3);
    expect((await runtime.query<{ list_mission_plans: any[] }>(
      'SELECT medialab_core.list_mission_plans($1, $2, $3)', [staffToken, inputs.jobId, null]
    )).rows[0].list_mission_plans).toHaveLength(1);

    const unauthorizedPersonId = crypto.randomUUID();
    const unauthorizedIdentityId = crypto.randomUUID();
    await owner.query(
      `INSERT INTO medialab_core.people (id, display_name, email, title, created_at, updated_at)
       VALUES ($1, 'Synthetic Unassigned Reader', 'unassigned@mission-plan.invalid', NULL, clock_timestamp(), clock_timestamp())`,
      [unauthorizedPersonId]
    );
    await owner.query(
      `INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, status, email_verified_at, created_at)
       VALUES ($1, $2, 'LOCAL_DEVELOPMENT', $3, 'ACTIVE', clock_timestamp(), clock_timestamp())`,
      [unauthorizedIdentityId, unauthorizedPersonId, `unassigned-${crypto.randomUUID()}`]
    );
    await owner.query(
      `INSERT INTO medialab_core.memberships
         (id, organization_id, person_id, status, is_organization_admin, activated_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', false, clock_timestamp(), clock_timestamp(), clock_timestamp())`,
      [crypto.randomUUID(), ORGANIZATION_FIXTURE.id, unauthorizedPersonId]
    );
    const unauthorizedToken = await issueSession(unauthorizedIdentityId);
    await expectFailure(runtime.query('SELECT medialab_core.get_mission_plan_record($1, $2)',
      [unauthorizedToken, planId]), /lacks Mission Plan read authority/);
    await expectFailure(runtime.query('SELECT medialab_core.list_mission_plans($1, $2, $3)',
      [unauthorizedToken, null, inputs.appointmentId]), /lacks Mission Plan read authority/);
  });

  it('10. records append-only attributable notes and open events without making validity depend on opening', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token, 1);
    const planId = await createDraft(token, inputs.jobAppointmentId);
    const note = await runtime.query<{ add_mission_plan_note: string }>(
      'SELECT medialab_core.add_mission_plan_note($1, $2, $3, $4, $5)',
      [token, `note-${crypto.randomUUID()}`, planId, 'ASSIGNED_CREW_ONLY', 'Synthetic attributable access note']
    );
    const versionId = await issueVersion(token, planId);
    expect((await owner.query(
      'SELECT count(*)::int AS count FROM medialab_core.mission_plan_version_notes WHERE mission_plan_version_id = $1', [versionId]
    )).rows[0].count).toBe(1);
    await runtime.query('SELECT medialab_core.record_mission_plan_open_event($1, $2, $3, $4, $5, $6::jsonb)',
      [token, `open-${crypto.randomUUID()}`, planId, versionId, 'OPENED', JSON.stringify({ channel: 'SYNTHETIC_TEST' })]);
    expect((await owner.query('SELECT count(*)::int AS count FROM medialab_core.mission_plan_versions WHERE id = $1', [versionId])).rows[0].count).toBe(1);
    await expectFailure(owner.query('UPDATE medialab_core.mission_plan_notes SET note_text = $1 WHERE id = $2', ['Rewritten', note.rows[0].add_mission_plan_note]), /immutable append-only/);
    await expectFailure(owner.query('DELETE FROM medialab_core.mission_plan_open_events WHERE mission_plan_id = $1', [planId]), /immutable append-only/);
  });

  it('11. rejects UPDATE and DELETE across issued versions, frozen children, events, envelopes, and idempotency evidence', async () => {
    const token = await issueSession();
    const inputs = await setupMissionInputs(token, 1);
    const planId = await createDraft(token, inputs.jobAppointmentId);
    const versionId = await issueVersion(token, planId);
    const commands: Array<() => Promise<unknown>> = [
      () => owner.query('UPDATE medialab_core.mission_plan_versions SET version_number = 2 WHERE id = $1', [versionId]),
      () => owner.query('DELETE FROM medialab_core.mission_plan_version_workstreams WHERE mission_plan_version_id = $1', [versionId]),
      () => owner.query('DELETE FROM medialab_core.mission_plan_events WHERE mission_plan_id = $1', [planId]),
      () => owner.query('DELETE FROM medialab_core.mission_plan_command_idempotency WHERE actor_identity_id = $1', [STAFF_IDENTITY_ID])
    ];
    for (const command of commands) await expectFailure(command(), /immutable append-only/);
  });

  it('12. denies PUBLIC and direct runtime table authority while granting only controlled Mission Plan functions', async () => {
    const tablePrivileges = await owner.query(
      `SELECT c.relname,
              has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS runtime_access,
              has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS public_access
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'medialab_core' AND c.relname LIKE 'mission_plan%'`, [RUNTIME_ROLE]
    );
    expect(tablePrivileges.rows.every((row) => !row.runtime_access && !row.public_access)).toBe(true);
    await expectFailure(runtime.query('SELECT * FROM medialab_core.mission_plans'), /permission denied/);
    await expectFailure(runtime.query('UPDATE medialab_core.mission_plan_drafts SET draft_generation = 99'), /permission denied/);
    const functionPrivileges = await owner.query(
      `SELECT p.proname,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'medialab_core' AND p.proname LIKE '%mission_plan%'`, [RUNTIME_ROLE]
    );
    expect(functionPrivileges.rows.every((row) => !row.public_execute)).toBe(true);
    expect(functionPrivileges.rows.find((row) => row.proname === 'create_mission_plan_draft').runtime_execute).toBe(true);
    expect(functionPrivileges.rows.find((row) => row.proname === 'compute_mission_plan_source_fingerprint').runtime_execute).toBe(false);
    const excludedSchema = await owner.query(
      `SELECT count(*)::int AS count
         FROM information_schema.columns
        WHERE table_schema = 'medialab_core' AND (table_name ILIKE '%gear%' OR column_name ILIKE '%gear%')`
    );
    expect(excludedSchema.rows[0].count).toBe(0);
  });
});
