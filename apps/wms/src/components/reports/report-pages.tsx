'use client';

/** Client entry points for every M13 report route (each is configuration on ReportGridPage). */
import * as React from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Download, ExternalLink, Info, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { apiRequest, isApiError } from '@/lib/api-client';
import {
  CHANNEL_SALES_DEF,
  CHANNEL_SALES_DEFAULT_FILTER,
  ORDER_INVENTORY_DEF,
} from '@/lib/grid-defs/reports/orders';
import {
  REPLENISHMENT_DEF,
  SERIAL_RECEIPTS_DEF,
  SERIAL_SHIPMENTS_DEF,
  SERIAL_TRACKING_DEF,
  SNAPSHOT_BACKFILL_PERMISSION,
  SNAPSHOT_DEF,
  SNAPSHOT_DEFAULT_FILTER,
  TO_REPLENISH_TIP,
} from '@/lib/grid-defs/reports/inventory';
import {
  CHANGE_LOG_DEF,
  EXPORT_HISTORY_DEF,
  MISSING_LOG_DEF,
  SERIAL_TRANSACTIONS_DEF,
  TRANSACTION_HISTORY_DEF,
} from '@/lib/grid-defs/reports/logs';
import {
  PO_RECEIVING_DEF,
  USER_PERFORMANCE_DEF,
  USER_PERFORMANCE_DEFAULT_FILTER,
} from '@/lib/grid-defs/reports/receiving';
import {
  AGING_DEF,
  UTILIZATION_DEF,
  UTILIZATION_DEFAULT_FILTER,
  UTILIZATION_TIP,
} from '@/lib/grid-defs/reports/analysis';
import { ORDER_LINES_DEF } from '@/lib/grid-defs/reports/order-lines';
import { useCan } from '@/lib/permissions-client';
import { LABOR_TEAM_PERMISSION, SELF_ONLY_NOTICE } from '@/server/repositories/analytics-types';
import { useFormat } from '@/lib/format';
import { useApiQuery } from '@/lib/query-client';
import { ReportGridPage } from './report-grid-page';
import { UTILIZATION_OVERRIDES, UtilizationSummaryBar } from './utilization-view';
import type { ReportRow } from './report-cells';

/**
 * Neutral informational note. The shared Callout "info" tone uses the brand primary (KitStak
 * red), which reads as an error; report notes use the info (blue) tokens instead.
 */
export function InfoNote({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info-soft/60 px-3.5 py-2.5"
      data-tone="info"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1 text-sm leading-5">
        <p className="font-semibold text-foreground">{title}</p>
        <div className="mt-0.5 text-secondary">{children}</div>
      </div>
    </div>
  );
}

export function ChannelSalesReport() {
  return (
    <ReportGridPage
      def={CHANNEL_SALES_DEF}
      defaultQuery={CHANNEL_SALES_DEFAULT_FILTER}
      banner={
        <InfoNote title="Shipped orders only">
          Sold quantity, order count and revenue come from shipped, partially shipped and delivered orders.
          Click an order count to open those orders. Listings that have not sold yet are hidden: remove the
          &ldquo;Has Sales?&rdquo; chip to include them.
        </InfoNote>
      }
      emptyDescription="Results appear once an order ships, or a product is listed on a sales channel."
    />
  );
}

export function OrderInventoryReport() {
  return (
    <ReportGridPage
      def={ORDER_INVENTORY_DEF}
      emptyDescription="Results appear while stock is allocated to an open shipment order or work order."
    />
  );
}

export function SerialTrackingReport() {
  return (
    <ReportGridPage
      def={SERIAL_TRACKING_DEF}
      tabs="serial"
      emptyDescription="Serials appear once a serial-tracked product is received."
    />
  );
}

export function SerialShipmentsReport() {
  return (
    <ReportGridPage
      def={SERIAL_SHIPMENTS_DEF}
      tabs="serial"
      emptyDescription="Results appear once an order with serial-tracked products ships."
    />
  );
}

