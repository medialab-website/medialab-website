import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expected, observed, type BusinessReplayExpectedAssertionV1, type BusinessReplayScenarioV1,
  type CoverageTagV1, type MismatchClassification, type SourceEvidenceReferenceV1 } from "../business-replay/contracts.js";
import { tag, type BusinessScenarioCoverageMatrixV1 } from "../business-replay/coverage.js";
import { semanticSha256 } from "../business-replay/deterministic-ids.js";
import { runCorpus, type PlatformExecutor } from "../business-replay/runner.js";
import { scanHistoricalPrivacyArtifacts } from "./privacy.js";

export const HISTORICAL_REPLAY_SCHEMA = "ML_HISTORICAL_BUSINESS_REPLAY_V1" as const;
export const CANONICAL_COMPARISON_TIMEZONE = "America/New_York" as const;
export const TARGET_RANGE = Object.freeze({ start: "2024-01-01", end: "2024-12-31", inclusive: true });

export const FROZEN_SOURCES = Object.freeze({
  aryeo: { relativePath: "ARYEO/Orders - Aug 15 2026.xlsx", sha256: "fe7c2f6628d4961c6181d5d00aa3df90e4de9ce5bcd291a02c282f8528f64189", timezone: "America/New_York provider filter context; serialized UTC offset -05:00" },
  stripePayments: { relativePath: "STRIPE/unified_payments.csv", sha256: "d8fe5edb8cd1e15a61fcb6fbdf56a3ccbb550d3964c20818fa99351a16263e9e", timezone: "America/Chicago provider context" },
  stripeBalance: { relativePath: "STRIPE/Balance_Summary_USD_2024-01-01_to_2024-12-31_America-Chicago.csv", sha256: "cff273b34faa88c272d1136c284e143b4f5a3df6c73eaea87c2082166e43004e", timezone: "America/Chicago" },
  quickBooksSales: { relativePath: "QUICKBOOKS/Tri-Cities MediaLab LLC_Sales by Customer Detail.csv", sha256: "bbba69cf113deb6e37c4b6b9fcdd58a52256e5ba55eba94def1ff262952827f0", timezone: "QuickBooks company/report date context; date-only" },
  quickBooksTransactions: { relativePath: "QUICKBOOKS/Tri-Cities MediaLab LLC_Transaction List by Customer.csv", sha256: "7d06accbd55a03dbd1c844cbec02754aaa35bbb49c340dda843e29291ca1be40", timezone: "QuickBooks company/report date context; date-only" },
  manifestJson: { relativePath: "MANIFEST/2024_SOURCE_ACQUISITION_MANIFEST.json", sha256: "fa445beb60e238fadeb972d4f1151181e085e550fe4269ac33f349ffc1271b7a" },
  manifestMarkdown: { relativePath: "MANIFEST/2024_SOURCE_ACQUISITION_MANIFEST.md", sha256: "5ff74d63f1c38cfcf1125df16e71f0ab40c8df130aa06df4192f6922bf50575b" },
});

type Row = Record<string, string> & { __rowNumber: string };
type SourceKey = keyof Pick<typeof FROZEN_SOURCES, "aryeo" | "stripePayments" | "stripeBalance" | "quickBooksSales" | "quickBooksTransactions">;

export interface HistoricalSourceProfileV1 {
  schema: typeof HISTORICAL_REPLAY_SCHEMA;
  contract: "HistoricalSourceProfileV1";
  targetRange: typeof TARGET_RANGE;
  canonicalComparisonTimezone: typeof CANONICAL_COMPARISON_TIMEZONE;
  identityVerified: true;
  rawFiles: { source: string; artifactSha256: string; byteSize: number; rawRowCount: number; inRangeRows?: number; outOfRangeRows?: number; columns: string[]; limitations: string[] }[];
  aggregateFacts: Record<string, number | string | Record<string, number>>;
  privacyStatement: string;
}

export interface HistoricalEvidenceReconciliationV1 {
  schema: typeof HISTORICAL_REPLAY_SCHEMA;
  contract: "HistoricalEvidenceReconciliationV1";
  relationships: { relationship: string; classification: "CONFIRMED" | "PROBABLE" | "AMBIGUOUS" | "CONFLICTING" | "NOT_AVAILABLE"; count: number; evidence: string }[];
  balanceSummaryUsage: "AGGREGATE_FALLBACK_ONLY";
  forcedMatches: 0;
}

const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const normalize = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const count = (values: readonly string[]) => Object.fromEntries([...new Map(values.map((value) => [value, values.filter((item) => item === value).length])).entries()].sort());

function decodeXml(value: string): string {
  return value.replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function zipText(path: string, member: string): string {
  return execFileSync("unzip", ["-p", path, member], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
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
      const attrs = cell[1]!; const body = cell[2]!;
      const reference = attrs.match(/\br="([A-Z]+\d+)"/)?.[1] ?? "A1";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
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
  const targets = new Map([...relationships.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((match) => [match[1]!, match[2]!]));
  const result: Record<string, Row[]> = {};
  for (const sheet of workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = decodeXml(sheet[1]!); const target = targets.get(sheet[2]!);
    if (!target) throw new Error(`HISTORICAL_SOURCE_SCHEMA_DIVERGENCE: missing worksheet target for ${name}`);
    const member = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const matrix = parseWorksheet(zipText(path, member), shared);
    const headers = matrix[0] ?? [];
    result[name] = matrix.slice(1).map((values, index) => Object.assign({ __rowNumber: String(index + 2) },
      Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]))));
  }
  return result;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted && char === '"' && text[index + 1] === '"') { value += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(value); value = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = ""; continue;
    }
    value += char;
  }
  if (value || row.length) { row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); }
  return rows;
}

function rowsFromCsv(matrix: string[][], headerIndex: number): Row[] {
  const headers = matrix[headerIndex]!.map((value) => value.trim());
  return matrix.slice(headerIndex + 1).map((values, index) => Object.assign({ __rowNumber: String(index + headerIndex + 2) },
    Object.fromEntries(headers.map((header, column) => [header || `column_${column + 1}`, values[column] ?? ""]))));
}

