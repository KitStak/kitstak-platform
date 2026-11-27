'use client';

/**
 * End Of The Day (`/shipments/end-of-day`): one row per carrier account, ship date and
 * warehouse. Rows follow the labels live (create +1, void −1). Bulk: Print custom report,
 * Print end of the day report (confirm → close → PDF) and Reprint.
 */
import * as React from 'react';
import {
  AlarmClock,
  FileBarChart,
  FileText,
  ListChecks,
  Printer,
  RotateCcw,
  Truck,
  XCircle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AutoCloseDialog, OVERDUE_KEY, OverdueBanner, SchedulePickupDialog } from './eod-automation';
import {
  EOD_FIELDS,
  EOD_GRID_KEY,
  closeBlockReason,
  openReportBlockReason,
  reprintBlockReason,
} from '@/lib/grid-defs/shipping/end-of-day';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import {
  DataGrid,
  GridToolbar,
  filteredListHref,
  useGrid,
  type BulkAction,
  type RowAction,
} from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import type { EodRow } from '@/server/repositories/end-of-day';
import { ExportHistoryButton } from './export-history-button';
import {
  CarrierMark,
  buildColumns,
  formatInZone,
  exportColumnsOf,
  shipDateTime,
  shipDay,
  type ColumnSpec,
} from './column-kit';
import { CustomReportDialog } from './custom-report-dialog';
import {
  bulkToast,
  useHydratedPermissions,
  errorMessage,
  openFile,
  openFileWhenReady,
  postJson,
  useFilterFields,
  useSeenRows,
  type BulkOutcome,
} from './shipping-client';

const PERM = {
  close: 'fulfillment.end_of_day.print_end_of_the_day_report',
  custom: 'fulfillment.end_of_day.print_custom_report',
} as const;

interface PrintResult extends BulkOutcome {
  readonly fileId: string | null;
}

export function packagesHref(
  row: Pick<EodRow, 'carrierPrefix' | 'carrierCode' | 'warehouseCode' | 'shipDate'>,
): string {
  return filteredListHref('/shipments', [
    // Warehouse-local manifest date, not the UTC label date: a 9 pm Central label belongs to that day's manifest.
    { field: 'manifestShipDate', op: 'date', date: { kind: 'custom', from: row.shipDate, to: row.shipDate } },
    { field: 'carrierPrefix', op: 'in', values: [row.carrierPrefix] },
    { field: 'carrier', op: 'in', values: [row.carrierCode] },
    { field: 'warehouseCode', op: 'in', values: [row.warehouseCode] },
  ]);
}

/** Voided labels of the manifest (Logiwa "Show voided packages"). */
export function voidedHref(
  row: Pick<EodRow, 'carrierPrefix' | 'carrierCode' | 'warehouseCode' | 'shipDate'>,
): string {
  return filteredListHref('/shipments', [
    { field: 'manifestShipDate', op: 'date', date: { kind: 'custom', from: row.shipDate, to: row.shipDate } },
    { field: 'carrierPrefix', op: 'in', values: [row.carrierPrefix] },
    { field: 'carrier', op: 'in', values: [row.carrierCode] },
    { field: 'warehouseCode', op: 'in', values: [row.warehouseCode] },
    { field: 'labelStatus', op: 'in', values: ['Voided'] },
  ]);
}

