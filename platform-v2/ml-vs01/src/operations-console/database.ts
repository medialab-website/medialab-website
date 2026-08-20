import { createHash } from "node:crypto";
import pg from "pg";
import type {
  AssignmentCandidates,
  AcceptProposalInput,
  AssignmentInput,
  CancelAppointmentInput,
  ConfirmAppointmentInput,
  OperationsContext,
  OperationsHome,
  OperationsWindowInput,
  MissionPlanRecord,
  MissionPlanDraftControls,
  MissionPlanSectionInput,
  MissionPlanVisibility,
  ReplacementInput,
  RescheduleAppointmentInput,
} from "./operations-contracts.js";

const { Pool } = pg;

export const OPERATIONS_CONSOLE_DATABASE = Object.freeze({
  host: "/tmp/mlvs01-p02m17a-pg",
  port: 55448,
  database: "medialab_p02m17a_test",
  user: "medialab_p02m17a_test_app",
});

export const OPERATIONS_CONSOLE_ORGANIZATION_ID = "6d91cee6-91c1-52ea-937a-77c1ddc51c63";
export const OPERATIONS_CONSOLE_OPERATOR_PERSON_ID = "d43d9499-efbd-5116-b561-67dd34d1df8d";
const SNAPSHOT_NAMESPACE = "bd1c8468-6b68-5cbb-97d2-df8aeb4b3db1";
const SOURCE_SYSTEM = "INTERNAL_OPERATIONS_CONSOLE";
type RawOperationsContext = OperationsContext & {
  scheduling: null | (NonNullable<OperationsContext["scheduling"]> & { customerIdentityId: string });
  schedulingRequestLineageIds: string[];
  appointmentLineageIds: string[];
  assignmentLineageIds: string[];
};
type RawJobRecord = { appointments: Array<{ id: string; appointment_id: string }> };
type MissionPlanSummary = { mission_plan_id: string; appointment_id: string };

export interface CatalogProjectionRow {
  product_id: string;
  product_code: string;
  display_name: string;
  product_kind: "PACKAGE" | "ADD_ON" | "SERVICE";
  classification: string;
  commercial_unit: string;
  price_evidence_id: string | null;
  amount_cents: string | number;
  currency: string;
  bracket_set_id: string | null;
  bracket_id: string | null;
  bracket_code: string | null;
  bracket_basis: string | null;
  lower_bound: string | number | null;
  upper_bound: string | number | null;
  lower_inclusive: boolean | null;
  upper_inclusive: boolean | null;
  effective_at: Date | string;
}

export interface CatalogInclusionRow {
  package_product_id: string;
  package_product_code: string;
  package_display_name: string;
  package_version_id: string;
  package_version_number: number;
  included_product_id: string;
  included_product_code: string;
  included_display_name: string;
  included_classification: string;
  quantity: string;
  commercial_unit: string;
  item_position: number;
}

export interface CatalogProjection {
  effectiveAt: string;
  rows: CatalogProjectionRow[];
  inclusions: CatalogInclusionRow[];
}

export interface ServerCatalogSelection {
  productCode: string;
  quantity: number;
}

export interface ResolvedCatalogLine {
  position: number;
  productId: string;
  productCode: string;
  displayName: string;
  productKind: "PACKAGE" | "ADD_ON" | "SERVICE";
  commercialUnit: string;
  quantity: number;
  unitAmountCents: number;
  lineTotalCents: number;
  currency: string;
  basis: { kind: string; value: number } | null;
  bracketCode: string | null;
  inclusions: Array<{
    displayName: string;
    quantity: string;
    commercialUnit: string;
    position: number;
  }>;
}

export interface CustomerCommand {
  displayName: string;
  email: string;
}

export interface PropertyCommand {
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  administrativeArea: string;
  postalCode: string;
  countryCode: string;
  squareFeet: number | null;
}

export type TransactionFaultStage =
  | "after_customer"
  | "after_property"
  | "after_first_commercial_snapshot"
  | "before_order"
  | "after_order_before_readback"
  | "after_readback_before_commit";

export interface CreateListingTransactionCommand {
  databaseSessionToken: string;
  submissionId: string;
  requestFingerprint: string;
  expectedCommercialFingerprint: string;
  customer: CustomerCommand;
  property: PropertyCommand;
  selections: ServerCatalogSelection[];
  fault?: (stage: TransactionFaultStage) => void | Promise<void>;
}

interface CustomerReconciliation {
  outcome: "CREATED" | "REUSED" | "AMBIGUOUS";
  identity_basis: string;
  person_id: string;
  membership_id: string;
  membership_status: string;
  membership_outcome: string;
  external_reference_outcome: string;
  source_evidence_fingerprint: string;
}

interface PropertyReconciliation {
  property_id: string;
  property_snapshot_id: string;
  property_outcome: string;
  snapshot_outcome: string;
  source_evidence_fingerprint: string;
}

export interface CanonicalOrderRecord {
  order: Record<string, unknown> & {
    id: string;
    organization_id: string;
    property_id: string;
    property_snapshot_id: string;
    item_subtotal_cents: string | number;
    travel_amount_cents: string | number;
    total_amount_cents: string | number;
    currency: string;
    source_system: string;
    current_state: string;
    created_at: string;
  };
  parties: Array<Record<string, unknown> & { party_role: string; person_id: string | null; organization_id: string | null }>;
  items: Array<Record<string, unknown> & {
    position: number;
    commercial_snapshot_id: string | null;
    frozen_description: string;
    quantity: string;
    commercial_unit: string;
    unit_amount_cents: string | number;
    line_total_cents: string | number;
    currency: string;
  }>;
  external_references: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  relationships: Array<Record<string, unknown>>;
}

export interface ListingTransactionResult {
  orderId: string;
  customer: CustomerReconciliation;
  property: PropertyReconciliation;
  resolvedLines: ResolvedCatalogLine[];
  commercialSnapshotIds: string[];
  snapshotsReused: boolean;
  canonicalRecord: CanonicalOrderRecord;
  postCommitRecord: CanonicalOrderRecord;
}

