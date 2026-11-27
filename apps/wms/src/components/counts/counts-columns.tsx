'use client';

/**
 * Count grid columns (M07): Count Plan, Location Details, SKU Details (Logiwa 04 §6–§8
 * column sets, in Logiwa order). Codes are links; job codes open the job; % Difference is
 * a coloured pill.
 */
import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink, Lock } from 'lucide-react';
import { DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell, QtyCell, YesNoPill } from '@/components/grid/cells';
import { CountStatusPill } from './count-status-pill';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import type { CountLineListRow, CountPlanListRow } from '@/lib/grid-defs/counts/count-rows';
import {
  approvedQtySuperseded,
  lineHoldsLock,
  LOCKING_PLAN_STATUSES,
  parseJobRefs,
} from '@/lib/grid-defs/counts/count-math';
import { DIFFERENCE_THRESHOLD_HINT, DifferenceBadge } from './count-badges';

export type CountPlanRow = CountPlanListRow;
export type CountLineRow = CountLineListRow;

const dash = <span className="text-faint">None</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? dash : <span className="truncate">{String(v)}</span>;

type Kind = 'text' | 'int' | 'datetime' | 'bool';

interface ColSpec<T> {
  readonly id: string;
  readonly label: string;
  readonly kind?: Kind;
  readonly width?: number;
  readonly hidden?: boolean;
  readonly sortable?: boolean;
  readonly always?: boolean;
  readonly cell?: ColumnDef<T, unknown>['cell'];
  readonly tip?: string;
  readonly clip?: boolean;
  /** Freeze at the grid's right edge (next to the row kebab), so it is never clipped by horizontal scroll. */
  readonly sticky?: 'right';
  /** Freeze at the left edge next to the selection column (the row identifier). */
  readonly pinLeft?: boolean;
}

/**
 * Fade on the left edge of a frozen right column, so a scrolled cell slides under it instead of
 * being cut mid-value. The shared grid lost its scrim in the cell-placement refactor (request filed);
 * `cellPadding` is the only per-column class hook on both th and td, so the padding rides along.
 */
const STICKY_EDGE_SCRIM =
  "px-3 before:pointer-events-none before:absolute before:inset-y-0 before:-left-4 before:w-4 before:bg-gradient-to-r before:from-transparent before:to-[var(--surface)] before:content-[''] group-hover:before:to-[var(--surface-sunken)]";

function build<T>(specs: readonly ColSpec<T>[]): ColumnDef<T, unknown>[] {
  return specs.map((s) => {
    const kind = s.kind ?? 'text';
    const width =
      s.width ??
      (kind === 'datetime'
        ? Math.max(DATE_TIME_COLUMN_WIDTH, 176)
        : kind === 'bool'
          ? 104
          : kind === 'int'
            ? 112
            : 140);
    const cell: ColumnDef<T, unknown>['cell'] =
      s.cell ??
      (({ getValue }) => {
        const v = getValue();
        if (kind === 'int') return <QtyCell value={v as number | null} />;
        if (kind === 'datetime') return <DateCell value={v as string | null} />;
        if (kind === 'bool') return <YesNoPill value={Boolean(v)} />;
        return text(v);
      });
    return {
      id: s.id,
      accessorKey: s.id,
      header: s.label,
      size: width,
      minSize: Math.min(width, 64),
      enableSorting: s.sortable !== false,
      enableHiding: !s.always,
      meta: {
        label: s.label,
        defaultVisible: !s.hidden,
        alwaysVisible: s.always,
        align: kind === 'int' ? 'right' : undefined,
        headerTip: s.tip,
        clip: s.clip ?? !['status', 'difference'].includes(s.id),
        ...(s.sticky ? { sticky: s.sticky, cellPadding: STICKY_EDGE_SCRIM } : {}),
        ...(s.pinLeft ? { pinLeft: true } : {}),
      },
      cell,
    } as ColumnDef<T, unknown>;
  });
}

