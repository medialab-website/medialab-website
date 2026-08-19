import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CurrentEraCohortIdentityProofV1, CurrentEraNormalizedListingV1, CurrentEraPilotSelectionReceiptV1,
  CurrentEraShapeV1, CurrentEraSourceProfileV1,
} from "./contracts.js";
import { CURRENT_SHADOW_SCHEMA } from "./contracts.js";
import type { PrivateCurrentEraIntakeV1 } from "../runtime-intake/contracts.js";

export const CURRENT_ERA_SOURCE_IDENTITY = Object.freeze({
  artifactName: "Orders - Aug 15 2026.xlsx",
  sourceArtifactHash: "fe7c2f6628d4961c6181d5d00aa3df90e4de9ce5bcd291a02c282f8528f64189",
  byteSize: 222_765,
  cutoffDateInclusive: "2026-03-27",
  reviewedSnapshotHorizonInclusive: "2026-08-02",
});

type Row = Record<string, string> & { __rowNumber: string };

const REQUIRED_HEADERS = Object.freeze({
  Orders: ["ID", "Customer", "Customer Team ID", "Address", "Status", "Payment Status", "Fulfillment Status", "Created At", "Team Members", "Order Form ID"],
  Appointments: ["Order ID", "Has Been Rescheduled", "Has Been Postponed"],
  "Order Items": ["Order ID", "Item"],
  Payments: ["Order ID", "Payment Type"],
});

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase();

function decodeXml(value: string): string {
  return value.replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function zipText(path: string, member: string): string {
  return execFileSync("unzip", ["-p", path, member], { encoding: "utf8", maxBuffer: 48 * 1024 * 1024 });
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1]!)).join(""));
}

function parseWorksheet(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cell[1]!; const body = cell[2]!;
      const reference = attributes.match(/\br="([A-Z]+\d+)"/)?.[1] ?? "A1";
      const type = attributes.match(/\bt="([^"]+)"/)?.[1];
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      row[columnIndex(reference)] = type === "s" ? (shared[Number(raw)] ?? "") : decodeXml(raw);
    }
    rows.push(row.map((value) => value ?? ""));
  }
  return rows;
}

function parseXlsx(path: string): Record<string, Row[]> {
  const workbook = zipText(path, "xl/workbook.xml");
  const relationships = zipText(path, "xl/_rels/workbook.xml.rels");
  let shared: string[] = [];
  try { shared = parseSharedStrings(zipText(path, "xl/sharedStrings.xml")); } catch { shared = []; }
  const targets = new Map([...relationships.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((match) => [match[1]!, match[2]!]));
  const result: Record<string, Row[]> = {};
  for (const sheet of workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = decodeXml(sheet[1]!); const target = targets.get(sheet[2]!);
    if (!target) throw new Error(`CURRENT_SHADOW_SOURCE_SCHEMA_DIVERGENCE: missing worksheet target for ${name}`);
    const member = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const matrix = parseWorksheet(zipText(path, member), shared);
    const headers = matrix[0] ?? [];
    result[name] = matrix.slice(1).map((values, index) => Object.assign({ __rowNumber: String(index + 2) },
      Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]))));
  }
  return result;
}

function assertSourceSchema(workbook: Record<string, Row[]>): void {
  for (const [sheet, requiredHeaders] of Object.entries(REQUIRED_HEADERS)) {
    const rows = workbook[sheet];
    if (!rows?.length) throw new Error(`CURRENT_SHADOW_SOURCE_SCHEMA_DIVERGENCE: required worksheet ${sheet} is missing or empty`);
    const actual = new Set(Object.keys(rows[0]!));
    for (const header of requiredHeaders) {
      if (!actual.has(header)) throw new Error(`CURRENT_SHADOW_SOURCE_SCHEMA_DIVERGENCE: required structural field is missing from ${sheet}`);
    }
  }
}

