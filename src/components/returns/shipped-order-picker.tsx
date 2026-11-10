"use client";

/**
 * "Choose a shipped order" dialog for Create RMA and Return Manually. Searches shipped /
 * delivered orders (newest shipment first) by order code, store order # or customer via
 * `GET /api/returns/shippable/search`, and shows the units still returnable. Replaces the
 * shared OrderPickerDrawer here until it works with its API (docs/requests/stations-returns.md REQ-2).
 * Keyboard: type to search, arrows move, Enter uses the highlighted order.
 */
import * as React from "react";
import { PackageSearch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/ui/tooltip";
import { StatusPill } from "@/components/ui/status-pill";
import { TextField } from "@/components/ui/text-field";
import { useFormat } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import type { ApiQueryData } from "@/lib/query-client";
import { cn } from "@/lib/utils";

interface ShippedHit {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly customerName: string;
  readonly storeOrderNumber: string | null;
  readonly clientName: string;
  readonly shippedAt: string | null;
  readonly shippedUnits: number;
  readonly returnableUnits: number;
  /** 1 when the order shipped with every outbound label voided. */
  readonly outboundLabelVoided?: number | boolean;
}

export interface ShippedOrderPickerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (orderId: string) => void | Promise<void>;
  readonly clientId?: string | null;
  readonly warehouseId?: string | null;
  readonly title?: string;
  readonly confirmLabel?: string;
}

const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 50;
/** Abort a search after this long and show an error with Retry instead of endless skeleton rows. */
export const PICKER_TIMEOUT_MS = 15_000;
/** After this long, the skeleton says the server is slow (still cancellable / retryable). */
const SLOW_HINT_MS = 4_000;

