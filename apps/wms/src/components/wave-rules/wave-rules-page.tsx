"use client";

/**
 * Wave Rules `/jobs/wave-rules` (Logiwa 02 §2): grid with a live NEXT RUN countdown,
 * bulk Run (toast with the wave result + View log, notification), row menu Show details /
 * Edit / Change log / Delete, and the create/edit wizard drawer.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Edit3, Eye, History, Play, Plus, Trash2, Workflow } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { LinkCell } from "@/components/grid/cells";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { showToast, toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { RecordChangeLogDrawer } from "@/components/jobs/record-change-log-drawer";
import { apiFetch, apiRequest } from "@/lib/api-client";
import { usePermissionSet } from "@/components/jobs/use-permissions";
import { WAVE_RULE_COLUMNS, exportColumns } from "@/lib/grid-defs/jobs/columns";
import { WAVE_RULES_GRID } from "@/lib/grid-defs/jobs/reports";
import { formatInZone, formatWaveCountdown } from "@/lib/grid-defs/jobs/schedule";
import { buildColumns, Dash, JobsStatusPill } from "@/components/jobs/grid-columns";
import { errorMessage, plural, postJson, str, type GridRow } from "@/components/jobs/jobs-client";
import { ListShell } from "@/components/jobs/list-shell";
import { jobsOfWaveHref } from "@/components/jobs/report-pages";
import { WaveRuleDetailDrawer } from "./wave-rule-detail";
import { WaveRuleDrawer } from "./wave-rule-wizard";

export const WAVE_RULE_PERMS = {
  create: "automation.wave_rules.create",
  edit: "automation.wave_rules.edit",
  delete: "automation.wave_rules.delete",
  run: "automation.wave_rules.run",
} as const;

interface RunResult { readonly ruleId: string; readonly ruleName: string; readonly waveId: string; readonly waveNo: string; readonly status: string; readonly summary: string }

/** One ticking clock for every countdown cell (1 s). */
const NowContext = React.createContext<number | null>(null);

function NowProvider({ children }: { readonly children: React.ReactNode }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

function NextRunCell({ value, timezone, onElapsed }: { readonly value: unknown; readonly timezone?: string | null; readonly onElapsed: () => void }) {
  const now = React.useContext(NowContext);
  const target = value ? Date.parse(String(value)) : NaN;
  const ms = Number.isNaN(target) || now === null ? null : target - now;
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (ms !== null && ms <= -5_000 && !fired.current) {
      fired.current = true;
      onElapsed();
    }
  }, [ms, onElapsed]);
  if (!value) return <Dash />;
  if (ms === null) return <span className="text-faint">…</span>;
  if (ms <= 0) return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary"><Spinner className="h-3 w-3" label="Running" />Running now</span>;
  return <span className={`font-mono text-xs tabular-nums ${ms < 120_000 ? "font-semibold text-[#B26A00]" : "text-body"}`} title={timezone ? `Next run ${formatInZone(new Date(target), timezone)} (warehouse time)` : new Date(target).toLocaleString()}>{formatWaveCountdown(ms)}</span>;
}

const AI_PENDING: ReadonlySet<string> = new Set(["Preparing For Optimization", "Optimizing", "Optimization Completed"]);

interface WaveStatusResult { readonly status: string; readonly summary: string; readonly pending: boolean; readonly waveNo: string }

