"use client";

/**
 * Shared client pieces for the M12 pages (automation + integrations): warehouse/lookup options, grid filter fields,
 * permission flags, Yes/No + availability cells, bulk-result toasts, and a change log
 * drawer for entities served by the module's own `/change-log` endpoints.
 */
import * as React from "react";
import { z } from "zod";
import { ChevronLeft, ChevronRight, FilePlus2, PencilLine, Trash2 } from "lucide-react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { formatPattern, gridDateTimePattern, useFormat } from "@/lib/format";
import { browserTimeZone } from "@/lib/grid-defs/integrations/time";
import { PAGE_TAB_GROUPS, type PageTabGroupKey } from "@/config/page-tabs";
import { useShellAllows } from "@/components/layout/shell-context";
import type { PageTabItem } from "@/components/ui/tabs";
import { useMe, usePermissionSet } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";
import { bulkSummary, splitCamel, type IntegrationField } from "@/lib/grid-defs/integrations/common";
import type { FilterFieldDef } from "@/components/grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";

export interface Option {
  readonly value: string;
  readonly label: string;
}

/** Warehouses in the viewer's scope ("MLT1 · MLT1 - Main Fulfillment"). */
export function useWarehouseOptions(): { readonly options: readonly Option[]; readonly short: readonly Option[]; readonly defaultId: string | null; readonly loading: boolean } {
  const me = useMe();
  const list = me.data?.data.contextOptions.warehouses ?? [];
  const context = me.data?.data.context.warehouseId ?? null;
  return {
    options: list.map((w) => ({ value: w.id, label: w.code ? `${w.code} · ${w.name}` : w.name })),
    short: list.map((w) => ({ value: w.id, label: w.code ?? w.name })),
    defaultId: context ?? (list.length === 1 ? (list[0]?.id ?? null) : null),
    loading: me.isPending,
  };
}

export function useClientOptions(): readonly Option[] {
  const me = useMe();
  return (me.data?.data.contextOptions.clients ?? []).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }));
}

const lookupRow = z.object({ id: z.string(), name: z.string(), isActive: z.boolean().optional(), warehouseId: z.string().nullish(), meta: z.record(z.string(), z.unknown()).nullish() });
export type LookupRow = z.infer<typeof lookupRow>;

/** Data Setup values of a type, narrowed to a warehouse (global values included). */
export function useLookups(type: string, warehouseId?: string | null): { readonly rows: readonly LookupRow[]; readonly options: readonly Option[]; readonly loading: boolean } {
  const query = useApiQuery<unknown>(["lookups", type, warehouseId ?? "all"], `/api/lookups/${type}`, { query: { warehouseId: warehouseId ?? undefined }, staleTime: 60_000 });
  const parsed = z.array(lookupRow).safeParse(query.data?.data);
  const rows = parsed.success ? parsed.data.filter((r) => r.isActive !== false) : [];
  return { rows, options: rows.map((r) => ({ value: r.id, label: r.name })), loading: query.isPending };
}

const entityRow = z.object({ id: z.string(), name: z.string().nullish(), code: z.string().nullish(), displayName: z.string().nullish() });
const ENTITY_SOURCES = { retailer: "/api/retailers", package: "/api/shipment-packages" } as const;

/**
 * Options for rule values that reference records (Retailer, Shipment Package). Users without
 * the list permission get an empty list (the API answers 403), never an error state.
 */
export function useEntityOptions(kind: keyof typeof ENTITY_SOURCES | null): readonly Option[] {
  const query = useApiQuery<unknown>(["rule-entities", kind ?? "none"], kind ? ENTITY_SOURCES[kind] : null, { query: { ps: 500 }, staleTime: 60_000, retry: false });
  const parsed = z.array(entityRow).safeParse(query.data?.data);
  return parsed.success ? parsed.data.map((r) => ({ value: r.id, label: r.name ?? r.displayName ?? r.code ?? r.id })) : [];
}

