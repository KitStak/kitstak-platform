/**
 * Generic export provider: reads the grid's own list endpoint page by page, so an export
 * contains exactly what the user sees for the same query (BUILD_PLAN F6 `exports/`).
 *
 * The endpoint is called as the requesting user through an injected `ListFetcher`
 * (`createHttpListFetcher` forwards the original request's cookie in memory only; it is
 * never persisted), so scope and permissions are enforced by the endpoint itself.
 */
import { z } from 'zod';
import { AppError } from '@/server/api/errors';
import type { ExportPage, ExportProvider, ExportRow, GridExportDef, ListFetcher } from './types';

const PAGING_PARAMS = ['page', 'ps'] as const;

const successEnvelope = z.object({
  success: z.literal(true),
  data: z.array(z.record(z.string(), z.unknown())),
  meta: z.object({ total: z.number().int().nonnegative().optional() }).loose().optional(),
});

const failureEnvelope = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
});

/** Builds the list query: the grid's params without paging, plus fixed params and the page. */
export function buildListSearch(
  def: Pick<GridExportDef, 'fixedParams'>,
  rawQuery: string,
  page: number,
  pageSize: number,
): URLSearchParams {
  const search = new URLSearchParams(rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery);
  for (const name of PAGING_PARAMS) search.delete(name);
  for (const [name, value] of Object.entries(def.fixedParams ?? {})) search.set(name, value);
  search.set('page', String(page));
  search.set('ps', String(pageSize));
  return search;
}

/** Validates a list endpoint response and returns its rows and total. */
export function parseListResponse(body: unknown, listPath: string): ExportPage {
  const ok = successEnvelope.safeParse(body);
  if (ok.success) {
    const rows: readonly ExportRow[] = ok.data.data;
    return ok.data.meta?.total === undefined ? { rows } : { rows, total: ok.data.meta.total };
  }
  const failed = failureEnvelope.safeParse(body);
  if (failed.success) {
    throw new AppError('INVALID_STATE', `Export source ${listPath} failed: ${failed.data.error}`);
  }
  throw new AppError('INVALID_STATE', `Export source ${listPath} did not return a list`);
}

const PATH_PARAM = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Fills `{name}` placeholders in a list path from the export query (e.g.
 * `/api/billing-reports/{reportId}/lines` + `reportId=…`) and removes those params from the search.
 */
export function resolveListPath(listPath: string, search: URLSearchParams): string {
  return listPath.replace(PATH_PARAM, (_m, name: string) => {
    const value = search.get(name) ?? '';
    if (!SAFE_SEGMENT.test(value)) throw new AppError('VALIDATION', `Export needs a valid "${name}"`);
    search.delete(name);
    return encodeURIComponent(value);
  });
}

export function createGenericProvider(def: GridExportDef): ExportProvider {
  return {
    async fetchPage(ctx, page, pageSize) {
      if (!ctx.listFetcher) {
        throw new AppError('INVALID_STATE', `Export for "${def.title}" is not configured yet`);
      }
      const search = buildListSearch(def, ctx.rawQuery, page, pageSize);
      const listPath = resolveListPath(def.listPath, search);
      const body = await ctx.listFetcher(listPath, search);
      return parseListResponse(body, listPath);
    },
  };
}

export interface HttpListFetcherOptions {
  /** Same-origin base, e.g. `request.nextUrl.origin`. */
  readonly origin: string;
  /** The requesting user's `cookie` header (session + context cookies). */
  readonly cookie: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** Fetcher that calls the list endpoint over HTTP as the original user. */
export function createHttpListFetcher(options: HttpListFetcherOptions): ListFetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (listPath, search) => {
    if (!listPath.startsWith('/api/')) throw new AppError('VALIDATION', 'Export source must be an /api path');
    const url = new URL(`${listPath}?${search.toString()}`, options.origin);
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...(options.cookie ? { cookie: options.cookie } : {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    try {
      return (await response.json()) as unknown;
    } catch (error: unknown) {
      throw new AppError('INVALID_STATE', `Export source ${listPath} returned ${response.status}`, {
        cause: error,
      });
    }
  };
}
