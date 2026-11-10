/**
 * Pagination helpers. Page size is always capped at 1000.
 *
 *   const { rows, total } = paginate(
 *     db.select().from(orders).where(where).orderBy(...order).$dynamic(),
 *     () => db.select({ n: count() }).from(orders).where(where).get()?.n ?? 0,
 *     { page, pageSize },
 *   );
 */
import { MAX_PAGE_SIZE } from "./grid-query";

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export interface PageResult<T> {
  readonly rows: T[];
  readonly total: number;
}

export interface PageMeta {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export function normalizePage(request: PageRequest): PageRequest {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(request.pageSize) || 1));
  const page = Math.max(1, Math.floor(request.page) || 1);
  return { page, pageSize };
}

export function pageOffset(request: PageRequest): number {
  const { page, pageSize } = normalizePage(request);
  return (page - 1) * pageSize;
}

/** Any Drizzle dynamic select (or test double) that supports limit/offset/all. */
export interface PageableQuery<T> {
  limit(n: number): { offset(n: number): { all(): T[] } };
}

export function paginate<T>(query: PageableQuery<T>, countTotal: () => number, request: PageRequest): PageResult<T> {
  const normalized = normalizePage(request);
  const rows = query.limit(normalized.pageSize).offset(pageOffset(normalized)).all();
  return { rows, total: countTotal() };
}

export function pageMeta(total: number, request: PageRequest): PageMeta {
  return { total, ...normalizePage(request) };
}
