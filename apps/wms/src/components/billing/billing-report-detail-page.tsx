'use client';

/**
 * Billing report details (`/billing/reports/[id]`): header strip (bill number with pencil →
 * Edit info, statuses, client, warehouse, period, total), Approve / Cancel / Print /
 * Delete, and tabs Consolidated (per fee and tier) · Detailed (grid with search, filters,
 * sort and export; references link to their PO / SO / RMA / work order).
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  FileSpreadsheet,
  History,
  MoreHorizontal,
  Pencil,
  Printer,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { urlParam, useUrlState } from '@/lib/use-url-state';
import {
  BILLING_LINE_FIELDS,
  BILLING_LINE_FILTER_PRESET,
  BILLING_LINES_GRID_KEY,
} from '@/lib/grid-defs/organization/billing-reports';
import { DataGrid, GridToolbar, useGrid, type GridColumnDef } from '@/components/grid';
import { AutoBreadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { UnderlineTabs } from '@/components/ui/tabs';
import { TabFocusGuard } from '@/components/organization/tab-focus-guard';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import {
  EntityChangeLogDrawer,
  NO_PERMISSION,
  toastBulk,
  toFilterFields,
  useAction,
  usePagePerms,
  type BulkResponse,
} from '@/components/facility/facility-shared';
import { withFilterPreset } from '@/components/organization/filter-preset';
import type { ReportDetail, ReportRow } from '@/server/repositories/billing-reports';
import { BillInfoDialog } from './bill-info-dialog';
import {
  BillingPill,
  Day,
  FREQUENCY_LABELS,
  OperationPill,
  useBillingDates,
  moneyGrid,
  moneyRail,
  printBill,
} from './billing-shared';

interface LineRow {
  readonly id: string;
  readonly feeName: string;
  readonly operationType: string;
  readonly feeBy: string;
  readonly chargeBy: string;
  readonly sku: string | null;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly totalPrice: number;
  readonly minMaxAdjustment: number;
  readonly adjustedPrice: number;
  readonly activityDate: string | null;
  readonly referenceNumber: string | null;
  readonly lpNumber: string | null;
  readonly note: string | null;
  readonly billingFrequency: string;
}

/** SO000123 → order search, PO000045 → PO search, RMA… → returns, WO… → work orders. */
function refHref(ref: string | null, op: string): string | null {
  if (!ref) return null;
  const q = encodeURIComponent(ref);
  if (/^SO/i.test(ref)) return `/orders?q=${q}&qm=eq`;
  if (/^PO/i.test(ref)) return `/purchase-orders?q=${q}&qm=eq`;
  if (/^RMA/i.test(ref) || op === 'Return') return `/returns?q=${q}&qm=eq`;
  if (/^WO/i.test(ref) || op === 'Work Order') return `/work-orders?q=${q}&qm=eq`;
  return null;
}

/** SKU is only meaningful on SKU / product-quantity charges; SO-, PO-, LP- and recurring-level lines cover many SKUs. */
const SKU_LEVEL = /SKU|Product|Kit|Component|Quantity|Unit|Receiving Line/i;
const skuLevel = (l: { readonly feeBy: string; readonly chargeBy: string }): boolean =>
  SKU_LEVEL.test(l.chargeBy) || SKU_LEVEL.test(l.feeBy);

