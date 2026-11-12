"use client";

/**
 * Job Types `/settings/job-types` (Logiwa 02 §6 / 08): grid (code link, description,
 * warehouse, allocation algorithm, operation type, in use by), row menu Show details / Edit /
 * Change log / Delete (blocked with the reason while wave rules or open jobs use the type),
 * and the create / edit wizard drawer.
 */
import * as React from "react";
import { Edit3, Eye, History, Plus, Trash2, Wrench } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { RecordChangeLogDrawer } from "@/components/jobs/record-change-log-drawer";
import { apiFetch } from "@/lib/api-client";
import { usePermissionSet } from "@/components/jobs/use-permissions";
import { JOB_TYPE_COLUMNS, exportColumns } from "@/lib/grid-defs/jobs/columns";
import { JOB_TYPES_GRID } from "@/lib/grid-defs/jobs/reports";
import { buildColumns } from "@/components/jobs/grid-columns";
import { errorMessage, plural, str, type GridRow } from "@/components/jobs/jobs-client";
import { ListShell } from "@/components/jobs/list-shell";
import { JobTypeDetailDrawer } from "./job-type-detail";
import { JobTypeDrawer } from "./job-type-wizard";

export const JOB_TYPE_PERMS = { create: "settings.job_types.create", edit: "settings.job_types.edit", delete: "settings.job_types.delete" } as const;

export function usageText(row: GridRow): string | null {
  const rules = Number(row.ruleCount ?? 0);
  const jobs = Number(row.openJobCount ?? 0);
  const parts = [rules > 0 ? plural(rules, "wave rule") : null, jobs > 0 ? plural(jobs, "open job") : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function JobTypesPage() {
  const { permissions } = usePermissionSet();
  const qc = useQueryClient();
  const [drawer, setDrawer] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [details, setDetails] = React.useState<GridRow | null>(null);
  const [changeLog, setChangeLog] = React.useState<GridRow | null>(null);
  const [deleting, setDeleting] = React.useState<GridRow | null>(null);
  const refresh = React.useCallback(() => void qc.invalidateQueries({ queryKey: ["grid", JOB_TYPES_GRID.gridKey] }), [qc]);
  const canEdit = permissions.has(JOB_TYPE_PERMS.edit);

  const columns = React.useMemo(() => buildColumns<GridRow>(JOB_TYPE_COLUMNS, {
    primary: "code",
    cells: {
      code: ({ row }) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); setDetails(row.original); }} className="truncate text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          {str(row.original.code)}
        </button>
      ),
      usage: ({ row }) => {
        const t = usageText(row.original);
        return t ? <span className="inline-flex rounded-full bg-[var(--label-blue-subtle)] px-2 py-0.5 text-2xs font-semibold text-[var(--label-blue-text)]">{t}</span> : <span className="text-xs text-faint">Not used</span>;
      },
    },
  }), []);

  return (
    <>
      <ListShell<GridRow>
        title="Job Types"
        helper="Create and list job types: how orders are batched, allocated, picked, counted or replenished."
        actions={
          // One rule across M03: actions the role can never perform are hidden, not disabled.
          permissions.has(JOB_TYPE_PERMS.create) ? (
            <Button variant="primary" onClick={() => setDrawer({ open: true, editId: null })}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create new job type
            </Button>
          ) : undefined
        }
        gridKey={JOB_TYPES_GRID.gridKey}
        path="/api/job-types"
        fields={JOB_TYPES_GRID.fields}
        columns={columns}
        exportColumns={exportColumns(JOB_TYPE_COLUMNS)}
        searchPlaceholder={JOB_TYPES_GRID.searchPlaceholder}
        noun="job type"
        selectable={false}
        rowActions={(row) => {
          const usage = usageText(row);
          return [
            { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetails(row) },
            { key: "edit", label: "Edit", icon: Edit3, disabledReason: canEdit ? null : "You don't have permission to edit job types", onSelect: () => setDrawer({ open: true, editId: row.id }) },
            { key: "log", label: "Change log", icon: History, onSelect: () => setChangeLog(row) },
            {
              key: "delete", label: "Delete", icon: Trash2, destructive: true,
              disabledReason: !permissions.has(JOB_TYPE_PERMS.delete) ? "You don't have permission to delete job types" : usage ? `In use by ${usage}. Remove it from them first.` : null,
              onSelect: () => setDeleting(row),
            },
          ];
        }}
        emptyTitle="No job types yet"
        emptyDescription="Wave rules need at least one job type per warehouse."
        emptyAction={<EmptyState compact title="" cards={[{ title: "Create new job type", description: "Picking, count, replenishment or work order.", icon: Wrench, onClick: () => setDrawer({ open: true, editId: null }) }]} />}
      />
      <JobTypeDrawer open={drawer.open} editId={drawer.editId} onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))} onSaved={refresh} />
      <JobTypeDetailDrawer row={details} onClose={() => setDetails(null)} onEdit={canEdit ? (id) => { setDetails(null); setDrawer({ open: true, editId: id }); } : undefined} />
      {changeLog ? <RecordChangeLogDrawer open onOpenChange={(o) => (o ? undefined : setChangeLog(null))} path={`/api/job-types/${encodeURIComponent(changeLog.id)}/change-log`} entityCode={str(changeLog.code)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => (o ? undefined : setDeleting(null))}
        variant="danger"
        title="Are you sure you want to delete this job type?"
        description="Existing jobs keep their type name; the change log keeps a Delete entry."
        records={deleting ? { columns: [{ key: "code", label: "Code" }, { key: "wh", label: "Warehouse" }, { key: "op", label: "Operation type" }], rows: [{ code: str(deleting.code), wh: str(deleting.warehouse), op: str(deleting.operationType) }] } : undefined}
        cancelLabel="Keep job type"
        confirmLabel="Delete job type"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await apiFetch(`/api/job-types/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
            toast.success("Success", `Job type ${str(deleting.code)} deleted`);
            refresh();
          } catch (error) {
            toast.error("Couldn't delete the job type", errorMessage(error));
          }
        }}
      />
    </>
  );
}
