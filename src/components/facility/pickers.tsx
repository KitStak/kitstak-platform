"use client";

/** Async product picker (client-scoped) + LP type options for a warehouse. */
import * as React from "react";
import { z } from "zod";
import { searchPicker, toOption } from "@/components/shared/entity-pickers";
import { Combobox } from "@/components/ui/combobox";
import { useApiQuery } from "@/lib/query-client";
import type { Option } from "./facility-shared";

export function ProductPicker({ id, clientId, value, selectedLabel, onChange, invalid, disabled, category, onBlur }: {
  readonly id?: string;
  readonly clientId: string | null;
  readonly value: string | null;
  readonly selectedLabel?: string;
  readonly onChange: (value: string | null, label: string | null) => void;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  /** e.g. "Packaging Material" for shipment-package tracking. */
  readonly category?: string;
  readonly onBlur?: () => void;
}) {
  const load = React.useCallback(async (q: string, signal: AbortSignal) => (await searchPicker("products", q, { clientId }, signal)).map(toOption), [clientId]);
  return (
    <Combobox
      key={clientId ?? "none"}
      id={id}
      aria-label="Product"
      loadOptions={load}
      minChars={0}
      selectedOptions={value && selectedLabel ? [{ value, label: selectedLabel }] : undefined}
      value={value}
      onChange={(v, opt) => onChange(v, opt ? String(opt.label) : null)}
      placeholder={clientId ? "Search SKU or name" : "Select a client first"}
      disabled={disabled || !clientId}
      invalid={invalid}
      onBlur={onBlur}
      clearable
    />
  );
}

const lpTypeRow = z.object({ id: z.string(), code: z.string(), warehouseCode: z.string(), numberPrefix: z.string(), numberLength: z.number(), nextSequence: z.number().optional() });
export type LpTypeOption = Option & { readonly prefix: string; readonly length: number; readonly next: number };

/** LP types shown as "CODE (WH)" (Logiwa parity), optionally for one warehouse. */
export function useLpTypeOptions(warehouseId: string | null | undefined): { readonly options: readonly LpTypeOption[]; readonly loading: boolean } {
  const query = useApiQuery<unknown>(["lp-types-options", warehouseId ?? "all"], "/api/lp-types", { query: { ps: 1000, ...(warehouseId ? { "f.warehouseId": `in:${warehouseId}` } : {}) }, staleTime: 30_000 });
  const parsed = z.array(lpTypeRow).safeParse(query.data?.data);
  const options = parsed.success ? parsed.data.map((t) => ({ value: t.id, label: `${t.code} (${t.warehouseCode})`, prefix: t.numberPrefix, length: t.numberLength, next: t.nextSequence ?? 1 })) : [];
  return { options, loading: query.isPending };
}

const locationOption = z.object({ id: z.string(), code: z.string(), areaType: z.string().nullable() });

/** Locations of a warehouse, narrowed to area types ("Receiving", ...), as select options. */
export function useWarehouseLocationOptions(warehouseId: string | null | undefined, areas: readonly string[]): { readonly options: readonly Option[]; readonly loading: boolean } {
  const area = areas.join(",");
  const query = useApiQuery<unknown>(["warehouse-locations", warehouseId ?? "", area], warehouseId ? `/api/warehouses/${warehouseId}/locations` : null, { query: { area }, staleTime: 30_000 });
  const parsed = z.array(locationOption).safeParse(query.data?.data);
  const options = parsed.success ? parsed.data.map((l) => ({ value: l.id, label: l.areaType ? `${l.code} · ${l.areaType}` : l.code })) : [];
  return { options, loading: Boolean(warehouseId) && query.isPending };
}
