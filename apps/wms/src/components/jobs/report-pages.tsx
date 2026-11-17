'use client';

/**
 * Jobs-group report grids (Logiwa 02 §3–§5): Wave Log, Allocation Exceptions and Shortage
 * Report, plus the KitStaks bulk additions Retry Allocation and Create Backorder.
 */
import * as React from 'react';
import { CopyPlus, RotateCcw, Workflow } from 'lucide-react';
import { LinkCell } from '@/components/grid/cells';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoTip } from '@/components/ui/info-tip';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { usePermissionSet } from '@/components/jobs/use-permissions';
import {
  ALLOCATION_EXCEPTION_COLUMNS,
  SHORTAGE_COLUMNS,
  WAVE_LOG_COLUMNS,
  exportColumns,
} from '@/lib/grid-defs/jobs/columns';
import {
  ALLOCATION_EXCEPTIONS_GRID,
  SHORTAGE_REASON_TIPS,
  SHORTAGES_GRID,
  WAVE_LOG_GRID,
} from '@/lib/grid-defs/jobs/reports';
import { buildColumns, Dash, textCell } from './grid-columns';
import {
  bulkToast,
  errorMessage,
  plural,
  postJson,
  str,
  type BulkOutcome,
  type GridRow,
} from './jobs-client';
import { ListShell } from './list-shell';

const ALLOCATE_PERM = 'fulfillment.shipment_orders.picking_job_operations';

/** `/jobs?f.waveNumber=eq:<wave>` — the jobs a wave created. */
export const jobsOfWaveHref = (waveNo: string): string =>
  `/jobs?f.waveNumber=${encodeURIComponent(`eq:${waveNo}`)}`;

const orderLink = (code: unknown) =>
  code ? (
    <span className="block min-w-0 truncate" title={String(code)}>
      <LinkCell href={`/orders/${encodeURIComponent(String(code))}`}>{String(code)}</LinkCell>
    </span>
  ) : (
    <Dash />
  );

/* ---------------------------------------------------------------- wave log */

const WAVE_COLS = buildColumns<GridRow>(WAVE_LOG_COLUMNS, {
  primary: 'waveNo',
  statusDomain: 'wave',
  cells: {
    waveNo: ({ row }) => (
      <LinkCell href={jobsOfWaveHref(str(row.original.waveNo))}>{str(row.original.waveNo)}</LinkCell>
    ),
    message: ({ row }) =>
      row.original.status === 'Failed' ? (
        <span className="truncate text-danger" title={str(row.original.message)}>
          {str(row.original.message) || 'Failed'}
        </span>
      ) : (
        textCell(row.original.message)
      ),
  },
});

export function WaveLogPage() {
  return (
    <ListShell<GridRow>
      title="Wave log report"
      tabs="jobs"
      gridKey={WAVE_LOG_GRID.gridKey}
      path="/api/waves"
      fields={WAVE_LOG_GRID.fields}
      columns={WAVE_COLS}
      exportColumns={exportColumns(WAVE_LOG_COLUMNS)}
      searchPlaceholder={WAVE_LOG_GRID.searchPlaceholder}
      noun="wave"
      selectable={false}
      rowHref={(row) => jobsOfWaveHref(str(row.waveNo))}
      emptyTitle="No waves have run yet"
      emptyDescription="Run a wave rule, or schedule one, to see its results here."
      emptyAction={
        <EmptyState
          compact
          title=""
          cards={[
            {
              title: 'Go to wave rules',
              description: 'Create, schedule or run a rule.',
              icon: Workflow,
              href: '/jobs/wave-rules',
            },
          ]}
        />
      }
    />
  );
}

/* --------------------------------------------------- allocation exceptions */