export function SerialReceiptsReport() {
  return (
    <ReportGridPage
      def={SERIAL_RECEIPTS_DEF}
      tabs="serial"
      emptyDescription="Results appear once a serial-tracked product is received."
    />
  );
}

export function ReplenishmentReport() {
  return (
    <ReportGridPage
      def={REPLENISHMENT_DEF}
      banner={
        <InfoNote title="How To Replenish is calculated">
          {TO_REPLENISH_TIP} Set min/max levels on the product&apos;s Replenishment tab.
        </InfoNote>
      }
      emptyDescription="Results appear for products that have min/max replenishment levels in a warehouse."
    />
  );
}

interface SnapshotCoverageRow {
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly latestDay: string | null;
  readonly days: number;
  readonly missingDays: readonly string[];
}

/** "Nov 6, Nov 7 and Nov 8" from YYYY-MM-DD days (runs of 4+ collapse to "Nov 6 – Nov 9"). */
export function describeDays(days: readonly string[]): string {
  const label = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  if (days.length === 0) return '';
  if (days.length >= 4)
    return `${label(days[0] ?? '')} to ${label(days[days.length - 1] ?? '')} (${days.length} days)`;
  const parts = days.map(label);
  return parts.length === 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Coverage note: which snapshot day the default view shows, and nights with no snapshot. */
function SnapshotCoverageNote() {
  const fmt = useFormat();
  const q = useApiQuery<readonly SnapshotCoverageRow[]>(
    ['report-snapshot-runs'],
    '/api/reports/inventory-snapshot/runs',
    { staleTime: 60_000 },
  );
  const rows = q.data?.data ?? [];
  if (rows.length === 0) return null;
  const gaps = rows.filter((r) => r.missingDays.length > 0);
  const latest = [...new Set(rows.map((r) => r.latestDay).filter((d): d is string => Boolean(d)))];
  return (
    <InfoNote
      title={`One snapshot per warehouse per day · latest ${latest.map((d) => fmt.date(d)).join(' / ')}`}
    >
      Taken every night at 00:02 warehouse time. A night the server was down is rebuilt from the inventory
      ledger as of 00:02 that night (Run Time shows 00:02); a run taken late shows its real time. The Latest
      Snapshot chip shows each warehouse&apos;s most recent day exactly once, and when a day ran twice only
      the later run is counted.
      {gaps.length > 0 ? (
        <span className="mt-1 block" data-testid="snapshot-gaps">
          {gaps.map((g) => (
            <span key={g.warehouseId} className="block">
              <span className="font-semibold text-foreground">{g.warehouse}:</span> no snapshot for{' '}
              {describeDays(g.missingDays)} (the scheduler was not running).
            </span>
          ))}
          <RebuildSnapshotsAction
            warehouseIds={gaps.map((g) => g.warehouseId)}
            nights={gaps.reduce((n, g) => n + g.missingDays.length, 0)}
            onDone={() => void q.refetch()}
          />
        </span>
      ) : null}
    </InfoNote>
  );
}

/**
 * "Rebuild N missed nights" (snapshot report + warehouse edit permission). The server rebuilds
 * each night from the ledger as of 00:02 and never touches a night that already has a run.
 */
function RebuildSnapshotsAction({
  warehouseIds,
  nights,
  onDone,
}: {
  readonly warehouseIds: readonly string[];
  readonly nights: number;
  readonly onDone: () => void;
}) {
  const allowed = useCan(SNAPSHOT_BACKFILL_PERMISSION);
  const queryClient = React.useContext(QueryClientContext);
  const [busy, setBusy] = React.useState(false);
  if (allowed.isLoading) return null;
  if (!allowed.allowed) {
    return (
      <span className="mt-1 block text-faint">
        An admin can rebuild these nights from the inventory ledger.
      </span>
    );
  }
  const run = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{
        nights: number;
        warehouses: readonly { warehouse: string; days: readonly { businessDate: string; rows: number }[] }[];
      }>('/api/reports/inventory-snapshot/backfill', { method: 'POST', body: { warehouseIds } });
      const done = res.data.nights;
      toast.success(
        'Snapshots rebuilt',
        done > 0
          ? `${done} night${done === 1 ? '' : 's'} rebuilt from the inventory ledger: ${res.data.warehouses.map((w) => `${w.warehouse} ${w.days.length}`).join(', ')}.`
          : 'Every night already has a snapshot.',
      );
      onDone();
      void queryClient?.invalidateQueries({ queryKey: ['grid'] });
      void queryClient?.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (error: unknown) {
      toast.error(
        'Could not rebuild snapshots',
        isApiError(error) ? error.message : 'Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void run()}
        disabled={busy}
        data-testid="snapshot-rebuild"
      >
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
        Rebuild {nights} missed night{nights === 1 ? '' : 's'}
      </Button>
      <span className="text-faint">
        Rebuilt from the inventory ledger as of 00:02 each night. Existing snapshots are never changed.
      </span>
    </span>
  );
}

export function InventorySnapshotReport() {
  return (
    <ReportGridPage
      def={SNAPSHOT_DEF}
      defaultQuery={SNAPSHOT_DEFAULT_FILTER}
      banner={<SnapshotCoverageNote />}
      emptyDescription="Snapshots are taken every night at 00:02 warehouse time, and missed nights are rebuilt from the inventory ledger. Remove the Latest Snapshot chip and filter on Snapshot Day to see older days."
    />
  );
}

export function InventoryAgingReport() {
  return (
    <ReportGridPage
      def={AGING_DEF}
      crumbLabel={AGING_DEF.title}
      banner={
        <InfoNote title="Aged by received date">
          Each row is an on-hand inventory bucket. Age counts whole days since it was received; filter on
          Aging Bucket to find stock older than 90 or 180 days.
        </InfoNote>
      }
      emptyDescription="Results appear for every inventory bucket with units on hand."
    />
  );
}

export function LocationUtilizationReport() {
  return (
    <ReportGridPage
      def={UTILIZATION_DEF}
      crumbLabel={UTILIZATION_DEF.title}
      defaultQuery={UTILIZATION_DEFAULT_FILTER}
      cellOverrides={UTILIZATION_OVERRIDES}
      banner={
        <div className="flex flex-col gap-2">
          <UtilizationSummaryBar />
          <InfoNote title="How utilization is calculated">
            {UTILIZATION_TIP} Locations that only have legacy capacity units are hidden by the
            &ldquo;Estimated Capacity? = No&rdquo; chip; remove it to include them (hatched,
            &ldquo;est.&rdquo;). Set Max Capacity Qty or dimensions on the Locations page for an exact figure.
          </InfoNote>
        </div>
      }
      emptyDescription="Results appear for every active location in your warehouses."
    />
  );
}

export function ChangeLogReport() {
  const all = useCan('settings.users.view');
  const banner =
    !all.isLoading && !all.allowed ? (
      <InfoNote title="Showing your changes only">
        The full audit trail across all users is available to admins and supervisors.
      </InfoNote>
    ) : null;
  return (
    <ReportGridPage
      def={CHANGE_LOG_DEF}
      banner={banner}
      emptyDescription="Every create, update and delete on a business record is written here."
    />
  );
}

export function TransactionHistoryReport() {
  return (
    <ReportGridPage
      def={TRANSACTION_HISTORY_DEF}
      tabs="transactions"
      emptyDescription="Every receipt, allocation, pick, pack, move, count and shipment writes a transaction here."
    />
  );
}

export function SerialTransactionsReport() {
  return (
    <ReportGridPage
      def={SERIAL_TRANSACTIONS_DEF}
      tabs="transactions"
      emptyDescription="Results appear once a serial-tracked unit moves."
    />
  );
}

export function MissingLogReport() {
  return (
    <ReportGridPage
      def={MISSING_LOG_DEF}
      emptyDescription="Results appear when a picker reports stock missing at a location."
    />
  );
}

export function PoReceivingReport() {
  return (
    <ReportGridPage
      def={PO_RECEIVING_DEF}
      emptyDescription="Results appear once a purchase order starts receiving."
    />
  );
}

export function UserPerformanceReport() {
  // Same visibility rule as Labor Analytics, enforced server-side (rows and Excel export);
  // the note only explains why one associate is listed.
  const team = useCan(LABOR_TEAM_PERMISSION);
  return (
    <ReportGridPage
      def={USER_PERFORMANCE_DEF}
      defaultQuery={USER_PERFORMANCE_DEFAULT_FILTER}
      banner={
        !team.isLoading && !team.allowed ? (
          <InfoNote title={SELF_ONLY_NOTICE.title}>
            Every associate&apos;s per-day picking, packing, receiving and count totals are available to
            supervisors and admins. This report and its Excel export list your own work.
          </InfoNote>
        ) : (
          <InfoNote title="Activity days are warehouse days">
            Each row is one associate&apos;s work on one warehouse-local day: completed pick, pack, sort and
            replenishment tasks, receipts and count entries.
          </InfoNote>
        )
      }
      emptyDescription="Results appear once users complete picking, packing, sorting, replenishment, receiving, count or return work. Try a longer period."
    />
  );
}

function DownloadLink({ row }: { readonly row: ReportRow }) {
  const href = typeof row.downloadHref === 'string' ? row.downloadHref : null;
  if (!href) {
    const status = String(row.status ?? '');
    return (
      <span
        className="inline-flex h-5 items-center gap-1 align-middle text-xs leading-5 text-faint"
        title={
          status === 'error' ? 'The export failed, so there is no file' : 'The file is still being generated'
        }
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
        {status === 'error'
          ? 'No file'
          : status === 'queued'
            ? 'Queued'
            : `Preparing${typeof row.progress === 'number' && row.progress > 0 ? ` ${row.progress}%` : ''}`}
      </span>
    );
  }
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-5 items-center gap-1 align-middle font-medium leading-5 text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      download
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      Download
    </a>
  );
}

const EXPORT_OVERRIDES = { action: (row: ReportRow) => <DownloadLink row={row} /> };
export const EXPORT_POLL_MS = 5_000;
/** Poll while any export is still being generated ("Preparing"). */
export const isExportPreparing = (rows: readonly ReportRow[]): boolean =>
  rows.some((r) => r.status !== 'completed' && r.status !== 'error');

export function ExportHistoryReport() {
  const rowActions = React.useCallback((row: ReportRow) => {
    const href = typeof row.downloadHref === 'string' ? row.downloadHref : undefined;
    const source = typeof row.sourceHref === 'string' ? row.sourceHref : undefined;
    return [
      {
        key: 'source',
        label: 'Open source grid',
        icon: ExternalLink,
        ...(source
          ? {
              onSelect: () => {
                window.location.assign(source);
              },
            }
          : { disabledReason: 'This export has no grid page to return to' }),
      },
      {
        key: 'download',
        label: 'Download',
        icon: Download,
        ...(href
          ? {
              onSelect: () => {
                window.location.assign(href);
              },
            }
          : {
              disabledReason:
                row.status === 'error'
                  ? 'The export failed, so there is no file to download'
                  : 'The file is still being generated',
            }),
      },
    ];
  }, []);
  return (
    <ReportGridPage
      def={EXPORT_HISTORY_DEF}
      cellOverrides={EXPORT_OVERRIDES}
      refetchInterval={EXPORT_POLL_MS}
      pollWhile={isExportPreparing}
      rowActions={rowActions}
      emptyTitle="No exports yet"
      emptyDescription="Use Export As Excel at the bottom of any grid. The file shows up here and in the Transactions tray."
    />
  );
}

export function OrderLinesReport() {
  return (
    <ReportGridPage
      def={ORDER_LINES_DEF}
      crumbLabel={ORDER_LINES_DEF.title}
      banner={
        <InfoNote title="Same lines as the dashboard">
          The dashboard&apos;s Order Lines row counts these lines: open backlog orders plus the orders shipped
          today. Packed lines count once even if pick data lags behind; filter Line State to see what still
          needs picking or packing.
        </InfoNote>
      }
      emptyDescription="Results appear for every line of an open order or an order shipped today."
    />
  );
}
