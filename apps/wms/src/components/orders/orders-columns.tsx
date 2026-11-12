'use client';

/**
 * Shipment Orders grid columns: all 58 Logiwa columns (+4 on Shipped & Canceled), built
 * from `@/lib/grid-defs/orders/shipment-orders`. Primary-key and job cells are links;
 * the job link text is the job code (the UUID only lives in the href).
 */
import type { ColumnDef } from '@tanstack/react-table';
import { OrderStatusPill } from './order-status-pill';
import {
  ChannelCell,
  DATE_TIME_COLUMN_WIDTH,
  DateCell,
  LinkCell,
  MoneyCell,
  PRIORITY_COLUMN_WIDTH,
  QtyCell,
  TagsCell,
  YesNoPill,
} from '@/components/grid/cells';
import { PriorityFlag, StatusPill } from '@/components/ui/status-pill';
import {
  columnsForView,
  defaultVisibleFor,
  type OrderColumnDef,
  type OrderView,
} from '@/lib/grid-defs/orders/shipment-orders';
import { priorityFromRank } from '@/lib/grid-defs/orders/priority';
import type { OrderRow } from './orders-client';

const dash = <span className="text-faint">—</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? (
    dash
  ) : (
    <span className="block truncate" title={String(v)}>
      {String(v)}
    </span>
  );

const WIDTH: Readonly<Record<string, number>> = {
  code: 212,
  storeOrderNumber: 168,
  storeName: 168,
  age: 72,
  processingAge: 96,
  daysSinceShipped: 132,
  clientName: 136,
  warehouseCode: 184,
  status: 132,
  pickShortStatus: 96,
  packShortStatus: 96,
  tags: 150,
  totalQuantity: 80,
  skus: 180,
  jobCode: 112,
  customerName: 180,
  carrier: 100,
  shippingService: 150,
  trackingNumber: 170,
  salesPrice: 112,
  rate: 96,
  orderTypeName: 140,
  priority: PRIORITY_COLUMN_WIDTH + 20,
  note: 200,
};

function shortPill(value: unknown) {
  const v = String(value ?? 'None');
  if (v === 'None') return <span className="text-xs text-faint">None</span>;
  if (v === 'Open')
    return (
      <span className="inline-flex rounded-full bg-warning-soft px-1.5 py-px text-2xs font-semibold leading-4 text-warning">
        Open
      </span>
    );
  return <StatusPill status={v} size="sm" />;
}

const WEIGHT_FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "40,000.80 lb" / "6.50 oz": same grouping and 2 decimals as the wizard summary (critic r5). */
export function formatOrderWeight(oz: unknown): string {
  const n = typeof oz === 'number' && Number.isFinite(oz) ? oz : 0;
  return n >= 16 ? `${WEIGHT_FMT.format(n / 16)} lb` : `${WEIGHT_FMT.format(n)} oz`;
}

function weight(oz: unknown) {
  return <span className="tabular-nums">{formatOrderWeight(oz)}</span>;
}

/**
 * "3 d", or hours ("5 h") while the order is under a day old. `until` is the ship/cancel
 * timestamp: a closed order's age stops there (matching the SQL day count), not at now.
 */
export function formatAge(
  days: unknown,
  from: unknown,
  now: number = Date.now(),
  until?: unknown,
): string | null {
  if (typeof days !== 'number' || !Number.isFinite(days)) return null;
  if (days > 0) return `${days} d`;
  const t = typeof from === 'string' ? Date.parse(from) : Number.NaN;
  if (Number.isNaN(t)) return '0 d';
  const end = typeof until === 'string' && !Number.isNaN(Date.parse(until)) ? Date.parse(until) : now;
  const h = Math.max(0, Math.floor((end - t) / 3_600_000));
  return h >= 24 ? `${Math.floor(h / 24)} d` : `${h} h`;
}

