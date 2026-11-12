/**
 * API JSON envelope types (pure; shared with the client fetcher in `src/lib/api.ts`).
 *   success: { ok: true, data, meta? }
 *   failure: { ok: false, error: { code, message, details? } }
 */
import type { ErrorBody } from './errors';

export interface PaginationMeta {
  /** Opaque cursor for the next page; null when there are no more results. */
  readonly nextCursor: string | null;
  readonly limit?: number;
  readonly total?: number;
}

export type ApiMeta = Partial<PaginationMeta> & Readonly<Record<string, unknown>>;

export interface ApiSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly meta?: ApiMeta;
}

export interface ApiFailure {
  readonly ok: false;
  readonly error: ErrorBody;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Header carrying the active organization id for org-scoped API calls. */
export const ORG_HEADER = 'x-org-id';
export const REQUEST_ID_HEADER = 'x-request-id';