/** Pure field list -> filter-builder defs, with page-supplied options for id enums. */
export function toFilterFields(fields: readonly IntegrationField[], dynamic: Readonly<Record<string, readonly Option[]>> = {}): readonly FilterFieldDef[] {
  return fields.map((f) => {
    const options = dynamic[f.field] ?? f.options?.map((v) => ({ value: v, label: splitCamel(v) }));
    return { field: f.field, label: f.label, type: f.type, ...(f.decimals !== undefined ? { decimals: f.decimals } : {}), ...(options ? { options } : {}) };
  });
}

/** Permission flags for one catalog page, e.g. `settings.locations`. */
export function usePagePerms<A extends string>(page: string, actions: readonly A[]): Readonly<Record<A, boolean>> & { readonly loading: boolean } {
  const { permissions, isLoading } = usePermissionSet();
  // Optimistic while /api/me is still loading: a slow permissions call must not make the page look
  // read-only for tens of seconds. Every API re-checks the permission (403 → toast), and controls
  // settle to the real answer as soon as permissions arrive.
  const out = Object.fromEntries(actions.map((a) => [a, isLoading || permissions.has(`${page}.${a}`)])) as Record<A, boolean>;
  return { ...out, loading: isLoading };
}

export const NO_PERMISSION = "You don't have permission for this action";

/* ---------------- cells ---------------- */

/**
 * Status domain for integration run/call statuses. "No Data" (a run with nothing to send) is not a
 * failure, so it renders neutral grey through the generic map instead of the integration map's red.
 */
export function integrationDomain(status: string | null | undefined): "integration" | "generic" {
  return (status ?? "").trim().toLowerCase() === "no data" ? "generic" : "integration";
}

export function YesNo({ value }: { readonly value: boolean | null | undefined }) {
  return value ? <Badge tone="success" size="sm" shape="pill">Yes</Badge> : <Badge tone="neutral" size="sm" shape="pill">No</Badge>;
}

export function Muted({ children }: { readonly children?: React.ReactNode }) {
  return <span className="text-faint">{children ?? "—"}</span>;
}