/** Polls an AI wave until it completes (or 90 s pass), then shows the result toast with View log. */
async function followAiWave(r: RunResult, router: ReturnType<typeof useRouter>, onDone: () => void): Promise<void> {
  const deadline = Date.now() + 90_000;
  let delay = 800;
  while (Date.now() < deadline) {
    await new Promise((res) => window.setTimeout(res, delay));
    delay = Math.min(3_000, Math.round(delay * 1.5));
    try {
      const { data } = await apiRequest<WaveStatusResult>(`/api/waves/${encodeURIComponent(r.waveId)}`);
      if (data.pending) continue;
      showToast({
        variant: data.status === "Failed" ? "error" : "success",
        title: data.status === "Failed" ? `${r.ruleName}: wave failed` : r.ruleName,
        message: data.summary,
        duration: 10_000,
        action: { label: "View log", onClick: () => router.push(`/jobs/wave-log?q=${encodeURIComponent(r.waveNo)}&qm=eq`) },
      });
      onDone();
      return;
    } catch {
      // Transient errors: keep polling until the deadline.
    }
  }
  toast.info("Still optimizing", `Wave ${r.waveNo} is taking longer than usual. You'll get a notification when its AI jobs are ready.`);
}

function RunButton({ selected, onDone }: { readonly selected: readonly GridRow[]; readonly onDone: () => void }) {
  const router = useRouter();
  const { permissions } = usePermissionSet();
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const reason = selected.length === 0 ? "Select at least one wave rule" : !permissions.has(WAVE_RULE_PERMS.run) ? "You don't have permission to run wave rules" : selected.length > 20 ? "Run at most 20 rules at once" : null;
  const run = async () => {
    if (inFlight.current) return; // one click = one wave, even on a fast double click before re-render
    inFlight.current = true;
    setBusy(true);
    // Long waves keep running server-side; the request survives in-app navigation and the result toast links to the log.
    const slow = window.setTimeout(() => toast.info("Wave still running", "You can keep working in KitStak; the result appears here with a View log link when the wave finishes."), 4000);
    try {
      const { results } = await postJson<{ results: readonly RunResult[] }>("/api/wave-rules/run", { ids: selected.map((r) => r.id) });
      for (const r of results) {
        if (AI_PENDING.has(r.status)) {
          // AI waves return while Optimizing; the optimization finishes server-side and we follow it here.
          showToast({ variant: "info", title: `${r.ruleName}: optimizing`, message: r.summary, duration: 6_000, action: { label: "View log", onClick: () => router.push(`/jobs/wave-log?q=${encodeURIComponent(r.waveNo)}&qm=eq`) } });
          void followAiWave(r, router, onDone);
          continue;
        }
        showToast({
          variant: r.status === "Failed" ? "error" : "success",
          title: r.status === "Failed" ? `${r.ruleName}: wave failed` : `${r.ruleName}`,
          message: r.summary,
          duration: 10_000,
          action: { label: "View log", onClick: () => router.push(`/jobs/wave-log?q=${encodeURIComponent(r.waveNo)}&qm=eq`) },
        });
      }
      onDone();
    } catch (error) {
      toast.error("Run failed", errorMessage(error));
    } finally {
      window.clearTimeout(slow);
      inFlight.current = false;
      setBusy(false);
    }
  };
  if (!permissions.can(WAVE_RULE_PERMS.run)) return null;
  return (
    <DisabledReason reason={reason}>
      <Button variant="secondary" disabled={Boolean(reason) || busy} aria-busy={busy} onClick={() => void run()}>
        {busy ? <Spinner className="h-3.5 w-3.5" label="Running" /> : <Play className="h-3.5 w-3.5" aria-hidden />}
        Run{selected.length > 1 ? ` (${selected.length})` : ""}
      </Button>
    </DisabledReason>
  );
}