export class OperationsConsoleDatabaseError extends Error {
  constructor(public readonly code: "AUTHORITY" | "CONFLICT" | "VALIDATION" | "UNAVAILABLE", message: string) {
    super(message);
    this.name = "OperationsConsoleDatabaseError";
  }
}

function numberValue(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isInsideBracket(row: CatalogProjectionRow, basis: number): boolean {
  const lower = numberValue(row.lower_bound);
  const upper = numberValue(row.upper_bound);
  if (lower === null) return false;
  const lowerOk = basis > lower || (basis === lower && row.lower_inclusive === true);
  const upperOk = upper === null || basis < upper || (basis === upper && row.upper_inclusive === true);
  return lowerOk && upperOk;
}

export function resolveCatalogSelections(
  projection: CatalogProjection,
  selections: readonly ServerCatalogSelection[],
  squareFeet: number | null,
): ResolvedCatalogLine[] {
  if (selections.length === 0) throw new OperationsConsoleDatabaseError("VALIDATION", "Select at least one service.");
  const seen = new Set<string>();
  const inclusionByPackage = new Map<string, CatalogInclusionRow[]>();
  for (const inclusion of projection.inclusions) {
    const values = inclusionByPackage.get(inclusion.package_product_code) ?? [];
    values.push(inclusion);
    inclusionByPackage.set(inclusion.package_product_code, values);
  }
  for (const values of inclusionByPackage.values()) values.sort((a, b) => a.item_position - b.item_position);

  return selections.map((selection, index) => {
    if (seen.has(selection.productCode)) {
      throw new OperationsConsoleDatabaseError("VALIDATION", "Each service may be selected only once.");
    }
    seen.add(selection.productCode);
    const candidates = projection.rows.filter((row) => row.product_code === selection.productCode);
    if (candidates.length === 0) throw new OperationsConsoleDatabaseError("VALIDATION", "A selected service is no longer available.");
    const first = candidates[0]!;
    let row: CatalogProjectionRow;
    let basis: ResolvedCatalogLine["basis"] = null;
    if (first.product_kind === "PACKAGE") {
      if (selection.quantity !== 1) throw new OperationsConsoleDatabaseError("VALIDATION", "Package quantity must be one.");
      if ((inclusionByPackage.get(first.product_code) ?? []).length === 0) {
        throw new OperationsConsoleDatabaseError("VALIDATION", "This package lacks complete immutable composition evidence.");
      }
      const basisKind = first.bracket_basis;
      const basisValue = basisKind === "SQUARE_FEET" ? squareFeet : basisKind === "SCOPE_UNITS" ? 0 : null;
      if (basisValue === null || (basisKind === "SQUARE_FEET" && (!Number.isInteger(basisValue) || basisValue <= 0))) {
        throw new OperationsConsoleDatabaseError("VALIDATION", "Reported square feet are required for the selected package.");
      }
      const matches = candidates.filter((candidate) => candidate.bracket_basis === basisKind && isInsideBracket(candidate, basisValue));
      if (matches.length !== 1) throw new OperationsConsoleDatabaseError("VALIDATION", "No single current price bracket matches this property.");
      row = matches[0]!;
      basis = { kind: basisKind!, value: basisValue };
    } else {
      if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) {
        throw new OperationsConsoleDatabaseError("VALIDATION", "Service quantity must be between one and 99.");
      }
      if (candidates.length !== 1 || candidates[0]!.price_evidence_id === null) {
        throw new OperationsConsoleDatabaseError("VALIDATION", "No single current price is available for a selected service.");
      }
      row = candidates[0]!;
    }
    const unitAmountCents = numberValue(row.amount_cents);
    if (unitAmountCents === null || !Number.isSafeInteger(unitAmountCents) || unitAmountCents < 0) {
      throw new OperationsConsoleDatabaseError("VALIDATION", "A selected service has invalid price evidence.");
    }
    const lineTotalCents = unitAmountCents * selection.quantity;
    if (!Number.isSafeInteger(lineTotalCents)) throw new OperationsConsoleDatabaseError("VALIDATION", "A selected service total is outside the supported range.");
    return {
      position: index + 1,
      productId: row.product_id,
      productCode: row.product_code,
      displayName: row.display_name,
      productKind: row.product_kind,
      commercialUnit: row.commercial_unit,
      quantity: selection.quantity,
      unitAmountCents,
      lineTotalCents,
      currency: row.currency,
      basis,
      bracketCode: row.bracket_code,
      inclusions: (inclusionByPackage.get(row.product_code) ?? []).map((inclusion) => ({
        displayName: inclusion.included_display_name,
        quantity: inclusion.quantity,
        commercialUnit: inclusion.commercial_unit,
        position: inclusion.item_position,
      })),
    };
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Evidence(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function commercialFingerprint(lines: readonly ResolvedCatalogLine[]): string {
  return sha256Evidence(lines.map((line) => ({
    position: line.position,
    productCode: line.productCode,
    quantity: line.quantity,
    unitAmountCents: line.unitAmountCents,
    currency: line.currency,
    basis: line.basis,
    bracketCode: line.bracketCode,
    inclusions: line.inclusions,
  })));
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function deterministicSnapshotUuid(name: string): string {
  const digest = createHash("sha1").update(uuidBytes(SNAPSHOT_NAMESPACE)).update(name, "utf8").digest().subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  return formatUuid(digest);
}

function ensureCanonicalReadback(
  record: CanonicalOrderRecord | null,
  orderId: string,
  property: PropertyReconciliation,
  lines: readonly ResolvedCatalogLine[],
  snapshotIds: readonly string[],
): CanonicalOrderRecord {
  if (!record || record.order.id !== orderId || record.order.organization_id !== OPERATIONS_CONSOLE_ORGANIZATION_ID ||
      record.order.property_id !== property.property_id || record.order.property_snapshot_id !== property.property_snapshot_id) {
    throw new OperationsConsoleDatabaseError("UNAVAILABLE", "Canonical Order readback did not match the committed listing evidence.");
  }
  const roles = record.parties.map((party) => party.party_role).sort();
  const expectedRoles = ["AUTHORIZED_ACTOR", "BILLING_PARTY", "COMMERCIAL_OWNER", "CUSTOMER", "ORDERING_PERSON", "ORGANIZATION"];
  if (roles.length !== expectedRoles.length || roles.some((role, index) => role !== expectedRoles[index])) {
    throw new OperationsConsoleDatabaseError("UNAVAILABLE", "Canonical Order party readback is incomplete.");
  }
  if (record.items.length !== lines.length) throw new OperationsConsoleDatabaseError("UNAVAILABLE", "Canonical Order line readback is incomplete.");
  let subtotal = 0;
  for (let index = 0; index < lines.length; index++) {
    const item = record.items[index]!;
    const line = lines[index]!;
    if (item.position !== line.position || item.commercial_snapshot_id !== snapshotIds[index] ||
        Number(item.unit_amount_cents) !== line.unitAmountCents || Number(item.line_total_cents) !== line.lineTotalCents ||
        item.currency !== line.currency) {
      throw new OperationsConsoleDatabaseError("UNAVAILABLE", "Canonical Order line readback differs from immutable commercial evidence.");
    }
    subtotal += line.lineTotalCents;
  }
  if (Number(record.order.item_subtotal_cents) !== subtotal || Number(record.order.travel_amount_cents) !== 0 ||
      Number(record.order.total_amount_cents) !== subtotal || record.order.source_system !== SOURCE_SYSTEM) {
    throw new OperationsConsoleDatabaseError("UNAVAILABLE", "Canonical Order totals or source readback are invalid.");
  }
  return record;
}

export class OperationsConsoleDatabase {
  readonly pool: pg.Pool;

  constructor() {
    const boundary = OPERATIONS_CONSOLE_DATABASE;
    if (boundary.host !== "/tmp/mlvs01-p02m17a-pg" || boundary.port !== 55448 ||
        boundary.database !== "medialab_p02m17a_test" || boundary.user !== "medialab_p02m17a_test_app") {
      throw new OperationsConsoleDatabaseError("AUTHORITY", "The Operations Console database boundary is invalid.");
    }
    this.pool = new Pool({
      ...boundary,
      max: 6,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 3_000,
      statement_timeout: 30_000,
      application_name: "p02-m17-a-operations-console",
    });
  }

  async assertRestrictedRuntime(): Promise<{ user: string; database: string; port: number }> {
    const result = await this.pool.query<{ user_name: string; database_name: string; port_number: string }>(
      "SELECT current_user AS user_name, current_database() AS database_name, current_setting('port') AS port_number",
    );
    const row = result.rows[0];
    if (!row || row.user_name !== OPERATIONS_CONSOLE_DATABASE.user || row.database_name !== OPERATIONS_CONSOLE_DATABASE.database ||
        Number(row.port_number) !== OPERATIONS_CONSOLE_DATABASE.port) {
      throw new OperationsConsoleDatabaseError("AUTHORITY", "Restricted runtime identity could not be verified.");
    }
    return { user: row.user_name, database: row.database_name, port: Number(row.port_number) };
  }

  async getCatalog(databaseSessionToken: string, effectiveAt = new Date().toISOString()): Promise<CatalogProjection> {
    const [catalog, inclusions] = await Promise.all([
      this.pool.query<CatalogProjectionRow>(
        "SELECT * FROM medialab_core.get_current_selectable_catalog($1::timestamptz)", [effectiveAt],
      ),
      this.pool.query<CatalogInclusionRow>(
        "SELECT * FROM medialab_core.get_current_catalog_package_inclusions($1::timestamptz)", [effectiveAt],
      ),
    ]);
    void databaseSessionToken;
    return { effectiveAt, rows: catalog.rows, inclusions: inclusions.rows };
  }

  async getOrderRecord(databaseSessionToken: string, orderId: string): Promise<CanonicalOrderRecord> {
    const result = await this.pool.query<{ get_order_record: CanonicalOrderRecord | null }>(
      "SELECT medialab_core.get_order_record($1,$2::uuid)", [databaseSessionToken, orderId],
    );
    const record = result.rows[0]?.get_order_record;
    if (!record) throw new OperationsConsoleDatabaseError("AUTHORITY", "The requested Order is unavailable.");
    return record;
  }

  async createListing(command: CreateListingTransactionCommand): Promise<ListingTransactionResult> {
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query("SET LOCAL statement_timeout = '30000ms'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `M17A:${OPERATIONS_CONSOLE_ORGANIZATION_ID}:${command.submissionId}`,
      ]);

      const creationEffectiveAt = new Date().toISOString();
      const catalogRows = await client.query<CatalogProjectionRow>(
        "SELECT * FROM medialab_core.get_current_selectable_catalog($1::timestamptz)", [creationEffectiveAt],
      );
      const inclusionRows = await client.query<CatalogInclusionRow>(
        "SELECT * FROM medialab_core.get_current_catalog_package_inclusions($1::timestamptz)", [creationEffectiveAt],
      );
      const lines = resolveCatalogSelections(
        { effectiveAt: creationEffectiveAt, rows: catalogRows.rows, inclusions: inclusionRows.rows },
        command.selections,
        command.property.squareFeet,
      );
      if (commercialFingerprint(lines) !== command.expectedCommercialFingerprint) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "Catalog evidence changed; review the listing again before creation.");
      }
      const currencies = new Set(lines.map((line) => line.currency));
      if (currencies.size !== 1) throw new OperationsConsoleDatabaseError("VALIDATION", "Selected services do not share one currency.");
      const currency = lines[0]!.currency;

      const customerFingerprint = sha256Evidence({ customer: command.customer, submissionId: command.submissionId });
      const customerResult = await client.query<{ reconcile_customer_person_intake: CustomerReconciliation }>(
        `SELECT medialab_core.reconcile_customer_person_intake(
          $1,$2,$3::uuid,$4,NULL,NULL,NULL,$5,$6,$7)`,
        [command.databaseSessionToken, `m17a-customer-${command.submissionId}`, OPERATIONS_CONSOLE_ORGANIZATION_ID,
          SOURCE_SYSTEM, customerFingerprint, command.customer.displayName, command.customer.email],
      );
      const customer = customerResult.rows[0]?.reconcile_customer_person_intake;
      if (!customer?.person_id || customer.outcome === "AMBIGUOUS") {
        throw new OperationsConsoleDatabaseError("CONFLICT", "Customer evidence could not be reconciled unambiguously.");
      }
      await command.fault?.("after_customer");

      const propertyFingerprint = sha256Evidence({ property: command.property, submissionId: command.submissionId });
      const propertyResult = await client.query<{ reconcile_property_snapshot_intake: PropertyReconciliation }>(
        `SELECT medialab_core.reconcile_property_snapshot_intake(
          $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [command.databaseSessionToken, `m17a-property-${command.submissionId}`, OPERATIONS_CONSOLE_ORGANIZATION_ID,
          SOURCE_SYSTEM, propertyFingerprint, command.property.addressLine1, command.property.addressLine2,
          command.property.locality, command.property.administrativeArea, command.property.postalCode,
          command.property.countryCode, command.property.squareFeet],
      );
      const property = propertyResult.rows[0]?.reconcile_property_snapshot_intake;
      if (!property?.property_id || !property.property_snapshot_id) {
        throw new OperationsConsoleDatabaseError("UNAVAILABLE", "Property evidence was not created.");
      }
      await command.fault?.("after_property");

      const snapshotIds = lines.map((line) => deterministicSnapshotUuid(
        `${OPERATIONS_CONSOLE_ORGANIZATION_ID}:${command.requestFingerprint}:${line.position}:${line.productCode}:${line.quantity}`,
      ));
      let snapshotsReused = false;
      await client.query("SAVEPOINT m17a_commercial_snapshots");
      try {
        for (let index = 0; index < lines.length; index++) {
          const line = lines[index]!;
          await client.query(
            `SELECT medialab_core.create_catalog_commercial_snapshot(
              $1,$2::uuid,$3::uuid,$4::numeric,$5::bigint,0,NULL,0,NULL,$6::timestamptz,$7,$8,$9,0,NULL)`,
            [command.databaseSessionToken, snapshotIds[index], line.productId, line.quantity, line.basis?.value ?? null,
              creationEffectiveAt, SOURCE_SYSTEM, "LISTING_SELECTION",
              `M17A_${command.requestFingerprint.slice(0, 48)}_${line.position}`],
          );
          if (index === 0) await command.fault?.("after_first_commercial_snapshot");
        }
        await client.query("RELEASE SAVEPOINT m17a_commercial_snapshots");
      } catch (error) {
        const postgresError = error as { code?: string; constraint?: string };
        if (postgresError.code !== "23505" || postgresError.constraint !== "commercial_snapshots_pkey") throw error;
        await client.query("ROLLBACK TO SAVEPOINT m17a_commercial_snapshots");
        await client.query("RELEASE SAVEPOINT m17a_commercial_snapshots");
        snapshotsReused = true;
      }

      await command.fault?.("before_order");
      const parties = [
        { role: "ORDERING_PERSON", person_id: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID },
        { role: "CUSTOMER", person_id: customer.person_id },
        { role: "BILLING_PARTY", person_id: customer.person_id },
        { role: "COMMERCIAL_OWNER", person_id: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID },
        { role: "ORGANIZATION", organization_id: OPERATIONS_CONSOLE_ORGANIZATION_ID },
        { role: "AUTHORIZED_ACTOR", person_id: OPERATIONS_CONSOLE_OPERATOR_PERSON_ID },
      ];
      const items = snapshotIds.map((id, index) => ({ position: index + 1, commercial_snapshot_id: id }));
      const orderResult = await client.query<{ create_order: string }>(
        `SELECT medialab_core.create_order(
          $1,$2,'REAL_ESTATE',$3::uuid,$4::uuid,$5::uuid,'PAY_NOW',$6,$7,$8,$9,$10::jsonb,$11::jsonb,0,NULL,NULL,NULL,NULL)`,
        [command.databaseSessionToken, `m17a-order-${command.submissionId}`, OPERATIONS_CONSOLE_ORGANIZATION_ID,
          property.property_id, property.property_snapshot_id, currency, SOURCE_SYSTEM, "LISTING_ORDER",
          `M17A_${command.requestFingerprint.slice(0, 56)}`, JSON.stringify(parties), JSON.stringify(items)],
      );
      const orderId = orderResult.rows[0]?.create_order;
      if (!orderId) throw new OperationsConsoleDatabaseError("UNAVAILABLE", "Canonical Order creation returned no result.");
      await command.fault?.("after_order_before_readback");

      const readbackResult = await client.query<{ get_order_record: CanonicalOrderRecord | null }>(
        "SELECT medialab_core.get_order_record($1,$2::uuid)", [command.databaseSessionToken, orderId],
      );
      const canonicalRecord = ensureCanonicalReadback(readbackResult.rows[0]?.get_order_record ?? null, orderId, property, lines, snapshotIds);
      await command.fault?.("after_readback_before_commit");
      await client.query("COMMIT");
      transactionOpen = false;

      const postCommitResult = await client.query<{ get_order_record: CanonicalOrderRecord | null }>(
        "SELECT medialab_core.get_order_record($1,$2::uuid)", [command.databaseSessionToken, orderId],
      );
      const postCommitRecord = ensureCanonicalReadback(postCommitResult.rows[0]?.get_order_record ?? null, orderId, property, lines, snapshotIds);
      return { orderId, customer, property, resolvedLines: lines, commercialSnapshotIds: snapshotIds,
        snapshotsReused, canonicalRecord, postCommitRecord };
    } catch (error) {
      if (transactionOpen) {
        try { await client.query("ROLLBACK"); } catch { /* the original safe failure remains authoritative */ }
      }
      if (error instanceof OperationsConsoleDatabaseError) throw error;
      const postgresError = error as { code?: string };
      if (postgresError.code === "23505") throw new OperationsConsoleDatabaseError("CONFLICT", "The submission conflicts with existing immutable evidence.");
      if (postgresError.code === "42501") throw new OperationsConsoleDatabaseError("AUTHORITY", "The development operator session is not authorized for this request.");
      if (postgresError.code?.startsWith("22") || postgresError.code?.startsWith("23")) {
        throw new OperationsConsoleDatabaseError("VALIDATION", "The canonical command rejected incomplete or conflicting evidence.");
      }
      throw new OperationsConsoleDatabaseError("UNAVAILABLE", "The canonical listing transaction could not be completed.");
    } finally {
      client.release();
    }
  }

  #databaseError(error: unknown): OperationsConsoleDatabaseError {
    if (error instanceof OperationsConsoleDatabaseError) return error;
    const code = (error as { code?: string }).code;
    if (code === "42501") return new OperationsConsoleDatabaseError("AUTHORITY", "The operator is not authorized for this operational action.");
    if (code === "23505" || code === "23514" || code === "40001") return new OperationsConsoleDatabaseError("CONFLICT", "The operational state changed; refresh and review it before trying again.");
    if (code?.startsWith("22") || code?.startsWith("23")) return new OperationsConsoleDatabaseError("VALIDATION", "The canonical command rejected incomplete or inconsistent operational evidence.");
    return new OperationsConsoleDatabaseError("UNAVAILABLE", "The operational action could not be completed.");
  }

  async #context(queryable: pg.Pool | pg.PoolClient, databaseSessionToken: string, orderId: string): Promise<RawOperationsContext> {
    const result = await queryable.query<{ get_operations_order_context: RawOperationsContext | null }>(
      "SELECT medialab_core.get_operations_order_context($1,$2::uuid)", [databaseSessionToken, orderId],
    );
    const context = result.rows[0]?.get_operations_order_context;
    if (!context) throw new OperationsConsoleDatabaseError("AUTHORITY", "The requested operational context is unavailable.");
    return context;
  }

  async getOperationsContext(databaseSessionToken: string, orderId: string): Promise<RawOperationsContext> {
    try {
      const context = await this.#context(this.pool, databaseSessionToken, orderId);
      const result = await this.pool.query<{ get_operations_order_customer_contacts: Array<{
        contactType: "EMAIL" | "PHONE"; displayValue: string;
      }> }>("SELECT medialab_core.get_operations_order_customer_contacts($1,$2::uuid)", [databaseSessionToken, orderId]);
      return { ...context, customer: { ...context.customer, contacts: result.rows[0]!.get_operations_order_customer_contacts } };
    }
    catch (error) { throw this.#databaseError(error); }
  }

  async getOperationsHome(databaseSessionToken: string, rangeStartsAt: string, rangeEndsAt: string): Promise<Omit<OperationsHome, "schema" | "contract">> {
    try {
      const result = await this.pool.query<{ get_operations_home: Omit<OperationsHome, "schema" | "contract"> }>(
        "SELECT medialab_core.get_operations_home($1,$2::timestamptz,$3::timestamptz)",
        [databaseSessionToken, rangeStartsAt, rangeEndsAt],
      );
      return result.rows[0]!.get_operations_home;
    } catch (error) { throw this.#databaseError(error); }
  }

  async listAssignmentCandidates(databaseSessionToken: string, organizationId: string): Promise<Omit<AssignmentCandidates, "schema" | "contract">> {
    try {
      const result = await this.pool.query<{ list_operations_assignment_candidates: Omit<AssignmentCandidates, "schema" | "contract"> }>(
        "SELECT medialab_core.list_operations_assignment_candidates($1,$2::uuid)", [databaseSessionToken, organizationId],
      );
      return result.rows[0]!.list_operations_assignment_candidates;
    } catch (error) { throw this.#databaseError(error); }
  }

  async initializeOperations(databaseSessionToken: string, orderId: string): Promise<RawOperationsContext> {
    const client = await this.pool.connect();
    let open = false;
    try {
      await client.query("BEGIN"); open = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`M18A:${orderId}:INITIALIZE`]);
      let context = await this.#context(client, databaseSessionToken, orderId);
      const base = sha256Evidence({ action: "INITIALIZE_OPERATIONS", orderId });
      let hubId = context.propertyHubId;
      if (!hubId) {
        const result = await client.query<{ create_property_hub: string }>(
          "SELECT medialab_core.create_property_hub($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7::jsonb,'[]'::jsonb,'[]'::jsonb)",
          [databaseSessionToken, `m18a-hub-${base}`, context.organizationId, context.property.propertyId,
            context.property.propertySnapshotId, SOURCE_SYSTEM, JSON.stringify([orderId])],
        );
        hubId = result.rows[0]!.create_property_hub;
      }
      if (!context.scheduling) {
        await client.query("SELECT medialab_core.create_scheduling_request($1,$2,$3::uuid,$4::uuid,$5::uuid,$6)",
          [databaseSessionToken, `m18a-request-${base}`, context.organizationId, hubId, orderId, SOURCE_SYSTEM]);
      }
      let jobId = context.job?.jobId;
      if (!jobId) {
        const result = await client.query<{ create_job: string }>(
          "SELECT medialab_core.create_job($1,$2,$3::uuid,$4::uuid,$5::uuid,$6)",
          [databaseSessionToken, `m18a-job-${base}`, context.organizationId, orderId, hubId, SOURCE_SYSTEM],
        );
        jobId = result.rows[0]!.create_job;
      }
      const existing = new Set(context.job?.workstreams.map((item) => item.sourceOrderItemId) ?? []);
      for (const service of context.services) {
        if (existing.has(service.orderItemId)) continue;
        await client.query("SELECT medialab_core.create_service_workstream($1,$2,$3::uuid,$4::uuid,$5)",
          [databaseSessionToken, `m18a-workstream-${sha256Evidence({ orderId, orderItemId: service.orderItemId })}`,
            jobId, service.orderItemId, SOURCE_SYSTEM]);
      }
      context = await this.#context(client, databaseSessionToken, orderId);
      await client.query("COMMIT"); open = false;
      return context;
    } catch (error) {
      if (open) { try { await client.query("ROLLBACK"); } catch { /* preserve the primary failure */ } }
      throw this.#databaseError(error);
    } finally { client.release(); }
  }

  async #operationalCommand(
    databaseSessionToken: string,
    orderId: string,
    target: unknown,
    execute: (client: pg.PoolClient, context: RawOperationsContext, key: string) => Promise<void>,
    evidence: unknown,
  ): Promise<RawOperationsContext> {
    const client = await this.pool.connect(); let open = false;
    try {
      await client.query("BEGIN"); open = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`M18A:${orderId}`]);
      const context = await this.#context(client, databaseSessionToken, orderId);
      const key = `m18a-${sha256Evidence({ orderId, target, evidence })}`;
      await execute(client, context, key);
      const updated = await this.#context(client, databaseSessionToken, orderId);
      await client.query("COMMIT"); open = false;
      return updated;
    } catch (error) {
      if (open) { try { await client.query("ROLLBACK"); } catch { /* preserve the primary failure */ } }
      throw this.#databaseError(error);
    } finally { client.release(); }
  }

  async #requireAssignmentCandidate(
    client: pg.PoolClient, token: string, organizationId: string, personId: string,
  ): Promise<void> {
    const result = await client.query<{ list_operations_assignment_candidates: { candidates: Array<{ personId: string }> } }>(
      "SELECT medialab_core.list_operations_assignment_candidates($1,$2::uuid)", [token, organizationId],
    );
    if (!result.rows[0]?.list_operations_assignment_candidates.candidates.some((candidate) => candidate.personId === personId)) {
      throw new OperationsConsoleDatabaseError("AUTHORITY", "The selected person is not eligible for this appointment.");
    }
  }

  addRequestedWindow(token: string, orderId: string, requestId: string, input: OperationsWindowInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { requestId }, async (client, context, key) => {
      if (context.scheduling?.requestId !== requestId) throw new OperationsConsoleDatabaseError("CONFLICT", "The scheduling request changed; refresh before continuing.");
      await client.query("SELECT medialab_core.add_scheduling_requested_window($1,$2,$3::uuid,$4::timestamptz,$5::timestamptz,$6,$7::timestamp,$8::timestamp)",
        [token, key, requestId, input.startsAt, input.endsAt, input.ianaTimezone, input.localStartsAt, input.localEndsAt]);
    }, { action: "ADD_REQUESTED_WINDOW", input });
  }

  proposeWindow(token: string, orderId: string, requestId: string, input: OperationsWindowInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { requestId }, async (client, context, key) => {
      if (context.scheduling?.requestId !== requestId) throw new OperationsConsoleDatabaseError("CONFLICT", "The scheduling request changed; refresh before continuing.");
      await client.query("SELECT medialab_core.propose_scheduling_window($1,$2,$3::uuid,$4::timestamptz,$5::timestamptz,$6,$7::timestamp,$8::timestamp,$9)",
        [token, key, requestId, input.startsAt, input.endsAt, input.ianaTimezone, input.localStartsAt, input.localEndsAt, input.reason]);
    }, { action: "PROPOSE_WINDOW", input });
  }

  acceptProposal(token: string, orderId: string, requestId: string, input: AcceptProposalInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { requestId, windowId: input.windowId }, async (client, context, key) => {
      if (context.scheduling?.requestId !== requestId ||
          !context.scheduling.windows.some((window) => window.windowId === input.windowId && window.kind === "STAFF_PROPOSED")) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "The proposed window is not part of this scheduling request.");
      }
      await client.query("SELECT medialab_core.record_scheduling_offline_acceptance($1,$2,$3::uuid,$4::uuid,$5,$6)",
        [token, key, input.windowId, context.scheduling.customerIdentityId, input.acceptanceMethod, input.note ?? null]);
    }, { action: "ACCEPT_PROPOSAL", input });
  }

  confirmAppointment(token: string, orderId: string, requestId: string, input: ConfirmAppointmentInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { requestId, windowId: input.windowId }, async (client, context, key) => {
      const window = context.scheduling?.windows.find((candidate) => candidate.windowId === input.windowId);
      if (context.scheduling?.requestId !== requestId || !window || (window.kind === "STAFF_PROPOSED" && !window.accepted) || !context.job) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "The selected window is not eligible for this scheduling request.");
      }
      const result = await client.query<{ confirm_appointment: string }>(
        "SELECT medialab_core.confirm_appointment($1,$2,$3::uuid,$4::uuid,$5)",
        [token, key, requestId, input.windowId, input.reason]);
      const appointmentId = result.rows[0]!.confirm_appointment;
      await client.query("SELECT medialab_core.link_job_appointment($1,$2,$3::uuid,$4::uuid,$5)",
        [token, `${key}-link`, context.job.jobId, appointmentId, "Confirmed operational appointment linked to its canonical Job"]);
    }, { action: "CONFIRM_APPOINTMENT", input });
  }

  cancelAppointment(token: string, orderId: string, appointmentId: string, input: CancelAppointmentInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { appointmentId }, async (client, context, key) => {
      if (!context.appointmentLineageIds.includes(appointmentId)) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "The appointment is not part of this order.");
      }
      await client.query("SELECT medialab_core.cancel_appointment($1,$2,$3::uuid,$4)",
        [token, key, appointmentId, input.reason]);
    }, { action: "CANCEL_APPOINTMENT", input });
  }

  rescheduleAppointment(token: string, orderId: string, appointmentId: string, input: RescheduleAppointmentInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { appointmentId }, async (client, context, key) => {
      if (!context.appointmentLineageIds.includes(appointmentId) || !context.scheduling || !context.job) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "The appointment is not part of this operational context.");
      }
      const result = await client.query<{ supersede_and_reschedule_appointment: string }>(
        "SELECT medialab_core.supersede_and_reschedule_appointment($1,$2,$3::uuid,$4::uuid,$5,$6::timestamptz,$7::timestamptz,$8,$9::timestamp,$10::timestamp,$11,$12)",
        [token, key, appointmentId, context.scheduling.customerIdentityId, input.acceptanceMethod,
          input.startsAt, input.endsAt, input.ianaTimezone, input.localStartsAt, input.localEndsAt, input.reason, input.note ?? null]);
      await client.query("SELECT medialab_core.link_job_appointment($1,$2,$3::uuid,$4::uuid,$5)",
        [token, `${key}-link`, context.job.jobId, result.rows[0]!.supersede_and_reschedule_appointment,
          "Replacement operational appointment linked to its canonical Job"]);
    }, { action: "RESCHEDULE_APPOINTMENT", input });
  }

  assignParticipant(token: string, orderId: string, appointmentId: string, input: AssignmentInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { appointmentId }, async (client, context, key) => {
      if (context.appointment?.appointmentId !== appointmentId || !["CONFIRMED", "WEATHER_DELAYED"].includes(context.appointment.state)) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "The appointment changed or is terminal; refresh before continuing.");
      }
      await this.#requireAssignmentCandidate(client, token, context.organizationId, input.personId);
      if (context.appointment.assignments.some((assignment) =>
        assignment.personId === input.personId && assignment.operationalRole === input.operationalRole)) return;
      const assignmentKey = `${key}-${sha256Evidence({ assignmentLineageIds: context.assignmentLineageIds })}`;
      await client.query("SELECT medialab_core.assign_appointment_participant($1,$2,$3::uuid,$4::uuid,$5)",
        [token, assignmentKey, appointmentId, input.personId, input.operationalRole]);
    }, { action: "ASSIGN_PARTICIPANT", input });
  }

  replaceParticipant(token: string, orderId: string, appointmentId: string, assignmentId: string, input: ReplacementInput): Promise<RawOperationsContext> {
    return this.#operationalCommand(token, orderId, { appointmentId, assignmentId }, async (client, context, key) => {
      if (context.appointment?.appointmentId !== appointmentId || !["CONFIRMED", "WEATHER_DELAYED"].includes(context.appointment.state) ||
          !context.assignmentLineageIds.includes(assignmentId)) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "The active assignment is not part of this nonterminal appointment.");
      }
      const activeTarget = context.appointment.assignments.find((assignment) => assignment.assignmentId === assignmentId);
      if (activeTarget && context.appointment.assignments.some((assignment) =>
        assignment.personId === input.replacementPersonId && assignment.operationalRole === activeTarget.operationalRole)) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "That person already holds this active appointment role.");
      }
      await this.#requireAssignmentCandidate(client, token, context.organizationId, input.replacementPersonId);
      await client.query("SELECT medialab_core.replace_appointment_participant_assignment($1,$2,$3::uuid,$4::uuid,$5)",
        [token, key, assignmentId, input.replacementPersonId, input.reason]);
    }, { action: "REPLACE_PARTICIPANT", assignmentId, input });
  }

  async #missionPlanRelationship(
    token: string,
    orderId: string,
  ): Promise<{ context: RawOperationsContext; jobAppointmentId: string | null; plan: MissionPlanRecord | null; controls: MissionPlanDraftControls | null }> {
    const context = await this.#context(this.pool, token, orderId);
    if (!context.job || !context.appointment) return { context, jobAppointmentId: null, plan: null, controls: null };
    const [jobResult, plansResult] = await Promise.all([
      this.pool.query<{ get_job_record: RawJobRecord }>(
        "SELECT medialab_core.get_job_record($1,$2::uuid)", [token, context.job.jobId],
      ),
      this.pool.query<{ list_mission_plans: MissionPlanSummary[] }>(
        "SELECT medialab_core.list_mission_plans($1,$2::uuid,NULL::uuid)", [token, context.job.jobId],
      ),
    ]);
    const jobAppointmentId = jobResult.rows[0]?.get_job_record.appointments
      .find((item) => item.appointment_id === context.appointment?.appointmentId)?.id ?? null;
    const summary = plansResult.rows[0]?.list_mission_plans
      .find((item) => item.appointment_id === context.appointment?.appointmentId);
    if (!summary) return { context, jobAppointmentId, plan: null, controls: null };
    const record = await this.pool.query<{ get_mission_plan_record: MissionPlanRecord }>(
      "SELECT medialab_core.get_mission_plan_record($1,$2::uuid)", [token, summary.mission_plan_id],
    );
    const controls = await this.getMissionPlanControls(token, summary.mission_plan_id);
    return { context, jobAppointmentId, plan: record.rows[0]!.get_mission_plan_record, controls };
  }

  async getMissionPlanWorkspace(token: string, orderId: string): Promise<{
    context: RawOperationsContext; jobAppointmentId: string | null; plan: MissionPlanRecord | null; controls: MissionPlanDraftControls | null;
  }> {
    try { return await this.#missionPlanRelationship(token, orderId); }
    catch (error) { throw this.#databaseError(error); }
  }

  async createMissionPlanDraft(
    token: string,
    orderId: string,
    sections: MissionPlanSectionInput[],
  ): Promise<{ context: RawOperationsContext; jobAppointmentId: string | null; plan: MissionPlanRecord | null; controls: MissionPlanDraftControls | null }> {
    try {
      const relationship = await this.#missionPlanRelationship(token, orderId);
      if (relationship.plan) return relationship;
      if (!relationship.jobAppointmentId || !relationship.context.appointment ||
          !["CONFIRMED", "WEATHER_DELAYED"].includes(relationship.context.appointment.state)) {
        throw new OperationsConsoleDatabaseError("CONFLICT", "Confirm and link an active appointment before creating its Mission Plan.");
      }
      const key = `m19a-create-${sha256Evidence({ orderId, sections })}`;
      const result = await this.pool.query<{ create_mission_plan_draft: string }>(
        "SELECT medialab_core.create_mission_plan_draft($1,$2,$3::uuid,$4::jsonb,'UNAVAILABLE',NULL::jsonb,$5)",
        [token, key, relationship.jobAppointmentId, JSON.stringify({ sections }), "Live weather is not connected in this nonproduction packet."],
      );
      const planId = result.rows[0]!.create_mission_plan_draft;
      const record = await this.pool.query<{ get_mission_plan_record: MissionPlanRecord }>(
        "SELECT medialab_core.get_mission_plan_record($1,$2::uuid)", [token, planId],
      );
      return { ...relationship, plan: record.rows[0]!.get_mission_plan_record,
        controls: await this.getMissionPlanControls(token, planId) };
    } catch (error) { throw this.#databaseError(error); }
  }

  async reviseMissionPlanDraft(token: string, missionPlanId: string, sections: MissionPlanSectionInput[]): Promise<MissionPlanRecord> {
    try {
      const key = `m19a-revise-${sha256Evidence({ missionPlanId, sections })}`;
      await this.pool.query(
        "SELECT medialab_core.revise_mission_plan_draft($1,$2,$3::uuid,$4::jsonb,'UNAVAILABLE',NULL::jsonb,$5)",
        [token, key, missionPlanId, JSON.stringify({ sections }), "Live weather is not connected in this nonproduction packet."],
      );
      return await this.getMissionPlanRecord(token, missionPlanId);
    } catch (error) { throw this.#databaseError(error); }
  }

  async addMissionPlanNote(token: string, missionPlanId: string, visibility: MissionPlanVisibility, note: string): Promise<MissionPlanRecord> {
    try {
      const key = `m19a-note-${sha256Evidence({ missionPlanId, visibility, note })}`;
      await this.pool.query("SELECT medialab_core.add_mission_plan_note($1,$2,$3::uuid,$4,$5)",
        [token, key, missionPlanId, visibility, note]);
      return await this.getMissionPlanRecord(token, missionPlanId);
    } catch (error) { throw this.#databaseError(error); }
  }

  async refreshMissionPlanDraft(token: string, missionPlanId: string): Promise<MissionPlanRecord> {
    try {
      const record = await this.getMissionPlanRecord(token, missionPlanId);
      const generation = record.draft?.draft_generation ?? 0;
      await this.pool.query("SELECT medialab_core.refresh_mission_plan_draft($1,$2,$3::uuid)",
        [token, `m19a-refresh-${sha256Evidence({ missionPlanId, generation })}`, missionPlanId]);
      return await this.getMissionPlanRecord(token, missionPlanId);
    } catch (error) { throw this.#databaseError(error); }
  }

  async issueMissionPlanVersion(token: string, missionPlanId: string): Promise<MissionPlanRecord> {
    try {
      const record = await this.getMissionPlanRecord(token, missionPlanId);
      const generation = record.draft?.draft_generation ?? 0;
      await this.pool.query("SELECT medialab_core.issue_mission_plan_version($1,$2,$3::uuid)",
        [token, `m19a-issue-${sha256Evidence({ missionPlanId, generation })}`, missionPlanId]);
      return await this.getMissionPlanRecord(token, missionPlanId);
    } catch (error) { throw this.#databaseError(error); }
  }

  async supersedeMissionPlanVersion(token: string, missionPlanId: string, baseVersionId: string): Promise<MissionPlanRecord> {
    try {
      await this.pool.query("SELECT medialab_core.create_mission_plan_superseding_draft($1,$2,$3::uuid,$4::uuid)",
        [token, `m19a-supersede-${sha256Evidence({ missionPlanId, baseVersionId })}`, missionPlanId, baseVersionId]);
      return await this.getMissionPlanRecord(token, missionPlanId);
    } catch (error) { throw this.#databaseError(error); }
  }

  async recordMissionPlanDownload(token: string, missionPlanId: string, versionId: string): Promise<void> {
    try {
      await this.pool.query("SELECT medialab_core.record_mission_plan_open_event($1,$2,$3::uuid,$4::uuid,'OPENED',$5::jsonb)",
        [token, `m19a-download-${sha256Evidence({ missionPlanId, versionId })}`, missionPlanId, versionId,
          JSON.stringify({ channel: "OPERATIONS_CONSOLE_OFFLINE_FIELD_PACKET", nonproduction: true })]);
    } catch (error) { throw this.#databaseError(error); }
  }

  async getMissionPlanRecord(token: string, missionPlanId: string): Promise<MissionPlanRecord> {
    const result = await this.pool.query<{ get_mission_plan_record: MissionPlanRecord }>(
      "SELECT medialab_core.get_mission_plan_record($1,$2::uuid)", [token, missionPlanId],
    );
    return result.rows[0]!.get_mission_plan_record;
  }

  async getMissionPlanControls(token: string, missionPlanId: string): Promise<MissionPlanDraftControls> {
    const result = await this.pool.query<{ get_operations_mission_plan_draft_controls: MissionPlanDraftControls }>(
      "SELECT medialab_core.get_operations_mission_plan_draft_controls($1,$2::uuid)", [token, missionPlanId],
    );
    return result.rows[0]!.get_operations_mission_plan_draft_controls;
  }

  async replaceMissionPlanWorkstreams(token: string, missionPlanId: string, workstreamIds: string[]): Promise<MissionPlanRecord> {
    try {
      const key = `m19a-workstreams-${sha256Evidence({ missionPlanId, workstreamIds })}`;
      await this.pool.query("SELECT medialab_core.replace_mission_plan_draft_workstreams($1,$2,$3::uuid,$4::uuid[])",
        [token, key, missionPlanId, workstreamIds]);
      return await this.getMissionPlanRecord(token, missionPlanId);
    } catch (error) { throw this.#databaseError(error); }
  }

  async replaceMissionPlanContacts(token: string, missionPlanId: string, contacts: Array<{
    personId: string; contactMethodId: string; contactRole: string; visibility: MissionPlanVisibility;
  }>): Promise<MissionPlanRecord> {
    try {
      const canonicalContacts = contacts.map((contact) => ({ person_id: contact.personId,
        contact_method_id: contact.contactMethodId, contact_role: contact.contactRole,
        visibility_classification: contact.visibility }));
      const key = `m19a-contacts-${sha256Evidence({ missionPlanId, canonicalContacts })}`;
      await this.pool.query("SELECT medialab_core.replace_mission_plan_draft_contacts($1,$2,$3::uuid,$4::jsonb)",
        [token, key, missionPlanId, JSON.stringify(canonicalContacts)]);
      return await this.getMissionPlanRecord(token, missionPlanId);
    } catch (error) { throw this.#databaseError(error); }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
