'use client';

/**
 * Client helpers shared by the M09 screens: filter fields with live options (clients,
 * lookups, pack types, stores, tags, custom-field names), bulk-result toasts, the
 * query invalidation used after every mutation, and small presentational bits.
 */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImageIcon, ShieldAlert } from 'lucide-react';
import { HomeLink, StatusScreen } from '@/components/layout/status-screen';
import { ListPageSkeleton } from './page-skeletons';
import type { FilterFieldDef } from '@/components/grid';
import { customFieldDefSchema, parseList } from '@/components/shared/contracts';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { useCan } from '@/lib/permissions-client';
import { CUSTOM_FIELD_FILTERS, PRODUCT_GRID_FIELDS } from '@/lib/grid-defs/products/products-grid';
import { LISTING_GRID_FIELDS } from '@/lib/grid-defs/products/listings-grid';
import type { ProductGridOptions } from '@/server/repositories/products-options';
import type { ListingOptions } from '@/server/repositories/listings';

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
 * `useCan` that stays "loading" until hydration finishes. Streamed Suspense boundaries hydrate
 * after the app shell has already fetched /api/me, so a plain `useCan` would render mutation
 * controls on the first client pass that the server never rendered (hydration mismatch).
 */
export function useCatalogCan(permission: string | readonly string[]): {
  readonly allowed: boolean;
  readonly isLoading: boolean;
} {
  const hydrated = useHydrated();
  const can = useCan(permission, typeof permission === 'string' ? 'all' : 'any');
  return hydrated ? can : { allowed: false, isLoading: true };
}

/**
 * Renders the page only when the user can view it: a skeleton while permissions load, then a
 * designed access-denied state instead of a grid whose request would 403 (and spin forever).
 */
export function CatalogViewGate({
  permission,
  title,
  children,
  deniedTitle,
  deniedDescription,
  deniedActions,
}: {
  readonly permission: string | readonly string[];
  readonly title: string;
  readonly children: React.ReactNode;
  readonly deniedTitle?: string;
  readonly deniedDescription?: string;
  readonly deniedActions?: React.ReactNode;
}) {
  const can = useCatalogCan(permission);
  if (can.isLoading) return <ListPageSkeleton title={title} />;
  if (!can.allowed) {
    return (
      <StatusScreen
        code="403"
        icon={ShieldAlert}
        tone="warning"
        title={deniedTitle ?? `You don't have access to ${title}`}
        description={
          deniedDescription ??
          'Your role does not include permission to view this page. Ask an administrator to update your role in Settings › Roles.'
        }
        actions={deniedActions ?? <HomeLink />}
      />
    );
  }
  return <>{children}</>;
}

/** Grid-level "taking longer than usual · Retry" hint (after 3 s pending). */
export function SlowGridNotice({
  pending,
  onRetry,
  noun,
}: {
  readonly pending: boolean;
  readonly onRetry: () => void;
  readonly noun: string;
}) {
  const slow = useSlow(pending, 3000);
  if (!slow) return null;
  return (
    <div className="px-6 pb-2">
      <Callout
        variant="attention"
        title="This is taking longer than usual"
        action={
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        Still loading {noun}. You can keep waiting or retry.
      </Callout>
    </div>
  );
}

/** True once `pending` has lasted longer than `ms` (drives "still loading · Retry" hints). */
export function useSlow(pending: boolean, ms = 8000): boolean {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    if (!pending) {
      setSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [pending, ms]);
  return pending && slow;
}

export type { ProductListRow } from '@/server/repositories/products';
export type { ListingRow } from '@/server/repositories/listings';
export type {
  ProductDetailData,
  PackTypeView,
  InventoryBucketView,
} from '@/server/repositories/products-detail';

export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

export interface DeleteCheckRow {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly status: string;
  readonly reason: string | null;
}

/** Invalidates every catalog list and detail after a mutation. */
export function useInvalidateCatalog(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['grid'] }),
      qc.invalidateQueries({ queryKey: ['product-detail'] }),
      qc.invalidateQueries({ queryKey: ['product-form'] }),
      qc.invalidateQueries({ queryKey: ['change-log'] }),
      qc.invalidateQueries({ queryKey: ['product-grid-options'] }),
    ]);
  }, [qc]);
}

