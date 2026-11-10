"use client";

/**
 * End Of The Day automation: the overdue-manifest warning banner, the Schedule pickup dialog and the
 * Auto-close settings dialog (close a carrier setup's Open manifests at a cutoff time, warehouse local).
 */
import * as React from "react";
import { AlarmClock, AlertTriangle, CalendarClock, Trash2, Truck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { toast } from "@/components/ui/toast";
import type { EodRow } from "@/server/repositories/end-of-day";
import type { AutoCloseRule, AutoCloseSetup, OverdueSummary, SchedulePickupResult } from "@/server/repositories/shipping-carrier-ops";
import { shipDateTime, shipDay } from "./column-kit";
import { errorMessage, postJson } from "./shipping-client";

export const OVERDUE_KEY = ["end-of-day", "overdue"] as const;

/** Banner copy (PURE): "2 manifests from past days are still open (oldest 11/05/2026, 7 packages)". */
export function overdueText(s: Pick<OverdueSummary, "count" | "packages" | "oldestShipDate">): string | null {
  if (s.count === 0) return null;
  return `${s.count} ${s.count === 1 ? "manifest" : "manifests"} from past days ${s.count === 1 ? "is" : "are"} still open (oldest ${shipDay(s.oldestShipDate)}, ${s.packages} ${s.packages === 1 ? "package" : "packages"}). Close ${s.count === 1 ? "it" : "them"} so the carrier gets the report.`;
}

export function OverdueBanner({ onShow, onCloseAll, canClose }: { readonly onShow: () => void; readonly onCloseAll: (rows: OverdueSummary["rows"]) => void; readonly canClose: boolean }) {
  const q = useApiQuery<OverdueSummary>([...OVERDUE_KEY], "/api/end-of-day/overdue", { staleTime: 15_000 });
  const s = q.data?.data;
  const text = s ? overdueText(s) : null;
  if (!s || !text) return null;
  return (
    <div role="alert" data-testid="eod-overdue-banner" className="mx-6 mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-[13px] text-foreground">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Manifests not closed.</span> {text}
        <span className="mt-0.5 block text-[12px] text-secondary">{s.rows.slice(0, 4).map((r) => `${r.carrierPrefix} ${r.carrierCode} · ${shipDay(r.shipDate)} (${r.totalPackages})`).join(" · ")}{s.rows.length > 4 ? ` · +${s.count - 4} more` : ""}</span>
      </span>
      <Button size="sm" variant="secondary" onClick={onShow}>Show them</Button>
      {canClose ? <Button size="sm" onClick={() => onCloseAll(s.rows)}>Close and print</Button> : null}
    </div>
  );
}

/* ---------------------------------------------------------- schedule pickup */

/** Default ready time (PURE): today 3:00 PM local, or one hour from now when that has passed (rounded to 15 min). */
export function defaultPickupTime(now: Date): Date {
  const d = new Date(now);
  d.setHours(15, 0, 0, 0);
  if (d.getTime() > now.getTime() + 15 * 60_000) return d;
  const later = new Date(now.getTime() + 60 * 60_000);
  later.setMinutes(Math.ceil(later.getMinutes() / 15) * 15, 0, 0);
  return later;
}

export function SchedulePickupDialog({ rows, onClose, onDone }: { readonly rows: readonly EodRow[] | null; readonly onClose: () => void; readonly onDone: () => void }) {
  const [ready, setReady] = React.useState<Date | null>(null);
  const [latest, setLatest] = React.useState<Date | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<SchedulePickupResult | null>(null);
  const open = rows !== null;
  React.useEffect(() => {
    if (!open) return;
    const r = defaultPickupTime(new Date());
    setReady(r);
    setLatest(new Date(r.getTime() + 2 * 3_600_000));
    setResult(null);
  }, [open]);
  const packages = (rows ?? []).reduce((s, r) => s + r.totalPackages, 0);
  const invalid = !ready ? "Pick a ready time" : latest && latest.getTime() <= ready.getTime() ? "The latest time must be after the ready time" : null;
  const submit = async () => {
    if (!rows || !ready || invalid || busy) return;
    setBusy(true);
    try {
      const res = await postJson<SchedulePickupResult>("/api/end-of-day/schedule-pickup", { ids: rows.map((r) => r.id), pickupAt: ready.toISOString(), ...(latest ? { closeAt: latest.toISOString() } : {}) });
      setResult(res);
      if (res.failed.length === 0) toast.success("Pickup scheduled", res.pickups.map((p) => `${p.confirmation} · ${p.packages} ${p.packages === 1 ? "package" : "packages"}`).join(", "));
      else toast.warning(`${res.succeeded.length} of ${rows.length} pickups scheduled`, res.failed[0]?.message ?? "");
      onDone();
    } catch (error) {
      toast.error("Couldn't schedule the pickup", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md" data-testid="schedule-pickup-dialog">
        <DialogHeader title="Schedule carrier pickup" description={`Books a pickup with the carrier for ${packages} ${packages === 1 ? "package" : "packages"} and stamps Scheduled pickup on each of them.`} />
        <DialogBody className="flex flex-col gap-3">
          {result ? (
            <ul className="flex flex-col gap-1.5 text-[12px]">
              {result.pickups.map((p) => {
                const r = rows?.find((x) => x.id === p.id);
                return <li key={p.id}><span className="font-semibold">{r ? `${r.carrierPrefix} ${r.carrierCode} · ${shipDay(r.shipDate)}` : p.id}</span>: confirmation <span className="font-mono">{p.confirmation}</span>, {p.packages} packages, {shipDateTime(p.pickupAt)}</li>;
              })}
              {result.failed.map((f) => <li key={f.id} className="text-danger">{f.message}</li>)}
            </ul>
          ) : (
            <>
              <ul className="rounded-md bg-surface-sunken px-3 py-2 text-[12px] text-secondary">
                {(rows ?? []).map((r) => <li key={r.id}>{r.carrierPrefix} {r.carrierCode} · {r.shipFrom || r.warehouseCode} · {shipDay(r.shipDate)} · {r.totalPackages} packages{r.scheduledPickupAt ? ` · pickup already set for ${shipDateTime(r.scheduledPickupAt)}` : ""}</li>)}
              </ul>
              <label className="flex flex-col gap-1 text-[12px] font-medium">Ready for pickup at
                <DateTimePicker value={ready} onChange={setReady} invalid={!ready} aria-label="Ready for pickup at" />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-medium">Latest pickup time (dock closes)
                <DateTimePicker value={latest} onChange={setLatest} invalid={Boolean(invalid && ready)} aria-label="Latest pickup time" />
              </label>
              {invalid ? <p className="text-[12px] text-danger">{invalid}</p> : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {result ? <Button onClick={onClose}>Close</Button> : (
            <>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button disabled={Boolean(invalid) || busy} onClick={() => void submit()}><Truck className="h-3.5 w-3.5" aria-hidden />{busy ? "Scheduling…" : "Schedule pickup"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------------------------------------- auto-close */

export function AutoCloseDialog({ open, onOpenChange, canEdit }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly canEdit: boolean }) {
  const q = useApiQuery<AutoCloseSetup>(["end-of-day", "auto-close"], open ? "/api/end-of-day/auto-close" : null, { staleTime: 0 });
  const setup = q.data?.data;
  const [connectionId, setConnectionId] = React.useState<string | null>(null);
  const [time, setTime] = React.useState<string | null>("17:00");
  const [busy, setBusy] = React.useState(false);
  const save = async (body: { carrierConnectionId: string; cutoffTime: string; isActive: boolean }) => {
    setBusy(true);
    try {
      await postJson<AutoCloseRule>("/api/end-of-day/auto-close", body);
      toast.success("Auto-close saved", `Open manifests close every day at ${body.cutoffTime} (warehouse time).`);
      setConnectionId(null);
      await q.refetch();
    } catch (error) {
      toast.error("Couldn't save the auto-close rule", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (rule: AutoCloseRule) => {
    try {
      await apiFetch(`/api/end-of-day/auto-close/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
      toast.success("Auto-close removed", `${rule.carrierName} manifests are closed by hand again.`);
      await q.refetch();
    } catch (error) {
      toast.error("Couldn't remove the rule", errorMessage(error));
    }
  };
  const used = new Set((setup?.rules ?? []).map((r) => r.carrierConnectionId));
  const options = (setup?.connections ?? []).filter((c) => !used.has(c.id)).map((c) => ({ value: c.id, label: `${c.label} (${c.warehouseCode})` }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="auto-close-dialog">
        <DialogHeader title="Close of day automation" description="Close a carrier setup's Open manifests automatically every day at a cutoff time, in the warehouse's time zone. The End Of The Day report is printed and stored as if you closed it by hand." />
        <DialogBody className="flex flex-col gap-4">
          {!setup ? <p className="text-[12px] text-secondary">{q.isError ? `Couldn't load the rules. ${q.error.message}` : "Loading…"}</p> : (
            <>
              {setup.rules.length === 0 ? <p className="text-[12px] text-secondary">No carrier setup closes automatically yet.</p> : (
                <table className="w-full text-[12px]">
                  <thead className="text-left text-[11px] uppercase text-faint"><tr><th className="py-1">Carrier setup</th><th>Warehouse</th><th>Cutoff</th><th>On</th><th>Last run</th><th className="w-10"><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody>
                    {setup.rules.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="py-1.5 font-semibold">{r.carrierName}</td>
                        <td>{r.warehouseCode} <span className="text-faint">({r.timezone})</span></td>
                        <td className="tabular-nums">{r.cutoffTime}</td>
                        <td><Switch checked={r.isActive} disabled={!canEdit || busy} aria-label={`Auto-close ${r.carrierName}`} onCheckedChange={(on) => void save({ carrierConnectionId: r.carrierConnectionId, cutoffTime: r.cutoffTime, isActive: on })} /></td>
                        <td className="text-secondary">{r.lastRunAt ? `${shipDateTime(r.lastRunAt)} · ${r.lastResult ?? ""}` : "Not run yet"}</td>
                        <td>{canEdit ? <Button size="icon" variant="ghost" aria-label={`Remove auto-close for ${r.carrierName}`} onClick={() => void remove(r)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {canEdit ? (
                <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                  <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[12px] font-medium">Carrier setup
                    <Select options={options} value={connectionId} onChange={setConnectionId} placeholder={options.length ? "Choose a carrier setup" : "Every setup has a rule"} disabled={options.length === 0} />
                  </label>
                  <label className="flex w-32 flex-col gap-1 text-[12px] font-medium">Cutoff time
                    <TimePicker value={time} onChange={setTime} aria-label="Cutoff time" />
                  </label>
                  <Button disabled={!connectionId || !time || busy} onClick={() => connectionId && time ? void save({ carrierConnectionId: connectionId, cutoffTime: time, isActive: true }) : undefined}><AlarmClock className="h-3.5 w-3.5" aria-hidden />Add rule</Button>
                </div>
              ) : <p className="text-[12px] text-secondary">You need permission to print the End Of The Day report to change these rules.</p>}
            </>
          )}
        </DialogBody>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}><CalendarClock className="h-3.5 w-3.5" aria-hidden />Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
