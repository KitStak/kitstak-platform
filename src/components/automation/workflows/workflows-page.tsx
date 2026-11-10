"use client";

/**
 * Workflows list (`/automation/workflows`, KitStaks-designed): sequence, name, trigger, scope,
 * conditions, actions, active, runs and last run. Bulk Activate / Deactivate / Delete; Change
 * sequence opens a drag list; row ⋯ Edit · Run history · Change log · Delete.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownUp, GripVertical, History, ListChecks, Pencil, Plus, Power, PowerOff, ShieldAlert, Trash2, Workflow } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { WORKFLOW_FIELDS, WORKFLOWS_GRID_KEY } from "@/lib/grid-defs/integrations/workflows";
import type { WorkflowRow } from "@/server/repositories/workflows";
import { EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, useClientOptions, usePagePerms, useWarehouseOptions, type BulkResponse } from "@/components/integrations/shared/shared";

const PERMS = ["view", "create", "edit", "delete", "change_log"] as const;

function SortRow({ row, index }: { readonly row: WorkflowRow; readonly index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 ${isDragging ? "z-10 shadow-lg" : ""}`}>
      <span className="w-6 text-right text-[12px] font-semibold tabular-nums text-faint">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{row.name}</p>
        <p className="truncate text-[11px] text-secondary">{row.trigger} · {row.actions.join(" → ")}{row.stopProcessing ? " · stops processing" : ""}</p>
      </div>
      {!row.isActive ? <Badge size="sm" tone="neutral">Inactive</Badge> : null}
      <button type="button" aria-label={`Move ${row.name}`} {...attributes} {...listeners} className="cursor-grab rounded p-1 text-faint hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><GripVertical className="h-4 w-4" /></button>
    </li>
  );
}

function SequenceDialog({ open, onOpenChange, onSaved }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void; readonly onSaved: () => void }) {
  const q = useApiQuery<WorkflowRow[]>(["workflows-all"], open ? "/api/workflows" : null, { query: { ps: 1000, sort: "sequence" }, staleTime: 0 });
  const [rows, setRows] = React.useState<WorkflowRow[]>([]);
  React.useEffect(() => { if (q.data?.data) setRows([...q.data.data]); }, [q.data]);
  const action = useAction([["grid", WORKFLOWS_GRID_KEY]]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setRows((list) => arrayMove(list, list.findIndex((r) => r.id === e.active.id), list.findIndex((r) => r.id === e.over?.id)));
  };
  const changed = q.data?.data ? rows.map((r) => r.id).join() !== q.data.data.map((r) => r.id).join() : false;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Change sequence" description="Workflows run top to bottom for each trigger. A workflow with Stop processing ends the chain when it matches." />
        <DialogBody>
          {q.isPending ? <p className="py-6 text-center text-[13px] text-secondary">Loading workflows…</p> : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <ol className="flex max-h-[55vh] flex-col gap-1.5 overflow-auto">{rows.map((r, i) => <SortRow key={r.id} row={r} index={i} />)}</ol>
              </SortableContext>
            </DndContext>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <DisabledReason reason={changed ? null : "Drag a workflow to change the order"}>
            <Button variant="primary" disabled={!changed || action.pending} onClick={async () => {
              const res = await action.run<{ ids: string[] }>("/api/workflows/reorder", "POST", { ids: rows.map((r) => r.id) });
              if (res) { onSaved(); onOpenChange(false); }
            }}>Save sequence</Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowsPage() {
  const router = useRouter();
  const fmt = useFormat();
  const perms = usePagePerms("automation.workflows", PERMS);
  const warehouses = useWarehouseOptions();
  const clients = useClientOptions();
  const fields = React.useMemo(() => toFilterFields(WORKFLOW_FIELDS, { warehouseId: warehouses.short, clientId: clients }), [warehouses.short, clients]);
  const g = useGrid<WorkflowRow>({ gridKey: WORKFLOWS_GRID_KEY, path: "/api/workflows", fields });
  const [log, setLog] = React.useState<WorkflowRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly WorkflowRow[] | null>(null);
  const [sequence, setSequence] = React.useState(false);
  const action = useAction([["grid", WORKFLOWS_GRID_KEY]]);
  const href = (id: string) => `/automation/workflows/${id}`;
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const setActive = async (ids: readonly string[], isActive: boolean) => {
    const r = await action.run<BulkResponse>("/api/workflows/bulk-active", "POST", { ids, isActive });
    if (r) { toastBulk(r, "workflow", isActive ? "activated" : "deactivated"); g.clearSelection(); }
  };

  const COLUMNS: GridColumnDef<WorkflowRow>[] = [
    { id: "sequence", header: "#", size: 56, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums text-secondary">{row.original.sequence}</div> },
    { id: "name", header: "Name", size: 260, meta: { alwaysVisible: true }, cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2">
        <Link href={href(row.original.id)} onClick={(e) => e.stopPropagation()} className="truncate font-medium text-primary hover:underline">{row.original.name}</Link>
        {row.original.stopProcessing ? <Tooltip content="Stops the chain when it matches"><span><Badge size="sm" tone="warning">Stop</Badge></span></Tooltip> : null}
      </span>
    ) },
    { id: "trigger", header: "Trigger", size: 190, cell: ({ row }) => row.original.trigger },
    { id: "scope", header: "Scope", size: 200, enableSorting: false, cell: ({ row }) => <span className="truncate">{row.original.warehouseCode ?? "All warehouses"} · {row.original.clientName ?? "All clients"}</span> },
    { id: "conditions", header: "Conditions", size: 240, enableSorting: false, cell: ({ row }) => (
      <Tooltip content={row.original.conditionSummary}><span className="flex min-w-0 items-center gap-1.5"><Badge size="sm" tone="info">{row.original.match === "All" ? "All" : "Any"} · {row.original.conditionCount}</Badge><span className="truncate text-[12px] text-secondary">{row.original.conditionSummary}</span></span></Tooltip>
    ) },
    { id: "actions", header: "Actions", size: 240, enableSorting: false, cell: ({ row }) => <span className="truncate text-[12px]" title={row.original.actions.join(" → ")}>{row.original.actions.join(" → ")}</span> },
    { id: "isActive", header: "Active", size: 90, cell: ({ row }) => <StatusPill status={row.original.isActive ? "Active" : "Inactive"} domain="active" /> },
    { id: "runCount", header: "Runs", size: 80, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.runCount.toLocaleString("en-US")}</div> },
    { id: "blocked", header: "Blocking now", size: 120, enableSorting: false, meta: { align: "right" }, cell: ({ row }) => <div className="text-right">{row.original.blockedOpen > 0 ? <Link onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-medium text-danger hover:underline" href={`/integrations/monitoring/workflow-blocked?f.workflowName=eq:${encodeURIComponent(row.original.name)}`}><ShieldAlert className="h-3.5 w-3.5" />{row.original.blockedOpen}</Link> : <Muted>0</Muted>}</div> },
    { id: "lastRunAt", header: "Last run", size: 170, cell: ({ row }) => (row.original.lastRunAt ? fmt.dateTime(row.original.lastRunAt) : <Muted>Never</Muted>) },
  ];

  const bulkActions: readonly BulkAction[] = [
    { key: "activate", label: "Activate", icon: Power, onSelect: (ids) => void setActive(ids, true), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "deactivate", label: "Deactivate", icon: PowerOff, onSelect: (ids) => void setActive(ids, false), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION },
  ];
  const rowActions = (row: WorkflowRow): readonly RowAction[] => [
    { key: "edit", label: perms.edit ? "Edit" : "Open", icon: Pencil, onSelect: () => router.push(href(row.id)) },
    { key: "runs", label: "Run history", icon: ListChecks, onSelect: () => router.push(`${href(row.id)}?tab=runs`) },
    { key: row.isActive ? "off" : "on", label: row.isActive ? "Deactivate" : "Activate", icon: row.isActive ? PowerOff : Power, onSelect: () => void setActive([row.id], !row.isActive), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: !perms.delete ? NO_PERMISSION : row.blockedOpen > 0 ? `Still blocks ${row.blockedOpen} order(s); release them first` : null },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Workflows" helper="Automate what happens when orders arrive: block risky addresses, set carriers and presets, tag, notify."
        actions={
          <div className="flex gap-2">
            <DisabledReason reason={perms.edit ? null : NO_PERMISSION}><Button variant="secondary" disabled={!perms.edit} onClick={() => setSequence(true)}><ArrowDownUp className="h-4 w-4" />Change sequence</Button></DisabledReason>
            <DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={() => router.push("/automation/workflows/new")}><Plus className="h-4 w-4" />Create Workflow</Button></DisabledReason>
          </div>
        } />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by name or description" bulkActions={bulkActions} bulkNoun="workflow" />
      <DataGrid<WorkflowRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => router.push(href(r.id))}
        emptyTitle={filtered ? "No workflows match these filters" : "No workflows yet"}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Workflows run on every new order. Start with blocking PO box addresses or tagging VIP clients."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => router.push("/automation/workflows/new")}><Workflow className="h-4 w-4" />Create workflow</Button> : undefined}
      />
      <SequenceDialog open={sequence} onOpenChange={setSequence} onSaved={() => g.refetch()} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/workflows/${log.id}/change-log` : null} title={`Change log · ${log?.name ?? ""}`} />
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `workflow ${toDelete[0]?.name}` : `${toDelete?.length ?? 0} workflows`}?`}
        description="Run history is deleted with the workflow. Workflows still blocking orders are skipped." confirmLabel="Yes, delete" cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Workflow" }, { key: "trigger", label: "Trigger" }, { key: "runs", label: "Runs" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, trigger: r.trigger, runs: r.runCount })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/workflows/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { toastBulk(result, "workflow", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }} />
    </div>
  );
}