function useDebounced(value: string, ms: number): string {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ShippedOrderPicker({ open, onOpenChange, ...rest }: ShippedOrderPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Content unmounts when closed, so the search and highlight start fresh on every open. */}
        {open ? <PickerBody onOpenChange={onOpenChange} {...rest} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ onOpenChange, onPick, clientId, warehouseId, title = "Choose a shipped order", confirmLabel = "Use order" }: Omit<ShippedOrderPickerProps, "open">) {
  const fmt = useFormat();
  const [text, setText] = React.useState("");
  const [cursor, setCursor] = React.useState<{ readonly q: string; readonly index: number }>({ q: "", index: 0 });
  const [busy, setBusy] = React.useState(false);
  const q = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const query = React.useMemo(() => ({ ...(q ? { q } : {}), ...(clientId ? { clientId } : {}), ...(warehouseId ? { warehouseId } : {}) }), [q, clientId, warehouseId]);
  const list = useQuery<ApiQueryData<readonly ShippedHit[]>, Error>({
    queryKey: ["returns", "shipped-search", query], staleTime: 0, retry: 0, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => {
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      signal.addEventListener("abort", onAbort);
      const timer = setTimeout(() => ctl.abort(new DOMException("timeout", "TimeoutError")), PICKER_TIMEOUT_MS);
      return apiRequest<readonly ShippedHit[]>("/api/returns/shippable/search", { query, signal: ctl.signal })
        .catch((e: unknown) => {
          if (ctl.signal.aborted && !signal.aborted) throw new Error(`The order search took longer than ${PICKER_TIMEOUT_MS / 1000} seconds. Check your connection and retry.`);
          throw e;
        })
        .finally(() => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); });
    },
  });
  // "Still loading" hint for the current search only (keyed, so a new search starts quiet again).
  const searchKey = JSON.stringify(query);
  const [slowFor, setSlowFor] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!list.isFetching) return;
    const t = setTimeout(() => setSlowFor(searchKey), SLOW_HINT_MS);
    return () => clearTimeout(t);
  }, [list.isFetching, searchKey]);
  const slow = list.isFetching && slowFor === searchKey;
  const rows = list.data?.data ?? [];
  const enabled = rows.map((r, i) => (r.returnableUnits > 0 ? i : -1)).filter((i) => i >= 0);
  /** Active option: never a disabled (fully returned) row; -1 when none can be picked. */
  const active = nearestEnabled(enabled, cursor.q === q ? cursor.index : 0);
  const chosen = active >= 0 ? rows[active] ?? null : null;
  const listRef = React.useRef<HTMLUListElement>(null);
  const move = (index: number) => {
    setCursor({ q, index });
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const choose = async (row: ShippedHit | null) => {
    if (!row || busy || row.returnableUnits === 0) return;
    setBusy(true);
    try { await onPick(row.id); } finally { setBusy(false); }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); const n = enabled.find((i) => i > active); if (n !== undefined) move(n); }
    else if (e.key === "ArrowUp") { e.preventDefault(); const n = [...enabled].reverse().find((i) => i < active); if (n !== undefined) move(n); }
    else if (e.key === "Enter") { e.preventDefault(); void choose(chosen); }
  };

  return (
    <>

        <DialogHeader title={title} description="Only shipped and delivered orders can be returned. Search by order code, store order # or customer." />
        <DialogBody className="space-y-3">
          <TextField autoFocus aria-label="Search orders" placeholder="Order code, store order # or customer" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown}
            leading={<Search className="h-3.5 w-3.5 text-faint" aria-hidden />} onClear={text ? () => setText("") : undefined} />
          {list.isPending && !list.error ? <div className="space-y-1.5" role="status" aria-live="polite" aria-label="Loading shipped orders">{slow ? <p className="text-[12px] text-secondary">Still loading. The server is slow; this stops after {PICKER_TIMEOUT_MS / 1000} seconds with a Retry.</p> : null}{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            : list.error ? <Callout variant="error" title="Could not load orders" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>{list.error.message}</Callout>
            : rows.length === 0 ? <EmptyState compact icon={PackageSearch} title="No shipped orders match" description={q ? `Nothing shipped matches "${q}".` : "Orders show here once they ship."} />
            : (
              <ul ref={listRef} role="listbox" aria-label="Shipped orders" className="max-h-[380px] overflow-auto rounded-lg border border-border">
                {rows.map((r, i) => {
                  const done = r.returnableUnits === 0;
                  return (
                    <li key={r.id} data-index={i} role="option" aria-selected={!done && i === active} aria-disabled={done || undefined} onMouseEnter={done ? undefined : () => setCursor({ q, index: i })} onClick={() => void choose(r)} onDoubleClick={() => void choose(r)}
                      title={done ? "Every shipped unit is already on a return" : undefined}
                      className={cn("flex items-center gap-3 border-b border-border px-3 py-2 text-[13px] last:border-0", done ? "cursor-not-allowed opacity-55" : "cursor-pointer", !done && i === active ? "bg-primary-soft" : done ? "" : "hover:bg-surface-sunken")}>
                      <span className="w-[92px] shrink-0">
                        <span className="block font-semibold text-foreground">{r.code}</span>
                        <span className="block text-[11px] text-secondary">{r.shippedAt ? fmt.date(r.shippedAt) : "—"}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{r.customerName}</span>
                        <span className="block truncate text-[11px] text-secondary">{r.clientName}{r.storeOrderNumber ? ` · ${r.storeOrderNumber}` : ""}</span>
                        {r.outboundLabelVoided ? <span className="mt-0.5 block text-[11px] font-medium text-warning" data-testid="picker-label-voided" title="Every outbound shipping label on this order was voided before it shipped. Check that the parcel really left the warehouse before authorising a return.">Outbound label voided: check the shipment</span> : null}
                      </span>
                      <span className="w-28 shrink-0 text-right text-[12px] tabular-nums text-secondary">{done ? "All returned" : `${r.returnableUnits} of ${r.shippedUnits} returnable`}</span>
                      <StatusPill status={r.status} domain="shipmentOrder" size="sm" />
                    </li>
                  );
                })}
              </ul>
            )}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-[12px] text-secondary">{list.isPending && !list.error ? "Loading…" : list.error ? "Not loaded" : rows.length === RESULT_LIMIT ? `Newest ${RESULT_LIMIT} shown. Search to narrow down.` : `${rows.length} order${rows.length === 1 ? "" : "s"}`}</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          {(() => {
            const reason = list.isPending && !list.error ? "Wait for the orders to load" : list.error ? "The orders could not be loaded. Retry first." : !chosen ? "Choose an order from the list" : null;
            return (
              <DisabledReason reason={busy ? null : reason}>
                <Button variant="primary" disabled={Boolean(reason) || busy} aria-busy={busy} onClick={() => void choose(chosen)}>{busy ? <Spinner className="h-3.5 w-3.5" label="Loading order" /> : null}{confirmLabel}</Button>
              </DisabledReason>
            );
          })()}
        </DialogFooter>
    </>
  );
}

/** First enabled index at or after `from`, else the last enabled one before it; -1 when none. */
export function nearestEnabled(enabled: readonly number[], from: number): number {
  const after = enabled.find((i) => i >= from);
  if (after !== undefined) return after;
  return enabled.length ? enabled[enabled.length - 1] : -1;
}