function cellFor(def: OrderColumnDef): ColumnDef<OrderRow, unknown>['cell'] {
  switch (def.id) {
    case 'code':
      return ({ row }) => (
        <span className="block whitespace-nowrap" title={row.original.code}>
          <LinkCell href={`/orders/${encodeURIComponent(row.original.code)}`}>{row.original.code}</LinkCell>
        </span>
      );
    case 'storeName':
      return ({ row }) => (
        // Constrain the shared cell to the column so the store subtitle ends in an ellipsis; full name on hover.
        <span
          className="block min-w-0 max-w-full overflow-hidden [&>span]:flex [&>span]:max-w-full"
          title={[row.original.channel, row.original.storeName].filter(Boolean).join(' · ')}
        >
          <ChannelCell
            channel={row.original.channel === 'Manual' ? 'Manual' : row.original.channel}
            store={String(row.original.storeName ?? '')}
          />
        </span>
      );
    case 'status':
      return ({ row }) => <OrderStatusPill status={row.original.status} />;
    case 'pickShortStatus':
    case 'packShortStatus':
      return ({ getValue }) => shortPill(getValue());
    case 'tags':
      return ({ row }) => <TagsCell tags={row.original.tags} />;
    case 'jobCode':
      return ({ row }) =>
        row.original.jobId && row.original.jobCode ? (
          <LinkCell href={`/jobs/${encodeURIComponent(row.original.jobId)}`}>
            {String(row.original.jobCode)}
          </LinkCell>
        ) : (
          dash
        );
    case 'customerName':
      return ({ row }) =>
        text([row.original.customerName, row.original.shipState].filter(Boolean).join(' / '));
    case 'mergedOrderCode':
      return ({ row }) =>
        row.original.mergedOrderCode ? (
          <LinkCell href={`/orders/${encodeURIComponent(String(row.original.mergedOrderCode))}`}>
            {String(row.original.mergedOrderCode)}
          </LinkCell>
        ) : (
          dash
        );
    case 'mergedOrderStatus':
      return ({ getValue }) =>
        getValue() ? <OrderStatusPill status={String(getValue())} size="sm" /> : dash;
    case 'priority':
      // One priority: the integer the wizard edits, with its level flag (0 None · 1 Low · 2 Medium · 3 High · 4+ Urgent).
      return ({ getValue }) => {
        const rank = Number(getValue()) || 0;
        return (
          <span
            className="inline-flex items-center gap-1.5"
            title={`Priority ${rank} (${priorityFromRank(rank)})`}
          >
            <span
              className={
                rank > 0
                  ? 'min-w-[1.25rem] text-right tabular-nums font-semibold text-foreground'
                  : 'min-w-[1.25rem] text-right tabular-nums text-faint'
              }
            >
              {rank}
            </span>
            {rank > 0 ? <PriorityFlag priority={priorityFromRank(rank)} /> : null}
          </span>
        );
      };
    case 'age':
    case 'processingAge':
      return ({ row, getValue }) => {
        const from = def.id === 'age' ? row.original.orderDate : row.original.createdAt;
        const r = row.original as Record<string, unknown>;
        const label = formatAge(getValue(), from, Date.now(), r.shippedAt ?? r.cancelledAt);
        return label ? (
          <span
            className="block text-right tabular-nums"
            title={typeof from === 'string' ? `Since ${new Date(from).toLocaleString()}` : undefined}
          >
            {label}
          </span>
        ) : (
          dash
        );
      };
    case 'daysSinceShipped':
      return ({ getValue }) =>
        typeof getValue() === 'number' ? (
          <span className="block text-right tabular-nums">{`${getValue() as number} d`}</span>
        ) : (
          dash
        );
    case 'totalWeightOz':
      return ({ getValue }) => weight(getValue());
    default:
      break;
  }
  switch (def.kind) {
    case 'money':
      return ({ getValue }) => <MoneyCell value={getValue() as number | null} />;
    case 'integer':
    case 'number':
      return ({ getValue }) => <QtyCell value={getValue() as number | null} />;
    case 'datetime':
    case 'date':
      return ({ getValue }) => (
        <DateCell value={getValue() as string | null} dateOnly={def.kind === 'date'} />
      );
    case 'boolean':
      return ({ getValue }) => <YesNoPill value={Boolean(getValue())} />;
    default:
      return ({ getValue }) => text(getValue());
  }
}

/**
 * Width a header label needs so it never overprints its neighbour: 11 px semibold uppercase
 * with 0.04em tracking is ~7.6 px per glyph, plus 24 px cell padding and 18 px for the sort
 * arrow + gap. Rounded up to the next 4 px.
 */
export function headerFitWidth(label: string): number {
  const raw = label.toUpperCase().length * 7.6 + 24 + 18;
  return Math.ceil(raw / 4) * 4;
}

export function buildOrderColumns(view: OrderView): ColumnDef<OrderRow, unknown>[] {
  return columnsForView(view).map((def): ColumnDef<OrderRow, unknown> => {
    const numeric =
      def.id !== 'priority' && (def.kind === 'integer' || def.kind === 'number' || def.kind === 'money');
    const base =
      WIDTH[def.id] ??
      (def.kind === 'datetime' ? DATE_TIME_COLUMN_WIDTH : def.kind === 'boolean' ? 110 : 140);
    const fit = headerFitWidth(def.label);
    const width = Math.max(base, fit);
    return {
      id: def.id,
      accessorKey: def.id,
      header: def.label,
      size: width,
      // A resize can never squeeze the header under its label (no "STATSTORE" overprint).
      minSize: fit,
      enableSorting: def.sortable !== false,
      enableHiding: def.id !== 'code',
      meta: {
        label: def.label,
        defaultVisible: defaultVisibleFor(view, def),
        alwaysVisible: def.id === 'code',
        align: numeric ? 'right' : undefined,
        clip: ![
          'status',
          'tags',
          'priority',
          'pickShortStatus',
          'packShortStatus',
          'mergedOrderStatus',
        ].includes(def.id),
      },
      cell: cellFor(def),
    };
  });
}
