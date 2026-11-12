"use client";

import * as React from "react";
import { Warehouse } from "lucide-react";
import { contextLabel, OPEN_CONTEXT_SWITCHER_EVENT } from "@/lib/context-label";
import { useMe } from "@/lib/permissions-client";
import { useShell } from "./shell-context";

/** Asks the header context switcher to open (it listens for this event). */
export function openContextSwitcher(): void {
  window.dispatchEvent(new Event(OPEN_CONTEXT_SWITCHER_EVENT));
}

/**
 * Read-only working-context chip for pages scoped by the header context (dashboard):
 * "Viewing MLT1 - Main Fulfillment · All clients — Change". There is one scope control,
 * the header switcher, so two warehouse filters can never disagree.
 */
export function ContextChip() {
  const me = useMe();
  const { initialContext } = useShell();
  const data = me.data?.data;
  const label = data
    ? contextLabel({
        warehouse: data.contextOptions.warehouses.find((w) => w.id === data.context.warehouseId) ?? null,
        client: data.contextOptions.clients.find((c) => c.id === data.context.clientId) ?? null,
      })
    : initialContext;
  if (!label) return null;
  // The switcher only exists when there is something to switch; otherwise no "Change".
  const switchable = data ? data.contextOptions.warehouses.length > 1 || data.contextOptions.clients.length > 1 : (initialContext?.visible ?? false);
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs shadow-xs">
      <Warehouse className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="text-secondary">Viewing</span>
      <span className="font-semibold text-body">{label.long}</span>
      {switchable ? (
        <button
          type="button"
          onClick={openContextSwitcher}
          className="ml-1 rounded font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60"
        >
          Change
        </button>
      ) : null}
    </div>
  );
}
