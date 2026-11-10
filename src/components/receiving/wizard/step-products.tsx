"use client";

/**
 * Step 2 — Products. Client-scoped product search (3+ characters) with a qty stepper; + opens
 * the Edit Product drawer. Create New Product opens M09's drawer. The lines grid shows the
 * 17 Logiwa columns with # SKU / Total qty chips, Find by SKU and Label (selected lines).
 */
import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Box, Eye, MoreHorizontal, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";
import { ProductCreateDrawer } from "@/components/products/product-create-drawer";
import { PrintOptionsModal } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { errorMessage, ProductThumb, type ProductInfo, useCan } from "../receiving-shared";
import { LineEditorDrawer } from "./line-editor-drawer";
import { PoProductSearch } from "./po-product-search";
import { linesQty, newLineKey, skuCount, type LineDraft, type PoFormValues } from "./po-form-model";

export async function fetchProductInfo(id: string): Promise<ProductInfo | null> {
  const { data } = await apiRequest<ProductInfo[]>("/api/purchase-orders/products", { query: { ids: id } });
  return data[0] ?? null;
}

export function draftFromProduct(p: ProductInfo, quantity: number): LineDraft {
  return {
    key: newLineKey(), productId: p.id, sku: p.sku, productName: p.name, barcode: p.barcode, imageUrl: p.imageUrl, uom: p.uom,
    packTypes: p.packTypes, tracking: p.tracking, packType: p.uom, orderedQuantity: quantity, unitCost: p.purchasePrice ?? 0, receivedQuantity: 0,
    receivingLocationId: null, receivingLocationCode: null, lotNumber: null, expiryDate: null, productionDate: null, lpTypeId: null, lpTypeCode: null, lpNumber: null, note: null,
  };
}

const ratioOf = (l: LineDraft): number => l.packTypes.find((p) => p.packType === l.packType)?.uomQty ?? 1;