function yearFromAryeo(value: string): number | undefined {
  const match = value.match(/^[A-Za-z]{3}, [A-Za-z]{3} \d{1,2} (\d{4}),/);
  return match ? Number(match[1]) : undefined;
}

function statusCounts(rows: readonly Row[], field: string): Record<string, number> {
  return count(rows.map((row) => normalize(row[field]).toUpperCase()).filter(Boolean));
}

function serviceFamilies(value: string): string[] {
  const text = normalize(value); const families: string[] = [];
  if (/(photo|hdr|image|listing media)/.test(text)) families.push("PHOTO");
  if (/(drone|aerial)/.test(text)) families.push("DRONE");
  if (/(video|cinematic|reel|walkthrough)/.test(text)) families.push("VIDEO");
  if (/(floor plan|floorplan|matterport|3d)/.test(text)) families.push("FLOOR_PLAN");
  if (/(land|acreage|lot)/.test(text)) families.push("LAND_ACREAGE");
  if (/(travel|mileage|rural)/.test(text)) families.push("RURAL_TRAVEL");
  return [...new Set(families)];
}

function opaqueReference(source: SourceKey, surface: string, rowNumber: string): string {
  return semanticSha256({ packet: "P02-M16-C", sourceArtifactHash: FROZEN_SOURCES[source].sha256, surface, rowNumber });
}

async function verifyFrozenSources(vaultRoot: string): Promise<Record<keyof typeof FROZEN_SOURCES, { path: string; bytes: Buffer }>> {
  const verified = {} as Record<keyof typeof FROZEN_SOURCES, { path: string; bytes: Buffer }>;
  for (const [key, source] of Object.entries(FROZEN_SOURCES) as [keyof typeof FROZEN_SOURCES, (typeof FROZEN_SOURCES)[keyof typeof FROZEN_SOURCES]][]) {
    const path = join(vaultRoot, source.relativePath); const bytes = await readFile(path);
    if (sha256(bytes) !== source.sha256) throw new Error(`HISTORICAL_SOURCE_IDENTITY_DIVERGENCE: ${key}`);
    verified[key] = { path, bytes };
  }
  return verified;
}

function ensureColumns(surface: string, rows: readonly Row[], required: readonly string[]): void {
  const columns = new Set(Object.keys(rows[0] ?? {}).filter((key) => key !== "__rowNumber"));
  for (const column of required) if (!columns.has(column)) throw new Error(`HISTORICAL_SOURCE_SCHEMA_DIVERGENCE: ${surface}.${column}`);
}

interface NormalizedCorpus {
  profile: HistoricalSourceProfileV1;
  reconciliation: HistoricalEvidenceReconciliationV1;
  scenarios: BusinessReplayScenarioV1[];
}

interface ScenarioSpec {
  suffix: string;
  description: string;
  source: SourceKey;
  surface: string;
  rowNumber: string;
  claims: string[];
  tags: [Parameters<typeof tag>[0], string][];
  historical: string;
  current: string;
  classification?: Exclude<MismatchClassification, "MATCH">;
  mode?: "PLATFORM_EXECUTED" | "CLASSIFIER_ONLY" | "DEFERRED_NOT_EXECUTED";
  platformTemplate?: BusinessReplayScenarioV1["platformExecutionTemplateId"];
}

const baseTags: ScenarioSpec["tags"] = [
  ["customer_type", "AGENCY_MEMBER"], ["customer_tenure", "REPEAT"], ["organization_structure", "AGENCY"],
  ["organization_membership", "ACTIVE_MEMBER"], ["billing_model", "PERSONAL"], ["billing_authority", "AUTHORIZED"],
  ["commercial_ownership", "PERSON"], ["scope_timing", "PRE_PUBLICATION"], ["appointment_complexity", "SINGLE"],
  ["reschedule_condition", "NONE"], ["cancellation_condition", "NONE"], ["travel_condition", "LOCAL"],
  ["payment_evidence", "BOUNDED_ELIGIBLE"], ["delivery_entitlement", "ENTITLED"], ["correction_revision", "NONE"],
  ["quick_edit", "NONE"], ["multi_order_day", "SINGLE_ORDER"], ["source_conflict", "NONE"], ["data_quality", "CLEAR"],
  ["intentional_policy_change", "NONE"], ["deferred_capability", "NONE"], ["addon_family", "NONE"],
] as ScenarioSpec["tags"];

function scenarioEvidence(spec: ScenarioSpec): SourceEvidenceReferenceV1 {
  return { sourceSystemType: spec.source === "aryeo" ? "ARYEO" : spec.source.startsWith("stripe") ? "STRIPE" : "QUICKBOOKS",
    sourceRecordType: "NORMALIZED_HISTORICAL_EVIDENCE", opaqueSourceReferenceHash: opaqueReference(spec.source, spec.surface, spec.rowNumber),
    sourceArtifactHash: FROZEN_SOURCES[spec.source].sha256, observedAt: "2024-12-31T23:59:59.000Z",
    evidenceConfidence: spec.classification === "AMBIGUOUS_EVIDENCE" ? "LOW" : spec.classification === "SOURCE_CONFLICT" ? "MEDIUM" : "HIGH",
    ambiguityOrConflict: spec.classification === "AMBIGUOUS_EVIDENCE" || spec.classification === "SOURCE_CONFLICT",
    syntheticEvidenceRoleLabel: true, fieldClaims: spec.claims };
}