function RetryButton({
  ids,
  endpoint,
  body,
  onDone,
  count,
}: {
  readonly ids: readonly string[];
  readonly endpoint: string;
  readonly body?: Record<string, unknown>;
  readonly onDone: () => void;
  readonly count: number;
}) {
  const { permissions } = usePermissionSet();
  const [busy, setBusy] = React.useState(false);
  const reason =
    ids.length === 0
      ? 'Select at least one row'
      : permissions.has(ALLOCATE_PERM)
        ? null
        : "You don't have permission to allocate orders";
  return (
    <DisabledReason reason={reason}>
      <Button
        variant="secondary"
        disabled={Boolean(reason) || busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await postJson<BulkOutcome>(endpoint, { ...(body ?? {}), ids });
            bulkToast(res, 'order', 'allocated');
            onDone();
          } catch (error) {
            toast.error('Retry failed', errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Retry allocation{count > 1 ? ` (${count} orders)` : ''}
      </Button>
    </DisabledReason>
  );
}

const distinctOrders = (rows: readonly GridRow[]): number => new Set(rows.map((r) => str(r.orderId))).size;

const EXC_COLS = buildColumns<GridRow>(ALLOCATION_EXCEPTION_COLUMNS, {
  primary: 'orderCode',
  cells: {
    orderCode: ({ row }) => orderLink(row.original.orderCode),
    waveNo: ({ row }) => {
      const w = str(row.original.waveNo);
      return w && !w.startsWith('Manual') ? <LinkCell href={jobsOfWaveHref(w)}>{w}</LinkCell> : textCell(w);
    },
    explanation: ({ row }) => {
      const text = str(row.original.explanation);
      const tone =
        text === 'Shortage' || text.startsWith('Order bypassed')
          ? 'text-[var(--label-brown-text)]'
          : 'text-body';
      return (
        <span className={`truncate ${tone}`} title={text}>
          {text || 'None'}
        </span>
      );
    },
  },
});

export function AllocationExceptionsPage() {
  return (
    <ListShell<GridRow>
      title="Allocation exceptions"
      tabs="jobs"
      gridKey={ALLOCATION_EXCEPTIONS_GRID.gridKey}
      path="/api/allocation-exceptions"
      fields={ALLOCATION_EXCEPTIONS_GRID.fields}
      columns={EXC_COLS}
      exportColumns={exportColumns(ALLOCATION_EXCEPTION_COLUMNS)}
      searchPlaceholder={ALLOCATION_EXCEPTIONS_GRID.searchPlaceholder}
      noun="exception"
      trailing={({ selected, refresh }) => (
        <RetryButton
          ids={selected.map((r) => r.id)}
          count={distinctOrders(selected)}
          endpoint="/api/allocation-exceptions/retry"
          onDone={refresh}
        />
      )}
      emptyTitle="No allocation exceptions"
      emptyDescription="Every order your waves selected was allocated and put into a job."
    />
  );
}

/* --------------------------------------------------------- shortage report */

function ReasonCell({ value }: { readonly value: unknown }) {
  const reason = str(value);
  if (!reason) return <Dash />;
  return (
    <span className="flex min-w-0 max-w-full items-center gap-1.5 font-medium text-[#C8102E] [[data-theme=dark]_&]:text-[#F28B95]">
      <span className="min-w-0 truncate" title={reason}>
        {reason}
      </span>
      {SHORTAGE_REASON_TIPS[reason] ? (
        <span className="shrink-0">
          <InfoTip content={SHORTAGE_REASON_TIPS[reason]} label={`About ${reason}`} />
        </span>
      ) : null}
    </span>
  );
}

const SHORT_COLS = buildColumns<GridRow>(SHORTAGE_COLUMNS, {
  primary: 'orderCode',
  statusDomain: 'shipmentOrder',
  cells: {
    orderCode: ({ row }) => orderLink(row.original.orderCode),
    sku: ({ row }) =>
      row.original.sku ? (
        <LinkCell href={`/products?q=${encodeURIComponent(str(row.original.sku))}&qm=eq`}>
          {str(row.original.sku)}
        </LinkCell>
      ) : (
        <Dash />
      ),
    reason: ({ getValue }) => <ReasonCell value={getValue()} />,
    orderAge: ({ getValue }) => {
      const days = Number(getValue() ?? 0);
      return (
        <span className={`tabular-nums ${days >= 3 ? 'font-semibold text-[var(--label-brown-text)]' : ''}`}>
          {plural(days, 'day')}
        </span>
      );
    },
    masterOrderCode: ({ getValue }) => (getValue() ? orderLink(getValue()) : <Dash />),
  },
});

function ShortageActions({
  selected,
  onDone,
}: {
  readonly selected: readonly GridRow[];
  readonly onDone: () => void;
}) {
  const { permissions } = usePermissionSet();
  const [confirm, setConfirm] = React.useState(false);
  const ids = selected.map((r) => r.id);
  const orders = [...new Map(selected.map((r) => [str(r.orderId), r])).values()];
  const reason =
    ids.length === 0
      ? 'Select at least one shortage line'
      : permissions.has(ALLOCATE_PERM)
        ? null
        : "You don't have permission to change orders";
  const partialOnly = orders.filter((o) => o.orderStatus === 'Shortage');
  const backorderReason =
    reason ?? (partialOnly.length === 0 ? 'Only orders in Shortage status can be back-ordered' : null);
  return (
    <span className="flex items-center gap-1.5">
      <RetryButton
        ids={ids}
        count={orders.length}
        endpoint="/api/shortages/actions"
        body={{ action: 'retry' }}
        onDone={onDone}
      />
      <DisabledReason reason={backorderReason}>
        <Button variant="secondary" disabled={Boolean(backorderReason)} onClick={() => setConfirm(true)}>
          <CopyPlus className="h-3.5 w-3.5" aria-hidden />
          Create backorder
        </Button>
      </DisabledReason>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        variant="attention"
        title={`Create backorders for ${plural(partialOnly.length, 'order')}?`}
        description="The short quantity moves to a new backorder; the original order keeps what is allocated and can ship now."
        records={{
          columns: [
            { key: 'code', label: 'Order code' },
            { key: 'sku', label: 'Short SKU' },
            { key: 'qty', label: 'Shortage' },
          ],
          rows: partialOnly.map((o) => ({
            code: str(o.orderCode),
            sku: str(o.sku),
            qty: str(o.shortageQty),
          })),
        }}
        cancelLabel="Go back"
        confirmLabel="Create backorders"
        onConfirm={async () => {
          try {
            const res = await postJson<BulkOutcome>('/api/shortages/actions', {
              action: 'backorder',
              ids: partialOnly.map((o) => o.id),
            });
            bulkToast(res, 'backorder', 'created');
            onDone();
          } catch (error) {
            toast.error("Couldn't create backorders", errorMessage(error));
          }
        }}
      />
    </span>
  );
}

export function ShortagePage() {
  return (
    <ListShell<GridRow>
      title="Shortage report"
      tabs="jobs"
      gridKey={SHORTAGES_GRID.gridKey}
      path="/api/shortages"
      fields={SHORTAGES_GRID.fields}
      columns={SHORT_COLS}
      exportColumns={exportColumns(SHORTAGE_COLUMNS)}
      searchPlaceholder={SHORTAGES_GRID.searchPlaceholder}
      noun="shortage line"
      trailing={({ selected, refresh }) => <ShortageActions selected={selected} onDone={refresh} />}
      emptyTitle="No shortages"
      emptyDescription="Every open order line is fully allocated."
    />
  );
}
