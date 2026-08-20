import { randomBytes } from "node:crypto";
import {
  operationsConsoleContract,
  type CanonicalOrderConfirmationV1,
  type CreateListingRequestV1,
  type ListingCreationReceiptV1,
  type ListingPreviewRequestV1,
  type ListingPreviewV1,
  type SelectableCatalogV1,
} from "./contracts.js";
import {
  commercialFingerprint,
  OperationsConsoleDatabase,
  OperationsConsoleDatabaseError,
  resolveCatalogSelections,
  sha256Evidence,
  type CatalogProjection,
  type ListingTransactionResult,
  type ResolvedCatalogLine,
  type ServerCatalogSelection,
} from "./database.js";
import { operationsConsoleError } from "./errors.js";
import type { ResolvedDevelopmentOperatorSession } from "./session.js";
import {
  OPERATIONS_SCHEMA,
  type AssignmentCandidates,
  type AcceptProposalInput,
  type AssignmentInput,
  type CancelAppointmentInput,
  type ConfirmAppointmentInput,
  type MissionPlanActionReceipt,
  type MissionPlanNoteInput,
  type MissionPlanOfflinePacket,
  type MissionPlanRecord,
  type MissionPlanSectionInput,
  type MissionPlanWorkspace,
  type OperationsActionReceipt,
  type OperationsContext,
  type OperationsHome,
  type OperationsWindowInput,
  type ReplacementInput,
  type RescheduleAppointmentInput,
} from "./operations-contracts.js";

const CATALOG_TTL_MS = 10 * 60 * 1_000;
const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const DISCLOSURE = "Controlled nonproduction reconstruction evidence. Listing creation does not itself schedule, assign crew, create a Mission Plan, process payment or media, review work, or deliver files.";

interface BoundCatalogState {
  effectiveAt: string;
  expiresAtMs: number;
  projection: CatalogProjection;
  choices: Map<string, string>;
}

interface BoundPreviewState {
  session: ResolvedDevelopmentOperatorSession;
  previewReceipt: string;
  submissionId: string;
  request: ListingPreviewRequestV1;
  requestFingerprint: string;
  selections: ServerCatalogSelection[];
  resolvedLines: ResolvedCatalogLine[];
  commercialFingerprint: string;
  pricedAt: string;
  expiresAtMs: number;
  created?: { transaction: ListingTransactionResult; receipt: ListingCreationReceiptV1 };
}

interface BoundConfirmationState {
  session: ResolvedDevelopmentOperatorSession;
  preview: BoundPreviewState;
  transaction: ListingTransactionResult;
}