/** Products grid filter fields with live options + custom-field names. */
export function useProductFilterFields(): readonly FilterFieldDef[] {
  const opts = useApiQuery<ProductGridOptions>(['product-grid-options'], '/api/products/options', {
    query: { for: 'grid' },
    staleTime: 60_000,
  });
  const defs = useApiQuery<unknown>(['custom-fields', 'product'], '/api/custom-fields', {
    query: { entityType: 'product' },
    staleTime: 60_000,
  });
  const data = opts.data?.data;
  const defData = defs.data?.data;
  return React.useMemo(() => {
    const defBySlot = new Map(parseList(customFieldDefSchema, defData).map((d) => [d.slot, d]));
    return PRODUCT_GRID_FIELDS.map((f): FilterFieldDef => {
      const slot = CUSTOM_FIELD_FILTERS[f.field];
      const def = slot ? defBySlot.get(slot) : undefined;
      let options = f.options?.map((v) => ({ value: v, label: v }));
      if (f.optionsFrom && data)
        options = data[f.optionsFrom].map((o) => ({
          value: o.value,
          label: o.description ? `${o.label} (${o.description})` : o.label,
        }));
      if (def?.options?.length && f.type === 'text') {
        return {
          field: f.field,
          label: def.name,
          type: 'enum',
          group: f.group,
          options: def.options.map((v) => ({ value: v, label: v })),
        };
      }
      return {
        field: f.field,
        label: def ? def.name : f.label,
        type: f.type,
        ...(f.group ? { group: f.group } : {}),
        ...(f.decimals !== undefined ? { decimals: f.decimals } : {}),
        ...(options ? { options } : {}),
      };
    });
  }, [data, defData]);
}

/** Listings grid filter fields with live client / store / tag options. */
export function useListingFilterFields(): {
  fields: readonly FilterFieldDef[];
  options: ListingOptions | undefined;
} {
  const opts = useApiQuery<ListingOptions>(['listing-options'], '/api/listings/options', {
    staleTime: 60_000,
  });
  const data = opts.data?.data;
  const fields = React.useMemo(
    () =>
      LISTING_GRID_FIELDS.map((f): FilterFieldDef => {
        const options =
          f.options ??
          (f.optionsFrom && data
            ? data[f.optionsFrom].map((o) => ({ value: o.value, label: o.label }))
            : undefined);
        return {
          field: f.field,
          label: f.label,
          type: f.type,
          ...(f.decimals !== undefined ? { decimals: f.decimals } : {}),
          ...(options ? { options } : {}),
        };
      }),
    [data],
  );
  return { fields, options: data };
}

export function errorMessage(error: unknown): string {
  if (isApiError(error))
    return error.code === 'CONFLICT' ? 'This record changed since you opened it — Reload' : error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
}

export async function postBulk(path: string, body: Record<string, unknown>): Promise<BulkResult> {
  const { data } = await apiRequest<BulkResult>(path, { method: 'POST', body });
  return data;
}

/** "3 of 4 products deleted · 1 failed (SKU: reason)". */
export function bulkToast(
  result: BulkResult,
  labelFor: (id: string) => string,
  verbs: { readonly done: string; readonly noun: string },
): void {
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  if (result.failed.length === 0) {
    toast.success('Success', `${ok} ${verbs.noun}${ok === 1 ? '' : 's'} ${verbs.done}.`);
    return;
  }
  const detail = result.failed
    .slice(0, 3)
    .map((f) => `${labelFor(f.id)}: ${f.message}`)
    .join(' · ');
  const more = result.failed.length > 3 ? ` · +${result.failed.length - 3} more` : '';
  toast.show({
    variant: ok === 0 ? 'error' : 'warning',
    title: ok === 0 ? 'Error' : 'Partly done',
    message: `${ok} of ${all} ${verbs.noun}s ${verbs.done} · ${result.failed.length} failed. ${detail}${more}`,
    duration: 9000,
  });
}