export function WaveRulesPage() {
  const { permissions } = usePermissionSet();
  const qc = useQueryClient();
  const [drawer, setDrawer] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [details, setDetails] = React.useState<GridRow | null>(null);
  const [changeLog, setChangeLog] = React.useState<GridRow | null>(null);
  const [deleting, setDeleting] = React.useState<GridRow | null>(null);
  const refreshGrid = React.useCallback(() => void qc.invalidateQueries({ queryKey: ["grid", WAVE_RULES_GRID.gridKey] }), [qc]);
  const canEdit = permissions.can(WAVE_RULE_PERMS.edit);
  const canCreate = permissions.can(WAVE_RULE_PERMS.create);
  const canDelete = permissions.can(WAVE_RULE_PERMS.delete);

  const columns = React.useMemo(() => buildColumns<GridRow>(WAVE_RULE_COLUMNS, {
    primary: "name",
    cells: {
      name: ({ row }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); if (canEdit) setDrawer({ open: true, editId: row.original.id }); else setDetails(row.original); }} className="truncate text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          {str(row.original.name)}
        </button>
      ),
      status: ({ getValue }) => <JobsStatusPill status={str(getValue()) || "Pending"} domain="wave" />,
      lastWaveNo: ({ getValue }) => (getValue() ? <LinkCell href={jobsOfWaveHref(str(getValue()))}>{str(getValue())}</LinkCell> : <Dash />),
      nextRunAt: ({ getValue, row }) => <NextRunCell value={getValue()} timezone={str((row.original as Record<string, unknown>).timezone) || null} onElapsed={refreshGrid} />,
    },
  }), [canEdit, refreshGrid]);

  return (
    <NowProvider>
      <ListShell<GridRow>
        title="Job wave rules"
        helper="Rules turn open orders into jobs, on a schedule or when you press Run."
        tabs="jobs"
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => setDrawer({ open: true, editId: null })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create a new wave rule
            </Button>
          ) : null
        }
        gridKey={WAVE_RULES_GRID.gridKey}
        path="/api/wave-rules"
        fields={WAVE_RULES_GRID.fields}
        columns={columns}
        exportColumns={exportColumns(WAVE_RULE_COLUMNS)}
        searchPlaceholder={WAVE_RULES_GRID.searchPlaceholder}
        noun="wave rule"
        trailing={({ selected, refresh }) => <RunButton selected={selected} onDone={refresh} />}
        rowActions={(row) => [
          { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetails(row) },
          ...(canEdit ? [{ key: "edit", label: "Edit", icon: Edit3, onSelect: () => setDrawer({ open: true, editId: row.id }) }] : []),
          { key: "log", label: "Change log", icon: History, onSelect: () => setChangeLog(row) },
          ...(canDelete ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setDeleting(row) }] : []),
        ]}
        emptyTitle="No wave rules yet"
        emptyDescription="A wave rule selects open orders and turns them into jobs."
        emptyAction={canCreate ? <EmptyState compact title="" cards={[{ title: "Create a new wave rule", description: "Picking, cycle count, replenishment or order merge.", icon: Workflow, onClick: () => setDrawer({ open: true, editId: null }) }]} /> : undefined}
      />
      <WaveRuleDrawer open={drawer.open} editId={drawer.editId} defaultWarehouseId={null} onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))} onSaved={refreshGrid} />
      <WaveRuleDetailDrawer rule={details} onClose={() => setDetails(null)} onEdit={canEdit ? (id) => { setDetails(null); setDrawer({ open: true, editId: id }); } : undefined} />
      {changeLog ? <RecordChangeLogDrawer open onOpenChange={(o) => (o ? undefined : setChangeLog(null))} path={`/api/wave-rules/${encodeURIComponent(changeLog.id)}/change-log`} entityCode={str(changeLog.name)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => (o ? undefined : setDeleting(null))}
        variant="danger"
        title="Are you sure you want to delete this wave rule?"
        description="Its schedule stops. Waves and jobs it already created are kept; the change log keeps a Delete entry."
        records={deleting ? { columns: [{ key: "name", label: "Wave rule" }, { key: "op", label: "Operation type" }, { key: "runs", label: "Runs" }], rows: [{ name: str(deleting.name), op: str(deleting.operationType), runs: plural(Number(deleting.runCount ?? 0), "run") }] } : undefined}
        cancelLabel="Keep rule"
        confirmLabel="Delete rule"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await apiFetch(`/api/wave-rules/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
            toast.success("Success", `Wave rule ${str(deleting.name)} deleted`);
            refreshGrid();
          } catch (error) {
            toast.error("Couldn't delete the wave rule", errorMessage(error));
          }
        }}
      />
    </NowProvider>
  );
}
