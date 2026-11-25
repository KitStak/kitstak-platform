'use client';

/**
 * Warehouses (`/settings/warehouses`): grid (code, address, contact, type, default, active,
 * locations) with Create, bulk Activate / Deactivate, and row ⋯ Show details · Edit ·
 * Change log · Set as default · Deactivate (blocked while the warehouse has open work).
 */
import * as React from 'react';
import { AlertTriangle, Ban, CheckCircle2, Eye, History, Pencil, Plus, Star } from 'lucide-react';
import {
  DataGrid,
  GridToolbar,
  useGrid,
  type BulkAction,
  type GridColumnDef,
  type RowAction,
} from '@/components/grid';
import { useShellPlan } from '@/components/layout/app-shell';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { useApiQuery } from '@/lib/query-client';
import {
  defaultSwitchImpact,
  storedAddressIssues,
  WAREHOUSE_FIELDS,
  WAREHOUSES_GRID_KEY,
} from '@/lib/grid-defs/facility/warehouses';
import { warehouseLabel } from '@/lib/grid-defs/facility/common';
import type { WarehouseDetail, WarehouseRow } from '@/server/repositories/warehouses';
import {
  CodeCell,
  DetailList,
  EntityChangeLogDrawer,
  Muted,
  NO_PERMISSION,
  Num,
  StatRow,
  toastBulk,
  toFilterFields,
  useAction,
  usePagePerms,
  type BulkResponse,
} from '@/components/facility/facility-shared';
import { WarehouseDrawer } from './warehouse-drawer';

const PERMS = ['view', 'create', 'edit', 'delete'] as const;

function ActivePill({ active }: { readonly active: boolean }) {
  return (
    <Badge tone={active ? 'success' : 'neutral'} size="sm" shape="pill">
      {active ? 'Active' : 'Inactive'}
    </Badge>
  );
}

const COLUMNS: GridColumnDef<WarehouseRow>[] = [
  {
    id: 'code',
    header: 'Code',
    size: 130,
    meta: { alwaysVisible: true },
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <CodeCell label={`warehouse ${row.original.code}`}>{row.original.code}</CodeCell>
        {row.original.isDefault ? (
          <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-label="Default warehouse" />
        ) : null}
      </span>
    ),
  },
  { id: 'name', header: 'Name', size: 200, cell: ({ row }) => row.original.name },
  {
    id: 'address',
    header: 'Address',
    size: 300,
    cell: ({ row }) => {
      const issues = storedAddressIssues(row.original);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {issues.length ? (
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-warning"
              role="img"
              aria-label={`Needs fixing: ${issues.join('; ')}`}
            >
              <title>{issues.join('; ')}</title>
            </AlertTriangle>
          ) : null}
          <span className="truncate text-secondary">{row.original.address}</span>
        </span>
      );
    },
  },
  {
    id: 'contactName',
    header: 'Contact',
    size: 170,
    cell: ({ row }) =>
      row.original.contactName ? (
        <span className="flex flex-col leading-tight">
          <span>{row.original.contactName}</span>
          {row.original.contactPhone ? (
            <span className="text-2xs text-faint">{row.original.contactPhone}</span>
          ) : null}
        </span>
      ) : (
        <Muted />
      ),
  },
  {
    id: 'type',
    header: 'Type',
    size: 100,
    cell: ({ row }) => (
      <Badge tone={row.original.type === 'Internal' ? 'neutral' : 'info'} size="sm">
        {row.original.type}
      </Badge>
    ),
  },
  {
    id: 'isDefault',
    header: 'Default',
    size: 90,
    cell: ({ row }) =>
      row.original.isDefault ? (
        <Badge tone="warning" size="sm" shape="pill">
          Default
        </Badge>
      ) : (
        <Muted>No</Muted>
      ),
  },
  {
    id: 'isActive',
    header: 'Status',
    size: 100,
    cell: ({ row }) => <ActivePill active={row.original.isActive} />,
  },
  {
    id: 'locationCount',
    header: 'Locations',
    size: 100,
    meta: { align: 'right' },
    cell: ({ row }) => (
      <div className="text-right">
        <Num value={row.original.locationCount} />
      </div>
    ),
  },
  {
    id: 'timezone',
    header: 'Timezone',
    size: 160,
    meta: { defaultVisible: false },
    cell: ({ row }) => row.original.timezone,
  },
  {
    id: 'createdAt',
    header: 'Created date',
    size: 160,
    meta: { defaultVisible: false },
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('en-US'),
  },
];