function parseProviderLocalTimestamp(value: string): number {
  const match = value.trim().match(/^[A-Za-z]{3},\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4}),\s+(\d{1,2}):(\d{2})(am|pm)?\s+[A-Z]{3,4}$/i);
  if (!match) throw new Error("CURRENT_SHADOW_SOURCE_SCHEMA_DIVERGENCE: unsupported local timestamp shape");
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const month = months.indexOf(match[1]!.toLowerCase());
  if (month < 0) throw new Error("CURRENT_SHADOW_SOURCE_SCHEMA_DIVERGENCE: unsupported local month shape");
  let hour = Number(match[4]);
  const suffix = match[6]?.toLowerCase();
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return Date.UTC(Number(match[3]), month, Number(match[2]), hour, Number(match[5]));
}

function serviceFamilies(items: readonly Row[]): string[] {
  const families = new Set<string>();
  for (const item of items) {
    const label = normalized(item["Item"]);
    if (/photo|image|hdr/.test(label)) families.add("IMAGE_CAPTURE");
    if (/video|motion|reel/.test(label)) families.add("MOTION_CAPTURE");
    if (/aerial|drone/.test(label)) families.add("AERIAL_CAPTURE");
    if (/floor|matterport|3d|virtual/.test(label)) families.add("SPATIAL_CAPTURE");
    if (/twilight|dusk/.test(label)) families.add("TIME_WINDOW_CAPTURE");
    if (/package|bundle/.test(label)) families.add("PACKAGE_SHAPE");
  }
  if (!families.size) families.add("OTHER_SERVICE");
  return [...families].sort();
}

function shapeFor(order: Row, items: readonly Row[], appointments: readonly Row[], payments: readonly Row[]): CurrentEraShapeV1 {
  const families = serviceFamilies(items);
  const lineCount = items.length; const appointmentCount = appointments.length; const paymentCount = payments.length;
  const teamAssociationPresent = Boolean(order["Team Members"]?.trim());
  const orderFormAssociationPresent = Boolean(order["Order Form ID"]?.trim());
  const tokens = [
    `LINE_CARDINALITY_${lineCount}`,
    `APPOINTMENT_CARDINALITY_${appointmentCount}`,
    `PAYMENT_EVIDENCE_CARDINALITY_${paymentCount}`,
    `TEAM_ASSOCIATION_${teamAssociationPresent ? "PRESENT" : "ABSENT"}`,
    `ORDER_FORM_ASSOCIATION_${orderFormAssociationPresent ? "PRESENT" : "ABSENT"}`,
    `MULTI_APPOINTMENT_${appointmentCount > 1 ? "YES" : "NO"}`,
    ...families.map((family) => `SERVICE_FAMILY_${family}`),
  ].sort();
  return { orderLineCardinality: lineCount, appointmentCardinality: appointmentCount,
    paymentEvidenceCardinality: paymentCount, teamAssociationPresent, orderFormAssociationPresent,
    serviceFamilies: families, shapeTokens: tokens };
}

