"use client";

/**
 * Printout list per type (`/settings/printouts/[type]`): template grid with search, filters,
 * export and bulk Delete; row ⋯ Show details · Edit · Preview · Duplicate · Change log ·
 * Delete (the default template is protected). Create opens the 5-step wizard page.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Eye, FileSearch, History, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { DataGrid, DateCell, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { useApiQuery } from "@/lib/query-client";
import { PRINTOUT_FIELDS, PRINTOUTS_GRID_KEY, sectionsFor, templatesFor, typeTitle, columnsFor } from "@/lib/grid-defs/admin/printouts";
import type { PrintoutDetail, PrintoutRow } from "@/server/repositories/printouts";
import { armDestructive, DetailList, EntityChangeLogDrawer, Muted, NO_PERMISSION, toastBulk, toFilterFields, useAction, useAdminOptions, useGridPatch, usePagePerms, type BulkResponse } from "../admin-shared";
import { openPdf } from "./pdf-fetch";

const PERMS = ["view", "create", "edit", "delete", "change_log", "duplicate"] as const;
const hidden = { defaultVisible: false } as const;

function StatusBadge({ active }: { readonly active: boolean }) {
  return <Badge tone={active ? "success" : "neutral"} shape="pill" size="sm">{active ? "Active" : "Passive"}</Badge>;
}

function columns(onOpen: (id: string) => void): GridColumnDef<PrintoutRow>[] {
  return [
    {
      id: "name", header: "Report name", size: 240, meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <button type="button" onClick={() => onOpen(row.original.id)} className="flex items-center gap-1.5 text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {row.original.isDefault ? <Star className="h-3 w-3 fill-warning text-warning" aria-label="Default template" /> : null}
          {row.original.name}
        </button>
      ),
    },
    { id: "description", header: "Description", size: 220, cell: ({ row }) => row.original.description ? <span className="block truncate" title={row.original.description}>{row.original.description}</span> : <Muted /> },
    { id: "status", header: "Status", size: 100, cell: ({ row }) => <StatusBadge active={row.original.isActive} /> },
    { id: "printMode", header: "Print mode", size: 120, cell: ({ row }) => row.original.printMode },
    { id: "printerType", header: "Printer type", size: 120, cell: ({ row }) => row.original.printerType },
    { id: "isDefault", header: "Default", size: 90, meta: hidden, cell: ({ row }) => row.original.isDefault ? <Badge tone="warning" size="sm">Default</Badge> : <Muted>No</Muted> },
    { id: "clientCount", header: "Client access", size: 120, enableSorting: false, cell: ({ row }) => row.original.allClients ? "All clients" : `${row.original.clientCount} ${row.original.clientCount === 1 ? "client" : "clients"}` },
    { id: "createdAt", header: "Creation date", size: 184, cell: ({ row }) => <DateCell value={row.original.createdAt} /> },
    { id: "createdByName", header: "Created by", size: 140, cell: ({ row }) => row.original.createdByName ? <span className="block truncate" title={row.original.createdByName}>{row.original.createdByName}</span> : <Muted>System</Muted> },
    { id: "updatedAt", header: "Updated", size: 172, meta: hidden, cell: ({ row }) => <DateCell value={row.original.updatedAt} /> },
  ];
}

function DetailDrawer({ id, onOpenChange, onEdit, canEdit, onPreview }: { readonly id: string | null; readonly onOpenChange: (o: boolean) => void; readonly onEdit: (id: string) => void; readonly canEdit: boolean; readonly onPreview: (id: string) => void }) {
  const q = useApiQuery<PrintoutDetail>(["printout", id ?? ""], id ? `/api/printouts/${id}` : null, { staleTime: 0 });
  const options = useAdminOptions();
  const d = q.data?.data;
  const sectionLabel = (key: string) => (d ? sectionsFor(d.typeKey).find((s) => s.key === key)?.label ?? key : key);
  const columnLabel = (key: string) => (d ? columnsFor(d.typeKey).find((c) => c.key === key)?.label ?? key : key);
  const clientNames = d && !d.allClients ? d.clientIds.map((cid) => options.clients.find((c) => c.id === cid)?.name ?? "Unknown client") : [];
  return (
    <Drawer open={id !== null} onOpenChange={onOpenChange} width={45} title={d ? d.name : "Printout details"} description={d ? `${d.typeName} template` : undefined}
      footer={d ? (
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={() => onPreview(d.id)}><FileSearch className="h-4 w-4" aria-hidden />Preview PDF</Button>
          <DisabledReason reason={canEdit ? null : NO_PERMISSION}><Button variant="primary" disabled={!canEdit} onClick={() => onEdit(d.id)}><Pencil className="h-4 w-4" aria-hidden />Edit</Button></DisabledReason>
        </div>
      ) : undefined}>
      {q.isPending ? <Skeleton className="h-80 w-full" /> : q.isError ? (
        <EmptyState title="Couldn't load this printout" description={q.error.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} compact />
      ) : d ? (
        <div className="flex flex-col gap-4">
          <DetailList title="Info" items={[
            { label: "Report name", value: d.name }, { label: "Status", value: <StatusBadge active={d.isActive} /> },
            { label: "Description", value: d.description, wide: true },
            { label: "Records per page", value: d.recordsPerPage }, { label: "Print mode", value: d.printMode },
            { label: "Printer type", value: d.printerType }, { label: "Default", value: d.isDefault ? "Yes" : "No" },
          ]} />
          <DetailList title="Layout" items={[
            { label: "Base template", value: templatesFor(d.typeKey).find((t) => t.key === d.baseTemplate)?.name ?? d.baseTemplate },
            { label: "Paper", value: d.layout.paper }, { label: "Font", value: `${d.layout.font} · ${d.layout.fontSize} pt` },
            { label: "Logo", value: d.layout.logoPosition === "hidden" ? "Hidden" : `${d.layout.logoPosition[0]?.toUpperCase()}${d.layout.logoPosition.slice(1)}` },
            { label: "Sections (in order)", value: d.layout.sections.filter((s) => s.enabled).map((s) => sectionLabel(s.key)).join(" › "), wide: true },
            ...(d.layout.columns.length ? [{ label: "Line columns", value: d.layout.columns.filter((c) => c.enabled).map((c) => columnLabel(c.key)).join(", ") || "None", wide: true }] : []),
          ]} />
          <DetailList title="Client access" items={[{ label: "Clients", value: d.allClients ? "All clients" : clientNames.join(", "), wide: true }]} />
        </div>
      ) : null}
    </Drawer>
  );
}

export function PrintoutListPage({ typeKey }: { readonly typeKey: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const perms = usePagePerms("settings.printouts_labels", PERMS);
  const fields = React.useMemo(() => toFilterFields(PRINTOUT_FIELDS.filter((f) => f.field !== "typeKey")), []);
  const extraQuery = React.useMemo(() => ({ typeKey }), [typeKey]);
  const g = useGrid<PrintoutRow>({ gridKey: PRINTOUTS_GRID_KEY, path: "/api/printouts", fields, extraQuery });
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<PrintoutRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly PrintoutRow[] | null>(null);
  const action = useAction([["grid", PRINTOUTS_GRID_KEY], ["printout-types"]]);
  const patchRows = useGridPatch<PrintoutRow>(PRINTOUTS_GRID_KEY);
  const title = typeTitle(typeKey);
  const base = `/settings/printouts/${typeKey}`;
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const cols = React.useMemo(() => columns((id) => setDetailId(id)), []);
  const edit = (id: string) => router.push(`${base}/${id}`);
  const create = () => router.push(`${base}/new`);
  const preview = async (id: string) => {
    try { await openPdf(`/api/printouts/${id}/render`, { orderIds: [] }); }
    catch (e) { toast.error("Couldn't render the preview", e instanceof Error ? e.message : "Try again"); }
  };
  const duplicate = async (row: PrintoutRow) => {
    const result = await action.run<{ id: string; name: string }>(`/api/printouts/${row.id}/duplicate`, "POST");
    if (result) toast.success("Printout duplicated", `${result.name} is ready to edit.`, { action: { label: "Edit", onClick: () => edit(result.id) } });
  };
  const bulkActions: readonly BulkAction[] = [
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => selected(ids).every((r) => r.isDefault) ? "Default templates can't be deleted" : null },
  ];
  const rowActions = (row: PrintoutRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetailId(row.id) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => edit(row.id), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "preview", label: "Preview PDF", icon: FileSearch, onSelect: () => void preview(row.id) },
    { key: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => void duplicate(row), disabledReason: perms.duplicate ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log ? null : NO_PERMISSION },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: !perms.delete ? NO_PERMISSION : row.isDefault ? "The default template can't be deleted" : null },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  // `?saved=<id>` arrives from the wizard: name the saved template above the grid (Logiwa shows
  // the new row on top) until dismissed, so nobody re-creates it thinking the save failed.
  const savedId = params.get("saved");
  const savedRow = savedId ? g.rows.find((r) => r.id === savedId) ?? null : null;
  const dismissSaved = () => router.replace(base, { scroll: false });
  const createButton = <DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={create}><Plus className="h-4 w-4" aria-hidden />Create {title}</Button></DisabledReason>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={`${title} templates`}
        breadcrumbs={[{ label: "Settings" }, { label: "Printouts & Labels", href: "/settings/printouts" }, { label: title }]}
        helper={`List, design and assign the ${title.toLowerCase()} templates your team prints.`}
        actions={createButton} />
      {savedId ? (
        <div className="px-6 pb-2">
          <Callout variant="success" title={savedRow ? `${savedRow.name} saved` : "Template saved"} onDismiss={dismissSaved}
            action={<Button size="sm" onClick={() => setDetailId(savedId)}>Show details</Button>}>
            {savedRow ? `It is in the list below${savedRow.isDefault ? " as the default" : ""}.` : "Loading the saved template…"}
          </Callout>
        </div>
      ) : null}
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by name or description" bulkActions={bulkActions.map((a) => armDestructive(a, g.toolbarProps.selectedIds))} bulkNoun="printout" />
      <DataGrid<PrintoutRow>
        {...g.gridProps}
        columns={cols}
        getRowId={(r) => r.id}
        rowActions={(row) => rowActions(row).map((a) => armDestructive(a))}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? "No printouts match these filters" : `No ${title.toLowerCase()} templates yet`}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Create a template to control what this printout looks like."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={create}><Plus className="h-4 w-4" />Create {title}</Button> : <Link href="/settings/printouts" className="text-[13px] text-primary hover:underline">Back to printout types</Link>}
      />
      <DetailDrawer id={detailId} canEdit={perms.edit} onOpenChange={(o) => !o && setDetailId(null)} onEdit={edit} onPreview={(id) => void preview(id)} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/printouts/${log.id}/change-log` : null} title={`Printout change log · ${log?.name ?? ""}`} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? toDelete[0]?.name : `${toDelete?.length ?? 0} printouts`}?`}
        description="Default templates are skipped. Deleted templates can't be printed any more."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Report name" }, { key: "status", label: "Status" }, { key: "def", label: "Default" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, status: r.status, def: r.isDefault ? "Yes" : "No" })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/printouts/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) { const done = new Set(result.succeeded); patchRows((rows) => rows.filter((r) => !done.has(r.id))); toastBulk(result, "printout", "deleted"); g.clearSelection(); }
          setToDelete(null);
        }}
      />
    </div>
  );
}