const num = (v: number, d = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const lineColumns = (exported: boolean): GridColumnDef<LineRow>[] => [
  {
    id: 'feeName',
    header: 'Fee name',
    size: 160,
    meta: { alwaysVisible: true },
    cell: ({ row }) => <span className="font-medium text-foreground">{row.original.feeName}</span>,
  },
  {
    id: 'operationType',
    header: 'Operation',
    size: 110,
    meta: { label: 'Operation type' },
    cell: ({ row }) => row.original.operationType,
  },
  {
    id: 'feeBy',
    header: 'Fee by',
    size: 130,
    enableSorting: false,
    meta: { defaultVisible: false },
    cell: ({ row }) => row.original.feeBy,
  },
  {
    id: 'billingFrequency',
    header: 'Billing frequency',
    size: 130,
    enableSorting: false,
    meta: { defaultVisible: false },
    cell: ({ row }) => FREQUENCY_LABELS[row.original.billingFrequency] ?? row.original.billingFrequency,
  },
  {
    id: 'activityDate',
    header: 'Activity date',
    size: 110,
    cell: ({ row }) => (row.original.activityDate ? <Day value={row.original.activityDate} /> : '—'),
  },
  {
    id: 'referenceNumber',
    header: 'Reference',
    size: 120,
    meta: { label: 'Reference number' },
    cell: ({ row }) => {
      const href = refHref(row.original.referenceNumber, row.original.operationType);
      return href ? (
        <Link
          className="font-mono text-primary hover:underline"
          href={href}
          onClick={(e) => e.stopPropagation()}
        >
          {row.original.referenceNumber}
        </Link>
      ) : (
        <span className="font-mono">{row.original.referenceNumber ?? '—'}</span>
      );
    },
  },
  {
    id: 'sku',
    header: 'SKU',
    size: 110,
    cell: ({ row }) => {
      const sku = skuLevel(row.original) ? row.original.sku : null;
      return sku ? (
        <span className="font-mono text-xs">{sku}</span>
      ) : (
        <span className="text-faint" title="This charge covers the whole order / receipt, not one SKU">
          —
        </span>
      );
    },
  },
  {
    id: 'lpNumber',
    header: 'LP / tracking',
    size: 140,
    meta: { defaultVisible: false },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.lpNumber ?? '—'}</span>,
  },
  {
    id: 'chargeBy',
    header: 'Charge by',
    size: 120,
    enableSorting: false,
    cell: ({ row }) => row.original.chargeBy,
  },
  {
    id: 'quantity',
    header: 'Qty',
    size: 70,
    meta: { align: 'right', label: 'Quantity' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {num(row.original.quantity, row.original.quantity % 1 ? 2 : 0)}
      </div>
    ),
  },
  {
    id: 'unitPrice',
    header: 'Unit price',
    size: 95,
    meta: { align: 'right' },
    cell: ({ row }) => <div className="text-right tabular-nums">{num(row.original.unitPrice, 4)}</div>,
  },
  {
    id: 'totalPrice',
    header: 'Total',
    size: 95,
    meta: { align: 'right', label: 'Total price' },
    cell: ({ row }) => <div className="text-right tabular-nums">{num(row.original.totalPrice)}</div>,
  },
  {
    id: 'adjustedPrice',
    header: 'Adjusted',
    size: 100,
    meta: { align: 'right', label: 'Adjusted price' },
    cell: ({ row }) => (
      <div className="text-right font-semibold tabular-nums">{num(row.original.adjustedPrice)}</div>
    ),
  },
  {
    id: 'integrationStatus',
    header: 'Integration',
    size: 110,
    meta: { label: 'Integration status' },
    enableSorting: false,
    cell: () => (
      <span className={exported ? 'text-success' : 'text-secondary'}>{exported ? 'Sent' : 'Not sent'}</span>
    ),
  },
  {
    id: 'note',
    header: 'Note',
    size: 200,
    enableSorting: false,
    meta: { defaultVisible: false },
    cell: ({ row }) => row.original.note ?? '',
  },
];

const fetchDetailLines = (id: string) =>
  apiRequest<readonly LineRow[]>(`/api/billing-reports/${id}/lines?ps=1000`, { method: 'GET' }).then(
    (r) => r.data,
  );

/** Detailed lines as an .xlsx workbook (Logiwa: Export As Excel on the Detailed tab). */
async function downloadDetailedExcel(b: ReportDetail): Promise<void> {
  try {
    const [lines, { default: ExcelJS }] = await Promise.all([fetchDetailLines(b.id), import('exceljs')]);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Bill ${b.billNumber} detail`.slice(0, 31));
    ws.addRow([
      'Fee name',
      'Operation type',
      'Fee by',
      'Charge by',
      'Activity date',
      'Reference number',
      'LP',
      'SKU',
      'Note',
      'Quantity',
      'Unit price',
      'Total price',
      'Adjusted price',
      'Integration status',
      'Currency',
    ]).font = { bold: true };
    const status = b.exportedToIntegration ? 'Sent' : 'Not sent';
    for (const l of lines)
      ws.addRow([
        l.feeName,
        l.operationType,
        l.feeBy,
        l.chargeBy,
        l.activityDate?.slice(0, 10) ?? '',
        l.referenceNumber ?? '',
        l.lpNumber ?? '',
        l.sku ?? '',
        l.note ?? '',
        l.quantity,
        l.unitPrice,
        l.totalPrice,
        l.adjustedPrice,
        status,
        b.currency,
      ]);
    ws.columns.forEach((col, i) => {
      col.width = i < 4 ? 22 : i === 8 ? 28 : 14;
      if (i >= 10 && i <= 12) col.numFmt = i === 10 ? '0.0000' : '#,##0.00';
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `bill-${b.billNumber}-detailed.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(
      'Export ready',
      `bill-${b.billNumber}-detailed.xlsx downloaded (${lines.length.toLocaleString('en-US')} lines).`,
    );
  } catch {
    toast.error("Couldn't export the detailed lines", 'Try again in a moment.');
  }
}