/** Job code that opens the job in a new tab (Logiwa: Job Code link + open-in-new icon). */
function JobLink({ id, code }: { readonly id: string; readonly code: string }) {
  return (
    <a
      href={`/jobs/${encodeURIComponent(id)}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`Job ${code} (opens in a new tab)`}
      className="inline-flex min-w-0 items-center gap-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span className="truncate">{code}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
    </a>
  );
}

function jobLinks(codes: string | null, refs: string | null | undefined) {
  const parsed = parseJobRefs(refs);
  if (parsed.length === 0) return codes ? <span className="truncate">{codes}</span> : dash;
  const [first, ...rest] = parsed;
  if (!first) return dash;
  // First job as a link plus a "+N" chip; the chip opens a popover listing every job (no mid-token clipping).
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">
        <JobLink id={first.id} code={first.code} />
      </span>
      {rest.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Show all ${parsed.length} jobs`}
              className="shrink-0 rounded-full bg-muted px-1.5 text-2xs font-semibold leading-[18px] text-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
            >
              +{rest.length}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2" onClick={(e) => e.stopPropagation()}>
            <p className="px-1 pb-1 text-2xs font-semibold text-faint">{parsed.length} jobs</p>
            <ul className="ks-scroll flex max-h-60 flex-col gap-1 overflow-auto">
              {parsed.map((j) => (
                <li key={j.id} className="px-1 text-sm">
                  <JobLink id={j.id} code={j.code} />
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ plans */
export function buildPlanColumns(): ColumnDef<CountPlanRow, unknown>[] {
  return build<CountPlanRow>([
    {
      // Frozen left (critic r5): a scrolled or selected row keeps its identifier in view.
      id: 'code',
      label: 'Count Code',
      width: 190,
      always: true,
      pinLeft: true,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <LinkCell href={`/counts/${encodeURIComponent(row.original.code)}`}>{row.original.code}</LinkCell>
          {row.original.lockLocations && LOCKING_PLAN_STATUSES.includes(row.original.status) ? (
            <Tooltip content="Lock Locations is on: moves in and out of these locations are blocked until the count is done">
              <Lock className="h-3 w-3 shrink-0 text-warning" aria-label="Locations locked" />
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    // Status sits next to the code so it is visible at 1440 px without scrolling.
    {
      id: 'status',
      label: 'Status',
      width: 184,
      always: true,
      cell: ({ row }) => <CountStatusPill status={row.original.status} domain="count" />,
    },
    { id: 'warehouseCode', label: 'Warehouse', width: 104 },
    {
      id: 'jobCodes',
      label: 'Job Code',
      width: 170,
      cell: ({ row }) => jobLinks(row.original.jobCodes, row.original.jobRefs),
    },
    { id: 'startedAt', label: 'Count Started Time', kind: 'datetime' },
    { id: 'completedAt', label: 'Count Completed Time', kind: 'datetime' },
    { id: 'skuCount', label: 'Number of SKU', kind: 'int', width: 148 },
    { id: 'countedSkuCount', label: 'Counted SKU', kind: 'int', width: 136 },
    {
      // Cancelled lines are never counted, so the totals (and Create Job's preview) exclude them;
      // the cell says how many were cancelled so it reconciles with Location Details, which lists every line.
      id: 'locationCount',
      label: 'Number of Location',
      kind: 'int',
      width: 184,
      cell: ({ row }) => {
        const cancelled = row.original.cancelledLineCount ?? 0;
        return (
          <span className="flex w-full items-center justify-end gap-1.5 tabular-nums">
            {cancelled > 0 ? (
              <Tooltip
                content={`${cancelled} cancelled ${cancelled === 1 ? 'line is' : 'lines are'} not counted and not included. Location Details lists them with status Cancelled.`}
              >
                <span
                  tabIndex={0}
                  className="rounded bg-surface-sunken px-1 text-2xs text-faint"
                  data-testid="cancelled-lines"
                >
                  +{cancelled} cancelled
                </span>
              </Tooltip>
            ) : null}
            <span>{row.original.locationCount}</span>
          </span>
        );
      },
    },
    {
      id: 'cancelledLineCount',
      label: 'Cancelled Lines',
      kind: 'int',
      width: 148,
      hidden: true,
      sortable: false,
    },
    { id: 'countedLocationCount', label: 'Counted Locations', kind: 'int', width: 176 },
    { id: 'createdAt', label: 'Created Time', kind: 'datetime' },
    { id: 'countType', label: 'Count Type', width: 104 },
    { id: 'isAi', label: 'AI Count Plan', kind: 'bool', width: 112 },
    { id: 'operationType', label: 'Count Operation Type', width: 156 },
    { id: 'createdByName', label: 'Created By', width: 150 },
    {
      id: 'countObject',
      label: 'Count Object',
      width: 200,
      sortable: false,
      cell: ({ row }) => {
        const extra = row.original.countObjectTotal - (row.original.countObject?.split(', ').length ?? 0);
        return row.original.countObject ? (
          <span className="truncate">
            {row.original.countObject}
            {extra > 0 ? <span className="text-faint"> +{extra}</span> : null}
          </span>
        ) : (
          dash
        );
      },
    },
    { id: 'scheduledAt', label: 'Scheduled Count Date', kind: 'datetime', hidden: true },
    { id: 'inventoryUpdatedAt', label: 'Inventory Updated Date Time', kind: 'datetime', width: 196 },
    { id: 'inventoryUpdatedByName', label: 'Inventory Update User', width: 160 },
  ]);
}

/* ------------------------------------------------------------------ lines */
const lineCommon = (kind: 'locations' | 'skus' | 'plan'): ColSpec<CountLineRow>[] => [
  {
    id: 'locationCode',
    label: 'Location',
    width: 168,
    always: kind === 'locations',
    // Long codes truncate with an ellipsis and keep the full code in the title (never hard-clipped into the next column).
    cell: ({ row }) =>
      row.original.locationCode ? (
        <span
          className="flex min-w-0 items-center gap-1 font-semibold text-foreground"
          title={row.original.locationCode}
        >
          <span className="min-w-0 truncate">{row.original.locationCode}</span>
          {lineHoldsLock(row.original.lockLocations, row.original.planStatus, row.original.status) ? (
            <Lock className="h-3 w-3 shrink-0 text-warning" aria-label="Locked by this count" />
          ) : null}
        </span>
      ) : row.original.countType === 'SKU' && row.original.productId ? (
        <Tooltip content="SKU count: the SKU is counted in every location that stocks it">
          <span className="text-secondary">All locations</span>
        </Tooltip>
      ) : (
        <Tooltip content="Resolved when the location is scanned">
          <span className="text-faint">Not resolved</span>
        </Tooltip>
      ),
  },
  { id: 'warehouseCode', label: 'Warehouse', width: 104, hidden: kind === 'plan' },
  {
    id: 'jobCode',
    label: 'Job Code',
    width: 184,
    cell: ({ row }) =>
      !row.original.jobId || !row.original.jobCode ? (
        dash
      ) : row.original.orphaned ? (
        <Tooltip content="This count job was cancelled, so the line has no count task. Re-create the job from the count plan, or cancel the line.">
          <span tabIndex={0} className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-faint line-through">{row.original.jobCode}</span>
            <span className="shrink-0 rounded bg-danger-soft px-1 text-2xs font-semibold text-danger">
              Cancelled
            </span>
          </span>
        </Tooltip>
      ) : (
        <JobLink id={row.original.jobId} code={row.original.jobCode} />
      ),
  },
  {
    id: 'planCode',
    label: 'Count Code',
    width: 170,
    hidden: kind === 'plan',
    cell: ({ row }) => (
      <LinkCell href={`/counts/${encodeURIComponent(row.original.planCode)}`}>
        {row.original.planCode}
      </LinkCell>
    ),
  },
  { id: 'operationType', label: 'Count Operation Type', width: 156, hidden: kind === 'plan' },
  { id: 'createdByName', label: 'Created By', width: 150, hidden: kind === 'plan' },
  { id: 'startedAt', label: 'Count Started Time', kind: 'datetime' },
  { id: 'completedAt', label: 'Count Completed Time', kind: 'datetime' },
];

/**
 * Status, frozen at the grid's right edge next to the row kebab. It must be the LAST data column:
 * a `position: sticky; right: 0` cell that is followed by other columns overlays them and never
 * pins once they scroll past (critic r4). Every line grid appends it after its tail columns.
 */
const statusCol: ColSpec<CountLineRow> = {
  id: 'status',
  label: 'Status',
  width: 168,
  sticky: 'right',
  always: true,
  cell: ({ row }) => <CountStatusPill status={row.original.status} domain="count" />,
};

/** "SKU-1" · "SKU-1 +2" with the full list in a tooltip (keyboard focusable). */
function SkuListCell({ list, name }: { readonly list: string | null; readonly name: string | null }) {
  const skus = list ? list.split(', ').filter(Boolean) : [];
  if (skus.length === 0)
    return (
      <Tooltip content="No stock on hand in this location">
        <span className="text-faint">No SKUs</span>
      </Tooltip>
    );
  if (skus.length === 1)
    return (
      <span className="truncate font-medium text-foreground" title={name ?? undefined}>
        {skus[0]}
      </span>
    );
  const shown = skus[0];
  const rest = skus.length - 1;
  return (
    <Tooltip content={<span className="block max-w-[280px] whitespace-normal">{skus.join(', ')}</span>}>
      <span
        className="flex min-w-0 items-center gap-1.5"
        tabIndex={0}
        aria-label={`${skus.length} SKUs: ${skus.join(', ')}`}
      >
        <span className="truncate font-medium text-foreground">{shown}</span>
        {rest > 0 ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-2xs font-semibold leading-[18px] text-secondary">
            +{rest}
          </span>
        ) : null}
      </span>
    </Tooltip>
  );
}

/** Approved qty, or "—" plus a Superseded / Not posted tag on lines that never posted. */
function ApprovedQtyCell({
  status,
  value,
}: {
  readonly status: string;
  readonly value: number | null | undefined;
}) {
  const superseded = approvedQtySuperseded(status);
  if (!superseded) return <QtyCell value={value ?? null} />;
  return (
    <Tooltip
      content={value != null ? `${superseded.reason} The superseded value was ${value}.` : superseded.reason}
    >
      <span
        tabIndex={0}
        className="flex w-full items-center justify-end gap-1.5"
        data-testid="approved-superseded"
        aria-label={`${superseded.tag}: not approved`}
      >
        <span className="shrink-0 rounded bg-surface-sunken px-1 text-2xs font-semibold text-faint">
          {superseded.tag}
        </span>
        <span className="text-faint">None</span>
      </span>
    </Tooltip>
  );
}

// Header widths leave room for the label, the sort arrow and the (i) tip so neighbours never overlap.
const qtyCols: ColSpec<CountLineRow>[] = [
  {
    id: 'initialStockQty',
    label: 'Initial Stock Qty',
    kind: 'int',
    width: 208,
    tip: 'On hand when the job was created',
  },
  {
    id: 'approvedStockQty',
    label: 'Approved Stock Qty',
    kind: 'int',
    width: 220,
    tip: 'System quantity at the moment of the count',
    cell: ({ row }) => <ApprovedQtyCell status={row.original.status} value={row.original.approvedStockQty} />,
  },
  {
    id: 'approvedCountQty',
    label: 'Approved Count Qty',
    kind: 'int',
    width: 220,
    tip: 'Counted quantity accepted for the inventory update',
    cell: ({ row }) => <ApprovedQtyCell status={row.original.status} value={row.original.approvedCountQty} />,
  },
  {
    id: 'difference',
    label: '% Difference',
    width: 150,
    tip: DIFFERENCE_THRESHOLD_HINT,
    cell: ({ row }) => <DifferenceBadge value={row.original.difference} />,
  },
  { id: 'countedQty', label: 'Counted Qty', kind: 'int', width: 124 },
];

const tailCols = (kind: 'locations' | 'skus' | 'plan'): ColSpec<CountLineRow>[] => [
  {
    id: 'isRecountLine',
    label: 'Recount Line',
    width: 150,
    cell: ({ row }) =>
      row.original.isRecountLine ? (
        <Tooltip
          content={
            row.original.recountOfJobCode
              ? `Recount of the line counted in ${row.original.recountOfJobCode}`
              : 'Recount line'
          }
        >
          <span tabIndex={0} className="inline-flex items-center gap-1.5">
            <span className="font-semibold text-foreground">Yes</span>
            {row.original.recountOfJobCode ? (
              <span className="truncate text-2xs text-secondary">of {row.original.recountOfJobCode}</span>
            ) : null}
          </span>
        </Tooltip>
      ) : (
        <span className="text-faint">No</span>
      ),
  },
  {
    // Wide enough for "Yes · Job005257 [Inventory Updated]" at 1440 px: neither the job code nor the
    // recount status is ever truncated (critic r5); the tooltip repeats both for narrow layouts.
    id: 'recounted',
    label: kind === 'skus' ? 'Recounted SKU' : 'Recounted Location',
    width: 300,
    clip: false,
    cell: ({ row }) =>
      !row.original.recounted ? (
        <span className="text-faint">No</span>
      ) : row.original.recountJobId && row.original.recountJobCode ? (
        <Tooltip
          content={`Recounted in ${row.original.recountJobCode}${row.original.recountLineStatus ? ` · recount line ${row.original.recountLineStatus}` : ''}`}
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="shrink-0 font-semibold text-foreground">Yes</span>
            <span className="shrink-0 text-faint">·</span>
            <span className="shrink-0">
              <JobLink id={row.original.recountJobId} code={row.original.recountJobCode} />
            </span>
            {row.original.recountLineStatus ? (
              <CountStatusPill
                status={row.original.recountLineStatus}
                domain="count"
                size="sm"
                className="shrink-0"
              />
            ) : null}
          </span>
        </Tooltip>
      ) : (
        <Tooltip content="A recount line was created; it gets a job once Create Job runs on the plan">
          <span tabIndex={0} className="font-semibold text-foreground">
            Yes · <span className="font-normal text-secondary">no job yet</span>
          </span>
        </Tooltip>
      ),
  },
  { id: 'countUserName', label: 'Count User', width: 150 },
  { id: 'note', label: 'Note', width: 180, sortable: false },
  { id: 'inventoryUpdatedAt', label: 'Inventory Updated Date Time', kind: 'datetime', width: 220 },
  { id: 'inventoryUpdatedByName', label: 'Inventory Update User', width: 184 },
];

/**
 * Line columns. `planCountType` (detail page only): a Location plan's lines carry no SKU, so the
 * SKU column is dropped instead of showing a dash on every row; an LP plan shows its LP instead.
 */
export function buildLineColumns(
  kind: 'locations' | 'skus' | 'plan',
  planCountType?: string,
): ColumnDef<CountLineRow, unknown>[] {
  if (kind === 'skus') {
    const common = lineCommon(kind);
    const loc = common[0] as ColSpec<CountLineRow>;
    return build<CountLineRow>([
      {
        id: 'sku',
        label: 'SKU Code',
        width: 170,
        always: true,
        cell: ({ row }) => (
          <span
            className="truncate font-semibold text-foreground"
            title={row.original.productName ?? undefined}
          >
            {row.original.sku}
          </span>
        ),
      },
      {
        id: 'planCode',
        label: 'Count Plan Code',
        width: 170,
        cell: ({ row }) => (
          <LinkCell href={`/counts/${encodeURIComponent(row.original.planCode)}`}>
            {row.original.planCode}
          </LinkCell>
        ),
      },
      { id: 'operationType', label: 'Count Operation Type', width: 156 },
      { id: 'createdByName', label: 'Created By', width: 150 },
      { id: 'warehouseCode', label: 'Warehouse', width: 104 },
      common[2] as ColSpec<CountLineRow>,
      loc,
      ...common.slice(6),
      { id: 'initialStockQty', label: 'Initial Stock Qty', kind: 'int', width: 124 },
      qtyCols[1] as ColSpec<CountLineRow>,
      qtyCols[2] as ColSpec<CountLineRow>,
      qtyCols[3] as ColSpec<CountLineRow>,
      qtyCols[4] as ColSpec<CountLineRow>,
      ...tailCols(kind),
      statusCol,
    ]);
  }
  // Every line shows the SKUs it covers (Logiwa count tasks show "SKU3, qty 200"): a SKU line its SKU,
  // a location / LP line the counted SKUs, or before counting the SKUs on hand there.
  const skus: ColSpec<CountLineRow> = {
    id: 'skuList',
    label: kind === 'plan' && planCountType === 'SKU' ? 'SKU' : 'SKUs',
    width: 180,
    sortable: false,
    hidden: kind === 'locations',
    cell: ({ row }) => (
      <SkuListCell list={row.original.skuList ?? row.original.sku ?? null} name={row.original.productName} />
    ),
  };
  const product: ColSpec<CountLineRow>[] =
    kind !== 'plan'
      ? [skus]
      : planCountType === 'LP'
        ? [
            {
              id: 'lpNumber',
              label: 'LP',
              width: 150,
              always: true,
              cell: ({ row }) => (
                <span className="truncate font-semibold text-foreground">{row.original.lpNumber ?? 'None'}</span>
              ),
            },
            skus,
          ]
        : [skus];
  // Location Details: LP-count lines show their LP next to the location.
  if (kind === 'locations')
    product.push({
      id: 'lpNumber',
      label: 'LP',
      width: 140,
      sortable: false,
      hidden: true,
      cell: ({ row }) => text(row.original.lpNumber ?? null),
    });
  if (kind === 'plan') {
    // Plan Lines grid (critic r5): Status and the count numbers lead, right after the line identity,
    // so the default 1440 px view needs no frozen overlay and no header is half covered. Job and
    // timing columns follow; the grid scrolls only for the audit tail.
    const byId = (id: string) => qtyCols.find((c) => c.id === id) as ColSpec<CountLineRow>;
    const common = lineCommon(kind);
    return build<CountLineRow>([
      ...common.slice(0, 1),
      ...product,
      { ...statusCol, sticky: undefined },
      byId('countedQty'),
      byId('approvedStockQty'),
      byId('difference'),
      byId('approvedCountQty'),
      byId('initialStockQty'),
      { id: 'skuCount', label: 'Num. of SKU', kind: 'int', width: 104 },
      ...common.slice(1),
      ...tailCols(kind),
    ]);
  }
  return build<CountLineRow>([
    ...lineCommon(kind).slice(0, 1),
    ...product,
    ...lineCommon(kind).slice(1),
    { id: 'skuCount', label: 'Num. of SKU', kind: 'int', width: 104 },
    ...qtyCols,
    ...tailCols(kind),
    statusCol,
  ]);
}