function platformAssertions(template: BusinessReplayScenarioV1["platformExecutionTemplateId"]): BusinessReplayExpectedAssertionV1[] {
  if (template === "M16B_PLATFORM_BASELINE_QUICK_EDIT_V1") return [
    { field: "comparisonPass", expected: true, reason: "Current R71 operational path is expected to complete" },
    { field: "originals", expected: 6, reason: "Accepted deterministic Platform fixture" },
    { field: "selected", expected: 5, reason: "Accepted deterministic Platform fixture" },
    { field: "finalVersions", expected: 5, reason: "Accepted deterministic Platform fixture" },
    { field: "exactDownloads", expected: 2, reason: "Accepted exact-byte delivery proof" },
  ];
  throw new Error("unsupported historical Platform template");
}

function buildScenario(spec: ScenarioSpec): BusinessReplayScenarioV1 {
  const coverage = [...new Map([...baseTags, ...spec.tags].map(([dimension, caseName]) => [`${dimension}:${caseName}`, tag(dimension, caseName)])).values()];
  const mode = spec.mode ?? "CLASSIFIER_ONLY";
  return { schema: "ML_BUSINESS_REPLAY_V1", contract: "BusinessReplayScenarioV1", scenarioId: `M16C_HISTORICAL_${spec.suffix}_V1`, scenarioVersion: 1,
    lane: "REAL_ESTATE_MEDIA", provenanceClassification: "HISTORICAL_NORMALIZED", policyBaseline: "R71",
    syntheticReferenceDate: "2024-06-15T16:00:00.000Z", fixtureNamespace: `M16C_HISTORICAL_NORMALIZED_${spec.suffix}`,
    description: spec.description, scenarioTags: coverage.map((item) => `${item.dimension}:${item.case}`).sort(), executionMode: mode,
    platformExecutionTemplateId: spec.platformTemplate, evidence: [scenarioEvidence(spec)],
    actorsAndAuthority: { identity: "TOKENIZED_HISTORICAL_ACTOR", authorityClaim: "PROVIDER_NEUTRAL_ONLY" },
    commercialFacts: { currency: "USD", priceEvidence: spec.suffix.includes("PRICE_") ? "BUCKET_ONLY" : "NOT_DISCLOSED" },
    schedulingAndOperations: { referenceClock: "2024-06-15T16:00:00.000Z", networkRetrievalIntent: false, canonicalComparisonTimezone: CANONICAL_COMPARISON_TIMEZONE },
    financialAndDeliveryFacts: { transactionValuesDisclosed: false, processorSettlement: spec.suffix.includes("STRIPE") ? "NOT_AVAILABLE" : "NOT_CLAIMED" },
    historicallyObservedOutcome: { status: spec.classification === "AMBIGUOUS_EVIDENCE" ? "UNCERTAIN" : "NORMALIZED_OBSERVED",
      fields: [{ field: "historicalDisposition", value: spec.historical, source: "HARNESS_OBSERVED" }] },
    currentIntendedPolicyOutcome: { disposition: spec.current },
    expectedR71Outcome: expected(spec.platformTemplate ? platformAssertions(spec.platformTemplate) : [
      { field: "currentPolicyDisposition", expected: spec.current, mismatchClassification: spec.classification, reason: "Independently authored from accepted R71 business law and normalized source confidence" },
    ]),
    syntheticObservedOutcome: spec.platformTemplate ? undefined : observed([
      { field: "currentPolicyDisposition", value: spec.classification ? spec.historical : spec.current,
        source: mode === "DEFERRED_NOT_EXECUTED" ? "DEFERRED" : "HARNESS_OBSERVED" },
    ]), intentionalDifferences: spec.classification === "INTENTIONAL_POLICY_CHANGE" ? ["Current provider-neutral authority intentionally differs from historical provider-operated evidence"] : [],
    ambiguities: spec.classification === "AMBIGUOUS_EVIDENCE" ? ["Available sources cannot prove one cross-source relationship"] : [], coverage };
}

function first(rows: readonly Row[], predicate: (row: Row) => boolean = () => true): Row {
  const row = rows.find(predicate); if (!row) throw new Error("HISTORICAL_SOURCE_SCHEMA_DIVERGENCE: required coverage class absent"); return row;
}

