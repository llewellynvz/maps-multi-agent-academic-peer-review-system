export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'manuscript_already_exists'
  | 'deliverable_not_released'
  | 'parse_incomplete'
  | 'unprocessable'
  | 'rate_limited'
  | 'internal'
  | 'master_key_missing';

const CODE_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  manuscript_already_exists: 409,
  deliverable_not_released: 409,
  parse_incomplete: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
  master_key_missing: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = CODE_STATUS[code];
    this.details = details;
  }

  body(): { error: { code: string; message: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
