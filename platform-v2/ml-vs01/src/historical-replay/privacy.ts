import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

export type HistoricalPrivacyRule =
  | "DIRECT_EMAIL"
  | "PHONE_LIKE"
  | "EXTERNAL_PATH"
  | "CREDENTIAL_MATERIAL"
  | "PROVIDER_ID_LIKE"
  | "TRANSACTION_VALUE";

export interface HistoricalPrivacyHitV1 {
  artifactRelativePath: string;
  artifactType: "HTML" | "JSON" | "MARKDOWN" | "TEXT";
  structuralLocation: string;
  rule: HistoricalPrivacyRule;
  matchedValueSha256: string;
}

export interface HistoricalPrivacyScanV1 {
  checks: {
    directEmailAbsent: boolean;
    phoneAbsent: boolean;
    externalPathAbsent: boolean;
    credentialMaterialAbsent: boolean;
    rawProviderIdentifierKeyAbsent: boolean;
    transactionValuesAbsent: boolean;
  };
  hits: HistoricalPrivacyHitV1[];
  scannedArtifactCount: number;
  validatedCanonicalHashValueCount: number;
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?1[-. (]*)?\d{3}[-. )]*\d{3}[-. ]*\d{4}/g;
const EXTERNAL_PATH = /(?:\/Users\/|\/home\/|file:\/\/|[A-Za-z]:\\)/g;
const CREDENTIAL = /(?:bearer\s+[A-Za-z0-9._-]+|client.?secret|refresh.?token|private.?key)/gi;
const PROVIDER_ID_TEXT = /\b(?:aryeo|stripe|quickbooks|provider)[\s:._-]{0,8}(?:(?:record|customer|payment)[\s:._-]{0,8})?(?:id|identifier)\b/gi;
const STRIPE_OBJECT_ID = /\b(?:cus|ch|pi|pm|in|evt)_[A-Za-z0-9]{6,}\b/g;
const PROVIDER_ID_KEY = /^(?:(?:aryeo|stripe|quickbooks)|provider)(?:record|customer|payment)?(?:id|identifier)$/i;
const TRANSACTION_VALUE_KEY = /^(?:amount|subtotal|tax|total|balance|sales price|net_amount)$/i;
const SHA256 = /^[0-9a-f]{64}$/;

// R82 permits hash recognition only for these exact canonical structural fields.
const CANONICAL_SHA256_FIELDS = new Set([
  "artifactSha256",
  "opaqueSourceReferenceHash",
  "semanticResultSha256",
  "sourceArtifactHash",
]);

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

function artifactType(relativePath: string): HistoricalPrivacyHitV1["artifactType"] {
  const extension = extname(relativePath).toLowerCase();
  if (extension === ".html") return "HTML";
  if (extension === ".json") return "JSON";
  if (extension === ".md") return "MARKDOWN";
  return "TEXT";
}

function addMatches(
  hits: HistoricalPrivacyHitV1[],
  relativePath: string,
  location: string,
  value: string,
  rule: HistoricalPrivacyRule,
  pattern: RegExp,
): void {
  pattern.lastIndex = 0;
  for (const match of value.matchAll(pattern)) {
    hits.push({ artifactRelativePath: relativePath, artifactType: artifactType(relativePath), structuralLocation: location,
      rule, matchedValueSha256: fingerprint(match[0]) });
  }
}

function scanValue(hits: HistoricalPrivacyHitV1[], relativePath: string, location: string, value: string, skipPhone = false): void {
  addMatches(hits, relativePath, location, value, "DIRECT_EMAIL", EMAIL);
  if (!skipPhone) addMatches(hits, relativePath, location, value, "PHONE_LIKE", PHONE);
  addMatches(hits, relativePath, location, value, "EXTERNAL_PATH", EXTERNAL_PATH);
  addMatches(hits, relativePath, location, value, "CREDENTIAL_MATERIAL", CREDENTIAL);
  addMatches(hits, relativePath, location, value, "PROVIDER_ID_LIKE", PROVIDER_ID_TEXT);
  addMatches(hits, relativePath, location, value, "PROVIDER_ID_LIKE", STRIPE_OBJECT_ID);
}

function scanJson(relativePath: string, content: string, hits: HistoricalPrivacyHitV1[]): number {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch {
    scanValue(hits, relativePath, "$", content);
    return 0;
  }
  let validatedHashes = 0;
  const visit = (value: unknown, path: string, key?: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) {
        const childPath = `${path}.${childKey}`;
        scanValue(hits, relativePath, `${childPath}#key`, childKey);
        if (PROVIDER_ID_KEY.test(childKey) && typeof childValue === "string" && childValue.length > 0) {
          hits.push({ artifactRelativePath: relativePath, artifactType: "JSON", structuralLocation: childPath,
            rule: "PROVIDER_ID_LIKE", matchedValueSha256: fingerprint(childValue) });
        }
        if (TRANSACTION_VALUE_KEY.test(childKey) && typeof childValue === "number") {
          hits.push({ artifactRelativePath: relativePath, artifactType: "JSON", structuralLocation: childPath,
            rule: "TRANSACTION_VALUE", matchedValueSha256: fingerprint(String(childValue)) });
        }
        visit(childValue, childPath, childKey);
      }
      return;
    }
    if (typeof value !== "string" && typeof value !== "number") return;
    const text = String(value);
    const canonicalHash = typeof value === "string" && key !== undefined && CANONICAL_SHA256_FIELDS.has(key) && SHA256.test(value);
    if (canonicalHash) validatedHashes += 1;
    scanValue(hits, relativePath, path, text, canonicalHash);
  };
  visit(parsed, "$");
  return validatedHashes;
}