function numberValue(value: string): number { const parsed = Number(value.replace(/[^0-9.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }

function selectScenarios(orders2024: readonly Row[], appointments2024: readonly Row[], items2024: readonly Row[], payments2024: readonly Row[],
  qbSales: readonly Row[], qbTransactions: readonly Row[], stripePaymentRows: readonly Row[], outOfRangeCount: number): BusinessReplayScenarioV1[] {
  const itemFamilies = new Map<string, Set<string>>();
  for (const item of items2024) {
    const key = normalize(item["Order Number"]); const set = itemFamilies.get(key) ?? new Set<string>();
    for (const family of serviceFamilies(item.Item)) set.add(family); itemFamilies.set(key, set);
  }
  const byOrderAppointments = new Map<string, Row[]>();
  for (const appointment of appointments2024) { const key = normalize(appointment["Order Number"]); byOrderAppointments.set(key, [...(byOrderAppointments.get(key) ?? []), appointment]); }
  const customerCounts = count(orders2024.map((row) => normalize(row.Customer)));
  const createdDayCounts = count(orders2024.map((row) => row["Created At"].match(/^[A-Za-z]{3}, ([A-Za-z]{3} \d{1,2} \d{4}),/)?.[1] ?? "UNKNOWN"));
  const totals = orders2024.map((row) => numberValue(row.Total)).sort((a, b) => a - b); const median = totals[Math.floor(totals.length / 2)] ?? 0;
  const withFamily = (family: string) => first(items2024, (row) => serviceFamilies(row.Item).includes(family));
  const normal = first(orders2024, (row) => normalize(row.Status) === "open" && normalize(row["Payment Status"]) === "paid" && normalize(row["Fulfillment Status"]) === "fulfilled");
  const multi = first(appointments2024, (row) => (byOrderAppointments.get(normalize(row["Order Number"]))?.length ?? 0) > 1);
  const qbInvoice = first(qbSales, (row) => normalize(row["Transaction type"]) === "invoice");
  const qbPayment = first(qbTransactions, (row) => ["payment", "deposit"].includes(normalize(row["Transaction type"])));
  const specs: ScenarioSpec[] = [
    { suffix: "FULFILLED_PAID_BASELINE", description: "In-range fulfilled and paid media order exercised against the current complete Platform path", source: "aryeo", surface: "Orders", rowNumber: normal.__rowNumber, claims: ["fulfilled", "paid", "in-range"], historical: "FULFILLED_PAID", current: "FULFILLED_PAID", mode: "PLATFORM_EXECUTED", platformTemplate: "M16B_PLATFORM_BASELINE_QUICK_EDIT_V1", tags: [["package_family","PHOTO_VIDEO"],["service_workstream_family","PHOTO"],["service_workstream_family","VIDEO"]] },
    { suffix: "PHOTO_DRONE", description: "In-range order containing photo and drone service evidence", source: "aryeo", surface: "Order Items", rowNumber: withFamily("DRONE").__rowNumber, claims: ["photo-drone composition"], historical: "SUPPORTED", current: "SUPPORTED", tags: [["package_family","PHOTO_DRONE"],["service_workstream_family","PHOTO"],["service_workstream_family","DRONE"],["addon_family","DRONE"]] },
    { suffix: "PHOTO_VIDEO", description: "In-range order containing video service evidence", source: "aryeo", surface: "Order Items", rowNumber: withFamily("VIDEO").__rowNumber, claims: ["photo-video composition"], historical: "SUPPORTED", current: "SUPPORTED", tags: [["package_family","PHOTO_VIDEO"],["service_workstream_family","PHOTO"],["service_workstream_family","VIDEO"]] },
    { suffix: "PHOTO_ONLY", description: "In-range order without normalized drone, video, land, or floor-plan family evidence", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => { const set=itemFamilies.get(normalize(row.Number)) ?? new Set(); return set.has("PHOTO") && !["DRONE","VIDEO","LAND_ACREAGE","FLOOR_PLAN"].some((family)=>set.has(family)); }).__rowNumber, claims: ["photo-only bounded package"], historical: "SUPPORTED", current: "SUPPORTED", tags: [["package_family","PHOTO_ONLY"],["service_workstream_family","PHOTO"]] },
    { suffix: "LAND_RURAL", description: "In-range land or acreage evidence with rural-travel relevance", source: "aryeo", surface: "Order Items", rowNumber: withFamily("LAND_ACREAGE").__rowNumber, claims: ["land-acreage", "rural-travel relevance"], historical: "SUPPORTED", current: "SUPPORTED", tags: [["package_family","LAND_ACREAGE"],["service_workstream_family","PHOTO"],["travel_condition","RURAL_TRAVEL"]] },
    { suffix: "FLOOR_PLAN_ADDON", description: "In-range floor-plan service evidence", source: "aryeo", surface: "Order Items", rowNumber: withFamily("FLOOR_PLAN").__rowNumber, claims: ["floor-plan workstream"], historical: "SUPPORTED", current: "SUPPORTED", tags: [["package_family","PHOTO_ONLY"],["service_workstream_family","FLOOR_PLAN"],["addon_family","FLOOR_PLAN"]] },
    { suffix: "TEAM_ASSOCIATED", description: "In-range customer-team association retained only as provider-neutral membership evidence", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => Boolean(row["Customer Team ID"])).__rowNumber, claims: ["team association present"], historical: "AGENCY_CONTEXT", current: "AGENCY_CONTEXT", tags: [["customer_type","AGENCY_MEMBER"],["organization_structure","AGENCY"],["organization_membership","ACTIVE_MEMBER"]] },
    { suffix: "INDEPENDENT_CUSTOMER", description: "In-range order without customer-team association", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => !row["Customer Team ID"]).__rowNumber, claims: ["no team association"], historical: "INDEPENDENT", current: "INDEPENDENT", tags: [["customer_type","INDEPENDENT_AGENT"],["organization_structure","INDIVIDUAL"],["organization_membership","NONE"]] },
    { suffix: "REPEAT_CUSTOMER", description: "Multiple in-range orders share one locally normalized customer identity", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => (customerCounts[normalize(row.Customer)] ?? 0) > 1).__rowNumber, claims: ["repeat relationship"], historical: "REPEAT", current: "REPEAT", tags: [["customer_tenure","REPEAT"]] },
    { suffix: "MULTI_ORDER_DAY", description: "Multiple in-range orders were created on one source-local day", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => (createdDayCounts[row["Created At"].match(/^[A-Za-z]{3}, ([A-Za-z]{3} \d{1,2} \d{4}),/)?.[1] ?? "UNKNOWN"] ?? 0) > 1).__rowNumber, claims: ["multiple orders same source-local day"], historical: "MULTIPLE_ORDERS", current: "MULTIPLE_ORDERS", tags: [["multi_order_day","MULTIPLE_ORDERS"]] },
    { suffix: "MULTIPLE_APPOINTMENTS", description: "One in-range order carries multiple appointment rows without inferring reschedule", source: "aryeo", surface: "Appointments", rowNumber: multi.__rowNumber, claims: ["multiple appointments", "reschedule not inferred"], historical: "MULTIPLE_APPOINTMENTS", current: "MULTIPLE_APPOINTMENTS", tags: [["appointment_complexity","MULTIPLE"]] },
    { suffix: "COUPON", description: "In-range order contains coupon or promotion evidence without exposing code or value", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => Boolean(row["Coupons/Promo Codes"])).__rowNumber, claims: ["coupon present"], historical: "DISCOUNT_EVIDENCE", current: "DISCOUNT_EVIDENCE", tags: [["pricing_tier","BELOW_BOUNDARY"]] },
    { suffix: "CANCELED_UNFULFILLED", description: "In-range canceled or unfulfilled order remains delivery-withheld", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => normalize(row.Status) === "canceled" || normalize(row["Fulfillment Status"]) === "unfulfilled").__rowNumber, claims: ["canceled or unfulfilled"], historical: "WITHHELD", current: "WITHHELD", tags: [["cancellation_condition","CANCELLED_OR_UNABLE"],["delivery_entitlement","WITHHELD"]] },
    { suffix: "PRICE_BELOW_MEDIAN_BUCKET", description: "In-range total falls below the corpus median; raw value is not retained", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => numberValue(row.Total) < median).__rowNumber, claims: ["below median price bucket"], historical: "BELOW_BUCKET", current: "BELOW_BUCKET", tags: [["pricing_tier","BELOW_BOUNDARY"]] },
    { suffix: "PRICE_AT_OR_ABOVE_MEDIAN_BUCKET", description: "In-range total is at or above the corpus median; raw value is not retained", source: "aryeo", surface: "Orders", rowNumber: first(orders2024, (row) => numberValue(row.Total) >= median).__rowNumber, claims: ["at-or-above median price bucket"], historical: "AT_OR_ABOVE_BUCKET", current: "AT_OR_ABOVE_BUCKET", tags: [["pricing_tier","AT_OR_ABOVE_BOUNDARY"]] },
    { suffix: "ACCOUNTING_SALES_RECEIPT", description: "Date-only accounting sales-receipt evidence preserves accounting date semantics", source: "quickBooksSales", surface: "SalesByCustomerDetail", rowNumber: first(qbSales, (row) => normalize(row["Transaction type"]) === "sales receipt").__rowNumber, claims: ["sales receipt", "date-only"], historical: "ACCOUNTING_EVIDENCE", current: "ACCOUNTING_EVIDENCE", tags: [["payment_evidence","BOUNDED_ELIGIBLE"]] },
    { suffix: "ACCOUNTING_INVOICE", description: "Date-only accounting invoice evidence does not invent processor settlement", source: "quickBooksSales", surface: "SalesByCustomerDetail", rowNumber: qbInvoice.__rowNumber, claims: ["invoice", "date-only"], historical: "INVOICE_EVIDENCE", current: "INVOICE_EVIDENCE", tags: [["payment_evidence","INCOMPLETE"],["delivery_entitlement","WITHHELD"]] },
    { suffix: "ACCOUNTING_PAYMENT_DEPOSIT", description: "Accounting payment or deposit evidence remains separate from processor settlement", source: "quickBooksTransactions", surface: "TransactionListByCustomer", rowNumber: qbPayment.__rowNumber, claims: ["payment-or-deposit", "date-only"], historical: "ACCOUNTING_PAYMENT_EVIDENCE", current: "ACCOUNTING_PAYMENT_EVIDENCE", tags: [["payment_evidence","BOUNDED_ELIGIBLE"]] },
    { suffix: "STRIPE_ITEMIZED_UNAVAILABLE", description: "Collected itemized processor export has zero rows; aggregate balance evidence is not substituted", source: "stripePayments", surface: "Payments", rowNumber: "1", claims: ["zero itemized rows", "aggregate fallback excluded from row-level use"], historical: "NOT_AVAILABLE", current: "ITEMIZED_RECONCILIATION", classification: "DEFERRED_CAPABILITY", mode: "DEFERRED_NOT_EXECUTED", tags: [["payment_evidence","PROCESSOR_DEFERRED"],["deferred_capability","PROCESSOR_SETTLEMENT"]] },
    { suffix: "CROSS_SOURCE_AMBIGUOUS", description: "No shared order or transaction number supports a silent Aryeo-to-accounting match", source: "quickBooksTransactions", surface: "TransactionListByCustomer", rowNumber: qbTransactions[0]?.__rowNumber ?? "2", claims: ["no shared transaction key", "match not forced"], historical: "AMBIGUOUS", current: "CONFIRMED", classification: "AMBIGUOUS_EVIDENCE", tags: [["data_quality","AMBIGUOUS"]] },
    { suffix: "ARYEO_RANGE_CONFLICT", description: "Raw export contains out-of-range rows despite the requested 2024 provider filter", source: "aryeo", surface: "Orders", rowNumber: orders2024[0]!.__rowNumber, claims: [`out-of-range row count ${outOfRangeCount}`, "2024 subset only drives scenarios"], historical: "MIXED_RANGE", current: "IN_RANGE_ONLY", classification: "SOURCE_CONFLICT", tags: [["source_conflict","CONFLICT"],["data_quality","AMBIGUOUS"]] },
    { suffix: "PROVIDER_NEUTRAL_POLICY", description: "Historical provider-operated payment evidence maps to current provider-neutral authority", source: "aryeo", surface: "Payments", rowNumber: payments2024[0]!.__rowNumber, claims: ["provider-operated historical payment role"], historical: "EXTERNAL_PROVIDER_OPERATED", current: "PLATFORM_PROVIDER_NEUTRAL", classification: "INTENTIONAL_POLICY_CHANGE", tags: [["intentional_policy_change","PRESENT"]] },
  ];
  if (stripePaymentRows.length !== 0) throw new Error("HISTORICAL_SOURCE_SCHEMA_DIVERGENCE: Stripe itemized row expectation changed");
  return specs.map(buildScenario).sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

