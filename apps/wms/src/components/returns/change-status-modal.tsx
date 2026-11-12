"use client";

/**
 * Change Status (M04 §6, KitStaks-designed): asks the server which target statuses are
 * legal for the selection, offers only those (illegal ones are shown disabled with the
 * reason), then posts the bulk change and reports the per-id result.
 */
import * as React from "react";
import { ArrowRight } from "lucide-react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { RETURN_STATUS_HELP } from "@/lib/grid-defs/returns/return-orders";
import type { ReturnStatus } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { bulkMessage, partialRmaNotes, type BulkOutcome, type SelectionTransitions } from "./return-types";

export interface ChangeStatusModalProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** RMA ids, or grid line ids (resolved server-side). */
  readonly selection: { readonly ids?: readonly string[]; readonly lineIds?: readonly string[] };
  readonly version?: number;
  /** Current statuses of the selection (known from the grid rows), shown while the legal moves load. */
  readonly currentStatuses?: readonly string[];
  readonly onDone: () => void;
}

export function ChangeStatusModal({ open, onOpenChange, selection, version, currentStatuses, onDone }: ChangeStatusModalProps) {
  const query = selection.ids?.length ? { ids: selection.ids.join(",") } : { lineIds: (selection.lineIds ?? []).join(",") };
  const transitions = useApiQuery<SelectionTransitions>(["returns", "transitions", query], open ? "/api/returns/transitions" : null, { query, staleTime: 0 });
  const [target, setTarget] = React.useState<ReturnStatus | null>(null);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setTarget(null); setNote(""); setError(null); }
  }, [open]);

  const data = transitions.data?.data;
  const count = data?.returns.length ?? selection.ids?.length ?? 0;
  const statuses = data ? [...new Set(data.returns.map((r) => r.status))] : [...new Set(currentStatuses ?? [])];

  const submit = async (): Promise<void> => {
    if (!target) { setError("Choose the new status."); return; }
    setSaving(true);
    setError(null);
    try {
      const { data: res } = await apiRequest<BulkOutcome>("/api/returns/status", {
        method: "POST",
        body: { ids: data?.returns.map((r) => r.id), status: target, note: note.trim() || undefined, version: count === 1 ? version : undefined },
      });
      if (res.failed.length > 0 && res.succeeded.length === 0) toast.error("Status not changed", bulkMessage(res, "updated"));
      else toast.success("Status changed", bulkMessage(res, `moved to ${target}`));
      onOpenChange(false);
      onDone();
    } catch (e) {
      setError(isApiError(e) ? e.message : "Could not change the status.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Change status" description={count ? `${count} ${count === 1 ? "return" : "returns"} selected${statuses.length ? ` · current ${statuses.join(", ")}` : ""}` : "Checking which statuses are allowed…"} />
        <DialogBody className="space-y-3">
          {transitions.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <p role="status" className="flex items-center gap-2 text-xs text-secondary"><Spinner className="h-3.5 w-3.5" label="Loading" />Checking which statuses are allowed for this selection…</p>
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : transitions.error ? (
            <Callout variant="error" title="Could not load statuses" action={<Button size="sm" onClick={() => void transitions.refetch()}>Retry</Button>}>{transitions.error.message}</Callout>
          ) : (
            <>
            {data && partialRmaNotes(data.returns).length ? (
              <Callout variant="info" title="Status is set per RMA">
                <ul className="list-disc space-y-0.5 pl-4">{partialRmaNotes(data.returns).slice(0, 5).map((n) => <li key={n}>{n}</li>)}</ul>
              </Callout>
            ) : null}
            <div role="radiogroup" aria-label="New status" className="space-y-1.5">
              {data?.options.filter((o) => !(statuses.length === 1 && statuses[0] === o.status)).map((o) => (
                <button
                  key={o.status}
                  type="button"
                  role="radio"
                  aria-checked={target === o.status}
                  disabled={!o.ok}
                  onClick={() => setTarget(o.status)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    target === o.status ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-sunken",
                    !o.ok && "cursor-not-allowed opacity-60 hover:bg-transparent",
                  )}
                >
                  <span className={cn("mt-0.5 h-4 w-4 shrink-0 rounded-full border-2", target === o.status ? "border-primary bg-primary shadow-[inset_0_0_0_2px_white]" : "border-border-strong")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      {statuses.length === 1 ? <><StatusPill status={statuses[0] ?? ""} domain="return" size="sm" /><ArrowRight className="h-3 w-3 text-faint" aria-hidden /></> : null}
                      <StatusPill status={o.status} domain="return" size="sm" />
                      {o.ok && o.eligible !== undefined && o.eligible < count ? <span className="text-2xs text-secondary">{o.eligible} of {count}</span> : null}
                    </span>
                    <span className="mt-1 block text-xs text-secondary">{o.ok ? (o.reason ?? RETURN_STATUS_HELP[o.status]) : o.reason}</span>
                  </span>
                </button>
              ))}
            </div>
            </>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-body">Note <span className="font-normal text-secondary">(optional, added to the RMA)</span></span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Why is the status changing?" />
          </label>
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button variant={target === "Cancelled" ? "danger" : "primary"} onClick={() => void submit()} disabled={saving || !target} title={transitions.isPending ? "Checking which statuses are allowed…" : !target ? "Choose the new status" : undefined}>
            {saving || transitions.isPending ? <Spinner className="h-3.5 w-3.5" label={saving ? "Saving" : "Loading"} /> : null}
            {target ? `Move to ${target}` : transitions.isPending ? "Checking…" : "Choose a status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