/** Two-letter initials for an image-less product thumb ("Blue Widget Large" → "BW"). */
export function productInitials(label: string): string {
  const words = label
    .trim()
    .split(/[\s_/-]+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));
  return words
    .slice(0, 2)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, '').charAt(0))
    .join('')
    .toUpperCase();
}

/**
 * Same-origin src for a product image. Remote http(s) URLs (Shopify / Amazon CDNs …) go
 * through the `/api/products/image` proxy, because the app CSP only allows same-origin images.
 */
export function productImageSrc(url: string | null | undefined): string | null {
  const v = url?.trim() ?? '';
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return `/api/products/image?u=${encodeURIComponent(v)}`;
  if (v.startsWith('/') || /^(data|blob):/i.test(v)) return v;
  return null;
}

export function ProductThumb({
  url,
  size = 32,
  label,
}: {
  readonly url: string | null | undefined;
  readonly size?: number;
  readonly label: string;
}) {
  const src = productImageSrc(url);
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;
  const setFailed = () => setFailedSrc(src);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken"
      style={{ width: size, height: size }}
      title={label}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDNs (proxied same-origin)
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={setFailed}
        />
      ) : (
        // No image: a neutral placeholder (initials derived from SKU-like names read as noise).
        <ImageIcon
          className="text-faint"
          style={{
            width: Math.max(12, Math.round(size * 0.45)),
            height: Math.max(12, Math.round(size * 0.45)),
          }}
          aria-label={`${label}: no image`}
        />
      )}
    </span>
  );
}

/** Product-label print records (one per product, primary barcode). */
export function productLabelRecords(
  rows: readonly { sku: string; barcode: string; name: string; clientCode?: string; uom?: string }[],
): unknown[] {
  return rows.map((r) => ({
    sku: r.sku,
    barcode: r.barcode || r.sku,
    name: r.name,
    clientCode: r.clientCode || undefined,
    packType: r.uom || undefined,
  }));
}

/**
 * Logiwa places Products under Inventory (Home > Inventory > Products). The nav-group move is
 * shared config (REQ-6); catalog pages pass these crumbs explicitly so the trail is right now.
 */
export const CATALOG_CRUMBS = [
  { label: 'Inventory', href: '/inventory' },
  { label: 'Products', href: '/products' },
] as const;

/**
 * Warm the shared modal/drawer queries so they open with content instead of a spinner under
 * slow API latency (Print Options template list, Tag list, product change log). Same keys and
 * params as PrintOptionsModal / TagPopover / ChangeLogDrawer, so they read this cache.
 */
export function usePrefetchPrintouts(enabled: boolean, clientId?: string | null): void {
  useApiQuery<unknown>(['printouts', 'product-label', clientId ?? ''], enabled ? '/api/printouts' : null, {
    query: { typeKeys: 'product-label', clientId: clientId ?? undefined },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function usePrefetchTags(scope: string, enabled: boolean): void {
  useApiQuery<unknown>(['tags', scope], enabled ? '/api/tags' : null, {
    query: { scope },
    staleTime: 60_000,
  });
}

export function usePrefetchChangeLog(entityType: string, entityId: string | null, enabled: boolean): void {
  useApiQuery<unknown>(
    ['change-log', entityType, entityId ?? ''],
    enabled && entityId ? '/api/change-log' : null,
    {
      query: { entityType, entityId: entityId ?? '', page: 1, ps: 20 },
      staleTime: 30_000,
    },
  );
}
