"use client";

/**
 * Step 3 — Products: client-scoped search with live ATP (toast per add), Create new
 * product drawer, KPI chips (# SKU / # kits / total qty), find by SKU, Export (edit),
 * the lines table with every spec column (extra columns behind "All columns") and the
 * line ⋯ menu (Show details / Edit / Delete).
 */
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Columns3, Download, Eye, Image as ImageIcon, MoreHorizontal, PackagePlus, Pencil, Search, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiChip } from "@/components/ui/kpi-chip";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { ProductCreateDrawer } from "@/components/products/product-create-drawer";
import type { OrderProductFacts } from "@/server/repositories/orders-wizard";
import { errorMessage } from "../orders-client";
import { LineDrawer } from "./line-drawer";
import { OrderProductSearch } from "./order-product-search";
import { orderTotals, type OrderFormValues, type OrderLineValue } from "./order-form-model";
import { useOrderWizard } from "./order-wizard-context";

export function newLine(f: OrderProductFacts, quantity: number): OrderLineValue {
  return {
    key: `new-${f.id}-${Date.now()}`, id: null, productId: f.id, sku: f.sku, name: f.name, imageUrl: f.imageUrl, isKit: f.isKit, uom: f.uom,
    packType: f.uom, uomRatio: 1, quantity, unitPrice: f.price, weightOz: f.weightOz, atp: f.atp,
    allocatedQuantity: 0, cancelledQuantity: 0, sortedQuantity: 0, pickedQuantity: 0, packedQuantity: 0, shippedQuantity: 0, loadedQuantity: 0,
    lotNumber: "", expiryDate: null, productionDate: null, damageReason: null, pinnedLocationId: null, pinnedLocationCode: null, pinnedLpId: null,
    pinnedLpCode: null, lineNote1: "", lineNote2: "", lineNote3: "", kitSku: null, originalOrderCode: null, storeUpdateNotes: null, isStoreUpdated: false,
  };
}

/** Adds `qty` of a product: merges into an existing unpinned line of the same product. */
export function addToLines(lines: readonly OrderLineValue[], facts: OrderProductFacts, qty: number): OrderLineValue[] {
  const i = lines.findIndex((l) => l.productId === facts.id && !l.lotNumber && !l.pinnedLocationId && !l.pinnedLpId && !l.expiryDate);
  if (i < 0) return [...lines, newLine(facts, qty)];
  return lines.map((l, j) => (j === i ? { ...l, quantity: l.quantity + qty } : l));
}

