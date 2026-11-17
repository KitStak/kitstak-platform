'use client';

/**
 * Mobile Carts (`/settings/mobile-carts`): grid (status derived from the open job holding the
 * cart), Create (2-step wizard), bulk Label (cart and/or cell labels) and Delete (Available
 * carts only), row ⋯ Show details · Edit · Duplicate · Label · Change log · Delete.
 */
import * as React from 'react';
import { Copy, Eye, History, PackageOpen, Pencil, Plus, ShoppingCart, Tag, Trash2 } from 'lucide-react';
import {
  DataGrid,
  GridToolbar,
  LinkCell,
  useGrid,
  type BulkAction,
  type GridColumnDef,
  type RowAction,
} from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { PrintOptionsModal } from '@/components/shared/print-options-modal';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import {
  cellDisplayName,
  MOBILE_CART_FIELDS,
  MOBILE_CARTS_GRID_KEY,
} from '@/lib/grid-defs/facility/mobile-carts';
import { Select } from '@/components/ui/select';
import { useCan } from '@/lib/permissions-client';
import type { AssignJobResult } from '@/server/domain/mobile-cart-cells';
import type { MobileCartDetail, MobileCartRow } from '@/server/repositories/mobile-carts';
import {
  apiErrorMessage,
  AvailabilityPill,
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
  useLookups,
  usePagePerms,
  useWarehouseOptions,
  YesNo,
  type BulkResponse,
} from '@/components/facility/facility-shared';
import { MobileCartWizardDrawer } from './mobile-cart-wizard';

const PERMS = ['view', 'create', 'edit', 'delete', 'label', 'duplicate'] as const;
const hidden = { defaultVisible: false } as const;
const right = (v: number) => (
  <div className="text-right">
    <Num value={v} />
  </div>
);
type LabelScope = 'carts' | 'cells' | 'both';

const COLUMNS: GridColumnDef<MobileCartRow>[] = [
  {
    id: 'code',
    header: 'Cart code',
    size: 130,
    meta: { alwaysVisible: true },
    cell: ({ row }) => <CodeCell label={`mobile cart ${row.original.code}`}>{row.original.code}</CodeCell>,
  },
  {
    id: 'description',
    header: 'Cart description',
    size: 200,
    cell: ({ row }) => row.original.description ?? <Muted />,
  },
  { id: 'warehouseCode', header: 'Warehouse', size: 100, cell: ({ row }) => row.original.warehouseCode },
  {
    id: 'status',
    header: 'Status',
    size: 136,
    meta: { headerTip: 'Occupied while an open job holds the cart' },
    cell: ({ row }) => <AvailabilityPill status={row.original.status} />,
  },
  {
    id: 'cartTypeName',
    header: 'Cart type',
    size: 150,
    meta: { label: 'Mobile cart type' },
    enableSorting: false,
    cell: ({ row }) => row.original.cartTypeName ?? <Muted />,
  },
  {
    id: 'cellCount',
    header: 'Cells',
    size: 96,
    meta: { align: 'right', label: 'Number of cells' },
    cell: ({ row }) => right(row.original.cellCount),
  },
  {
    id: 'levels',
    header: 'Levels',
    size: 96,
    meta: { align: 'right', label: 'Number of levels' },
    cell: ({ row }) => right(row.original.levels),
  },
  {
    id: 'columns',
    header: 'Columns',
    size: 104,
    meta: { align: 'right', label: 'Number of columns' },
    cell: ({ row }) => right(row.original.columns),
  },
  {
    id: 'taskCount',
    header: 'Open tasks',
    size: 116,
    meta: { align: 'right', label: 'Open tasks of the job holding the cart' },
    cell: ({ row }) => right(row.original.taskCount),
  },
  {
    id: 'jobCode',
    header: 'Job code',
    size: 120,
    cell: ({ row }) =>
      row.original.jobId && row.original.jobCode ? (
        <LinkCell href={`/jobs/${row.original.jobId}`}>{row.original.jobCode}</LinkCell>
      ) : (
        <Muted />
      ),
  },
  {
    id: 'orderCount',
    header: 'Orders',
    size: 100,
    meta: { align: 'right', label: 'Number of orders' },
    cell: ({ row }) => right(row.original.orderCount),
  },
  { id: 'operationType', header: 'Operation type', size: 130, cell: ({ row }) => row.original.operationType },
  {
    id: 'allowMultipleJob',
    header: 'Multi-job',
    size: 110,
    meta: { label: 'Allow multiple jobs' },
    cell: ({ row }) => <YesNo value={row.original.allowMultipleJob} />,
  },
  {
    id: 'isDynamic',
    header: 'Dynamic',
    size: 100,
    meta: hidden,
    cell: ({ row }) => <YesNo value={row.original.isDynamic} />,
  },
  {
    id: 'createdAt',
    header: 'Created date',
    size: 130,
    meta: hidden,
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString('en-US'),
  },
];

