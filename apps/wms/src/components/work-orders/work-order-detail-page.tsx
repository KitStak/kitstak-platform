'use client';

/**
 * Work order detail (`/work-orders/[id]`, beyond Logiwa): header with every action and a
 * build-progress strip, then tabs: Components (live availability), Job & tasks, Receipts,
 * Transactions, Exceptions, Documents, Activity. Tabs are URL state (`?tab=`).
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Ban,
  Boxes,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  FileStack,
  History,
  ListChecks,
  Lock,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Printer,
  Trash2,
  Undo2,
} from 'lucide-react';
import { LinkCell } from '@/components/grid/cells';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { HomeLink, StatusScreen } from '@/components/layout/status-screen';
import { ChangeLogDrawer, DocumentsViewer, KvList, PrintOptionsModal } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { UnderlineTabs } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import { apiFetch } from '@/lib/api-client';
import { DEFAULT_WAREHOUSE_ZONE, formatInZone } from '@/lib/grid-defs/work-orders/wo-time';
import { useCan } from '@/lib/permissions-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { pickProgress } from '@/lib/grid-defs/work-orders/kit-steps';
import {
  componentCoverage,
  coverageSummary,
  createKitStockReason,
  retryAllocationReason,
  sourceLabel,
  terminalBuildCopy,
} from '@/lib/grid-defs/work-orders/wo-coverage';
import {
  cancelPickingReason,
  cancelReason,
  createKitReason,
  deleteReason,
  disassembleReason,
  editReason,
  pickingReason,
  printReason,
  remainingQty,
} from '@/lib/grid-defs/work-orders/work-order-model';
import { CreateKitDialog } from './create-kit-dialog';
import { DisassembleDialog } from './disassemble-dialog';
import { PickingDialog } from './picking-dialog';
import {
  bulkToast,
  errorMessage,
  postBulk,
  useInvalidateWorkOrders,
  useWoPlanner,
  WO_ENTITY,
  WO_P,
  type WorkOrderDetail,
} from './wo-client';
import { WorkOrderWizard } from './wizard/work-order-wizard';
import { WoStatusPill } from './wo-status';
import { ProjectTasksCard } from '@/components/projects/project-tasks-card';

const TABS = [
  'components',
  'job',
  'receipts',
  'transactions',
  'exceptions',
  'documents',
  'activity',
] as const;
type Tab = (typeof TABS)[number];

export function WorkOrderDetailPage({ id }: { readonly id: string }) {
  const detail = useApiQuery<WorkOrderDetail>(
    ['work-order', id],
    `/api/work-orders/${encodeURIComponent(id)}`,
    { retry: 1, timeoutMs: 30_000 },
  );
  // Never spin silently: after 10 s of loading, say so and offer Retry.
  const [stalled, setStalled] = React.useState(false);
  const pending = detail.isPending;
  React.useEffect(() => {
    if (!pending) {
      setStalled(false);
      return;
    }
    const t = window.setTimeout(() => setStalled(true), 10_000);
    return () => window.clearTimeout(t);
  }, [pending]);
  if (detail.isPending) {
    return (
      <div
        className="flex flex-col gap-4 px-6 pt-5"
        role="status"
        aria-live="polite"
        aria-label="Loading work order"
      >
        {stalled ? (
          <Callout
            variant="attention"
            title="Still loading this work order"
            action={
              <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
                Retry
              </Button>
            }
          >
            The server is taking longer than usual. Retry, or go{' '}
            <Link href="/work-orders" className="font-semibold text-primary hover:underline">
              back to work orders
            </Link>
            .
          </Callout>
        ) : null}
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (detail.error) {
    if (detail.error.code === 'NOT_FOUND') {
      return (
        <StatusScreen
          code="404"
          icon={FileSearch}
          title="Work order not found"
          description={
            <>
              No work order <strong>{id}</strong> exists in the warehouses and clients you can access.
            </>
          }
          actions={
            <>
              <Link href="/work-orders" className="font-semibold text-primary hover:underline">
                Back to work orders
              </Link>
              <HomeLink />
            </>
          }
        />
      );
    }
    if (detail.error.code === 'FORBIDDEN') {
      return (
        <StatusScreen
          code="403"
          tone="danger"
          icon={Lock}
          title="You can't view work orders"
          description="Ask an administrator for the Work Orders permission."
          actions={<HomeLink />}
        />
      );
    }
    return (
      <div className="p-6">
        <Callout
          variant="error"
          title="The work order could not be loaded"
          action={
            <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
              Retry
            </Button>
          }
        >
          {detail.error.message}
        </Callout>
      </div>
    );
  }
  return <Loaded data={detail.data.data} />;
}

type Confirm = 'delete' | 'cancel' | 'cancelPicking' | null;

function Loaded({ data }: { readonly data: WorkOrderDetail }) {
  const { workOrder: wo, kit, components, job, tasks, receipts, transactions, exceptions } = data;
  const router = useRouter();
  const search = useSearchParams();
  const invalidate = useInvalidateWorkOrders();
  const tabParam = search.get('tab');
  const urlTab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'components';
  // Switch the panel at once (local state); the URL catches up in the background.
  const [localTab, setLocalTab] = React.useState<Tab | null>(null);
  const [pointerTabs, setPointerTabs] = React.useState(false);
  const tab: Tab = localTab ?? urlTab;
  React.useEffect(() => {
    if (localTab === urlTab) setLocalTab(null);
  }, [localTab, urlTab]);
  const setTab = (t: string) => {
    if (!(TABS as readonly string[]).includes(t)) return;
    setLocalTab(t as Tab);
    const params = new URLSearchParams(search.toString());
    if (t === 'components') params.delete('tab');
    else params.set('tab', t);
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', qs ? `?${qs}` : window.location.pathname);
  };
  const planner = useWoPlanner();
  const can = {
    edit: useCan(WO_P.edit).allowed && planner,
    del: useCan(WO_P.del).allowed && planner,
    createKit: useCan(WO_P.createKit).allowed,
    disassemble: useCan(WO_P.disassemble).allowed,
    picking: useCan(WO_P.picking).allowed,
    cancelPicking: useCan(WO_P.cancelPicking).allowed,
  };
  const [edit, setEdit] = React.useState(false);
  const [kitOpen, setKitOpen] = React.useState(false);
  const [disOpen, setDisOpen] = React.useState(false);
  const [pickOpen, setPickOpen] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [print, setPrint] = React.useState<{ records: readonly unknown[]; consolidated: boolean } | null>(
    null,
  );

  const picks = pickProgress(data.tasks);
  const picksPending = wo.type === 'Work Order with Picking' && picks.total > 0 && picks.done < picks.total;
  const rKit =
    createKitReason(
      {
        ...wo,
        pickTaskCount: picks.total,
        pickDoneCount: picks.done,
        inKittingAreaQty: components.reduce((s, c) => s + (c.inKittingAreaQty ?? 0), 0),
      },
      { canForcePicks: can.picking && planner },
    ) ?? createKitStockReason(wo, components);
  const rDis =
    disassembleReason(wo) ??
    (wo.processedQty - data.disassembledQty <= 0
      ? 'Every kit built by this work order was already disassembled'
      : null);
  const rPick = pickingReason(wo);
  const rCancelPick =
    cancelPickingReason(wo) ??
    (wo.status === 'In Process' && !data.canReopenInProcess
      ? 'Reopening In Process work orders is waiting on a status-flow update (REQ-1)'
      : null);
  const remaining = remainingQty(wo);
  const pct = wo.requestedQty > 0 ? Math.round((wo.processedQty / wo.requestedQty) * 100) : 0;
  const coverage = coverageSummary(components, wo.type === 'Work Order with Picking');
  const { short, buildable } = coverage;
  const rRetry = retryAllocationReason(coverage);
  const terminal = wo.status === 'Completed' || wo.status === 'Cancelled';
  const terminalAt = wo.status === 'Cancelled' ? wo.cancelledAt : wo.actualFinishAt;
  const terminalCopy = terminalBuildCopy(
    wo,
    terminalAt ? formatInZone(terminalAt, data.warehouseTimeZone) : null,
  );

  const runConfirm = async () => {
    try {
      if (confirm === 'delete') {
        await apiFetch(`/api/work-orders/${encodeURIComponent(wo.id)}`, { method: 'DELETE' });
        toast.success('Success', `Work order ${wo.code} deleted.`);
        await invalidate();
        router.push('/work-orders');
        return;
      }
      const path = confirm === 'cancel' ? '/api/work-orders/cancel' : '/api/work-orders/cancel-picking';
      const res = await postBulk(path, [wo.id]);
      bulkToast(res, () => wo.code, {
        done: confirm === 'cancel' ? 'cancelled' : 'reset to Open; picking cancelled',
      });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      await invalidate();
    }
  };

  const printList = async (consolidated: boolean) => {
    try {
      const records = await apiFetch<readonly unknown[]>('/api/work-orders/pick-list', {
        method: 'POST',
        body: { ids: [wo.id], consolidated },
      });
      if (records.length === 0) {
        toast.info('Nothing to print', `${wo.code} has nothing left to pick.`);
        return;
      }
      setPrint({ records, consolidated });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    }
  };

  const meta = (
    <>
      <span>
        <span className="text-faint">Kit</span>{' '}
        <Link
          href={`/products/${kit.id}`}
          className="font-semibold text-foreground hover:text-primary hover:underline"
        >
          {kit.sku}
        </Link>{' '}
        · {kit.name}
      </span>
      <span>
        <span className="text-faint">Warehouse</span>{' '}
        <strong className="text-foreground">{wo.warehouseCode}</strong>
      </span>
      <span>
        <span className="text-faint">Client</span>{' '}
        <strong className="text-foreground">{wo.clientName}</strong>
      </span>
      <span>{wo.type}</span>
      {wo.shipmentOrderId ? (
        <span>
          <span className="text-faint">Build for</span>{' '}
          <Link href={`/orders/${wo.shipmentOrderId}`} className="font-semibold text-primary hover:underline">
            {wo.shipmentOrderCode}
          </Link>
        </span>
      ) : (
        <span>
          <span className="text-faint">Build for</span> Stock
        </span>
      )}
    </>
  );

  const actions = (
    <>
      {/* Picks still open (supervisor): Create kit opens, but reads as secondary and says why the drawer will ask to complete them. */}
      {can.createKit ? (
        !rKit && picksPending ? (
          <Tooltip
            content={`Components not yet picked to the kitting area (${picks.done}/${picks.total} picked). The drawer asks you to confirm completing the pending picks before it builds.`}
          >
            <Button variant="secondary" onClick={() => setKitOpen(true)}>
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              Create kit
              <span className="ml-1 rounded-full bg-warning-soft px-1.5 text-2xs font-semibold tabular-nums text-warning">
                {picks.done}/{picks.total} picked
              </span>
            </Button>
          </Tooltip>
        ) : (
          <DisabledReason reason={rKit}>
            <Button
              variant={rKit ? 'secondary' : 'primary'}
              disabled={Boolean(rKit)}
              aria-disabled={Boolean(rKit)}
              onClick={() => setKitOpen(true)}
            >
              <Boxes className="h-3.5 w-3.5" aria-hidden />
              Create kit
            </Button>
          </DisabledReason>
        )
      ) : null}
      {can.picking && wo.type === 'Work Order with Picking' ? (
        <DisabledReason reason={rPick}>
          <Button variant="secondary" disabled={Boolean(rPick)} onClick={() => setPickOpen(true)}>
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            Picking/job operations
          </Button>
        </DisabledReason>
      ) : null}
      {can.edit ? (
        <DisabledReason reason={editReason(wo)}>
          <Button
            variant="secondary"
            disabled={Boolean(editReason(wo))}
            onClick={() => setEdit(true)}
            title={
              wo.status === 'Completed' || wo.status === 'In Process'
                ? 'Only notes, instructions, dates and custom fields can change once a work order is past Open'
                : undefined
            }
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {wo.status === 'Completed' || wo.status === 'In Process' ? 'Edit notes' : 'Edit'}
          </Button>
        </DisabledReason>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label="More actions">
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
            More
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuItem
            icon={PackageOpen}
            disabledReason={can.disassemble ? rDis : "You don't have permission to disassemble kits"}
            onSelect={() => setDisOpen(true)}
          >
            Disassemble kit
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Printer}
            disabledReason={printReason(wo)}
            onSelect={() => void printList(false)}
          >
            Print picking list
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={FileStack}
            disabledReason={printReason(wo)}
            onSelect={() => void printList(true)}
          >
            Batch picking list
          </DropdownMenuItem>
          <DropdownMenuItem icon={History} onSelect={() => setLog(true)}>
            Change log
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Undo2}
            destructive
            disabledReason={can.cancelPicking ? rCancelPick : "You don't have permission to cancel picking"}
            onSelect={() => setConfirm('cancelPicking')}
          >
            Cancel picking
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Ban}
            destructive={can.edit && !cancelReason(wo)}
            description={can.edit ? (cancelReason(wo) ?? undefined) : undefined}
            disabledReason={can.edit ? cancelReason(wo) : "You don't have permission to edit work orders"}
            onSelect={() => setConfirm('cancel')}
          >
            Cancel work order
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Trash2}
            destructive
            disabledReason={can.del ? deleteReason(wo) : "You don't have permission to delete work orders"}
            onSelect={() => setConfirm('delete')}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const tabs = [
    { key: 'components', label: 'Components', count: components.length },
    { key: 'job', label: 'Job & tasks', count: tasks.length },
    { key: 'receipts', label: 'Receipts', count: receipts.length },
    { key: 'transactions', label: 'Transactions', count: transactions.length },
    { key: 'exceptions', label: 'Exceptions', count: exceptions.length },
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="flex flex-col pb-8">
      <Breadcrumbs
        className="px-6 pt-4"
        items={[{ label: 'Inventory' }, { label: 'Work Orders', href: '/work-orders' }, { label: wo.code }]}
      />
      {/* Stable header: actions always top-right; a long meta line wraps under the title, never pushes them down. */}
      <header className="flex items-start gap-3 px-6 pt-2 pb-4 lg:pr-10">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{wo.code}</h1>
            <WoStatusPill status={wo.status} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
            {meta}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      </header>

      <div className="grid grid-cols-1 gap-3 px-6 md:grid-cols-2 lg:pr-10 xl:grid-cols-4">
        <div className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold text-secondary">Kits built</span>
            <span className="text-xs tabular-nums text-secondary">{pct}%</span>
          </div>
          <p className="text-xl font-semibold tabular-nums text-foreground">
            {wo.processedQty}
            <span className="text-base font-normal text-secondary"> / {wo.requestedQty}</span>
          </p>
          <ProgressBar
            value={wo.processedQty}
            max={Math.max(1, wo.requestedQty)}
            tone={pct >= 100 ? 'success' : 'primary'}
            label="Kits built"
          />
          {data.disassembledQty > 0 ? (
            <p className="text-2xs text-secondary">{data.disassembledQty} disassembled since</p>
          ) : null}
        </div>
        <StatTile
          label={wo.status === 'Cancelled' ? 'Not built' : 'Left to build'}
          value={(wo.status === 'Cancelled'
            ? Math.max(0, wo.requestedQty - wo.processedQty)
            : terminal
              ? 0
              : remaining
          ).toLocaleString()}
          sublabel={
            terminalCopy ??
            (coverage.locked.length && buildable < remaining
              ? `Usable stock covers ${buildable.toLocaleString()} kit${buildable === 1 ? '' : 's'} · rest locked by ${coverage.plans.join(', ')}`
              : `Usable stock covers ${Math.min(buildable, remaining).toLocaleString()} of ${remaining.toLocaleString()} kit${remaining === 1 ? '' : 's'}`)
          }
          tone={terminal ? 'default' : remaining > 0 && buildable < remaining ? 'warning' : 'default'}
        />
        <StatTile
          label="Components"
          value={components.length.toLocaleString()}
          sublabel={
            terminal
              ? wo.status === 'Cancelled'
                ? 'Work order cancelled; nothing is reserved'
                : 'All components consumed'
              : coverage.locked.length
                ? `${coverage.locked.length} locked by ${coverage.plans.join(', ')}${short.length > coverage.locked.length ? ` · ${short.length - coverage.locked.length} short` : ''}`
                : short.length
                  ? `${short.length} short: ${short
                      .slice(0, 2)
                      .map((c) => c.sku)
                      .join(', ')}${short.length > 2 ? '…' : ''}`
                  : 'Usable stock covers every component'
          }
          tone={terminal ? 'default' : short.length ? 'danger' : 'success'}
        />
        <StatTile
          label="Job"
          value={
            job ? (
              <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">
                {job.code}
              </Link>
            ) : (
              '—'
            )
          }
          sublabel={
            job
              ? `${job.completedTaskCount} of ${job.taskCount} tasks done · ${job.assigneeName ?? 'Unassigned'}`
              : terminal
                ? 'No picking job'
                : wo.type === 'Work Order with Picking'
                  ? 'Run Picking/job operations to create one'
                  : 'Built without picking'
          }
        />
      </div>

      {wo.status === 'Shortage' ? (
        <div className="px-6 pt-3 lg:pr-10">
          {short.length === 0 ? (
            <Callout
              variant="info"
              title="Usable stock now covers every component"
              action={
                can.picking ? (
                  <Button size="sm" variant="primary" onClick={() => setPickOpen(true)}>
                    Retry allocation
                  </Button>
                ) : undefined
              }
            >
              The last allocation could not reserve every component
              {exceptions.length ? ' (see the Exceptions tab)' : ''}. Unlocked stock now covers all{' '}
              {components.length} components; run Picking/job operations again to reserve them.
            </Callout>
          ) : coverage.locked.length ? (
            <Callout
              variant="attention"
              title={`Stock is locked by count plan ${coverage.plans.join(', ')}`}
              action={
                can.picking ? (
                  <DisabledReason reason={rRetry}>
                    <Button size="sm" variant="secondary" disabled aria-disabled>
                      Retry allocation
                    </Button>
                  </DisabledReason>
                ) : undefined
              }
            >
              {coverage.locked
                .map((c) => c.sku)
                .slice(0, 3)
                .join(', ')}
              {coverage.locked.length > 3 ? '…' : ''} only {coverage.locked.length === 1 ? 'has' : 'have'}{' '}
              free stock in locations the count locks. Finish, update or cancel{' '}
              <Link href="/counts" className="font-semibold text-primary hover:underline">
                the count
              </Link>
              , then retry allocation.
            </Callout>
          ) : (
            <Callout
              variant="attention"
              title={`${short.length} component${short.length === 1 ? ' is' : 's are'} short`}
              action={
                can.picking ? (
                  <DisabledReason reason={rRetry}>
                    <Button size="sm" variant="secondary" disabled aria-disabled>
                      Retry allocation
                    </Button>
                  </DisabledReason>
                ) : undefined
              }
            >
              Allocation could not reserve{' '}
              {short
                .map((c) => c.sku)
                .slice(0, 3)
                .join(', ')}
              {short.length > 3 ? '…' : ''}. Receive or move stock, then run Picking/job operations again. See
              the Exceptions tab for details.
            </Callout>
          )}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 px-6 lg:pr-10 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 rounded-lg border border-border bg-surface shadow-xs">
          {/* Focus ring for keyboard only: Radix focuses the trigger on mouse down, which Chrome can
              treat as focus-visible. Pointer use hides the ring until the next key press. */}
          <div
            data-pointer={pointerTabs ? 'true' : undefined}
            onPointerDown={() => setPointerTabs(true)}
            onKeyDown={() => setPointerTabs(false)}
            className="[&[data-pointer=true]_[role=tab]]:ring-0! [&[data-pointer=true]_[role=tab]]:shadow-none! [&[data-pointer=true]_[role=tab]]:outline-none!"
          >
            <UnderlineTabs
              tabs={tabs}
              active={tab}
              onChange={setTab}
              className="px-4"
              ariaLabel="Work order sections"
            />
          </div>
          <div className="p-4">
            {tab === 'components' ? <ComponentsTab data={data} /> : null}
            {tab === 'job' ? <JobTab data={data} /> : null}
            {tab === 'receipts' ? (
              <SimpleTable
                empty="No receipts yet. Create kit and Disassemble kit post Kitting and DisassembleKit receipts here."
                head={['Receipt', 'Type', 'SKU', 'Qty', 'Location', 'Lot', 'Received', 'By']}
                rows={receipts.map((r) => [
                  <span key="m" className="font-semibold text-foreground">
                    #{r.masterId}
                  </span>,
                  <StatusPill key="t" status={r.type} size="sm" />,
                  r.sku,
                  <span key="q" className="tabular-nums">
                    {r.quantity}
                  </span>,
                  r.locationCode,
                  r.lotNumber ?? '–',
                  <span key="d" className="tabular-nums">
                    {formatInZone(r.receivedAt, data.warehouseTimeZone)}
                  </span>,
                  r.receivedBy,
                ])}
              />
            ) : null}
            {tab === 'transactions' ? (
              <SimpleTable
                empty="No inventory transactions yet."
                head={['#', 'Type', 'SKU', 'Qty', 'From', 'To', 'At', 'Source']}
                rows={transactions.map((t) => [
                  t.seq,
                  t.type,
                  t.sku,
                  <span
                    key="q"
                    className={cn(
                      'font-semibold tabular-nums',
                      t.direction === 'out'
                        ? 'text-danger'
                        : t.direction === 'in'
                          ? 'text-success'
                          : 'text-foreground',
                    )}
                  >
                    {t.direction === 'in'
                      ? `+${t.qty}`
                      : t.direction === 'out'
                        ? `−${Math.abs(t.qty)}`
                        : t.qty}
                  </span>,
                  t.fromLocationCode ?? '–',
                  t.toLocationCode ?? '–',
                  <span key="d" className="tabular-nums">
                    {formatInZone(t.createdAt, data.warehouseTimeZone)}
                  </span>,
                  t.source,
                ])}
              />
            ) : null}
            {tab === 'exceptions' ? (
              <SimpleTable
                empty={
                  wo.status === 'Shortage' && short.length === 0
                    ? 'No exception rows are recorded for this shortage, and free stock now covers every component. Retry allocation to reserve them.'
                    : 'No allocation exceptions. Shortages found by Picking/job operations are listed here.'
                }
                head={['SKU', 'Explanation', 'Free stock', 'Required', 'Run at', 'Run by']}
                rows={exceptions.map((e) => [
                  <span key="s" className="font-semibold text-foreground">
                    {e.sku ?? '–'}
                  </span>,
                  <span key="x" className="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {e.explanation}
                  </span>,
                  e.inventoryQty ?? '–',
                  e.requiredQty ?? '–',
                  <span key="d" className="tabular-nums">
                    {formatInZone(e.runAt, data.warehouseTimeZone)}
                  </span>,
                  e.runBy,
                ])}
              />
            ) : null}
            {tab === 'documents' ? (
              <DocumentsViewer entityType={WO_ENTITY} entityId={wo.id} canEdit={can.edit} />
            ) : null}
            {tab === 'activity' ? <WoActivity data={data} onOpenLog={() => setLog(true)} /> : null}
          </div>
        </div>
        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-surface py-4 pl-4 pr-5 shadow-xs">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Details</h2>
            <KvList
              columns={1}
              layout="inline"
              items={[
                { key: 'op', label: 'Operation', value: wo.operationType },
                { key: 'out', label: 'Output location', value: data.outputLocationCode ?? 'Kitting area' },
                { key: 'lot', label: 'Output lot', value: wo.outputLot ?? '–' },
                {
                  key: 'created',
                  label: 'Created',
                  value: formatInZone(wo.createdAt, data.warehouseTimeZone),
                },
                {
                  key: 'ps',
                  label: 'Planned start',
                  value: wo.plannedStartAt ? formatInZone(wo.plannedStartAt, data.warehouseTimeZone) : '–',
                },
                {
                  key: 'pf',
                  label: 'Planned finish',
                  value: wo.plannedFinishAt ? formatInZone(wo.plannedFinishAt, data.warehouseTimeZone) : '–',
                },
                {
                  key: 'as',
                  label: 'Actual start',
                  value: wo.actualStartAt ? formatInZone(wo.actualStartAt, data.warehouseTimeZone) : '–',
                },
                {
                  key: 'af',
                  label: 'Actual finish',
                  value: wo.actualFinishAt ? formatInZone(wo.actualFinishAt, data.warehouseTimeZone) : '–',
                },
                ...(wo.cancelledAt
                  ? [
                      {
                        key: 'c',
                        label: 'Cancelled',
                        value: formatInZone(wo.cancelledAt, data.warehouseTimeZone),
                      },
                    ]
                  : []),
                {
                  key: 'tags',
                  label: 'Tags',
                  value: wo.tags.length ? wo.tags.map((t) => t.name).join(', ') : '–',
                },
              ]}
            />
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Notes</h2>
            <p className="whitespace-pre-wrap text-xs text-secondary">{wo.extraNote || 'No extra note.'}</p>
            <h2 className="mb-2 mt-4 text-sm font-semibold text-foreground">Kitting instructions</h2>
            <p className="whitespace-pre-wrap text-xs text-secondary">
              {wo.kittingInstructions || 'No kitting instructions.'}
            </p>
          </section>
          <ProjectTasksCard kind="work-order" variant="aside" recordId={wo.id} recordLabel={wo.code} />
        </aside>
      </div>

      <WorkOrderWizard open={edit} onOpenChange={setEdit} mode="edit" workOrderId={wo.id} />
      <CreateKitDialog open={kitOpen} onOpenChange={setKitOpen} workOrderId={kitOpen ? wo.id : null} />
      <DisassembleDialog open={disOpen} onOpenChange={setDisOpen} workOrderId={disOpen ? wo.id : null} />
      <PickingDialog open={pickOpen} onOpenChange={setPickOpen} ids={[wo.id]} />
      <PrintOptionsModal
        open={print !== null}
        onOpenChange={(o) => {
          if (!o) setPrint(null);
        }}
        typeKeys={[print?.consolidated ? 'work-order-consolidated-picking-list' : 'work-order-picking-list']}
        records={print?.records ?? []}
        clientId={wo.clientId}
        title="Print picking list"
      />
      {log ? (
        <ChangeLogDrawer
          open
          onOpenChange={setLog}
          entityType={WO_ENTITY}
          entityId={wo.id}
          entityCode={wo.code}
          timeZone={data.warehouseTimeZone ?? DEFAULT_WAREHOUSE_ZONE}
        />
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        variant="danger"
        icon={confirm === 'delete' ? Trash2 : confirm === 'cancel' ? Ban : Undo2}
        title={
          confirm === 'delete'
            ? `Delete ${wo.code}?`
            : confirm === 'cancel'
              ? `Cancel ${wo.code}?`
              : `Cancel picking for ${wo.code}?`
        }
        description={
          confirm === 'delete'
            ? 'This action cannot be undone.'
            : confirm === 'cancel'
              ? "Allocated components go back to free stock, and open picking tasks and the job are cancelled. Cancelled work orders can't be reopened."
              : 'Component allocations are released, pending picking tasks and the job are cancelled, and the work order returns to Open.'
        }
        records={{
          columns: [
            { key: 'code', label: 'Work order' },
            { key: 'status', label: 'Status' },
            { key: 'kit', label: 'Kit SKU' },
            { key: 'qty', label: 'Built / requested' },
          ],
          rows: [
            {
              code: wo.code,
              status: <WoStatusPill status={wo.status} size="sm" />,
              kit: kit.sku,
              qty: `${wo.processedQty} / ${wo.requestedQty}`,
            },
          ],
        }}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={runConfirm}
      />
    </div>
  );
}

function SimpleTable({
  head,
  rows,
  empty,
}: {
  readonly head: readonly string[];
  readonly rows: readonly (readonly React.ReactNode[])[];
  readonly empty: string;
}) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-secondary">{empty}</p>;
  return (
    <div className="ks-scroll overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className="whitespace-nowrap px-3 py-1.5 text-body">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComponentsTab({ data }: { readonly data: WorkOrderDetail }) {
  const { workOrder: wo, components } = data;
  const withPicking = wo.type === 'Work Order with Picking';
  const terminal = wo.status === 'Completed' || wo.status === 'Cancelled';
  if (components.length === 0)
    return <p className="py-10 text-center text-sm text-secondary">This work order has no components.</p>;
  return (
    <div className="ks-scroll overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">Component availability</caption>
        <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
          <tr>
            {[
              'Component',
              'Pack type',
              'Per kit',
              'Total',
              'Allocated',
              'Picked',
              'Consumed',
              'Usable now',
              'Status',
              'Source',
            ].map((h) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-3 py-2',
                  !['Component', 'Pack type', 'Status', 'Source'].includes(h) && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {components.map((c) => {
            const cov = componentCoverage(c);
            const ok = cov.state === 'covered' || cov.state === 'consumed';
            const lockedQty = c.lockedQty ?? 0;
            return (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <LinkCell href={`/products/${c.componentProductId}`}>{c.sku}</LinkCell>
                  <span className="block text-2xs text-secondary">{c.name}</span>
                </td>
                <td className="px-3 py-2 text-secondary">{c.packType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.componentQty}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">
                  {c.totalQty}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{withPicking ? c.allocatedQty : '–'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{withPicking ? c.pickedQty : '–'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.consumedQty}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums',
                    terminal
                      ? 'text-secondary'
                      : ok
                        ? 'font-semibold text-foreground'
                        : 'font-semibold text-danger',
                  )}
                >
                  {terminal ? (
                    '–'
                  ) : (
                    <>
                      {c.availableQty ?? c.freeQty}
                      {lockedQty > 0 ? (
                        <span
                          className="block text-2xs font-normal text-warning"
                          title={`Free stock in locations locked by ${(c.lockedBy ?? []).join(', ')}`}
                        >
                          +{lockedQty} locked
                        </span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  {wo.status === 'Cancelled' ? (
                    <span className="text-secondary">Cancelled</span>
                  ) : cov.state === 'consumed' ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Consumed
                    </span>
                  ) : wo.status === 'Completed' ? (
                    <span className="text-secondary">Completed</span>
                  ) : cov.state === 'covered' ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Covered
                    </span>
                  ) : cov.state === 'locked' ? (
                    <span
                      className="inline-flex items-center gap-1 font-semibold text-warning"
                      title="Stock can't leave count-locked locations until the count is finished or cancelled"
                    >
                      <Lock className="h-3.5 w-3.5" aria-hidden />
                      Locked by {cov.lockedBy.join(', ')} · short {cov.shortQty}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-danger">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      Short {cov.shortQty}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-secondary">
                  {sourceLabel(c, withPicking)}
                  {c.sourceLockedBy ? (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-2xs font-semibold text-warning">
                      <Lock className="h-3 w-3" aria-hidden />
                      {c.sourceLockedBy}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Activity feed for the work order (change log of the WO and its children, newest first), with
 * every time in the warehouse zone and a zone suffix: the same policy as the Details card, grids,
 * Create Kit summary and exports, so one event never reads two different hours on one screen.
 */
function WoActivity({ data, onOpenLog }: { readonly data: WorkOrderDetail; readonly onOpenLog: () => void }) {
  const PAGE = 30;
  const [shown, setShown] = React.useState(PAGE);
  const items = data.timeline;
  if (items.length === 0)
    return (
      <p className="py-10 text-center text-sm text-secondary">
        No activity recorded for this work order yet.
      </p>
    );
  const tone = (type: string) =>
    /delet|cancel/i.test(type)
      ? 'bg-danger text-white'
      : /creat/i.test(type)
        ? 'bg-success text-white'
        : /kit|disassembl|pick|alloc/i.test(type)
          ? 'bg-primary text-white'
          : 'bg-neutral-soft text-secondary';
  return (
    <div className="flex flex-col gap-2">
      <ol className="relative flex flex-col gap-4 pl-1" aria-label="Activity">
        <span className="absolute bottom-2 left-[13px] top-2 w-px bg-border" aria-hidden />
        {items.slice(0, shown).map((item) => (
          <li key={item.id} className="relative flex gap-3">
            <span
              className={cn(
                'z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface',
                tone(item.type),
              )}
            >
              <History className="h-3 w-3" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="break-words text-sm text-body">
                <span className="font-semibold text-foreground">{item.type}</span>
                {item.message ? ` · ${item.message}` : ''}
              </p>
              <p className="text-2xs tabular-nums text-faint">
                {formatInZone(item.at, data.warehouseTimeZone)} · {item.source}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3">
        {items.length > shown ? (
          <Button variant="ghost" size="sm" onClick={() => setShown(shown + PAGE)}>
            Show more ({items.length - shown})
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onOpenLog}>
          <History className="h-3.5 w-3.5" aria-hidden />
          Field-level change log
        </Button>
      </div>
    </div>
  );
}

function JobTab({ data }: { readonly data: WorkOrderDetail }) {
  const { job, tasks, workOrder: wo } = data;
  if (!job && tasks.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-secondary">
        {wo.type === 'Work Order with Picking'
          ? 'No picking job yet. Run Picking/job operations to allocate the components and create one.'
          : 'Work orders without picking build kits directly from the chosen sources, so they have no job.'}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {job ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-sunken/50 px-3 py-2 text-xs">
          <Link href={`/jobs/${job.id}`} className="font-semibold text-primary hover:underline">
            {job.code}
          </Link>
          <StatusPill status={job.status} domain="job" size="sm" />
          <span className="text-secondary">{job.jobType}</span>
          <span className="text-secondary">{job.assigneeName ?? 'Unassigned'}</span>
          <span className="ml-auto w-40">
            <ProgressBar
              value={job.completedTaskCount}
              max={Math.max(1, job.taskCount)}
              size="sm"
              label="Tasks done"
              showValue={`${job.completedTaskCount}/${job.taskCount}`}
            />
          </span>
        </div>
      ) : null}
      <SimpleTable
        empty="No tasks."
        head={['Task', 'Type', 'Status', 'SKU', 'Planned', 'Done', 'From', 'To']}
        rows={tasks.map((t) => [
          t.taskNo,
          t.taskType,
          <StatusPill key="s" status={t.status} domain="job" size="sm" />,
          t.sku ?? '–',
          t.plannedQty,
          t.actualQty,
          t.sourceLocationCode ?? '–',
          t.targetLocationCode ?? '–',
        ])}
      />
    </div>
  );
}
