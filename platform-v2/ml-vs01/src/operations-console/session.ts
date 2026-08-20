import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  operationsConsoleContract,
  type CanonicalUuid,
  type DevelopmentOperatorSessionReceiptV1,
} from "./contracts.js";
import { operationsConsoleError } from "./errors.js";

export const OPERATIONS_CONSOLE_SESSION_COOKIE = "ml_m17a_operator" as const;
export const DEFAULT_SESSION_TTL_SECONDS = 15 * 60;
export const MAX_SESSION_TTL_SECONDS = 60 * 60;
export const MAX_ACTIVE_DEVELOPMENT_SESSIONS = 256;

const HANDLE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FALLBACK_HANDLE = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const FALLBACK_DIGEST = createHash("sha256").update(FALLBACK_HANDLE).digest();

export interface ServerBoundDevelopmentOperatorContext {
  readonly databaseSessionToken: string;
  readonly organizationId: CanonicalUuid;
  readonly actorPersonId: CanonicalUuid;
  readonly membershipId: CanonicalUuid;
}

/**
 * This value exists only on the server side. Private fields and an explicit
 * toJSON guard make accidental serialization yield no authority material.
 */
export class ResolvedDevelopmentOperatorSession {
  readonly #databaseSessionToken: string;
  readonly #organizationId: CanonicalUuid;
  readonly #actorPersonId: CanonicalUuid;
  readonly #membershipId: CanonicalUuid;
  readonly #expiresAtMs: number;

  constructor(context: ServerBoundDevelopmentOperatorContext, expiresAtMs: number) {
    this.#databaseSessionToken = context.databaseSessionToken;
    this.#organizationId = context.organizationId;
    this.#actorPersonId = context.actorPersonId;
    this.#membershipId = context.membershipId;
    this.#expiresAtMs = expiresAtMs;
    Object.freeze(this);
  }

  get databaseSessionToken(): string {
    return this.#databaseSessionToken;
  }

  get organizationId(): CanonicalUuid {
    return this.#organizationId;
  }

  get actorPersonId(): CanonicalUuid {
    return this.#actorPersonId;
  }

  get membershipId(): CanonicalUuid {
    return this.#membershipId;
  }

  get expiresAt(): string {
    return new Date(this.#expiresAtMs).toISOString();
  }

  toJSON(): undefined {
    return undefined;
  }
}

interface StoredDevelopmentOperatorSession {
  readonly digest: Buffer;
  readonly resolved: ResolvedDevelopmentOperatorSession;
  readonly expiresAtMs: number;
}

export interface IssuedDevelopmentOperatorSession {
  readonly setCookieHeader: string;
  readonly receipt: DevelopmentOperatorSessionReceiptV1;
}

export interface DevelopmentOperatorSessionManagerOptions {
  readonly ttlSeconds?: number;
  readonly now?: () => number;
  readonly maximumActiveSessions?: number;
}

function boundedServerString(value: string, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`invalid server-bound ${label}`);
  }
  return value;
}

function canonicalUuid(value: string, label: string): CanonicalUuid {
  if (!UUID_PATTERN.test(value)) throw new TypeError(`invalid server-bound ${label}`);
  return value.toLowerCase();
}

function validatedContext(context: ServerBoundDevelopmentOperatorContext): ServerBoundDevelopmentOperatorContext {
  if (!context || typeof context !== "object" || Array.isArray(context)) throw new TypeError("invalid server-bound session context");
  return Object.freeze({
    databaseSessionToken: boundedServerString(context.databaseSessionToken, "database session token", 16, 4_096),
    organizationId: canonicalUuid(context.organizationId, "organization id"),
    actorPersonId: canonicalUuid(context.actorPersonId, "actor person id"),
    membershipId: canonicalUuid(context.membershipId, "membership id"),
  });
}

function digestHandle(handle: string): Buffer {
  return createHash("sha256").update(handle).digest();
}

function sessionCookieValue(cookieHeader: string | undefined): string | undefined {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0 || cookieHeader.length > 4_096) return undefined;
  let found: string | undefined;
  const fields = cookieHeader.split(";");
  if (fields.length > 64) return undefined;
  for (const field of fields) {
    const separator = field.indexOf("=");
    if (separator < 1) continue;
    const name = field.slice(0, separator).trim();
    if (name !== OPERATIONS_CONSOLE_SESSION_COOKIE) continue;
    if (found !== undefined) return undefined;
    found = field.slice(separator + 1).trim();
  }
  return found;
}

export class DevelopmentOperatorSessionManager {
  readonly #sessions = new Map<string, StoredDevelopmentOperatorSession>();
  readonly #ttlSeconds: number;
  readonly #now: () => number;
  readonly #maximumActiveSessions: number;

