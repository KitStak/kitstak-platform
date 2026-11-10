"use client";

/**
 * Inventory by Location (spec 04 §2). Header: Transfer LP/Loc ▾, Import, Add Inventory.
 * Row ⋯ (Stock rows): Show details / Add / Adjust / Remove / Transfer product.
 * Bulk: Transfer Product (one row) and Change Attributes ▾. Row click opens the bucket
 * drawer. Every control is permission-gated; disabled ones say why.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRightLeft, CalendarClock, ChevronDown, Factory, Plus, ShieldAlert, Shuffle, Tag, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DisabledReason } from "@/components/ui/tooltip";
import { DataGrid, GridToolbar, useGrid, type BulkAction } from "@/components/grid";
import { PageHeader } from "@/components/layout/page-header";
import { useCan } from "@/lib/permissions-client";
import { BY_LOCATION_DEF, BY_LOCATION_EXPORT_COLUMNS, BY_LOCATION_GRID_KEY } from "@/lib/grid-defs/inventory/by-location";
import { INVENTORY_PERMISSIONS as P } from "@/lib/grid-defs/inventory/permissions";
import { useInventoryFilterFields } from "./inventory-shared";
import { buildBucketColumns } from "./by-location-columns";
import { lockedReason, type AttributeKey, type BucketRow, type QuantityMode } from "./by-location-types";
import { QuantityDrawer } from "./quantity-drawer";
import { TransferProductDrawer } from "./transfer-product-drawer";
import { ChangeAttributesDrawer } from "./change-attributes-drawer";
import { AddInventoryDrawer } from "./add-inventory-drawer";
import { TransferContainerDrawer, type ContainerKind } from "./transfer-container-drawer";
import { BucketDrawer } from "./bucket-drawer";

const NO_PERMISSION = "You don't have permission for this action";

const ATTRIBUTE_ITEMS: readonly { key: AttributeKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "lotNumber", label: "Change Lot/Batch Number", icon: Tag },
  { key: "expiryDate", label: "Change Expiry Date", icon: CalendarClock },
  { key: "productionDate", label: "Change Production Date", icon: Factory },
  { key: "damageReason", label: "Change Damage Reason", icon: ShieldAlert },
];

function usePermissions() {
  const add = useCan(P.addLine).allowed;
  const adjust = useCan(P.adjustLine).allowed;
  const remove = useCan(P.removeLine).allowed;
  const transfer = useCan(P.transferProduct).allowed;
  const transferLpLoc = useCan(P.transferLpLocation).allowed;
  const attributes = useCan(P.changeAttributes).allowed;
  const importFile = useCan(P.importFile).allowed;
  const addByAttributes = useCan([P.addByAttributes, P.addLine], "any").allowed;
  return { add, adjust, remove, transfer, transferLpLoc, attributes, importFile, addByAttributes };
}

/** Selected rows across pages: remembers every row the grid has shown. */
function useRowCache(rows: readonly BucketRow[]) {
  const cache = React.useRef(new Map<string, BucketRow>());
  for (const r of rows) cache.current.set(r.id, r);
  return React.useCallback((ids: readonly string[]) => ids.flatMap((id) => {
    const r = cache.current.get(id);
    return r ? [r] : [];
  }), []);
}

export function selectionReason(rows: readonly BucketRow[], expected: number, kind: "transfer" | "attributes"): string | null {
  if (rows.length < expected) return "Select at least one row";
  if (kind === "transfer" && rows.length > 1) return "Transfer Product works on one row at a time";
  const locked = rows.find((r) => lockedReason(r));
  if (locked) return `Only Stock rows can be changed (${locked.sku} @ ${locked.location} is ${locked.status})`;
  if (rows.every((r) => r.freeQty <= 0)) return "Every unit in the selection is allocated";
  return null;
}

