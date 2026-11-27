'use client';

/**
 * `/receiving/[id]` — purchase order detail. Drilling in opens a read-only VIEW of the
 * order (the wizard's Confirm summary); the prominent "Edit purchase order" button (or a
 * `?step=` / `?edit` link) opens the wizard in free mode on Confirm
 * (steps clickable, client locked). Right rail: Save, Other actions ▾ (Receive items,
 * Receive PO, Delete order, Cancel order — gated by status and permission), Summary with the
 * status pencil and change log, Billing charges download and Printouts. Receipts are listed
 * under the wizard with Cancel.
 */
import * as React from 'react';
import { Pill } from '@kitstak/ui/dashboard';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  ChevronDown,
  Download,
  Eye,
  FileQuestion,
  FileText,
  PackageCheck,
  PackageOpen,
  Pencil,
  Plus,
  Printer,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { HomeLink, StatusScreen } from '@/components/layout/status-screen';
import { PageHeader } from '@/components/layout/page-header';
import { RecordDetailSkeleton } from '@/components/layout/shell-skeleton';
import { ChangeLogDrawer, DocumentsViewer, DocumentUploadModal } from '@/components/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useFormat } from '@/lib/format';
import { calendarDay } from '@/lib/grid-defs/receiving/po-schemas';
import { receivingLedgerHref } from '@/lib/grid-defs/receiving/receiving-ledger';
import { useApiQuery } from '@/lib/query-client';
import { cancelCopy, cancelReason, deleteReason, receiveAllReason, receiveReason } from './po-action-rules';
import { PoStatusModal } from './po-status-modal';
import type { ReceiptRow } from './receipt-columns';
import { ReceiptDrawer } from './receipt-drawer';
import { ReceiveItemsDrawer } from './receive-items-drawer';
import {
  errorMessage,
  Nowrap,
  openFile,
  PO_KEYS,
  useInvalidateReceiving,
  ZonedTime,
  type PoDetail,
  useCan,
} from './receiving-shared';
import { useCancelReceipt } from './receipt-cancel';
import { DiffPill } from './wizard/step-confirm';
import { ProjectTasksCard } from '@/components/projects/project-tasks-card';
import { COMPACT_STEPPER, PoWizard } from './wizard/po-wizard';

const P = 'inventory.purchase_orders.';

function RailCard({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-2xs font-semibold text-faint">{title}</p>
      {children}
    </div>
  );
}

