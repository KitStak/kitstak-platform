'use client';

/** Async product picker (client-scoped) + LP type options for a warehouse. */
import * as React from 'react';
import { z } from 'zod';
import { PICKER_LIMIT, searchPicker, toOption } from '@/components/shared/entity-pickers';
import type { PickerItem } from '@/components/shared/contracts';
import { Combobox } from '@/components/ui/combobox';
import { useApiQuery } from '@/lib/query-client';
import type { Option } from './facility-shared';

export function ProductPicker({
  id,
  clientId,
  value,
  selectedLabel,
  onChange,
  invalid,
  disabled,
  category,
  onBlur,
}: {
  readonly id?: string;
  readonly clientId: string | null;
  readonly value: string | null;
  readonly selectedLabel?: string;
  readonly onChange: (value: string | null, label: string | null, isKit?: boolean) => void;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  /** e.g. "Packaging Material" for shipment-package tracking. */
  readonly category?: string;
  readonly onBlur?: () => void;
}) {
  // Preload the client's first page as soon as the client is known, and answer a search from it
  // locally when that page is the whole catalogue (critic: "Searching…" for 2.5 s after typing "a").
  const firstPage = React.useRef<{ key: string; items: Promise<readonly PickerItem[]> } | null>(null);
  const key = `${clientId ?? ''}|${category ?? ''}`;
  const pageFor = React.useCallback(() => {
    if (!clientId) return null;
    if (firstPage.current?.key !== key) {
      const items = searchPicker('products', '', { clientId }).catch(() => [] as readonly PickerItem[]);
      firstPage.current = { key, items };
    }
    return firstPage.current.items;
  }, [clientId, key]);
  React.useEffect(() => {
    void pageFor();
  }, [pageFor]);
  // Kits are tagged so a kit is never picked by mistake (critic R4: APX-KIT-TEE3 offered as a pick-face SKU).
  const kits = React.useRef(new Set<string>());
  const asOption = React.useCallback((item: PickerItem) => {
    const kit = isKitItem(item);
    if (kit) kits.current.add(item.id);
    const option = toOption(item);
    return kit
      ? { ...option, description: option.description ? `Kit · ${option.description}` : 'Kit' }
      : option;
  }, []);
  const load = React.useCallback(
    async (q: string, signal: AbortSignal) => {
      const page = pageFor();
      const first = page ? await page : [];
      const needle = q.trim().toLowerCase();
      if (!needle && first.length > 0) return first.map(asOption);
      if (first.length > 0 && first.length < PICKER_LIMIT)
        return first
          .filter((i) => `${i.label} ${i.description ?? ''}`.toLowerCase().includes(needle))
          .map(asOption);
      return (await searchPicker('products', q, { clientId }, signal)).map(asOption);
    },
    [clientId, pageFor, asOption],
  );
  return (
    <Combobox
      key={clientId ?? 'none'}
      id={id}
      aria-label="Product"
      loadOptions={load}
      minChars={0}
      selectedOptions={value && selectedLabel ? [{ value, label: selectedLabel }] : undefined}
      value={value}
      onChange={(v, opt) => onChange(v, opt ? String(opt.label) : null, v ? kits.current.has(v) : false)}
      placeholder={clientId ? 'Search SKU or name' : 'Select a client first'}
      disabled={disabled || !clientId}
      invalid={invalid}
      onBlur={onBlur}
      clearable
    />
  );
}

/** True when a products picker item is a kit (`meta.isKit` from /api/pickers/products). Pure; exported for tests. */
export function isKitItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const meta = (item as { meta?: unknown }).meta;
  return Boolean(meta && typeof meta === 'object' && (meta as { isKit?: unknown }).isKit);
}

const lpTypeRow = z.object({
  id: z.string(),
  code: z.string(),
  warehouseCode: z.string(),
  numberPrefix: z.string(),
  numberLength: z.number(),
  nextSequence: z.number().optional(),
});
export type LpTypeOption = Option & {
  readonly prefix: string;
  readonly length: number;
  readonly next: number;
};

/** LP types shown as "CODE (WH)" (Logiwa parity), optionally for one warehouse. */
export function useLpTypeOptions(warehouseId: string | null | undefined): {
  readonly options: readonly LpTypeOption[];
  readonly loading: boolean;
} {
  const query = useApiQuery<unknown>(['lp-types-options', warehouseId ?? 'all'], '/api/lp-types', {
    query: { ps: 1000, ...(warehouseId ? { 'f.warehouseId': `in:${warehouseId}` } : {}) },
    staleTime: 30_000,
  });
  const parsed = z.array(lpTypeRow).safeParse(query.data?.data);
  const options = parsed.success
    ? parsed.data.map((t) => ({
        value: t.id,
        label: `${t.code} (${t.warehouseCode})`,
        prefix: t.numberPrefix,
        length: t.numberLength,
        next: t.nextSequence ?? 1,
      }))
    : [];
  return { options, loading: query.isPending };
}

const locationOption = z.object({ id: z.string(), code: z.string(), areaType: z.string().nullable() });

/** Locations of a warehouse, narrowed to area types ("Receiving", ...), as select options. */
export function useWarehouseLocationOptions(
  warehouseId: string | null | undefined,
  areas: readonly string[],
): { readonly options: readonly Option[]; readonly loading: boolean } {
  const area = areas.join(',');
  const query = useApiQuery<unknown>(
    ['warehouse-locations', warehouseId ?? '', area],
    warehouseId ? `/api/warehouses/${warehouseId}/locations` : null,
    { query: { area }, staleTime: 30_000 },
  );
  const parsed = z.array(locationOption).safeParse(query.data?.data);
  const options = parsed.success
    ? parsed.data.map((l) => ({ value: l.id, label: l.areaType ? `${l.code} · ${l.areaType}` : l.code }))
    : [];
  return { options, loading: Boolean(warehouseId) && query.isPending };
}
