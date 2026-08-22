export const OPERATIONS_CONSOLE_SCHEMA = "ML_INTERNAL_OPERATIONS_CONSOLE_V1" as const;

export const OPERATIONS_CONSOLE_CONTRACT_FAMILIES = [
  "OperationsConsoleHealthV1",
  "DevelopmentOperatorSessionReceiptV1",
  "SelectableCatalogV1",
  "ListingPreviewRequestV1",
  "ListingPreviewV1",
  "CreateListingRequestV1",
  "ListingCreationReceiptV1",
  "CanonicalOrderConfirmationV1",
  "OperationsConsoleErrorV1",
] as const;

export type OperationsConsoleContractFamily = (typeof OPERATIONS_CONSOLE_CONTRACT_FAMILIES)[number];
export type IsoTimestamp = string;
export type CanonicalUuid = string;
export type CurrencyCode = "USD";

export interface VersionedOperationsConsoleContract<
  Family extends OperationsConsoleContractFamily = OperationsConsoleContractFamily,
> {
  readonly schema: typeof OPERATIONS_CONSOLE_SCHEMA;
  readonly contract: Family;
}

export interface OperationsConsoleHealthV1
  extends VersionedOperationsConsoleContract<"OperationsConsoleHealthV1"> {
  readonly status: "OK";
  readonly environment: "NONPRODUCTION";
  readonly observedAt: IsoTimestamp;
}

export interface DevelopmentOperatorSessionReceiptV1
  extends VersionedOperationsConsoleContract<"DevelopmentOperatorSessionReceiptV1"> {
  readonly authenticated: true;
  readonly environment: "NONPRODUCTION";
  readonly expiresAt: IsoTimestamp;
}

export type CatalogChoiceKindV1 = "PRODUCT" | "PACKAGE";
export type CatalogPricingBasisV1 = "EACH" | "SQUARE_FEET" | "SCOPE_UNITS";

export interface SelectableCatalogInclusionV1 {
  readonly displayName: string;
  readonly quantity: number;
  readonly commercialUnit: string;
  readonly position: number;
}

export interface SelectableCatalogPriceBracketV1 {
  readonly bracketCode: string;
  readonly basis: CatalogPricingBasisV1;
  readonly lowerBound: number | null;
  readonly upperBound: number | null;
  readonly lowerInclusive: boolean;
  readonly upperInclusive: boolean;
  readonly amountCents: number;
  readonly currencyCode: CurrencyCode;
}

export interface SelectableCatalogChoiceV1 {
  readonly choiceHandle: string;
  readonly kind: CatalogChoiceKindV1;
  readonly displayName: string;
  readonly description: string | null;
  readonly pricingBasis: CatalogPricingBasisV1;
  readonly requiresSquareFeet: boolean;
  readonly quantityMinimum: number;
  readonly quantityMaximum: number;
  readonly displayedPriceCents: number | null;
  readonly currencyCode: CurrencyCode;
  readonly inclusions: readonly SelectableCatalogInclusionV1[];
  readonly priceBrackets: readonly SelectableCatalogPriceBracketV1[];
}

export interface SelectableCatalogV1
  extends VersionedOperationsConsoleContract<"SelectableCatalogV1"> {
  readonly pricedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly evidenceClassification: "NONPRODUCTION_RECONSTRUCTED";
  readonly disclosure: string;
  readonly choices: readonly SelectableCatalogChoiceV1[];
}

export interface ListingPreviewCustomerV1 {
  readonly displayName: string;
  readonly email: string;
}

export interface ListingPreviewPropertyV1 {
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly locality: string;
  readonly administrativeArea: string;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly squareFeet?: number;
}

export interface ListingPreviewServiceChoiceV1 {
  readonly choiceHandle: string;
  readonly quantity: number;
}

/**
 * Exact body accepted by POST /api/listings/preview. It deliberately has no
 * canonical identifiers, authority, source/provider identity, or money fields.
 */
export interface ListingPreviewRequestV1 {
  readonly customer: ListingPreviewCustomerV1;
  readonly property: ListingPreviewPropertyV1;
  readonly services: readonly ListingPreviewServiceChoiceV1[];
}

export interface ListingPreviewLineV1 {
  readonly choiceHandle: string;
  readonly kind: CatalogChoiceKindV1;
  readonly displayName: string;
  readonly quantity: number;
  readonly unitAmountCents: number;
  readonly lineAmountCents: number;
  readonly currencyCode: CurrencyCode;
  readonly inclusions: readonly SelectableCatalogInclusionV1[];
}

export interface ListingPreviewV1 extends VersionedOperationsConsoleContract<"ListingPreviewV1"> {
  readonly previewReceipt: string;
  readonly pricedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly customer: ListingPreviewCustomerV1;
  readonly property: ListingPreviewPropertyV1;
  readonly services: readonly ListingPreviewLineV1[];
  readonly subtotalCents: number;
  readonly travelAmountCents: 0;
  readonly adjustmentAmountCents: 0;
  readonly totalAmountCents: number;
  readonly currencyCode: CurrencyCode;
  readonly paymentDisposition: "PAY_NOW";
  readonly evidenceClassification: "NONPRODUCTION_RECONSTRUCTED";
  readonly disclosure: string;
}

