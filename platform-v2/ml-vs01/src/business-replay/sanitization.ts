import type { BusinessReplayScenarioV1 } from "./contracts.js";

export class ReplaySafetyError extends Error {
  constructor(readonly code: string, readonly evidencePath: string) { super(`${code} at ${evidencePath}`); }
}

const URL = /(?:https?:\/\/|file:\/\/|drive\.google\.com|aryeo\.com|stripe\.com|quickbooks|honeybook)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?1[-. (]*)?\d{3}[-. )]*\d{3}[-. ]*\d{4}/;
const EXTERNAL_PATH = /(?:^|[\s"'])(?:\/Users\/|\/home\/|[A-Za-z]:\\|\.\.\/)/;
const CREDENTIAL_VALUE = /(?:oauth|bearer\s|service.?account|client.?secret|webhook.?secret|private.?key)/i;
const CREDENTIAL_KEY = /(?:password|credential|access.?token|refresh.?token|client.?secret|webhook.?secret|private.?key)/i;
const PROVIDER_ID_KEY = /(?:aryeo|stripe|quickbooks|honeybook|provider).*(?:id|identifier|record)/i;
const PRODUCTION = /(?:production|prod_database|prod-db)/i;

export function assertSyntheticOnlyScenario(scenario: BusinessReplayScenarioV1): void {
  if (scenario.provenanceClassification !== "SYNTHETIC_FIXTURE") {
    throw new ReplaySafetyError("REPLAY_PROVENANCE_REJECTED", "$.provenanceClassification");
  }
  scan(scenario, "$", undefined);
  for (let index = 0; index < scenario.evidence.length; index += 1) {
    if (scenario.evidence[index]!.syntheticEvidenceRoleLabel !== true) {
      throw new ReplaySafetyError("PROVIDER_LABEL_NOT_SYNTHETIC", `$.evidence[${index}]`);
    }
  }
}

function scan(value: unknown, path: string, key: string | undefined): void {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (key && /hash$/i.test(key) && /^[0-9a-f]{64}$/.test(value)) return;
    if (key === "sourceSystemType" && ["ARYEO", "STRIPE", "QUICKBOOKS", "HONEYBOOK", "DRIVE", "LEGACY_OPERATIONAL_RECORD", "R71_POLICY"].includes(value)) return;
    if (URL.test(value)) throw new ReplaySafetyError("PROVIDER_OR_NETWORK_INPUT_REJECTED", path);
    if (EMAIL.test(value)) throw new ReplaySafetyError("PII_EMAIL_REJECTED", path);
    if (PHONE.test(value)) throw new ReplaySafetyError("PII_PHONE_REJECTED", path);
    if (EXTERNAL_PATH.test(value)) throw new ReplaySafetyError("EXTERNAL_PATH_REJECTED", path);
    if (CREDENTIAL_VALUE.test(value) || (key && CREDENTIAL_KEY.test(key))) throw new ReplaySafetyError("CREDENTIAL_INPUT_REJECTED", path);
    if (key && PROVIDER_ID_KEY.test(key)) throw new ReplaySafetyError("RAW_PROVIDER_IDENTIFIER_REJECTED", path);
    if ((key && /(?:database|host|target)/i.test(key)) && PRODUCTION.test(value)) throw new ReplaySafetyError("PRODUCTION_TARGET_REJECTED", path);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => scan(item, `${path}[${index}]`, key)); return; }
  if (typeof value !== "object") throw new ReplaySafetyError("UNSUPPORTED_INPUT_REJECTED", path);
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (/networkRetrievalIntent/i.test(childKey) && child === true) throw new ReplaySafetyError("NETWORK_RETRIEVAL_REJECTED", `${path}.${childKey}`);
    if (CREDENTIAL_KEY.test(childKey) && child !== null && child !== false && child !== "") throw new ReplaySafetyError("CREDENTIAL_INPUT_REJECTED", `${path}.${childKey}`);
    if (PROVIDER_ID_KEY.test(childKey)) throw new ReplaySafetyError("RAW_PROVIDER_IDENTIFIER_REJECTED", `${path}.${childKey}`);
    scan(child, `${path}.${childKey}`, childKey);
  }
}
