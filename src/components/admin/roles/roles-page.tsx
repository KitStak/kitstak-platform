"use client";

/**
 * Roles (`/settings/roles`, Users & Roles tabs): grid with category, restriction pills, user
 * and permission counts; Add Role (permission matrix drawer); Manage Restrictions (selected
 * roles); bulk Delete; row ⋯ Show details · Edit · Duplicate · Change log · Delete.
 */
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Copy, Eye, History, Lock, Pencil, Plus, ShieldOff, Trash2 } from "lucide-react";
import { DataGrid, DateCell, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { RESTRICTION_COVERAGE, RESTRICTION_DEFS, restrictionLabel, ROLE_FIELDS, ROLES_GRID_KEY } from "@/lib/grid-defs/admin/roles";
import { Callout } from "@/components/ui/callout";
import { USERS_ROLES_HELPER, USERS_ROLES_TITLE } from "@/lib/grid-defs/admin/users";
import type { RoleRow } from "@/server/repositories/roles";
import { armDestructive, EntityChangeLogDrawer, Muted, NO_PERMISSION, PermissionPending, toastBulk, toFilterFields, useAction, useGridPatch, usePagePerms, type BulkResponse } from "../admin-shared";
import { RoleDrawer } from "./role-drawer";

const PERMS = ["view", "create", "edit", "delete", "change_log", "manage_restrictions"] as const;
const hidden = { defaultVisible: false } as const;

function columns(onOpen: (id: string) => void): GridColumnDef<RoleRow>[] {
  return [
    {
      id: "name", header: "Role name", size: 200, meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <button type="button" onClick={() => onOpen(row.original.id)} className="flex items-center gap-1.5 text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          {row.original.isSystem ? <Lock className="h-3 w-3 text-faint" aria-label="System role" /> : null}
          {row.original.name}
        </button>
      ),
    },
    { id: "description", header: "Description", size: 260, cell: ({ row }) => row.original.description ?? <Muted /> },
    { id: "category", header: "Role category", size: 120, cell: ({ row }) => row.original.category },
    {
      id: "restrictions", header: "Restrictions", size: 260,
      cell: ({ row }) => row.original.restrictions.length
        ? <span className="flex flex-wrap gap-1">{row.original.restrictions.map((k) => <Badge key={k} tone="warning" size="sm" shape="pill">{restrictionLabel(k)}</Badge>)}</span>
        : <Muted>None</Muted>,
    },
    { id: "userCount", header: "Users", size: 80, cell: ({ row }) => <Link href={`/settings/users?f.roleId=in:${row.original.id}`} aria-label={`${row.original.userCount} users with ${row.original.name}`} className="tabular-nums text-primary hover:underline">{row.original.userCount}</Link> },
    {
      id: "permissionCount", header: "Permissions", size: 150,
      cell: ({ row }) => {
        const pct = Math.round((row.original.permissionCount / Math.max(1, row.original.totalPermissions)) * 100);
        return (
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-neutral-soft" aria-hidden><span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></span>
            <span className="tabular-nums text-xs text-body">{row.original.permissionCount}/{row.original.totalPermissions}</span>
          </span>
        );
      },
    },
    { id: "isSystem", header: "Type", size: 90, cell: ({ row }) => row.original.isSystem ? <Badge tone="neutral" size="sm">System</Badge> : <Badge tone="neutral" size="sm" className="bg-transparent ring-1 ring-inset ring-border">Custom</Badge> },
    { id: "updatedAt", header: "Updated", size: 172, meta: hidden, cell: ({ row }) => <DateCell value={row.original.updatedAt} /> },
  ];
}

