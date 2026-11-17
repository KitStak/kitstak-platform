'use client';

/**
 * Inventory by Location (spec 04 §2). Header: Transfer LP/Loc ▾, Import, Add Inventory.
 * Row ⋯ (Stock rows): Show details / Add / Adjust / Remove / Transfer product.
 * Bulk: Transfer Product and Change Attributes ▾ open on the eligible rows of any selection
 * (skipped rows are listed in the drawer). Row click opens the bucket
 * drawer. Every control is permission-gated: header actions a role can't use are hidden
 * (read-only roles see no selection column); row actions that are blocked say why.
 */
import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRightLeft,
  CalendarClock,
  ChevronDown,
  Factory,
  Plus,
  ShieldAlert,
  Shuffle,
  Tag,
  Upload,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DisabledReason } from '@/components/ui/tooltip';
import { DataGrid, GridToolbar, useGrid, type BulkAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { useCan } from '@/lib/permissions-client';
import {
  BY_LOCATION_DEF,
  BY_LOCATION_EXPORT_COLUMNS,
  BY_LOCATION_GRID_KEY,
} from '@/lib/grid-defs/inventory/by-location';
import { INVENTORY_PERMISSIONS as P } from '@/lib/grid-defs/inventory/permissions';
import { GridStallNotice, useInventoryFilterFields } from './inventory-shared';
import { SearchChip } from './inventory-search-chip';
import { buildBucketColumns } from './by-location-columns';
import {
  countLockReason,
  partitionSelection,
  type AttributeKey,
  type BucketRow,
  type QuantityMode,
  type SelectionPartition,
  type SkippedRow,
} from './by-location-types';
import { QuantityDrawer } from './quantity-drawer';
import { TransferProductDrawer } from './transfer-product-drawer';
import { ChangeAttributesDrawer } from './change-attributes-drawer';
import { AddInventoryDrawer } from './add-inventory-drawer';
import { TransferContainerDrawer, type ContainerKind } from './transfer-container-drawer';
import { BucketDrawer } from './bucket-drawer';
import { InventoryReportsMenu } from './inventory-reports-menu';

const NO_PERMISSION = "You don't have permission for this action";

const ATTRIBUTE_ITEMS: readonly {
  key: AttributeKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'lotNumber', label: 'Change Lot/Batch Number', icon: Tag },
  { key: 'expiryDate', label: 'Change Expiry Date', icon: CalendarClock },
  { key: 'productionDate', label: 'Change Production Date', icon: Factory },
  { key: 'damageReason', label: 'Change Damage Reason', icon: ShieldAlert },
];

function usePermissions() {
  const add = useCanOptimistic(P.addLine);
  const adjust = useCanOptimistic(P.adjustLine);
  const remove = useCanOptimistic(P.removeLine);
  const transfer = useCanOptimistic(P.transferProduct);
  const transferLpLoc = useCanOptimistic(P.transferLpLocation);
  const attributes = useCanOptimistic(P.changeAttributes);
  const importFile = useCanOptimistic(P.importFile);
  const addByAttributes = useCanOptimistic([P.addByAttributes, P.addLine], 'any');
  return { add, adjust, remove, transfer, transferLpLoc, attributes, importFile, addByAttributes };
}

/** Selected rows across pages: remembers every row the grid has shown. */
function useRowCache(rows: readonly BucketRow[]) {
  const cache = React.useRef(new Map<string, BucketRow>());
  for (const r of rows) cache.current.set(r.id, r);
  return React.useCallback(
    (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const r = cache.current.get(id);
        return r ? [r] : [];
      }),
    [],
  );
}

/**
 * Why a bulk action cannot open at all. Ineligible rows in a mixed selection no longer block it:
 * the drawer opens on the eligible rows and lists the skipped ones (partitionSelection).
 */
export function bulkReason(p: SelectionPartition, selectedCount: number): string | null {
  if (selectedCount === 0) return 'Select at least one row';
  if (p.eligible.length > 0) return null;
  const first = p.skipped[0];
  if (!first) return 'Select at least one row';
  if (first.reason === 'status')
    return `Only Stock rows can be changed (${first.row.sku} @ ${first.row.location} is ${first.row.status})`;
  if (first.reason === 'count') return countLockReason(first.row);
  return 'Every unit in the selection is allocated';
}