/** Exact body accepted by POST /api/listings. */
export interface CreateListingRequestV1 {
  readonly previewReceipt: string;
}

export interface CanonicalOrderPersonPartyV1 {
  readonly role: "ORDERING_PERSON" | "CUSTOMER" | "BILLING_PARTY" | "COMMERCIAL_OWNER" | "AUTHORIZED_ACTOR";
  readonly partyKind: "PERSON";
  readonly personId: CanonicalUuid;
  readonly organizationId: null;
  readonly displayName: string;
}

export interface CanonicalOrderOrganizationPartyV1 {
  readonly role: "ORGANIZATION";
  readonly partyKind: "ORGANIZATION";
  readonly personId: null;
  readonly organizationId: CanonicalUuid;
  readonly displayName: string;
}

export type CanonicalOrderPartyV1 = CanonicalOrderPersonPartyV1 | CanonicalOrderOrganizationPartyV1;

export interface CanonicalOrderItemV1 {
  readonly orderItemId: CanonicalUuid;
  readonly commercialSnapshotId: CanonicalUuid;
  readonly kind: CatalogChoiceKindV1;
  readonly displayName: string;
  readonly quantity: number;
  readonly unitAmountCents: number;
  readonly lineAmountCents: number;
  readonly currencyCode: CurrencyCode;
}

export interface CanonicalOrderConfirmationV1
  extends VersionedOperationsConsoleContract<"CanonicalOrderConfirmationV1"> {
  readonly orderId: CanonicalUuid;
  readonly status: string;
  readonly createdAt: IsoTimestamp;
  readonly confirmedAt: IsoTimestamp;
  readonly customer: ListingPreviewCustomerV1;
  readonly property: ListingPreviewPropertyV1 & {
    readonly propertyId: CanonicalUuid;
    readonly propertySnapshotId: CanonicalUuid;
  };
  readonly parties: readonly CanonicalOrderPartyV1[];
  readonly items: readonly CanonicalOrderItemV1[];
  readonly subtotalCents: number;
  readonly travelAmountCents: 0;
  readonly adjustmentAmountCents: 0;
  readonly totalAmountCents: number;
  readonly currencyCode: CurrencyCode;
  readonly paymentDisposition: "PAY_NOW";
  readonly customerOutcome: "CREATED" | "REUSED";
  readonly propertyOutcome: "PROPERTY_CREATED" | "PROPERTY_REUSED";
  readonly propertySnapshotOutcome: "SNAPSHOT_CREATED" | "SNAPSHOT_REUSED";
  readonly replayed: boolean;
  readonly nextStep: "OPERATIONS_AVAILABLE";
  readonly nextStepMessage: string;
}

export interface ListingCreationReceiptV1
  extends VersionedOperationsConsoleContract<"ListingCreationReceiptV1"> {
  readonly created: true;
  readonly replayed: boolean;
  readonly committedAt: IsoTimestamp;
  readonly confirmation: CanonicalOrderConfirmationV1;
}

export type OperationsConsoleErrorCodeV1 =
  | "INVALID_REQUEST"
  | "SESSION_REQUIRED"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_MISMATCH"
  | "CATALOG_CHANGED"
  | "IDEMPOTENCY_CONFLICT"
  | "STATE_CONFLICT"
  | "CREATION_IN_PROGRESS"
  | "PREREQUISITE_REQUIRED"
  | "MEDIA_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface OperationsConsoleErrorV1
  extends VersionedOperationsConsoleContract<"OperationsConsoleErrorV1"> {
  readonly requestReference: string;
  readonly error: {
    readonly code: OperationsConsoleErrorCodeV1;
    readonly message: string;
  };
}

export class OperationsConsoleRequestValidationError extends TypeError {
  readonly code = "INVALID_REQUEST" as const;

  constructor(message: string) {
    super(message);
    this.name = "OperationsConsoleRequestValidationError";
  }
}

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function fail(path: string, rule: string): never {
  throw new OperationsConsoleRequestValidationError(`${path} ${rule}`);
}

function exactObject(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(path, "must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(path, "must be a plain object");

  const object = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) return fail(`${path}.${key}`, "is not allowed");
  }
  for (const key of required) {
    if (!hasOwn(object, key)) return fail(`${path}.${key}`, "is required");
  }
  return object;
}

function boundedString(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") return fail(path, "must be a string");
  if (/\p{Cc}/u.test(value)) return fail(path, "contains unsupported control characters");
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length < minimum || normalized.length > maximum) return fail(path, `must contain ${minimum}-${maximum} characters`);
  return normalized;
}

