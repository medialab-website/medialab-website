import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOperationsConsoleApp } from "../src/operations-console/app.js";
import {
  commercialFingerprint,
  OperationsConsoleDatabase,
  OPERATIONS_CONSOLE_DATABASE,
  OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
  resolveCatalogSelections,
  sha256Evidence,
} from "../src/operations-console/database.js";
import { OperationsConsoleService } from "../src/operations-console/service.js";
import { DevelopmentOperatorSessionManager, type ServerBoundDevelopmentOperatorContext } from "../src/operations-console/session.js";
import {
  issueOperationsConsoleDatabaseSession,
  resetAndSeedOperationsConsoleDatabase,
} from "../scripts/run-internal-operations-console-new-listing.js";

let token = "";
let orderId = "";
let missionPlanId = "";
let latestVersionId = "";
let context: ServerBoundDevelopmentOperatorContext;
let app: ReturnType<typeof createOperationsConsoleApp>;

beforeAll(async () => {
  await resetAndSeedOperationsConsoleDatabase(19);
  const issued = await issueOperationsConsoleDatabaseSession();
  token = issued.databaseSessionToken;
  context = issued.context;
  const database = new OperationsConsoleDatabase();
  const property = { addressLine1: "19 Mission Plan Way", addressLine2: "Studio A", locality: "Example City",
    administrativeArea: "NY", postalCode: "10001", countryCode: "US", squareFeet: 1800 };
  const customer = { displayName: "M19 Operations Customer", email: "m19-operations@example.invalid" };
  const selections = [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 }];
  const projection = await database.getCatalog(token);
  const lines = resolveCatalogSelections(projection, selections, property.squareFeet);
  const listing = await database.createListing({ databaseSessionToken: token, submissionId: `m19a-${randomUUID()}`,
    requestFingerprint: sha256Evidence({ customer, property, selections }),
    expectedCommercialFingerprint: commercialFingerprint(lines), customer, property, selections });
  orderId = listing.orderId;
  const initialized = await database.initializeOperations(token, orderId);
  const requested = await database.addRequestedWindow(token, orderId, initialized.scheduling!.requestId, {
    startsAt: "2026-09-02T13:00:00.000Z", endsAt: "2026-09-02T14:30:00.000Z",
    ianaTimezone: "America/New_York", localStartsAt: "2026-09-02T09:00:00", localEndsAt: "2026-09-02T10:30:00",
  });
  const confirmed = await database.confirmAppointment(token, orderId, initialized.scheduling!.requestId, {
    windowId: requested.scheduling!.windows[0]!.windowId, reason: "Synthetic M19 field appointment confirmed",
  });
  await database.assignParticipant(token, orderId, confirmed.appointment!.appointmentId, {
    personId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID, operationalRole: "PRIMARY_OPERATOR",
  });
  await database.close();
}, 60_000);

afterAll(async () => { await app?.close(); });

