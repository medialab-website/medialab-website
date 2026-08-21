import {
  OperationsConsoleRequestValidationError,
  operationsConsoleContract,
  type OperationsConsoleErrorCodeV1,
  type OperationsConsoleErrorV1,
} from "./contracts.js";

interface ErrorDefinition {
  readonly statusCode: number;
  readonly message: string;
}

const ERROR_DEFINITIONS = {
  INVALID_REQUEST: { statusCode: 400, message: "The request is not valid." },
  SESSION_REQUIRED: { statusCode: 401, message: "A development operator session is required." },
  SESSION_EXPIRED: { statusCode: 401, message: "The development operator session has expired." },
  FORBIDDEN: { statusCode: 403, message: "This operation is not permitted." },
  NOT_FOUND: { statusCode: 404, message: "The requested record was not found." },
  PREVIEW_EXPIRED: { statusCode: 410, message: "The listing preview has expired. Create a new preview." },
  PREVIEW_MISMATCH: { statusCode: 409, message: "The listing preview does not match this session." },
  CATALOG_CHANGED: { statusCode: 409, message: "Catalog pricing changed. Review a new preview before creating the listing." },
  IDEMPOTENCY_CONFLICT: { statusCode: 409, message: "The listing submission conflicts with an earlier request." },
  CREATION_IN_PROGRESS: { statusCode: 409, message: "This listing submission is already being created." },
  PREREQUISITE_REQUIRED: { statusCode: 409, message: "Save an issued Mission Plan version before preparing Desktop work." },
  SERVICE_UNAVAILABLE: { statusCode: 503, message: "The nonproduction operations console is temporarily unavailable." },
  INTERNAL_ERROR: { statusCode: 500, message: "The request could not be completed." },
} as const satisfies Record<OperationsConsoleErrorCodeV1, ErrorDefinition>;

/**
 * A bounded application error. Its HTTP body is always selected from the
 * fixed table above; database text, stack traces, tokens, and input values are
 * never copied into the response.
 */
export class OperationsConsoleHttpError extends Error {
  readonly code: OperationsConsoleErrorCodeV1;
  readonly statusCode: number;

  constructor(code: OperationsConsoleErrorCodeV1, options?: ErrorOptions) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message, options);
    this.name = "OperationsConsoleHttpError";
    this.code = code;
    this.statusCode = definition.statusCode;
  }
}

export interface OperationsConsoleErrorResponse {
  readonly statusCode: number;
  readonly body: OperationsConsoleErrorV1;
}

export function operationsConsoleError(code: OperationsConsoleErrorCodeV1, options?: ErrorOptions): OperationsConsoleHttpError {
  return new OperationsConsoleHttpError(code, options);
}

function boundedRequestReference(value: string | undefined): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    return "request-unavailable";
  }
  return value;
}

export function serializeOperationsConsoleError(
  error: unknown,
  requestReference?: string,
): OperationsConsoleErrorResponse {
  const code: OperationsConsoleErrorCodeV1 =
    error instanceof OperationsConsoleRequestValidationError
      ? "INVALID_REQUEST"
      : error instanceof OperationsConsoleHttpError
        ? error.code
        : "INTERNAL_ERROR";
  const definition = ERROR_DEFINITIONS[code];
  const body = operationsConsoleContract("OperationsConsoleErrorV1", {
    requestReference: boundedRequestReference(requestReference),
    error: Object.freeze({ code, message: definition.message }),
  }) as OperationsConsoleErrorV1;
  return Object.freeze({ statusCode: definition.statusCode, body });
}

export function isOperationsConsoleHttpError(error: unknown): error is OperationsConsoleHttpError {
  return error instanceof OperationsConsoleHttpError;
}