export async function normalizeHistoricalCorpus(vaultRoot: string): Promise<NormalizedCorpus> {
  const verified = await verifyFrozenSources(vaultRoot);
  const workbook = parseXlsx(verified.aryeo.path);
  const orders = workbook.Orders ?? []; const appointments = workbook.Appointments ?? []; const items = workbook["Order Items"] ?? []; const payments = workbook.Payments ?? [];
  ensureColumns("Orders", orders, ["Number","Customer","Customer Team ID","Status","Payment Status","Fulfillment Status","Created At","Total","Coupons/Promo Codes"]);
  ensureColumns("Appointments", appointments, ["Order Number","Appointment Date","Has Been Rescheduled","Has Been Postponed"]);
  ensureColumns("Order Items", items, ["Order Number","Item"]); ensureColumns("Payments", payments, ["Order Number","Payment Type"]);

  const stripePaymentMatrix = parseCsv(verified.stripePayments.bytes.toString("utf8"));
  const stripeBalanceMatrix = parseCsv(verified.stripeBalance.bytes.toString("utf8"));
  const qbSalesMatrix = parseCsv(verified.quickBooksSales.bytes.toString("utf8"));
  const qbTransactionMatrix = parseCsv(verified.quickBooksTransactions.bytes.toString("utf8"));
  const stripePaymentRows = rowsFromCsv(stripePaymentMatrix, 0);
  const stripeBalanceRows = rowsFromCsv(stripeBalanceMatrix, 0);
  const qbSales = rowsFromCsv(qbSalesMatrix, 3).filter((row) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(row["Transaction date"] ?? ""));
  const qbTransactions = rowsFromCsv(qbTransactionMatrix, 0).filter((row) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(row.Date ?? ""));
  ensureColumns("Stripe Payments", stripePaymentRows.length ? stripePaymentRows : [{ __rowNumber: "1", ...Object.fromEntries((stripePaymentMatrix[0] ?? []).map((column) => [column, ""])) }], ["id","Created date (UTC)","Amount","Status"]);
  ensureColumns("Stripe Balance Summary", stripeBalanceRows, ["category","description","net_amount","currency"]);
  ensureColumns("QuickBooks Sales", qbSales, ["Transaction date","Transaction type","Num","Amount"]);
  ensureColumns("QuickBooks Transactions", qbTransactions, ["Date","Transaction type","Num","Amount"]);

  const orders2024 = orders.filter((row) => yearFromAryeo(row["Created At"]) === 2024);
  const orderNumbers = new Set(orders2024.map((row) => normalize(row.Number)));
  const appointments2024 = appointments.filter((row) => orderNumbers.has(normalize(row["Order Number"])));
  const items2024 = items.filter((row) => orderNumbers.has(normalize(row["Order Number"])));
  const payments2024 = payments.filter((row) => orderNumbers.has(normalize(row["Order Number"])));
  if (!orders2024.length || !appointments2024.length || !items2024.length || !payments2024.length) throw new Error("HISTORICAL_SOURCE_SCHEMA_DIVERGENCE: empty in-range relational surface");
  const outside = orders.length - orders2024.length;

  const families = items2024.flatMap((row) => serviceFamilies(row.Item));
  const profile: HistoricalSourceProfileV1 = { schema: HISTORICAL_REPLAY_SCHEMA, contract: "HistoricalSourceProfileV1", targetRange: TARGET_RANGE,
    canonicalComparisonTimezone: CANONICAL_COMPARISON_TIMEZONE, identityVerified: true,
    rawFiles: [
      { source: "ORDER_OPERATIONS_EXPORT", artifactSha256: FROZEN_SOURCES.aryeo.sha256, byteSize: verified.aryeo.bytes.length, rawRowCount: orders.length,
        inRangeRows: orders2024.length, outOfRangeRows: outside, columns: Object.keys(orders[0]!).filter((key) => key !== "__rowNumber"), limitations: ["Provider export includes rows outside requested range; only source-local 2024 rows drive scenarios"] },
      { source: "PROCESSOR_PAYMENTS_EXPORT", artifactSha256: FROZEN_SOURCES.stripePayments.sha256, byteSize: verified.stripePayments.bytes.length, rawRowCount: stripePaymentRows.length,
        columns: stripePaymentMatrix[0] ?? [], limitations: ["Header-only export; no itemized rows available"] },
      { source: "PROCESSOR_BALANCE_SUMMARY", artifactSha256: FROZEN_SOURCES.stripeBalance.sha256, byteSize: verified.stripeBalance.bytes.length, rawRowCount: stripeBalanceRows.length,
        columns: stripeBalanceMatrix[0] ?? [], limitations: ["Aggregate fallback only; never itemized transaction evidence"] },
      { source: "ACCOUNTING_SALES_DETAIL", artifactSha256: FROZEN_SOURCES.quickBooksSales.sha256, byteSize: verified.quickBooksSales.bytes.length, rawRowCount: qbSales.length,
        columns: qbSalesMatrix[3] ?? [], limitations: ["Date-only accounting semantics; customer values tokenized and omitted"] },
      { source: "ACCOUNTING_TRANSACTION_LIST", artifactSha256: FROZEN_SOURCES.quickBooksTransactions.sha256, byteSize: verified.quickBooksTransactions.bytes.length, rawRowCount: qbTransactions.length,
        columns: qbTransactionMatrix[0] ?? [], limitations: ["Date-only accounting semantics; customer values tokenized and omitted"] },
    ],
    aggregateFacts: { inRangeOrders: orders2024.length, inRangeAppointments: appointments2024.length, inRangeOrderItems: items2024.length,
      inRangePayments: payments2024.length, outOfRangeOperationalRows: outside, operationalStatusCounts: statusCounts(orders2024, "Status"),
      paymentStatusCounts: statusCounts(orders2024, "Payment Status"), fulfillmentStatusCounts: statusCounts(orders2024, "Fulfillment Status"),
      serviceFamilyCounts: count(families), accountingSalesRows: qbSales.length, accountingTransactionRows: qbTransactions.length,
      itemizedProcessorRows: stripePaymentRows.length, balanceSummaryRows: stripeBalanceRows.length },
    privacyStatement: "Only aggregate counts, schema labels, source hashes, and opaque row references are retained; names, contacts, addresses, provider IDs, notes, descriptions, and transaction values are excluded." };

  const orderNumbersQb = new Set([...qbSales, ...qbTransactions].map((row) => normalize(row.Num)).filter(Boolean));
  const shared = [...orderNumbers].filter((value) => orderNumbersQb.has(value)).length;
  const reconciliation: HistoricalEvidenceReconciliationV1 = { schema: HISTORICAL_REPLAY_SCHEMA, contract: "HistoricalEvidenceReconciliationV1",
    relationships: [
      { relationship: "operational orders to appointments/items/payments", classification: "CONFIRMED", count: orders2024.length, evidence: "source-native shared order keys inside one frozen artifact" },
      { relationship: "operational orders to accounting transactions", classification: shared ? "PROBABLE" : "AMBIGUOUS", count: shared, evidence: shared ? "shared normalized transaction numbers; amounts and identity not silently asserted" : "no shared normalized transaction number; no match forced" },
      { relationship: "processor itemized payment evidence", classification: "NOT_AVAILABLE", count: stripePaymentRows.length, evidence: "header-only collected export" },
      { relationship: "requested range to operational export rows", classification: outside ? "CONFLICTING" : "CONFIRMED", count: outside, evidence: "requested 2024 filter conflicts with out-of-range source-local years" },
      { relationship: "balance summary to individual payments", classification: "NOT_AVAILABLE", count: 0, evidence: "aggregate fallback is prohibited from itemized use" },
    ], balanceSummaryUsage: "AGGREGATE_FALLBACK_ONLY", forcedMatches: 0 };
  const scenarios = selectScenarios(orders2024, appointments2024, items2024, payments2024, qbSales, qbTransactions, stripePaymentRows, outside);
  if (scenarios.length < 18) throw new Error("HISTORICAL_SOURCE_SCHEMA_DIVERGENCE: fewer than 18 supported scenario classes");
  return { profile, reconciliation, scenarios };
}