function ReceiptsPanel({
  po,
  canCancel,
  onOpen,
  onCancel,
}: {
  readonly po: PoDetail;
  readonly canCancel: boolean;
  readonly onOpen: (id: string) => void;
  readonly onCancel: (r: ReceiptRow) => void;
}) {
  const fmt = useFormat();
  const q = useApiQuery<ReceiptRow[]>(PO_KEYS.receipts(po.id), `/api/purchase-orders/${po.id}/receipts`);
  const rows = q.data?.data ?? [];
  if (q.isPending) {
    return (
      <section
        className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-xs"
        aria-busy="true"
        aria-label="Receipts"
      >
        <h2 className="mb-3 text-base font-semibold text-foreground">Receipts</h2>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </section>
    );
  }
  if (q.isError) {
    return (
      <section
        className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-xs"
        aria-label="Receipts"
      >
        <h2 className="mb-2 text-base font-semibold text-foreground">Receipts</h2>
        <p role="alert" className="mb-2 text-sm text-secondary">
          {"Couldn't load receipts for this purchase order."}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
          Retry
        </Button>
      </section>
    );
  }
  return (
    <section
      className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-xs"
      aria-labelledby="po-receipts"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="po-receipts" className="text-base font-semibold text-foreground">
          Receipts <span className="text-xs font-normal text-faint">({rows.length})</span>
        </h2>
        <span className="flex flex-wrap items-center gap-3">
          <Link
            href={`/reports/po-receiving?q=${encodeURIComponent(po.code)}&qm=eq`}
            className="text-xs font-medium text-primary hover:underline"
          >
            PO receiving report
          </Link>
          <Link
            href={`/receiving/history?q=${encodeURIComponent(po.code)}&qm=eq`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Open in receiving history
          </Link>
          <Link
            href={receivingLedgerHref({ poCode: po.code })}
            className="text-xs font-medium text-primary hover:underline"
          >
            Ledger transactions
          </Link>
          <Link
            href={receivingLedgerHref({ poCode: po.code, types: ['Cancel Receiving'] })}
            className="text-xs font-medium text-primary hover:underline"
          >
            Cancelled receipts
          </Link>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-5 text-xs text-secondary">
          <PackageOpen className="h-4 w-4 text-faint" aria-hidden />
          Nothing received yet. Use Other actions › Receive items to receive part or all of this order.
        </p>
      ) : (
        <div className="relative max-w-full overflow-x-auto ks-scroll">
          <table className="w-full border-collapse whitespace-nowrap text-xs">
            <thead>
              <tr className="text-left text-2xs font-semibold text-faint">
                {[
                  'Master ID',
                  'SKU',
                  'Quantity',
                  'Location',
                  'LPN',
                  'Lot',
                  'Expiry',
                  'Damage',
                  'Received',
                  'By',
                  '',
                ].map((h) => (
                  <th key={h} className="border-b border-border px-2.5 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.cancelledAt ? 'text-faint line-through decoration-faint/60' : ''}>
                  <td className="border-b border-border px-2.5 py-2">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => onOpen(r.id)}
                    >
                      {r.masterId}
                    </button>
                  </td>
                  <td className="border-b border-border px-2.5 py-2 font-semibold">{r.sku}</td>
                  <td className="border-b border-border px-2.5 py-2 tabular-nums">
                    {r.quantity.toLocaleString()} {r.packType}
                  </td>
                  <td className="border-b border-border px-2.5 py-2">{r.locationCode}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.lpNumber ?? 'None'}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.lotNumber ?? 'None'}</td>
                  <td className="border-b border-border px-2.5 py-2">
                    {r.expiryDate ? fmt.date(calendarDay(r.expiryDate)) : 'None'}
                  </td>
                  <td className="border-b border-border px-2.5 py-2">{r.damageReason ?? 'None'}</td>
                  <td className="border-b border-border px-2.5 py-2">
                    <ZonedTime value={r.receivedAt} timeZone={r.timeZone ?? po.warehouseTimeZone} />
                  </td>
                  <td className="border-b border-border px-2.5 py-2">{r.receivedBy}</td>
                  <td className="border-b border-border px-2.5 py-2 text-right">
                    {canCancel ? (
                      <DisabledReason reason={r.cancelBlockedReason}>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={Boolean(r.cancelBlockedReason)}
                          onClick={() => onCancel(r)}
                        >
                          <Ban className="h-3.5 w-3.5" aria-hidden />
                          Cancel
                        </Button>
                      </DisabledReason>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Serial numbers pre-advised by Import PO Serial Numbers, per line, with their received state. */
function PreAdvicePanel({ po }: { readonly po: PoDetail }) {
  const lines = po.lines.filter((l) => (l.preAdvisedSerials?.length ?? 0) > 0);
  if (lines.length === 0) return null;
  const total = lines.reduce((n, l) => n + (l.preAdvisedSerials?.length ?? 0), 0);
  return (
    <section
      className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-xs"
      aria-labelledby="po-preadvice"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="po-preadvice" className="text-base font-semibold text-foreground">
          Serial pre-advice <span className="text-xs font-normal text-faint">({total.toLocaleString()})</span>
        </h2>
        <Link
          href="/receiving/import?type=po-serials"
          className="text-xs font-medium text-primary hover:underline"
        >
          Import serial numbers
        </Link>
      </div>
      <div className="flex flex-col gap-3">
        {lines.map((l) => {
          const list = l.preAdvisedSerials ?? [];
          const received = list.filter((x) => x.received).length;
          const shown = list.slice(0, 24);
          return (
            <div key={l.id} className="flex flex-col gap-1.5">
              <p className="text-xs text-secondary">
                <span className="font-semibold text-foreground">{l.sku}</span> ·{' '}
                {list.length.toLocaleString()} of {(l.orderedQuantity * l.uomQuantity).toLocaleString()}{' '}
                expected · {received.toLocaleString()} received
              </p>
              <div className="flex flex-wrap gap-1">
                {shown.map((x) => (
                  <span key={x.serial} className="contents">
                    <Pill
                      tone={x.received ? 'positive' : 'neutral'}
                      dot
                      title={x.received ? 'Received' : 'Expected'}
                    >
                      <span className="font-mono">{x.serial}</span>
                    </Pill>
                  </span>
                ))}
                {list.length > shown.length ? (
                  <span className="px-1 text-2xs text-faint">
                    +{(list.length - shown.length).toLocaleString()} more
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type Confirm = 'receiveAll' | 'cancel' | 'delete' | null;

/**
 * Received vs ordered. Neutral "open" text while receiving is pending or in progress; the
 * signed difference pill only once the order is closed (Completed / Cancelled), where a
 * shortage or over-receipt is a real variance.
 */
export function receivedSummaryTone(
  po: Pick<PoDetail, 'status' | 'receivedQuantity' | 'totalQuantity'>,
): 'open' | 'variance' | 'exact' | 'cancelled' {
  // A cancelled order's unreceived balance is intentional, not a shortage: no variance pill.
  if (po.status === 'Cancelled') return 'cancelled';
  if (po.status !== 'Completed') return 'open';
  return po.receivedQuantity === po.totalQuantity ? 'exact' : 'variance';
}

function ReceivedSummary({ po }: { readonly po: PoDetail }) {
  const tone = receivedSummaryTone(po);
  const open = Math.max(0, po.totalQuantity - po.receivedQuantity);
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-faint">Received</span>
      <span className="flex items-center gap-1.5 tabular-nums">
        {po.receivedQuantity.toLocaleString()} / {po.totalQuantity.toLocaleString()}
        {tone === 'open' ? (
          open > 0 ? (
            <span className="rounded-full bg-surface-sunken px-1.5 py-px text-2xs font-medium text-secondary">
              {open.toLocaleString()} open
            </span>
          ) : null
        ) : null}
        {tone === 'cancelled' ? (
          <span
            className="rounded-full bg-surface-sunken px-1.5 py-px text-2xs font-medium text-secondary"
            title="The order was cancelled; the remaining quantity won't be received."
          >
            cancelled
          </span>
        ) : null}
        {tone === 'variance' ? <DiffPill value={po.receivedQuantity - po.totalQuantity} /> : null}
      </span>
    </div>
  );
}

function DetailView({
  po,
  initialStep,
  initialEdit,
  refresh,
}: {
  readonly po: PoDetail;
  readonly initialStep: string;
  /** `?step=` / `?edit` deep links open the wizard directly; a plain drill-in opens the view. */
  readonly initialEdit: boolean;
  readonly refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const fmt = useFormat();
  const invalidate = useInvalidateReceiving();
  const can = {
    edit: useCan(`${P}edit`),
    receive: useCan(`${P}receive_po`).allowed,
    cancel: useCan(`${P}cancel_order`).allowed,
    del: useCan(`${P}delete`).allowed,
    status: useCan(`${P}change_status`).allowed,
    log: useCan(`${P}change_log`).allowed,
    billing: useCan(`${P}download_billing_charges`).allowed,
    upload: useCan(`${P}upload_documents`).allowed,
    poLabel: useCan(`${P}purchase_order_label`).allowed,
    cancelReceipt: useCan('inventory.receiving_history.cancel').allowed,
  };
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [docsOpen, setDocsOpen] = React.useState(false);
  const [receiptId, setReceiptId] = React.useState<string | null>(null);
  // The Receipts panel's cached rows seed the receipt drawer, so it opens instantly.
  const receiptRows =
    useApiQuery<ReceiptRow[]>(PO_KEYS.receipts(po.id), `/api/purchase-orders/${po.id}/receipts`).data?.data ??
    [];
  const cancelReceipt = useCancelReceipt(() => void refresh());

  const rReceive =
    receiveReason([po]) ?? (po.lines.length === 0 ? 'This purchase order has no lines.' : null);
  const rReceiveAll = rReceive ?? receiveAllReason([po]);
  const rDelete = deleteReason([po]);
  const remaining = po.lines.reduce((s, l) => s + Math.max(0, l.orderedQuantity - l.receivedQuantity), 0);
  // A Started PO with receipts short-closes (open balance cancelled, received stock kept).
  const rCancel =
    cancelReason([po]) ?? (po.activeReceipts > 0 && remaining === 0 ? 'Every line is fully received.' : null);
  const cancelText = cancelCopy([po]);
  // A closed PO has nothing to receive: menu descriptions say why instead of quoting open units.
  const closedNote =
    po.status === 'Cancelled' ? 'PO is cancelled' : po.status === 'Completed' ? 'PO is fully received' : null;
  // Cancelled POs are read-only (Logiwa parity); Completed POs keep header edits, lines are locked.
  const editable = (can.edit.allowed || can.edit.isLoading) && po.status !== 'Cancelled';
  // Drilling in lands on a read-only VIEW of the order; Edit (or a `?step=` link) opens the wizard.
  const [editMode, setEditMode] = React.useState(initialEdit);
  const editing = editable && editMode;

  // The confirm closes as soon as the mutation resolves; the page refetches in the background.
  const run = async (kind: Exclude<Confirm, null>) => {
    try {
      if (kind === 'receiveAll') {
        await apiRequest(`/api/purchase-orders/${po.id}/receive`, { method: 'POST', body: { all: true } });
        toast.success('Success', 'You have successfully received orders.');
      } else if (kind === 'cancel') {
        const { data } = await apiRequest<{ shortClosed?: boolean; cancelledUnits?: number }>(
          `/api/purchase-orders/${po.id}/cancel`,
          { method: 'POST', body: { version: po.version } },
        );
        if (data.shortClosed)
          toast.success(
            'Open balance cancelled',
            `${(data.cancelledUnits ?? 0).toLocaleString()} open unit${data.cancelledUnits === 1 ? '' : 's'} cancelled on ${po.code}. Received stock is kept; the order is Completed.`,
          );
        else toast.success('Success', 'You have successfully cancelled an order.');
      } else {
        await apiRequest(`/api/purchase-orders/${po.id}`, {
          method: 'DELETE',
          query: { version: po.version },
        });
        toast.success('Success', `Purchase order ${po.code} deleted.`);
        void invalidate();
        router.push('/receiving');
        return;
      }
    } catch (error) {
      toast.error('Error', errorMessage(error));
    }
    void refresh();
    void invalidate();
  };

  const otherActions = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="w-full justify-between">
          Other actions
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuItem
          icon={PackageCheck}
          description={closedNote ?? 'Partial receive with location, LP, lot and serials'}
          disabledReason={can.receive ? rReceive : "You don't have permission to receive purchase orders"}
          onSelect={() => setReceiveOpen(true)}
        >
          Receive items
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={PackageCheck}
          description={
            closedNote ??
            `All ${remaining.toLocaleString()} open units into ${po.defaultReceivingLocation?.code ?? 'the default receiving location'}`
          }
          disabledReason={
            can.receive
              ? (rReceiveAll ?? (remaining === 0 ? 'Every line is fully received.' : null))
              : "You don't have permission to receive purchase orders"
          }
          onSelect={() => setConfirm('receiveAll')}
        >
          Receive PO
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={Printer}
          disabledReason={can.poLabel ? null : "You don't have permission to print purchase orders"}
          onSelect={() => openFile(`/api/purchase-orders/documents?ids=${po.id}`)}
        >
          Print purchase order
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={Ban}
          description={
            can.cancel
              ? (rCancel ??
                (po.activeReceipts > 0
                  ? `Cancel the ${remaining.toLocaleString()} open units; received stock is kept`
                  : 'Stop expecting this order'))
              : "You don't have permission to cancel orders"
          }
          disabledReason={can.cancel ? rCancel : "You don't have permission to cancel orders"}
          onSelect={() => setConfirm('cancel')}
        >
          Cancel order
        </DropdownMenuItem>
        {/* Disabled destructive items drop the red tone and say why inline. */}
        <DropdownMenuItem
          icon={Trash2}
          destructive={Boolean(can.del && !rDelete)}
          description={
            can.del
              ? (rDelete ?? 'Permanently removes this order')
              : "You don't have permission to delete purchase orders"
          }
          disabledReason={can.del ? rDelete : "You don't have permission to delete purchase orders"}
          onSelect={() => setConfirm('delete')}
        >
          Delete order
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const railExtra = (
    <>
      <div className="pt-1">{otherActions}</div>
      <RailCard title="Summary">
        <p className="text-lg font-bold leading-6 text-foreground">{po.code}</p>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-faint">Type</span>
          <span className="truncate font-medium text-body">{po.poType}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-faint">Vendor</span>
          <span className="truncate font-medium text-body" title={po.vendorName}>
            {po.vendorName || 'None'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-faint">Client</span>
          <span className="truncate font-medium text-body">{po.clientName}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-faint">PO date</span>
          <span>{po.poDate ? fmt.date(po.poDate) : 'None'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusPill status={po.status} domain="purchaseOrder" />
          {can.status && po.status !== 'Pending' ? (
            <DisabledReason
              reason={
                po.allowedStatuses.length
                  ? null
                  : `A ${po.status.toLowerCase()} purchase order can't change status.`
              }
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Change status"
                disabled={po.allowedStatuses.length === 0}
                onClick={() => setStatusOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DisabledReason>
          ) : null}
          <span className="flex-1" />
          {can.log ? (
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setLogOpen(true)}
            >
              Show change log
            </button>
          ) : null}
        </div>
        <ReceivedSummary po={po} />
        {po.receivedAt ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-faint">Actual receiving</span>
            <ZonedTime value={po.receivedAt} timeZone={po.warehouseTimeZone} />
          </div>
        ) : null}
      </RailCard>
      <RailCard title="Billing charges">
        <DisabledReason reason={can.billing ? null : "You don't have permission to download billing charges"}>
          <Button
            variant="secondary"
            size="sm"
            disabled={!can.billing}
            onClick={() => openFile(`/api/purchase-orders/${po.id}/billing-charges`)}
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download billing charges
          </Button>
        </DisabledReason>
        <p className="text-2xs text-faint">Click to download the latest billing charges.</p>
      </RailCard>
      <RailCard title="Printouts">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-faint" aria-hidden />
          <span className={`flex-1 text-xs ${po.attachmentCount ? 'text-body' : 'text-faint'}`}>
            {po.attachmentCount ? `Documents · ${po.attachmentCount}` : 'No documents yet'}
          </span>
          <DisabledReason reason={can.upload ? null : "You don't have permission to upload documents"}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Upload document"
              disabled={!can.upload}
              onClick={() => setUploadOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DisabledReason>
          <DisabledReason reason={po.attachmentCount ? null : 'No documents uploaded yet'}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="View documents"
              disabled={!po.attachmentCount}
              onClick={() => setDocsOpen(true)}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DisabledReason>
        </div>
      </RailCard>
    </>
  );

  const records = {
    columns: [
      { key: 'code', label: 'PO number' },
      { key: 'status', label: 'Status' },
      { key: 'qty', label: 'Open qty' },
    ],
    rows: [
      {
        code: <Nowrap mono>{po.code}</Nowrap>,
        status: <StatusPill status={po.status} domain="purchaseOrder" size="sm" />,
        qty: remaining.toLocaleString(),
      },
    ],
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title={editing ? 'Edit purchase order' : 'Purchase order'}
        crumbLabel={po.code}
        helper={`${po.clientName} · ${po.warehouseName} · created ${fmt.date(po.createdAt)}`}
        actions={
          <>
            <Link href="/receiving" className={buttonVariants({ variant: 'ghost' })}>
              Purchase orders
            </Link>
            {can.receive && po.status !== 'Cancelled' && po.status !== 'Completed' ? (
              <DisabledReason reason={rReceive}>
                <Button
                  variant={editing ? 'primary' : 'secondary'}
                  disabled={Boolean(rReceive)}
                  onClick={() => setReceiveOpen(true)}
                >
                  <PackageCheck className="h-3.5 w-3.5" aria-hidden />
                  Receive items
                </Button>
              </DisabledReason>
            ) : null}
            {editable && !editing ? (
              <Button variant="primary" onClick={() => setEditMode(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit purchase order
              </Button>
            ) : null}
          </>
        }
      />
      <div className={`flex min-w-0 flex-col gap-4 px-4 sm:px-6 ${COMPACT_STEPPER}`}>
        <PoWizard
          key={`${po.id}:${po.version}`}
          po={po}
          readOnly={!editing}
          readOnlyNote={
            editable
              ? 'Read-only view of the order. Use Edit purchase order to make changes.'
              : undefined
          }
          initialStep={initialStep}
          railExtra={railExtra}
          onSaved={() => void refresh()}
        />
        <ReceiptsPanel
          po={po}
          canCancel={can.cancelReceipt}
          onOpen={setReceiptId}
          onCancel={(r) => cancelReceipt.ask(r)}
        />
        <PreAdvicePanel po={po} />
        {/* KitStak Projects work linked to this PO: full width like the count page (hidden when Projects is off). */}
        <ProjectTasksCard kind="receipt" variant="aside" recordId={po.id} recordLabel={po.code} />
      </div>

      <ReceiveItemsDrawer
        po={po}
        open={receiveOpen}
        onOpenChange={(open) => {
          setReceiveOpen(open);
          if (!open) void refresh();
        }}
      />
      <ConfirmDialog
        open={confirm === 'receiveAll'}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant="info"
        icon={PackageCheck}
        title={`Receive ${po.code} in full?`}
        description={`Every open line is received into ${po.defaultReceivingLocation?.code ?? 'the default receiving location'}. Lot, expiry and serial-tracked lines need Receive items instead.`}
        records={records}
        confirmLabel="Receive"
        cancelLabel="No"
        onConfirm={() => run('receiveAll')}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant="danger"
        icon={Ban}
        title={cancelText.title}
        description={cancelText.description}
        records={records}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => run('cancel')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant="danger"
        title={`Delete ${po.code}?`}
        description="This action cannot be undone."
        records={records}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => run('delete')}
      />
      {statusOpen ? (
        <PoStatusModal po={po} open onOpenChange={setStatusOpen} onChanged={() => void refresh()} />
      ) : null}
      {logOpen ? (
        <ChangeLogDrawer
          open
          onOpenChange={setLogOpen}
          entityType="purchase_order"
          entityId={po.id}
          entityCode={po.code}
        />
      ) : null}
      <DocumentUploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        entityType="purchase_order"
        entityId={po.id}
        onUploaded={() => void refresh()}
      />
      <Drawer
        open={docsOpen}
        onOpenChange={(o) => {
          setDocsOpen(o);
          if (!o) void refresh();
        }}
        title={`Documents · ${po.code}`}
        width={45}
      >
        <DocumentsViewer entityType="purchase_order" entityId={po.id} canEdit={can.upload} />
      </Drawer>
      <ReceiptDrawer
        receiptId={receiptId}
        seed={receiptId ? (receiptRows.find((row) => row.id === receiptId) ?? null) : null}
        onOpenChange={(o) => !o && setReceiptId(null)}
        canCancel={can.cancelReceipt}
        onCancel={(r) => cancelReceipt.ask(r)}
        onOpenReceipt={setReceiptId}
      />
      {cancelReceipt.dialog}
    </div>
  );
}

export function PoDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const q = useApiQuery<PoDetail>(PO_KEYS.detail(id), `/api/purchase-orders/${id}`, { retry: false });
  const refresh = React.useCallback(async () => {
    await q.refetch();
  }, [q]);

  if (q.isPending) return <RecordDetailSkeleton />;
  if (q.error || !q.data) {
    const status = isApiError(q.error) ? q.error.status : 0;
    if (status === 404)
      return (
        <StatusScreen
          code="404"
          icon={FileQuestion}
          title="Purchase order not found"
          description="It may have been deleted, or it belongs to a warehouse or client you can't access."
          actions={
            <>
              <Link href="/receiving" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                Purchase orders
              </Link>
              <HomeLink />
            </>
          }
        />
      );
    if (status === 403)
      return (
        <StatusScreen
          code="403"
          icon={ShieldAlert}
          tone="warning"
          title="You don't have access"
          description="Ask an administrator for the Purchase Orders view permission."
          actions={<HomeLink />}
        />
      );
    return (
      <StatusScreen
        icon={ShieldAlert}
        tone="danger"
        title="Couldn't load the purchase order"
        description={errorMessage(q.error)}
        actions={
          <Button variant="secondary" size="lg" onClick={() => void q.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  return (
    <DetailView
      po={q.data.data}
      initialStep={search.get('step') ?? 'confirm'}
      initialEdit={search.has('step') || search.has('edit')}
      refresh={refresh}
    />
  );
}