function WarehouseDetailDrawer({
  id,
  onOpenChange,
  onEdit,
  canEdit,
}: {
  readonly id: string | null;
  readonly onOpenChange: (o: boolean) => void;
  readonly onEdit: (id: string) => void;
  readonly canEdit: boolean;
}) {
  const q = useApiQuery<WarehouseDetail>(['warehouse', id ?? ''], id ? `/api/warehouses/${id}` : null, {
    staleTime: 0,
  });
  const d = q.data?.data;
  const work = d ? d.openWork.orders + d.openWork.purchaseOrders + d.openWork.jobs : 0;
  return (
    <Drawer
      open={id !== null}
      onOpenChange={onOpenChange}
      width={45}
      title={d ? `${d.code} · ${d.name}` : 'Warehouse'}
      footer={
        d && canEdit ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => onEdit(d.id)}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        ) : undefined
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : q.isError || !d ? (
        <EmptyState
          title="Couldn't load this warehouse"
          description={q.error?.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-1.5">
            <ActivePill active={d.isActive} />
            {d.isDefault ? (
              <Badge tone="warning" size="sm" shape="pill">
                Default warehouse
              </Badge>
            ) : null}
            <Badge tone="outline" size="sm">
              {d.type}
            </Badge>
          </div>
          <StatRow
            stats={[
              { label: 'Locations', value: d.stats.locations.toLocaleString('en-US') },
              { label: 'Units on hand', value: d.stats.onHand.toLocaleString('en-US') },
              { label: 'LP types · carts', value: `${d.stats.lpTypes} · ${d.stats.carts}` },
              {
                label: 'Open work',
                value: work.toLocaleString('en-US'),
                tone: work > 0 ? 'warning' : 'success',
              },
            ]}
          />
          <DetailList
            title="Information"
            items={[
              { label: 'Prefix', value: d.prefix },
              { label: 'Timezone', value: d.timezone },
              {
                label: 'Address',
                value: [
                  d.addressLine,
                  d.addressLine2,
                  `${d.city}, ${d.state} ${d.postalCode ?? ''}`.trim(),
                  d.country,
                ]
                  .filter(Boolean)
                  .join(', '),
                wide: true,
              },
              { label: 'Contact', value: d.contactName },
              { label: 'Phone', value: d.contactPhone },
              { label: 'Email', value: d.email, wide: true },
              {
                label: 'Day shift',
                value: `${d.shiftStart} ${d.shiftStartZone} to ${d.shiftEnd} ${d.shiftEndZone}`,
                wide: true,
              },
            ]}
          />
          <DetailList
            title="Settings"
            items={[
              { label: 'Dimension unit', value: d.defaultDimensionUnit },
              { label: 'Weight unit', value: d.defaultWeightUnit },
              { label: 'Default receiving location', value: d.defaultReceivingLocationCode },
              { label: 'Default ship location', value: d.defaultShipLocationCode },
              { label: 'Default return location', value: d.defaultReturnLocationCode },
              { label: 'Volumetric putaway with LP dims', value: d.useLpDimsForPutaway ? 'Yes' : 'No' },
              { label: 'Adjustment reason required', value: d.mandatoryAdjustmentReason ? 'Yes' : 'No' },
              { label: 'Count reason required', value: d.mandatoryCountReason ? 'Yes' : 'No' },
              {
                label: 'Mobile auto logout',
                value: d.mobileAutoLogout ? `After ${d.mobileAutoLogoutMinutes} minutes` : 'Off',
                wide: true,
              },
            ]}
          />
          {work > 0 ? (
            <DetailList
              title="Open work"
              items={[
                { label: 'Open orders', value: d.openWork.orders.toLocaleString('en-US') },
                { label: 'Open purchase orders', value: d.openWork.purchaseOrders.toLocaleString('en-US') },
                { label: 'Open jobs', value: d.openWork.jobs.toLocaleString('en-US') },
              ]}
            />
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

export function WarehousesPage() {
  const perms = usePagePerms('settings.warehouse', PERMS);
  const fields = React.useMemo(() => toFilterFields(WAREHOUSE_FIELDS), []);
  const g = useGrid<WarehouseRow>({ gridKey: WAREHOUSES_GRID_KEY, path: '/api/warehouses', fields });
  const [drawer, setDrawer] = React.useState<{ open: boolean; editId: string | null }>({
    open: false,
    editId: null,
  });
  const [detailId, setDetailId] = React.useState<string | null>(null);
  // The plan's warehouse limit is known before the form opens (docs/billing/SPEC.md 6.9). At the
  // limit, "Create warehouse" shows the price and "Add to my plan" first, so nobody fills in the
  // two step form and hears "not in your plan" at the last click. The server checks again on save.
  const plan = useShellPlan();
  const [limitOpen, setLimitOpen] = React.useState(false);
  const openCreate = () => {
    if (plan?.warehouseLimit) setLimitOpen(true);
    else setDrawer({ open: true, editId: null });
  };
  const [log, setLog] = React.useState<WarehouseRow | null>(null);
  const [deactivate, setDeactivate] = React.useState<readonly WarehouseRow[] | null>(null);
  const [activate, setActivate] = React.useState<readonly WarehouseRow[] | null>(null);
  // Set as default always confirms (critic R4: one click silently moved the company default).
  const [defaultTarget, setDefaultTarget] = React.useState<{
    readonly row: WarehouseRow;
    readonly current: WarehouseRow | null;
  } | null>(null);
  // ["warehouses"] refreshes the active flags behind every M10 warehouse picker.
  const action = useAction([['grid', WAREHOUSES_GRID_KEY], ['warehouse'], ['warehouses'], ['me']]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));

  const setActive = async (ids: readonly string[], active: boolean) => {
    const result = await action.run<BulkResponse>('/api/warehouses/bulk-active', 'POST', { ids, active });
    if (result) {
      toastBulk(result, 'warehouse', active ? 'activated' : 'deactivated');
      g.clearSelection();
    }
  };
  const makeDefault = async (row: WarehouseRow, previous: WarehouseRow | null, isUndo = false) => {
    const result = await action.run<{ code: string }>(`/api/warehouses/${row.id}/set-default`, 'POST');
    if (!result) return;
    if (isUndo) toast.success('Default restored', `${result.code} is the default warehouse again.`);
    else
      toast.success('Default warehouse changed', `${result.code} is now the default warehouse.`, {
        duration: 10_000,
        action: previous
          ? { label: 'Undo', onClick: () => void makeDefault(previous, null, true) }
          : undefined,
      });
  };
  const askDefault = (row: WarehouseRow) =>
    setDefaultTarget({ row, current: g.rows.find((r) => r.isDefault && r.id !== row.id) ?? null });
  const deactivateReason = (row: WarehouseRow): string | null =>
    !perms.edit
      ? NO_PERMISSION
      : !row.isActive
        ? 'Already inactive'
        : row.isDefault
          ? 'Make another warehouse the default first'
          : row.openWork > 0
            ? `${row.openWork} open orders, POs or jobs; finish or cancel them first`
            : null;

  const bulkActions: readonly BulkAction[] = [
    {
      key: 'activate',
      label: 'Activate',
      icon: CheckCircle2,
      onSelect: (ids) => setActivate(selected(ids).filter((r) => !r.isActive)),
      disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) =>
        selected(ids).every((r) => r.isActive) ? 'The selected warehouses are already active' : null,
    },
    {
      key: 'deactivate',
      label: 'Deactivate',
      icon: Ban,
      onSelect: (ids) => setDeactivate(selected(ids)),
      disabledReason: perms.edit ? null : NO_PERMISSION,
      eligibility: (ids) => {
        const rows = selected(ids);
        return rows.length && rows.every((r) => deactivateReason(r) !== null)
          ? deactivateReason(rows[0] as WarehouseRow)
          : null;
      },
    },
  ];

  const rowActions = (row: WarehouseRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, onSelect: () => setDetailId(row.id) },
    {
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      onSelect: () => setDrawer({ open: true, editId: row.id }),
      disabledReason: perms.edit ? null : NO_PERMISSION,
    },
    { key: 'log', label: 'Change log', icon: History, onSelect: () => setLog(row) },
    {
      key: 'default',
      label: 'Set as default',
      icon: Star,
      onSelect: () => askDefault(row),
      disabledReason: !perms.edit
        ? NO_PERMISSION
        : row.isDefault
          ? 'Already the default warehouse'
          : !row.isActive
            ? 'Activate the warehouse first'
            : null,
    },
    row.isActive
      ? {
          key: 'deactivate',
          label: 'Deactivate',
          icon: Ban,
          destructive: true,
          onSelect: () => setDeactivate([row]),
          disabledReason: deactivateReason(row),
        }
      : {
          key: 'activate',
          label: 'Activate',
          icon: CheckCircle2,
          onSelect: () => setActivate([row]),
          disabledReason: perms.edit ? null : NO_PERMISSION,
        },
  ];

  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Warehouse"
        helpHref="/locations/help#warehouses"
        actions={
          perms.create ? (
            // `data-plan-write`: in view only this press opens the "view only" dialog (see ViewOnlyGuard).
            <Button variant="primary" data-plan-write data-testid="warehouse-create" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              Create warehouse
            </Button>
          ) : null
        }
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search warehouse code or name"
        bulkActions={bulkActions}
        bulkNoun="warehouse"
      />
      <DataGrid<WarehouseRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? 'No warehouses match these filters' : 'No warehouses yet'}
        emptyDescription={
          filtered
            ? 'Clear a filter or search for another code.'
            : 'Create your first warehouse to start adding locations.'
        }
        emptyAction={
          perms.create && !filtered ? (
            <Button variant="primary" data-plan-write onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Create warehouse
            </Button>
          ) : undefined
        }
      />
      <ConfirmDialog
        open={limitOpen}
        onOpenChange={setLimitOpen}
        // An offer, not a warning: the calm header with no coloured band.
        variant="offer"
        title="This warehouse is not in your plan yet"
        description={plan?.warehouseLimit?.message}
        confirmLabel="Add to my plan"
        cancelLabel="Not now"
        onConfirm={() => {
          // The Portal shows the price again and asks for a yes. Its "Back to WMS" link returns here.
          if (plan?.warehouseLimit) window.location.assign(plan.warehouseLimit.planUrl);
        }}
      />
      <WarehouseDrawer
        open={drawer.open}
        editId={drawer.editId}
        onOpenChange={(o) => setDrawer((d) => ({ ...d, open: o }))}
        onSaved={() => g.refetch()}
      />
      <WarehouseDetailDrawer
        id={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        canEdit={perms.edit}
        onEdit={(id) => {
          setDetailId(null);
          setDrawer({ open: true, editId: id });
        }}
      />
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/warehouses/${log.id}/change-log` : null}
        title={`Change log · ${log?.code ?? ''}`}
      />
      <ConfirmDialog
        open={deactivate !== null}
        onOpenChange={(o) => !o && setDeactivate(null)}
        variant="danger"
        title={`Deactivate ${deactivate?.length === 1 ? `warehouse ${deactivate[0]?.code}` : `${deactivate?.length ?? 0} warehouses`}?`}
        description="Inactive warehouses disappear from the warehouse switcher and can't receive new work. Warehouses with open work are skipped."
        confirmLabel="Yes, deactivate"
        cancelLabel="No"
        records={{
          columns: [
            { key: 'code', label: 'Warehouse' },
            { key: 'name', label: 'Name' },
            { key: 'locations', label: 'Locations' },
            { key: 'work', label: 'Open work' },
          ],
          rows: (deactivate ?? []).map((r) => ({
            code: r.code,
            name: r.name,
            locations: r.locationCount.toLocaleString('en-US'),
            work: r.openWork > 0 ? <span className="text-warning">{r.openWork} open</span> : 'None',
          })),
        }}
        onConfirm={async () => {
          await setActive(
            (deactivate ?? []).map((r) => r.id),
            false,
          );
          setDeactivate(null);
        }}
      />
      <ConfirmDialog
        open={activate !== null}
        onOpenChange={(o) => !o && setActivate(null)}
        variant="info"
        icon={CheckCircle2}
        title={`Activate ${activate?.length === 1 ? `warehouse ${activate[0]?.code}` : `${activate?.length ?? 0} warehouses`}?`}
        description="They can receive orders, receipts and jobs again, and their locations reopen for putaway and picking."
        confirmLabel="Yes, activate"
        cancelLabel="No"
        records={{
          columns: [
            { key: 'code', label: 'Warehouse' },
            { key: 'name', label: 'Name' },
            { key: 'locations', label: 'Locations' },
          ],
          rows: (activate ?? []).map((r) => ({
            code: r.code,
            name: r.name,
            locations: r.locationCount.toLocaleString('en-US'),
          })),
        }}
        onConfirm={async () => {
          await setActive(
            (activate ?? []).map((r) => r.id),
            true,
          );
          setActivate(null);
        }}
      />
      <ConfirmDialog
        open={defaultTarget !== null}
        onOpenChange={(o) => !o && setDefaultTarget(null)}
        variant="attention"
        icon={Star}
        title={`Make ${defaultTarget?.row.code ?? ''} the default warehouse?`}
        description={
          defaultTarget
            ? defaultSwitchImpact(defaultTarget.current?.code ?? null, defaultTarget.row.code)
            : undefined
        }
        confirmLabel="Yes, change default"
        cancelLabel="No"
        records={
          defaultTarget
            ? {
                columns: [
                  { key: 'role', label: '' },
                  { key: 'code', label: 'Warehouse' },
                  { key: 'locations', label: 'Locations' },
                  { key: 'work', label: 'Open work' },
                ],
                rows: [
                  ...(defaultTarget.current
                    ? [
                        {
                          role: 'Current default',
                          code: warehouseLabel(defaultTarget.current.code, defaultTarget.current.name),
                          locations: defaultTarget.current.locationCount.toLocaleString('en-US'),
                          work: defaultTarget.current.openWork.toLocaleString('en-US'),
                        },
                      ]
                    : []),
                  {
                    role: <strong>New default</strong>,
                    code: warehouseLabel(defaultTarget.row.code, defaultTarget.row.name),
                    locations: defaultTarget.row.locationCount.toLocaleString('en-US'),
                    work: defaultTarget.row.openWork.toLocaleString('en-US'),
                  },
                ],
              }
            : undefined
        }
        onConfirm={async () => {
          const t = defaultTarget;
          if (t) await makeDefault(t.row, t.current);
          setDefaultTarget(null);
        }}
      />
    </div>
  );
}
