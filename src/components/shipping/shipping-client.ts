"use client";

/**
 * Client helpers shared by the M02 pages (Carrier Shipment Details, End Of The Day,
 * Shipment History, Shipment Plans): facets for the filter builder, bulk calls, toasts
 * and file opening. Row shapes are type-only imports of the server repositories.
 */
import * as React from "react";
import { apiFetch, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { usePermissionSet } from "@/lib/permissions-client";
import { useShell } from "@/components/layout/shell-context";
import { withFacets, type ShippingFacets, type ShippingField } from "@/lib/grid-defs/shipping/common";
import type { FilterFieldDef } from "@/components/grid/grid-types";
import { toast } from "@/components/ui/toast";

export interface BulkOutcome {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

const noopSubscribe = () => () => {};

/**
 * Granted permission keys for gating M02 controls.
 *
 * Server render and the hydration pass read the app shell's set, which the (app) layout resolves
 * on the server for this request (`loadShellProps`). Both passes see the same set, so primary
 * actions ("Create shipment plan", Delete, Ship, Print, Void...) are in the first paint and there
 * is no hydration mismatch. After hydration, a loaded /api/me wins (it picks up role changes made
 * since the page was served). Outside the shell (unit tests) it falls back to /api/me alone.
 */
export function useHydratedPermissions(): ReadonlySet<string> {
  const hydrated = React.useSyncExternalStore(noopSubscribe, () => true, () => false);
  const { permissions: shellPermissions } = useShell();
  const { permissions: mePermissions, isLoading } = usePermissionSet();
  if (hydrated && !isLoading) return mePermissions;
  return shellPermissions ?? EMPTY_PERMISSIONS;
}
const EMPTY_PERMISSIONS: ReadonlySet<string> = new Set<string>();

export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  return isApiError(error) ? error.message : error instanceof Error ? error.message : fallback;
}

/** Scoped facet values (warehouses, clients, carriers, accounts, services) — cached for a minute. */
export function useShippingFacets() {
  return useApiQuery<ShippingFacets>(["shipping-facets"], "/api/shipments/facets", { staleTime: 60_000 });
}

/** Grid-def fields → filter-builder defs with facet options filled once they load. */
export function useFilterFields(fields: readonly ShippingField[]): readonly FilterFieldDef[] {
  const facets = useShippingFacets();
  const data = facets.data?.data;
  return React.useMemo(
    () =>
      withFacets(fields, data).map((f): FilterFieldDef => ({
        field: f.field,
        label: f.label,
        type: f.type,
        ...(f.options ? { options: f.options } : {}),
        ...(f.decimals !== undefined ? { decimals: f.decimals } : {}),
        ...(f.allowEmpty ? { allowEmpty: true } : {}),
        ...(f.group ? { group: f.group } : {}),
        ...(f.description ? { description: f.description } : {}),
      })),
    [fields, data],
  );
}

export function postJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body ?? {} });
}

/**
 * "3 of 4 labels voided · 1 failed" plus the first failure reasons. `labels` maps ids to
 * the human code shown in the message (tracking number, plan code, …).
 */
export function bulkToast(result: BulkOutcome, verb: string, noun: readonly [string, string], labels: ReadonlyMap<string, string>): void {
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  const base = `${ok} of ${all} ${all === 1 ? noun[0] : noun[1]} ${verb}`;
  if (result.failed.length === 0) {
    toast.success("Success", base);
    return;
  }
  const reasons = result.failed.slice(0, 3).map((f) => (f.message.includes(labels.get(f.id) ?? "\u0000") ? f.message : `${labels.get(f.id) ?? "Record"}: ${f.message}`)).join(" · ");
  const more = result.failed.length > 3 ? ` · +${result.failed.length - 3} more` : "";
  (ok > 0 ? toast.warning : toast.error)(ok > 0 ? `${base} · ${result.failed.length} failed` : "Nothing changed", `${reasons}${more}`);
}

export const fileUrl = (fileId: string, inline = true): string => `/api/files/${encodeURIComponent(fileId)}${inline ? "?inline=1" : ""}`;

/** Opens a stored file (PDF/ZPL) in a new tab; warns when the pop-up is blocked. */
export function openFile(fileId: string | null | undefined): void {
  if (!fileId) return;
  openExternal(fileUrl(fileId));
}

/**
 * Opens a URL in a new tab without giving it `window.opener`. (`window.open(…, "noopener")`
 * always returns null, so the pop-up check needs the handle first and drops the opener after.)
 */
export function openExternal(url: string): void {
  const w = window.open(url, "_blank");
  if (!w) {
    toast.warning("Pop-up blocked", "Allow pop-ups for KitStak to open this in a new tab.");
    return;
  }
  w.opener = null;
}

/**
 * Opens the new tab synchronously (inside the click, so pop-up blockers allow it), then
 * points it at the generated file once `load` resolves. The tab closes again when there is
 * nothing to show or the request fails (the error is re-thrown for the caller's toast).
 */
export async function openFileWhenReady<T extends { readonly fileId?: string | null }>(load: () => Promise<T>): Promise<T> {
  const w = typeof window === "undefined" ? null : window.open("", "_blank");
  if (w) {
    w.opener = null;
    try {
      w.document.title = "Preparing document…";
      w.document.body.innerHTML = '<p style="font:14px system-ui;color:#50575C;padding:24px">Preparing document…</p>';
    } catch {
      /* cross-origin blank page: nothing to write */
    }
  }
  try {
    const result = await load();
    if (!result.fileId) w?.close();
    else if (w) w.location.href = fileUrl(result.fileId);
    else openFile(result.fileId);
    return result;
  } catch (error) {
    w?.close();
    throw error;
  }
}

/** Triggers a download of a stored file. */
export function downloadFile(fileId: string): void {
  const a = document.createElement("a");
  a.href = fileUrl(fileId, false);
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Selection survives paging: remembers every row seen so bulk guards know the facts. */
export function useSeenRows<T extends { readonly id: string }>(rows: readonly T[], selectedIds: readonly string[]): readonly T[] {
  const [seen] = React.useState(() => new Map<string, T>());
  for (const r of rows) seen.set(r.id, r);
  return selectedIds.map((id) => seen.get(id)).filter((r): r is T => Boolean(r));
}