function Detailed({
  id,
  exported,
  knownCount,
  hidden,
  actions,
}: {
  readonly id: string;
  readonly exported: boolean;
  readonly knownCount: number;
  readonly hidden: boolean;
  readonly actions: React.ReactNode;
}) {
  const fields = React.useMemo(
    () => withFilterPreset(toFilterFields(BILLING_LINE_FIELDS), BILLING_LINE_FILTER_PRESET),
    [],
  );
  const g = useGrid<LineRow>({
    gridKey: BILLING_LINES_GRID_KEY,
    path: `/api/billing-reports/${id}/lines`,
    fields,
  });
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const columns = React.useMemo(() => lineColumns(exported), [exported]);
  // While the first page loads, the footer shows the header's known count instead of "Total: 0".
  const total = g.isLoading && !filtered ? knownCount : g.gridProps.total;
  return (
    <div
      className={hidden ? 'hidden' : 'flex min-h-[420px] flex-col rounded-lg border border-border bg-surface'}
      aria-hidden={hidden || undefined}
    >
      <div className="flex justify-end gap-2 border-b border-border px-3 py-2">{actions}</div>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search reference, SKU, fee or LP" />
      <DataGrid<LineRow>
        {...g.gridProps}
        total={total}
        queryString={`${g.gridProps.queryString}${g.gridProps.queryString ? '&' : ''}reportId=${encodeURIComponent(id)}`}
        columns={columns}
        getRowId={(r) => r.id}
        emptyTitle={filtered ? 'No lines match these filters' : 'No detailed lines'}
        emptyDescription={
          filtered
            ? 'Clear a filter or search for another reference.'
            : 'This bill had no billable activity in its period.'
        }
      />
    </div>
  );
}

const TABS = ['consolidated', 'detailed'] as const;

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Consolidated lines as an .xlsx workbook (Logiwa: Export As Excel on the consolidated tab); CSV fallback. */
async function downloadConsolidatedExcel(b: ReportDetail): Promise<void> {
  const head = [
    'Fee name',
    'Operation type',
    'Fee by',
    'Charge by',
    'From qty',
    'To qty',
    'Unit price',
    'Quantity',
    'Total price',
    'Min/max adjustment',
    'Adjusted price',
    'Currency',
  ];
  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Bill ${b.billNumber}`.slice(0, 31));
    ws.addRow(head).font = { bold: true };
    for (const l of b.consolidated)
      ws.addRow([
        l.feeName,
        l.operationType,
        l.feeBy,
        l.chargeBy,
        l.fromQty ?? '',
        l.toQty ?? '',
        l.unitPrice,
        l.quantity,
        l.totalPrice,
        l.minMaxAdjustment,
        l.adjustedPrice,
        b.currency,
      ]);
    ws.addRow(['Total', '', '', '', '', '', '', '', '', '', b.totalPrice, b.currency]).font = { bold: true };
    ws.columns.forEach((col, i) => {
      col.width = i < 4 ? 24 : 14;
      if (i >= 6 && i <= 10) col.numFmt = i === 6 ? '0.0000' : '#,##0.00';
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `bill-${b.billNumber}-consolidated.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Export ready', `bill-${b.billNumber}-consolidated.xlsx downloaded.`);
  } catch {
    downloadConsolidated(b);
  }
}