export function Chip({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px]">
      <span className="text-faint">{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

const TH = "whitespace-nowrap border-b border-border bg-surface-sunken px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint";
const TD = "whitespace-nowrap border-b border-border px-2.5 py-2 text-[12px] text-body";

export function PoLinesTable({ lines, selected, onToggle, onToggleAll, onShow, onEdit, onRemove, readOnly }: {
  readonly lines: readonly LineDraft[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly onToggleAll: (all: boolean) => void;
  readonly onShow: (l: LineDraft) => void;
  readonly onEdit: (l: LineDraft) => void;
  readonly onRemove: (l: LineDraft) => void;
  readonly readOnly: boolean;
}) {
  const fmt = useFormat();
  const all = lines.length > 0 && lines.every((l) => selected.has(l.key));
  const dash = <span className="text-faint">—</span>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border ks-scroll">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-9`}><Checkbox checked={all} onCheckedChange={(v) => onToggleAll(Boolean(v))} aria-label="Select all lines" /></th>
            {["Image", "SKU", "Product description", "Quantity", "Price per item", "Total price", "Receiving location", "Lot batch number", "Received qty", "Pack type", "UOM pack type", "UOM quantity", "Expiry date", "LP type", "LP number", "Production date"].map((h) => (
              <th key={h} scope="col" className={`${TH} ${["Quantity", "Price per item", "Total price", "Received qty", "UOM quantity"].includes(h) ? "text-right" : ""}`}>{h}</th>
            ))}
            <th className={`${TH} w-10`}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="hover:bg-surface-sunken/60" data-selected={selected.has(l.key) || undefined}>
              <td className={TD}><Checkbox checked={selected.has(l.key)} onCheckedChange={() => onToggle(l.key)} aria-label={`Select ${l.sku}`} /></td>
              <td className={TD}><ProductThumb url={l.imageUrl} label={l.sku} size={28} /></td>
              <td className={`${TD} font-semibold text-foreground`}>
                <button type="button" className="hover:text-primary hover:underline" onClick={() => onShow(l)}>{l.sku}</button>
              </td>
              <td className={`${TD} max-w-[220px] truncate`} title={l.productName}>{l.productName}</td>
              <td className={`${TD} text-right tabular-nums`}>{l.orderedQuantity.toLocaleString()}</td>
              <td className={`${TD} text-right tabular-nums`}>{fmt.money(l.unitCost)}</td>
              <td className={`${TD} text-right font-semibold tabular-nums text-foreground`}>{fmt.money(Math.round(l.orderedQuantity * l.unitCost * 100) / 100)}</td>
              <td className={TD}>{l.receivingLocationCode ?? dash}</td>
              <td className={TD}>{l.lotNumber ?? dash}</td>
              <td className={`${TD} text-right tabular-nums`}>{l.receivedQuantity.toLocaleString()}</td>
              <td className={TD}>{l.packType}</td>
              <td className={TD}>{l.uom}</td>
              <td className={`${TD} text-right tabular-nums`}>{(l.orderedQuantity * ratioOf(l)).toLocaleString()}</td>
              <td className={TD}>{l.expiryDate ? fmt.date(l.expiryDate) : dash}</td>
              <td className={TD}>{l.lpTypeCode ?? dash}</td>
              <td className={TD}>{l.lpNumber ?? dash}</td>
              <td className={TD}>{l.productionDate ? fmt.date(l.productionDate) : dash}</td>
              <td className={TD}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${l.sku}`}><MoreHorizontal className="h-4 w-4" aria-hidden /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem icon={Eye} onSelect={() => onShow(l)}>Show details</DropdownMenuItem>
                    <DropdownMenuItem icon={Pencil} disabledReason={readOnly ? "This purchase order can't be changed." : null} onSelect={() => onEdit(l)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem icon={Trash2} destructive disabledReason={readOnly ? "This purchase order can't be changed." : l.receivedQuantity > 0 ? "A line with received quantity can't be removed. Cancel its receipts first." : null} onSelect={() => onRemove(l)}>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StepProducts({ form, readOnly }: { readonly form: UseFormReturn<PoFormValues>; readonly readOnly: boolean }) {
  const fmt = useFormat();
  const lines = useWatch({ control: form.control, name: "lines" });
  const clientId = useWatch({ control: form.control, name: "clientId" });
  const warehouseId = useWatch({ control: form.control, name: "warehouseId" });
  const canCreateProduct = useCan("inventory.purchase_orders.create_new_product").allowed;
  const [editing, setEditing] = React.useState<{ line: LineDraft; isNew: boolean; readOnly: boolean } | null>(null);
  const [find, setFind] = React.useState("");
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [createOpen, setCreateOpen] = React.useState(false);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const linesError = form.formState.errors.lines?.message ?? form.formState.errors.lines?.root?.message;

  const shown = find.trim() ? lines.filter((l) => l.sku.toLowerCase().includes(find.trim().toLowerCase())) : lines;
  const setLines = (next: LineDraft[]) => form.setValue("lines", next, { shouldDirty: true, shouldValidate: true });

  const openNew = async (productId: string, qty: number) => {
    try {
      const info = await fetchProductInfo(productId);
      if (!info) throw new Error("This product isn't available for the client.");
      setEditing({ line: draftFromProduct(info, qty), isNew: true, readOnly: false });
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
  };

  const apply = (line: LineDraft) => {
    const exists = lines.some((l) => l.key === line.key);
    setLines(exists ? lines.map((l) => (l.key === line.key ? line : l)) : [...lines, line]);
    setEditing(null);
    toast.success("Success", exists ? `${line.sku} updated.` : `${line.sku} added to the purchase order.`);
  };

  const remove = (line: LineDraft) => {
    setLines(lines.filter((l) => l.key !== line.key));
    setSelected((s) => new Set([...s].filter((k) => k !== line.key)));
  };

  const printLabels = () => {
    const records = lines.filter((l) => selected.has(l.key)).flatMap((l) =>
      Array.from({ length: Math.min(l.orderedQuantity, 500) }, () => ({ sku: l.sku, barcode: l.barcode || l.sku, name: l.productName, packType: l.packType, ...(l.lotNumber ? { lotNumber: l.lotNumber } : {}) })));
    setLabels(records);
  };

  if (!clientId) {
    return <Callout variant="attention" title="Choose a client first">Products are searched within the client of the purchase order. Go back to PO details and choose one.</Callout>;
  }

  return (
    <div className="flex flex-col gap-4">
      {readOnly ? null : (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-body">Enter SKU and add product (at least 3 characters)</p>
            <DisabledReason reason={canCreateProduct ? null : "You don't have permission to create products"}>
              <Button variant="secondary" size="sm" disabled={!canCreateProduct} onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create new product
              </Button>
            </DisabledReason>
          </div>
          <PoProductSearch clientId={clientId} warehouseId={warehouseId || null} addedIds={lines.map((l) => l.productId)} onAdd={(p, qty) => void openNew(p.id, qty)} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full max-w-[260px]">
          <TextField size="sm" value={find} onChange={(e) => setFind(e.target.value)} onClear={() => setFind("")} placeholder="Find PO detail by SKU" leading={<Search className="h-3.5 w-3.5 text-faint" aria-hidden />} aria-label="Find PO detail by SKU" />
        </div>
        <DisabledReason reason={selected.size === 0 ? "Select at least one line" : null}>
          <Button variant="secondary" size="sm" disabled={selected.size === 0} onClick={printLabels}>
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Label
          </Button>
        </DisabledReason>
        <span className="flex-1" />
        <Chip label="Number of SKU" value={skuCount(lines)} />
        <Chip label="Total qty" value={linesQty(lines).toLocaleString()} />
        <Chip label="Price" value={fmt.money(lines.reduce((s, l) => s + l.orderedQuantity * l.unitCost, 0))} />
      </div>

      {lines.length === 0 ? (
        <EmptyState
          compact
          icon={Box}
          title="No product has been added yet."
          description="Search a SKU above and press + to add it, or create a new product."
          action={canCreateProduct && !readOnly ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" aria-hidden />Create product</Button> : undefined}
        />
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-secondary">No line matches “{find}”.</p>
      ) : (
        <PoLinesTable
          lines={shown}
          selected={selected}
          readOnly={readOnly}
          onToggle={(key) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
          onToggleAll={(on) => setSelected(on ? new Set(shown.map((l) => l.key)) : new Set())}
          onShow={(l) => setEditing({ line: l, isNew: false, readOnly: true })}
          onEdit={(l) => setEditing({ line: l, isNew: false, readOnly: false })}
          onRemove={remove}
        />
      )}
      {linesError ? <p role="alert" className="text-[12px] font-medium text-danger">{linesError}</p> : null}

      <LineEditorDrawer line={editing?.line ?? null} isNew={editing?.isNew} readOnly={editing?.readOnly} warehouseId={warehouseId} onOpenChange={(open) => !open && setEditing(null)} onApply={apply} />
      <ProductCreateDrawer open={createOpen} onOpenChange={setCreateOpen} defaultClientId={clientId} onCreated={(p) => { setCreateOpen(false); void openNew(p.id, 1); }} />
      <PrintOptionsModal open={labels !== null} onOpenChange={(open) => !open && setLabels(null)} typeKeys={["product-label"]} records={labels ?? []} clientId={clientId} title="Print product labels" />
    </div>
  );
}
