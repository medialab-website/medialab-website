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

const CATALOG_TTL_MS = 10 * 60 * 1_000;
const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const DISCLOSURE = "Controlled nonproduction reconstruction evidence. No scheduling, assignment, Mission Plan, payment, media, review, or delivery is created.";

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
    const inclusionCodes = new Set(projection.inclusions.map((row) => row.package_product_code));
    const grouped = new Map<string, typeof projection.rows>();
    for (const row of projection.rows) {
      if (row.product_kind === "PACKAGE" && !inclusionCodes.has(row.product_code)) continue;
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
      nextStep: "SCHEDULING_NOT_INCLUDED" as const,
      nextStepMessage: "Scheduling and assignment are intentionally outside this approved slice.",
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
