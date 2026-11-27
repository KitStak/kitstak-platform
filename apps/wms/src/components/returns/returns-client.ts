'use client';

/**
 * Client helpers shared by the M04 returns screens: grid filter fields, lookups
 * (return / damage reasons), query invalidation, error text and file opening.
 */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FilterFieldDef } from '@/components/grid';
import { isApiError } from '@/lib/api-client';
import { useCan, useMe, type PermissionInput } from '@/lib/permissions-client';
import { useApiQuery } from '@/lib/query-client';
import { RETURN_GRID_FIELDS } from '@/lib/grid-defs/returns/return-orders';

export const RETURN_KEYS = {
  grid: ['grid', 'return-orders'] as const,
  summary: ['returns', 'summary'] as const,
  detail: (id: string) => ['return-order', id] as const,
};

/** Filter-builder fields for the Return Orders grid (23 Logiwa filters + Source, Disposition). */
export function useReturnFilterFields(): readonly FilterFieldDef[] {
  return React.useMemo(
    () =>
      RETURN_GRID_FIELDS.map((f): FilterFieldDef => ({
        field: f.field,
        label: f.label,
        type: f.type,
        ...(f.group ? { group: f.group } : {}),
        ...(f.options ? { options: f.options.map((v) => ({ value: v, label: v })) } : {}),
      })),
    [],
  );
}

export function useInvalidateReturns(): () => Promise<void> {
  const qc = useQueryClient();
  // Fire-and-forget: refetching every active grid can take seconds in dev, and a
  // committed write must never wait on it (the station screen shows success at once).
  return React.useCallback(async () => {
    void Promise.all([
      qc.invalidateQueries({ queryKey: ['grid'] }),
      qc.invalidateQueries({ queryKey: ['returns'] }),
      qc.invalidateQueries({ queryKey: ['return-order'] }),
      qc.invalidateQueries({ queryKey: ['change-log'] }),
    ]);
  }, [qc]);
}

export interface StationKpis {
  readonly returnedOrdersToday: number;
  readonly returnedProductsToday: number;
  readonly openReturns: number;
}

/**
 * Writes the KPIs a receive returned (computed in the same transaction) straight into the
 * Return Station tile cache, so the tiles change the moment the receive commits instead of
 * waiting on a refetch of a busy server. The invalidation that follows reconciles.
 */
export function useApplyStationKpis(): (warehouseId: string, kpis: StationKpis | undefined) => void {
  const qc = useQueryClient();
  return React.useCallback(
    (warehouseId: string, kpis: StationKpis | undefined) => {
      if (!kpis) return;
      qc.setQueriesData<{ data: StationKpis }>({ queryKey: ['returns', 'kpis', warehouseId] }, (old) =>
        old ? { ...old, data: kpis } : { data: kpis },
      );
    },
    [qc],
  );
}

export interface LookupValue {
  readonly id: string;
  readonly name: string;
  readonly isActive?: boolean;
}

/** Active Data Setup values of a type (e.g. `return_reason`, `damage_reason`). */
export function useLookupOptions(
  type: string,
  clientId?: string | null,
): readonly { readonly value: string; readonly label: string }[] {
  const q = useApiQuery<readonly LookupValue[]>(['lookups', type, clientId ?? ''], `/api/lookups/${type}`, {
    query: clientId ? { clientId } : undefined,
    staleTime: 60_000,
  });
  return React.useMemo(() => (q.data?.data ?? []).map((l) => ({ value: l.id, label: l.name })), [q.data]);
}

export function errorText(error: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(error))
    return error.code === 'CONFLICT' ? 'This return changed since you opened it. Reload and try again.' : error.message;
  return error instanceof Error ? error.message : fallback;
}

/** Field error of an ApiError (`items.0.quantity`), if any. */
export function fieldErrorOf(error: unknown, path: string): string | null {
  if (!isApiError(error)) return null;
  return error.fieldErrors?.[path]?.[0] ?? null;
}

export function fileHref(fileId: string): string {
  return `/api/files/${fileId}`;
}

export function openFileId(fileId: string | null | undefined): void {
  if (fileId) window.open(fileHref(fileId), '_blank', 'noopener,noreferrer');
}

const noopSubscribe = () => () => {};
/** False on the server render and during hydration, true afterwards. */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * `useCan` that stays "loading" until hydration finishes. The station and returns pages sit
 * in streamed Suspense boundaries that hydrate after the shell has fetched /api/me, so a plain
 * `useCan` renders controls on the first client pass that the server never rendered.
 */
export function useHydratedCan(required: PermissionInput): {
  readonly allowed: boolean;
  readonly isLoading: boolean;
} {
  const hydrated = useHydrated();
  const can = useCan(required);
  return hydrated ? can : { allowed: false, isLoading: true };
}

/** `/api/me` data, withheld until hydration finishes (same reason as `useHydratedCan`). */
export function useHydratedMe(): ReturnType<typeof useMe>['data'] {
  const hydrated = useHydrated();
  const me = useMe();
  return hydrated ? me.data : undefined;
}

/** "warehouse_manager" → "Warehouse Manager" for the station user cards (Logiwa shows the role). */
export function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return role
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Like `useLookupOptions`, plus whether the list is still loading (so selects never flash "none set up"). */
export function useLookupState(
  type: string,
  clientId?: string | null,
): {
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly loading: boolean;
} {
  const q = useApiQuery<readonly LookupValue[]>(['lookups', type, clientId ?? ''], `/api/lookups/${type}`, {
    query: clientId ? { clientId } : undefined,
    staleTime: 60_000,
  });
  const options = React.useMemo(
    () => (q.data?.data ?? []).map((l) => ({ value: l.id, label: l.name })),
    [q.data],
  );
  return { options, loading: q.isPending };
}