const EXTRA_COLUMNS: readonly { key: keyof OrderLineValue; label: string; date?: boolean; bool?: boolean }[] = [
  { key: "originalOrderCode", label: "Original SO code" }, { key: "storeUpdateNotes", label: "Store update notes" }, { key: "isStoreUpdated", label: "Is store updated", bool: true },
  { key: "kitSku", label: "Kit SKU" }, { key: "expiryDate", label: "Expiry date", date: true }, { key: "lotNumber", label: "Lot batch number" },
  { key: "damageReason", label: "Damage reason" }, { key: "pinnedLocationCode", label: "Inventory location" }, { key: "pinnedLpCode", label: "Inventory LP" },
  { key: "allocatedQuantity", label: "Allocated UOM qty" }, { key: "cancelledQuantity", label: "Cancelled UOM qty" }, { key: "sortedQuantity", label: "Sorted UOM qty" },
  { key: "pickedQuantity", label: "Picked UOM qty" }, { key: "packedQuantity", label: "Packed UOM qty" }, { key: "shippedQuantity", label: "Shipped UOM qty" },
  { key: "loadedQuantity", label: "Loaded UOM qty" }, { key: "productionDate", label: "Production date", date: true },
  { key: "lineNote1", label: "Line notes 1" }, { key: "lineNote2", label: "Line notes 2" }, { key: "lineNote3", label: "Line notes 3" },
];

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function linesCsv(lines: readonly OrderLineValue[]): string {
  const head = ["SKU", "Name", "Pack type", "UOM ratio", "Quantity", "Price per item", "Total price", ...EXTRA_COLUMNS.map((c) => c.label)];
  const rows = lines.map((l) => [l.sku, l.name, l.packType, l.uomRatio, l.quantity, l.unitPrice.toFixed(2), (l.quantity * l.unitPrice).toFixed(2), ...EXTRA_COLUMNS.map((c) => l[c.key])]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fetchFacts(ids: readonly string[], warehouseId: string): Promise<readonly OrderProductFacts[]> {
  return apiFetch<readonly OrderProductFacts[]>("/api/orders/product-facts", { query: { ids: ids.join(","), warehouseId } });
}

export function StepProducts() {
  const fmt = useFormat();
  const { mode, locks, canCreateProduct } = useOrderWizard();
  const { control, setValue, getValues, formState, clearErrors } = useFormContext<OrderFormValues>();
  const lines = useWatch({ control, name: "lines" }) ?? [];
  const clientId = useWatch({ control, name: "clientId" });
  const warehouseId = useWatch({ control, name: "warehouseId" });
  const code = useWatch({ control, name: "code" });
  const [find, setFind] = React.useState("");
  // Logiwa shows the full line grid (UOM quantities, original SO, kit SKU, lot, expiry, pinning, notes) by default.
  const [allColumns, setAllColumns] = React.useState(true);
  const [drawer, setDrawer] = React.useState<{ line: OrderLineValue; readOnly: boolean } | null>(null);
  const [toDelete, setToDelete] = React.useState<OrderLineValue | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const lineLock = locks.lines ?? locks.header;
  const totals = orderTotals(lines);
  const lineError = (formState.errors.lines as { message?: string; root?: { message?: string } } | undefined);
  const errorText = lineError?.message ?? lineError?.root?.message;
  const visible = find.trim() ? lines.filter((l) => l.sku.toLowerCase().includes(find.trim().toLowerCase()) || l.name.toLowerCase().includes(find.trim().toLowerCase())) : lines;

  const commit = (next: OrderLineValue[]) => {
    setValue("lines", next, { shouldDirty: true, shouldValidate: formState.isSubmitted || Boolean(errorText) });
    // The step-level "Add at least one product" error is set by the wizard, not a resolver: drop it once a line exists.
    if (next.length > 0) clearErrors("lines");
  };

  // Search results already carry the line facts (price, weight, ATP), so adding is immediate.
  const add = (facts: OrderProductFacts, qty: number) => {
    try {
      commit(addToLines(getValues("lines"), facts, qty));
      const over = facts.atp !== null && qty > facts.atp;
      (over ? toast.warning : toast.success)("Product added", over
        ? `${qty} × ${facts.sku} added. Only ${facts.atp} available in this warehouse, so the order may go to Shortage.`
        : `${qty} × ${facts.sku} added to the order.`);
    } catch (error) {
      toast.error("Couldn't add the product", errorMessage(error));
    }
  };

  const noClient = !clientId ? "Choose a client in Step 1 to search its products" : null;

  return (
    <div className="flex flex-col gap-4">
      {lineLock ? <Callout variant="info" title="Lines are locked">{lineLock}</Callout> : null}
      {!lineLock ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-body">Enter SKU and add product (at least 3 characters)</p>
            <DisabledReason reason={noClient ?? (canCreateProduct ? null : "You don't have permission to create products")}>
              <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)} disabled={Boolean(noClient) || !canCreateProduct}>
                <PackagePlus className="h-3.5 w-3.5" aria-hidden />
                Create new product
              </Button>
            </DisabledReason>
          </div>
          {noClient ? <p className="text-xs text-secondary">{noClient}.</p> : (
            <OrderProductSearch clientId={clientId} warehouseId={warehouseId || null} addedIds={lines.map((l) => l.productId)} onAdd={add} />
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <KpiChip label="Number of SKU" value={fmt.quantity(totals.skuCount)} />
        <KpiChip label="Number of kits" value={fmt.quantity(totals.kitCount)} />
        <KpiChip label="Total qty" value={fmt.quantity(totals.totalQuantity)} tone="primary" />
        <div className="ml-auto flex items-center gap-2">
          <TextField size="sm" aria-label="Find by SKU" placeholder="Find SO detail by SKU" value={find} onChange={(e) => setFind(e.target.value)} leading={<Search className="h-3.5 w-3.5" aria-hidden />} onClear={() => setFind("")} wrapperClassName="w-56" />
          <Button variant="ghost" size="sm" aria-pressed={allColumns} onClick={() => setAllColumns((v) => !v)}>
            <Columns3 className="h-3.5 w-3.5" aria-hidden />
            {allColumns ? "Fewer columns" : "All columns"}
          </Button>
          {mode === "edit" ? (
            <DisabledReason reason={lines.length === 0 ? "No lines to export" : null}>
              <Button variant="secondary" size="sm" disabled={lines.length === 0} onClick={() => download(`${code || "order"}-lines.csv`, linesCsv(lines))}>
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export
              </Button>
            </DisabledReason>
          ) : null}
        </div>
      </div>

      {errorText ? <p role="alert" className="text-xs font-medium text-danger" data-field="lines">{errorText}</p> : null}

      {lines.length === 0 ? (
        <EmptyState icon={PackagePlus} title="No product has been added yet" description="Search by SKU above and press + to add products to this order." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">Image</th>
                <th className="whitespace-nowrap px-3 py-2">SKU</th>
                <th className="whitespace-nowrap px-3 py-2">Name</th>
                <th className="whitespace-nowrap px-3 py-2">Pack type</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">UOM ratio</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Quantity</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">ATP</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Price per item</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">Total price</th>
                {allColumns ? EXTRA_COLUMNS.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2">{c.label}</th>) : null}
                <th className="w-16 px-2 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((l) => {
                const short = l.atp !== null && l.atp < l.quantity && l.allocatedQuantity < l.quantity;
                return (
                  <tr key={l.key} className="border-t border-border hover:bg-surface-sunken/60">
                    <td className="px-3 py-1.5">
                      <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-border bg-surface-sunken">
                        {/* eslint-disable-next-line @next/next/no-img-element -- channel CDN images */}
                        {l.imageUrl ? <img src={l.imageUrl} alt="" width={32} height={32} className="h-full w-full object-cover" /> : <ImageIcon className="h-3.5 w-3.5 text-faint" aria-hidden />}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-foreground" title={l.sku}>
                      <button type="button" className="rounded text-left font-semibold text-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={() => setDrawer({ line: l, readOnly: Boolean(lineLock) })} aria-label={`${lineLock ? "Show details for" : "Edit"} ${l.sku}`}>
                        {l.sku}
                      </button>
                      {l.isKit ? <span className="ml-1.5 rounded bg-primary-soft px-1 py-0.5 text-2xs font-semibold text-primary">Kit</span> : null}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-1.5 text-body" title={l.name}>{l.name}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{l.packType}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt.quantity(l.uomRatio)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt.quantity(l.quantity)}</td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums", short ? "font-semibold text-warning" : "text-secondary")} title={short ? "Less stock available than ordered" : undefined}>{l.atp === null ? "—" : fmt.quantity(l.atp)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmt.money(l.unitPrice)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums">{fmt.money(l.quantity * l.unitPrice)}</td>
                    {allColumns ? EXTRA_COLUMNS.map((c) => {
                      const v = l[c.key];
                      return <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-secondary">{v === null || v === "" ? "—" : c.bool ? (v ? "Yes" : "No") : c.date ? fmt.date(v as string) : String(v)}</td>;
                    }) : null}
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {!lineLock ? (
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${l.sku}`} title="Edit pack type, quantity, notes and inventory pinning" onClick={() => setDrawer({ line: l, readOnly: false })}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${l.sku}`}><MoreHorizontal className="h-4 w-4" aria-hidden /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem icon={Eye} onSelect={() => setDrawer({ line: l, readOnly: true })}>Show details</DropdownMenuItem>
                          <DropdownMenuItem icon={Pencil} disabledReason={lineLock} onSelect={() => setDrawer({ line: l, readOnly: false })}>Edit</DropdownMenuItem>
                          <DropdownMenuItem icon={Trash2} destructive disabledReason={lineLock} onSelect={() => setToDelete(l)}>Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr><td colSpan={allColumns ? 10 + EXTRA_COLUMNS.length : 10} className="px-3 py-6 text-center text-secondary">No line matches &ldquo;{find}&rdquo;.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {drawer ? (
        <LineDrawer
          line={drawer.line}
          readOnly={drawer.readOnly || Boolean(lineLock)}
          warehouseId={warehouseId}
          onOpenChange={(o) => !o && setDrawer(null)}
          onApply={(updated) => {
            commit(getValues("lines").map((x) => (x.key === updated.key ? updated : x)));
            setDrawer(null);
            toast.success("Line updated", `${updated.sku} was updated. Save the order to keep the change.`);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title="Remove this product from the order?"
        description={toDelete ? `${toDelete.sku} (${toDelete.quantity} ${toDelete.packType}) will be removed.${mode === "edit" ? " The change is saved when you save the order." : ""}` : ""}
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={() => {
          if (toDelete) commit(getValues("lines").filter((x) => x.key !== toDelete.key));
          setToDelete(null);
        }}
      />
      <ProductCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultClientId={clientId || null}
        onCreated={(p) => {
          setCreateOpen(false);
          // A brand-new product: fetch its facts once, then add it like a search result.
          void fetchFacts([p.id], warehouseId)
            .then(([facts]) => (facts ? add(facts, 1) : toast.error("Couldn't add the product", "Product not found for this client")))
            .catch((error: unknown) => toast.error("Couldn't add the product", errorMessage(error)));
        }}
      />
    </div>
  );
}