function CartDetailDrawer({
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
  const q = useApiQuery<MobileCartDetail>(['mobile-cart', id ?? ''], id ? `/api/mobile-carts/${id}` : null, {
    staleTime: 0,
  });
  const d = q.data?.data;
  const levels = d ? Array.from({ length: d.levels }, (_, i) => i + 1) : [];
  const cellOrder = new Map((d?.orders ?? []).filter((o) => o.cell).map((o) => [o.cell as string, o]));
  const unsorted = (d?.orders ?? []).filter((o) => !o.cell).length;
  return (
    <Drawer
      open={id !== null}
      onOpenChange={onOpenChange}
      width={60}
      title={d ? `Mobile cart ${d.code}` : 'Mobile cart'}
      description={d?.description ?? undefined}
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
        <Skeleton className="h-64 w-full" />
      ) : q.isError || !d ? (
        <EmptyState
          title="Couldn't load this mobile cart"
          description={q.error?.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <StatRow
            stats={[
              { label: 'Status', value: <AvailabilityPill status={d.status} /> },
              { label: 'Cells', value: d.cellCount },
              { label: 'Open tasks', value: d.taskCount },
              { label: 'Orders', value: d.orderCount },
            ]}
          />
          <DetailList
            title="Mobile cart"
            items={[
              { label: 'Warehouse', value: d.warehouseCode },
              { label: 'Mobile cart type', value: d.cartTypeName },
              { label: 'Layout', value: `${d.levels} levels × ${d.columns} columns` },
              { label: 'Operation type', value: d.operationType },
              { label: 'Allow multiple jobs', value: d.allowMultipleJob ? 'Yes' : 'No' },
              { label: 'Dynamic', value: d.isDynamic ? 'Yes' : 'No' },
              {
                label: 'Job',
                value:
                  d.jobId && d.jobCode ? (
                    <LinkCell href={`/jobs/${d.jobId}`}>{d.jobCode}</LinkCell>
                  ) : (
                    'Not in use'
                  ),
                wide: true,
              },
            ]}
          />
          <CartJobPanel cart={d} />
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-secondary">
              Cells{' '}
              <span className="font-normal normal-case text-faint">
                · level letter + column, scanned as {d.code}-A01
              </span>
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-sunken/50 p-3">
              <div
                className="inline-grid gap-1.5"
                style={{ gridTemplateColumns: `2rem repeat(${Math.max(1, d.columns)}, minmax(5.5rem, 1fr))` }}
              >
                <span />
                {Array.from({ length: d.columns }, (_, c) => (
                  <span key={c} className="text-center text-2xs font-medium text-faint">
                    {String(c + 1).padStart(2, '0')}
                  </span>
                ))}
                {levels.map((l) => (
                  <React.Fragment key={l}>
                    <span className="flex items-center text-2xs font-semibold text-faint">
                      {String.fromCharCode(64 + l)}
                    </span>
                    {Array.from({ length: d.columns }, (_, c) => {
                      const cell = d.cells.find((x) => x.level === l && x.column === c + 1);
                      const held = cell ? cellOrder.get(cell.barcode.toUpperCase()) : undefined;
                      const code = held?.orderCode ?? cell?.orderCode ?? null;
                      return (
                        <span
                          key={c}
                          className={`flex flex-col rounded-md border px-1.5 py-1 text-center shadow-xs ${code ? 'border-info/40 bg-info-soft' : 'border-border bg-surface'}`}
                          title={
                            code
                              ? `Cell ${cellDisplayName(l, c + 1)} (scan ${cell?.barcode ?? ''}) holds ${code}${held ? ` · ${held.picked} of ${held.planned} units picked` : ''}`
                              : `Cell ${cellDisplayName(l, c + 1)} (scan ${cell?.barcode ?? ''}) is free`
                          }
                        >
                          <span className="truncate text-xs font-semibold text-foreground">
                            {cellDisplayName(l, c + 1)}
                          </span>
                          <span
                            className={`truncate text-2xs ${code ? 'font-medium text-info' : 'text-faint'}`}
                          >
                            {code ? `${code}${held ? ` · ${held.picked}/${held.planned}` : ''}` : 'Free'}
                          </span>
                        </span>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </section>
          {d.status === 'Occupied' || d.orders.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-secondary">Orders on this cart</h3>
              {d.orders.length === 0 ? (
                <p className="text-xs text-secondary">The job on this cart has no orders yet.</p>
              ) : (
                <>
                  {unsorted > 0 ? (
                    <p className="text-xs text-secondary">
                      {unsorted === d.orders.length
                        ? 'No order is in a cell yet. Use Put on cart above to give each order a cell.'
                        : `${unsorted} of ${d.orders.length} orders are not in a cell yet.`}
                    </p>
                  ) : null}
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-sunken text-2xs text-secondary">
                        <tr>
                          <th className="px-3 py-2 text-left">Order</th>
                          <th className="px-3 py-2 text-left">Job</th>
                          <th className="px-3 py-2 text-left">Cell / tote</th>
                          <th className="px-3 py-2 text-right">Picked</th>
                          <th className="px-3 py-2 text-right">Open tasks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {d.orders.map((o) => (
                          <tr key={`${o.jobId}-${o.orderId}`}>
                            <td className="px-3 py-1.5">
                              <LinkCell href={`/orders/${o.orderId}`}>{o.orderCode}</LinkCell>
                            </td>
                            <td className="px-3 py-1.5">
                              <LinkCell href={`/jobs/${o.jobId}`}>{o.jobCode}</LinkCell>
                            </td>
                            <td className="px-3 py-1.5">
                              {o.cell ? (
                                <span>
                                  <span className="font-semibold">{cellLabel(d.cells, o.cell)}</span>{' '}
                                  <span className="font-mono text-2xs text-faint">{o.cell}</span>
                                </span>
                              ) : o.tote ? (
                                <span>
                                  Tote <span className="font-mono text-xs">{o.tote}</span>
                                </span>
                              ) : (
                                <Muted>Not assigned yet</Muted>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {o.picked.toLocaleString('en-US')} / {o.planned.toLocaleString('en-US')}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{o.openTasks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

/** "A03" for a cell barcode of this cart, or the barcode itself when it isn't one of its cells. */
function cellLabel(cells: MobileCartDetail['cells'], barcode: string): string {
  const c = cells.find((x) => x.barcode.toUpperCase() === barcode.toUpperCase());
  return c ? cellDisplayName(c.level, c.column) : barcode;
}

interface JobCandidate {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly jobType: string | null;
  readonly orderCount: number;
  readonly cartCode: string | null;
}

/**
 * Put-to-cart (REQ-R10-6): put an open picking job on this cart (each order gets a cell, A01 first)
 * or empty the cart. Shown to whoever can edit carts, assign jobs or execute tasks.
 */
function CartJobPanel({ cart }: { readonly cart: MobileCartDetail }) {
  const { allowed } = useCan(
    [
      'settings.mobile_carts.edit',
      'fulfillment.job_management.assign',
      'fulfillment.task_details.execute_task',
    ],
    'any',
  );
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = React.useState(false);
  const busyCart = cart.status === 'Occupied' && !cart.allowMultipleJob;
  const candidates = useApiQuery<JobCandidate[]>(
    ['mobile-cart-jobs', cart.id],
    allowed ? `/api/mobile-carts/${cart.id}/job` : null,
    { staleTime: 0 },
  );
  const action = useAction([
    ['mobile-cart', cart.id],
    ['mobile-cart-jobs', cart.id],
    ['grid', MOBILE_CARTS_GRID_KEY],
  ]);
  if (!allowed) return null;
  const held = cart.cells.filter((c) => c.orderCode).length;
  const free = cart.cells.length - held;
  const options = (candidates.data?.data ?? [])
    .filter((j) => j.id !== cart.jobId)
    .map((j) => ({
      value: j.id,
      label: `${j.code} · ${j.orderCount} order${j.orderCount === 1 ? '' : 's'} · ${j.status}`,
      textValue: j.code,
    }));
  const assign = async () => {
    if (!jobId) return;
    const r = await action.run<AssignJobResult>(`/api/mobile-carts/${cart.id}/job`, 'POST', { jobId });
    if (!r) return;
    setJobId(null);
    const first = r.assignments
      .slice(0, 3)
      .map((a) => `${a.orderCode} → ${a.display}`)
      .join(', ');
    toast.success(
      `${r.jobCode} is on cart ${r.cartCode}`,
      r.assignments.length > 0
        ? `${r.assignments.length} order${r.assignments.length === 1 ? '' : 's'} placed: ${first}${r.assignments.length > 3 ? '…' : ''}`
        : 'Every order already has a cell.',
    );
  };
  const empty = async () => {
    const r = await action.run<{ cartCode: string; freedCells: number; releasedJobs: readonly string[] }>(
      `/api/mobile-carts/${cart.id}/job`,
      'DELETE',
    );
    setConfirmEmpty(false);
    if (r)
      toast.success(
        `Cart ${r.cartCode} is empty`,
        `${r.freedCells} cell${r.freedCells === 1 ? '' : 's'} freed${r.releasedJobs.length ? ` · ${r.releasedJobs.join(', ')} no longer on the cart` : ''}.`,
      );
  };
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-3"
      aria-label="Put a job on this cart"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-secondary" htmlFor="cart-job">
            Put a picking job on this cart
          </label>
          <Select
            id="cart-job"
            aria-label="Picking job"
            options={options}
            value={jobId}
            onChange={setJobId}
            disabled={busyCart || action.pending}
            placeholder={
              busyCart
                ? 'In use; this cart takes one job at a time'
                : candidates.isPending
                  ? 'Loading jobs…'
                  : options.length === 0
                    ? 'No open picking job in this warehouse'
                    : 'Choose an open picking job'
            }
          />
        </div>
        <Button variant="primary" disabled={!jobId || action.pending} onClick={() => void assign()}>
          <ShoppingCart className="h-4 w-4" />
          Put on cart
        </Button>
        <Button
          variant="secondary"
          disabled={(held === 0 && cart.status !== 'Occupied') || action.pending}
          onClick={() => setConfirmEmpty(true)}
        >
          <PackageOpen className="h-4 w-4" />
          Empty cart
        </Button>
      </div>
      <p className="text-xs text-faint">
        {free} of {cart.cells.length} cells free. Each order gets the next free cell (A01, A02, …); the picker
        scans {cart.code}-A01 to sort into it.
      </p>
      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title={`Empty cart ${cart.code}?`}
        description={`Frees ${held} cell${held === 1 ? '' : 's'} and takes the open job off the cart. Picked units are not moved.`}
        confirmLabel="Empty cart"
        cancelLabel="Cancel"
        onConfirm={empty}
      />
    </section>
  );
}

function DuplicateDialog({
  row,
  onOpenChange,
  onDone,
}: {
  readonly row: MobileCartRow | null;
  readonly onOpenChange: (o: boolean) => void;
  readonly onDone: () => void;
}) {
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const action = useAction([['grid', MOBILE_CARTS_GRID_KEY]]);
  React.useEffect(() => {
    if (row) {
      setCode(`${row.code}-COPY`);
      setError(null);
    }
  }, [row]);
  const submit = async () => {
    if (!code.trim()) {
      setError('Code is required');
      return;
    }
    const data = await action.run<{ code: string }>(
      `/api/mobile-carts/${row?.id}/duplicate`,
      'POST',
      { code },
      (e) => {
        const msg = isApiError(e) && e.fieldErrors?.code?.[0] ? e.fieldErrors.code[0] : apiErrorMessage(e);
        setError(msg);
      },
    );
    if (data) {
      toast.success('Success', `Mobile cart ${data.code} created from ${row?.code}.`);
      onDone();
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title={`Duplicate ${row?.code ?? ''}`}
          description={`Copies the type, layout and ${row?.cellCount ?? 0} cells. Cell barcodes follow the new code.`}
        />
        <DialogBody>
          <form
            id="dup-cart"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="flex flex-col gap-1"
          >
            <label htmlFor="dup-code" className="text-xs font-medium text-body">
              New cart code *
            </label>
            <TextField
              id="dup-code"
              autoFocus
              value={code}
              maxLength={40}
              invalid={Boolean(error)}
              aria-describedby={error ? 'dup-code-err' : undefined}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
            />
            {error ? (
              <p id="dup-code-err" role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="dup-cart" disabled={action.pending || !code.trim()}>
            <Copy className="h-4 w-4" />
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabelScopeDialog({
  rows,
  onOpenChange,
  onPrint,
  pending,
}: {
  readonly rows: readonly MobileCartRow[] | null;
  readonly onOpenChange: (o: boolean) => void;
  readonly onPrint: (scope: LabelScope) => void;
  readonly pending: boolean;
}) {
  const [scope, setScope] = React.useState<LabelScope>('both');
  const carts = rows?.length ?? 0;
  const cells = (rows ?? []).reduce((n, r) => n + r.cellCount, 0);
  const count = scope === 'carts' ? carts : scope === 'cells' ? cells : carts + cells;
  return (
    <Dialog open={rows !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Print mobile cart labels"
          description={`${carts} ${carts === 1 ? 'cart' : 'carts'} selected.`}
        />
        <DialogBody>
          <RadioCards<LabelScope>
            ariaLabel="Labels to print"
            value={scope}
            onChange={setScope}
            options={[
              {
                value: 'both',
                title: 'Cart and cell labels',
                description: `${carts + cells} labels: the cart plate, then every cell`,
              },
              {
                value: 'carts',
                title: 'Cart labels only',
                description: `${carts} ${carts === 1 ? 'label' : 'labels'}`,
              },
              { value: 'cells', title: 'Cell labels only', description: `${cells} labels, level by level` },
            ]}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={pending || count === 0} onClick={() => onPrint(scope)}>
            <Tag className="h-4 w-4" />
            Continue with {count} labels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MobileCartsPage() {
  const perms = usePagePerms('settings.mobile_carts', PERMS);
  const warehouses = useWarehouseOptions();
  const cartTypes = useLookups('mobile_cart_type');
  const fields = React.useMemo(
    () =>
      toFilterFields(MOBILE_CART_FIELDS, { warehouseId: warehouses.short, cartTypeId: cartTypes.options }),
    [warehouses.short, cartTypes.options],
  );
  const g = useGrid<MobileCartRow>({ gridKey: MOBILE_CARTS_GRID_KEY, path: '/api/mobile-carts', fields });
  const [wizard, setWizard] = React.useState<{ open: boolean; editId: string | null }>({
    open: false,
    editId: null,
  });
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<MobileCartRow | null>(null);
  const [dup, setDup] = React.useState<MobileCartRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly MobileCartRow[] | null>(null);
  const [toLabel, setToLabel] = React.useState<readonly MobileCartRow[] | null>(null);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const action = useAction([['grid', MOBILE_CARTS_GRID_KEY]]);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const deleteReason = (row: MobileCartRow) =>
    !perms.delete
      ? NO_PERMISSION
      : row.status === 'Occupied'
        ? `In use by job ${row.jobCode ?? ''}; only Available carts can be deleted`
        : null;

  const printLabels = async (scope: LabelScope) => {
    const records = await action.run<unknown[]>('/api/mobile-carts/labels', 'POST', {
      ids: (toLabel ?? []).map((r) => r.id),
      include: scope,
    });
    if (records) {
      setToLabel(null);
      setLabels(records);
    }
  };

  const bulkActions: readonly BulkAction[] = [
    {
      key: 'label',
      label: 'Label',
      icon: Tag,
      onSelect: (ids) => setToLabel(selected(ids)),
      disabledReason: perms.label ? null : NO_PERMISSION,
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      onSelect: (ids) => setToDelete(selected(ids)),
      disabledReason: perms.delete ? null : NO_PERMISSION,
      eligibility: (ids) => {
        const rows = selected(ids);
        return rows.length && rows.every((r) => r.status === 'Occupied')
          ? 'Only Available carts can be deleted'
          : null;
      },
    },
  ];
  const rowActions = (row: MobileCartRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, onSelect: () => setDetailId(row.id) },
    {
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      onSelect: () => setWizard({ open: true, editId: row.id }),
      disabledReason: perms.edit ? null : NO_PERMISSION,
    },
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      onSelect: () => setDup(row),
      disabledReason: perms.duplicate ? null : NO_PERMISSION,
    },
    {
      key: 'label',
      label: 'Label',
      icon: Tag,
      onSelect: () => setToLabel([row]),
      disabledReason: perms.label ? null : NO_PERMISSION,
    },
    { key: 'log', label: 'Change log', icon: History, onSelect: () => setLog(row) },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => setToDelete([row]),
      disabledReason: deleteReason(row),
    },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const create = () => setWizard({ open: true, editId: null });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Mobile Carts"
        helpHref="/locations/help#mobile-carts"
        actions={
          perms.create ? (
            <Button variant="primary" onClick={create}>
              <Plus className="h-4 w-4" aria-hidden />
              Create mobile cart
            </Button>
          ) : null
        }
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search cart code"
        bulkActions={bulkActions}
        bulkNoun="mobile cart"
      />
      <DataGrid<MobileCartRow>
        {...g.gridProps}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        rowActions={rowActions}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle={filtered ? 'No mobile carts match these filters' : 'No mobile carts yet'}
        emptyDescription={
          filtered
            ? 'Clear a filter or search for another code.'
            : 'Create a cart so pickers can sort several orders into its cells in one walk.'
        }
        emptyAction={
          perms.create && !filtered ? (
            <Button variant="primary" onClick={create}>
              <Plus className="h-4 w-4" />
              Create mobile cart
            </Button>
          ) : undefined
        }
      />
      <MobileCartWizardDrawer
        open={wizard.open}
        editId={wizard.editId}
        defaultWarehouseId={warehouses.defaultId}
        onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))}
        onSaved={() => g.refetch()}
      />
      <CartDetailDrawer
        id={detailId}
        onOpenChange={(o) => !o && setDetailId(null)}
        canEdit={perms.edit}
        onEdit={(id) => {
          setDetailId(null);
          setWizard({ open: true, editId: id });
        }}
      />
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/mobile-carts/${log.id}/change-log` : null}
        title={`Change log · ${log?.code ?? ''}`}
      />
      <DuplicateDialog row={dup} onOpenChange={(o) => !o && setDup(null)} onDone={() => g.refetch()} />
      <LabelScopeDialog
        rows={toLabel}
        onOpenChange={(o) => !o && setToLabel(null)}
        onPrint={(s) => void printLabels(s)}
        pending={action.pending}
      />
      <PrintOptionsModal
        open={labels !== null}
        onOpenChange={(o) => !o && setLabels(null)}
        typeKeys={['mobile-cart-label']}
        records={labels ?? []}
        title="Print mobile cart labels"
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `mobile cart ${toDelete[0]?.code}` : `${toDelete?.length ?? 0} mobile carts`}?`}
        description="The carts and their cells are removed. Occupied carts are skipped."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{
          columns: [
            { key: 'code', label: 'Cart' },
            { key: 'warehouse', label: 'Warehouse' },
            { key: 'status', label: 'Status' },
            { key: 'cells', label: 'Cells' },
          ],
          rows: (toDelete ?? []).map((r) => ({
            code: r.code,
            warehouse: r.warehouseCode,
            status: r.status,
            cells: r.cellCount,
          })),
        }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>('/api/mobile-carts/bulk-delete', 'POST', {
            ids: (toDelete ?? []).map((r) => r.id),
          });
          if (result) {
            toastBulk(result, 'mobile cart', 'deleted');
            g.clearSelection();
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
