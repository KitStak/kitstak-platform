"use client";

/**
 * TanStack Query platform (BUILD_PLAN F4.1).
 *   <QueryProvider>                      mount once in the root layout
 *   useApiQuery(key, path, opts)         GET through apiFetch (envelope unwrapped)
 *   useApiMutation({ path, method, invalidate, form })
 *       - toasts on success and on error
 *       - maps server `fieldErrors` onto react-hook-form fields (focus first error)
 */
import * as React from "react";
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
} from "@tanstack/react-query";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import { toast } from "@/components/ui/toast";
import { ApiError, apiRequest, isApiError, type ApiMeta, type ApiRequestOptions, type HttpMethod } from "./api-client";

const DEFAULT_STALE_MS = 30_000;
const MAX_QUERY_RETRIES = 2;
/** Errors that retrying cannot fix. */
const NON_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "VALIDATION", "NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED", "CSRF", "CONFLICT", "INVALID_STATE", "DUPLICATE",
]);

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (!isApiError(error) || NON_RETRYABLE_CODES.has(error.code)) return false;
  return error.code === "NETWORK" || error.status >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: DEFAULT_STALE_MS, retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

let browserClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return createQueryClient();
  browserClient ??= createQueryClient();
  return browserClient;
}

export function QueryProvider({ children, client }: { readonly children: React.ReactNode; readonly client?: QueryClient }) {
  const [queryClient] = React.useState(() => client ?? getQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/* ---------------- queries ---------------- */

export interface ApiQueryData<T> {
  readonly data: T;
  readonly meta?: ApiMeta;
}

export type UseApiQueryOptions<T> = Omit<UseQueryOptions<ApiQueryData<T>, ApiError>, "queryKey" | "queryFn"> & {
  readonly query?: ApiRequestOptions["query"];
};

/**
 * GET `path`. Returns the TanStack result whose `data` is `{ data, meta }` so list
 * pages get `meta.total`. Pass `enabled: false` to defer; `path: null` also disables.
 */
export function useApiQuery<T>(key: QueryKey, path: string | null, options: UseApiQueryOptions<T> = {}): UseQueryResult<ApiQueryData<T>, ApiError> {
  const { query, enabled, ...rest } = options;
  return useQuery<ApiQueryData<T>, ApiError>({
    queryKey: query === undefined ? key : [...key, query],
    queryFn: ({ signal }) => apiRequest<T>(path ?? "", { query, signal }),
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
export function applyServerFieldErrors<TForm extends FieldValues>(form: Pick<UseFormReturn<TForm>, "setError" | "getValues">, error: unknown): number {
  if (!isApiError(error)) return 0;
  const values = form.getValues() as Record<string, unknown>;
  let applied = 0;
  for (const [path, messages] of Object.entries(error.fieldErrors)) {
    const message = messages[0];
    const root = path.split(".")[0] ?? path;
    if (!message || !(root in values)) continue;
    form.setError(path as Path<TForm>, { type: "server", message }, { shouldFocus: applied === 0 });
    applied += 1;
  }
  return applied;
}

/* ---------------- mutations ---------------- */

export interface UseApiMutationOptions<TVars, TData, TForm extends FieldValues> {
  /** Static path, or derived from the variables (e.g. `(v) => \`/api/orders/${v.id}\``). */
  readonly path: string | ((vars: TVars) => string);
  readonly method?: Exclude<HttpMethod, "GET">;
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
  readonly form?: Pick<UseFormReturn<TForm>, "setError" | "getValues">;
  readonly onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
  readonly onError?: (error: ApiError, vars: TVars) => void;
}

function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  const message = error instanceof Error ? error.message : "Something went wrong";
  return new ApiError({ code: "INTERNAL", message, status: 0 });
}

const CONFLICT_MESSAGE = "This record changed since you opened it — Reload";

export function useApiMutation<TVars = void, TData = unknown, TForm extends FieldValues = FieldValues>(
  options: UseApiMutationOptions<TVars, TData, TForm>
): UseMutationResult<TData, ApiError, TVars> {
  const queryClient = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn: async (vars) => {
      try {
        const path = typeof options.path === "function" ? options.path(vars) : options.path;
        const body = options.body ? options.body(vars) : vars;
        const { data } = await apiRequest<TData>(path, { method: options.method ?? "POST", body: body ?? undefined });
        return data;
      } catch (error) {
        throw toApiError(error);
      }
    },
    onSuccess: async (data, vars) => {
      await Promise.all((options.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      const { successMessage } = options;
      if (successMessage !== false && successMessage !== undefined) {
        const message = typeof successMessage === "function" ? successMessage(data, vars) : successMessage;
        toast.success(options.successTitle ?? "Success", message);
      }
      await options.onSuccess?.(data, vars);
    },
    onError: (error, vars) => {
      if (options.form) applyServerFieldErrors(options.form, error);
      if (options.errorTitle !== false) {
        toast.error(options.errorTitle ?? "Error", error.code === "CONFLICT" ? CONFLICT_MESSAGE : error.message);
      }
      options.onError?.(error, vars);
    },
  });
}
