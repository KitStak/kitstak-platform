'use client';

/**
 * TanStack Query platform (BUILD_PLAN F4.1).
 *   <QueryProvider>                      mount once in the root layout
 *   useApiQuery(key, path, opts)         GET through apiFetch (envelope unwrapped)
 *   useApiMutation({ path, method, invalidate, form })
 *       - toasts on success and on error
 *       - maps server `fieldErrors` onto react-hook-form fields (focus first error)
 */
import * as React from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { toast } from '@/components/ui/toast';
import {
  ApiError,
  apiRequest,
  isApiError,
  type ApiMeta,
  type ApiRequestOptions,
  type HttpMethod,
} from './api-client';

const DEFAULT_STALE_MS = 30_000;
const MAX_QUERY_RETRIES = 2;
/** Errors that retrying cannot fix. */
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'VALIDATION',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'CSRF',
  'CONFLICT',
  'INVALID_STATE',
  'DUPLICATE',
]);

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (!isApiError(error) || NON_RETRYABLE_CODES.has(error.code)) return false;
  if (error.code === 'NETWORK') return true;
  // Server errors retry once so the grid's error + Retry state shows quickly (work-orders R2-4).
  return error.status >= 500 && failureCount < 1;
}

/** Short, capped backoff: 500 ms, 1 s, 2 s. */
export function retryDelay(attempt: number): number {
  return Math.min(2000, 500 * 2 ** attempt);
}

/**
 * Queries whose invalidation must also refresh `GET /api/me` (shell nav, context switcher):
 *   apps        -> `activeApps` hides add-on nav items (reports-analytics REQ-2, admin-settings REQ-F1)
 *   clients     -> `contextOptions.clients` lists Active clients only (organization-billing REQ-1)
 *   warehouses  -> `contextOptions.warehouses`
 * Keyed by the first query-key segment, so any page invalidating e.g. `["apps"]` updates the
 * shell without a reload and without each module having to know about `["me"]`.
 */
export const ME_DEPENDENT_QUERY_ROOTS: ReadonlySet<string> = new Set(['apps', 'clients', 'warehouses']);
const ME_KEY: QueryKey = ['me'];

export function cascadesToMe(queryKey: QueryKey): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && ME_DEPENDENT_QUERY_ROOTS.has(root);
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: DEFAULT_STALE_MS, retry: shouldRetry, retryDelay, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  // One /api/me refresh per tick, however many dependent queries were invalidated together.
  let mePending = false;
  client.getQueryCache().subscribe((event) => {
    if (
      event.type !== 'updated' ||
      event.action.type !== 'invalidate' ||
      !cascadesToMe(event.query.queryKey) ||
      mePending
    )
      return;
    mePending = true;
    queueMicrotask(() => {
      mePending = false;
      void client.invalidateQueries({ queryKey: ME_KEY });
    });
  });
  return client;
}

let browserClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return createQueryClient();
  browserClient ??= createQueryClient();
  return browserClient;
}

