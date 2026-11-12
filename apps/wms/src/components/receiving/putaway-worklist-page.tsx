'use client';

/**
 * Putaway worklist (M05): every inventory bucket still in a receiving location, oldest first,
 * on the shared DataGrid (filters, sort, saved views, column chooser, density, pager, export,
 * selection). "Put away" opens a scan step: the putaway algorithm's suggested locations, a
 * destination scan, a quantity (or the whole LP), and Confirm moves the stock through the
 * inventory transfer commands (ledger: Transfer, note "Putaway"). Bulk "Put away" moves every
 * selected task in full, to its own top suggestion or to one scanned location.
 * Count-locked / locked source locations are flagged on the row and their actions disabled.
 */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Boxes, ExternalLink, Lock, MapPin, PackageCheck, ScanLine } from 'lucide-react';
import { DataGrid, GridToolbar, useGrid, type BulkAction, type RowAction } from '@/components/grid';
import { DATE_TIME_COLUMN_WIDTH, DateCell, LinkCell } from '@/components/grid/cells';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { apiRequest } from '@/lib/api-client';
import { calendarDay } from '@/lib/grid-defs/receiving/po-schemas';
import {
  formatDwell,
  PUTAWAY_GRID_FIELDS,
  PUTAWAY_GRID_KEY,
  putawayQtyIssue,
  type PutawayTaskRow,
} from '@/lib/grid-defs/receiving/putaway';
import { useApiQuery } from '@/lib/query-client';
import { GRID_KEYS } from '@/server/exports/grid-keys';
import { putawayAlgorithmLabel } from './wizard/po-form-model';
import {
  bulkToast,
  errorMessage,
  Nowrap,
  ReceivingReportLinks,
  slowLoadError,
  useCan,
  useFilterFields,
  useSlowLoad,
  ZonedTime,
  type BulkResult,
} from './receiving-shared';

export type { PutawayTaskRow } from '@/lib/grid-defs/receiving/putaway';

interface SuggestResponse {
  readonly algorithm: string | null;
  readonly rule: string | null;
  readonly suggestions: readonly {
    readonly locationId: string;
    readonly code: string;
    readonly reasons: readonly string[];
  }[];
}

const HELPER =
  'Received stock still in a receiving location. Scan the destination to put it away; the move is posted to the inventory ledger as a transfer.';
const NO_PERMISSION = "You don't have permission to transfer inventory";
/** Excel export runs through the shared exports pipeline once the grid key is registered; until then the grid offers CSV of the page. */
const EXPORTABLE = GRID_KEYS.includes(PUTAWAY_GRID_KEY);

/** "Same SKU, empty location · Empty storage location". */
export function suggestionHeader(
  algorithm: string | null | undefined,
  rule: string | null | undefined,
): string {
  if (!algorithm) return '';
  const label = putawayAlgorithmLabel(algorithm);
  return rule && rule.trim() && rule.trim() !== label ? `${label} · ${rule.trim()}` : label;
}