describe("P02-M19-A Operations Console Mission Plans", () => {
  it("creates, revises, notes, refreshes, issues, and supersedes through accepted canonical commands", async () => {
    const database = new OperationsConsoleDatabase();
    try {
      const initial = await database.getMissionPlanWorkspace(token, orderId);
      expect(initial.context.appointment?.state).toBe("CONFIRMED");
      expect(initial.jobAppointmentId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(initial.plan).toBeNull();

      const sections = [
        { label: "Field arrival", visibility: "ASSIGNED_CREW_ONLY" as const, content: "Crew phrase for the offline packet." },
        { label: "Customer-safe priorities", visibility: "POTENTIALLY_CUSTOMER_VISIBLE" as const, content: "Photograph the main living areas." },
        { label: "Internal coordination", visibility: "INTERNAL_STAFF_ONLY" as const, content: "Internal phrase must not enter the offline packet." },
      ];
      const created = await database.createMissionPlanDraft(token, orderId, sections);
      const replay = await database.createMissionPlanDraft(token, orderId, sections);
      missionPlanId = created.plan!.mission_plan_id;
      expect(replay.plan!.mission_plan_id).toBe(missionPlanId);
      expect(created.plan!.draft!.content.sections).toEqual(sections);
      expect(created.controls!.eligibleWorkstreams).toHaveLength(1);
      expect(created.controls!.eligibleContacts.length).toBeGreaterThan(0);
      const workstreamId = created.controls!.eligibleWorkstreams[0]!.workstreamId;
      await database.replaceMissionPlanWorkstreams(token, missionPlanId, [workstreamId]);
      await expect(database.replaceMissionPlanWorkstreams(token, missionPlanId, [randomUUID()]))
        .rejects.toMatchObject({ code: "AUTHORITY" });
      const contact = created.controls!.eligibleContacts[0]!;
      await database.replaceMissionPlanContacts(token, missionPlanId, [{ personId: contact.personId,
        contactMethodId: contact.contactMethodId, contactRole: contact.contactRole, visibility: "ASSIGNED_CREW_ONLY" }]);

      const runtime = new pg.Client(OPERATIONS_CONSOLE_DATABASE); await runtime.connect();
      try {
        await expect(runtime.query("SELECT * FROM medialab_core.mission_plan_drafts")).rejects.toMatchObject({ code: "42501" });
        await runtime.query("SELECT medialab_core.transition_service_workstream_state($1,$2,$3::uuid,'READY',$4)",
          [token, `m19a-stale-${randomUUID()}`, workstreamId, "Synthetic source change proves stale detection"]);
      } finally { await runtime.end(); }
      const stale = await database.getMissionPlanWorkspace(token, orderId);
      expect(stale.controls!.stale).toBe(true);
      await expect(database.issueMissionPlanVersion(token, missionPlanId)).rejects.toMatchObject({ code: "CONFLICT" });

      const revisedSections = sections.map((section, index) => index === 0 ? { ...section, content: "Updated crew phrase for the offline packet." } : section);
      const revised = await database.reviseMissionPlanDraft(token, missionPlanId, revisedSections);
      expect(revised.draft!.draft_generation).toBeGreaterThan(created.plan!.draft!.draft_generation);
      const noted = await database.addMissionPlanNote(token, missionPlanId, "ASSIGNED_CREW_ONLY", "Park clear of the driveway.");
      const refreshed = await database.refreshMissionPlanDraft(token, missionPlanId);
      expect(refreshed.draft!.draft_generation).toBeGreaterThan(noted.draft!.draft_generation);

      const versionOne = await database.issueMissionPlanVersion(token, missionPlanId);
      expect(versionOne.versions).toHaveLength(1);
      expect(versionOne.versions[0]!.canonical_json_sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(versionOne.versions[0]!.content.contacts).toHaveLength(1);
      const baseVersionId = versionOne.versions[0]!.mission_plan_version_id;
      const superseding = await database.supersedeMissionPlanVersion(token, missionPlanId, baseVersionId);
      expect(superseding.draft!.content.sections[0]!.content).toBe("Updated crew phrase for the offline packet.");
      const secondDraft = superseding.draft!.content.sections.map((section, index) =>
        index === 1 ? { ...section, content: "Updated customer-safe priorities." } : section);
      await database.reviseMissionPlanDraft(token, missionPlanId, secondDraft);
      const versionTwo = await database.issueMissionPlanVersion(token, missionPlanId);
      expect(versionTwo.versions.map((version) => version.version_number)).toEqual([1, 2]);
      expect(versionTwo.versions[1]!.supersedes_version_id).toBe(baseVersionId);
      latestVersionId = versionTwo.versions[1]!.mission_plan_version_id;
    } finally { await database.close(); }
  }, 20_000);

  it("serves the branded workspace and a filtered self-contained offline field packet", async () => {
    const service = new OperationsConsoleService(new OperationsConsoleDatabase());
    app = createOperationsConsoleApp({ service, sessions: new DevelopmentOperatorSessionManager({ ttlSeconds: 900 }),
      developmentOperatorContext: context });
    const issued = await app.inject({ method: "POST", url: "/session", payload: {} });
    const setCookie = Array.isArray(issued.headers["set-cookie"]) ? issued.headers["set-cookie"][0] : issued.headers["set-cookie"];
    const cookie = String(setCookie).split(";", 1)[0]!;
    const workspace = await app.inject({ method: "GET", url: `/api/operations/orders/${orderId}/mission-plan`, headers: { cookie } });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json()).toMatchObject({ contract: "MissionPlanWorkspaceV1", readiness: "READY",
      plan: { mission_plan_id: missionPlanId } });
    const controls = workspace.json().controls;
    const selectedContacts = controls.eligibleContacts.filter((contact: { selected: boolean }) => contact.selected)
      .map((contact: { personId: string; contactMethodId: string; contactRole: string; visibility: string }) => ({
        personId: contact.personId, contactMethodId: contact.contactMethodId,
        contactRole: contact.contactRole, visibility: contact.visibility,
      }));
    const contactSave = await app.inject({ method: "POST",
      url: `/api/operations/orders/${orderId}/mission-plans/${missionPlanId}/contacts`,
      headers: { cookie, "content-type": "application/json" }, payload: { contacts: selectedContacts } });
    expect(contactSave.statusCode).toBe(200);
    expect(contactSave.json()).toMatchObject({ action: "REPLACE_MISSION_PLAN_CONTACTS" });

    const packet = await app.inject({ method: "POST",
      url: `/api/operations/orders/${orderId}/mission-plans/${missionPlanId}/offline-packet`,
      headers: { cookie, "content-type": "application/json" }, payload: { versionId: latestVersionId } });
    expect(packet.statusCode).toBe(200);
    expect(packet.headers["content-disposition"]).toMatch(/medialab-mission-plan-v2\.html/u);
    expect(packet.body).toContain("MediaLab · Field Operations");
    expect(packet.body).toContain("Updated crew phrase for the offline packet.");
    expect(packet.body).toContain("Updated customer-safe priorities.");
    expect(packet.body).not.toContain("Internal phrase must not enter the offline packet.");
    expect(packet.body).toContain("#ffc107");
    expect(packet.body).toContain("mailto:m19-operations@example.invalid");
    expect(packet.body).toContain("2026-09-02T09:00:00");
    expect(packet.body).toContain("America/New_York");
    expect(packet.body).toContain("Live weather is not connected in this nonproduction packet.");
    expect(packet.body).toMatch(/canonical evidence [0-9a-f]{64}/u);
    expect(packet.body).toContain("offline nonproduction packet");
  });

  it("rejects unknown fields and order/plan mismatches before canonical mutation", async () => {
    const issued = await app.inject({ method: "POST", url: "/session", payload: {} });
    const setCookie = Array.isArray(issued.headers["set-cookie"]) ? issued.headers["set-cookie"][0] : issued.headers["set-cookie"];
    const cookie = String(setCookie).split(";", 1)[0]!;
    const malformed = await app.inject({ method: "POST", url: `/api/operations/orders/${orderId}/mission-plans/${missionPlanId}/notes`,
      headers: { cookie, "content-type": "application/json" },
      payload: { visibility: "ASSIGNED_CREW_ONLY", note: "Bounded note", extra: true } });
    expect(malformed.statusCode).toBe(400);
    const mismatch = await app.inject({ method: "POST", url: `/api/operations/orders/${randomUUID()}/mission-plans/${missionPlanId}/issue`,
      headers: { cookie, "content-type": "application/json" }, payload: {} });
    expect(mismatch.statusCode).toBe(403);
  });
});