function emailAddress(value: unknown, path: string): string {
  const email = boundedString(value, path, 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return fail(path, "must be a valid email address");
  return email;
}

function quantity(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 99) {
    return fail(path, "must be an integer from 1 through 99");
  }
  return value;
}

function squareFeet(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    return fail(path, "must be an integer from 1 through 1000000");
  }
  return value;
}

function nullableAddressLine(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return fail(path, "must be a string or null");
  if (/\p{Cc}/u.test(value)) return fail(path, "contains unsupported control characters");
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) return null;
  if (normalized.length > 200) return fail(path, "must contain at most 200 supported characters");
  return normalized;
}

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function choiceHandle(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 192) {
    return fail(path, "must be a bounded opaque selection handle");
  }
  const handle = value;
  if (!/^[A-Za-z0-9_-]+$/u.test(handle)) return fail(path, "must be an opaque selection handle");
  if (CANONICAL_UUID_PATTERN.test(handle)) return fail(path, "must not be a canonical identifier");
  return handle;
}

export const OPAQUE_PREVIEW_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;

function previewReceipt(value: unknown, path: string): string {
  if (typeof value !== "string" || !OPAQUE_PREVIEW_RECEIPT_PATTERN.test(value) || CANONICAL_UUID_PATTERN.test(value)) {
    return fail(path, "must be an opaque preview receipt");
  }
  return value;
}

/** POST /session accepts an empty JSON object and nothing else. */
export function parseDevelopmentOperatorSessionRequestV1(value: unknown): Record<string, never> {
  exactObject(value, "$", []);
  return {};
}

/** Strict parser and normalizer for POST /api/listings/preview. */
export function parseListingPreviewRequestV1(value: unknown): ListingPreviewRequestV1 {
  const root = exactObject(value, "$", ["customer", "property", "services"]);
  const customer = exactObject(root.customer, "$.customer", ["displayName", "email"]);
  const property = exactObject(
    root.property,
    "$.property",
    ["addressLine1", "addressLine2", "locality", "administrativeArea", "postalCode", "countryCode"],
    ["squareFeet"],
  );

  if (!Array.isArray(root.services)) return fail("$.services", "must be an array");
  if (root.services.length < 1 || root.services.length > 50) return fail("$.services", "must contain 1-50 choices");

  const seenHandles = new Set<string>();
  const services = root.services.map((value, index): ListingPreviewServiceChoiceV1 => {
    const object = exactObject(value, `$.services[${index}]`, ["choiceHandle", "quantity"]);
    const handle = choiceHandle(object.choiceHandle, `$.services[${index}].choiceHandle`);
    if (seenHandles.has(handle)) return fail(`$.services[${index}].choiceHandle`, "must be unique");
    seenHandles.add(handle);
    return Object.freeze({
      choiceHandle: handle,
      quantity: quantity(object.quantity, `$.services[${index}].quantity`),
    });
  });

  const countryCode = boundedString(property.countryCode, "$.property.countryCode", 2, 2).toUpperCase();
  if (!/^[A-Z]{2}$/u.test(countryCode)) return fail("$.property.countryCode", "must be a two-letter country code");

  const normalizedProperty: ListingPreviewPropertyV1 = {
    addressLine1: boundedString(property.addressLine1, "$.property.addressLine1", 1, 200),
    addressLine2: nullableAddressLine(property.addressLine2, "$.property.addressLine2"),
    locality: boundedString(property.locality, "$.property.locality", 1, 120),
    administrativeArea: boundedString(property.administrativeArea, "$.property.administrativeArea", 1, 120).toUpperCase(),
    postalCode: boundedString(property.postalCode, "$.property.postalCode", 1, 32).toUpperCase(),
    countryCode,
    ...(hasOwn(property, "squareFeet")
      ? { squareFeet: squareFeet(property.squareFeet, "$.property.squareFeet") }
      : {}),
  };

  return Object.freeze({
    customer: Object.freeze({
      displayName: boundedString(customer.displayName, "$.customer.displayName", 1, 160),
      email: emailAddress(customer.email, "$.customer.email"),
    }),
    property: Object.freeze(normalizedProperty),
    services: Object.freeze(services),
  });
}

/** Strict parser for POST /api/listings. No preview data may be resubmitted. */
export function parseCreateListingRequestV1(value: unknown): CreateListingRequestV1 {
  const root = exactObject(value, "$", ["previewReceipt"]);
  return Object.freeze({ previewReceipt: previewReceipt(root.previewReceipt, "$.previewReceipt") });
}

export function operationsConsoleContract<
  Family extends OperationsConsoleContractFamily,
  Fields extends Record<string, unknown>,
>(family: Family, fields: Fields): Readonly<Fields & VersionedOperationsConsoleContract<Family>> {
  return Object.freeze({
    ...fields,
    schema: OPERATIONS_CONSOLE_SCHEMA,
    contract: family,
  }) as Readonly<Fields & VersionedOperationsConsoleContract<Family>>;
}