export function Num({ value, decimals = 0, unit }: { readonly value: number | null | undefined; readonly decimals?: number; readonly unit?: string | null }) {
  if (value === null || value === undefined) return <Muted />;
  return (
    <span className={cn("tabular-nums", value === 0 && "text-faint")}>
      {value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {unit ? <span className="ml-0.5 text-2xs text-faint">{unit}</span> : null}
    </span>
  );
}

/* ---------------- stable route tabs ---------------- */

/**
 * The page-tab strip of a config group, filtered to what the role can open but never hidden:
 * the shared `GroupTabs` drops the strip when one tab is left, which shifts the page shell
 * for viewers. M12 pages keep the bar so the layout is the same for every role.
 */
export function useStableGroupTabs(group: PageTabGroupKey): readonly PageTabItem[] {
  const allows = useShellAllows();
  return React.useMemo(
    () => PAGE_TAB_GROUPS[group].filter((t) => allows(t.permission)).map((t) => ({ href: t.href, exact: t.exact, match: t.match, label: t.label })),
    [group, allows],
  );
}

/* ---------------- dates (one formatter for the whole module) ---------------- */

export interface ModuleDates {
  /** Grid/detail date-time: "11/09/2026 9:21 PM" (user pattern, padded, no seconds). */
  readonly dateTime: (value: string | number | Date | null | undefined) => string;
  /** Full precision for tooltips: "11/9/2026 9:21:14 PM". */
  readonly full: (value: string | number | Date | null | undefined) => string;
  /** Date only, same padding: "11/09/2026". */
  readonly date: (value: string | number | Date | null | undefined) => string;
  /** A `YYYY-MM-DD` local-day key → "11/09/2026" (no zone shift). */
  readonly day: (key: string) => string;
}

/**
 * The single date/time formatter of M12 pages, so Missing Orders, Recent Errors, Setup Details and
 * the logs all read the same ("11/09/2026 9:21 PM"). Built on the user's format preferences.
 */
export function useModuleDates(): ModuleDates {
  const fmt = useFormat();
  return React.useMemo(() => {
    const datePattern = gridDateTimePattern(fmt.prefs.dateFormat).split(/\s+[Hh]/)[0] ?? "MM/DD/YYYY";
    const day = (key: string) => {
      const [y, m, d] = key.split("-").map(Number);
      return y && m && d ? formatPattern(new Date(y, m - 1, d), datePattern) : key;
    };
    return {
      dateTime: (v) => fmt.gridDateTime(v),
      full: (v) => fmt.dateTime(v),
      // A date-only value ("2026-12-01": expiry, order date) is a calendar day, not UTC midnight.
      date: (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? day(v) : formatPattern(v, datePattern)),
      day,
    };
  }, [fmt]);
}

/** A date-time cell: compact text, full timestamp on hover, never truncated. */
export function DateTimeText({ value, empty = "—" }: { readonly value: string | null | undefined; readonly empty?: string }) {
  const dates = useModuleDates();
  if (!value) return <Muted>{empty}</Muted>;
  return <span className="whitespace-nowrap tabular-nums" title={dates.full(value)}>{dates.dateTime(value)}</span>;
}

/** The viewer's IANA time zone, sent as `tz` so the server buckets days the way the UI renders them. */
export function useViewerTimeZone(): string {
  return React.useMemo(() => browserTimeZone(), []);
}

/* ---------------- mutations ---------------- */

export interface BulkResponse {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

/** Runs a JSON mutation, toasts the outcome and invalidates queries. Returns data or null. */
export function useAction(invalidate: readonly QueryKey[]) {
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async <T,>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, onError?: (e: unknown) => void): Promise<T | null> => {
      setPending(true);
      try {
        const { data } = await apiRequest<T>(path, { method, body });
        await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
        return data;
      } catch (error) {
        if (onError) onError(error);
        else toast.error("Error", isApiError(error) ? (error.code === "CONFLICT" ? "This record changed since you opened it — Reload" : error.message) : "Something went wrong");
        return null;
      } finally {
        setPending(false);
      }
    },
    [qc, invalidate],
  );
  return { run, pending };
}

/** "3 of 4 locations deleted · 1 failed" plus the first failure reasons. */
export function toastBulk(result: BulkResponse, noun: string, verb: string): void {
  const message = bulkSummary(result, noun, verb);
  if (result.failed.length === 0) {
    toast.success("Success", message);
    return;
  }
  const reasons = result.failed.slice(0, 3).map((f) => f.message).join(" · ");
  const more = result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : "";
  (result.succeeded.length === 0 ? toast.error : toast.warning)(result.succeeded.length === 0 ? "Nothing changed" : "Partly done", `${message}. ${reasons}${more}`);
}

/* ---------------- change log (module endpoints) ---------------- */

const logEntry = z.object({ id: z.string(), type: z.enum(["Create", "Update", "Delete"]), message: z.string(), fieldLabel: z.string().nullish(), fromValue: z.string().nullish(), toValue: z.string().nullish(), source: z.string(), at: z.string() });

const TYPE_META = {
  Create: { icon: FilePlus2, tile: "bg-success-soft text-success" },
  Update: { icon: PencilLine, tile: "bg-info-soft text-info" },
  Delete: { icon: Trash2, tile: "bg-danger-soft text-danger" },
} as const;

const LOG_PAGE = 20;

