import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createOperationsConsoleApp } from "../src/operations-console/app.js";
import {
  commercialFingerprint,
  OperationsConsoleDatabase,
  OPERATIONS_CONSOLE_DATABASE,
  OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
  OPERATIONS_CONSOLE_ORGANIZATION_ID,
  resolveCatalogSelections,
  sha256Evidence,
} from "../src/operations-console/database.js";
import { OperationsConsoleService } from "../src/operations-console/service.js";
import {
  DevelopmentOperatorSessionManager,
  type ServerBoundDevelopmentOperatorContext,
} from "../src/operations-console/session.js";
import {
  issueOperationsConsoleDatabaseSession,
  resetAndSeedOperationsConsoleDatabase,
} from "../scripts/run-internal-operations-console-new-listing.js";

const owner = { ...OPERATIONS_CONSOLE_DATABASE, user: "medialab_p02m17a_test_owner" };
let token = "";
let orderId = "";
let secondaryOrderId = "";
let latestAppointmentId = "";
let latestAssignmentId = "";
let serverContext: ServerBoundDevelopmentOperatorContext;

async function createSyntheticOrder(suffix: string): Promise<string> {
  const database = new OperationsConsoleDatabase();
  try {
    const property = {
      addressLine1: `${suffix} Operations Way`, addressLine2: null, locality: "Example City",
      administrativeArea: "NY", postalCode: "10001", countryCode: "US", squareFeet: 1800,
    };
    const customer = { displayName: `${suffix} Operations Customer`, email: `${suffix.toLowerCase()}-operations@example.invalid` };
    const selections = [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 }];
    const projection = await database.getCatalog(token);
    const lines = resolveCatalogSelections(projection, selections, property.squareFeet);
    const result = await database.createListing({
      databaseSessionToken: token,
      submissionId: `m18a-${suffix.toLowerCase()}-${randomUUID()}`,
      requestFingerprint: sha256Evidence({ customer, property, selections }),
      expectedCommercialFingerprint: commercialFingerprint(lines),
      customer, property, selections,
    });
    return result.orderId;
  } finally { await database.close(); }
}

