"use client";

/**
 * Grid column slots for an entity's active custom fields (Logiwa: "Custom Field Text Box 1"
 * etc. in the column chooser). Columns are hidden by default, named after the field
 * definition, and sort through the `customField.<slot>` server binding.
 */
import * as React from "react";
import { useApiQuery } from "@/lib/query-client";
import type { GridColumnDef } from "@/components/grid";
import { customFieldDefSchema, parseList } from "@/components/shared/contracts";
import { customFieldsQueryKey } from "@/components/shared/custom-fields-drawer";
import { useFormat } from "@/lib/format";
import { Muted, YesNo } from "./facility-shared";

type WithCustomFields = { readonly customFields?: Readonly<Record<string, string | boolean | null>> | null };

/** Columns for the active custom fields of `entityType`, in slot order. */
export function useCustomFieldColumns<T extends WithCustomFields>(entityType: string): readonly GridColumnDef<T>[] {
  const query = useApiQuery<unknown>(customFieldsQueryKey(entityType), "/api/custom-fields", { query: { entityType }, staleTime: 60_000 });
  const fmt = useFormat();
  return React.useMemo(() => {
    const defs = parseList(customFieldDefSchema, query.data?.data).filter((d) => d.isActive);
    return defs.map<GridColumnDef<T>>((d) => ({
      id: `customField.${d.slot}`,
      header: d.name,
      size: 150,
      meta: { defaultVisible: false, label: `${d.name} (custom field)` },
      cell: ({ row }) => {
        const v = row.original.customFields?.[d.slot];
        if (v === null || v === undefined || v === "") return <Muted />;
        if (typeof v === "boolean") return <YesNo value={v} />;
        if (d.slot.startsWith("date")) return fmt.date(v);
        return v;
      },
    }));
  }, [query.data, fmt]);
}

/** Read-only "Custom fields" block for a detail page; renders nothing when no field is defined. */
export function CustomFieldValuesList({ entityType, values }: { readonly entityType: string; readonly values: Readonly<Record<string, string | boolean | null>> | null | undefined }) {
  const query = useApiQuery<unknown>(customFieldsQueryKey(entityType), "/api/custom-fields", { query: { entityType }, staleTime: 60_000 });
  const fmt = useFormat();
  const defs = parseList(customFieldDefSchema, query.data?.data).filter((d) => d.isActive);
  if (defs.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-secondary">Custom fields</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        {defs.map((d) => {
          const v = values?.[d.slot];
          return (
            <div key={d.slot} className="min-w-0">
              <dt className="text-[11px] text-faint">{d.name}</dt>
              <dd className="mt-0.5 break-words text-[13px] text-foreground">
                {v === null || v === undefined || v === "" ? <Muted /> : typeof v === "boolean" ? <YesNo value={v} /> : d.slot.startsWith("date") ? fmt.date(v) : v}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
