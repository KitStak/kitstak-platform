"use client";

/**
 * Link Product drawer (Product Listings; live Logiwa capture §6). Three tabs:
 *   - Search & select: the listing client's products by SKU / name / barcode (prefix), keyboard navigable.
 *   - Create new: quick product form prefilled from the listing (SKU = seller SKU). The server
 *     creates it through the full product validation, links it and applies Never Sync atomically.
 *   - Suggested: the SKU match, with Match / Don't match. Disabled when there is no suggestion.
 * "Initial quantity" (optional, Logiwa parity) needs a warehouse + location; after the product is
 * created it is booked through the inventory ledger (`POST /api/inventory/add`), never silently.
 */
import * as React from "react";
import type { LinkSearchOption } from "@/server/repositories/products-options";
import { Check, Link2, PackagePlus, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Drawer } from "@/components/ui/drawer";
import { FieldLabel } from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";
import { isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { DestinationSinglePicker } from "@/components/inventory/destination-picker";
import { InventoryWarehouseSelect } from "@/components/inventory/inventory-form-kit";
import { useInventoryReasons } from "@/components/inventory/inventory-shared";
import { WEIGHT_UNITS } from "@/lib/grid-defs/products/catalog-options";
import { DESCRIPTION_MAX, NAME_MAX, SKU_MAX } from "@/lib/grid-defs/products/product-form";
import { listingQuickProductSchema, quickProductDefaults, type ListingQuickProductInput } from "@/lib/grid-defs/products/listing-quick-product";
import type { WizardOptions } from "@/server/repositories/products-options";
import { errorMessage, ProductThumb, type ListingRow } from "./catalog-shared";

const DEBOUNCE_MS = 250;

export type LinkDrawerTab = "search" | "create" | "suggested";

export interface ListingLinkDrawerProps {
  readonly listing: ListingRow;
  readonly initialTab?: LinkDrawerTab;
  readonly canCreate: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Link to an existing product. Throws (after toasting) on failure. */
  readonly onLink: (productId: string) => Promise<void>;
  /** Create the quick product and link it. Throws an ApiError on validation failure. */
  readonly onCreate: (values: ListingQuickProductInput, initial: InitialQuantity | null) => Promise<void>;
  readonly onReject: () => Promise<void>;
}

type FieldErrors = Partial<Record<string, string>>;

/** Optional stock booked right after Create (inventory-ledger adjustment). */
export interface InitialQuantity { readonly warehouseId: string; readonly locationId: string; readonly qty: number; readonly reasonId: string | null }
export interface InitialDraft { warehouseId: string | null; locationId: string | null; qty: number | null; reasonId?: string | null }
const EMPTY_INITIAL: InitialDraft = { warehouseId: null, locationId: null, qty: null, reasonId: null };

/**
 * Pure: qty empty/0 means "no initial stock"; otherwise warehouse and location are required,
 * plus an adjustment reason when the warehouse's settings require one.
 */
export function initialQuantityErrors(d: InitialDraft, reasonRequired = false): FieldErrors {
  if (d.qty === null || d.qty === 0) return {};
  const e: FieldErrors = {};
  if (d.qty < 0 || !Number.isInteger(d.qty)) e.initialQty = "Enter a whole number of 1 or more";
  if (!d.warehouseId) e.initialWarehouse = "Select a warehouse";
  if (!d.locationId) e.initialLocation = "Select a location";
  if (reasonRequired && d.warehouseId && !d.reasonId) e.initialReason = "This warehouse requires an adjustment reason";
  return e;
}

/** Quick-form field → input id (for focusing the first error). */
const FIELD_IDS: Readonly<Record<string, string>> = {
  sku: "qp-sku", name: "qp-name", description: "qp-desc", imageUrl: "qp-image", uom: "qp-uom", weight: "qp-weight", salesPrice: "qp-sales",
  purchasePrice: "qp-purchase", taxRate: "qp-tax", barcode: "qp-barcode", packTypes: "qp-barcode", productTypeId: "qp-type", productGroupId: "qp-group",
};

function focusField(field: string | undefined): void {
  const id = field ? FIELD_IDS[field] : undefined;
  if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function Field({ label, required, error, children, htmlFor, hint }: { readonly label: string; readonly required?: boolean; readonly error?: string; readonly children: React.ReactNode; readonly htmlFor: string; readonly hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldLabel htmlFor={htmlFor} required={required}>{label}</FieldLabel>
      {children}
      {error ? <p id={`${htmlFor}-error`} className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-2xs text-faint">{hint}</p> : null}
    </div>
  );
}

function SearchTab({ listing, picked, setPicked, onSubmit }: { readonly listing: ListingRow; readonly picked: string | null; readonly setPicked: (id: string) => void; readonly onSubmit: () => void }) {
  const [text, setText] = React.useState(listing.sellerSku);
  const [term, setTerm] = React.useState(listing.sellerSku);
  const [active, setActive] = React.useState(0);
  React.useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const res = useApiQuery<LinkSearchOption[]>(["listing-link-search", listing.clientId, term], "/api/products/link-search", { query: { clientId: listing.clientId, q: term } });
  const rows = React.useMemo(() => res.data?.data ?? [], [res.data]);
  const listRef = React.useRef<HTMLUListElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      const id = rows[next]?.id;
      if (id) setPicked(id);
      listRef.current?.querySelectorAll("[role=option]")[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = rows[active]?.id;
      if (id && picked === id) onSubmit();
      else if (id) setPicked(id);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <TextField
        type="search"
        id="listing-link-search"
        autoFocus
        value={text}
        onChange={(e) => { setText(e.target.value); setActive(0); }}
        onKeyDown={onKeyDown}
        leading={<Search className="h-3.5 w-3.5" aria-hidden />}
        placeholder="Search product name, SKU or barcode"
        aria-label="Search product name, SKU or barcode"
        aria-controls="listing-link-results"
      />
      <p className="text-2xs text-faint">Matches {listing.clientName} product names, SKUs and barcodes; best matches first. ↑ ↓ to move, Enter to select, Enter again to link.</p>
      <div className="min-h-[200px] rounded-md border border-border">
        {res.isPending ? (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-secondary"><Spinner className="h-3.5 w-3.5" label="Searching" />Searching…</div>
        ) : res.isError ? (
          <p className="px-3 py-4 text-center text-xs text-danger">Search failed. {errorMessage(res.error)}</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-faint">No {listing.clientName} product name, SKU or barcode contains &ldquo;{term}&rdquo;. Change the search or use Create new.</p>
        ) : (
          <ul ref={listRef} id="listing-link-results" role="listbox" aria-label="Products" className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={r.id}>
                <button type="button" role="option" aria-selected={picked === r.id} tabIndex={-1}
                  onClick={() => { setPicked(r.id); setActive(i); }} onDoubleClick={() => { setPicked(r.id); onSubmit(); }}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-sunken",
                    picked === r.id && "bg-primary-soft/60", i === active && "outline outline-1 -outline-offset-1 outline-primary/40")}>
                  <ProductThumb url={r.imageUrl} size={30} label={r.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm font-semibold text-foreground">{r.sku}</span>
                    <span className="block truncate text-xs text-secondary">{r.name}</span>
                  </span>
                  <span className={cn("text-2xs", r.status === "Active" ? "text-success" : "text-faint")}>{r.status}</span>
                  {picked === r.id ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {res.data && rows.length >= 50 ? <p className="text-2xs text-faint">Showing the first 50 matches. Type more of the name or SKU to narrow the list.</p> : null}
    </div>
  );
}

function CreateTab({ listing, values, setValues, errors, initial, setInitial }: { readonly listing: ListingRow; readonly values: ListingQuickProductInput; readonly setValues: React.Dispatch<React.SetStateAction<ListingQuickProductInput>>; readonly errors: FieldErrors; readonly initial: InitialDraft; readonly setInitial: React.Dispatch<React.SetStateAction<InitialDraft>> }) {
  const reasons = useInventoryReasons();
  const reasonRequired = initial.warehouseId ? reasons?.mandatoryReason[initial.warehouseId] ?? true : false;
  // Initial stock is always an increase: decrease-only reasons are not offered.
  const reasonOptions = (reasons?.adjustmentReasons ?? []).filter((r) => (r as { direction?: string }).direction !== "decrease").map((r) => ({ value: r.id, label: r.name }));
  const q = useApiQuery<WizardOptions>(["product-wizard-options", listing.clientId], "/api/products/options", { query: { for: "wizard", clientId: listing.clientId }, staleTime: 30_000 });
  const opts = q.data?.data;
  const set = <K extends keyof ListingQuickProductInput>(key: K, value: ListingQuickProductInput[K]) => setValues((v) => ({ ...v, [key]: value }));
  const err = (k: string) => errors[k];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);
  return (
    <div className="flex flex-col gap-3.5">
      <Field label="Client" htmlFor="qp-client">
        <TextField id="qp-client" value={listing.clientName} readOnly disabled aria-readonly />
      </Field>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="SKU" required htmlFor="qp-sku" error={err("sku")}>
          <TextField id="qp-sku" value={str(values.sku)} maxLength={SKU_MAX} invalid={Boolean(err("sku"))} aria-describedby={err("sku") ? "qp-sku-error" : undefined} onChange={(e) => set("sku", e.target.value)} />
        </Field>
        <Field label="UOM pack type" required htmlFor="qp-uom" error={err("uom")}>
          <Select id="qp-uom" value={str(values.uom) || null} onChange={(v) => set("uom", v ?? "Unit")}
            options={(opts?.packTypes.length ? opts.packTypes : [{ value: "Unit", label: "Unit" }]).map((o) => ({ value: o.value, label: o.label }))} />
        </Field>
      </div>
      <Field label="Name" required htmlFor="qp-name" error={err("name")}>
        <TextField id="qp-name" value={str(values.name)} maxLength={NAME_MAX} invalid={Boolean(err("name"))} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="qp-desc" error={err("description")}>
        <Textarea id="qp-desc" rows={3} value={str(values.description)} maxLength={DESCRIPTION_MAX} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <Field label="Product image URL" htmlFor="qp-image" error={err("imageUrl")}>
        <div className="flex items-center gap-2">
          <ProductThumb url={str(values.imageUrl) || null} size={32} label="Preview" />
          <TextField id="qp-image" value={str(values.imageUrl)} placeholder="https://…" invalid={Boolean(err("imageUrl"))} onChange={(e) => set("imageUrl", e.target.value)} />
        </div>
      </Field>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Weight" htmlFor="qp-weight" error={err("weight")}>
          <NumberInput id="qp-weight" value={numOrNull(values.weight)} decimals={3} min={0} max={100_000} onChange={(v) => set("weight", v)} />
        </Field>
        <Field label="Weight unit" htmlFor="qp-wu">
          <Select id="qp-wu" value={(values.weightUnit as string | undefined) ?? "Pound"} onChange={(v) => set("weightUnit", (v ?? "Pound") as ListingQuickProductInput["weightUnit"])}
            options={WEIGHT_UNITS.map((u) => ({ value: u, label: u }))} />
        </Field>
        <Field label="Sales price" htmlFor="qp-sales" error={err("salesPrice")}>
          <NumberInput id="qp-sales" value={numOrNull(values.salesPrice)} decimals={2} min={0} onChange={(v) => set("salesPrice", v)} />
        </Field>
        <Field label="Purchase price" htmlFor="qp-purchase" error={err("purchasePrice")}>
          <NumberInput id="qp-purchase" value={numOrNull(values.purchasePrice)} decimals={2} min={0} onChange={(v) => set("purchasePrice", v)} />
        </Field>
        <Field label="Tax rate %" htmlFor="qp-tax" error={err("taxRate")}>
          <NumberInput id="qp-tax" value={numOrNull(values.taxRate)} decimals={2} min={0} max={100} onChange={(v) => set("taxRate", v)} />
        </Field>
        <Field label="Barcode" htmlFor="qp-barcode" error={err("barcode") ?? err("packTypes")}>
          <TextField id="qp-barcode" value={str(values.barcode)} maxLength={100} onChange={(e) => set("barcode", e.target.value)} placeholder="Defaults to the SKU" />
        </Field>
        <Field label="Product type" htmlFor="qp-type" error={err("productTypeId")}>
          <Select id="qp-type" clearable placeholder={opts?.productTypes.length ? "Select product type" : "No product types"} value={(values.productTypeId as string | null) ?? null}
            onChange={(v) => set("productTypeId", v)} options={(opts?.productTypes ?? []).map((o) => ({ value: o.value, label: o.label }))} />
        </Field>
        <Field label="Product group" htmlFor="qp-group" error={err("productGroupId")}>
          <Select id="qp-group" clearable placeholder={opts?.productGroups.length ? "Select product group" : "No product groups"} value={(values.productGroupId as string | null) ?? null}
            onChange={(v) => set("productGroupId", v)} options={(opts?.productGroups ?? []).map((o) => ({ value: o.value, label: o.label }))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-sunken/40 p-3 sm:grid-cols-4">
        {([["isActive", "Active?"], ["neverSync", "Never sync"], ["isFragile", "Fragile"], ["isOversized", "Oversized"]] as const).map(([key, label]) => (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-secondary" id={`qp-${key}-label`}>{label}</span>
            <YesNoToggle value={Boolean(values[key])} onChange={(v) => set(key, v)} ariaLabel={label} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="initial-quantity">
        <div>
          <p className="text-sm font-semibold text-body">Initial quantity <span className="font-normal text-faint">(optional)</span></p>
          <p className="text-2xs text-faint">Booked as an inventory adjustment at the location you pick, so it shows in the product&apos;s Transactions. Leave empty to add stock later.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="qp-init-qty">Quantity ({str(values.uom) || "Unit"})</FieldLabel>
            <NumberInput id="qp-init-qty" value={initial.qty} decimals={0} invalid={Boolean(errors.initialQty)} onChange={(v) => setInitial((d) => ({ ...d, qty: v }))} />
            {errors.initialQty ? <p className="text-2xs text-danger">{errors.initialQty}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="qp-init-wh">Warehouse</FieldLabel>
            <InventoryWarehouseSelect id="qp-init-wh" value={initial.warehouseId} invalid={Boolean(errors.initialWarehouse)} onChange={(v) => setInitial((d) => ({ ...d, warehouseId: v, locationId: null }))} />
            {errors.initialWarehouse ? <p className="text-2xs text-danger">{errors.initialWarehouse}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="qp-init-loc">Location</FieldLabel>
            <DestinationSinglePicker kind="location" id="qp-init-loc" warehouseId={initial.warehouseId} disabled={!initial.warehouseId} placeholder={initial.warehouseId ? "Search location" : "Select a warehouse first"} invalid={Boolean(errors.initialLocation)} value={initial.locationId} onChange={(v) => setInitial((d) => ({ ...d, locationId: v }))} />
            {errors.initialLocation ? <p className="text-2xs text-danger">{errors.initialLocation}</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="qp-init-reason">Adjustment reason{reasonRequired ? <span className="text-danger"> *</span> : null}</FieldLabel>
            <Select id="qp-init-reason" clearable={!reasonRequired} disabled={!initial.warehouseId} invalid={Boolean(errors.initialReason)} placeholder={reasonOptions.length ? "Select reason" : "No adjustment reasons"} value={initial.reasonId ?? null}
              onChange={(v) => setInitial((d) => ({ ...d, reasonId: v ?? null }))} options={reasonOptions} />
            {errors.initialReason ? <p className="text-2xs text-danger">{errors.initialReason}</p> : null}
          </div>
        </div>
      </div>
      <p className="text-2xs text-faint">Never sync applies to this listing: KitStaks won&apos;t push inventory to {listing.storeName} for it. Add dimensions, pack types and tracking later from the product&apos;s Edit.</p>
    </div>
  );
}

function SuggestedTab({ listing }: { readonly listing: ListingRow }) {
  if (!listing.suggestedProductId) return <p className="text-xs text-faint">There is no suggestion for this listing.</p>;
  return (
    <div className="flex flex-col gap-3">
      <Callout variant="info" title="Suggested by SKU">The seller SKU {listing.sellerSku} matches a {listing.clientName} product SKU. Match to link them, or Don&apos;t match to hide this suggestion.</Callout>
      <div className="flex gap-3 rounded-lg border border-border p-3">
        <ProductThumb url={listing.suggestedProductImageUrl} size={56} label={listing.suggestedProductName ?? ""} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-base font-semibold text-foreground">{listing.suggestedProductSku}</p>
          <p className="truncate text-sm text-body">{listing.suggestedProductName}</p>
          <p className="mt-1 line-clamp-3 text-xs text-secondary">{listing.suggestedProductDescription || "No description"}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-md bg-surface-sunken/60 p-2.5"><p className="text-faint">Listing</p><p className="truncate font-medium text-body">{listing.name}</p><p className="font-mono text-secondary">{listing.sellerSku}</p></div>
        <div className="rounded-md bg-surface-sunken/60 p-2.5"><p className="text-faint">Store</p><p className="truncate font-medium text-body">{listing.storeName}</p><p className="text-secondary">{listing.provider}</p></div>
      </div>
    </div>
  );
}

export function ListingLinkDrawer({ listing, initialTab, canCreate, onOpenChange, onLink, onCreate, onReject }: ListingLinkDrawerProps) {
  const hasSuggestion = Boolean(listing.suggestedProductId);
  const [tab, setTab] = React.useState<LinkDrawerTab>(initialTab ?? (hasSuggestion ? "suggested" : "search"));
  const [picked, setPicked] = React.useState<string | null>(listing.productId ?? listing.suggestedProductId);
  const initialValues = React.useMemo(() => quickProductDefaults(listing), [listing]);
  const [values, setValues] = React.useState<ListingQuickProductInput>(initialValues);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [initial, setInitial] = React.useState<InitialDraft>(EMPTY_INITIAL);
  const reasons = useInventoryReasons(tab === "create");
  const [busy, setBusy] = React.useState<null | "link" | "create" | "reject">(null);
  const dirty = tab === "create" && (JSON.stringify(values) !== JSON.stringify(initialValues) || initial.qty !== null) && busy === null;

  // Ref guard: a double Enter / double click must not send the same command twice.
  const inFlight = React.useRef(false);
  const run = async (kind: "link" | "create" | "reject", fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    try {
      await fn();
      onOpenChange(false);
    } catch (error) {
      if (kind === "create" && isApiError(error)) {
        const next: FieldErrors = {};
        for (const [k, v] of Object.entries(error.fieldErrors)) if (v?.[0]) next[k] = v[0];
        setErrors(next);
        focusField(Object.keys(next)[0]);
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const submitCreate = () => {
    const parsed = listingQuickProductSchema.safeParse(values);
    const initErrors = initialQuantityErrors(initial, initial.warehouseId ? reasons?.mandatoryReason[initial.warehouseId] ?? true : false);
    if (!parsed.success) {
      const next: FieldErrors = { ...initErrors };
      for (const i of parsed.error.issues) next[i.path.map(String).join(".")] ??= i.message;
      setErrors(next);
      focusField(String(parsed.error.issues[0]?.path[0] ?? "sku"));
      return;
    }
    if (Object.keys(initErrors).length) {
      setErrors(initErrors);
      return;
    }
    setErrors({});
    const init = initial.qty && initial.warehouseId && initial.locationId ? { warehouseId: initial.warehouseId, locationId: initial.locationId, qty: initial.qty, reasonId: initial.reasonId ?? null } : null;
    void run("create", () => onCreate(values, init));
  };

  const linkPicked = () => {
    if (picked) void run("link", () => onLink(picked));
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy !== null}>Cancel</Button>
      {tab === "search" ? (
        <Button variant="primary" onClick={linkPicked} disabled={!picked || busy !== null || picked === listing.productId} title={picked ? undefined : "Select a product"}>
          {busy === "link" ? <Spinner className="h-3.5 w-3.5" label="Linking" /> : <Link2 className="h-3.5 w-3.5" aria-hidden />}{listing.productId ? "Change link" : "Link"}
        </Button>
      ) : tab === "create" ? (
        <Button variant="primary" onClick={submitCreate} disabled={busy !== null || !canCreate}>
          {busy === "create" ? <Spinner className="h-3.5 w-3.5" label="Creating" /> : <PackagePlus className="h-3.5 w-3.5" aria-hidden />}Create &amp; link
        </Button>
      ) : (
        <>
          <Button variant="secondary" onClick={() => void run("reject", onReject)} disabled={busy !== null || !hasSuggestion}>
            {busy === "reject" ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : <X className="h-3.5 w-3.5" aria-hidden />}Don&apos;t match
          </Button>
          <Button variant="primary" onClick={() => listing.suggestedProductId && void run("link", () => onLink(listing.suggestedProductId as string))} disabled={busy !== null || !hasSuggestion}>
            {busy === "link" ? <Spinner className="h-3.5 w-3.5" label="Matching" /> : <Check className="h-3.5 w-3.5" aria-hidden />}Match
          </Button>
        </>
      )}
    </>
  );

  return (
    <Drawer
      open
      onOpenChange={onOpenChange}
      width={35}
      dirty={dirty}
      title="Link product"
      description={`${listing.storeName} · ${listing.sellerSku} · ${listing.name}`}
      headerExtra={(
        <SegmentedControl<LinkDrawerTab>
          ariaLabel="Link method"
          value={tab}
          onChange={(t) => { setTab(t); setErrors({}); }}
          options={[
            { value: "search", label: <span className="inline-flex items-center gap-1.5"><Search className="h-3.5 w-3.5" aria-hidden />Search &amp; select</span> },
            { value: "create", label: <span className={cn("inline-flex items-center gap-1.5", (!canCreate || Boolean(listing.productId)) && "opacity-50")}><PackagePlus className="h-3.5 w-3.5" aria-hidden />Create new</span>, disabled: !canCreate || Boolean(listing.productId) },
            { value: "suggested", label: <span className={cn("inline-flex items-center gap-1.5", !hasSuggestion && "opacity-50")}><Sparkles className="h-3.5 w-3.5" aria-hidden />Suggested</span>, disabled: !hasSuggestion },
          ]}
        />
      )}
      footer={footer}
    >
      {tab === "search" ? <SearchTab listing={listing} picked={picked} setPicked={setPicked} onSubmit={linkPicked} />
        : tab === "create" ? <CreateTab listing={listing} values={values} setValues={setValues} errors={errors} initial={initial} setInitial={setInitial} />
          : <SuggestedTab listing={listing} />}
    </Drawer>
  );
}