/** Consolidated lines as a CSV download. */
function downloadConsolidated(b: ReportDetail): void {
  const head = [
    'Fee name',
    'Operation type',
    'Fee by',
    'Charge by',
    'From qty',
    'To qty',
    'Unit price',
    'Quantity',
    'Total price',
    'Min/max adjustment',
    'Adjusted price',
    'Currency',
  ];
  const rows = b.consolidated.map((l) => [
    l.feeName,
    l.operationType,
    l.feeBy,
    l.chargeBy,
    l.fromQty ?? '',
    l.toQty ?? '',
    l.unitPrice,
    l.quantity,
    l.totalPrice.toFixed(2),
    l.minMaxAdjustment.toFixed(2),
    l.adjustedPrice.toFixed(2),
    b.currency,
  ]);
  rows.push(['Total', '', '', '', '', '', '', '', '', '', b.totalPrice.toFixed(2), b.currency]);
  const csv = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `bill-${b.billNumber}-consolidated.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.success('Export ready', `bill-${b.billNumber}-consolidated.csv downloaded.`);
}

/**
 * The bill's list row, if any cached grid (Billing Report list, contract Bills tab) already
 * holds it: the header renders from it at once while the full bill (lines) loads.
 */
function useCachedBillRow(id: string): ReportRow | null {
  const qc = useQueryClient();
  return React.useMemo(() => {
    for (const [, value] of qc.getQueriesData<{ data?: unknown }>({ queryKey: ['grid'] })) {
      const rows = value?.data;
      if (!Array.isArray(rows)) continue;
      const hit = rows.find(
        (r: Partial<ReportRow> | null) =>
          r?.id === id && typeof r.billNumber === 'string' && typeof r.periodStart === 'string',
      );
      if (hit) return hit as ReportRow;
    }
    return null;
  }, [qc, id]);
}

function CachedBillHeader({ row }: { readonly row: ReportRow }) {
  const dates = useBillingDates();
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy>
      <div className="px-6 pt-3">
        <AutoBreadcrumbs currentLabel={row.billNumber} />
      </div>
      <div className="flex flex-col gap-5 px-6 pb-10 pt-2">
        <section
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs"
          aria-label="Bill header"
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-[1_1_100%] lg:flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="whitespace-nowrap text-lg font-semibold tabular-nums text-foreground">
                  Bill {row.billNumber}
                </h1>
                {row.calcStatus === 'Failed' ? (
                  <BillingPill status="Failed" />
                ) : (
                  <>
                    <BillingPill status={row.billStatus} />
                    <BillingPill status={row.calcStatus} />
                  </>
                )}
              </div>
              <p className="mt-0.5 truncate whitespace-nowrap text-sm text-secondary">
                <Link className="text-primary hover:underline" href={`/billing/${row.contractId}`}>
                  {row.contractName}
                </Link>{' '}
                · {row.clientName} · {row.warehouseCode}
              </p>
            </div>
            <Skeleton className="h-8 w-80" />
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-3 lg:grid-cols-6">
            {[
              ['Period', dates.period(row.periodStart, row.periodEnd)],
              ['Billing frequency', FREQUENCY_LABELS[row.frequency] ?? row.frequency],
              ['Calculated', dates.at(row.calculatedAt)],
              ['Created by', row.createdByName ?? 'Scheduler'],
              [
                'Exported to integration',
                row.exportedToIntegration
                  ? 'Yes · lines Sent'
                  : row.billStatus === 'Approved'
                    ? 'No · ready to export'
                    : 'No · approve first',
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-2xs font-semibold text-faint">{k}</dt>
                <dd className="mt-0.5 tabular-nums text-foreground">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-2xs font-semibold text-faint">Total</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {moneyRail(row.totalPrice, row.currency)}
              </dd>
            </div>
          </dl>
        </section>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}

export function BillingReportDetailPage({ id }: { readonly id: string }) {
  const router = useRouter();
  const perms = usePagePerms('settings.billing_report', ['view', 'delete', 'approve', 'cancel'] as const);
  const [url, setUrl] = useUrlState({ tab: urlParam.enum(TABS, 'consolidated') });
  const q = useApiQuery<ReportDetail>(['billing-report', id], `/api/billing-reports/${id}`, { staleTime: 0 });
  const [info, setInfo] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'approve' | 'cancel' | 'delete' | null>(null);
  const action = useAction([
    ['billing-report', id],
    ['grid', 'billing-reports'],
  ]);
  const dates = useBillingDates();
  const b = q.data?.data;
  const cached = useCachedBillRow(id);
  if (q.isPending && cached) return <CachedBillHeader row={cached} />;
  if (q.isPending)
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  if (q.isError || !b) {
    const missing = isApiError(q.error) && q.error.code === 'NOT_FOUND';
    return (
      <div className="p-6">
        <EmptyState
          title={missing ? 'Bill not found' : "Couldn't load this bill"}
          description={missing ? "It may have been deleted, or it's outside your scope." : q.error?.message}
          action={
            missing ? (
              <Button onClick={() => router.push('/billing/reports')}>Back to Billing Report</Button>
            ) : (
              <Button onClick={() => void q.refetch()}>Retry</Button>
            )
          }
        />
      </div>
    );
  }
  // The window opens synchronously inside the click (never pop-up blocked) and fills when the lines arrive.
  const print = (section: 'all' | 'consolidated' | 'detailed' = 'all') =>
    printBill(b, section === 'consolidated' ? [] : fetchDetailLines(id), dates, section);
  const canExport = b.billStatus === 'Approved' && !b.exportedToIntegration;
  const exportBill = async () => {
    const r = await action.run<BulkResponse>('/api/billing-reports/export-integration', 'POST', {
      ids: [b.id],
    });
    if (r) toastBulk(r, 'bill', 'exported to accounting');
  };
  // A period that hasn't ended yet (local calendar; the server re-checks in warehouse time) needs an explicit confirmation.
  const todayLocal = new Date().toLocaleDateString('en-CA');
  const openPeriod = b.billStatus === 'Draft' && b.periodEnd.slice(0, 10) >= todayLocal;
  const byFee = new Map<string, number>();
  for (const l of b.consolidated) byFee.set(l.feeName, (byFee.get(l.feeName) ?? 0) + l.adjustedPrice);
  const adjustments = b.consolidated.reduce((n, l) => n + l.minMaxAdjustment, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* One title: the bill number in the header card; the breadcrumb gives the context. */}
      <div className="px-6 pt-3">
        <AutoBreadcrumbs currentLabel={b.billNumber} />
      </div>
      <div className="flex flex-col gap-5 px-6 pb-10 pt-2">
        <section
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs"
          aria-label="Bill header"
        >
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-[1_1_100%] lg:flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="whitespace-nowrap text-lg font-semibold tabular-nums text-foreground">
                  Bill {b.billNumber}
                </h1>
                <DisabledReason
                  reason={
                    !perms.approve
                      ? NO_PERMISSION
                      : b.billStatus === 'Canceled'
                        ? 'Canceled bills are final'
                        : null
                  }
                >
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Edit info"
                    disabled={!perms.approve || b.billStatus === 'Canceled'}
                    onClick={() => setInfo(true)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </DisabledReason>
                {b.calcStatus === 'Failed' ? (
                  <BillingPill status="Failed" />
                ) : (
                  <>
                    <BillingPill status={b.billStatus} />
                    <BillingPill status={b.calcStatus} />
                    {b.outdatedReason ? <BillingPill status="Outdated" /> : null}
                  </>
                )}
              </div>
              <p
                className="mt-0.5 truncate whitespace-nowrap text-sm text-secondary"
                title={`${b.contractName} · ${b.clientName} · ${b.warehouseCode}`}
              >
                <Link className="text-primary hover:underline" href={`/billing/${b.contractId}`}>
                  {b.contractName}
                </Link>{' '}
                · {b.clientName} · {b.warehouseCode}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setLog(true)}>
                <History className="h-4 w-4" />
                Change log
              </Button>
              <Button onClick={() => print()}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
              {b.billStatus === 'Approved' ? (
                <DisabledReason
                  reason={
                    !perms.approve
                      ? NO_PERMISSION
                      : b.exportedToIntegration
                        ? 'Already exported to the accounting integration'
                        : null
                  }
                >
                  <Button disabled={!perms.approve || !canExport} onClick={() => void exportBill()}>
                    <Upload className="h-4 w-4" />
                    Export to accounting
                  </Button>
                </DisabledReason>
              ) : null}
              {b.billStatus === 'Approved' && perms.cancel ? (
                <Button onClick={() => setConfirm('cancel')}>
                  <Ban className="h-4 w-4" />
                  Cancel bill
                </Button>
              ) : null}
              {b.calcStatus === 'Failed' ? (
                <Button variant="primary" onClick={() => router.push(`/billing/${b.contractId}`)}>
                  <RefreshCw className="h-4 w-4" />
                  Recalculate
                </Button>
              ) : b.billStatus === 'Draft' ? (
                <DisabledReason reason={!perms.approve ? NO_PERMISSION : null}>
                  <Button variant="primary" disabled={!perms.approve} onClick={() => setConfirm('approve')}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </Button>
                </DisabledReason>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    icon={Ban}
                    onSelect={() => setConfirm('cancel')}
                    disabledReason={
                      !perms.cancel ? NO_PERMISSION : b.billStatus === 'Canceled' ? 'Already canceled' : null
                    }
                  >
                    Cancel bill
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={Trash2}
                    destructive
                    onSelect={() => setConfirm('delete')}
                    disabledReason={
                      !perms.delete
                        ? NO_PERMISSION
                        : b.billStatus !== 'Draft'
                          ? `${b.billStatus} bills can't be deleted`
                          : null
                    }
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-3 lg:grid-cols-6">
            {[
              ['Period', dates.period(b.periodStart, b.periodEnd)],
              ['Billing frequency', FREQUENCY_LABELS[b.frequency] ?? b.frequency],
              ['Calculated', dates.at(b.calculatedAt)],
              ['Created by', b.createdByName ?? 'Scheduler'],
              [
                'Exported to integration',
                b.exportedToIntegration
                  ? 'Yes · lines Sent'
                  : b.billStatus === 'Approved'
                    ? 'No · ready to export'
                    : 'No · approve first',
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-2xs font-semibold text-faint">{k}</dt>
                <dd className="mt-0.5 tabular-nums text-foreground">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-2xs font-semibold text-faint">Total</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {moneyRail(b.totalPrice, b.currency)}
              </dd>
            </div>
          </dl>
        </section>
        {b.outdatedReason ? (
          <Callout variant="attention" title="This draft no longer matches its activity">
            {b.outdatedReason}{' '}
            <Link className="font-medium text-primary hover:underline" href={`/billing/${b.contractId}`}>
              Open the contract to recalculate
            </Link>{' '}
            (Calculate › Replace the existing draft bill).
          </Callout>
        ) : null}
        {b.calcStatus === 'Failed' ? (
          <Callout variant="error" title="This calculation failed">
            {(b.errorMessage ?? "The engine couldn't price this period").replace(/\.?\s*$/, '.')} Fix the
            billing contract, then recalculate.
          </Callout>
        ) : null}
        <TabFocusGuard>
          <UnderlineTabs
            tabs={[
              { key: 'consolidated', label: 'Consolidated', count: b.consolidated.length },
              { key: 'detailed', label: 'Detailed', count: b.detailCount },
            ]}
            active={url.tab}
            onChange={(k) => setUrl({ tab: k as (typeof TABS)[number] })}
            className="px-0"
            ariaLabel="Bill lines"
          />
        </TabFocusGuard>
        {url.tab === 'consolidated' ? (
          b.consolidated.length === 0 ? (
            b.calcStatus === 'Failed' ? (
              <EmptyState
                title="No lines: the calculation failed"
                description="Lines appear once the contract is fixed and recalculated."
              />
            ) : (
              <EmptyState title="No consolidated lines" description="Nothing was billable in this period." />
            )
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => print('consolidated')}>
                  <Printer className="h-3.5 w-3.5" aria-hidden />
                  Print
                </Button>
                <Button size="sm" variant="success-outline" onClick={() => void downloadConsolidatedExcel(b)}>
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                  Export As Excel
                </Button>
                <Button size="sm" variant="ghost" onClick={() => downloadConsolidated(b)}>
                  CSV
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-sunken text-2xs font-semibold text-secondary">
                    <tr>
                      {[
                        'Fee name',
                        'Operation',
                        'Fee by',
                        'Charge by',
                        'From qty',
                        'To qty',
                        'Quantity',
                        'Unit price',
                        'Total price',
                        'Min/max adj.',
                        'Adjusted price',
                      ].map((h, i) => (
                        <th key={h} className={i >= 4 ? 'px-3 py-2 text-right' : 'px-3 py-2'}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {b.consolidated.map((l) => (
                      <tr key={l.id} className="hover:bg-surface-sunken/40">
                        <td className="px-3 py-2 font-medium text-foreground">
                          {l.feeName}
                          {l.note ? <div className="text-2xs font-normal text-faint">{l.note}</div> : null}
                        </td>
                        <td className="px-3 py-2">
                          <OperationPill operation={l.operationType} />
                        </td>
                        <td className="px-3 py-2">{l.feeBy}</td>
                        <td className="px-3 py-2">{l.chargeBy}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.fromQty !== null ? num(l.fromQty, 0) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.fromQty === null ? '—' : l.toQty === null ? '∞' : num(l.toQty, 0)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {num(l.quantity, l.quantity % 1 ? 2 : 0)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(l.unitPrice, 4)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(l.totalPrice)}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${l.minMaxAdjustment ? 'text-warning' : 'text-faint'}`}
                        >
                          {l.minMaxAdjustment ? num(l.minMaxAdjustment) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {moneyGrid(l.adjustedPrice, b.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-surface-sunken/60 text-sm">
                    <tr>
                      <td className="px-3 py-2 font-semibold" colSpan={9}>
                        {byFee.size} fees{adjustments ? ` · min/max adjustments ${num(adjustments)}` : ''}
                      </td>
                      <td />
                      <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">
                        {moneyGrid(b.totalPrice, b.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {(() => {
                const zero = [...byFee.keys()].filter((name) =>
                  b.consolidated.filter((l) => l.feeName === name).every((l) => l.adjustedPrice === 0),
                );
                return (
                  <p className="text-xs text-faint">
                    Every fee on the contract is listed.{' '}
                    {zero.length
                      ? `${zero.length} ${zero.length === 1 ? 'fee' : 'fees'} (${zero.join(', ')}) had no billable activity and came to 0.`
                      : 'All fees had billable activity.'}
                  </p>
                );
              })()}
            </div>
          )
        ) : null}
        <Detailed
          id={b.id}
          exported={b.exportedToIntegration}
          knownCount={b.detailCount}
          hidden={url.tab !== 'detailed'}
          actions={
            <>
              <Button size="sm" onClick={() => print('detailed')}>
                <Printer className="h-3.5 w-3.5" aria-hidden />
                Print
              </Button>
              <Button size="sm" variant="success-outline" onClick={() => void downloadDetailedExcel(b)}>
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                Export As Excel
              </Button>
            </>
          }
        />
      </div>
      <BillInfoDialog
        bill={info ? b : null}
        onOpenChange={(o) => !o && setInfo(false)}
        onSaved={() => void q.refetch()}
      />
      <EntityChangeLogDrawer
        open={log}
        onOpenChange={setLog}
        path={log ? `/api/billing-reports/${b.id}/change-log` : null}
        title={`Change log · ${b.billNumber}`}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant={
          confirm === 'approve'
            ? openPeriod
              ? 'attention'
              : 'info'
            : confirm === 'cancel'
              ? 'attention'
              : 'danger'
        }
        title={
          confirm === 'approve'
            ? openPeriod
              ? `Approve bill ${b.billNumber} for a period that is still open?`
              : `Approve bill ${b.billNumber}?`
            : confirm === 'cancel'
              ? `Cancel bill ${b.billNumber}?`
              : `Delete bill ${b.billNumber}?`
        }
        description={
          confirm === 'approve'
            ? openPeriod
              ? `The period runs until ${dates.day(b.periodEnd)}. Approving now locks the period's VAS operations and blocks the period-end run, so activity after today won't be billed. Usually you approve after the period closes.`
              : "Approved bills can't be deleted and lock their period's VAS operations."
            : confirm === 'cancel'
              ? 'Canceled bills are final; calculate the period again to replace it.'
              : 'The draft bill and its lines are removed.'
        }
        confirmLabel={confirm === 'approve' && openPeriod ? 'Approve anyway' : 'Yes'}
        cancelLabel="No"
        onConfirm={async () => {
          const path =
            confirm === 'approve'
              ? '/api/billing-reports/approve'
              : confirm === 'cancel'
                ? '/api/billing-reports/cancel'
                : '/api/billing-reports/bulk-delete';
          const r = await action.run<BulkResponse>(
            path,
            'POST',
            confirm === 'approve' && openPeriod ? { ids: [b.id], allowOpenPeriod: true } : { ids: [b.id] },
          );
          if (r) {
            toastBulk(
              r,
              'bill',
              confirm === 'approve' ? 'approved' : confirm === 'cancel' ? 'canceled' : 'deleted',
            );
            if (confirm === 'delete' && r.succeeded.length) router.push('/billing/reports');
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