function privateIntakeFor(order: Row, evidenceFingerprint: string): PrivateCurrentEraIntakeV1 {
  const customerDisplayName = order.Customer?.trim().replace(/\s+/g, " ") ?? "";
  const externalCustomerKey = order["Customer Team ID"]?.trim() ?? "";
  const addressParts = (order.Address ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const tail = addressParts.at(-1)?.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  const property = addressParts.length === 3 && tail ? {
    sourceSystem: "ARYEO_LOCAL_EXPORT",
    sourceEvidenceFingerprint: evidenceFingerprint,
    addressLine1: addressParts[0]!,
    addressLine2: null,
    locality: addressParts[1]!,
    administrativeArea: tail[1]!.toUpperCase(),
    postalCode: tail[2]!,
    countryCode: "US",
    reportedSquareFeet: null,
  } : null;
  return {
    customer: {
      sourceSystem: "ARYEO_LOCAL_EXPORT",
      sourceScope: externalCustomerKey ? "FROZEN_ACCOUNT_SCOPE_V1" : null,
      externalRecordType: externalCustomerKey ? "CUSTOMER_TEAM" : null,
      externalIdentifier: externalCustomerKey || null,
      sourceEvidenceFingerprint: evidenceFingerprint,
      displayName: customerDisplayName,
      email: null,
    },
    property,
    propertyEvidenceStatus: property ? "COMPLETE_EXACT_US_POSTAL_TUPLE" : "INCOMPLETE_ADDRESS_EVIDENCE",
  };
}

export async function loadCurrentEraCohort(sourcePath: string): Promise<{
  sourceProfile: CurrentEraSourceProfileV1;
  identityProof: CurrentEraCohortIdentityProofV1;
  listings: CurrentEraNormalizedListingV1[];
  privateIntakeByScenario: ReadonlyMap<string, PrivateCurrentEraIntakeV1>;
}> {
  const bytes = await readFile(sourcePath);
  if (bytes.length !== CURRENT_ERA_SOURCE_IDENTITY.byteSize || sha256(bytes) !== CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash) {
    throw new Error("CURRENT_COHORT_SOURCE_IDENTITY_NOT_ESTABLISHED: local source artifact identity differs from the frozen reviewed artifact");
  }
  const workbook = parseXlsx(sourcePath); assertSourceSchema(workbook);
  const orders = workbook.Orders!; const appointments = workbook.Appointments!;
  const items = workbook["Order Items"]!; const payments = workbook.Payments!;
  const cutoff = Date.UTC(2026, 2, 27); const horizon = Date.UTC(2026, 7, 2, 23, 59, 59, 999);
  const withinHorizon = orders.filter((order) => {
    const created = parseProviderLocalTimestamp(order["Created At"]!);
    return created >= cutoff && created <= horizon;
  });
  const cohort = withinHorizon.filter((order) => normalized(order.Status) === "open" &&
    normalized(order["Payment Status"]) === "paid" && normalized(order["Fulfillment Status"]) === "fulfilled");
  if (withinHorizon.length !== 44 || cohort.length !== 42) {
    throw new Error(`CURRENT_COHORT_MEMBERSHIP_DIVERGENCE: expected reviewed 44-row horizon and exact 42-member cohort, observed ${withinHorizon.length}/${cohort.length}`);
  }
  const byOrder = (rows: readonly Row[], key: string) => {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) { const value = row[key] ?? ""; const bucket = grouped.get(value) ?? []; bucket.push(row); grouped.set(value, bucket); }
    return grouped;
  };
  const itemGroups = byOrder(items, "Order ID"); const appointmentGroups = byOrder(appointments, "Order ID");
  const paymentGroups = byOrder(payments, "Order ID");
  const privateIntakeByScenario = new Map<string, PrivateCurrentEraIntakeV1>();
  const listings = cohort.map((order, index): CurrentEraNormalizedListingV1 => {
    const rawOrderKey = order.ID!;
    if (!rawOrderKey) throw new Error("CURRENT_SHADOW_SOURCE_SCHEMA_DIVERGENCE: cohort row lacks a source key");
    const scenarioId = "M16D_CURRENT_ERA_" + String(index + 1).padStart(3, "0") + "_V1";
    const opaqueSourceReferenceHash = sha256("P02-M16-D|" + CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash + "|" + rawOrderKey);
    privateIntakeByScenario.set(scenarioId, privateIntakeFor(order, opaqueSourceReferenceHash));
    return {
      schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraNormalizedListingV1",
      scenarioId,
      stableSourceRow: Number(order.__rowNumber),
      opaqueSourceReferenceHash,
      shape: shapeFor(order, itemGroups.get(rawOrderKey) ?? [], appointmentGroups.get(rawOrderKey) ?? [], paymentGroups.get(rawOrderKey) ?? []),
      marketStatusEvidence: "MARKET_STATUS_NOT_AVAILABLE",
    };
  });
  const rejectedShapeCounts = Object.fromEntries([...new Map(withinHorizon.filter((row) => !cohort.includes(row)).map((row) => {
    const key = `${normalized(row.Status).toUpperCase()}_${normalized(row["Payment Status"]).toUpperCase()}_${normalized(row["Fulfillment Status"]).toUpperCase()}`;
    return [key, withinHorizon.filter((candidate) => `${normalized(candidate.Status).toUpperCase()}_${normalized(candidate["Payment Status"]).toUpperCase()}_${normalized(candidate["Fulfillment Status"]).toUpperCase()}` === key).length];
  })).entries()].sort());
  const sourceProfile: CurrentEraSourceProfileV1 = {
    schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraSourceProfileV1", sourceArtifactName: CURRENT_ERA_SOURCE_IDENTITY.artifactName,
    sourceArtifactHash: CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash, sourceArtifactByteSize: bytes.length,
    sourceRole: "LOCAL_READ_ONLY_FROZEN_SUPERSET", providerTimezoneContext: "America/New_York",
    worksheets: ["Orders", "Appointments", "Order Items", "Payments", "Order Forms"].map((worksheetRole) => ({ worksheetRole, rawRowCount: workbook[worksheetRole]?.length ?? 0 })),
    cutoffDateInclusive: "2026-03-27", reviewedSnapshotHorizonInclusive: "2026-08-02",
    postCutoffWithinHorizonRowCount: withinHorizon.length, cohortMemberCount: 42,
    excludedStatusShapeCount: withinHorizon.length - cohort.length, identityVerified: true,
    privacyStatement: "Only aggregate source shape and non-reversible evidence fingerprints enter review artifacts.",
  };
  const identityProof: CurrentEraCohortIdentityProofV1 = {
    schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraCohortIdentityProofV1",
    sourceArtifactHash: CURRENT_ERA_SOURCE_IDENTITY.sourceArtifactHash,
    selectionLaw: "Reviewed local snapshot horizon; created on or after the accepted cutoff; operationally open, paid, and fulfilled at the reviewed snapshot.",
    cutoffDecision: "ML-D059", exactCohortDecision: "ML-D302", cohortMemberCount: 42,
    membership: listings.map(({ scenarioId, opaqueSourceReferenceHash }) => ({ scenarioId, opaqueSourceReferenceHash })),
    rejectedWithinHorizonShapeCounts: rejectedShapeCounts, rawIdentifiersIncluded: false, forcedMatches: 0,
  };
  return { sourceProfile, identityProof, listings, privateIntakeByScenario };
}

