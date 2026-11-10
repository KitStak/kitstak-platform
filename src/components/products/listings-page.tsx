"use client";

/**
 * Product Listings (`/products/listings`, spec 05 §2; rows/actions KitStaks-designed).
 * Unlinked / Linked segmented toggle (`?link=`), the 12 Logiwa columns, 10 filters, Tag,
 * Never sync ▾ and Import. Row actions: Link to product, Unlink, Never sync on/off,
 * Create product from listing (beyond Logiwa), Change log.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, CloudOff, Cloud, FileUp, History, Link2, PackagePlus, Tag as TagIcon, Unlink, Upload } from "lucide-react";
import { DataGrid, GridToolbar, useGrid, type RowAction } from "@/components/grid";
import { LinkCell, MoneyCell, TagsCell, YesNoPill } from "@/components/grid/cells";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer, TagPopover } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SegmentedTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch, apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { LISTINGS_GRID_KEY, type ListingException, type ListingLinkState } from "@/lib/grid-defs/products/listings-grid";
import { bulkToast, errorMessage, postBulk, ProductThumb, useCatalogCan, useInvalidateCatalog, useListingFilterFields, type ListingRow } from "./catalog-shared";
import { ListingLinkModal } from "./listing-link-modal";

export const LISTINGS_HELPER = "Product listings act as a record of the products you're selling across your sales channels. You'll be able to see all listings of a product here.";

type Col = ColumnDef<ListingRow, unknown>;
const dash = <span className="text-faint">—</span>;
const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : <span className="truncate" title={String(v)}>{String(v)}</span>);

const EXCEPTION_TONE: Readonly<Record<ListingException, string>> = {
  unlinked: "bg-danger-soft text-danger",
  sku_difference: "bg-warning-soft text-warning",
  multi_listing: "bg-info-soft text-info",
};
const EXCEPTION_HINT: Readonly<Record<ListingException, string>> = {
  unlinked: "No KitStaks product is linked, so orders for this listing can't be fulfilled",
  sku_difference: "The seller SKU differs from the linked product's SKU",
  multi_listing: "Another listing in this store is linked to the same product",
};

function ExceptionCell({ row }: { readonly row: ListingRow }) {
  if (!row.exception) return <span className="text-faint" title="No exception">—</span>;
  return (
    <span title={EXCEPTION_HINT[row.exception]} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${EXCEPTION_TONE[row.exception]}`}>
      {row.exceptionLabel}
    </span>
  );
}

function buildColumns(): Col[] {
  return [
    { id: "image", header: "Image", size: 64, enableSorting: false, meta: { label: "Image", clip: false, justify: "center" }, cell: ({ row }) => <ProductThumb url={row.original.imageUrl} size={30} label={row.original.name} /> },
    { id: "name", accessorKey: "name", header: "Product name", size: 240, meta: { alwaysVisible: true }, cell: ({ getValue }) => text(getValue()) },
    { id: "storeName", accessorKey: "storeName", header: "Store name", size: 160, cell: ({ row }) => <span className="truncate">{row.original.storeName}<span className="ml-1 text-[11px] text-faint">{row.original.provider}</span></span> },
    { id: "sellerSku", accessorKey: "sellerSku", header: "Seller SKU", size: 160, cell: ({ getValue }) => <span className="truncate font-mono text-[12px]">{String(getValue())}</span> },
    { id: "channelProductId", accessorKey: "channelProductId", header: "Channel ID", size: 150, cell: ({ getValue }) => text(getValue()) },
    { id: "description", accessorKey: "description", header: "Description", size: 220, cell: ({ getValue }) => text(getValue()) },
    { id: "storePrice", accessorKey: "storePrice", header: "Store price", size: 110, meta: { align: "right" }, cell: ({ row }) => (row.original.storePrice === null ? dash : <MoneyCell value={row.original.storePrice} />) },
    { id: "tags", accessorKey: "tags", header: "Tags", size: 150, enableSorting: false, meta: { clip: false }, cell: ({ row }) => <TagsCell tags={row.original.tags} /> },
    {
      id: "productSku", accessorKey: "productSku", header: "KitStaks product", size: 170,
      cell: ({ row }) => (row.original.productId ? <LinkCell href={`/products/${row.original.productId}`}>{row.original.productSku}</LinkCell> : <span className="text-[12px] italic text-faint">Not linked</span>),
    },
    { id: "exception", accessorKey: "exception", header: "Exception", size: 140, meta: { clip: false }, cell: ({ row }) => <ExceptionCell row={row.original} /> },
    { id: "neverSync", accessorKey: "neverSync", header: "Never sync", size: 104, meta: { clip: false }, cell: ({ getValue }) => <YesNoPill value={Boolean(getValue())} /> },
    { id: "productType", accessorKey: "productType", header: "Product type", size: 140, cell: ({ getValue }) => text(getValue()) },
    { id: "productGroup", accessorKey: "productGroup", header: "Product group", size: 140, cell: ({ getValue }) => text(getValue()) },
    { id: "clientName", accessorKey: "clientName", header: "Client", size: 160, meta: { defaultVisible: false }, cell: ({ getValue }) => text(getValue()) },
  ];
}

export function ListingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const link: ListingLinkState = params.get("link") === "linked" ? "linked" : "unlinked";
  const invalidate = useInvalidateCatalog();
  const { fields } = useListingFilterFields();
  const extraQuery = React.useMemo(() => ({ link }), [link]);
  const g = useGrid<ListingRow>({ gridKey: LISTINGS_GRID_KEY, path: "/api/listings", fields, extraQuery });
  const counts = useApiQuery<unknown>(["grid", "listing-counts"], "/api/listings", { query: { ps: 100 }, staleTime: 10_000 });
  const meta = counts.data?.meta as { counts?: { linked: number; unlinked: number } } | undefined;
  const columns = React.useMemo(() => buildColumns(), []);
  const can = {
    imp: useCatalogCan("settings.product_listing.import_file").allowed, link: useCatalogCan("settings.product_listing.search_a_product").allowed,
    tag: useCatalogCan("settings.product_listing.tag").allowed, create: useCatalogCan("settings.products.create").allowed,
  };

  const seen = React.useRef(new Map<string, ListingRow>());
  React.useEffect(() => {
    for (const r of g.rows) seen.current.set(r.id, r);
  }, [g.rows]);
  const selected = g.selectedIds.map((id) => seen.current.get(id)).filter((r): r is ListingRow => Boolean(r));
  const skuOf = (id: string) => seen.current.get(id)?.sellerSku ?? "Listing";

  const [linkFor, setLinkFor] = React.useState<ListingRow | null>(null);
  const [unlinkFor, setUnlinkFor] = React.useState<ListingRow | null>(null);
  const [logFor, setLogFor] = React.useState<ListingRow | null>(null);

  const setLink = (next: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("link", next);
    q.delete("page");
    g.clearSelection();
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success("Success", success);
    } catch (error) {
      toast.error("Error", errorMessage(error));
      throw error;
    } finally {
      await invalidate();
    }
  };

  const linkTo = (row: ListingRow, productId: string) => run(() => apiFetch(`/api/listings/${row.id}/link`, { method: "POST", body: { productId, version: row.version } }), `${row.sellerSku} is linked. It moved to the Linked tab.`);
  const unlink = (row: ListingRow) => run(() => apiFetch(`/api/listings/${row.id}/unlink`, { method: "POST" }), `${row.sellerSku} was unlinked.`).catch(() => undefined);
  const neverSync = (row: ListingRow, value: boolean) => run(() => apiFetch(`/api/listings/${row.id}/never-sync`, { method: "POST", body: { neverSync: value } }), value ? `${row.sellerSku} will never sync inventory.` : `${row.sellerSku} syncs inventory again.`).catch(() => undefined);
  const createProduct = async (row: ListingRow) => {
    try {
      const { data } = await apiRequest<{ productId: string; created: boolean }>(`/api/listings/${row.id}/create-product`, { method: "POST" });
      toast.success("Success", data.created ? `Product ${row.sellerSku} was created and linked.` : `Existing product ${row.sellerSku} was linked.`, { action: { label: "Open", onClick: () => router.push(`/products/${data.productId}`) } });
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      await invalidate();
    }
  };
  const bulkNeverSync = async (value: boolean) => {
    try {
      const result = await postBulk("/api/listings/bulk/never-sync", { ids: g.selectedIds, neverSync: value });
      bulkToast(result, skuOf, { done: "updated", noun: "listing" });
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      g.clearSelection();
      await invalidate();
    }
  };

  const rowActions = (row: ListingRow): readonly RowAction[] => [
    ...(row.productId ? [{ key: "open", label: "Show product", icon: Link2, href: `/products/${row.productId}` }] : []),
    ...(can.link ? [
      { key: "link", label: row.productId ? "Change linked product" : "Link to product", icon: Link2, onSelect: () => setLinkFor(row) },
      ...(row.productId ? [{ key: "unlink", label: "Unlink", icon: Unlink, onSelect: () => setUnlinkFor(row) }] : []),
      row.neverSync
        ? { key: "sync", label: "Turn never sync off", icon: Cloud, onSelect: () => void neverSync(row, false) }
        : { key: "never", label: "Never sync", icon: CloudOff, onSelect: () => void neverSync(row, true) },
    ] : []),
    ...(can.create ? [{ key: "create", label: "Create product from listing", icon: PackagePlus, disabledReason: row.productId ? "Already linked to a product" : null, onSelect: () => void createProduct(row) }] : []),
    { key: "log", label: "Change log", icon: History, onSelect: () => setLogFor(row) },
  ];

  const none = selected.length === 0 && g.selectedIds.length === 0 ? "Select at least one listing" : null;
  const trailing = (
    <div className="flex items-center gap-2">
      {can.tag ? (
        <TagPopover entityType="listing" scope="listing" ids={g.selectedIds} appliedTagIds={selected.length === 1 ? selected[0]?.tags.map((t) => t.id) : []}
          onApplied={() => void invalidate()} disabledReason={none}
          trigger={<Button variant="secondary" disabled={Boolean(none)}><TagIcon className="h-3.5 w-3.5" aria-hidden />Tag</Button>} />
      ) : null}
      {can.link ? (
        <DropdownMenu>
          <DisabledReason reason={none}>
            <DropdownMenuTrigger asChild disabled={Boolean(none)}>
              <Button variant="secondary" disabled={Boolean(none)}><CloudOff className="h-3.5 w-3.5" aria-hidden />Never sync<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem icon={CloudOff} onSelect={() => void bulkNeverSync(true)} description="Exclude from inventory push">Turn on</DropdownMenuItem>
            <DropdownMenuItem icon={Cloud} onSelect={() => void bulkNeverSync(false)} description="Include in inventory push">Turn off</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Product Listings"
        tabs="products"
        helper={LISTINGS_HELPER}
        actions={(
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary"><Upload className="h-3.5 w-3.5" aria-hidden />Import<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px]">
              <DropdownMenuItem href="/imports/listings" icon={FileUp} disabledReason={can.imp ? null : "You don't have permission to import listings"} description="Seller SKUs per store, optionally linked">Product listings</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
      <div className="px-6 pt-3">
        <SegmentedTabs ariaLabel="Link state" active={link} onChange={setLink} tabs={[
          { key: "unlinked", label: "Unlinked listing", count: meta?.counts?.unlinked },
          { key: "linked", label: "Linked listing", count: meta?.counts?.linked },
        ]} />
      </div>
      <GridToolbar {...g.toolbarProps} searchPlaceholder="Search by seller SKU, name or channel ID" bulkNoun="listing" trailing={trailing} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DataGrid<ListingRow>
          {...g.gridProps}
          columns={columns}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          emptyTitle={link === "unlinked" ? "Every listing is linked" : "No linked listings"}
          emptyDescription={link === "unlinked" ? "Listings downloaded from your stores that don't match a SKU show up here." : "Link an unlinked listing to a product, or import listings with their SKU."}
          emptyAction={link === "unlinked" ? <Button variant="secondary" onClick={() => setLink("linked")}>View linked listings</Button> : <Link href="/imports/listings" className="text-[13px] font-semibold text-primary hover:underline">Import listings</Link>}
        />
      </div>

      {linkFor ? <ListingLinkModal listing={linkFor} onOpenChange={(o) => !o && setLinkFor(null)} onLink={(pid) => linkTo(linkFor, pid)} /> : null}
      <ConfirmDialog
        open={unlinkFor !== null}
        onOpenChange={(o) => !o && setUnlinkFor(null)}
        variant="danger"
        icon={Unlink}
        title={`Unlink ${unlinkFor?.sellerSku ?? "listing"}?`}
        description="Inventory stops syncing to this listing and new orders for it raise a listing exception until it is linked again."
        records={unlinkFor ? { columns: [{ key: "seller", label: "Seller SKU" }, { key: "store", label: "Store" }, { key: "product", label: "Product" }], rows: [{ seller: unlinkFor.sellerSku, store: unlinkFor.storeName, product: unlinkFor.productSku ?? "" }] } : undefined}
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={async () => {
          if (unlinkFor) await unlink(unlinkFor);
        }}
      />
      {logFor ? <ChangeLogDrawer open onOpenChange={(o) => !o && setLogFor(null)} entityType="listing" entityId={logFor.id} entityCode={logFor.sellerSku} /> : null}
    </div>
  );
}