function PutawayDialog({
  row,
  onClose,
  onDone,
}: {
  readonly row: PutawayTaskRow | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [code, setCode] = React.useState('');
  const [qtyText, setQtyText] = React.useState(row ? String(row.qty) : '');
  const [wholeLp, setWholeLp] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const scanRef = React.useRef<HTMLInputElement>(null);
  const suggest = useApiQuery<SuggestResponse>(
    ['putaway-suggest', row?.id ?? ''],
    row && !row.blockedReason ? '/api/putaway/suggest' : null,
    { query: { inventoryId: row?.id ?? '' }, staleTime: 30_000 },
  );
  const top = suggest.data?.data.suggestions ?? [];
  const header = suggestionHeader(suggest.data?.data.algorithm, suggest.data?.data.rule);
  const qtyIssue = row && !wholeLp ? putawayQtyIssue(qtyText, row.qty, row.packType) : null;
  const blocked =
    row?.blockedReason ??
    (!code.trim() ? 'Scan or enter the destination location.' : qtyIssue ? `${qtyIssue}.` : null);

  // A stale server error never outlives the input it was about.
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setError(null);
    };

  const submit = async () => {
    if (!row || blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = wholeLp
        ? { inventoryId: row.id, locationCode: code.trim(), wholeLp: true, version: row.version }
        : { inventoryId: row.id, locationCode: code.trim(), qty: Number(qtyText), version: row.version };
      const { data } = await apiRequest<{ totalQty: number; locationCode: string }>('/api/putaway/confirm', {
        method: 'POST',
        body,
      });
      toast.success(
        'Put away',
        wholeLp
          ? `LP ${row.lpNumber ?? ''} (${data.totalQty.toLocaleString()} units) moved from ${row.fromLocationCode} to ${data.locationCode}.`
          : `${data.totalQty.toLocaleString()} × ${row.sku} moved from ${row.fromLocationCode} to ${data.locationCode}.`,
      );
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      scanRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          scanRef.current?.focus();
        }}
      >
        <DialogHeader
          title={row ? `Put away ${row.sku}` : 'Put away'}
          description={
            row
              ? `${row.productName} · ${row.qty.toLocaleString()} ${row.packType} in ${row.fromLocationCode}${row.lotNumber ? ` · lot ${row.lotNumber}` : ''}${row.warehouseName ? ` · ${row.warehouseName}` : ''}`
              : undefined
          }
        />
        <DialogBody className="flex flex-col gap-4">
          {row?.blockedReason ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning"
            >
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{row.blockedReason}</span>
            </p>
          ) : null}
          <section aria-label="Suggested locations">
            <p className="mb-1.5 text-xs font-semibold text-secondary">
              Suggested locations{header ? <span className="font-normal text-faint"> · {header}</span> : null}
            </p>
            {row?.blockedReason ? (
              <p className="text-xs text-secondary">
                Suggestions appear once the source location is unlocked.
              </p>
            ) : suggest.isPending ? (
              <Skeleton className="h-8 w-full" />
            ) : top.length === 0 ? (
              <p className="text-xs text-secondary">
                No location matched the putaway rules. Scan any storage location.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {top.map((s, i) => (
                  <button
                    key={s.locationId}
                    type="button"
                    title={s.reasons.join(' · ')}
                    aria-pressed={code.trim().toLowerCase() === s.code.toLowerCase()}
                    onClick={() => {
                      edit(setCode)(s.code);
                      scanRef.current?.focus();
                    }}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${i === 0 ? 'border-primary/50 bg-primary-soft text-primary' : 'border-border text-body hover:bg-surface-sunken'}`}
                  >
                    <MapPin className="h-3 w-3" aria-hidden />
                    {s.code}
                    {i === 0 ? <span className="font-sans text-2xs font-semibold ">Best</span> : null}
                  </button>
                ))}
              </div>
            )}
          </section>
          <label className="flex flex-col gap-1 text-xs font-medium text-body">
            <span className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 text-faint" aria-hidden />
              Scan destination location
            </span>
            <Input
              ref={scanRef}
              value={code}
              placeholder={top[0] ? `e.g. ${top[0].code}` : 'Location code or barcode'}
              autoComplete="off"
              spellCheck={false}
              aria-label="Destination location"
              disabled={Boolean(row?.blockedReason)}
              aria-invalid={error ? true : undefined}
              onChange={(e) => edit(setCode)(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="font-mono"
            />
          </label>
          {row?.lpNumber ? (
            <Checkbox
              id={`whole-lp-${row.id}`}
              checked={wholeLp}
              disabled={Boolean(row.blockedReason)}
              onCheckedChange={(v) => edit(setWholeLp)(Boolean(v))}
              label={`Move the whole LP ${row.lpNumber} (every SKU on it) in one scan`}
            />
          ) : null}
          {!wholeLp ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-body">
              <span>Quantity ({row?.packType ?? 'Each'})</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={row?.qty}
                value={qtyText}
                aria-label="Quantity"
                disabled={Boolean(row?.blockedReason)}
                aria-invalid={qtyIssue && qtyText !== '' ? true : undefined}
                onChange={(e) => edit(setQtyText)(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  }
                }}
                className="w-32"
              />
              {qtyIssue ? <span className="text-2xs font-normal text-danger">{qtyIssue}</span> : null}
            </label>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {blocked && !row?.blockedReason ? (
            <span className="mr-auto text-xs text-secondary">{blocked}</span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <DisabledReason reason={blocked}>
            <Button variant="primary" disabled={Boolean(blocked) || busy} onClick={() => void submit()}>
              <PackageCheck className="h-3.5 w-3.5" aria-hidden />
              {busy ? 'Moving…' : 'Confirm putaway'}
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type BulkMode = 'suggested' | 'scan';

function BulkPutawayDialog({
  rows,
  onClose,
  onDone,
}: {
  readonly rows: readonly PutawayTaskRow[] | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [mode, setMode] = React.useState<BulkMode>('suggested');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const eligible = (rows ?? []).filter((r) => !r.blockedReason);
  const skipped = (rows ?? []).filter((r) => r.blockedReason);
  const units = eligible.reduce((n, r) => n + r.qty, 0);
  const warehouses = new Set(eligible.map((r) => r.warehouseId));
  const reason =
    eligible.length === 0
      ? 'Every selected task is in a locked location.'
      : mode === 'scan' && !code.trim()
        ? 'Scan or enter the destination location.'
        : mode === 'scan' && warehouses.size > 1
          ? "The selection spans several warehouses. Use each task's suggested location, or select one warehouse."
          : null;

  const run = async () => {
    if (reason || busy) return;
    setBusy(true);
    try {
      const { data } = await apiRequest<
        BulkResult & { moved: readonly { id: string; sku: string; qty: number; to: string }[] }
      >('/api/putaway/bulk', {
        method: 'POST',
        body: {
          items: eligible.map((r) => ({ inventoryId: r.id, version: r.version })),
          ...(mode === 'scan' ? { locationCode: code.trim() } : {}),
        },
      });
      const label = new Map((rows ?? []).map((r) => [r.id, `${r.sku} in ${r.fromLocationCode}`]));
      const movedUnits = data.moved.reduce((n, m) => n + m.qty, 0);
      bulkToast(data, (id) => label.get(id) ?? id, {
        done: 'put away',
        noun: 'task',
        successMessage: `${data.succeeded.length.toLocaleString()} task${data.succeeded.length === 1 ? '' : 's'} put away (${movedUnits.toLocaleString()} units).${skipped.length ? ` ${skipped.length} skipped: location locked.` : ''}`,
      });
      onDone();
    } catch (e) {
      toast.error('Error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={rows !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          title={`Put away ${eligible.length.toLocaleString()} task${eligible.length === 1 ? '' : 's'}`}
          description={`${units.toLocaleString()} units move in full. Each task is posted to the inventory ledger as its own transfer.`}
        />
        <DialogBody className="flex flex-col gap-3 text-sm">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold text-secondary">Destination</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="bulk-putaway-mode"
                className="mt-0.5 accent-[var(--color-primary)]"
                checked={mode === 'suggested'}
                onChange={() => setMode('suggested')}
              />
              <span>
                <span className="font-medium text-foreground">Each task to its best suggested location</span>
                <span className="block text-xs text-secondary">
                  The putaway algorithm picks the location per SKU, lot and quantity.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="bulk-putaway-mode"
                className="mt-0.5 accent-[var(--color-primary)]"
                checked={mode === 'scan'}
                onChange={() => setMode('scan')}
              />
              <span>
                <span className="font-medium text-foreground">All tasks to one location</span>
                <span className="block text-xs text-secondary">
                  Scan the location, cart or staging lane they all go to.
                </span>
              </span>
            </label>
          </fieldset>
          {mode === 'scan' ? (
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Location code or barcode"
              aria-label="Destination location for all tasks"
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void run();
                }
              }}
            />
          ) : null}
          {skipped.length > 0 ? (
            <div
              role="status"
              className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning"
            >
              <p className="font-semibold">
                {skipped.length} selected task{skipped.length === 1 ? ' is' : 's are'} skipped
              </p>
              <ul className="mt-1 list-disc pl-4">
                {skipped.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    {r.sku} in {r.fromLocationCode}: {r.blockedReason}
                  </li>
                ))}
                {skipped.length > 4 ? <li>+{skipped.length - 4} more</li> : null}
              </ul>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {reason ? <span className="mr-auto text-xs text-secondary">{reason}</span> : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <DisabledReason reason={reason}>
            <Button variant="primary" disabled={Boolean(reason) || busy} onClick={() => void run()}>
              <PackageCheck className="h-3.5 w-3.5" aria-hidden />
              {busy ? 'Moving…' : 'Put away'}
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const dash = <span className="text-faint">—</span>;
type Col = ColumnDef<PutawayTaskRow, unknown>;
const plain = (id: keyof PutawayTaskRow & string, header: string, size = 130, mono = false): Col => ({
  id,
  accessorKey: id,
  header,
  size,
  enableSorting: true,
  cell: ({ getValue }) => {
    const v = getValue();
    return v === null || v === undefined || v === '' ? (
      dash
    ) : (
      <span className={`truncate${mono ? ' font-medium' : ''}`} title={String(v)}>
        {String(v)}
      </span>
    );
  },
});

function buildColumns(canMove: boolean, open: (row: PutawayTaskRow) => void): Col[] {
  return [
    {
      id: 'sku',
      accessorKey: 'sku',
      header: 'SKU',
      size: 210,
      enableSorting: true,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-mono font-medium text-foreground">{row.original.sku}</div>
          <div className="truncate text-xs text-secondary" title={row.original.productName}>
            {row.original.productName}
          </div>
        </div>
      ),
    },
    plain('warehouseName', 'Warehouse', 150),
    plain('clientName', 'Client', 150),
    {
      id: 'fromLocationCode',
      accessorKey: 'fromLocationCode',
      header: 'Location',
      size: 150,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <Nowrap mono>{row.original.fromLocationCode}</Nowrap>
          {row.original.blockedReason ? (
            <Badge tone="warning" size="sm" icon={Lock} title={row.original.blockedReason}>
              Locked
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'qty',
      accessorKey: 'qty',
      header: 'Quantity',
      size: 110,
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.qty.toLocaleString()}{' '}
          <span className="text-2xs text-faint">{row.original.packType}</span>
        </span>
      ),
    },
    plain('barcode', 'Barcode', 140),
    plain('lotNumber', 'Lot batch number', 140),
    {
      id: 'expiryDate',
      accessorKey: 'expiryDate',
      header: 'Expiry date',
      size: 120,
      enableSorting: true,
      cell: ({ row }) => <DateCell value={calendarDay(row.original.expiryDate)} dateOnly />,
    },
    plain('lpNumber', 'LP number', 130, true),
    {
      id: 'poNumber',
      accessorKey: 'poNumber',
      header: 'PO number',
      size: 140,
      enableSorting: true,
      cell: ({ row }) =>
        row.original.poNumber ? (
          row.original.purchaseOrderId ? (
            <LinkCell href={`/receiving/${row.original.purchaseOrderId}`}>{row.original.poNumber}</LinkCell>
          ) : (
            <Nowrap>{row.original.poNumber}</Nowrap>
          )
        ) : (
          dash
        ),
    },
    {
      id: 'receivedAt',
      accessorKey: 'receivedAt',
      header: 'Receiving date',
      size: DATE_TIME_COLUMN_WIDTH + 28,
      minSize: DATE_TIME_COLUMN_WIDTH,
      enableSorting: true,
      cell: ({ row }) => (
        <ZonedTime value={row.original.receivedAt} timeZone={row.original.warehouseTimeZone} />
      ),
    },
    {
      id: 'dwellHours',
      accessorKey: 'dwellHours',
      header: 'Waiting',
      size: 100,
      enableSorting: true,
      cell: ({ row }) => (
        <span
          className={`tabular-nums ${row.original.dwellHours >= 24 ? 'font-medium text-warning' : 'text-secondary'}`}
          title={`${row.original.dwellHours.toLocaleString()} hours in the receiving area`}
        >
          {formatDwell(row.original.dwellHours)}
        </span>
      ),
    },
    {
      id: 'putaway',
      header: '',
      size: 120,
      enableSorting: false,
      enableHiding: false,
      meta: { sticky: 'right' },
      cell: ({ row }) => {
        const reason = !canMove ? NO_PERMISSION : row.original.blockedReason;
        return (
          <DisabledReason reason={reason}>
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(reason)}
              onClick={(e) => {
                e.stopPropagation();
                open(row.original);
              }}
            >
              Put away
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Button>
          </DisabledReason>
        );
      },
    },
  ];
}

export function PutawayWorklistPage() {
  const qc = useQueryClient();
  const fields = useFilterFields(PUTAWAY_GRID_FIELDS);
  const g = useGrid<PutawayTaskRow>({ gridKey: PUTAWAY_GRID_KEY, path: '/api/putaway', fields });
  const slow = useSlowLoad(g.isLoading);
  const can = useCan('inventory.inventory_by_location.transfer_product');
  const canMove = can.allowed;
  const [active, setActive] = React.useState<PutawayTaskRow | null>(null);
  const [bulkRows, setBulkRows] = React.useState<readonly PutawayTaskRow[] | null>(null);
  const units = useWaitingUnits(g.rows);
  usePrefetchSuggestions(g.rows, canMove);
  const columns = React.useMemo(() => buildColumns(canMove, setActive), [canMove]);
  const done = () => {
    setActive(null);
    setBulkRows(null);
    g.clearSelection();
    g.refetch();
    void qc.invalidateQueries({ queryKey: ['grid'] });
  };
  const byId = new Map(g.rows.map((r) => [r.id, r]));
  const selectedRows = (ids: readonly string[]) =>
    ids.map((id) => byId.get(id)).filter((r): r is PutawayTaskRow => r !== undefined);

  const bulkActions: readonly BulkAction[] = [
    {
      key: 'putaway',
      label: 'Put away',
      icon: PackageCheck,
      disabledReason: can.isLoading ? 'Loading permissions' : canMove ? null : NO_PERMISSION,
      // Acts on the eligible rows; locked ones are listed as skipped in the dialog.
      eligibility: (ids) =>
        selectedRows(ids).some((r) => !r.blockedReason)
          ? null
          : 'Every selected task is in a locked location.',
      onSelect: (ids) => setBulkRows(selectedRows(ids)),
    },
  ];

  const rowActions = (row: PutawayTaskRow): readonly RowAction[] => [
    {
      key: 'putaway',
      label: 'Put away',
      icon: PackageCheck,
      disabledReason: !canMove ? NO_PERMISSION : row.blockedReason,
      onSelect: () => setActive(row),
    },
    ...(row.purchaseOrderId
      ? [
          {
            key: 'po',
            label: 'Open purchase order',
            icon: ExternalLink,
            href: `/receiving/${row.purchaseOrderId}`,
          },
        ]
      : []),
    {
      key: 'stock',
      label: 'View in Inventory by Location',
      icon: Boxes,
      href: `/inventory/by-location?q=${encodeURIComponent(row.sku)}`,
    },
  ];

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Putaway" tabs="receiving" helper={HELPER} actions={<ReceivingReportLinks />} />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search SKU, barcode, location or PO"
        bulkNoun="task"
        bulkActions={bulkActions}
        trailing={
          <span className="whitespace-nowrap text-xs text-secondary" data-testid="putaway-count">
            {g.isLoading
              ? 'Loading…'
              : `${g.total.toLocaleString()} task${g.total === 1 ? '' : 's'} · ${units.toLocaleString()} units waiting`}
          </span>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<PutawayTaskRow>
          {...g.gridProps}
          queryString={EXPORTABLE ? g.gridProps.queryString : undefined}
          exportName="putaway-worklist"
          loading={g.gridProps.loading && !slow}
          error={slowLoadError(g.gridProps.error, slow)}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          canSelectRow={() => canMove}
          onRowClick={(row) => {
            if (canMove && !row.blockedReason) setActive(row);
          }}
          emptyTitle="Nothing to put away"
          emptyDescription="Every received unit has left the receiving locations, or no task matches the filters."
        />
      </div>
      {/* Distinct key namespaces: both dialogs are siblings and must never share a key. */}
      <PutawayDialog
        key={active ? `single-${active.id}` : 'single-none'}
        row={active}
        onClose={() => setActive(null)}
        onDone={done}
      />
      <BulkPutawayDialog
        key={bulkRows ? `bulk-${bulkRows.map((r) => r.id).join(',')}` : 'bulk-none'}
        rows={bulkRows}
        onClose={() => setBulkRows(null)}
        onDone={done}
      />
    </div>
  );
}

/** Same key as PutawayDialog's query, so an opened task renders its suggestions from cache. */
export const putawaySuggestKey = (inventoryId: string) =>
  ['putaway-suggest', inventoryId, { inventoryId }] as const;
const PREFETCH_ROWS = 8;

/**
 * Warms the putaway suggestions of the first tasks on the page (one request at a time, after the
 * grid has rendered), so "Put away" opens with its suggested locations already in place.
 */
function usePrefetchSuggestions(rows: readonly PutawayTaskRow[], enabled: boolean): void {
  const qc = useQueryClient();
  const ids = rows
    .filter((r) => !r.blockedReason)
    .slice(0, PREFETCH_ROWS)
    .map((r) => r.id)
    .join(',');
  React.useEffect(() => {
    if (!enabled || !ids) return;
    let cancelled = false;
    const run = async () => {
      for (const id of ids.split(',')) {
        if (cancelled) return;
        await qc
          .prefetchQuery({
            queryKey: putawaySuggestKey(id),
            queryFn: () =>
              apiRequest<SuggestResponse>('/api/putaway/suggest', { query: { inventoryId: id } }),
            staleTime: 30_000,
          })
          .catch(() => undefined);
      }
    };
    const t = window.setTimeout(() => void run(), 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [ids, enabled, qc]);
}

/** Units waiting across every matching task (the list's `meta.units` aggregate), falling back to the visible page. */
function useWaitingUnits(rows: readonly PutawayTaskRow[]): number {
  const qc = useQueryClient();
  const hit = qc
    .getQueriesData<{ data?: unknown; meta?: { units?: unknown } }>({ queryKey: ['grid', PUTAWAY_GRID_KEY] })
    .map(([, value]) => value)
    .find((value) => value?.data === rows);
  return typeof hit?.meta?.units === 'number' ? hit.meta.units : rows.reduce((n, r) => n + r.qty, 0);
}
