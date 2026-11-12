'use client';

/** Work Orders grid: the 20 Logiwa columns. Requested Kit Quantity carries a build-progress bar. */
import type { ColumnDef } from '@tanstack/react-table';
import { DATE_TIME_COLUMN_WIDTH, LinkCell, TagsCell } from '@/components/grid/cells';
import { DEFAULT_WAREHOUSE_ZONE, formatInZone } from '@/lib/grid-defs/work-orders/wo-time';
import { RefreshCw } from 'lucide-react';
import { SHORTAGE_RECOVERABLE_COPY } from '@/lib/grid-defs/work-orders/wo-coverage';
import { WoStatusPill } from './wo-status';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { WorkOrderRow } from './wo-client';

const dash = <span className="text-faint">—</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? dash : <span className="truncate">{String(v)}</span>;
const longText = (v: unknown) => {
  if (v === null || v === undefined || v === '') return dash;
  const s = String(v);
  return s.length > 40 ? (
    <Tooltip content={<span className="block max-w-[320px] whitespace-pre-wrap">{s}</span>}>
      <span className="truncate">{s}</span>
    </Tooltip>
  ) : (
    <span className="truncate">{s}</span>
  );
};
const date = (id: keyof WorkOrderRow & string, header: string): ColumnDef<WorkOrderRow, unknown> => ({
  id,
  accessorKey: id,
  header,
  size: DATE_TIME_COLUMN_WIDTH + 28,
  minSize: DATE_TIME_COLUMN_WIDTH + 28,
  // Warehouse time zone with a zone suffix, the same as the detail page, activity and exports.
  cell: ({ getValue, row }) => {
    const v = getValue() as string | null;
    return v ? (
      <span
        className="whitespace-nowrap tabular-nums"
        title={row.original.warehouseTimeZone ?? DEFAULT_WAREHOUSE_ZONE}
      >
        {formatInZone(v, row.original.warehouseTimeZone)}
      </span>
    ) : (
      dash
    );
  },
});

