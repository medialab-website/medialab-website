import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOperationsConsoleApp } from "../src/operations-console/app.js";
import {
  OperationsConsoleDatabaseError,
  OperationsConsoleDatabase,
  OPERATIONS_CONSOLE_OPERATOR_PERSON_ID,
  commercialFingerprint,
  resolveCatalogSelections,
  sha256Evidence,
  type ProductionEvidenceProjection,
} from "../src/operations-console/database.js";
import { OperationsConsoleService, deriveProductionLane, workstreamLaneExpectations } from "../src/operations-console/service.js";
import { DevelopmentOperatorSessionManager, type ResolvedDevelopmentOperatorSession } from "../src/operations-console/session.js";
import type { MissionPlanRecord, OperationsContext } from "../src/operations-console/operations-contracts.js";
import { issueOperationsConsoleDatabaseSession, resetAndSeedOperationsConsoleDatabase } from
  "../scripts/run-internal-operations-console-new-listing.js";

const ids = {
  organization: "6d91cee6-91c1-52ea-937a-77c1ddc51c63",
  order: "71000000-0000-5000-8000-000000000001",
  job: "71000000-0000-5000-8000-000000000002",
  property: "71000000-0000-5000-8000-000000000003",
  snapshot: "71000000-0000-5000-8000-000000000004",
  hub: "71000000-0000-5000-8000-000000000005",
  appointment: "71000000-0000-5000-8000-000000000006",
  missionPlan: "71000000-0000-5000-8000-000000000007",
  missionVersion: "71000000-0000-5000-8000-000000000008",
  photoWorkstream: "71000000-0000-5000-8000-000000000009",
  videoWorkstream: "71000000-0000-5000-8000-000000000010",
};

const context: OperationsContext = {
  orderId: ids.order, organizationId: ids.organization, orderStatus: "CONFIRMED", createdAt: "2026-08-21T12:00:00.000Z",
  customer: { personId: "71000000-0000-5000-8000-000000000011", displayName: "Synthetic Customer",
    email: "synthetic@example.invalid" },
  property: { propertyId: ids.property, propertySnapshotId: ids.snapshot, addressLine1: "31527 Old Saltworks Rd",
    addressLine2: null, locality: "Meadowview", administrativeArea: "VA", postalCode: "24361", countryCode: "US",
    squareFeet: 1800 },
  services: [{ orderItemId: "71000000-0000-5000-8000-000000000012", position: 1,
    displayName: "Medium Home Package", quantity: 1, commercialUnit: "PACKAGE" },
  { orderItemId: "71000000-0000-5000-8000-000000000013", position: 2,
    displayName: "Listing Video", quantity: 1, commercialUnit: "EACH" }],
  propertyHubId: ids.hub, scheduling: null,
  appointment: { appointmentId: ids.appointment, state: "CONFIRMED", startsAt: "2026-08-22T13:00:00.000Z",
    endsAt: "2026-08-22T14:00:00.000Z", ianaTimezone: "America/New_York", localStartsAt: "2026-08-22T09:00:00",
    localEndsAt: "2026-08-22T10:00:00", assignments: [] },
  job: { jobId: ids.job, state: "READY", workstreams: [
    { workstreamId: ids.photoWorkstream, sourceOrderItemId: "71000000-0000-5000-8000-000000000012",
      displayName: "Medium Home Package", state: "READY" },
    { workstreamId: ids.videoWorkstream, sourceOrderItemId: "71000000-0000-5000-8000-000000000013",
      displayName: "Listing Video", state: "READY" },
  ] }, attention: [],
};

const plan: MissionPlanRecord = {
  mission_plan_id: ids.missionPlan, organization_id: ids.organization, order_id: ids.order,
  property_hub_id: ids.hub, job_id: ids.job, appointment_id: ids.appointment,
  job_appointment_id: "71000000-0000-5000-8000-000000000014", audience_scope: "ASSIGNED_CREW", draft: null,
  versions: [{ mission_plan_version_id: ids.missionVersion, version_number: 2, supersedes_version_id: null,
    canonical_json_sha256: "a".repeat(64), issued_at: "2026-08-21T12:30:00.000Z",
    content: { schema_version: 1, mission_plan_id: ids.missionPlan, mission_plan_version_id: ids.missionVersion,
      version_number: 2, relationship: {}, weather: {}, sections: [], contacts: [], notes: [], selected_workstreams: [
        { service_workstream_id: ids.photoWorkstream, source_description: "Medium Home Package", state: "READY" },
        { service_workstream_id: ids.videoWorkstream, source_description: "Listing Video", state: "READY" },
      ] } }], open_events: [],
};

