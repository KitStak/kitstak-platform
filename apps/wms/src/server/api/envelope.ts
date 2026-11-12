/**
 * Response envelope (BUILD_PLAN 0.2):
 *   success: { success: true,  data, meta? }
 *   failure: { success: false, error: "<human message>", code: ErrorCode, fieldErrors?, requestId? }
 *
 * `error` stays a plain string so pre-foundation clients that read `body.error` keep working;
 * `code` lets F4's `apiFetch` build `ApiError { code, message, fieldErrors, status }`.
 */
import { NextResponse } from "next/server";
import type { AppError, ErrorCode, FieldErrors } from "./errors";

export interface ApiMeta {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly [key: string]: unknown;
}

export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: ApiMeta;
}

export interface ApiFailure {
  readonly success: false;
  readonly error: string;
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldErrors;
  readonly requestId?: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Per-id result for bulk endpoints (`{ ids: string[] }`, max 1000). */
export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: ErrorCode; readonly message: string }[];
}

export const MAX_BULK_IDS = 1000;

export function successBody<T>(data: T, meta?: ApiMeta): ApiSuccess<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function failureBody(error: AppError, requestId?: string): ApiFailure {
  return {
    success: false,
    error: error.message,
    code: error.code,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export function jsonOk<T>(data: T, init?: { status?: number; meta?: ApiMeta; headers?: HeadersInit }): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(successBody(data, init?.meta), { status: init?.status ?? 200, headers: init?.headers });
}

export function jsonError(error: AppError, requestId?: string): NextResponse<ApiFailure> {
  const headers = new Headers(error.headers ?? {});
  if (requestId) headers.set("x-request-id", requestId);
  return NextResponse.json(failureBody(error, requestId), { status: error.status, headers });
}

/* ---------- Handler result helpers (returned from a defineRoute handler) ---------- */

const RESULT_BRAND = Symbol.for("kitstak.routeResult");

export interface RouteResult<T> {
  readonly [RESULT_BRAND]: true;
  readonly data: T;
  readonly status: number;
  readonly meta?: ApiMeta;
  readonly headers?: Readonly<Record<string, string>>;
}

export function result<T>(data: T, init: { status?: number; meta?: ApiMeta; headers?: Record<string, string> } = {}): RouteResult<T> {
  return { [RESULT_BRAND]: true, data, status: init.status ?? 200, meta: init.meta, headers: init.headers };
}

/** List payload: rows + `{ total, page, pageSize }` meta. */
export function listResult<T>(rows: readonly T[], meta: ApiMeta): RouteResult<readonly T[]> {
  return result(rows, { meta });
}

export function created<T>(data: T): RouteResult<T> {
  return result(data, { status: 201 });
}

export function isRouteResult(value: unknown): value is RouteResult<unknown> {
  return typeof value === "object" && value !== null && RESULT_BRAND in value;
}
