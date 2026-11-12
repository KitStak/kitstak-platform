'use client';

/** Client helpers for the count pages (M07): filter fields, bulk command runner, warehouse options. */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, isApiError } from '@/lib/api-client';
import { useCan, useMe, type PermissionInput, type PermissionMode } from '@/lib/permissions-client';
import type { FilterFieldDef } from '@/components/grid/grid-types';
import { toast } from '@/components/ui/toast';
import { bulkResultSchema, bulkSummary, type BulkResultData } from '@/components/shared/contracts';
import type { CountGridField } from '@/lib/grid-defs/counts/count-grids';

export interface WarehouseOption {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
}

const subscribeNoop = () => () => undefined;

/**
 * `useCan` that stays `false` while hydrating. The page renders inside Suspense, so it can
 * hydrate after /api/me has resolved; gating on hydration keeps the server and first client
 * render identical (no hydration mismatch on permission-gated header buttons).
 */
export function useCountCan(
  required: PermissionInput,
  mode: PermissionMode = 'all',
): { readonly allowed: boolean } {
  const hydrated = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const { allowed } = useCan(required, mode);
  return { allowed: hydrated && allowed };
}

export function useWarehouses(): readonly WarehouseOption[] {
  const me = useMe();
  return me.data?.data.contextOptions.warehouses ?? [];
}

/** Grid-def fields → filter builder fields; `warehouseId` choices come from the viewer's scope. */
export function useFilterFields(fields: readonly CountGridField[]): readonly FilterFieldDef[] {
  const warehouses = useWarehouses();
  return React.useMemo(
    () =>
      fields.map((f): FilterFieldDef => {
        const options =
          f.field === 'warehouseId'
            ? warehouses.map((w) => ({ value: w.id, label: w.code ?? w.name }))
            : f.options?.map((value) => ({ value, label: value }));
        return {
          field: f.field,
          label: f.label,
          type: f.type,
          ...(f.decimals !== undefined ? { decimals: f.decimals } : {}),
          ...(options ? { options } : {}),
        };
      }),
    [fields, warehouses],
  );
}

/** Invalidates every count grid and detail after a command. */
export function useRefreshCounts(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['grid', 'count-plans'] }),
      qc.invalidateQueries({ queryKey: ['grid', 'count-locations'] }),
      qc.invalidateQueries({ queryKey: ['grid', 'count-skus'] }),
      qc.invalidateQueries({ queryKey: ['count-plan'] }),
      qc.invalidateQueries({ queryKey: ['count-sheet'] }),
      qc.invalidateQueries({ queryKey: ['count-summary'] }),
      qc.invalidateQueries({ queryKey: ['timeline-ledger'] }),
      qc.invalidateQueries({ queryKey: ['count-actors'] }),
      qc.invalidateQueries({ queryKey: ['count-job-preview'] }),
      qc.invalidateQueries({ queryKey: ['change-log'] }),
    ]);
  }, [qc]);
}

/** A count command that has not answered after this long is abandoned with a retryable error. */
export const COUNT_COMMAND_TIMEOUT_MS = 45_000;

const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');

/** Runs a bulk command and toasts "2 of 3 count plans cancelled · 1 failed" with the first reason. */
export async function runBulkCommand(
  path: string,
  body: Record<string, unknown>,
  noun: string,
  verb: string,
  timeoutMs = COUNT_COMMAND_TIMEOUT_MS,
): Promise<BulkResultData | null> {
  try {
    const result = bulkResultSchema.parse(
      await apiFetch<unknown>(path, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) }),
    );
    const summary = bulkSummary(result, noun, verb);
    const first = result.failed[0];
    if (result.succeeded.length === 0 && first) toast.error('Error', first.message);
    else if (first) toast.warning('Partly done', `${summary}. ${first.message}`);
    else toast.success('Success', summary);
    return result;
  } catch (error) {
    if (isTimeout(error)) {
      toast.error(
        'No response from the server',
        `The request took longer than ${Math.round(timeoutMs / 1000)} s. Refresh to check whether it went through, then try again.`,
      );
      return null;
    }
    toast.error('Error', isApiError(error) ? error.message : 'The request failed. Try again.');
    return null;
  }
}

export const errorMessage = (error: unknown, fallback = 'Something went wrong. Try again.'): string =>
  isApiError(error) ? error.message : fallback;

/** A count read that has not answered after this long shows its error state with Retry instead of an endless skeleton. */
export const COUNT_QUERY_TIMEOUT_MS = 30_000;
