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
import { apiFetch } from "@/lib/api-client";
import { usePermissionSet } from "@/components/jobs/use-permissions";
import { WAVE_RULE_COLUMNS, exportColumns } from "@/lib/grid-defs/jobs/columns";
import { WAVE_RULES_GRID } from "@/lib/grid-defs/jobs/reports";
import { formatWaveCountdown } from "@/lib/grid-defs/jobs/schedule";
import { buildColumns, Dash } from "@/components/jobs/grid-columns";
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

function NextRunCell({ value, onElapsed }: { readonly value: unknown; readonly onElapsed: () => void }) {
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
  if (ms <= 0) return <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary"><Spinner className="h-3 w-3" label="Running" />Running now</span>;
  return <span className={`font-mono text-[12px] tabular-nums ${ms < 120_000 ? "font-semibold text-[#B26A00]" : "text-body"}`} title={new Date(target).toLocaleString()}>{formatWaveCountdown(ms)}</span>;
}

function RunButton({ selected, onDone }: { readonly selected: readonly GridRow[]; readonly onDone: () => void }) {
  const router = useRouter();
  const { permissions } = usePermissionSet();
  const [busy, setBusy] = React.useState(false);
  const reason = selected.length === 0 ? "Select at least one wave rule" : !permissions.has(WAVE_RULE_PERMS.run) ? "You don't have permission to run wave rules" : selected.length > 20 ? "Run at most 20 rules at once" : null;
  const run = async () => {
    setBusy(true);
    try {
      const { results } = await postJson<{ results: readonly RunResult[] }>("/api/wave-rules/run", { ids: selected.map((r) => r.id) });
      for (const r of results) {
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
      setBusy(false);
    }
  };
  return (
    <DisabledReason reason={reason}>
      <Button variant="primary" disabled={Boolean(reason) || busy} aria-busy={busy} onClick={() => void run()}>
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
  const canEdit = permissions.has(WAVE_RULE_PERMS.edit);

  const columns = React.useMemo(() => buildColumns<GridRow>(WAVE_RULE_COLUMNS, {
    primary: "name",
    cells: {
      name: ({ row }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); if (canEdit) setDrawer({ open: true, editId: row.original.id }); else setDetails(row.original); }} className="truncate text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          {str(row.original.name)}
        </button>
      ),
      status: ({ getValue }) => <StatusPill status={str(getValue()) || "Pending"} domain="wave" />,
      lastWaveNo: ({ getValue }) => (getValue() ? <LinkCell href={jobsOfWaveHref(str(getValue()))}>{str(getValue())}</LinkCell> : <Dash />),
      nextRunAt: ({ getValue }) => <NextRunCell value={getValue()} onElapsed={refreshGrid} />,
    },
  }), [canEdit, refreshGrid]);

  return (
    <NowProvider>
      <ListShell<GridRow>
        title="Job wave rules"
        helper="Rules select open orders, match them to job types, allocate stock and create jobs, on a schedule or when you press Run."
        tabs="jobs"
        actions={
          <DisabledReason reason={permissions.has(WAVE_RULE_PERMS.create) ? null : "You don't have permission to create wave rules"}>
            <Button variant="primary" disabled={!permissions.has(WAVE_RULE_PERMS.create)} onClick={() => setDrawer({ open: true, editId: null })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create a new wave rule
            </Button>
          </DisabledReason>
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
          { key: "edit", label: "Edit", icon: Edit3, disabledReason: canEdit ? null : "You don't have permission to edit wave rules", onSelect: () => setDrawer({ open: true, editId: row.id }) },
          { key: "log", label: "Change log", icon: History, onSelect: () => setChangeLog(row) },
          { key: "delete", label: "Delete", icon: Trash2, destructive: true, disabledReason: permissions.has(WAVE_RULE_PERMS.delete) ? null : "You don't have permission to delete wave rules", onSelect: () => setDeleting(row) },
        ]}
        emptyTitle="No wave rules yet"
        emptyDescription="A wave rule selects open orders and turns them into jobs."
        emptyAction={<EmptyState compact title="" cards={[{ title: "Create a new wave rule", description: "Picking, cycle count, replenishment or order merge.", icon: Workflow, onClick: () => setDrawer({ open: true, editId: null }) }]} />}
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
        cancelLabel="No"
        confirmLabel="Yes"
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