export function ByLocationPage() {
  const can = usePermissions();
  const fields = useInventoryFilterFields(BY_LOCATION_DEF.fields);
  const g = useGrid<BucketRow>({ gridKey: BY_LOCATION_GRID_KEY, path: "/api/inventory/by-location", fields });
  const rowsFor = useRowCache(g.rows);

  const [details, setDetails] = React.useState<string | null>(null);
  const [quantity, setQuantity] = React.useState<{ row: BucketRow; mode: QuantityMode } | null>(null);
  const [transfer, setTransfer] = React.useState<BucketRow | null>(null);
  const [attribute, setAttribute] = React.useState<{ key: AttributeKey; rows: readonly BucketRow[] } | null>(null);
  const [container, setContainer] = React.useState<ContainerKind | null>(null);
  const [adding, setAdding] = React.useState(false);

  const rowCan = React.useMemo(() => ({ add: can.add, adjust: can.adjust, remove: can.remove, transfer: can.transfer }), [can.add, can.adjust, can.remove, can.transfer]);
  const columns = React.useMemo(() => buildBucketColumns({
    onDetails: (r) => setDetails(r.id),
    onQuantity: (row, mode) => setQuantity({ row, mode }),
    onTransfer: (row) => setTransfer(row),
    can: rowCan,
  }), [rowCan]);

  const done = () => {
    g.refetch();
  };
  const finishBulk = () => {
    g.clearSelection();
    g.refetch();
  };

  const selected = rowsFor(g.selectedIds);
  const transferReason = !can.transfer ? NO_PERMISSION : g.selectedIds.length === 0 ? null : selectionReason(selected, 1, "transfer");
  const bulkActions: readonly BulkAction[] = [
    {
      key: "transfer-product", label: "Transfer Product", icon: Shuffle,
      disabledReason: transferReason,
      onSelect: (ids) => {
        const [row] = rowsFor(ids);
        if (row) setTransfer(row);
      },
    },
  ];
  const attrReason = !can.attributes ? NO_PERMISSION : g.selectedIds.length === 0 ? "Select at least one row" : selectionReason(selected, 1, "attributes");

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
          <DropdownMenuItem key={item.key} icon={item.icon} onSelect={() => setAttribute({ key: item.key, rows: selected.filter((r) => !lockedReason(r) && r.freeQty > 0) })}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const headerActions = (
    <>
      <DropdownMenu>
        <DisabledReason reason={can.transferLpLoc ? null : NO_PERMISSION}>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" disabled={!can.transferLpLoc}>
              <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
              Transfer LP/Loc
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </DisabledReason>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuItem onSelect={() => setContainer("lp")}>Transfer LP</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setContainer("location")}>Transfer Location</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {can.importFile ? (
        <Link href="/imports/inventory" className={buttonVariants({ variant: "secondary" })}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Import
        </Link>
      ) : (
        <DisabledReason reason={NO_PERMISSION}><Button variant="secondary" disabled><Upload className="h-3.5 w-3.5" aria-hidden />Import</Button></DisabledReason>
      )}
      <DisabledReason reason={can.addByAttributes ? null : NO_PERMISSION}>
        <Button variant="primary" disabled={!can.addByAttributes} onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add Inventory
        </Button>
      </DisabledReason>
    </>
  );

  const hasState = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader title="Inventory" helper="You can see and manage your inventory level." actions={headerActions} tabs="inventory" />
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search SKU, location, LP or barcode" bulkActions={bulkActions} bulkNoun="row" trailing={attributesMenu} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<BucketRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(r) => r.id}
          onRowClick={(r) => setDetails(r.id)}
          exportColumns={BY_LOCATION_EXPORT_COLUMNS}
          emptyTitle={hasState ? "No inventory matches these filters" : "No inventory yet"}
          emptyDescription={hasState ? "Try Starts With instead of Equal, or clear a filter." : "Receive a purchase order, import a file or add stock by hand to get started."}
          emptyAction={hasState ? undefined : can.addByAttributes ? <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" aria-hidden />Add Inventory</Button> : undefined}
        />
      </div>

      <BucketDrawer
        bucketId={details}
        onClose={() => setDetails(null)}
        onQuantity={(row, mode) => { setDetails(null); setQuantity({ row, mode }); }}
        onTransfer={(row) => { setDetails(null); setTransfer(row); }}
        can={rowCan}
      />
      <QuantityDrawer row={quantity?.row ?? null} mode={quantity?.mode ?? "adjust"} onClose={() => setQuantity(null)} onDone={() => { setQuantity(null); done(); }} />
      <TransferProductDrawer row={transfer} onClose={() => setTransfer(null)} onDone={() => { setTransfer(null); finishBulk(); }} />
      <ChangeAttributesDrawer attribute={attribute?.key ?? null} rows={attribute?.rows ?? []} onClose={() => setAttribute(null)} onDone={() => { setAttribute(null); finishBulk(); }} />
      <AddInventoryDrawer open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); done(); }} />
      <TransferContainerDrawer kind={container} onClose={() => setContainer(null)} onDone={done} />
    </div>
  );
}