export function BuildProgress({
  processed,
  requested,
  className,
}: {
  readonly processed: number;
  readonly requested: number;
  readonly className?: string;
}) {
  const pct = requested > 0 ? Math.min(100, Math.round((processed / requested) * 100)) : 0;
  return (
    <span
      className={cn('flex w-full flex-col items-end gap-0.5', className)}
      title={`${processed.toLocaleString()} of ${requested.toLocaleString()} kits built`}
    >
      <span className="tabular-nums">{requested.toLocaleString()}</span>
      <span className="h-1 w-full max-w-[72px] overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <span
          className={cn('block h-full rounded-full', pct >= 100 ? 'bg-success' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

export function buildWoColumns(): ColumnDef<WorkOrderRow, unknown>[] {
  return [
    {
      id: 'code',
      accessorKey: 'code',
      header: 'Work order code',
      size: 210,
      minSize: 160,
      meta: { alwaysVisible: true, pinLeft: true },
      cell: ({ row }) => (
        <Tooltip content={row.original.code}>
          <span className="min-w-0 truncate">
            <LinkCell href={`/work-orders/${row.original.id}`}>{row.original.code}</LinkCell>
          </span>
        </Tooltip>
      ),
    },
    {
      id: 'jobCode',
      accessorKey: 'jobCode',
      header: 'Job code',
      size: 170,
      minSize: 140,
      cell: ({ row }) =>
        row.original.jobId && row.original.jobCode ? (
          <Tooltip content={row.original.jobCode}>
            <span className="min-w-0 truncate">
              <LinkCell href={`/jobs/${row.original.jobId}`}>{row.original.jobCode}</LinkCell>
            </span>
          </Tooltip>
        ) : (
          dash
        ),
    },
    {
      id: 'warehouseCode',
      accessorKey: 'warehouseCode',
      header: 'Warehouse',
      size: 110,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'clientName',
      accessorKey: 'clientName',
      header: 'Client',
      size: 210,
      minSize: 170,
      cell: ({ getValue }) => <Tooltip content={String(getValue() ?? '')}>{text(getValue())}</Tooltip>,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Work order status',
      size: 170,
      minSize: 150,
      meta: { clip: false },
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <WoStatusPill status={row.original.status} />
          {row.original.stockNowAvailable ? (
            <Tooltip
              content={
                <span className="block max-w-[260px]">
                  {SHORTAGE_RECOVERABLE_COPY} Can build {(row.original.buildableQty ?? 0).toLocaleString()} of{' '}
                  {(row.original.requestedQty - row.original.processedQty).toLocaleString()} left.
                </span>
              }
            >
              <span
                role="img"
                aria-label="Stock now available, retry allocation"
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-success-soft px-1.5 py-0.5 text-2xs font-medium text-success"
              >
                <RefreshCw className="size-3" aria-hidden />
                Stock in
              </span>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    {
      id: 'age',
      accessorKey: 'age',
      header: 'Age',
      size: 90,
      // `flex-row` keeps the (i) directly after the AGE label; the shared right-align reverses
      // the order, which put the icon at the far left next to the Status column.
      meta: {
        align: 'right',
        headerTip: 'Days since the work order was created',
        headerClassName: 'flex-row',
      },
      cell: ({ row }) => (
        <span
          className={cn(
            'tabular-nums',
            row.original.age > 14 &&
              row.original.status !== 'Completed' &&
              row.original.status !== 'Cancelled' &&
              'font-semibold text-warning',
          )}
        >
          {row.original.age}
        </span>
      ),
    },
    {
      id: 'operationType',
      accessorKey: 'operationType',
      header: 'Work order operation type',
      size: 190,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      // Short label so it never truncates; the full type name is in the tooltip (and the export).
      id: 'type',
      accessorKey: 'type',
      header: 'Work order type',
      size: 150,
      minSize: 130,
      cell: ({ row }) => (
        <span className="truncate" title={row.original.type}>
          {row.original.type === 'Work Order with Picking'
            ? 'With picking'
            : row.original.type === 'Work Order without Picking'
              ? 'Without picking'
              : row.original.type}
        </span>
      ),
    },
    {
      id: 'tags',
      accessorKey: 'tags',
      header: 'Tags',
      size: 120,
      enableSorting: false,
      meta: { clip: false },
      cell: ({ row }) => <TagsCell tags={row.original.tags} />,
    },
    {
      id: 'kitSku',
      accessorKey: 'kitSku',
      header: 'Kit SKU',
      size: 160,
      cell: ({ row }) => (
        <span className="truncate font-medium text-foreground" title={row.original.kitName}>
          {row.original.kitSku}
        </span>
      ),
    },
    {
      id: 'requestedQty',
      accessorKey: 'requestedQty',
      header: 'Requested kit quantity',
      size: 150,
      meta: { align: 'right', headerTip: 'Kits to build; the bar shows how many are built.' },
      cell: ({ row }) => (
        <BuildProgress processed={row.original.processedQty} requested={row.original.requestedQty} />
      ),
    },
    {
      id: 'processedQty',
      accessorKey: 'processedQty',
      header: 'Processed quantity',
      size: 130,
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.processedQty > 0 ? (
          <span className="tabular-nums">{row.original.processedQty.toLocaleString()}</span>
        ) : (
          dash
        ),
    },
    {
      id: 'extraNote',
      accessorKey: 'extraNote',
      header: 'Extra notes',
      size: 200,
      cell: ({ getValue }) => longText(getValue()),
    },
    {
      id: 'kittingInstructions',
      accessorKey: 'kittingInstructions',
      header: 'Kitting instructions',
      size: 200,
      cell: ({ getValue }) => longText(getValue()),
    },
    date('createdAt', 'Created date'),
    date('plannedStartAt', 'Planned start date'),
    date('plannedFinishAt', 'Planned finish date'),
    date('actualStartAt', 'Actual start date'),
    date('actualFinishAt', 'Actual finish date'),
    date('cancelledAt', 'Cancellation date'),
  ];
}