function RestrictionsDialog({ roles, onClose, onSaved }: { readonly roles: readonly RoleRow[] | null; readonly onClose: () => void; readonly onSaved: () => void }) {
  const [value, setValue] = React.useState<ReadonlySet<string>>(new Set());
  const [seenRoles, setSeenRoles] = React.useState<readonly RoleRow[] | null>(null);
  const action = useAction([["grid", ROLES_GRID_KEY]]);
  if (roles !== seenRoles) {
    // New selection: pre-check the restrictions shared by every selected role (state from props, no effect).
    setSeenRoles(roles);
    if (roles) setValue(new Set(RESTRICTION_DEFS.filter((d) => roles.every((r) => r.restrictions.includes(d.key))).map((d) => d.key)));
  }
  const save = async () => {
    if (!roles) return;
    const result = await action.run<BulkResponse>("/api/roles/restrictions", "POST", { ids: roles.map((r) => r.id), restrictions: [...value] });
    if (result) { toastBulk(result, "role", "updated"); onSaved(); onClose(); }
  };
  return (
    <Dialog open={roles !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader title="Manage restrictions" description={`Selected role${(roles?.length ?? 0) === 1 ? "" : "s"}: ${(roles ?? []).map((r) => r.name).join(", ")}`} />
        <DialogBody className="flex flex-col gap-3">
          <p className="text-sm text-secondary">Select the restrictions to apply to the selected roles. Changes apply at their next page load.</p>
          <Callout variant="info" title="Applies app-wide">
            {RESTRICTION_COVERAGE}
          </Callout>
          {RESTRICTION_DEFS.map((d) => (
            <div key={d.key} className="rounded-lg border border-border px-3 py-2.5">
              <Checkbox checked={value.has(d.key)} onCheckedChange={() => setValue((prev) => { const next = new Set(prev); if (next.has(d.key)) next.delete(d.key); else next.add(d.key); return next; })}
                label={<span className="text-sm font-semibold text-foreground">{d.label}</span>} description={d.description} />
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={action.pending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RolesPage() {
  const perms = usePagePerms("settings.roles", PERMS);
  const fields = React.useMemo(() => toFilterFields(ROLE_FIELDS), []);
  const g = useGrid<RoleRow>({ gridKey: ROLES_GRID_KEY, path: "/api/roles", fields });
  // `?id=<roleId>` (global search deep link) opens that role's drawer.
  const searchParams = useSearchParams();
  const [drawer, setDrawer] = React.useState<{ open: boolean; id: string | null; view?: boolean }>(() => { const id = searchParams.get("id"); return { open: Boolean(id), id, view: true }; });
  const [log, setLog] = React.useState<RoleRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly RoleRow[] | null>(null);
  const [restrict, setRestrict] = React.useState<readonly RoleRow[] | null>(null);
  const action = useAction([["grid", ROLES_GRID_KEY], ["admin-options"]]);
  const patchRoles = useGridPatch<RoleRow>(ROLES_GRID_KEY);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const open = (id: string | null, view = false) => setDrawer({ open: true, id, view });
  const cols = React.useMemo(() => columns((id) => open(id)), []);
  const deleteReason = (row: RoleRow) => (!perms.delete ? NO_PERMISSION : row.isSystem ? "System roles can't be deleted" : row.userCount > 0 ? `Assigned to ${row.userCount} ${row.userCount === 1 ? "user" : "users"}. Reassign them first.` : null);

  const duplicate = async (row: RoleRow) => {
    const result = await action.run<{ id: string; name: string }>(`/api/roles/${row.id}/duplicate`, "POST");
    if (result) { toast.success("Role duplicated", `${result.name} is ready to edit.`); open(result.id); }
  };

  const bulkActions: readonly BulkAction[] = [
    { key: "restrictions", label: "Manage restrictions", icon: ShieldOff, onSelect: (ids) => setRestrict(selected(ids)), disabledReason: perms.manage_restrictions ? null : NO_PERMISSION,
      eligibility: (ids) => selected(ids).some((r) => r.key === "admin") ? "The Admin role always sees every field" : null },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: (ids) => setToDelete(selected(ids)), disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => selected(ids).every((r) => r.isSystem || r.userCount > 0) ? "System roles and roles with users can't be deleted" : null },
  ];
  const rowActions = (row: RoleRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => open(row.id, true) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => open(row.id), disabledReason: !perms.edit ? NO_PERMISSION : row.isSystem ? "System roles are view-only. Duplicate to customize." : null },
    { key: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => void duplicate(row), disabledReason: perms.create ? null : NO_PERMISSION },
    { key: "restrictions", label: "Manage restrictions", icon: ShieldOff, onSelect: () => setRestrict([row]), disabledReason: !perms.manage_restrictions ? NO_PERMISSION : row.key === "admin" ? "The Admin role always sees every field" : null },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row) },
    { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setToDelete([row]), disabledReason: deleteReason(row) },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={USERS_ROLES_TITLE} tabs="users"
        helper={USERS_ROLES_HELPER}
        actions={
          <>
            {perms.loading ? <PermissionPending /> : <DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={() => open(null)}><Plus className="h-4 w-4" aria-hidden />Add role</Button></DisabledReason>}
          </>
        } />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by name" bulkActions={bulkActions.map((a) => armDestructive(a, g.toolbarProps.selectedIds))} bulkNoun="role" />
      <DataGrid<RoleRow>
        {...g.gridProps}
        columns={cols}
        getRowId={(r) => r.id}
        rowActions={(row) => rowActions(row).map((a) => armDestructive(a))}
        onRowClick={(r) => open(r.id, true)}
        emptyTitle={filtered ? "No roles match these filters" : "No roles yet"}
        emptyDescription={filtered ? "Clear a filter or search for another name." : "Create a role to group permissions for a job."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={() => open(null)}><Plus className="h-4 w-4" />Add role</Button> : undefined}
      />
      <RoleDrawer open={drawer.open} roleId={drawer.id} view={Boolean(drawer.view)} canEdit={perms.edit} canCreate={perms.create}
        onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))} onSaved={() => g.refetch()} onDuplicated={(id) => setDrawer({ open: true, id })} />
      <RestrictionsDialog roles={restrict} onClose={() => setRestrict(null)} onSaved={() => { g.refetch(); g.clearSelection(); }} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/roles/${log.id}/change-log` : null} title={`Role change log · ${log?.name ?? ""}`} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `role ${toDelete[0]?.name}` : `${toDelete?.length ?? 0} roles`}?`}
        description="System roles and roles that still have users are skipped."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{ columns: [{ key: "name", label: "Role" }, { key: "users", label: "Users" }, { key: "type", label: "Type" }], rows: (toDelete ?? []).map((r) => ({ name: r.name, users: r.userCount, type: r.isSystem ? "System" : "Custom" })) }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>("/api/roles/bulk-delete", "POST", { ids: (toDelete ?? []).map((r) => r.id) });
          if (result) {
            const done = new Set(result.succeeded);
            patchRoles((rows) => rows.filter((r) => !done.has(r.id)));
            toastBulk(result, "role", "deleted");
            g.clearSelection();
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