function coverageMarkdown(coverage: BusinessScenarioCoverageMatrixV1): string {
  return ["# Historical Scenario Coverage Matrix", "", `Scenarios: ${new Set(coverage.cells.flatMap((cell) => cell.representedBy)).size}`,
    `Dimensions: ${coverage.dimensions.length}`, `Represented catalog cases: ${coverage.representedCases}`, `Unrepresented catalog cases: ${coverage.unrepresentedCases.length}`, "",
    "| Dimension | Case | Represented by | Platform-executed | Classifier-only | Deferred |", "|---|---|---|---|---|---|",
    ...coverage.cells.map((cell) => `| ${cell.dimension} | ${cell.case} | ${cell.representedBy.join(", ") || "—"} | ${cell.platformExecutedBy.join(", ") || "—"} | ${cell.classifierOnlyBy.join(", ") || "—"} | ${cell.deferredNotExecutedBy.join(", ") || "—"} |`),
    "", "The deterministic greedy represented set is a planning aid and makes no global-optimality claim.", ""].join("\n");
}

function safe(value: unknown): string { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

function reportHtml(profile: HistoricalSourceProfileV1, reconciliation: HistoricalEvidenceReconciliationV1, scenarios: readonly BusinessReplayScenarioV1[],
  results: Awaited<ReturnType<typeof runCorpus>>["results"], coverage: BusinessScenarioCoverageMatrixV1, semanticHash: string): string {
  const classes = results.map((result) => { const scenario = scenarios.find((item) => item.scenarioId === result.scenarioId)!;
    return `<article><header><h2>${safe(scenario.description)}</h2><span>${safe(result.executionMode)}</span></header><p><b>${safe(result.scenarioClassification)}</b></p><p>Evidence: ${safe(scenario.evidence[0]!.opaqueSourceReferenceHash)}</p></article>`; }).join("");
  const relationships = reconciliation.relationships.map((item) => `<tr><td>${safe(item.relationship)}</td><td>${safe(item.classification)}</td><td>${item.count}</td><td>${safe(item.evidence)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Historical Business Replay Report</title><style>body{margin:0;background:#f5f4f0;color:#17202a;font:16px system-ui}.wrap{max-width:1120px;margin:auto;padding:28px}.hero{background:#173f5f;color:white;padding:24px;border-radius:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.fact,article{background:white;border:1px solid #d8d5cd;border-radius:12px;padding:16px}article header{display:flex;gap:16px;justify-content:space-between}article span{font-size:12px;background:#e9eef2;padding:6px;border-radius:999px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:8px;border:1px solid #d8d5cd;text-align:left}code{word-break:break-all}</style></head><body><main class="wrap"><section class="hero"><h1>2024 Historical Business Replay</h1><p>Sanitized, provider-neutral, nonproduction evidence. No raw customer rows or direct identifiers are present.</p></section><section class="grid"><p class="fact"><b>In-range orders</b><br>${profile.aggregateFacts.inRangeOrders}</p><p class="fact"><b>Scenario classes</b><br>${scenarios.length}</p><p class="fact"><b>Platform-backed</b><br>${results.filter((item) => item.executionMode === "PLATFORM_EXECUTED").length}</p><p class="fact"><b>Semantic SHA-256</b><br><code>${safe(semanticHash)}</code></p></section><h2>What the sources can and cannot prove</h2><table><thead><tr><th>Relationship</th><th>Confidence</th><th>Count</th><th>Reason</th></tr></thead><tbody>${relationships}</tbody></table><p><b>Stripe limitation:</b> the collected Payments export contains zero itemized rows. The Balance Summary is aggregate fallback evidence only and was never used as transaction-level evidence.</p><p><b>Range limitation:</b> the exact operational export contains ${profile.aggregateFacts.outOfRangeOperationalRows} rows outside the requested 2024 range. Those rows are reported as conflicting source evidence and excluded from scenario facts.</p><h2>Replay classes</h2>${classes}<h2>Coverage</h2><p>${coverage.representedCases} catalog cases represented across ${coverage.dimensions.length} dimensions. Coverage is curated, not statistically representative.</p><h2>Gap outcome</h2><p>No implementation or canonical-schema gap was asserted. Deferred processor settlement and ambiguous cross-source linkage remain explicit evidence limitations.</p></main></body></html>`;
}

export async function runHistoricalReplay(vaultRoot: string, outputRoot: string, platformExecutor?: PlatformExecutor) {
  const normalized = await normalizeHistoricalCorpus(vaultRoot);
  const corpus = await runCorpus(normalized.scenarios, outputRoot, platformExecutor);
  await mkdir(join(outputRoot, "scenarios"), { recursive: true });
  for (const scenario of corpus.scenarios) await writeFile(join(outputRoot, "scenarios", `${scenario.scenarioId}.json`), json(scenario));
  const classificationSummary = Object.fromEntries([...new Set(corpus.results.map((item) => item.scenarioClassification))].sort().map((classification) =>
    [classification, corpus.results.filter((item) => item.scenarioClassification === classification).length]));
  const gapRegister = { schema: HISTORICAL_REPLAY_SCHEMA, contract: "HistoricalGapRegisterV1", implementationGaps: [], canonicalSchemaGaps: [],
    deferredCapabilities: corpus.results.filter((item) => item.scenarioClassification === "DEFERRED_CAPABILITY").map((item) => item.scenarioId),
    ambiguousEvidence: corpus.results.filter((item) => item.scenarioClassification === "AMBIGUOUS_EVIDENCE").map((item) => item.scenarioId),
    sourceConflicts: corpus.results.filter((item) => item.scenarioClassification === "SOURCE_CONFLICT").map((item) => item.scenarioId) };
  const summary = ["# 2024 Historical Business Replay Summary", "", "Sanitized provider-neutral nonproduction evidence only.", "",
    `- Scenario classes: ${corpus.scenarios.length}`, `- Platform-backed executions: ${corpus.results.filter((item) => item.executionMode === "PLATFORM_EXECUTED").length}`,
    `- Semantic SHA-256: \`${corpus.semanticOutcomeSha256}\``, `- Classifications: ${JSON.stringify(classificationSummary)}`, "",
    "The Stripe Payments export is header-only. The Balance Summary is aggregate fallback evidence only and never itemized.",
    "The operational export contains out-of-range rows; they are classified as conflicting evidence and excluded from 2024 scenario facts.",
    "No implementation or canonical-schema gap was asserted. This curated set is not statistically representative of 2024.", ""].join("\n");
  await Promise.all([
    writeFile(join(outputRoot, "HISTORICAL_SOURCE_PROFILE.json"), json(normalized.profile)),
    writeFile(join(outputRoot, "HISTORICAL_NORMALIZATION_MAP.md"), ["# Historical Normalization Map", "", "Raw vault -> normalized provider-neutral evidence -> sanitized replay scenarios.", "",
      `Canonical comparison timezone for timestamps: \`${CANONICAL_COMPARISON_TIMEZONE}\`.`, "QuickBooks values remain date-only. Raw temporal strings are not emitted; opaque row references preserve traceability.",
      "Customer identity is normalized only in local process memory and never emitted. Provider IDs, names, contacts, addresses, notes, URLs, descriptions, and transaction values are excluded.",
      "Only CONFIRMED evidence may silently drive an expected historical fact. PROBABLE/AMBIGUOUS/CONFLICTING/NOT_AVAILABLE remain explicit.", ""].join("\n")),
    writeFile(join(outputRoot, "HISTORICAL_EVIDENCE_RECONCILIATION.json"), json(normalized.reconciliation)),
    writeFile(join(outputRoot, "HISTORICAL_REPLAY_SCENARIO_INDEX.json"), json({ schema: HISTORICAL_REPLAY_SCHEMA, contract: "HistoricalReplayScenarioIndexV1", scenarioIds: corpus.scenarios.map((item) => item.scenarioId) })),
    writeFile(join(outputRoot, "HISTORICAL_SCENARIO_COVERAGE_MATRIX.json"), json(corpus.coverage)),
    writeFile(join(outputRoot, "HISTORICAL_SCENARIO_COVERAGE_MATRIX.md"), coverageMarkdown(corpus.coverage)),
    writeFile(join(outputRoot, "HISTORICAL_REPLAY_RESULTS.json"), json({ schema: HISTORICAL_REPLAY_SCHEMA, contract: "HistoricalReplayResultsV1", platformCommit: "f845f71c23bbd18af31b6655b0255b54fa956cda", results: corpus.results })),
    writeFile(join(outputRoot, "HISTORICAL_CLASSIFICATION_SUMMARY.json"), json({ schema: HISTORICAL_REPLAY_SCHEMA, contract: "HistoricalClassificationSummaryV1", classifications: classificationSummary })),
    writeFile(join(outputRoot, "HISTORICAL_GAP_REGISTER.json"), json(gapRegister)),
    writeFile(join(outputRoot, "HISTORICAL_BUSINESS_REPLAY_REPORT.html"), reportHtml(normalized.profile, normalized.reconciliation, corpus.scenarios, corpus.results, corpus.coverage, corpus.semanticOutcomeSha256)),
    writeFile(join(outputRoot, "HISTORICAL_BUSINESS_REPLAY_SUMMARY.md"), summary),
    writeFile(join(outputRoot, "HISTORICAL_REPLAY_SEMANTIC_SHA256.txt"), `${corpus.semanticOutcomeSha256}\n`),
  ]);
  const privacy = await scanHistoricalPrivacyArtifacts(outputRoot);
  if (privacy.hits.length !== 0 || Object.values(privacy.checks).some((passed) => !passed)) throw new Error("HISTORICAL_PRIVACY_BOUNDARY_FAILURE");
  await verifyFrozenSources(vaultRoot);
  await writeFile(join(outputRoot, "HISTORICAL_PRIVACY_SANITIZATION_SCAN.json"), json({ schema: HISTORICAL_REPLAY_SCHEMA,
    contract: "HistoricalPrivacySanitizationScanV1", checks: privacy.checks, hitCount: privacy.hits.length,
    scannedArtifactCount: privacy.scannedArtifactCount, validatedCanonicalHashValueCount: privacy.validatedCanonicalHashValueCount,
    rawHashesReverifiedAfterRun: true, rawUploads: 0, providerNetworkCalls: 0, productionTargets: 0, currentEraCohortAccesses: 0 }));
  return { ...corpus, profile: normalized.profile, reconciliation: normalized.reconciliation, classificationSummary, gapRegister };
}