const SPECS: readonly ColumnSpec<EodRow>[] = [
  {
    id: 'carrierPrefix',
    label: 'Prefix',
    width: 110,
    always: true,
    cell: (r) => <span className="font-semibold">{r.carrierPrefix || 'None'}</span>,
  },
  // Carrier mark + code never truncate; only the carrier setup name ellipsizes (full text in the title).
  {
    id: 'carrierCode',
    label: 'Carrier',
    width: 240,
    minWidth: 200,
    cell: (r) => (
      <span
        className="flex min-w-0 items-center gap-1.5"
        title={
          r.carrierName && r.carrierName !== r.carrierCode
            ? `${r.carrierCode} · ${r.carrierName}`
            : r.carrierCode
        }
      >
        <span className="shrink-0">
          <CarrierMark code={r.carrierCode} title={r.carrierCode} />
        </span>
        {r.carrierName && r.carrierName !== r.carrierCode ? (
          <>
            <span aria-hidden className="shrink-0 text-faint">
              ·
            </span>
            <span className="min-w-0 truncate text-xs text-secondary">{r.carrierName}</span>
          </>
        ) : null}
      </span>
    ),
  },
  {
    id: 'status',
    label: 'Status',
    width: 170,
    minWidth: 150,
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <StatusPill status={r.status} domain="eod" />
        {r.isOverdue ? (
          <span
            className="shrink-0 whitespace-nowrap text-2xs font-medium text-warning"
            title="This ship day is over and the manifest was never closed. Print the End Of The Day Report to hand it to the carrier."
          >
            Not closed
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'warehouseCode',
    label: 'Ship from',
    width: 170,
    cell: (r) => (
      <span className="block truncate" title={r.shipFrom}>
        {r.shipFrom || r.warehouseCode}
      </span>
    ),
  },
  {
    id: 'shipDate',
    label: 'Ship date',
    width: 120,
    cell: (r) => <span className="whitespace-nowrap tabular-nums">{shipDay(r.shipDate)}</span>,
  },
  {
    id: 'sequence',
    label: 'Manifest #',
    kind: 'integer',
    width: 104,
    cell: (r) => (
      <span
        className="block text-right tabular-nums"
        title={
          r.sequence > 1
            ? 'Opened after an earlier manifest for this carrier and day was closed'
            : 'First manifest for this carrier and day'
        }
      >
        #{r.sequence}
      </span>
    ),
  },
  // Warehouse clock with its zone label, matching the printed End Of The Day report.
  {
    id: 'closeDate',
    label: 'Close date',
    kind: 'datetime',
    width: 190,
    cell: (r) =>
      r.closeDate ? (
        <span
          className="whitespace-nowrap tabular-nums"
          title="Shown in the warehouse's time zone, as on the printed report"
        >
          {formatInZone(r.closeDate, r.timezone)}
        </span>
      ) : (
        <span className="text-faint">None</span>
      ),
  },
  { id: 'isPrinted', label: 'Report printed?', kind: 'boolean', width: 128 },
  {
    id: 'scheduledPickupAt',
    label: 'Scheduled pickup',
    kind: 'datetime',
    width: 180,
    cell: (r) =>
      r.scheduledPickupAt ? (
        <span className="whitespace-nowrap tabular-nums">{shipDateTime(r.scheduledPickupAt)}</span>
      ) : (
        <span className="text-faint">None</span>
      ),
  },
  {
    id: 'totalPackages',
    label: 'Total package',
    kind: 'integer',
    width: 120,
    cell: (r) => (
      <a
        href={packagesHref(r)}
        onClick={(e) => e.stopPropagation()}
        className="block text-right tabular-nums text-body underline decoration-border-strong decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        title={
          r.voidedPackages > 0
            ? `${r.totalPackages} active package(s) on this manifest. ${r.voidedPackages} voided label(s) are not counted here; a re-labelled package is counted once.`
            : 'Show these packages in Carrier Shipment Details'
        }
      >
        {r.totalPackages}
      </a>
    ),
  },
  {
    id: 'voidedPackages',
    label: 'Voided packages',
    kind: 'integer',
    width: 150,
    minWidth: 140,
    cell: (r) =>
      r.voidedPackages > 0 ? (
        <a
          href={voidedHref(r)}
          onClick={(e) => e.stopPropagation()}
          className="block text-right tabular-nums text-body underline decoration-border-strong decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          title="Show the voided packages in Carrier Shipment Details"
        >
          {r.voidedPackages}
        </a>
      ) : (
        <span className="block text-right tabular-nums text-faint">0</span>
      ),
  },
];

const COLUMNS = buildColumns(SPECS);
const EXPORT_COLUMNS = exportColumnsOf(SPECS);

export function EndOfDayPage() {
  const permissions = useHydratedPermissions();
  const fields = useFilterFields(EOD_FIELDS);
  const g = useGrid<EodRow>({ gridKey: EOD_GRID_KEY, path: '/api/end-of-day', fields });
  const selected = useSeenRows(g.rows, g.selectedIds);
  const [closing, setClosing] = React.useState<readonly EodRow[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [customOpen, setCustomOpen] = React.useState(false);
  const [pickupRows, setPickupRows] = React.useState<readonly EodRow[] | null>(null);
  const [autoOpen, setAutoOpen] = React.useState(false);
  const qc = useQueryClient();
  // The banner's rows carry what the confirm dialog shows; the server re-checks each manifest on close.
  const closeOverdue = (
    rows: readonly Pick<
      EodRow,
      'id' | 'carrierPrefix' | 'carrierCode' | 'warehouseCode' | 'shipDate' | 'totalPackages'
    >[],
  ) => setClosing(rows as readonly EodRow[]);
  const pickupReason = (rows: readonly EodRow[]): string | null => {
    if (!canClose) return "You don't have permission to schedule pickups";
    if (rows.some((r) => r.totalPackages === 0)) return 'A selected manifest has no active packages';
    return null;
  };
  const canClose = permissions.has(PERM.close);
  const canCustom = permissions.has(PERM.custom);

  const refresh = () => {
    g.refetch();
    g.clearSelection();
    void qc.invalidateQueries({ queryKey: [...OVERDUE_KEY] });
  };

  const labels = (rows: readonly EodRow[]) =>
    new Map(rows.map((r) => [r.id, `${r.carrierPrefix} ${r.shipDate}`]));

  const print = async (path: string, rows: readonly EodRow[], verb: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await openFileWhenReady(() =>
        postJson<PrintResult>(path, { ids: rows.map((r) => r.id) }),
      );
      if (result.failed.length === 0 && result.fileId) {
        const n = result.succeeded.length;
        const fileId = result.fileId;
        toast.success(
          verb === 'closed' ? `${n} ${n === 1 ? 'manifest' : 'manifests'} closed` : 'Report reprinted',
          verb === 'closed'
            ? 'The End Of The Day report is printed and ready to hand to the carrier.'
            : 'The End Of The Day report opened in a new tab.',
          { action: { label: 'Open report', onClick: () => openFile(fileId) }, duration: 10000 },
        );
      } else {
        bulkToast(result, verb, ['manifest', 'manifests'], labels(rows));
      }
      refresh();
    } catch (error) {
      toast.error("Couldn't print the report", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  /** A stored report opens directly; a printed manifest without a retrievable file is regenerated server-side. */
  const openReport = async (row: EodRow) => {
    try {
      const result = await openFileWhenReady(() =>
        postJson<{ fileId: string; regenerated: boolean }>('/api/end-of-day/report', { id: row.id }),
      );
      if (result.regenerated) {
        toast.info(
          'Report regenerated',
          `No stored copy was found for the ${row.carrierPrefix} manifest of ${shipDay(row.shipDate)}, so the End Of The Day report was rebuilt from its packages.`,
        );
        refresh();
      }
    } catch (error) {
      toast.error("Couldn't open the report", errorMessage(error));
    }
  };

  const rowActions = (row: EodRow): readonly RowAction[] => [
    { key: 'packages', label: 'Show packages', icon: ListChecks, href: packagesHref(row) },
    {
      key: 'voided',
      label: 'Show voided packages',
      icon: XCircle,
      disabledReason: row.voidedPackages > 0 ? null : 'No packages were voided on this manifest',
      href: voidedHref(row),
    },
    {
      key: 'report',
      label: 'Open printed report',
      icon: FileText,
      disabledReason: openReportBlockReason(row),
      onSelect: () => void openReport(row),
    },
    {
      key: 'close',
      label: 'Print end of the day report',
      icon: Printer,
      disabledReason: !canClose ? "You don't have permission to close manifests" : closeBlockReason([row]),
      onSelect: () => setClosing([row]),
    },
    {
      key: 'reprint',
      label: 'Reprint',
      icon: RotateCcw,
      disabledReason: !canClose ? "You don't have permission to reprint" : reprintBlockReason([row]),
      onSelect: () => void print('/api/end-of-day/reprint', [row], 'reprinted'),
    },
    {
      key: 'pickup',
      label: 'Schedule pickup',
      icon: Truck,
      disabledReason: pickupReason([row]),
      onSelect: () => setPickupRows([row]),
    },
  ];

  const bulkActions: readonly BulkAction[] = !canClose
    ? []
    : [
        {
          key: 'close',
          label: 'Print end of the day report',
          icon: Printer,
          emptyReason: 'Select at least one manifest',
          disabledReason: busy ? 'Printing…' : null,
          eligibility: () => closeBlockReason(selected),
          onSelect: () => setClosing(selected),
        },
        {
          key: 'reprint',
          label: 'Reprint',
          icon: RotateCcw,
          emptyReason: 'Select at least one manifest',
          disabledReason: busy ? 'Printing…' : null,
          eligibility: () => reprintBlockReason(selected),
          onSelect: () => void print('/api/end-of-day/reprint', selected, 'reprinted'),
        },
        {
          key: 'pickup',
          label: 'Schedule pickup',
          icon: Truck,
          emptyReason: 'Select at least one manifest',
          eligibility: () => pickupReason(selected),
          onSelect: () => setPickupRows(selected),
        },
      ];

  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const total = (closing ?? []).reduce((s, r) => s + r.totalPackages, 0);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="End of the day" tabs="shipments" />
      <OverdueBanner
        canClose={canClose}
        onShow={() => {
          g.grid.upsertFilter({ field: 'isOverdue', op: 'bool', value: true });
        }}
        onCloseAll={closeOverdue}
      />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Carrier prefix, carrier or warehouse"
        onRefresh={refresh}
        bulkActions={bulkActions}
        selectedIds={g.selectedIds}
        bulkNoun="manifest"
        trailing={
          <>
            <Button variant="secondary" onClick={() => setAutoOpen(true)} data-testid="eod-auto-close">
              <AlarmClock className="h-3.5 w-3.5" aria-hidden />
              Auto-close
            </Button>
            <ExportHistoryButton gridKey="end-of-day" />
            {canCustom ? (
              <Button variant="secondary" onClick={() => setCustomOpen(true)}>
                <FileBarChart className="h-3.5 w-3.5" aria-hidden />
                Print custom report
              </Button>
            ) : null}
          </>
        }
      />
      <CustomReportDialog open={customOpen} onOpenChange={setCustomOpen} selected={selected} />
      <SchedulePickupDialog rows={pickupRows} onClose={() => setPickupRows(null)} onDone={refresh} />
      <AutoCloseDialog open={autoOpen} onOpenChange={setAutoOpen} canEdit={canClose} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<EodRow>
          {...g.gridProps}
          columns={COLUMNS}
          exportColumns={EXPORT_COLUMNS}
          getRowId={(r) => r.id}
          rowActions={rowActions}
          emptyTitle={hasState ? 'No manifests match this view' : 'No manifests yet'}
          emptyDescription={
            hasState
              ? 'Try changing the filters or search term.'
              : 'A manifest opens automatically for each carrier account and day as soon as the first shipping label is created.'
          }
        />
      </div>
      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(o) => (o ? undefined : setClosing(null))}
        variant="attention"
        icon={Printer}
        title={
          closing && closing.length > 1
            ? `Close ${closing.length} manifests and print the report?`
            : 'Close this manifest and print the report?'
        }
        description={`The close date is set, the report is marked printed and ${total} ${total === 1 ? 'package' : 'packages'} are handed to the carrier. Labels created afterwards open a new manifest.`}
        records={
          closing
            ? {
                columns: [
                  { key: 'prefix', label: 'Prefix' },
                  { key: 'carrier', label: 'Carrier' },
                  { key: 'from', label: 'Ship from' },
                  { key: 'date', label: 'Ship date' },
                  { key: 'total', label: 'Total package' },
                ],
                rows: closing.map((r) => ({
                  prefix: r.carrierPrefix,
                  carrier: r.carrierCode,
                  from: r.warehouseCode,
                  date: shipDay(r.shipDate),
                  total: r.totalPackages,
                })),
              }
            : undefined
        }
        cancelLabel="No"
        confirmLabel="Yes, close and print"
        onConfirm={() => print('/api/end-of-day/close', closing ?? [], 'closed')}
      />
      <span className="sr-only" aria-live="polite">
        {g.isFetching ? 'Loading manifests' : `${g.total} manifests`}
      </span>
    </div>
  );
}