const emptyEvidence: ProductionEvidenceProjection = {
  captureSessions: [], cullWorkspaces: [], handoffBatches: [], reviewBatches: [],
};

function fakeDatabase(overrides: Partial<{
  plan: MissionPlanRecord | null;
  evidence: ProductionEvidenceProjection;
  relationshipError: Error;
}> = {}): OperationsConsoleDatabase {
  return {
    async getMissionPlanWorkspace() {
      if (overrides.relationshipError) throw overrides.relationshipError;
      return { context, jobAppointmentId: plan.job_appointment_id, plan: overrides.plan === undefined ? plan : overrides.plan, controls: null };
    },
    async getProductionEvidence() { return overrides.evidence ?? emptyEvidence; },
    async getOperationsReviewAttention() { return []; },
    async close() {},
  } as unknown as OperationsConsoleDatabase;
}

describe("P02-M21-A web-first real-estate production bridge", () => {
  it("classifies company recipe workstreams without inventing a dropdown taxonomy", () => {
    expect(workstreamLaneExpectations("Medium Home Package")).toEqual(["PHOTO"]);
    expect(workstreamLaneExpectations("Listing Video")).toEqual(["VIDEO"]);
    expect(workstreamLaneExpectations("Aerial Photos and Video")).toEqual(["PHOTO", "VIDEO"]);
    expect(workstreamLaneExpectations("CubiCasa floor plan")).toEqual([]);
  });

  it("shows truthful empty and complete lane stages and surfaces reconciliation as an exception", () => {
    const workstream = [{ workstreamId: ids.photoWorkstream, displayName: "Medium Home Package", state: "READY" }];
    expect(deriveProductionLane("PHOTO", workstream, emptyEvidence)).toMatchObject({ stage: "NOT_STARTED",
      stageLabel: "Not started", capture: { sessionCount: 0 }, cull: { workspaceCount: 0 } });
    const complete: ProductionEvidenceProjection = {
      captureSessions: [{ capture_session_id: "capture", session_label: "Synthetic ingest", state: "ASSIGNED",
        job_id: ids.job, created_at: "2026-08-21T13:00:00.000Z" }],
      cullWorkspaces: [{ workspace: { id: "cull", service_workstream_id: ids.photoWorkstream, lane: "PHOTO",
        created_at: "2026-08-21T13:05:00.000Z" }, current: { current_state: "COMPLETE", inventory_sealed: true,
        active_candidate_count: 25, selected_manifest_id: "manifest", updated_at: "2026-08-21T13:10:00.000Z" },
        is_current_selection: true }],
      handoffBatches: [{ batch: { id: "handoff", service_workstream_id: ids.photoWorkstream, lane: "PHOTO",
        created_at: "2026-08-21T13:15:00.000Z" }, current: { current_state: "RETURNS_COMPLETE", item_count: 25,
        returned_source_count: 25, outstanding_source_count: 0, unresolved_return_count: 0,
        updated_at: "2026-08-21T13:20:00.000Z" } }],
      reviewBatches: [{ batch: { id: "review", service_workstream_id: ids.photoWorkstream, lane: "PHOTO",
        created_at: "2026-08-21T13:25:00.000Z" }, current: { current_state: "COMPLETED", item_count: 25,
        resolved_count: 25, final_source_count: 25, revision_routed_count: 0, quick_edit_routed_count: 0,
        unresolved_count: 0, lifecycle_generation: 2, updated_at: "2026-08-21T13:30:00.000Z" } }],
    };
    expect(deriveProductionLane("PHOTO", workstream, complete)).toMatchObject({ stage: "COMPLETE",
      cull: { inventorySealed: true, hasCurrentSelection: true }, review: { resolvedCount: 25 } });
    complete.handoffBatches[0]!.current.unresolved_return_count = 1;
    expect(deriveProductionLane("PHOTO", workstream, complete)).toMatchObject({ stage: "EXCEPTION",
      exceptions: ["Returned media requires reconciliation."] });
  });

  it("binds a deterministic secretless Desktop packet to the exact issued Mission Plan", async () => {
    const service = new OperationsConsoleService(fakeDatabase());
    const session = { databaseSessionToken: "server-only-token", organizationId: ids.organization,
      actorPersonId: context.customer.personId, membershipId: "71000000-0000-5000-8000-000000000015" } as unknown as ResolvedDevelopmentOperatorSession;
    const first = await service.desktopWorkPacket(session, ids.order);
    const second = await service.desktopWorkPacket(session, ids.order);
    expect(second).toEqual(first);
    expect(first.packet).toMatchObject({ contract: "DesktopWorkPacketV1", organizationId: ids.organization,
      job: { jobId: ids.job, orderId: ids.order, propertyDisplayReference: "31527 Old Saltworks Rd, Meadowview, VA, 24361" },
      missionPlan: { missionPlanId: ids.missionPlan, issuedVersionId: ids.missionVersion, versionNumber: 2,
        integritySha256: "a".repeat(64), readAuthority: "IMMUTABLE_ISSUED_VERSION" } });
    const { packetFingerprintSha256, ...payload } = first.packet;
    expect(packetFingerprintSha256).toBe(sha256Evidence(payload));
    const serialized = JSON.stringify(first.packet);
    expect(serialized).not.toContain("server-only-token");
    expect(serialized).not.toMatch(/example\.invalid|\/Volumes\/|signed[_ -]?url|access code|lockbox|https?:\/\//iu);
    expect(first.packet.workstreams.map((workstream) => workstream.laneExpectations)).toEqual([["PHOTO"], ["VIDEO"]]);
  });

  it("fails closed without an issued Mission Plan and translates cross-tenant authority failures", async () => {
    const session = { databaseSessionToken: "server-only-token", organizationId: ids.organization,
      actorPersonId: context.customer.personId, membershipId: "71000000-0000-5000-8000-000000000015" } as unknown as ResolvedDevelopmentOperatorSession;
    await expect(new OperationsConsoleService(fakeDatabase({ plan: null })).desktopWorkPacket(session, ids.order))
      .rejects.toMatchObject({ code: "PREREQUISITE_REQUIRED", statusCode: 409 });
    await expect(new OperationsConsoleService(fakeDatabase({ relationshipError:
      new OperationsConsoleDatabaseError("AUTHORITY", "cross-tenant synthetic evidence") })).productionWorkspace(session, ids.order))
      .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("serves the direct read-only production and downloadable packet routes with no-store security", async () => {
    const service = new OperationsConsoleService(fakeDatabase());
    const app = createOperationsConsoleApp({ service, sessions: new DevelopmentOperatorSessionManager({ ttlSeconds: 900 }),
      developmentOperatorContext: { databaseSessionToken: "server-only-token", organizationId: ids.organization,
        actorPersonId: context.customer.personId, membershipId: "71000000-0000-5000-8000-000000000015" } });
    try {
      const issued = await app.inject({ method: "POST", url: "/session", payload: {} });
      const cookie = String(issued.headers["set-cookie"]).split(";", 1)[0]!;
      const workspace = await app.inject({ method: "GET", url: `/api/operations/orders/${ids.order}/production`, headers: { cookie } });
      expect(workspace.statusCode).toBe(200);
      expect(workspace.headers["cache-control"]).toBe("no-store, max-age=0");
      expect(workspace.json()).toMatchObject({ contract: "ProductionWorkspaceV1", desktopWorkPacketReady: true,
        lanes: [{ lane: "PHOTO", stage: "NOT_STARTED" }, { lane: "VIDEO", stage: "NOT_STARTED" }] });
      const packet = await app.inject({ method: "GET", url: `/api/operations/orders/${ids.order}/desktop-work-packet`, headers: { cookie } });
      expect(packet.statusCode).toBe(200);
      expect(packet.headers["content-type"]).toMatch(/^application\/json/u);
      expect(packet.headers["content-disposition"]).toContain(`medialab-desktop-work-${ids.job}-mpv2.json`);
      expect(packet.json().packetFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    } finally { await app.close(); }
  });

  it("renders direct PHOTO and VIDEO cards with no production dropdown or raw JSON surface", async () => {
    const source = await readFile(new URL("../src/operations-console/public/app.js", import.meta.url), "utf8");
    const html = await readFile(new URL("../src/operations-console/public/index.html", import.meta.url), "utf8");
    const productionStart = source.indexOf("function productionCount");
    const productionEnd = source.indexOf("function customerActions", productionStart);
    const productionSource = source.slice(productionStart, productionEnd);
    expect(productionSource).toContain("Production workspace");
    expect(productionSource).toContain('lane.lane === "PHOTO" ? "Listing photos" : "Listing video"');
    expect(productionSource).toContain("Download Desktop work packet");
    expect(productionSource).not.toMatch(/createElement\("select"\)|selectField\(|innerHTML|outerHTML|JSON\.stringify/u);
    expect(productionSource).toContain("No media was moved.");
    expect(source).toContain('textContent = "MISSION CONTROL"');
    expect(source).toContain('document.querySelector(".boundary-notice").hidden = true');
    expect(html).not.toContain("Daily command center");
    expect(html).toContain('<div class="hero-actions"><a class="button button-primary" href="/">New listing</a>');
  });
});

describe("P02-M21-A restricted canonical projection integration", () => {
  it("composes the accepted Mission Plan and media projections without migration or direct table reads", async () => {
    await resetAndSeedOperationsConsoleDatabase(21);
    const issued = await issueOperationsConsoleDatabaseSession();
    const database = new OperationsConsoleDatabase();
    let orderId = "";
    try {
      const property = { addressLine1: "21 Production Bridge Way", addressLine2: null, locality: "Example City",
        administrativeArea: "VA", postalCode: "24361", countryCode: "US", squareFeet: 1800 };
      const customer = { displayName: "M21 Synthetic Customer", email: "m21@example.invalid" };
      const selections = [{ productCode: "HOME_PACKAGE_MEDIUM", quantity: 1 },
        { productCode: "LISTING_VIDEO", quantity: 1 }];
      const projection = await database.getCatalog(issued.databaseSessionToken);
      const availableCodes = new Set(projection.rows.map((row) => row.product_code));
      if (!availableCodes.has("LISTING_VIDEO")) selections.pop();
      const lines = resolveCatalogSelections(projection, selections, property.squareFeet);
      const listing = await database.createListing({ databaseSessionToken: issued.databaseSessionToken,
        submissionId: `m21a-${randomUUID()}`, requestFingerprint: sha256Evidence({ customer, property, selections }),
        expectedCommercialFingerprint: commercialFingerprint(lines), customer, property, selections });
      orderId = listing.orderId;
      const initialized = await database.initializeOperations(issued.databaseSessionToken, orderId);
      const requested = await database.addRequestedWindow(issued.databaseSessionToken, orderId, initialized.scheduling!.requestId, {
        startsAt: "2026-09-03T13:00:00.000Z", endsAt: "2026-09-03T14:30:00.000Z", ianaTimezone: "America/New_York",
        localStartsAt: "2026-09-03T09:00:00", localEndsAt: "2026-09-03T10:30:00",
      });
      const confirmed = await database.confirmAppointment(issued.databaseSessionToken, orderId, initialized.scheduling!.requestId,
        { windowId: requested.scheduling!.windows[0]!.windowId, reason: "Synthetic M21 production appointment" });
      await database.assignParticipant(issued.databaseSessionToken, orderId, confirmed.appointment!.appointmentId,
        { personId: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID, operationalRole: "PRIMARY_OPERATOR" });
      let relationship = await database.createMissionPlanDraft(issued.databaseSessionToken, orderId, [
        { label: "Synthetic field plan", content: "Capture only synthetic production evidence.", visibility: "ASSIGNED_CREW_ONLY" },
      ]);
      relationship.plan = await database.replaceMissionPlanWorkstreams(issued.databaseSessionToken,
        relationship.plan!.mission_plan_id, relationship.controls!.eligibleWorkstreams.map((item) => item.workstreamId));
      await database.issueMissionPlanVersion(issued.databaseSessionToken, relationship.plan.mission_plan_id);
      const evidence = await database.getProductionEvidence(issued.databaseSessionToken, confirmed.organizationId,
        confirmed.job!.jobId, confirmed.job!.workstreams.map((workstream) => workstream.workstreamId));
      expect(evidence).toEqual({ captureSessions: [], cullWorkspaces: [], handoffBatches: [], reviewBatches: [] });
    } finally { await database.close(); }

    const app = createOperationsConsoleApp({ service: new OperationsConsoleService(new OperationsConsoleDatabase()),
      sessions: new DevelopmentOperatorSessionManager({ ttlSeconds: 900 }), developmentOperatorContext: issued.context });
    try {
      const session = await app.inject({ method: "POST", url: "/session", payload: {} });
      const cookie = String(session.headers["set-cookie"]).split(";", 1)[0]!;
      const workspace = await app.inject({ method: "GET", url: `/api/operations/orders/${orderId}/production`, headers: { cookie } });
      expect(workspace.statusCode).toBe(200);
      expect(workspace.json()).toMatchObject({ contract: "ProductionWorkspaceV1", desktopWorkPacketReady: true,
        missionPlan: { versionNumber: 1 }, lanes: [{ lane: "PHOTO", stage: "NOT_STARTED" }, { lane: "VIDEO" }] });
      const packet = await app.inject({ method: "GET", url: `/api/operations/orders/${orderId}/desktop-work-packet`, headers: { cookie } });
      expect(packet.statusCode).toBe(200);
      expect(packet.json()).toMatchObject({ contract: "DesktopWorkPacketV1", job: { orderId },
        missionPlan: { versionNumber: 1, integritySha256: expect.stringMatching(/^[0-9a-f]{64}$/u) } });
    } finally { await app.close(); }
  }, 60_000);
});