export function QueryProvider({
  children,
  client,
}: {
  readonly children: React.ReactNode;
  readonly client?: QueryClient;
}) {
  const [queryClient] = React.useState(() => client ?? getQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/* ---------------- queries ---------------- */

export interface ApiQueryData<T> {
  readonly data: T;
  readonly meta?: ApiMeta;
}

export type UseApiQueryOptions<T> = Omit<
  UseQueryOptions<ApiQueryData<T>, ApiError>,
  'queryKey' | 'queryFn'
> & {
  readonly query?: ApiRequestOptions['query'];
  /** Optional: a request slower than this fails with code TIMEOUT (error state + Retry) instead of loading forever. */
  readonly timeoutMs?: number;
};

/**
 * GET `path`. Returns the TanStack result whose `data` is `{ data, meta }` so list
 * pages get `meta.total`. Pass `enabled: false` to defer; `path: null` also disables.
 */
export function useApiQuery<T>(
  key: QueryKey,
  path: string | null,
  options: UseApiQueryOptions<T> = {},
): UseQueryResult<ApiQueryData<T>, ApiError> {
  const { query, enabled, timeoutMs, ...rest } = options;
  return useQuery<ApiQueryData<T>, ApiError>({
    queryKey: query === undefined ? key : [...key, query],
    // `ctx.signal` is only read when a timeout is requested: reading it marks the query
    // cancellable, and cancellable queries abort when their last observer unmounts — in dev,
    // StrictMode's mount/unmount/mount then aborts the first fetch of EVERY query (five
    // ERR_ABORTED shell requests on each page load) and refetches from zero. Without the
    // signal the in-flight request is simply reused. Grid queries pass `timeoutMs`, so they
    // keep true cancellation (filter spam aborts stale list requests).
    queryFn: async (ctx) => {
      if (!timeoutMs || typeof AbortSignal.any !== 'function') return apiRequest<T>(path ?? '', { query });
      const { signal } = ctx;
      const timer = AbortSignal.timeout(timeoutMs);
      try {
        return await apiRequest<T>(path ?? '', { query, signal: AbortSignal.any([signal, timer]) });
      } catch (error) {
        // Not retried (TIMEOUT is neither NETWORK nor 5xx), so the error state shows right away.
        if (timer.aborted && !signal.aborted)
          throw new ApiError({
            code: 'TIMEOUT',
            message: 'The server took too long to respond. Try again.',
            status: 0,
          });
        throw error;
      }
    },
    enabled: path !== null && (enabled ?? true),
    ...rest,
  });
}

/* ---------------- field error mapping ---------------- */

/**
 * Copies server `fieldErrors` onto a react-hook-form instance. Unknown paths are
 * ignored (they are still in the toast). Returns how many fields were set; the first
 * one receives focus.
 */
export function applyServerFieldErrors<TForm extends FieldValues>(
  form: Pick<UseFormReturn<TForm>, 'setError' | 'getValues'>,
  error: unknown,
): number {
  if (!isApiError(error)) return 0;
  const values = form.getValues() as Record<string, unknown>;
  let applied = 0;
  for (const [path, messages] of Object.entries(error.fieldErrors)) {
    const message = messages[0];
    const root = path.split('.')[0] ?? path;
    if (!message || !(root in values)) continue;
    form.setError(path as Path<TForm>, { type: 'server', message }, { shouldFocus: applied === 0 });
    applied += 1;
  }
  return applied;
}

/* ---------------- mutations ---------------- */

export interface UseApiMutationOptions<TVars, TData, TForm extends FieldValues> {
  /** Static path, or derived from the variables (e.g. `(v) => \`/api/orders/${v.id}\``). */
  readonly path: string | ((vars: TVars) => string);
  readonly method?: Exclude<HttpMethod, 'GET'>;
  /** Body sent; defaults to the variables themselves. */
  readonly body?: (vars: TVars) => unknown;
  /** Query keys (prefix match) invalidated after success. */
  readonly invalidate?: readonly QueryKey[];
  /** Success toast; `false` silences it. String or builder from the response. */
  readonly successMessage?: string | false | ((data: TData, vars: TVars) => string);
  readonly successTitle?: string;
  /** Error toast title; `false` silences the error toast. */
  readonly errorTitle?: string | false;
  /** react-hook-form instance receiving server field errors. */
  readonly form?: Pick<UseFormReturn<TForm>, 'setError' | 'getValues'>;
  readonly onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
  readonly onError?: (error: ApiError, vars: TVars) => void;
}

function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return new ApiError({ code: 'INTERNAL', message, status: 0 });
}

const CONFLICT_MESSAGE = 'This record changed since you opened it — Reload';

export function useApiMutation<TVars = void, TData = unknown, TForm extends FieldValues = FieldValues>(
  options: UseApiMutationOptions<TVars, TData, TForm>,
): UseMutationResult<TData, ApiError, TVars> {
  const queryClient = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn: async (vars) => {
      try {
        const path = typeof options.path === 'function' ? options.path(vars) : options.path;
        const body = options.body ? options.body(vars) : vars;
        const { data } = await apiRequest<TData>(path, {
          method: options.method ?? 'POST',
          body: body ?? undefined,
        });
        return data;
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: async (data, vars) => {
      // Refresh in the background: awaiting the refetch kept drawers open for up to a minute
      // under load after a 200 (inventory REQ-R2-12). The toast and onSuccess run at once.
      for (const queryKey of options.invalidate ?? []) void queryClient.invalidateQueries({ queryKey });
      const { successMessage } = options;
      if (successMessage !== false && successMessage !== undefined) {
        const message = typeof successMessage === 'function' ? successMessage(data, vars) : successMessage;
        toast.success(options.successTitle ?? 'Success', message);
      }
      await options.onSuccess?.(data, vars);
    },
    onError: (error, vars) => {
      if (options.form) applyServerFieldErrors(options.form, error);
      if (options.errorTitle !== false) {
        toast.error(
          options.errorTitle ?? 'Error',
          error.code === 'CONFLICT' ? CONFLICT_MESSAGE : error.message,
        );
      }
      options.onError?.(error, vars);
    },
  });
}