export function EntityChangeLogDrawer({ open, onOpenChange, path, title }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly path: string | null; readonly title: string }) {
  const fmt = useFormat();
  const [page, setPage] = React.useState(1);
  const query = useApiQuery<unknown>(["entity-change-log", path ?? "", page], open && path ? path : null, { query: { page, ps: LOG_PAGE }, placeholderData: (p) => p });
  const parsed = z.array(logEntry).safeParse(query.data?.data);
  const rows = parsed.success ? parsed.data : [];
  const total = query.data?.meta?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / LOG_PAGE));
  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) setPage(1); onOpenChange(o); }} title={title} description="Every create, edit and delete with who made it and when." width={45}>
      {query.isPending ? (
        <SkeletonTable rows={6} columns={4} />
      ) : query.isError ? (
        <EmptyState title="Couldn't load the change log" description={query.error.message} action={<Button onClick={() => void query.refetch()}>Retry</Button>} compact />
      ) : rows.length === 0 ? (
        <EmptyState title="No changes recorded yet" description="Edits to this record will appear here." compact />
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => {
              const meta = TYPE_META[r.type];
              const Icon = meta.icon;
              return (
                <li key={r.id} className="flex gap-3 px-3 py-2.5">
                  <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md", meta.tile)}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    {r.type === "Update" && r.fieldLabel ? (
                      <p className="text-sm text-body">
                        <span className="font-medium">{r.fieldLabel}</span>{" "}
                        <span className="text-faint line-through decoration-faint/60">{r.fromValue || "—"}</span>
                        <span className="mx-1 text-faint">→</span>
                        <span className="font-medium text-foreground">{r.toValue || "—"}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-body">{r.message}</p>
                    )}
                    <p className="mt-0.5 text-2xs text-faint"><span title={fmt.dateTime(r.at)}>{fmt.gridDateTime(r.at)}</span> · {r.source}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between text-xs text-secondary">
            <span>Total: {total}</span>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="tabular-nums">{page} / {pages}</span>
              <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ---------------- detail lists ---------------- */

export interface DetailItem {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly wide?: boolean;
}

/** Two-column label/value grid used by the "Show details" drawers. */
export function DetailList({ title, items }: { readonly title?: string; readonly items: readonly DetailItem[] }) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h3 className="text-xs font-semibold text-secondary">{title}</h3> : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
        {items.map((i) => (
          <div key={i.label} className={cn("min-w-0", i.wide && "col-span-2")}>
            <dt className="text-2xs text-faint">{i.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-foreground">{i.value === null || i.value === undefined || i.value === "" ? <Muted /> : i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Small stat tiles across the top of a detail drawer. */
export function StatRow({ stats }: { readonly stats: readonly { readonly label: string; readonly value: React.ReactNode; readonly tone?: "danger" | "warning" | "success" }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-surface-sunken/60 px-3 py-2">
          <p className="text-2xs text-faint">{s.label}</p>
          <p className={cn("text-lg font-semibold tabular-nums text-foreground", s.tone === "danger" && "text-danger", s.tone === "warning" && "text-warning", s.tone === "success" && "text-success")}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

/** How long a prefetched edit-drawer detail stays fresh, so the drawer opens populated without a remounting refetch. */
export const DRAWER_DETAIL_STALE_MS = 30_000;

/**
 * Warms the detail query for each listed connection (same key the edit drawer uses), so opening
 * Edit renders the tabs immediately instead of a skeleton. Small lists only (connection lists are
 * per provider); capped at 25 rows.
 */
export function usePrefetchDetails(keyPrefix: string, pathPrefix: string, ids: readonly string[]): (id: string) => void {
  const qc = useQueryClient();
  const prefetch = React.useCallback((id: string) => {
    void qc.prefetchQuery({ queryKey: [keyPrefix, id], queryFn: ({ signal }) => apiRequest(`${pathPrefix}/${id}`, { signal }), staleTime: DRAWER_DETAIL_STALE_MS });
  }, [qc, keyPrefix, pathPrefix]);
  const joined = ids.slice(0, 25).join(",");
  React.useEffect(() => { if (joined) for (const id of joined.split(",")) prefetch(id); }, [joined, prefetch]);
  return prefetch;
}
