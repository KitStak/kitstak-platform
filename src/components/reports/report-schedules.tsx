"use client";

/**
 * Scheduled report delivery UI: the toolbar "Schedule" button on every report grid opens a
 * dialog that saves the current view (filters, sort, search, visible columns) as a daily or
 * weekly XLSX / CSV delivery, and lists the report's existing schedules with Send now, Pause
 * and Delete. The Report Hub lists every schedule (`ScheduledReportsCard`).
 */
import * as React from "react";
import Link from "next/link";
import { QueryClientContext } from "@tanstack/react-query";
import { CalendarClock, Pause, Play, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import type { ScheduleView } from "@/server/repositories/reports-schedules";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const browserZone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};

function useSchedules(gridKey?: string) {
  const q = useApiQuery<ScheduleView[]>(["report-schedules", gridKey ?? "all"], "/api/reports/schedules", { query: gridKey ? `gridKey=${encodeURIComponent(gridKey)}` : undefined, staleTime: 15_000 });
  const client = React.useContext(QueryClientContext);
  const refresh = React.useCallback(() => client?.invalidateQueries({ queryKey: ["report-schedules"] }), [client]);
  return { q, refresh };
}

function when(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

export function ScheduleRow({ s, onChanged, showReport = false }: { readonly s: ScheduleView; readonly onChanged: () => void; readonly showReport?: boolean }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const act = async (kind: "run" | "pause" | "delete") => {
    setBusy(kind);
    try {
      if (kind === "run") {
        const r = await apiRequest<ScheduleView>(`/api/reports/schedules/${s.id}/run`, { method: "POST" });
        const v = r.data;
        if (v.lastStatus === "error") toast.error(v.lastMessage ?? "The delivery failed");
        else toast.success(`Sent: ${v.lastMessage ?? "delivered"}`);
      } else if (kind === "pause") {
        await apiRequest(`/api/reports/schedules/${s.id}`, { method: "PATCH", body: { active: !s.active } });
      } else {
        await apiRequest(`/api/reports/schedules/${s.id}`, { method: "DELETE" });
        toast.success(`Deleted "${s.name}"`);
      }
      onChanged();
    } catch (e: unknown) {
      toast.error(isApiError(e) ? e.message : "Could not update the schedule");
    } finally {
      setBusy(null);
    }
  };
  return (
    <li data-schedule={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2.5">
      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-faint" aria-hidden />
      <div className="min-w-0 flex-1 text-[12.5px]">
        <p className="font-semibold text-foreground">
          {s.name}
          {showReport ? <span className="font-normal text-secondary"> · {s.reportTitle}</span> : null}
          {!s.active ? <span className="ml-1.5 rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary">Paused</span> : null}
          {!s.mine ? <span className="ml-1.5 text-[11px] font-normal text-faint">by {s.ownerName}</span> : null}
        </p>
        <p className="text-secondary">{s.cadence} · {s.format.toUpperCase()} · to {s.recipients.join(", ")}</p>
        <p className="text-faint">
          Next {s.active ? when(s.nextRunAt) : "— (paused)"} · Last {when(s.lastRunAt)}
          {s.lastStatus ? <span className={s.lastStatus === "error" ? "text-danger" : "text-success"}> · {s.lastStatus === "error" ? "Failed" : "Sent"}{s.lastMessage ? `: ${s.lastMessage}` : ""}</span> : null}
        </p>
      </div>
      {s.mine ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => void act("run")} disabled={busy !== null} aria-label={`Send ${s.name} now`}>
            <Send className="h-3.5 w-3.5" aria-hidden />{busy === "run" ? "Sending…" : "Send now"}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => void act("pause")} disabled={busy !== null} aria-label={s.active ? `Pause ${s.name}` : `Resume ${s.name}`} title={s.active ? "Pause" : "Resume"}>
            {s.active ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => void act("delete")} disabled={busy !== null} aria-label={`Delete ${s.name}`} title="Delete">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ScheduleReportButton({ gridKey, title, queryString, columns }: {
  readonly gridKey: string;
  readonly title: string;
  /** The grid's current query (filters, sort, search). */
  readonly queryString: string;
  /** Visible column keys, in order. */
  readonly columns?: readonly string[];
}) {
  const [open, setOpen] = React.useState(false);
  const me = useMe();
  const myEmail = me.data?.data.user?.email ?? "";
  const { q, refresh } = useSchedules(gridKey);
  const list = q.data?.data ?? [];
  const [name, setName] = React.useState("");
  const [frequency, setFrequency] = React.useState<"daily" | "weekly">("daily");
  const [weekday, setWeekday] = React.useState("1");
  const [time, setTime] = React.useState("07:00");
  const [format, setFormat] = React.useState<"xlsx" | "csv">("xlsx");
  const [recipients, setRecipients] = React.useState<readonly string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const query = queryString.replace(/(^|&)(page|ps)=[^&]*/g, "").replace(/^&/, "");
  const filterCount = (query.match(/(^|&)f\./g) ?? []).length + (/(^|&)q=/.test(query) ? 1 : 0);

  React.useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reset the form each time it opens */
    setName(`${title} ${frequency === "daily" ? "daily" : "weekly"}`);
    setRecipients(myEmail ? [myEmail] : []);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open
  }, [open]);

  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const reason = !name.trim() ? "Name the schedule" : !timeOk ? "Use HH:MM (24 h)" : recipients.length === 0 ? "Add at least one recipient" : null;
  const save = async () => {
    if (reason) { setError(reason); return; }
    setSaving(true);
    try {
      await apiRequest("/api/reports/schedules", {
        method: "POST",
        body: { gridKey, name: name.trim(), query, frequency, weekday: Number(weekday), time, timeZone: browserZone(), format, recipients, ...(columns?.length ? { columns } : {}) },
      });
      toast.success(`Scheduled "${name.trim()}"`);
      setError(null);
      await refresh();
    } catch (e: unknown) {
      setError(isApiError(e) ? e.message : "Could not save the schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-label={list.length ? `Schedule (${list.length} scheduled)` : "Schedule"}>
        <CalendarClock className="h-4 w-4" aria-hidden />Schedule{list.length ? <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{list.length}</span> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" aria-label="Schedule this report">
          <DialogHeader title={`Schedule ${title}`} description="Deliver this view by email on a schedule. The file also appears in Excel Export History." />
          <DialogBody className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-[12px] text-secondary" data-testid="schedule-view-summary">
              Uses the view on screen: {filterCount ? `${filterCount} filter${filterCount === 1 ? "" : "s"}` : "no filters"}
              {/(^|&)sort=/.test(query) ? ", its sort" : ""}{columns?.length ? `, ${columns.length} visible columns` : ""}. Date chips such as &ldquo;Today&rdquo; are re-evaluated on every delivery.
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary sm:col-span-2">Name
                <TextField size="sm" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Schedule name" />
              </label>
              <div className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Frequency
                <SegmentedControl
                  ariaLabel="Frequency" size="sm" value={frequency} onChange={setFrequency}
                  options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]}
                />
              </div>
              {frequency === "weekly" ? (
                <div className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Day
                  <Select size="sm" aria-label="Day of week" value={weekday} onChange={(v) => setWeekday(v ?? "1")} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
                </div>
              ) : <div aria-hidden />}
              <label className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Time ({browserZone()})
                <TextField size="sm" value={time} onChange={(e) => setTime(e.target.value)} placeholder="07:00" aria-label="Delivery time" invalid={!timeOk} />
              </label>
              <div className="flex flex-col gap-1 text-[12px] font-medium text-secondary">Format
                <SegmentedControl ariaLabel="File format" size="sm" value={format} onChange={setFormat} options={[{ value: "xlsx", label: "Excel (XLSX)" }, { value: "csv", label: "CSV" }]} />
              </div>
              <div className="flex flex-col gap-1 text-[12px] font-medium text-secondary sm:col-span-2">Recipients
                <ChipInput value={recipients} onChange={setRecipients} placeholder="name@company.com, press Enter" aria-label="Recipients" maxItems={20} validate={(t) => (EMAIL_RE.test(t) ? null : "Enter a valid email address")} />
              </div>
            </div>
            {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
            <section aria-label="Existing schedules">
              <p className="mb-1.5 text-[12px] font-semibold text-foreground">Scheduled for this report{list.length ? ` (${list.length})` : ""}</p>
              {list.length === 0 ? <p className="text-[12px] text-faint">None yet.</p> : (
                <ul className="flex flex-col gap-1.5">{list.map((s) => <ScheduleRow key={s.id} s={s} onChanged={() => void refresh()} />)}</ul>
              )}
            </section>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving} title={reason ?? undefined}>{saving ? "Saving…" : "Save schedule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Report Hub card: every schedule the viewer owns (and the team's, for supervisors). */
export function ScheduledReportsCard() {
  const { q, refresh } = useSchedules();
  const list = q.data?.data ?? [];
  return (
    <section aria-label="Scheduled reports" className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground"><CalendarClock className="h-4 w-4 text-faint" aria-hidden />Scheduled reports</h2>
      <p className="mt-0.5 text-[12px] text-faint">Daily or weekly email deliveries of a saved report view. Open a report and use Schedule to add one.</p>
      {q.isPending ? <div className="mt-3 h-10 animate-pulse rounded-md bg-surface-sunken" aria-hidden /> : list.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-secondary">No scheduled reports yet. Try <Link className="text-primary hover:underline" href="/reports/inventory-snapshot">Inventory Snapshot</Link> or <Link className="text-primary hover:underline" href="/reports/transaction-history">Transaction History</Link>.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">{list.map((s) => <ScheduleRow key={s.id} s={s} showReport onChanged={() => void refresh()} />)}</ul>
      )}
    </section>
  );
}
