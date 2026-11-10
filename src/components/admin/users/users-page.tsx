"use client";

/**
 * Users (`/settings/users`, Users & Roles tabs): grid with role, warehouse, type, status and
 * API-user pills; Bulk Import/Update ▾ (Import User-Role, Update User-Role, Assign/Unassign
 * User-Warehouse and User-Client); Add User (4 steps); bulk Activate / Deactivate; row ⋯
 * Show details · Edit · Change log · Activate/Deactivate · Reset password · Sessions.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Eye, FileSpreadsheet, History, KeyRound, Laptop, Pencil, Plus, Power, PowerOff, Upload, UserPlus } from "lucide-react";
import { DataGrid, DateCell, GridToolbar, useGrid, type BulkAction, type GridColumnDef, type RowAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { USER_FIELDS, USERS_GRID_KEY, USERS_ROLES_HELPER, USERS_ROLES_TITLE } from "@/lib/grid-defs/admin/users";
import type { UserRow } from "@/server/repositories/users";
import { armDestructive, EntityChangeLogDrawer, Muted, NO_PERMISSION, PermissionPending, toastBulk, toFilterFields, useAction, useAdminOptions, useGridPatch, useMeId, usePagePerms, type AdminOptions, type BulkResponse } from "../admin-shared";
import { roleTone } from "./role-tone";
import { TemporaryPasswordDialog, UserDetailDrawer, UserSessionsDrawer } from "./user-panels";
import { UserWizardDrawer } from "./user-wizard";
import { usePasswordPolicy } from "../password-meter";

const PERMS = ["view", "create", "edit", "change_log", "import_file"] as const;
const hidden = { defaultVisible: false } as const;

const IMPORT_TIP = "Opens the bulk action page, where you manage and upload roles, warehouses and clients in bulk with Excel files. To assign or unassign warehouses or clients, add the user's role first.";

function Pills({ value, roles }: { readonly value: string | null; readonly roles: AdminOptions["roles"] }) {
  if (!value) return <Muted />;
  const parts = value.split(", ");
  return (
    <span className="flex items-center gap-1 overflow-hidden">
      {parts.slice(0, 2).map((p) => <Badge key={p} tone={roleTone(roles.find((r) => r.name === p) ?? { name: p })} size="sm" shape="pill">{p}</Badge>)}
      {parts.length > 2 ? <span className="text-[11px] text-faint" title={parts.slice(2).join(", ")}>+{parts.length - 2}</span> : null}
    </span>
  );
}

function columns(onOpen: (id: string) => void, meId: string | null, roles: AdminOptions["roles"]): GridColumnDef<UserRow>[] {
  return [
    {
      id: "name", header: "Name", size: 220, meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <button type="button" onClick={() => onOpen(row.original.id)} className="flex min-w-0 items-center gap-2 text-left text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <Avatar name={row.original.name} size="sm" />
          <span className="truncate font-medium">{row.original.name}</span>
          {row.original.id === meId ? <Badge size="sm" tone="neutral">You</Badge> : null}
        </button>
      ),
    },
    { id: "email", header: "Email", size: 230, cell: ({ row }) => <span className="truncate text-body">{row.original.email}</span> },
    { id: "roleNames", header: "Role", size: 200, cell: ({ row }) => <Pills value={row.original.roleNames} roles={roles} /> },
    { id: "warehouseCodes", header: "Warehouse", size: 150, cell: ({ row }) => row.original.warehouseCodes ?? <Muted /> },
    { id: "userType", header: "User type", size: 110, cell: ({ row }) => row.original.userType },
    { id: "status", header: "Status", size: 100, cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
    { id: "isApiUser", header: "API user", size: 90, cell: ({ row }) => row.original.isApiUser ? <span className="inline-flex items-center gap-1 text-[12px] text-success" title="API user"><KeyRound className="h-3.5 w-3.5" aria-hidden />API</span> : <span className="sr-only">No</span> },
    { id: "lastLoginAt", header: "Last sign-in", size: 172, cell: ({ row }) => row.original.lastLoginAt ? <DateCell value={row.original.lastLoginAt} /> : <Muted>Never</Muted> },
    { id: "activeSessions", header: "Live sessions", size: 110, meta: { ...hidden, align: "right" }, cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.activeSessions}</span> },
    { id: "createdAt", header: "Created date", size: 172, meta: hidden, cell: ({ row }) => <DateCell value={row.original.createdAt} /> },
  ];
}

function BulkImportMenu({ allowed, loading }: { readonly allowed: boolean; readonly loading: boolean }) {
  if (loading) return <PermissionPending width={172} />;
  return (
    <span className="inline-flex items-center gap-1">
    <InfoTip content={IMPORT_TIP} />
    <DropdownMenu>
      <DisabledReason reason={allowed ? null : NO_PERMISSION}>
        <DropdownMenuTrigger asChild disabled={!allowed}>
          <Button variant="secondary" disabled={!allowed}>
            <Upload className="h-4 w-4" aria-hidden />Bulk import/update
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </DisabledReason>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem icon={UserPlus} href="/imports/users" description="Create users with their role from Excel">Bulk import users</DropdownMenuItem>
        <DropdownMenuItem icon={FileSpreadsheet} href="/imports/user-roles" description="Assign or unassign roles of existing users">Import user-role</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={FileSpreadsheet} href="/imports/user-warehouses" description="Give or remove warehouse access in bulk">Assign/unassign user-warehouse</DropdownMenuItem>
        <DropdownMenuItem icon={FileSpreadsheet} href="/imports/user-clients" description="Give or remove client access in bulk">Assign/unassign user-client</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </span>
  );
}

export function UsersPage() {
  const perms = usePagePerms("settings.users", PERMS);
  const meId = useMeId();
  const options = useAdminOptions();
  usePasswordPolicy(); // warm the policy so the wizard meter shows the company rules at once
  const fields = React.useMemo(() => toFilterFields(USER_FIELDS, {
    roleId: options.roles.map((r) => ({ value: r.id, label: r.name })),
    warehouseId: options.warehouses.map((w) => ({ value: w.id, label: w.code })),
  }), [options.roles, options.warehouses]);
  const g = useGrid<UserRow>({ gridKey: USERS_GRID_KEY, path: "/api/users", fields });
  const [wizard, setWizard] = React.useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  // Detail drawer is addressable: /settings/users?id=<userId> (native history keeps it instant).
  const searchParams = useSearchParams();
  const [detailId, setDetailIdState] = React.useState<string | null>(() => searchParams.get("id"));
  const setDetailId = React.useCallback((id: string | null) => {
    setDetailIdState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("id", id); else url.searchParams.delete("id");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);
  const [log, setLog] = React.useState<UserRow | null>(null);
  const [sessions, setSessions] = React.useState<{ id: string; name: string } | null>(null);
  const [statusChange, setStatusChange] = React.useState<{ rows: readonly UserRow[]; isActive: boolean } | null>(null);
  const [resetFor, setResetFor] = React.useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = React.useState<{ email: string; temporaryPassword: string } | null>(null);
  const action = useAction([["grid", USERS_GRID_KEY]]);
  const patchUsers = useGridPatch<UserRow>(USERS_GRID_KEY);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const cols = React.useMemo(() => columns(setDetailId, meId, options.roles), [meId, setDetailId, options.roles]);

  const bulkActions: readonly BulkAction[] = [
    { key: "activate", label: "Activate", icon: Power, onSelect: (ids) => setStatusChange({ rows: selected(ids), isActive: true }), disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) => selected(ids).every((r) => r.isActive) ? "The selected users are already active" : null },
    { key: "deactivate", label: "Deactivate", icon: PowerOff, destructive: true, onSelect: (ids) => setStatusChange({ rows: selected(ids), isActive: false }), disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) => selected(ids).every((r) => !r.isActive) ? "The selected users are already inactive" : ids.includes(meId ?? "") && ids.length === 1 ? "You can't deactivate your own account" : null },
  ];
  const rowActions = (row: UserRow): readonly RowAction[] => [
    { key: "details", label: "Show details", icon: Eye, onSelect: () => setDetailId(row.id) },
    { key: "edit", label: "Edit", icon: Pencil, onSelect: () => setWizard({ open: true, editId: row.id }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "log", label: "Change log", icon: History, onSelect: () => setLog(row), disabledReason: perms.change_log || perms.view ? null : NO_PERMISSION },
    row.isActive
      ? { key: "deactivate", label: "Deactivate", icon: PowerOff, destructive: true, onSelect: () => setStatusChange({ rows: [row], isActive: false }), disabledReason: !perms.edit ? NO_PERMISSION : row.id === meId ? "You can't deactivate your own account" : null }
      : { key: "activate", label: "Activate", icon: Power, onSelect: () => setStatusChange({ rows: [row], isActive: true }), disabledReason: perms.edit ? null : NO_PERMISSION },
    { key: "reset", label: "Reset password", icon: KeyRound, onSelect: () => setResetFor(row), disabledReason: !perms.edit ? NO_PERMISSION : row.id === meId ? "Use Change Password for your own account" : null },
    { key: "sessions", label: `Sessions (${row.activeSessions})`, icon: Laptop, onSelect: () => setSessions({ id: row.id, name: row.name }) },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const add = () => setWizard({ open: true, editId: null });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={USERS_ROLES_TITLE} tabs="users"
        helper={USERS_ROLES_HELPER}
        actions={
          <>
            <BulkImportMenu allowed={perms.import_file} loading={perms.loading} />
            {perms.loading ? <PermissionPending /> : <DisabledReason reason={perms.create ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.create} onClick={add}><Plus className="h-4 w-4" aria-hidden />Add user</Button></DisabledReason>}
          </>
        } />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by email or name" bulkActions={bulkActions.map((a) => armDestructive(a, g.toolbarProps.selectedIds))} bulkNoun="user" />
      <DataGrid<UserRow>
        {...g.gridProps}
        columns={cols}
        getRowId={(r) => r.id}
        rowActions={(row) => rowActions(row).map((a) => armDestructive(a))}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? "No users match these filters" : "No users yet"}
        emptyDescription={filtered ? "Clear a filter or search for another email." : "Add the people who work in your warehouses."}
        emptyAction={perms.create && !filtered ? <Button variant="primary" onClick={add}><Plus className="h-4 w-4" />Add user</Button> : undefined}
      />
      <UserWizardDrawer open={wizard.open} editId={wizard.editId} onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))} onSaved={() => g.refetch()} />
      <UserDetailDrawer id={detailId} seed={g.rows.find((r) => r.id === detailId) ?? null} canEdit={perms.edit} onOpenChange={(o) => !o && setDetailId(null)}
        onEdit={(id) => { setDetailId(null); setWizard({ open: true, editId: id }); }}
        onSessions={(id) => { const row = g.rows.find((r) => r.id === id); setDetailId(null); setSessions({ id, name: row?.name ?? "User" }); }} />
      <UserSessionsDrawer user={sessions} canEdit={perms.edit} onOpenChange={(o) => !o && setSessions(null)} onChanged={() => g.refetch()} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/users/${log.id}/change-log` : null} title={`User change log · ${log?.name ?? ""}`} />
      <ConfirmDialog
        open={statusChange !== null}
        onOpenChange={(o) => !o && setStatusChange(null)}
        variant={statusChange?.isActive ? "info" : "danger"}
        icon={statusChange?.isActive ? Power : PowerOff}
        title={statusChange ? `${statusChange.isActive ? "Activate" : "Deactivate"} ${statusChange.rows.length === 1 ? statusChange.rows[0]?.name : `${statusChange.rows.length} users`}?` : ""}
        description={statusChange?.isActive ? "They can sign in again with their current password." : "They are signed out on every device at their next click and can't sign in until reactivated."}
        confirmLabel={statusChange?.isActive ? "Yes, activate" : "Yes, deactivate"}
        cancelLabel="No"
        records={{ columns: [{ key: "name", label: "User" }, { key: "email", label: "Email" }, { key: "status", label: "Status" }], rows: (statusChange?.rows ?? []).map((r) => ({ name: r.name, email: r.email, status: r.status })) }}
        onConfirm={async () => {
          if (!statusChange) return;
          const result = await action.run<BulkResponse>("/api/users/bulk-status", "POST", { ids: statusChange.rows.map((r) => r.id), isActive: statusChange.isActive });
          if (result) {
            const done = new Set(result.succeeded);
            const isActive = statusChange.isActive;
            patchUsers((rows) => rows.map((r) => (done.has(r.id) ? { ...r, isActive, status: isActive ? "Active" : "Inactive", activeSessions: isActive ? r.activeSessions : 0 } : r)));
            toastBulk(result, "user", isActive ? "activated" : "deactivated");
            g.clearSelection();
          }
          setStatusChange(null);
        }}
      />
      <ConfirmDialog
        open={resetFor !== null}
        onOpenChange={(o) => !o && setResetFor(null)}
        variant="attention"
        icon={KeyRound}
        title={`Reset the password of ${resetFor?.name ?? ""}?`}
        description="A one-time temporary password replaces the current one, every session is signed out, and the user must choose a new password after signing in."
        confirmLabel="Yes, reset"
        cancelLabel="No"
        onConfirm={async () => {
          if (!resetFor) return;
          const result = await action.run<{ temporaryPassword: string; email: string }>(`/api/users/${resetFor.id}/reset-password`, "POST");
          if (result) { setTempPassword(result); toast.success("Password reset", `${resetFor.name} was signed out everywhere.`); }
          setResetFor(null);
        }}
      />
      <TemporaryPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}