function decodeHtmlText(value: string): string {
  return value.replace(/&#(\d+);/g, (_all, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
}

function scanHtml(relativePath: string, content: string, hits: HistoricalPrivacyHitV1[]): number {
  const tokens = content.split(/(<[^>]*>)/g).filter(Boolean);
  let validatedHashes = 0;
  let previousVisibleText = "";
  let textIndex = 0;
  for (const token of tokens) {
    if (token.startsWith("<")) {
      // Scan one tag at a time so an identifier expression cannot cross tag boundaries.
      scanValue(hits, relativePath, `tag[${textIndex}]`, token);
      continue;
    }
    const text = decodeHtmlText(token).trim();
    if (!text) continue;
    textIndex += 1;
    const evidenceHash = text.match(/^Evidence:\s*([0-9a-f]{64})$/)?.[1];
    const semanticHash = SHA256.test(text) && previousVisibleText === "Semantic SHA-256" ? text : undefined;
    if (evidenceHash || semanticHash) {
      validatedHashes += 1;
      const canonical = evidenceHash ?? semanticHash!;
      const remainder = text.replace(canonical, "[VALIDATED_SHA256]");
      scanValue(hits, relativePath, `text[${textIndex}]`, remainder);
    } else {
      scanValue(hits, relativePath, `text[${textIndex}]`, text);
    }
    previousVisibleText = text;
  }
  return validatedHashes;
}

function scanText(relativePath: string, content: string, hits: HistoricalPrivacyHitV1[]): number {
  let validatedHashes = 0;
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const semanticMarkdown = line.match(/^[- ]*Semantic SHA-256:\s*`?([0-9a-f]{64})`?\s*$/)?.[1];
    const semanticText = relativePath.endsWith("HISTORICAL_REPLAY_SEMANTIC_SHA256.txt") && SHA256.test(line.trim()) ? line.trim() : undefined;
    if (semanticMarkdown || semanticText) {
      validatedHashes += 1;
      scanValue(hits, relativePath, `line[${index + 1}]`, line.replace(semanticMarkdown ?? semanticText!, "[VALIDATED_SHA256]"));
    } else {
      scanValue(hits, relativePath, `line[${index + 1}]`, line);
    }
  });
  return validatedHashes;
}

export function scanHistoricalPrivacyArtifact(relativePath: string, content: string): HistoricalPrivacyScanV1 {
  const hits: HistoricalPrivacyHitV1[] = [];
  const type = artifactType(relativePath);
  const validatedCanonicalHashValueCount = type === "JSON" ? scanJson(relativePath, content, hits)
    : type === "HTML" ? scanHtml(relativePath, content, hits) : scanText(relativePath, content, hits);
  const has = (rule: HistoricalPrivacyRule) => hits.some((hit) => hit.rule === rule);
  return { checks: { directEmailAbsent: !has("DIRECT_EMAIL"), phoneAbsent: !has("PHONE_LIKE"), externalPathAbsent: !has("EXTERNAL_PATH"),
    credentialMaterialAbsent: !has("CREDENTIAL_MATERIAL"), rawProviderIdentifierKeyAbsent: !has("PROVIDER_ID_LIKE"),
    transactionValuesAbsent: !has("TRANSACTION_VALUE") }, hits, scannedArtifactCount: 1, validatedCanonicalHashValueCount };
}

export async function scanHistoricalPrivacyArtifacts(outputRoot: string): Promise<HistoricalPrivacyScanV1> {
  const files = (await readdir(outputRoot, { recursive: true })).filter((name) =>
    !name.startsWith("platform-baseline/") && name !== "HISTORICAL_PRIVACY_SANITIZATION_SCAN.json" && /\.(?:json|md|html|txt)$/.test(name)).sort();
  const scans = await Promise.all(files.map(async (name) => scanHistoricalPrivacyArtifact(name, await readFile(join(outputRoot, name), "utf8"))));
  const hits = scans.flatMap((scan) => scan.hits);
  const has = (rule: HistoricalPrivacyRule) => hits.some((hit) => hit.rule === rule);
  return { checks: { directEmailAbsent: !has("DIRECT_EMAIL"), phoneAbsent: !has("PHONE_LIKE"), externalPathAbsent: !has("EXTERNAL_PATH"),
    credentialMaterialAbsent: !has("CREDENTIAL_MATERIAL"), rawProviderIdentifierKeyAbsent: !has("PROVIDER_ID_LIKE"),
    transactionValuesAbsent: !has("TRANSACTION_VALUE") }, hits, scannedArtifactCount: files.length,
    validatedCanonicalHashValueCount: scans.reduce((sum, scan) => sum + scan.validatedCanonicalHashValueCount, 0) };
}