export function selectPilot(listings: readonly CurrentEraNormalizedListingV1[]): CurrentEraPilotSelectionReceiptV1 {
  if (listings.length !== 42) throw new Error("CURRENT_COHORT_MEMBERSHIP_DIVERGENCE: pilot selection requires exactly 42 members");
  const remaining = [...listings]; const covered = new Set<string>();
  const selected: CurrentEraPilotSelectionReceiptV1["selected"][number][] = [];
  while (selected.length < 6) {
    const ranked = remaining.map((listing) => ({ listing, additions: listing.shape.shapeTokens.filter((token) => !covered.has(token)) }))
      .sort((left, right) => right.additions.length - left.additions.length || left.listing.stableSourceRow - right.listing.stableSourceRow);
    const chosen = ranked[0];
    if (!chosen) throw new Error("CURRENT_COHORT_MEMBERSHIP_DIVERGENCE: pilot selection exhausted cohort unexpectedly");
    for (const token of chosen.additions) covered.add(token);
    selected.push({ scenarioId: chosen.listing.scenarioId, stableSourceRow: chosen.listing.stableSourceRow,
      newShapeTokens: [...chosen.additions].sort(), shape: chosen.listing.shape });
    remaining.splice(remaining.findIndex((item) => item.scenarioId === chosen.listing.scenarioId), 1);
  }
  return { schema: CURRENT_SHADOW_SCHEMA, contract: "CurrentEraPilotSelectionReceiptV1",
    method: "GREEDY_MAX_NEW_SHAPE_TOKENS_STABLE_SOURCE_ROW_TIEBREAK", selectedBeforeOutcomeObservation: true,
    pilotSize: 6, selected };
}