  constructor(options: DevelopmentOperatorSessionManagerOptions = {}) {
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_SESSION_TTL_SECONDS) {
      throw new TypeError(`session ttl must be an integer from 60 through ${MAX_SESSION_TTL_SECONDS}`);
    }
    const maximumActiveSessions = options.maximumActiveSessions ?? MAX_ACTIVE_DEVELOPMENT_SESSIONS;
    if (!Number.isInteger(maximumActiveSessions) || maximumActiveSessions < 1 || maximumActiveSessions > MAX_ACTIVE_DEVELOPMENT_SESSIONS) {
      throw new TypeError(`maximum active sessions must be an integer from 1 through ${MAX_ACTIVE_DEVELOPMENT_SESSIONS}`);
    }
    this.#ttlSeconds = ttlSeconds;
    this.#now = options.now ?? Date.now;
    this.#maximumActiveSessions = maximumActiveSessions;
  }

  issue(contextValue: ServerBoundDevelopmentOperatorContext): IssuedDevelopmentOperatorSession {
    const context = validatedContext(contextValue);
    const now = this.#now();
    this.purgeExpired(now);
    if (this.#sessions.size >= this.#maximumActiveSessions) throw operationsConsoleError("SERVICE_UNAVAILABLE");

    let handle = "";
    let digest: Buffer<ArrayBufferLike> = FALLBACK_DIGEST;
    let digestKey = "";
    for (let attempt = 0; attempt < 4; attempt += 1) {
      handle = randomBytes(32).toString("base64url");
      digest = digestHandle(handle);
      digestKey = digest.toString("hex");
      if (!this.#sessions.has(digestKey)) break;
    }
    if (!handle || this.#sessions.has(digestKey)) throw operationsConsoleError("SERVICE_UNAVAILABLE");

    const expiresAtMs = now + this.#ttlSeconds * 1_000;
    this.#sessions.set(digestKey, {
      digest,
      expiresAtMs,
      resolved: new ResolvedDevelopmentOperatorSession(context, expiresAtMs),
    });

    const receipt = operationsConsoleContract("DevelopmentOperatorSessionReceiptV1", {
      authenticated: true as const,
      environment: "NONPRODUCTION" as const,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }) as DevelopmentOperatorSessionReceiptV1;

    return Object.freeze({
      setCookieHeader: `${OPERATIONS_CONSOLE_SESSION_COOKIE}=${handle}; Max-Age=${this.#ttlSeconds}; Path=/; HttpOnly; SameSite=Strict`,
      receipt,
    });
  }

  resolveCookie(cookieHeader: string | undefined): ResolvedDevelopmentOperatorSession {
    const handle = sessionCookieValue(cookieHeader);
    const syntaxMatches = typeof handle === "string" && HANDLE_PATTERN.test(handle);
    const candidateDigest = digestHandle(syntaxMatches ? (handle as string) : FALLBACK_HANDLE);
    const digestKey = candidateDigest.toString("hex");
    const stored = this.#sessions.get(digestKey);
    const expectedDigest = stored?.digest ?? FALLBACK_DIGEST;
    const digestMatches = timingSafeEqual(candidateDigest, expectedDigest);

    if (!syntaxMatches || !stored || !digestMatches) throw operationsConsoleError("SESSION_REQUIRED");
    if (stored.expiresAtMs <= this.#now()) {
      this.#sessions.delete(digestKey);
      throw operationsConsoleError("SESSION_EXPIRED");
    }
    return stored.resolved;
  }

  revokeCookie(cookieHeader: string | undefined): boolean {
    const handle = sessionCookieValue(cookieHeader);
    const syntaxMatches = typeof handle === "string" && HANDLE_PATTERN.test(handle);
    const candidateDigest = digestHandle(syntaxMatches ? (handle as string) : FALLBACK_HANDLE);
    const digestKey = candidateDigest.toString("hex");
    const stored = this.#sessions.get(digestKey);
    const expectedDigest = stored?.digest ?? FALLBACK_DIGEST;
    const digestMatches = timingSafeEqual(candidateDigest, expectedDigest);
    return Boolean(syntaxMatches && stored && digestMatches && this.#sessions.delete(digestKey));
  }

  purgeExpired(now = this.#now()): number {
    let removed = 0;
    for (const [digestKey, stored] of this.#sessions) {
      if (stored.expiresAtMs <= now) {
        this.#sessions.delete(digestKey);
        removed += 1;
      }
    }
    return removed;
  }

  get activeSessionCount(): number {
    return this.#sessions.size;
  }

  static expiredCookieHeader(): string {
    return `${OPERATIONS_CONSOLE_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`;
  }
}