describe("P02-M18-A Operations Home, scheduling, and assignment", () => {
  beforeAll(async () => {
    await resetAndSeedOperationsConsoleDatabase(18);
    const issued = await issueOperationsConsoleDatabaseSession();
    token = issued.databaseSessionToken;
    serverContext = issued.context;
    orderId = await createSyntheticOrder("M18");
  }, 60_000);

  it("renders canonical appointment-local time when the browser and appointment zones differ", () => {
    const source = readFileSync(new URL("../src/operations-console/public/app.js", import.meta.url), "utf8");
    const sandbox: Record<string, unknown> = {};
    runInNewContext(`${source}\n;globalThis.__formatOperationalDateTime = operationalDateTime;`, sandbox);
    const format = sandbox.__formatOperationalDateTime as (localStartsAt: string, ianaTimezone: string) => string;
    const rendered = format("2026-08-21T09:00:00", "America/Los_Angeles");
    expect(rendered).toBe("Friday, August 21 · 9:00 a.m.");
    expect(rendered).not.toContain("12:00");
    expect(rendered).not.toContain("America/Los_Angeles");
    expect(source).not.toMatch(/new Date\((?:item\.appointment|windowRecord|appointment)\.startsAt\)\.toLocaleString/u);
  });

  it("uses one appointment date with start and end times for the same onsite visit", () => {
    const source = readFileSync(new URL("../src/operations-console/public/app.js", import.meta.url), "utf8");
    const start = source.indexOf("function appointmentWindowFromDateAndTimes");
    const end = source.indexOf("function schedulingForm", start);
    const sandbox: Record<string, unknown> = {};
    runInNewContext(`${source.slice(start, end)}\n;globalThis.__appointmentWindow = appointmentWindowFromDateAndTimes;`, sandbox);
    const appointmentWindow = sandbox.__appointmentWindow as (date: string, startTime: string, endTime: string) => {
      startsAt: string; endsAt: string; localStartsAt: string; localEndsAt: string;
    } | null;
    const window = appointmentWindow("2026-08-21", "09:00", "10:30")!;
    expect(window.localStartsAt).toBe("2026-08-21T09:00");
    expect(window.localEndsAt).toBe("2026-08-21T10:30");
    expect(new Date(window.endsAt).valueOf() - new Date(window.startsAt).valueOf()).toBe(90 * 60 * 1000);
    expect(appointmentWindow("2026-08-21", "10:30", "09:00")).toBeNull();
    expect(source).not.toContain('field("Ends", "datetime-local"');
    expect(source).not.toContain('field("New end", "datetime-local"');
  });

  it("preserves exact 0001-0024 authority under the additive M19 read projection with no table-read/write or sequence grant expansion", async () => {
    const client = new pg.Client(owner); await client.connect();
    try {
      const ledger = await client.query<{ filename: string }>("SELECT filename FROM medialab_meta.schema_migrations ORDER BY filename");
      expect(ledger.rows).toHaveLength(27);
      expect(ledger.rows[23]!.filename).toBe("0024_operations_home_scheduling_assignment_console.sql");
      expect(ledger.rows[24]!.filename).toBe("0025_operations_mission_plan_draft_controls.sql");
      const grants = await client.query<{ name: string }>(`SELECT p.proname AS name FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core'
        AND p.proname IN ('get_operations_home','get_operations_order_context','list_operations_assignment_candidates')
        AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY p.proname`, [OPERATIONS_CONSOLE_DATABASE.user]);
      expect(grants.rows.map((row) => row.name)).toEqual([
        "get_operations_home", "get_operations_order_context", "list_operations_assignment_candidates",
      ]);
      const publicExecute = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='medialab_core'
        AND p.proname IN ('operations_order_context','get_operations_home','get_operations_order_context','list_operations_assignment_candidates')
        AND has_function_privilege('public',p.oid,'EXECUTE')`);
      expect(publicExecute.rows[0]!.count).toBe(0);
      const tableAuthority = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM information_schema.role_table_grants
        WHERE grantee=$1 AND table_schema='medialab_core' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')`, [OPERATIONS_CONSOLE_DATABASE.user]);
      expect(tableAuthority.rows[0]!.count).toBe(0);
      const sequenceAuthority = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM information_schema.role_usage_grants
        WHERE grantee=$1 AND object_schema='medialab_core' AND object_type='SEQUENCE'`, [OPERATIONS_CONSOLE_DATABASE.user]);
      expect(sequenceAuthority.rows[0]!.count).toBe(0);
    } finally { await client.end(); }
  });

  it("initializes exact context with replay and concurrency safety", async () => {
    const database = new OperationsConsoleDatabase();
    try {
      const first = await database.initializeOperations(token, orderId);
      const second = await database.initializeOperations(token, orderId);
      expect(first.propertyHubId).toBeTruthy();
      expect(first.scheduling?.requestId).toBeTruthy();
      expect(first.job?.workstreams).toHaveLength(1);
      expect(second.propertyHubId).toBe(first.propertyHubId);
      expect(second.scheduling?.requestId).toBe(first.scheduling?.requestId);
      expect(second.job?.jobId).toBe(first.job?.jobId);

      secondaryOrderId = await createSyntheticOrder("Concurrent");
      const [concurrentOne, concurrentTwo] = await Promise.all([
        database.initializeOperations(token, secondaryOrderId),
        database.initializeOperations(token, secondaryOrderId),
      ]);
      expect(concurrentTwo.propertyHubId).toBe(concurrentOne.propertyHubId);
      expect(concurrentTwo.scheduling?.requestId).toBe(concurrentOne.scheduling?.requestId);
      expect(concurrentTwo.job?.jobId).toBe(concurrentOne.job?.jobId);
    } finally { await database.close(); }
  });

  it("rolls back every partial initialization effect when a later canonical command loses authority", async () => {
    const rollbackOrderId = await createSyntheticOrder("Rollback");
    const database = new OperationsConsoleDatabase(); const client = new pg.Client(owner); await client.connect();
    const signature = "medialab_core.create_scheduling_request(text, text, uuid, uuid, uuid, text)";
    try {
      await client.query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM medialab_p02m17a_test_app`);
      await expect(database.initializeOperations(token, rollbackOrderId)).rejects.toMatchObject({ code: "AUTHORITY" });
    } finally {
      await client.query(`GRANT EXECUTE ON FUNCTION ${signature} TO medialab_p02m17a_test_app`);
    }
    try {
      const partial = await client.query<{ hubs: number; requests: number; jobs: number; workstreams: number }>(`SELECT
        (SELECT count(*)::int FROM medialab_core.property_hub_orders WHERE order_id=$1) AS hubs,
        (SELECT count(*)::int FROM medialab_core.scheduling_requests WHERE order_id=$1) AS requests,
        (SELECT count(*)::int FROM medialab_core.jobs WHERE order_id=$1) AS jobs,
        (SELECT count(*)::int FROM medialab_core.service_workstreams WHERE order_id=$1) AS workstreams`, [rollbackOrderId]);
      expect(partial.rows[0]).toEqual({ hubs: 0, requests: 0, jobs: 0, workstreams: 0 });
      const recovered = await database.initializeOperations(token, rollbackOrderId);
      expect(recovered.propertyHubId).toBeTruthy();
      expect(recovered.scheduling?.requestId).toBeTruthy();
      expect(recovered.job?.workstreams).toHaveLength(1);
    } finally { await client.end(); await database.close(); }
  });

  it("binds every mutation to its canonical resource and preserves exact replay across appointment lifecycles", async () => {
    const database = new OperationsConsoleDatabase();
    try {
      const initial = await database.getOperationsContext(token, orderId);
      expect(initial.customer.contacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ contactType: "EMAIL", displayValue: expect.any(String) }),
      ]));
      expect(initial.services[0]).toMatchObject({
        unitAmountCents: expect.any(Number),
        lineTotalCents: expect.any(Number),
        currency: "USD",
      });
      expect(initial.services[0]!.lineTotalCents).toBeGreaterThan(0);
      const requestId = initial.scheduling!.requestId;
      const requested = await database.addRequestedWindow(token, orderId, requestId, {
        startsAt: "2026-08-21T13:00:00.000Z", endsAt: "2026-08-21T14:30:00.000Z",
        ianaTimezone: "America/New_York", localStartsAt: "2026-08-21T09:00:00", localEndsAt: "2026-08-21T10:30:00",
      });
      expect(requested.scheduling!.windows[0]!.accepted).toBe(false);
      const proposed = await database.proposeWindow(token, orderId, requestId, {
        startsAt: "2026-08-21T15:00:00.000Z", endsAt: "2026-08-21T16:30:00.000Z",
        ianaTimezone: "America/New_York", localStartsAt: "2026-08-21T11:00:00", localEndsAt: "2026-08-21T12:30:00",
        reason: "Staff alternate for route efficiency",
      });
      const proposedWindow = proposed.scheduling!.windows.find((item) => item.kind === "STAFF_PROPOSED")!;
      const accepted = await database.acceptProposal(token, orderId, requestId, {
        windowId: proposedWindow.windowId, acceptanceMethod: "PHONE", note: "Customer accepted by phone",
      });
      expect(accepted.scheduling!.windows.find((item) => item.windowId === proposedWindow.windowId)?.accepted).toBe(true);
      const confirmed = await database.confirmAppointment(token, orderId, requestId, {
        windowId: proposedWindow.windowId, reason: "Accepted staff alternate confirmed",
      });
      const firstAppointmentId = confirmed.appointment!.appointmentId;
      expect(confirmed.attention).toContain("PRIMARY_OPERATOR_UNASSIGNED");

      const candidates = await database.listAssignmentCandidates(token, OPERATIONS_CONSOLE_ORGANIZATION_ID);
      const replacement = candidates.candidates.find((person) => person.personId !== OPERATIONS_CONSOLE_OPERATOR_PERSON_ID)!;
      expect(replacement).toBeTruthy();
      await expect(database.assignParticipant(token, orderId, firstAppointmentId, {
        personId: randomUUID(), operationalRole: "PRIMARY_OPERATOR",
      })).rejects.toMatchObject({ code: "AUTHORITY" });

      const assigned = await database.assignParticipant(token, orderId, firstAppointmentId, {
        personId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID, operationalRole: "PRIMARY_OPERATOR",
      });
      const assignedReplay = await database.assignParticipant(token, orderId, firstAppointmentId, {
        personId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID, operationalRole: "PRIMARY_OPERATOR",
      });
      const originalAssignment = assigned.appointment!.assignments[0]!;
      expect(assignedReplay.appointment!.assignments[0]!.assignmentId).toBe(originalAssignment.assignmentId);

      await expect(database.replaceParticipant(token, orderId, firstAppointmentId, originalAssignment.assignmentId, {
        replacementPersonId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
        reason: "A person cannot replace themselves in the same active role",
      })).rejects.toMatchObject({ code: "CONFLICT" });

      const replacementInput = { replacementPersonId: replacement.personId, reason: "Coverage changed for this appointment" };
      const replaced = await database.replaceParticipant(token, orderId, firstAppointmentId, originalAssignment.assignmentId, replacementInput);
      const replacedReplay = await database.replaceParticipant(token, orderId, firstAppointmentId, originalAssignment.assignmentId, replacementInput);
      expect(replacedReplay.appointment!.assignments[0]!.assignmentId).toBe(replaced.appointment!.assignments[0]!.assignmentId);
      const duplicateRoleAssignment = await database.assignParticipant(token, orderId, firstAppointmentId, {
        personId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID, operationalRole: "PRIMARY_OPERATOR",
      });
      const duplicateRoleTarget = duplicateRoleAssignment.appointment!.assignments.find(
        (assignment) => assignment.personId === OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
      )!;
      await expect(database.replaceParticipant(token, orderId, firstAppointmentId, duplicateRoleTarget.assignmentId, replacementInput))
        .rejects.toMatchObject({ code: "CONFLICT" });

      const rescheduleInput = {
        startsAt: "2026-08-22T15:00:00.000Z", endsAt: "2026-08-22T16:30:00.000Z",
        ianaTimezone: "America/New_York", localStartsAt: "2026-08-22T11:00:00", localEndsAt: "2026-08-22T12:30:00",
        acceptanceMethod: "PHONE" as const, reason: "Customer accepted the new time", note: "Confirmed by phone",
      };
      const rescheduled = await database.rescheduleAppointment(token, orderId, firstAppointmentId, rescheduleInput);
      const rescheduledReplay = await database.rescheduleAppointment(token, orderId, firstAppointmentId, rescheduleInput);
      latestAppointmentId = rescheduled.appointment!.appointmentId;
      expect(rescheduledReplay.appointment!.appointmentId).toBe(latestAppointmentId);
      expect(new Date(rescheduled.appointment!.startsAt).toISOString()).toBe("2026-08-22T15:00:00.000Z");

      await expect(database.replaceParticipant(token, orderId, latestAppointmentId, originalAssignment.assignmentId, replacementInput))
        .rejects.toMatchObject({ code: "CONFLICT" });
      const laterLifecycleAssignment = await database.assignParticipant(token, orderId, latestAppointmentId, {
        personId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID, operationalRole: "PRIMARY_OPERATOR",
      });
      const laterLifecycleReplay = await database.assignParticipant(token, orderId, latestAppointmentId, {
        personId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID, operationalRole: "PRIMARY_OPERATOR",
      });
      latestAssignmentId = laterLifecycleAssignment.appointment!.assignments[0]!.assignmentId;
      expect(laterLifecycleReplay.appointment!.assignments[0]!.assignmentId).toBe(latestAssignmentId);

      const cancelled = await database.cancelAppointment(token, orderId, latestAppointmentId, { reason: "Test closeout cancellation" });
      const cancelledReplay = await database.cancelAppointment(token, orderId, latestAppointmentId, { reason: "Test closeout cancellation" });
      expect(cancelled.appointment?.state).toBe("CANCELLED");
      expect(cancelledReplay.appointment?.state).toBe("CANCELLED");
      await expect(database.replaceParticipant(token, orderId, latestAppointmentId, latestAssignmentId, replacementInput))
        .rejects.toMatchObject({ code: "CONFLICT" });

      const secondary = await database.getOperationsContext(token, secondaryOrderId);
      const secondaryRequestId = secondary.scheduling!.requestId;
      const alternate = await database.proposeWindow(token, secondaryOrderId, secondaryRequestId, {
        startsAt: "2026-08-24T13:00:00.000Z", endsAt: "2026-08-24T14:00:00.000Z",
        ianaTimezone: "America/New_York", localStartsAt: "2026-08-24T09:00:00", localEndsAt: "2026-08-24T10:00:00",
        reason: "Secondary-order alternate",
      });
      const foreignWindowId = alternate.scheduling!.windows[0]!.windowId;
      await expect(database.acceptProposal(token, orderId, secondaryRequestId, {
        windowId: foreignWindowId, acceptanceMethod: "PHONE", note: "Must remain resource-bound",
      })).rejects.toMatchObject({ code: "CONFLICT" });
    } finally { await database.close(); }
  }, 20_000);

  it("returns server-produced stable sections and only fully active assignment candidates", async () => {
    const database = new OperationsConsoleDatabase(); const client = new pg.Client(owner); await client.connect();
    try {
      const home = await database.getOperationsHome(token, "2026-08-22T04:00:00.000Z", "2026-10-01T04:00:00.000Z");
      expect(home.counts.today).toBe(home.sections.today.length);
      expect(home.counts.upcoming).toBe(home.sections.upcoming.length);
      expect(home.counts.needsAttention).toBe(home.sections.needsAttention.length);
      expect(home.sections.today.some((item) => item.orderId === orderId)).toBe(true);
      expect(home.sections.needsAttention.every((item) => item.attention.length > 0)).toBe(true);
      const stable = [...home.items].sort((left, right) => {
        const leftTime = left.appointment?.startsAt ?? left.createdAt;
        const rightTime = right.appointment?.startsAt ?? right.createdAt;
        return leftTime.localeCompare(rightTime) || left.orderId.localeCompare(right.orderId);
      });
      expect(home.items.map((item) => item.orderId)).toEqual(stable.map((item) => item.orderId));
      const after = await database.getOperationsHome(token, "2026-08-23T04:00:00.000Z", "2026-10-01T04:00:00.000Z");
      expect(after.items.some((item) => item.orderId === orderId)).toBe(false);

      const candidates = await database.listAssignmentCandidates(token, OPERATIONS_CONSOLE_ORGANIZATION_ID);
      expect(candidates.candidates.length).toBeGreaterThan(1);
      const eligible = await client.query<{ count: number }>(`SELECT count(DISTINCT p.id)::int AS count
        FROM medialab_core.people p WHERE p.id=ANY($1::uuid[]) AND EXISTS (
          SELECT 1 FROM medialab_core.memberships m WHERE m.person_id=p.id AND m.organization_id=$2 AND m.status='ACTIVE'
        ) AND EXISTS (
          SELECT 1 FROM medialab_core.identities i JOIN medialab_core.person_account_states s
            ON s.identity_id=i.id AND s.person_id=i.person_id
           WHERE i.person_id=p.id AND i.status='ACTIVE' AND s.current_state IN ('ACTIVE','RECOVERED')
        )`, [candidates.candidates.map((candidate) => candidate.personId), OPERATIONS_CONSOLE_ORGANIZATION_ID]);
      expect(eligible.rows[0]!.count).toBe(candidates.candidates.length);
    } finally { await client.end(); await database.close(); }
  });

  it("enforces session, same-origin, strict-body, resource-route, and response-sanitization boundaries", async () => {
    const service = new OperationsConsoleService(new OperationsConsoleDatabase());
    const sessions = new DevelopmentOperatorSessionManager({ ttlSeconds: 900 });
    const app = createOperationsConsoleApp({ service, sessions, developmentOperatorContext: serverContext });
    try {
      const issued = await app.inject({ method: "POST", url: "/session", payload: {} });
      expect(issued.statusCode).toBe(200);
      const setCookie = Array.isArray(issued.headers["set-cookie"]) ? issued.headers["set-cookie"][0] : issued.headers["set-cookie"];
      const cookie = String(setCookie).split(";", 1)[0]!;
      const range = "from=2026-08-20T04%3A00%3A00.000Z&to=2026-10-01T04%3A00%3A00.000Z";
      expect((await app.inject({ method: "GET", url: `/api/operations?${range}` })).statusCode).toBe(401);
      const home = await app.inject({ method: "GET", url: `/api/operations?${range}`, headers: { cookie } });
      expect(home.statusCode).toBe(200);
      expect(home.json().sections).toBeTruthy();
      expect(home.body).not.toMatch(/customerIdentityId|schedulingRequestLineageIds|appointmentLineageIds|assignmentLineageIds/);

      const unknownField = await app.inject({ method: "POST",
        url: `/api/operations/orders/${orderId}/appointments/${latestAppointmentId}/cancel`,
        headers: { cookie, "content-type": "application/json" }, payload: { reason: "Strict body", extra: true } });
      expect(unknownField.statusCode).toBe(400);
      const hostileOrigin = await app.inject({ method: "POST", url: `/api/operations/orders/${orderId}/initialize`,
        headers: { cookie, origin: "https://example.invalid", host: "127.0.0.1:4317", "content-type": "application/json" }, payload: {} });
      expect(hostileOrigin.statusCode).toBe(403);
      const mismatchedRoute = await app.inject({ method: "POST",
        url: `/api/operations/orders/${orderId}/scheduling/${randomUUID()}/requested-windows`,
        headers: { cookie, "content-type": "application/json" }, payload: {
          startsAt: "2026-09-01T13:00:00.000Z", endsAt: "2026-09-01T14:00:00.000Z",
          ianaTimezone: "America/New_York", localStartsAt: "2026-09-01T09:00:00", localEndsAt: "2026-09-01T10:00:00",
        } });
      expect(mismatchedRoute.statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it("denies an active identity that lacks staff/order-read authority", async () => {
    const client = new pg.Client(owner); await client.connect();
    const otherToken = randomBytes(32).toString("base64url");
    const personId = randomUUID(); const identityId = randomUUID();
    try {
      await client.query(`INSERT INTO medialab_core.people(id,display_name,email,title)
        VALUES($1,'Synthetic Unprivileged Identity',$2,NULL)`, [personId, `${personId}@synthetic.invalid`]);
      await client.query(`INSERT INTO medialab_core.identities(id,person_id,provider,provider_subject,status,email_verified_at)
        VALUES($1,$2,'LOCAL_DEVELOPMENT',$3,'ACTIVE',clock_timestamp())`, [identityId, personId, `m18-unprivileged-${identityId}`]);
      await client.query(`INSERT INTO medialab_core.development_sessions(id,identity_id,token_sha256,issued_at,expires_at)
        VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '30 minutes')`,
      [randomUUID(), identityId, createHash("sha256").update(otherToken).digest("hex")]);
      const database = new OperationsConsoleDatabase();
      try { await expect(database.getOperationsContext(otherToken, orderId)).rejects.toMatchObject({ code: "AUTHORITY" }); }
      finally { await database.close(); }
    } finally { await client.end(); }
  });

  it("fails closed on parallel Job ambiguity without adding further context", async () => {
    const ambiguousOrderId = await createSyntheticOrder("Ambiguous");
    const database = new OperationsConsoleDatabase();
    const runtime = new pg.Client(OPERATIONS_CONSOLE_DATABASE);
    const observer = new pg.Client(owner);
    try {
      const context = await database.initializeOperations(token, ambiguousOrderId);
      await runtime.connect(); await observer.connect();
      await runtime.query("SELECT medialab_core.create_job($1,$2,$3::uuid,$4::uuid,$5::uuid,$6)",
        [token, `m18a-ambiguous-${randomUUID()}`, context.organizationId, ambiguousOrderId, context.propertyHubId, "INTERNAL_OPERATIONS_CONSOLE"]);
      const before = await observer.query<{ count: number }>("SELECT count(*)::int AS count FROM medialab_core.jobs WHERE order_id=$1", [ambiguousOrderId]);
      expect(before.rows[0]!.count).toBe(2);
      await expect(database.getOperationsContext(token, ambiguousOrderId)).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(database.initializeOperations(token, ambiguousOrderId)).rejects.toMatchObject({ code: "CONFLICT" });
      const after = await observer.query<{ count: number }>("SELECT count(*)::int AS count FROM medialab_core.jobs WHERE order_id=$1", [ambiguousOrderId]);
      expect(after.rows[0]!.count).toBe(2);
    } finally { await runtime.end(); await observer.end(); await database.close(); }
  });
});
