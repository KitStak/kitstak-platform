"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Building, ChevronDown, Warehouse } from "lucide-react";
import { useApiMutation } from "@/lib/query-client";
import { ME_QUERY_KEY, useMe, type ContextOption } from "@/lib/permissions-client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { codeNameLabel } from "@/lib/utils";
import { contextLabel, OPEN_CONTEXT_SWITCHER_EVENT, type ContextLabelParts } from "@/lib/context-label";
import { useShell } from "./shell-context";

export const ALL_VALUE = "__all__";

/**
 * Same ghost style as HeaderIconButton; the summary shows from 1280px and is never
 * truncated (it is short: "MLT1 · All"), so it keeps priority over the search pill.
 */
const triggerClass =
  "hidden h-8 w-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-xs font-medium text-fg-secondary outline-none transition-colors md:flex " +
  "hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-pressed " +
  "xl:w-auto xl:justify-start xl:px-3";

export interface ContextSelectionDraft {
  readonly warehouseId: string | null;
  readonly clientId: string | null;
}

export function optionLabel(option: ContextOption | undefined, fallback: string): string {
  if (!option) return fallback;
  return codeNameLabel(option.code, option.name);
}

/** Short trigger text: "MLT1 · All" (never truncated) — long form goes in the tooltip. */
export function contextSummary(selection: ContextSelectionDraft, warehouses: readonly ContextOption[], clients: readonly ContextOption[]): string {
  return contextLabel(contextParts(selection, warehouses, clients)).summary;
}

function contextParts(selection: ContextSelectionDraft, warehouses: readonly ContextOption[], clients: readonly ContextOption[]): ContextLabelParts {
  return {
    warehouse: warehouses.find((w) => w.id === selection.warehouseId) ?? null,
    client: clients.find((c) => c.id === selection.clientId) ?? null,
  };
}

function toOptions(rows: readonly ContextOption[], allLabel: string) {
  return [{ value: ALL_VALUE, label: allLabel }, ...rows.map((row) => ({ value: row.id, label: optionLabel(row, row.name) }))];
}

/**
 * Header warehouse/client context (beats Logiwa, which has none). Narrows default list
 * scope via cookies set by PATCH /api/me; never widens the user's entitlement.
 */
export function ContextSwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const { initialContext } = useShell();
  const [open, setOpen] = React.useState(false);
  const current = me.data?.data.context ?? { warehouseId: null, clientId: null };
  const [draft, setDraft] = React.useState<ContextSelectionDraft>(current);
  // Read-only context chips elsewhere (dashboard) open this switcher instead of filtering locally.
  const currentRef = React.useRef(current);
  React.useEffect(() => {
    currentRef.current = current;
  });
  React.useEffect(() => {
    const onOpen = (): void => {
      setDraft(currentRef.current);
      setOpen(true);
    };
    window.addEventListener(OPEN_CONTEXT_SWITCHER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONTEXT_SWITCHER_EVENT, onOpen);
  }, []);
  const warehouses = me.data?.data.contextOptions.warehouses ?? [];
  const clients = me.data?.data.contextOptions.clients ?? [];

  const save = useApiMutation<{ context: ContextSelectionDraft }, unknown>({
    path: "/api/me",
    method: "PATCH",
    successMessage: "Context updated.",
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await queryClient.invalidateQueries();
      router.refresh();
    },
  });

  const loaded = Boolean(me.data);
  // Until /api/me answers, render the real trigger with the SSR label (no skeleton bar).
  const label = loaded ? contextLabel(contextParts(current, warehouses, clients)) : initialContext;
  const visible = loaded ? !(warehouses.length <= 1 && clients.length <= 1) : (initialContext?.visible ?? false);
  if (me.isError || !visible || !label) return null;

  const dirty = draft.warehouseId !== current.warehouseId || draft.clientId !== current.clientId;

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(current); }}>
      <Tooltip content={label.description} side="bottom">
        <PopoverTrigger asChild>
          {/* Named by its content (visible label first, then sr-only text) so the accessible name always contains what is shown. */}
          <button type="button" className={triggerClass}>
            <Warehouse className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
            <span className="hidden xl:max-[1439px]:inline">{label.compact}</span>
            <span className="hidden min-[1440px]:inline">{label.summary}</span>
            <span className="sr-only">{` — change working context (${label.description})`}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 text-fg-muted xl:block" aria-hidden />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[320px] space-y-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Working context</h2>
          <p className="text-xs text-secondary">Lists and dashboards default to this warehouse and client.</p>
        </div>
        {loaded ? null : (
          <div className="space-y-2" aria-label="Loading context options">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {loaded ? (
        <>
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-body"><Warehouse className="h-3.5 w-3.5" aria-hidden /> Warehouse</span>
          <Select aria-label="Warehouse" value={draft.warehouseId ?? ALL_VALUE} options={toOptions(warehouses, "All warehouses")} onChange={(v) => setDraft((d) => ({ ...d, warehouseId: v && v !== ALL_VALUE ? v : null }))} />
        </label>
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-body"><Building className="h-3.5 w-3.5" aria-hidden /> Client</span>
          <Select aria-label="Client" value={draft.clientId ?? ALL_VALUE} options={toOptions(clients, "All clients")} onChange={(v) => setDraft((d) => ({ ...d, clientId: v && v !== ALL_VALUE ? v : null }))} />
        </label>
        </>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate({ context: draft })}>
            {save.isPending ? "Applying…" : "Apply"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
