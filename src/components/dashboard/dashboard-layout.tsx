"use client";

/**
 * Per-user dashboard layout: which cards show, in what order, and the warehouse / client the
 * dashboard opens on when the URL names none. Saved in the viewer's grid prefs under
 * `dashboard-layout` (order = card order, visible = shown cards, pinned = `wh:<id>` / `cl:<id>`
 * defaults), so it follows the user across browsers with no schema change.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, LayoutGrid, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { QueryClientContext } from "@tanstack/react-query";
import type { FilterOption } from "./filter-bar";

export const DASHBOARD_LAYOUT_KEY = "dashboard-layout";

export const DASHBOARD_CARDS = [
  { id: "progress", label: "Progress for Today" },
  { id: "unfulfilled", label: "Unfulfilled Orders" },
  { id: "breakdown", label: "Order Breakdown by Status" },
  { id: "channels", label: "Channels" },
  { id: "clients", label: "Clients" },
  { id: "carriers", label: "Carriers" },
  { id: "countries", label: "Order By Country" },
  { id: "jobs", label: "Jobs" },
] as const;
export type DashboardCardId = (typeof DASHBOARD_CARDS)[number]["id"];
const CARD_IDS: readonly string[] = DASHBOARD_CARDS.map((c) => c.id);

export interface DashboardLayout {
  readonly order: readonly DashboardCardId[];
  readonly hidden: readonly DashboardCardId[];
  readonly defaultWarehouseIds: readonly string[];
  readonly defaultClientIds: readonly string[];
}

export const DEFAULT_LAYOUT: DashboardLayout = { order: DASHBOARD_CARDS.map((c) => c.id), hidden: [], defaultWarehouseIds: [], defaultClientIds: [] };

interface StoredPrefs {
  readonly visible?: readonly string[];
  readonly order?: readonly string[];
  readonly widths?: Readonly<Record<string, number>>;
  readonly density?: string;
  readonly pageSize?: number;
  readonly pinned?: readonly string[];
}

/** Stored prefs → layout. Unknown card ids are dropped and new cards appended in default order. */
export function layoutFromPrefs(raw: StoredPrefs | null | undefined): DashboardLayout {
  if (!raw) return DEFAULT_LAYOUT;
  const known = (raw.order ?? []).filter((id): id is DashboardCardId => CARD_IDS.includes(id));
  const order = [...new Set([...known, ...DEFAULT_LAYOUT.order])] as DashboardCardId[];
  const visible = raw.visible && raw.visible.length ? new Set(raw.visible) : null;
  const hidden = visible ? order.filter((id) => !visible.has(id)) : [];
  const pinned = raw.pinned ?? [];
  return {
    order, hidden,
    defaultWarehouseIds: pinned.filter((p) => p.startsWith("wh:")).map((p) => p.slice(3)).filter(Boolean),
    defaultClientIds: pinned.filter((p) => p.startsWith("cl:")).map((p) => p.slice(3)).filter(Boolean),
  };
}

/** Layout → grid prefs body (`visible` always lists at least one card so "all hidden" is never stored as "default"). */
export function layoutToPrefs(l: DashboardLayout): Required<Pick<StoredPrefs, "visible" | "order" | "pinned">> & { widths: Record<string, number>; density: "Small"; pageSize: number } {
  const visible = l.order.filter((id) => !l.hidden.includes(id));
  return {
    order: [...l.order], visible: visible.length ? visible : [l.order[0] ?? "progress"], widths: {}, density: "Small", pageSize: 100,
    pinned: [...l.defaultWarehouseIds.map((id) => `wh:${id}`), ...l.defaultClientIds.map((id) => `cl:${id}`)],
  };
}

export function moveCard(order: readonly DashboardCardId[], id: DashboardCardId, delta: -1 | 1): DashboardCardId[] {
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j] as DashboardCardId, next[i] as DashboardCardId];
  return next;
}

export function useDashboardLayout(): { readonly layout: DashboardLayout; readonly loaded: boolean; readonly save: (next: DashboardLayout) => Promise<void> } {
  const q = useApiQuery<StoredPrefs | null>(["grid-prefs", DASHBOARD_LAYOUT_KEY], `/api/grid-prefs/${DASHBOARD_LAYOUT_KEY}`, { staleTime: 60_000 });
  const client = React.useContext(QueryClientContext);
  const [optimistic, setOptimistic] = React.useState<DashboardLayout | null>(null);
  const layout = optimistic ?? layoutFromPrefs(q.data?.data);
  const save = React.useCallback(async (next: DashboardLayout) => {
    setOptimistic(next);
    try {
      await apiRequest(`/api/grid-prefs/${DASHBOARD_LAYOUT_KEY}`, { method: "PUT", body: layoutToPrefs(next) });
      await client?.invalidateQueries({ queryKey: ["grid-prefs", DASHBOARD_LAYOUT_KEY] });
    } catch {
      toast.error("Could not save the dashboard layout");
    } finally {
      setOptimistic(null);
    }
  }, [client]);
  return { layout, loaded: !q.isPending, save };
}

export function CustomizeDashboard({ layout, onSave, warehouses, clients }: {
  readonly layout: DashboardLayout;
  readonly onSave: (next: DashboardLayout) => void;
  readonly warehouses: readonly FilterOption[];
  readonly clients: readonly FilterOption[];
}) {
  const label = (id: DashboardCardId) => DASHBOARD_CARDS.find((c) => c.id === id)?.label ?? id;
  const shown = layout.order.length - layout.hidden.length;
  const setHidden = (id: DashboardCardId, hide: boolean) => onSave({ ...layout, hidden: hide ? [...layout.hidden, id] : layout.hidden.filter((h) => h !== id) });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" aria-label="Customize dashboard">
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden />Customize
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-3" aria-label="Customize dashboard">
        <p className="text-sm font-semibold text-foreground">Cards</p>
        <p className="text-2xs text-faint">Show, hide and reorder. Saved to your account.</p>
        <ul className="mt-2 flex flex-col gap-0.5" aria-label="Dashboard cards">
          {layout.order.map((id, i) => {
            const visible = !layout.hidden.includes(id);
            return (
              <li key={id} data-card={id} className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-surface-sunken">
                <Checkbox
                  checked={visible}
                  disabled={visible && shown <= 1}
                  onCheckedChange={(c) => setHidden(id, c !== true)}
                  aria-label={`Show ${label(id)}`}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-body">{label(id)}</span>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => onSave({ ...layout, order: moveCard(layout.order, id, -1) })}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${label(id)} down`} disabled={i === layout.order.length - 1} onClick={() => onSave({ ...layout, order: moveCard(layout.order, id, 1) })}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-sm font-semibold text-foreground">Open on</p>
          <p className="text-2xs text-faint">Used when the link names no warehouse or client.</p>
          <div className="mt-2 grid gap-2">
            <Select
              size="sm" clearable aria-label="Default warehouse" placeholder="Header warehouse (default)"
              options={warehouses.map((w) => ({ value: w.id, label: w.label }))}
              value={layout.defaultWarehouseIds[0] ?? null}
              onChange={(v) => onSave({ ...layout, defaultWarehouseIds: v ? [v] : [] })}
            />
            <Select
              size="sm" clearable aria-label="Default client" placeholder="Header client (default)"
              options={clients.map((c) => ({ value: c.id, label: c.label }))}
              value={layout.defaultClientIds[0] ?? null}
              onChange={(v) => onSave({ ...layout, defaultClientIds: v ? [v] : [] })}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={() => onSave(DEFAULT_LAYOUT)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />Reset to default
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