export function ByLocationPage() {
  const can = usePermissions();
  const fields = useInventoryFilterFields(BY_LOCATION_DEF.fields);
  const g = useGrid<BucketRow>({ gridKey: BY_LOCATION_GRID_KEY, path: '/api/inventory/by-location', fields });
  const rowsFor = useRowCache(g.rows);

  const [details, setDetails] = React.useState<BucketRow | null>(null);
  const [quantity, setQuantity] = React.useState<{ row: BucketRow; mode: QuantityMode } | null>(null);
  const [transfer, setTransfer] = React.useState<{
    rows: readonly BucketRow[];
    skipped: readonly SkippedRow[];
  } | null>(null);
  const [attribute, setAttribute] = React.useState<{
    key: AttributeKey;
    rows: readonly BucketRow[];
    skipped: readonly SkippedRow[];
  } | null>(null);
  const [container, setContainer] = React.useState<ContainerKind | null>(null);
  const [adding, setAdding] = React.useState(false);

  const rowCan = React.useMemo(
    () => ({ add: can.add, adjust: can.adjust, remove: can.remove, transfer: can.transfer }),
    [can.add, can.adjust, can.remove, can.transfer],
  );
  const columns = React.useMemo(
    () =>
      buildBucketColumns({
        onDetails: (r) => setDetails(r),
        onQuantity: (row, mode) => setQuantity({ row, mode }),
        onTransfer: (row) => setTransfer({ rows: [row], skipped: [] }),
        can: rowCan,
      }),
    [rowCan],
  );

  // Every drawer mutation already invalidates ["grid"], so the grid refetches once; an extra
  // g.refetch() here fired a second identical request per save.
  const done = () => undefined;
  const finishBulk = () => {
    g.clearSelection();
  };

  const selected = rowsFor(g.selectedIds);
  const partition = partitionSelection(selected);
  // With nothing selected the action reads disabled at once (no stale enablement after a clear).
  const transferReason = !can.transfer ? NO_PERMISSION : bulkReason(partition, selected.length);
  const bulkActions: readonly BulkAction[] = [
    {
      key: 'transfer-product',
      label: 'Transfer Product',
      icon: Shuffle,
      disabledReason: transferReason,
      onSelect: (ids) => {
        const p = partitionSelection(rowsFor(ids));
        if (p.eligible.length > 0) setTransfer({ rows: p.eligible, skipped: p.skipped });
      },
    },
  ];
  const attrReason = !can.attributes ? NO_PERMISSION : bulkReason(partition, selected.length);

  const attributesMenu = (
    <DropdownMenu>
      <DisabledReason reason={attrReason}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" disabled={attrReason !== null}>
            Change Attributes
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </DisabledReason>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {ATTRIBUTE_ITEMS.map((item) => (
          <DropdownMenuItem
            key={item.key}
            icon={item.icon}
            onSelect={() =>
              setAttribute({ key: item.key, rows: partition.eligible, skipped: partition.skipped })
            }
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Roles without a write permission (viewer) see a read-only page: write actions are hidden,
  // not disabled (Logiwa hides them too), and the selection column only shows when a bulk
  // action is available. The server still refuses every write with 403.
  const canSelect = can.transfer || can.attributes;
  const headerActions = (
    <>
      <InventoryReportsMenu />
      {can.transferLpLoc ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
              Transfer LP/Loc
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem onSelect={() => setContainer('lp')}>Transfer LP</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setContainer('location')}>Transfer Location</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {can.importFile ? (
        <Link href="/imports/inventory" className={buttonVariants({ variant: 'secondary' })}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
        </Link>
      ) : null}
      {can.addByAttributes ? (
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add Inventory
        </Button>
      ) : null}
    </>
  );

  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Inventory by Location" actions={headerActions} tabs="inventory" />
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search SKU, location, LP or barcode"
        bulkActions={can.transfer ? bulkActions : []}
        bulkNoun="row"
        trailing={
          <>
            <SearchChip grid={g.grid} noun="SKU / location / LP" />
            {can.attributes ? attributesMenu : null}
          </>
        }
      />
      <GridStallNotice loading={g.isLoading} onRetry={g.refetch} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<BucketRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.id}
          selectable={canSelect}
          onRowClick={(r) => setDetails(r)}
          exportColumns={BY_LOCATION_EXPORT_COLUMNS}
          emptyTitle={hasState ? 'No inventory matches these filters' : 'No inventory yet'}
          emptyDescription={
            hasState
              ? 'Try Starts With instead of Equal, or clear a filter.'
              : 'Receive a purchase order, import a file or add stock by hand to get started.'
          }
          emptyAction={
            hasState ? undefined : can.addByAttributes ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add Inventory
              </Button>
            ) : undefined
          }
        />
      </div>

      <BucketDrawer
        bucketId={details?.id ?? null}
        initialRow={details}
        onClose={() => setDetails(null)}
        onQuantity={(row, mode) => {
          setDetails(null);
          setQuantity({ row, mode });
        }}
        onTransfer={(row) => {
          setDetails(null);
          setTransfer({ rows: [row], skipped: [] });
        }}
        can={rowCan}
      />
      <QuantityDrawer
        row={quantity?.row ?? null}
        mode={quantity?.mode ?? 'adjust'}
        onClose={() => setQuantity(null)}
        onDone={() => {
          setQuantity(null);
          done();
        }}
      />
      <TransferProductDrawer
        rows={transfer?.rows ?? null}
        skipped={transfer?.skipped ?? []}
        onClose={() => setTransfer(null)}
        onDone={() => {
          setTransfer(null);
          finishBulk();
        }}
      />
      <ChangeAttributesDrawer
        attribute={attribute?.key ?? null}
        rows={attribute?.rows ?? []}
        skipped={attribute?.skipped ?? []}
        onClose={() => setAttribute(null)}
        onDone={() => {
          setAttribute(null);
          finishBulk();
        }}
      />
      <AddInventoryDrawer
        open={adding}
        onClose={() => setAdding(false)}
        onDone={() => {
          setAdding(false);
          done();
        }}
      />
      <TransferContainerDrawer kind={container} onClose={() => setContainer(null)} onDone={done} />
    </div>
  );
}

/**
 * Header/row controls stay enabled while /api/me loads so permitted users never see a
 * greyed-out flash; denied users see the disabled state once permissions resolve. The
 * server enforces every permission regardless.
 */
function useCanOptimistic(...args: Parameters<typeof useCan>): boolean {
  const c = useCan(...args);
  return c.isLoading || c.allowed;
}