function opaque(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function cents(value: string | number | unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw operationsConsoleError("INTERNAL_ERROR");
  return parsed;
}

function replayReceipt(receipt: ListingCreationReceiptV1): ListingCreationReceiptV1 {
  const confirmation = Object.freeze({ ...receipt.confirmation, replayed: true }) as CanonicalOrderConfirmationV1;
  return operationsConsoleContract("ListingCreationReceiptV1", {
    created: true as const,
    replayed: true,
    committedAt: receipt.committedAt,
    confirmation,
  }) as ListingCreationReceiptV1;
}

export class OperationsConsoleService {
  readonly #database: OperationsConsoleDatabase;
  readonly #catalogs = new Map<ResolvedDevelopmentOperatorSession, BoundCatalogState>();
  readonly #previews = new Map<string, BoundPreviewState>();
  readonly #confirmations = new Map<string, BoundConfirmationState>();
  readonly #inFlight = new Map<string, Promise<ListingCreationReceiptV1>>();
  readonly #now: () => number;

  constructor(database: OperationsConsoleDatabase, options: { now?: () => number } = {}) {
    this.#database = database;
    this.#now = options.now ?? Date.now;
  }

  async catalog(session: ResolvedDevelopmentOperatorSession): Promise<SelectableCatalogV1> {
    const now = this.#now();
    const effectiveAt = new Date(now).toISOString();
    const projection = await this.#database.getCatalog(session.databaseSessionToken, effectiveAt);
    const grouped = new Map<string, typeof projection.rows>();
    for (const row of projection.rows) {
      const rows = grouped.get(row.product_code) ?? [];
      rows.push(row);
      grouped.set(row.product_code, rows);
    }
    const choices = new Map<string, string>();
    const choiceContracts = [...grouped.values()]
      .sort((left, right) => left[0]!.display_name.localeCompare(right[0]!.display_name) || left[0]!.product_code.localeCompare(right[0]!.product_code))
      .map((rows) => {
        const first = rows[0]!;
        let handle = opaque(24);
        while (choices.has(handle)) handle = opaque(24);
        choices.set(handle, first.product_code);
        const packageInclusions = projection.inclusions
          .filter((row) => row.package_product_code === first.product_code)
          .sort((a, b) => a.item_position - b.item_position)
          .map((row) => ({
            displayName: row.included_display_name,
            quantity: Number(row.quantity),
            commercialUnit: row.commercial_unit,
            position: row.item_position,
          }));
        const priceBrackets = first.product_kind === "PACKAGE" ? rows.map((row) => ({
          bracketCode: row.bracket_code!,
          basis: row.bracket_basis as "SQUARE_FEET" | "SCOPE_UNITS",
          lowerBound: row.lower_bound === null ? null : Number(row.lower_bound),
          upperBound: row.upper_bound === null ? null : Number(row.upper_bound),
          lowerInclusive: row.lower_inclusive === true,
          upperInclusive: row.upper_inclusive === true,
          amountCents: cents(row.amount_cents),
          currencyCode: row.currency as "USD",
        })) : [];
        return Object.freeze({
          choiceHandle: handle,
          kind: first.product_kind === "PACKAGE" ? "PACKAGE" as const : "PRODUCT" as const,
          displayName: first.display_name,
          description: first.product_kind === "PACKAGE" ? "Package with frozen included-service evidence" : null,
          pricingBasis: first.product_kind === "PACKAGE" ? first.bracket_basis as "SQUARE_FEET" | "SCOPE_UNITS" : "EACH" as const,
          requiresSquareFeet: first.bracket_basis === "SQUARE_FEET",
          quantityMinimum: 1,
          quantityMaximum: first.product_kind === "PACKAGE" ? 1 : 99,
          displayedPriceCents: first.product_kind === "PACKAGE" ? null : cents(first.amount_cents),
          currencyCode: first.currency as "USD",
          inclusions: Object.freeze(packageInclusions),
          priceBrackets: Object.freeze(priceBrackets),
        });
      });
    const expiresAtMs = now + CATALOG_TTL_MS;
    this.#catalogs.set(session, { effectiveAt, expiresAtMs, projection, choices });
    return operationsConsoleContract("SelectableCatalogV1", {
      pricedAt: effectiveAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
      evidenceClassification: "NONPRODUCTION_RECONSTRUCTED" as const,
      disclosure: DISCLOSURE,
      choices: Object.freeze(choiceContracts),
    }) as SelectableCatalogV1;
  }

  async preview(session: ResolvedDevelopmentOperatorSession, request: ListingPreviewRequestV1): Promise<ListingPreviewV1> {
    const now = this.#now();
    const catalog = this.#catalogs.get(session);
    if (!catalog || catalog.expiresAtMs <= now) throw operationsConsoleError("CATALOG_CHANGED");
    const selections = request.services.map((service) => {
      const productCode = catalog.choices.get(service.choiceHandle);
      if (!productCode) throw operationsConsoleError("INVALID_REQUEST");
      return { productCode, quantity: service.quantity };
    });
    let resolvedLines: ResolvedCatalogLine[];
    try {
      resolvedLines = resolveCatalogSelections(catalog.projection, selections, request.property.squareFeet ?? null);
    } catch (error) {
      if (error instanceof OperationsConsoleDatabaseError) throw operationsConsoleError("INVALID_REQUEST", { cause: error });
      throw error;
    }
    const currencies = new Set(resolvedLines.map((line) => line.currency));
    if (currencies.size !== 1 || resolvedLines[0]!.currency !== "USD") throw operationsConsoleError("INVALID_REQUEST");
    const subtotalCents = resolvedLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    if (!Number.isSafeInteger(subtotalCents)) throw operationsConsoleError("INVALID_REQUEST");
    const previewReceipt = opaque(32);
    const submissionId = opaque(18);
    const requestFingerprint = sha256Evidence({ request, selections });
    const expiresAtMs = now + PREVIEW_TTL_MS;
    const bound: BoundPreviewState = {
      session,
      previewReceipt,
      submissionId,
      request,
      requestFingerprint,
      selections,
      resolvedLines,
      commercialFingerprint: commercialFingerprint(resolvedLines),
      pricedAt: catalog.effectiveAt,
      expiresAtMs,
    };
    this.#previews.set(previewReceipt, bound);
    return operationsConsoleContract("ListingPreviewV1", {
      previewReceipt,
      pricedAt: bound.pricedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
      customer: request.customer,
      property: request.property,
      services: Object.freeze(resolvedLines.map((line, index) => ({
        choiceHandle: request.services[index]!.choiceHandle,
        kind: line.productKind === "PACKAGE" ? "PACKAGE" as const : "PRODUCT" as const,
        displayName: line.displayName,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
        lineAmountCents: line.lineTotalCents,
        currencyCode: "USD" as const,
        inclusions: Object.freeze(line.inclusions.map((item) => ({ ...item, quantity: Number(item.quantity) }))),
      }))),
      subtotalCents,
      travelAmountCents: 0 as const,
      adjustmentAmountCents: 0 as const,
      totalAmountCents: subtotalCents,
      currencyCode: "USD" as const,
      paymentDisposition: "PAY_NOW" as const,
      evidenceClassification: "NONPRODUCTION_RECONSTRUCTED" as const,
      disclosure: DISCLOSURE,
    }) as ListingPreviewV1;
  }

  async create(session: ResolvedDevelopmentOperatorSession, request: CreateListingRequestV1): Promise<ListingCreationReceiptV1> {
    const preview = this.#previews.get(request.previewReceipt);
    if (!preview || preview.session !== session) throw operationsConsoleError("PREVIEW_MISMATCH");
    if (preview.expiresAtMs <= this.#now() && !preview.created) throw operationsConsoleError("PREVIEW_EXPIRED");
    if (preview.created) return replayReceipt(preview.created.receipt);
    const pending = this.#inFlight.get(preview.previewReceipt);
    if (pending) return pending.then(replayReceipt);
    const execution = this.#execute(preview);
    this.#inFlight.set(preview.previewReceipt, execution);
    try {
      return await execution;
    } finally {
      this.#inFlight.delete(preview.previewReceipt);
    }
  }

  async #execute(preview: BoundPreviewState): Promise<ListingCreationReceiptV1> {
    try {
      const transaction = await this.#database.createListing({
        databaseSessionToken: preview.session.databaseSessionToken,
        submissionId: preview.submissionId,
        requestFingerprint: preview.requestFingerprint,
        expectedCommercialFingerprint: preview.commercialFingerprint,
        customer: preview.request.customer,
        property: {
          ...preview.request.property,
          squareFeet: preview.request.property.squareFeet ?? null,
        },
        selections: preview.selections,
      });
      const confirmation = this.#confirmation(preview, transaction, transaction.snapshotsReused);
      const receipt = operationsConsoleContract("ListingCreationReceiptV1", {
        created: true as const,
        replayed: transaction.snapshotsReused,
        committedAt: confirmation.confirmedAt,
        confirmation,
      }) as ListingCreationReceiptV1;
      preview.created = { transaction, receipt };
      this.#confirmations.set(transaction.orderId, { session: preview.session, preview, transaction });
      return receipt;
    } catch (error) {
      if (error instanceof OperationsConsoleDatabaseError) {
        if (error.code === "CONFLICT") throw operationsConsoleError("IDEMPOTENCY_CONFLICT", { cause: error });
        if (error.code === "AUTHORITY") throw operationsConsoleError("FORBIDDEN", { cause: error });
        if (error.code === "VALIDATION") throw operationsConsoleError("INVALID_REQUEST", { cause: error });
        throw operationsConsoleError("SERVICE_UNAVAILABLE", { cause: error });
      }
      throw error;
    }
  }

  async order(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<CanonicalOrderConfirmationV1> {
    const bound = this.#confirmations.get(orderId);
    if (!bound || bound.session !== session) throw operationsConsoleError("NOT_FOUND");
    try {
      const canonical = await this.#database.getOrderRecord(session.databaseSessionToken, orderId);
      const transaction = { ...bound.transaction, canonicalRecord: canonical, postCommitRecord: canonical };
      return this.#confirmation(bound.preview, transaction, true);
    } catch (error) {
      if (error instanceof OperationsConsoleDatabaseError) throw operationsConsoleError("NOT_FOUND", { cause: error });
      throw error;
    }
  }

  #safeContext(context: OperationsContext): OperationsContext {
    const {
      schedulingRequestLineageIds: _requests,
      appointmentLineageIds: _appointments,
      assignmentLineageIds: _assignments,
      ...publicContext
    } = context as OperationsContext & {
      schedulingRequestLineageIds?: string[]; appointmentLineageIds?: string[]; assignmentLineageIds?: string[];
    };
    if (!publicContext.scheduling) return publicContext;
    const { customerIdentityId: _hidden, ...scheduling } = publicContext.scheduling as typeof publicContext.scheduling & { customerIdentityId?: string };
    return { ...publicContext, scheduling };
  }

  #translateOperationsError(error: unknown): never {
    if (error instanceof OperationsConsoleDatabaseError) {
      if (error.code === "AUTHORITY") throw operationsConsoleError("FORBIDDEN", { cause: error });
      if (error.code === "VALIDATION") throw operationsConsoleError("INVALID_REQUEST", { cause: error });
      if (error.code === "CONFLICT") throw operationsConsoleError("IDEMPOTENCY_CONFLICT", { cause: error });
      throw operationsConsoleError("SERVICE_UNAVAILABLE", { cause: error });
    }
    throw error;
  }

  async operationsHome(session: ResolvedDevelopmentOperatorSession, from: string, to: string): Promise<OperationsHome> {
    try {
      const projection = await this.#database.getOperationsHome(session.databaseSessionToken, from, to);
      return Object.freeze({ ...projection, items: projection.items.map((item) => this.#safeContext(item)),
        sections: {
          today: projection.sections.today.map((item) => this.#safeContext(item)),
          upcoming: projection.sections.upcoming.map((item) => this.#safeContext(item)),
          needsAttention: projection.sections.needsAttention.map((item) => this.#safeContext(item)),
        },
        schema: OPERATIONS_SCHEMA, contract: "OperationsHomeV1" as const });
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async operationsContext(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<OperationsContext> {
    try { return this.#safeContext(await this.#database.getOperationsContext(session.databaseSessionToken, orderId)); }
    catch (error) { return this.#translateOperationsError(error); }
  }

  async assignmentCandidates(session: ResolvedDevelopmentOperatorSession, organizationId: string): Promise<AssignmentCandidates> {
    try {
      const projection = await this.#database.listAssignmentCandidates(session.databaseSessionToken, organizationId);
      return Object.freeze({ ...projection, schema: OPERATIONS_SCHEMA, contract: "OperationsAssignmentCandidatesV1" as const });
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async #action(
    action: string,
    execute: () => Promise<OperationsContext>,
  ): Promise<OperationsActionReceipt> {
    try {
      return Object.freeze({ schema: OPERATIONS_SCHEMA, contract: "OperationsActionReceiptV1" as const,
        action, replaySafe: true as const, context: this.#safeContext(await execute()) });
    } catch (error) { return this.#translateOperationsError(error); }
  }

  initializeOperations(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<OperationsActionReceipt> {
    return this.#action("INITIALIZE_OPERATIONS", () => this.#database.initializeOperations(session.databaseSessionToken, orderId));
  }
  addRequestedWindow(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: OperationsWindowInput): Promise<OperationsActionReceipt> {
    return this.#action("ADD_REQUESTED_WINDOW", () => this.#database.addRequestedWindow(session.databaseSessionToken, orderId, requestId, input));
  }
  proposeWindow(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: OperationsWindowInput): Promise<OperationsActionReceipt> {
    return this.#action("PROPOSE_WINDOW", () => this.#database.proposeWindow(session.databaseSessionToken, orderId, requestId, input));
  }
  acceptProposal(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: AcceptProposalInput): Promise<OperationsActionReceipt> {
    return this.#action("ACCEPT_PROPOSAL", () => this.#database.acceptProposal(session.databaseSessionToken, orderId, requestId, input));
  }
  confirmAppointment(session: ResolvedDevelopmentOperatorSession, orderId: string, requestId: string, input: ConfirmAppointmentInput): Promise<OperationsActionReceipt> {
    return this.#action("CONFIRM_APPOINTMENT", () => this.#database.confirmAppointment(session.databaseSessionToken, orderId, requestId, input));
  }
  cancelAppointment(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, input: CancelAppointmentInput): Promise<OperationsActionReceipt> {
    return this.#action("CANCEL_APPOINTMENT", () => this.#database.cancelAppointment(session.databaseSessionToken, orderId, appointmentId, input));
  }
  rescheduleAppointment(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, input: RescheduleAppointmentInput): Promise<OperationsActionReceipt> {
    return this.#action("RESCHEDULE_APPOINTMENT", () => this.#database.rescheduleAppointment(session.databaseSessionToken, orderId, appointmentId, input));
  }
  assignParticipant(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, input: AssignmentInput): Promise<OperationsActionReceipt> {
    return this.#action("ASSIGN_PARTICIPANT", () => this.#database.assignParticipant(session.databaseSessionToken, orderId, appointmentId, input));
  }
  replaceParticipant(session: ResolvedDevelopmentOperatorSession, orderId: string, appointmentId: string, assignmentId: string, input: ReplacementInput): Promise<OperationsActionReceipt> {
    return this.#action("REPLACE_PARTICIPANT", () => this.#database.replaceParticipant(session.databaseSessionToken, orderId, appointmentId, assignmentId, input));
  }

  async missionPlanWorkspace(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<MissionPlanWorkspace> {
    try {
      const result = await this.#database.getMissionPlanWorkspace(session.databaseSessionToken, orderId);
      const readiness = !result.context.job || !result.context.appointment
        ? "NEEDS_CONFIRMED_APPOINTMENT" as const
        : !result.jobAppointmentId
          ? "NEEDS_JOB_APPOINTMENT_LINK" as const
          : "READY" as const;
      return Object.freeze({ schema: OPERATIONS_SCHEMA, contract: "MissionPlanWorkspaceV1" as const,
        readiness, context: this.#safeContext(result.context), plan: result.plan, controls: result.controls });
    } catch (error) { return this.#translateOperationsError(error); }
  }

  #defaultMissionPlanSections(context: OperationsContext): MissionPlanSectionInput[] {
    const appointment = context.appointment!;
    const address = [context.property.addressLine1, context.property.addressLine2, context.property.locality,
      context.property.administrativeArea, context.property.postalCode].filter(Boolean).join(", ");
    const crew = appointment.assignments.length
      ? appointment.assignments.map((assignment) => `${assignment.displayName} — ${assignment.operationalRole.toLowerCase().replaceAll("_", " ")}`).join("\n")
      : "Crew assignment is still pending.";
    return [
      { label: "Pre-shoot checklist", visibility: "ASSIGNED_CREW_ONLY",
        content: "Confirm camera bodies, charged batteries, formatted cards, lenses, tripod, gimbal, lighting, and any service-specific gear. Review access and priority shots before departure." },
      { label: "End-of-shoot checklist", visibility: "ASSIGNED_CREW_ONLY",
        content: "Confirm every requested area and service was captured. Count cards, batteries, lenses, and support gear. Walk the property, gather equipment, and leave doors, lights, and access points as instructed." },
      { label: "Directions and arrival", visibility: "ASSIGNED_CREW_ONLY", content: address },
      { label: "Shoot priorities", visibility: "POTENTIALLY_CUSTOMER_VISIBLE",
        content: context.services.map((service) => `${service.displayName} × ${service.quantity}`).join("\n") },
      { label: "Access and property notes", visibility: "INTERNAL_STAFF_ONLY",
        content: "Add only verified arrival and access instructions. Never place alarm codes, lockbox codes, or credentials in this section." },
      { label: "Internal notes", visibility: "INTERNAL_STAFF_ONLY",
        content: `Assigned crew\n${crew}\n\nAdd internal coordination notes and reference-media guidance here.` },
    ];
  }

  #missionPlanReceipt(action: string, plan: MissionPlanRecord): MissionPlanActionReceipt {
    return Object.freeze({ schema: OPERATIONS_SCHEMA, contract: "MissionPlanActionReceiptV1" as const,
      action, replaySafe: true as const, plan });
  }

  async createMissionPlanDraft(session: ResolvedDevelopmentOperatorSession, orderId: string): Promise<MissionPlanActionReceipt> {
    try {
      const workspace = await this.#database.getMissionPlanWorkspace(session.databaseSessionToken, orderId);
      let plan = workspace.plan;
      if (!plan) {
        const created = await this.#database.createMissionPlanDraft(
          session.databaseSessionToken, orderId, this.#defaultMissionPlanSections(workspace.context));
        plan = created.plan;
        const workstreams = created.controls?.eligibleWorkstreams ?? [];
        if (plan && workstreams.length) {
          plan = await this.#database.replaceMissionPlanWorkstreams(session.databaseSessionToken, plan.mission_plan_id,
            workstreams.map((workstream) => workstream.workstreamId));
        }
        const contacts = created.controls?.eligibleContacts ?? [];
        if (plan && contacts.length) {
          plan = await this.#database.replaceMissionPlanContacts(session.databaseSessionToken, plan.mission_plan_id,
            contacts.map((contact) => ({ personId: contact.personId, contactMethodId: contact.contactMethodId,
              contactRole: contact.contactRole, visibility: "ASSIGNED_CREW_ONLY" as const })));
        }
      }
      if (!plan) throw new OperationsConsoleDatabaseError("CONFLICT", "The Mission Plan could not be created for this appointment.");
      return this.#missionPlanReceipt("CREATE_MISSION_PLAN_DRAFT", plan);
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async #requireMissionPlan(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string): Promise<MissionPlanRecord> {
    const workspace = await this.#database.getMissionPlanWorkspace(session.databaseSessionToken, orderId);
    if (!workspace.plan || workspace.plan.mission_plan_id !== missionPlanId) {
      throw new OperationsConsoleDatabaseError("AUTHORITY", "The requested Mission Plan is not part of this operational order.");
    }
    return workspace.plan;
  }

  async reviseMissionPlanDraft(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string,
    sections: MissionPlanSectionInput[]): Promise<MissionPlanActionReceipt> {
    try {
      await this.#requireMissionPlan(session, orderId, missionPlanId);
      return this.#missionPlanReceipt("REVISE_MISSION_PLAN_DRAFT",
        await this.#database.reviseMissionPlanDraft(session.databaseSessionToken, missionPlanId, sections));
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async addMissionPlanNote(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string,
    input: MissionPlanNoteInput): Promise<MissionPlanActionReceipt> {
    try {
      await this.#requireMissionPlan(session, orderId, missionPlanId);
      return this.#missionPlanReceipt("ADD_MISSION_PLAN_NOTE", await this.#database.addMissionPlanNote(
        session.databaseSessionToken, missionPlanId, input.visibility, input.note));
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async replaceMissionPlanWorkstreams(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string,
    workstreamIds: string[]): Promise<MissionPlanActionReceipt> {
    try {
      await this.#requireMissionPlan(session, orderId, missionPlanId);
      return this.#missionPlanReceipt("REPLACE_MISSION_PLAN_WORKSTREAMS",
        await this.#database.replaceMissionPlanWorkstreams(session.databaseSessionToken, missionPlanId, workstreamIds));
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async replaceMissionPlanContacts(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string,
    contacts: Array<{ personId: string; contactMethodId: string; contactRole: string;
      visibility: "INTERNAL_STAFF_ONLY" | "ASSIGNED_CREW_ONLY" | "POTENTIALLY_CUSTOMER_VISIBLE" }>): Promise<MissionPlanActionReceipt> {
    try {
      await this.#requireMissionPlan(session, orderId, missionPlanId);
      return this.#missionPlanReceipt("REPLACE_MISSION_PLAN_CONTACTS",
        await this.#database.replaceMissionPlanContacts(session.databaseSessionToken, missionPlanId, contacts));
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async refreshMissionPlanDraft(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string): Promise<MissionPlanActionReceipt> {
    try {
      await this.#requireMissionPlan(session, orderId, missionPlanId);
      return this.#missionPlanReceipt("REFRESH_MISSION_PLAN_DRAFT",
        await this.#database.refreshMissionPlanDraft(session.databaseSessionToken, missionPlanId));
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async issueMissionPlanVersion(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string): Promise<MissionPlanActionReceipt> {
    try {
      await this.#requireMissionPlan(session, orderId, missionPlanId);
      return this.#missionPlanReceipt("ISSUE_MISSION_PLAN_VERSION",
        await this.#database.issueMissionPlanVersion(session.databaseSessionToken, missionPlanId));
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async supersedeMissionPlanVersion(session: ResolvedDevelopmentOperatorSession, orderId: string, missionPlanId: string,
    baseVersionId: string): Promise<MissionPlanActionReceipt> {
    try {
      const plan = await this.#requireMissionPlan(session, orderId, missionPlanId);
      if (!plan.versions.some((version) => version.mission_plan_version_id === baseVersionId)) {
        throw new OperationsConsoleDatabaseError("AUTHORITY", "The selected issued version is unavailable.");
      }
      return this.#missionPlanReceipt("CREATE_MISSION_PLAN_SUPERSEDING_DRAFT",
        await this.#database.supersedeMissionPlanVersion(session.databaseSessionToken, missionPlanId, baseVersionId));
    } catch (error) { return this.#translateOperationsError(error); }
  }

  async missionPlanOfflinePacket(session: ResolvedDevelopmentOperatorSession, orderId: string,
    missionPlanId: string, versionId: string): Promise<MissionPlanOfflinePacket> {
    try {
      const workspace = await this.#database.getMissionPlanWorkspace(session.databaseSessionToken, orderId);
      const plan = workspace.plan;
      if (!plan || plan.mission_plan_id !== missionPlanId) {
        throw new OperationsConsoleDatabaseError("AUTHORITY", "The requested Mission Plan is not part of this operational order.");
      }
      const version = plan.versions.find((candidate) => candidate.mission_plan_version_id === versionId);
      if (!version) throw new OperationsConsoleDatabaseError("AUTHORITY", "The selected issued version is unavailable.");
      await this.#database.recordMissionPlanDownload(session.databaseSessionToken, missionPlanId, versionId);
      const sections = version.content.sections.filter((section) => section.visibility !== "INTERNAL_STAFF_ONLY");
      const workstreams = version.content.selected_workstreams.map((item) =>
        `<li>${escapeHtml(item.source_description)} · ${escapeHtml(item.state)}</li>`).join("");
      const sectionHtml = sections.map((section) =>
        `<section><p class="kicker">${escapeHtml(section.visibility.replaceAll("_", " "))}</p><h2>${escapeHtml(section.label)}</h2><p>${escapeHtml(section.content).replaceAll("\n", "<br>")}</p></section>`).join("");
      const visibleContacts = version.content.contacts.filter((contact) => contact.visibility !== "INTERNAL_STAFF_ONLY");
      const contactHtml = visibleContacts.map((contact) => {
        const kind = String(contact.contact_type ?? "").toUpperCase(); const value = String(contact.normalized_value ?? "");
        const href = kind === "EMAIL" ? `mailto:${escapeHtml(value)}` : kind === "PHONE" ? `tel:${escapeHtml(value)}` : "";
        return `<li>${href ? `<a href="${href}">${escapeHtml(kind === "EMAIL" ? "Email" : "Call")}</a> · ` : ""}${escapeHtml(value)}</li>`;
      }).join("");
      const visibleNotes = version.content.notes.filter((note) => note.visibility !== "INTERNAL_STAFF_ONLY");
      const noteHtml = visibleNotes.map((note) => `<li>${escapeHtml(note.text)}</li>`).join("");
      const weather = version.content.weather; const appointment = workspace.context.appointment!;
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MediaLab Mission Plan v${version.version_number}</title><style>body{margin:0;background:#121212;color:#f5f5f5;font:16px/1.5 Inter,Roboto,system-ui,sans-serif}main{max-width:860px;margin:auto;padding:48px 28px}.brand,a{color:#ffc107}.brand{font-weight:900;letter-spacing:.12em;text-transform:uppercase}.meta{color:#8e8e8e}section{margin:20px 0;padding:22px;background:#1e1e1e;border:1px solid #333;border-radius:8px}h1,h2{line-height:1.15}h1{font-size:34px}h2{font-size:20px}.kicker{color:#ffc107;font-size:12px;text-transform:uppercase;letter-spacing:.08em}footer{margin-top:40px;color:#8e8e8e;border-top:1px solid #333;padding-top:20px}@media print{body{background:#fff;color:#111}section{background:#fff;border-color:#bbb}.meta,footer{color:#444}}</style></head><body><main><header><p class="brand">MediaLab · Field Operations</p><h1>Mission Plan</h1><p class="meta">Version ${version.version_number} · issued ${escapeHtml(version.issued_at)} · offline nonproduction packet</p><p>${escapeHtml(appointment.localStartsAt)} · ${escapeHtml(appointment.ianaTimezone)}</p></header>${sectionHtml}<section><p class="kicker">Assigned services</p><h2>Workstreams</h2><ul>${workstreams}</ul></section><section><p class="kicker">Safe contact actions</p><h2>Contacts</h2><ul>${contactHtml || "<li>No field-visible contact selected.</li>"}</ul></section><section><p class="kicker">Field notes</p><h2>Notes</h2><ul>${noteHtml || "<li>No field-visible notes.</li>"}</ul></section><section><p class="kicker">Weather evidence</p><h2>${escapeHtml(weather.status)}</h2><p>${escapeHtml(weather.unavailable_reason ?? "Canonical weather evidence is attached.")}</p></section><footer>Schema ${escapeHtml(version.content.schema_version)} · canonical evidence ${escapeHtml(version.canonical_json_sha256)} · This packet excludes internal-only sections and protected credentials.</footer></main></body></html>`;
      return { filename: `medialab-mission-plan-v${version.version_number}.html`, html };
    } catch (error) { return this.#translateOperationsError(error); }
  }

  #confirmation(preview: BoundPreviewState, transaction: ListingTransactionResult, replayed: boolean): CanonicalOrderConfirmationV1 {
    const record = transaction.postCommitRecord;
    const property = preview.request.property;
    const parties = record.parties.map((party) => party.party_role === "ORGANIZATION" ? {
      role: "ORGANIZATION" as const,
      partyKind: "ORGANIZATION" as const,
      personId: null,
      organizationId: String(party.organization_id),
      displayName: String(party.frozen_display_name),
    } : {
      role: party.party_role as "ORDERING_PERSON" | "CUSTOMER" | "BILLING_PARTY" | "COMMERCIAL_OWNER" | "AUTHORIZED_ACTOR",
      partyKind: "PERSON" as const,
      personId: String(party.person_id),
      organizationId: null,
      displayName: String(party.frozen_display_name),
    });
    const items = record.items.map((item, index) => ({
      orderItemId: String(item.id),
      commercialSnapshotId: String(item.commercial_snapshot_id),
      kind: transaction.resolvedLines[index]!.productKind === "PACKAGE" ? "PACKAGE" as const : "PRODUCT" as const,
      displayName: item.frozen_description,
      quantity: Number(item.quantity),
      unitAmountCents: cents(item.unit_amount_cents),
      lineAmountCents: cents(item.line_total_cents),
      currencyCode: item.currency as "USD",
    }));
    const createdAt = new Date(String(record.order.created_at)).toISOString();
    return operationsConsoleContract("CanonicalOrderConfirmationV1", {
      orderId: record.order.id,
      status: record.order.current_state,
      createdAt,
      confirmedAt: new Date(this.#now()).toISOString(),
      customer: preview.request.customer,
      property: Object.freeze({
        ...property,
        propertyId: transaction.property.property_id,
        propertySnapshotId: transaction.property.property_snapshot_id,
      }),
      parties: Object.freeze(parties),
      items: Object.freeze(items),
      subtotalCents: cents(record.order.item_subtotal_cents),
      travelAmountCents: 0 as const,
      adjustmentAmountCents: 0 as const,
      totalAmountCents: cents(record.order.total_amount_cents),
      currencyCode: record.order.currency as "USD",
      paymentDisposition: "PAY_NOW" as const,
      customerOutcome: transaction.customer.outcome as "CREATED" | "REUSED",
      propertyOutcome: transaction.property.property_outcome as "PROPERTY_CREATED" | "PROPERTY_REUSED",
      propertySnapshotOutcome: transaction.property.snapshot_outcome as "SNAPSHOT_CREATED" | "SNAPSHOT_REUSED",
      replayed,
      nextStep: "OPERATIONS_AVAILABLE" as const,
      nextStepMessage: "Open operational context to schedule the appointment and assign crew.",
    }) as CanonicalOrderConfirmationV1;
  }

  purgeExpired(): number {
    const now = this.#now();
    let removed = 0;
    for (const [receipt, preview] of this.#previews) {
      if (!preview.created && preview.expiresAtMs <= now) {
        this.#previews.delete(receipt);
        removed += 1;
      }
    }
    for (const [session, catalog] of this.#catalogs) {
      if (catalog.expiresAtMs <= now) this.#catalogs.delete(session);
    }
    return removed;
  }

  async close(): Promise<void> {
    await this.#database.close();
  }
}
