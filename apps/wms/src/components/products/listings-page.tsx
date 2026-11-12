'use client';

/**
 * Product Listings (`/products/listings`, spec 05 §2; rows/actions KitStaks-designed).
 * Unlinked / Linked segmented toggle (`?link=`), the 12 Logiwa columns, 10 filters, Tag,
 * Never sync ▾ and Import. The "KitStaks product" cell carries Logiwa's link-state pill
 * (No match / Suggested / Linked) and in-cell icon actions; the Link Product drawer has
 * Search & select / Create new / Suggested. Row actions: Match, Don't match, Link, Unlink,
 * Never sync on/off, Create product from listing (one click, beyond Logiwa), Change log.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Check,
  ChevronDown,
  CloudOff,
  Cloud,
  FileUp,
  History,
  Link2,
  PackagePlus,
  Tag as TagIcon,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import { DataGrid, GridToolbar, useGrid, type RowAction } from '@/components/grid';
import { MoneyCell, TagsCell, YesNoPill } from '@/components/grid/cells';
import { PageHeader } from '@/components/layout/page-header';
import { ChangeLogDrawer, TagPopover } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { apiFetch, apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  LISTINGS_GRID_KEY,
  type ListingException,
  type ListingLinkState,
} from '@/lib/grid-defs/products/listings-grid';
import { LISTING_READ_PERMISSIONS } from '@/lib/grid-defs/products/permissions';
import type { ListingQuickProductInput } from '@/lib/grid-defs/products/listing-quick-product';
import {
  bulkToast,
  CATALOG_CRUMBS,
  CatalogViewGate,
  SlowGridNotice,
  errorMessage,
  postBulk,
  ProductThumb,
  useCatalogCan,
  useInvalidateCatalog,
  useListingFilterFields,
  usePrefetchTags,
  type ListingRow,
} from './catalog-shared';
import { GridFetchFrame, usePrefetchGridFirstPage, useStickySearchMode } from './grid-state';
import { ListingLinkDrawer, type InitialQuantity, type LinkDrawerTab } from './listing-link-drawer';
import {
  ListingCellActionsProvider,
  ListingProductCell,
  type ListingCellActions,
} from './listing-product-cell';

export const LISTINGS_HELPER =
  "Product listings act as a record of the products you're selling across your sales channels. You'll be able to see all listings of a product here.";

type Col = ColumnDef<ListingRow, unknown>;
const dash = <span className="text-faint">—</span>;
const text = (v: unknown) =>
  v === null || v === undefined || v === '' ? (
    dash
  ) : (
    <span className="truncate" title={String(v)}>
      {String(v)}
    </span>
  );

const EXCEPTION_TONE: Readonly<Record<ListingException, string>> = {
  unlinked: 'bg-danger-soft text-danger',
  sku_difference: 'bg-warning-soft text-warning',
  multi_listing: 'bg-info-soft text-info',
};
const EXCEPTION_HINT: Readonly<Record<ListingException, string>> = {
  unlinked: "No KitStaks product is linked, so orders for this listing can't be fulfilled",
  sku_difference: "The seller SKU differs from the linked product's SKU",
  multi_listing: 'Another listing in this store is linked to the same product',
};

function ExceptionCell({ row }: { readonly row: ListingRow }) {
  if (!row.exception)
    return (
      <span className="text-faint" title="No exception">
        —
      </span>
    );
  return (
    <span
      title={EXCEPTION_HINT[row.exception]}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ${EXCEPTION_TONE[row.exception]}`}
    >
      {row.exceptionLabel}
    </span>
  );
}

/**
 * Channel image first; when the store sent none, the linked product's image (or the suggested
 * product's), so rows are recognisable. The tooltip says where the picture comes from.
 */
export function listingImage(
  row: Pick<
    ListingRow,
    'imageUrl' | 'productImageUrl' | 'suggestedProductImageUrl' | 'productSku' | 'suggestedProductSku'
  >,
): { readonly url: string | null; readonly source: string } {
  if (row.imageUrl) return { url: row.imageUrl, source: 'Channel image' };
  if (row.productImageUrl)
    return { url: row.productImageUrl, source: `Image of linked product ${row.productSku ?? ''}`.trim() };
  if (row.suggestedProductImageUrl)
    return {
      url: row.suggestedProductImageUrl,
      source: `Image of suggested product ${row.suggestedProductSku ?? ''}`.trim(),
    };
  return { url: null, source: 'No image on the channel or a product' };
}

function ListingImage({ row }: { readonly row: ListingRow }) {
  const { url, source } = listingImage(row);
  return (
    <span title={source} className="inline-flex">
      <ProductThumb url={url} size={30} label={row.name} />
    </span>
  );
}

function buildColumns(): Col[] {
  return [
    {
      id: 'image',
      header: 'Image',
      size: 64,
      enableSorting: false,
      meta: { label: 'Image', clip: false, justify: 'center' },
      cell: ({ row }) => <ListingImage row={row.original} />,
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Product name',
      size: 240,
      meta: { alwaysVisible: true },
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'sellerSku',
      accessorKey: 'sellerSku',
      header: 'Seller SKU',
      size: 160,
      cell: ({ getValue }) => <span className="truncate font-mono text-xs">{String(getValue())}</span>,
    },
    {
      id: 'productSku',
      accessorKey: 'productSku',
      header: 'KitStaks product',
      size: 380,
      meta: { clip: false, alwaysVisible: true },
      cell: ({ row }) => <ListingProductCell row={row.original} />,
    },
    {
      id: 'storeName',
      accessorKey: 'storeName',
      header: 'Store name',
      size: 180,
      cell: ({ row }) => (
        <span className="truncate">
          {row.original.storeName}
          <span className="ml-1 text-2xs text-faint">{row.original.provider}</span>
        </span>
      ),
    },
    {
      id: 'channelProductId',
      accessorKey: 'channelProductId',
      header: 'Channel ID',
      size: 150,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: 'Description',
      size: 220,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'storePrice',
      accessorKey: 'storePrice',
      header: 'Store price',
      size: 110,
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.storePrice === null ? dash : <MoneyCell value={row.original.storePrice} />,
    },
    {
      id: 'tags',
      accessorKey: 'tags',
      header: 'Tags',
      size: 150,
      enableSorting: false,
      meta: { clip: false },
      cell: ({ row }) => <TagsCell tags={row.original.tags} />,
    },
    {
      id: 'exception',
      accessorKey: 'exception',
      header: 'Exception',
      size: 140,
      meta: { clip: false },
      cell: ({ row }) => <ExceptionCell row={row.original} />,
    },
    {
      id: 'neverSync',
      accessorKey: 'neverSync',
      header: 'Never sync',
      size: 104,
      meta: { clip: false },
      cell: ({ getValue }) => <YesNoPill value={Boolean(getValue())} />,
    },
    {
      id: 'productType',
      accessorKey: 'productType',
      header: 'Product type',
      size: 140,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'productGroup',
      accessorKey: 'productGroup',
      header: 'Product group',
      size: 140,
      cell: ({ getValue }) => text(getValue()),
    },
    {
      id: 'clientName',
      accessorKey: 'clientName',
      header: 'Client',
      size: 160,
      meta: { defaultVisible: false },
      cell: ({ getValue }) => text(getValue()),
    },
  ];
}

/**
 * Unlinked / Linked switch as a real radio group (role=radiogroup + radio, aria-checked, roving
 * tabindex, arrow keys). The accessible name is the label alone ("Unlinked", "Linked"); the count
 * is a description, so tests and assistive tech can address each option by its exact name.
 */
export function LinkStateToggle({
  value,
  onChange,
  counts,
}: {
  readonly value: ListingLinkState;
  readonly onChange: (v: ListingLinkState) => void;
  readonly counts?: { readonly linked: number; readonly unlinked: number };
}) {
  const id = React.useId();
  const options: readonly { key: ListingLinkState; label: string }[] = [
    { key: 'unlinked', label: 'Unlinked' },
    { key: 'linked', label: 'Linked' },
  ];
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    const opt = options[next];
    if (!opt) return;
    onChange(opt.key);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Link state"
      className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-soft p-0.5"
    >
      {options.map((o, i) => {
        const checked = value === o.key;
        const count = counts?.[o.key];
        return (
          <button
            key={o.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.label}
            aria-describedby={typeof count === 'number' ? `${id}-${o.key}` : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(i, -1);
              }
            }}
            data-state={checked ? 'on' : 'off'}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium text-secondary outline-none transition-[color,background-color,box-shadow]',
              'hover:text-body focus-visible:ring-2 focus-visible:ring-focus/40',
              checked && 'bg-surface text-foreground shadow-xs',
            )}
          >
            <span>{o.label}</span>
            {typeof count === 'number' ? (
              <span id={`${id}-${o.key}`} className="text-2xs tabular-nums text-secondary">
                <span className="sr-only">Count: </span>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ListingsPage() {
  const params = useSearchParams();
  usePrefetchGridFirstPage(
    LISTINGS_GRID_KEY,
    '/api/listings',
    { link: params.get('link') === 'linked' ? 'linked' : 'unlinked' },
    ['link'],
  );
  return (
    <CatalogViewGate permission={LISTING_READ_PERMISSIONS} title="Product listings">
      <ListingsGrid />
    </CatalogViewGate>
  );
}

function ListingsGrid() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const link: ListingLinkState = params.get('link') === 'linked' ? 'linked' : 'unlinked';
  const invalidate = useInvalidateCatalog();
  const { fields } = useListingFilterFields();
  const extraQuery = React.useMemo(() => ({ link }), [link]);
  const g = useGrid<ListingRow>({ gridKey: LISTINGS_GRID_KEY, path: '/api/listings', fields, extraQuery });
  const counts = useApiQuery<unknown>(['grid', 'listing-counts'], '/api/listings', {
    query: { ps: 100 },
    staleTime: 10_000,
  });
  const meta = counts.data?.meta as { counts?: { linked: number; unlinked: number } } | undefined;
  const can = {
    imp: useCatalogCan('settings.product_listing.import_file').allowed,
    link: useCatalogCan('settings.product_listing.search_a_product').allowed,
    tag: useCatalogCan('settings.product_listing.tag').allowed,
    create: useCatalogCan('settings.products.create').allowed,
  };
  const searchGrid = useStickySearchMode(g.toolbarProps.grid);
  usePrefetchTags('listing', can.tag);
  const columns = React.useMemo(() => buildColumns(), []);

  const seen = React.useRef(new Map<string, ListingRow>());
  React.useEffect(() => {
    for (const r of g.rows) seen.current.set(r.id, r);
  }, [g.rows]);
  const selected = React.useMemo(
    () => g.rows.filter((r) => g.selectedIds.includes(r.id)),
    [g.rows, g.selectedIds],
  );
  const skuOf = (id: string) => seen.current.get(id)?.sellerSku ?? 'Listing';

  const [linkFor, setLinkFor] = React.useState<{ row: ListingRow; tab?: LinkDrawerTab } | null>(null);
  const [unlinkFor, setUnlinkFor] = React.useState<ListingRow | null>(null);
  const [logFor, setLogFor] = React.useState<ListingRow | null>(null);

  const setLink = (next: string) => {
    const q = new URLSearchParams(params.toString());
    q.set('link', next);
    q.delete('page');
    g.clearSelection();
    // Native history API: instant, no server round trip; useSearchParams stays in sync.
    window.history.replaceState(null, '', `${pathname}?${q.toString()}`);
  };

  // One command per listing at a time (double clicks on the in-cell icons must not 409).
  const pending = React.useRef(new Set<string>());
  const guarded = async (id: string, fn: () => Promise<void>) => {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    try {
      await fn();
    } finally {
      pending.current.delete(id);
    }
  };
  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      toast.success('Success', success);
    } catch (error) {
      toast.error('Error', errorMessage(error));
      throw error;
    } finally {
      await invalidate();
    }
  };

  // Link / unlink always confirm with a toast that offers Undo (the inverse command).
  const undoLink = async (row: ListingRow, previousProductId: string | null) => {
    try {
      if (previousProductId)
        await apiFetch(`/api/listings/${row.id}/link`, {
          method: 'POST',
          body: { productId: previousProductId },
        });
      else await apiFetch(`/api/listings/${row.id}/unlink`, { method: 'POST' });
      toast.success(
        'Undone',
        previousProductId
          ? `${row.sellerSku} is linked to ${row.productSku ?? 'its product'} again.`
          : `${row.sellerSku} is unlinked again.`,
      );
    } catch (error) {
      toast.error("Couldn't undo", errorMessage(error));
    } finally {
      await invalidate();
    }
  };
  const linkTo = async (row: ListingRow, productId: string) => {
    try {
      await apiFetch(`/api/listings/${row.id}/link`, {
        method: 'POST',
        body: { productId, version: row.version },
      });
      toast.success('Listing linked', `${row.sellerSku} is linked. It moved to the Linked tab.`, {
        duration: 8000,
        action: { label: 'Undo', onClick: () => void undoLink(row, row.productId) },
      });
    } catch (error) {
      toast.error('Error', errorMessage(error));
      throw error;
    } finally {
      await invalidate();
    }
  };
  const unlink = async (row: ListingRow) => {
    try {
      await apiFetch(`/api/listings/${row.id}/unlink`, { method: 'POST' });
      toast.success(
        'Listing unlinked',
        `${row.sellerSku} was unlinked from ${row.productSku ?? 'its product'}.`,
        row.productId
          ? {
              duration: 8000,
              action: {
                label: 'Undo',
                onClick: () => void undoLink({ ...row, productId: null }, row.productId),
              },
            }
          : undefined,
      );
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      await invalidate();
    }
  };
  const rejectSuggestion = (row: ListingRow) =>
    run(
      () => apiFetch(`/api/listings/${row.id}/dismiss-suggestion`, { method: 'POST' }),
      `${row.suggestedProductSku ?? 'The suggestion'} won't be suggested for ${row.sellerSku} again.`,
    );
  const createQuick = async (
    row: ListingRow,
    values: ListingQuickProductInput,
    initial: InitialQuantity | null,
  ) => {
    try {
      const { data } = await apiRequest<{ productId: string }>(`/api/listings/${row.id}/create-product`, {
        method: 'POST',
        body: { product: values, version: row.version },
      });
      const open = { label: 'Open', onClick: () => router.push(`/products/${data.productId}`) };
      if (initial) {
        try {
          await apiFetch('/api/inventory/add', {
            method: 'POST',
            body: {
              warehouseId: initial.warehouseId,
              locationId: initial.locationId,
              clientId: row.clientId,
              productId: data.productId,
              packType: String(values.uom || 'Unit'),
              qty: initial.qty,
              reasonId: initial.reasonId,
              note: `Initial quantity from listing ${row.sellerSku}`,
            },
          });
          toast.success(
            'Success',
            `Product ${String(values.sku)} was created, linked to ${row.sellerSku}, and ${initial.qty} added to stock.`,
            { action: open },
          );
        } catch (error) {
          toast.error(
            'Product created, stock not added',
            `${String(values.sku)} was created and linked, but the initial quantity failed: ${errorMessage(error)} Add it from Inventory.`,
            { action: open },
          );
        }
        return;
      }
      toast.success('Success', `Product ${String(values.sku)} was created and linked to ${row.sellerSku}.`, {
        action: open,
      });
    } catch (error) {
      if (isApiError(error) && Object.keys(error.fieldErrors).length)
        toast.error('Check the highlighted fields', error.message);
      else toast.error('Error', errorMessage(error));
      throw error;
    } finally {
      await invalidate();
    }
  };
  const cellActions: ListingCellActions = {
    ...(can.link
      ? {
          onSearch: (row: ListingRow) => setLinkFor({ row, tab: 'search' }),
          onMatch: (row: ListingRow) => {
            if (row.suggestedProductId)
              void guarded(row.id, () => linkTo(row, row.suggestedProductId as string)).catch(
                () => undefined,
              );
          },
          onReject: (row: ListingRow) =>
            void guarded(row.id, () => rejectSuggestion(row)).catch(() => undefined),
          onUnlink: (row: ListingRow) => setUnlinkFor(row),
        }
      : {}),
    ...(can.create && can.link ? { onCreate: (row: ListingRow) => setLinkFor({ row, tab: 'create' }) } : {}),
  };
  const neverSync = (row: ListingRow, value: boolean) =>
    run(
      () => apiFetch(`/api/listings/${row.id}/never-sync`, { method: 'POST', body: { neverSync: value } }),
      value ? `${row.sellerSku} will never sync inventory.` : `${row.sellerSku} syncs inventory again.`,
    ).catch(() => undefined);
  const createProduct = async (row: ListingRow) => {
    try {
      const { data } = await apiRequest<{ productId: string; created: boolean }>(
        `/api/listings/${row.id}/create-product`,
        { method: 'POST' },
      );
      toast.success(
        'Success',
        data.created
          ? `Product ${row.sellerSku} was created and linked.`
          : `Existing product ${row.sellerSku} was linked.`,
        { action: { label: 'Open', onClick: () => router.push(`/products/${data.productId}`) } },
      );
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      await invalidate();
    }
  };
  const bulkNeverSync = async (value: boolean) => {
    try {
      const result = await postBulk('/api/listings/bulk/never-sync', {
        ids: g.selectedIds,
        neverSync: value,
      });
      bulkToast(result, skuOf, { done: 'updated', noun: 'listing' });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      g.clearSelection();
      await invalidate();
    }
  };

  const rowActions = (row: ListingRow): readonly RowAction[] => [
    ...(row.productId
      ? [{ key: 'open', label: 'Show product', icon: Link2, href: `/products/${row.productId}` }]
      : []),
    ...(can.link && row.suggestedProductId
      ? [
          {
            key: 'match',
            label: `Match to ${row.suggestedProductSku}`,
            icon: Check,
            onSelect: () => void linkTo(row, row.suggestedProductId as string).catch(() => undefined),
          },
          {
            key: 'reject',
            label: "Don't match these products",
            icon: X,
            onSelect: () => void rejectSuggestion(row).catch(() => undefined),
          },
        ]
      : []),
    ...(can.link
      ? [
          {
            key: 'link',
            label: row.productId ? 'Change linked product' : 'Link to product',
            icon: Link2,
            onSelect: () => setLinkFor({ row, tab: 'search' }),
          },
          ...(row.productId
            ? [{ key: 'unlink', label: 'Unlink', icon: Unlink, onSelect: () => setUnlinkFor(row) }]
            : []),
          row.neverSync
            ? {
                key: 'sync',
                label: 'Turn never sync off',
                icon: Cloud,
                onSelect: () => void neverSync(row, false),
              }
            : {
                key: 'never',
                label: 'Never sync',
                icon: CloudOff,
                onSelect: () => void neverSync(row, true),
              },
        ]
      : []),
    ...(can.create
      ? [
          {
            key: 'create',
            label: 'Create product from listing',
            icon: PackagePlus,
            disabledReason: row.productId ? 'Already linked to a product' : null,
            onSelect: () => void createProduct(row),
          },
        ]
      : []),
    { key: 'log', label: 'Change log', icon: History, onSelect: () => setLogFor(row) },
  ];

  const none = selected.length === 0 && g.selectedIds.length === 0 ? 'Select at least one listing' : null;
  const trailing = (
    <div className="flex items-center gap-2">
      {can.tag ? (
        <TagPopover
          entityType="listing"
          scope="listing"
          ids={g.selectedIds}
          appliedTagIds={selected.length === 1 ? selected[0]?.tags.map((t) => t.id) : []}
          onApplied={() => void invalidate()}
          disabledReason={none}
          trigger={
            <Button variant="secondary" disabled={Boolean(none)}>
              <TagIcon className="h-3.5 w-3.5" aria-hidden />
              Tag
            </Button>
          }
        />
      ) : null}
      {can.link ? (
        <DropdownMenu>
          <DisabledReason reason={none}>
            <DropdownMenuTrigger asChild disabled={Boolean(none)}>
              <Button variant="secondary" disabled={Boolean(none)}>
                <CloudOff className="h-3.5 w-3.5" aria-hidden />
                Never sync
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem
              icon={CloudOff}
              onSelect={() => void bulkNeverSync(true)}
              description="Exclude from inventory push"
            >
              Turn on
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Cloud}
              onSelect={() => void bulkNeverSync(false)}
              description="Include in inventory push"
            >
              Turn off
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Product Listings"
        breadcrumbs={[...CATALOG_CRUMBS, { label: 'Product Listings' }]}
        tabs="products"
        helper={LISTINGS_HELPER}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                <Upload className="h-3.5 w-3.5" aria-hidden />
                Import
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px]">
              <DropdownMenuItem
                href="/imports/listings"
                icon={FileUp}
                disabledReason={can.imp ? null : "You don't have permission to import listings"}
                description="Seller SKUs per store, optionally linked"
              >
                Product listings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <div className="px-6 pt-3">
        <LinkStateToggle value={link} onChange={setLink} counts={meta?.counts} />
      </div>
      <GridToolbar
        {...g.toolbarProps}
        grid={searchGrid}
        searchPlaceholder="Search by seller SKU, name or channel ID"
        bulkNoun="listing"
        trailing={trailing}
      />
      <SlowGridNotice
        pending={g.isLoading || (g.isFetching && g.rows.length === 0)}
        onRetry={g.refetch}
        noun="listings"
      />
      <ListingCellActionsProvider value={cellActions}>
        <GridFetchFrame fetching={g.isFetching} pending={g.isLoading}>
          <DataGrid<ListingRow>
            {...g.gridProps}
            columns={columns}
            getRowId={(row) => row.id}
            rowActions={rowActions}
            emptyTitle={link === 'unlinked' ? 'Every listing is linked' : 'No linked listings'}
            emptyDescription={
              link === 'unlinked'
                ? "Listings downloaded from your stores that don't match a SKU show up here."
                : 'Link an unlinked listing to a product, or import listings with their SKU.'
            }
            emptyAction={
              link === 'unlinked' ? (
                <Button variant="secondary" onClick={() => setLink('linked')}>
                  View linked listings
                </Button>
              ) : (
                <Link href="/imports/listings" className="text-sm font-semibold text-primary hover:underline">
                  Import listings
                </Link>
              )
            }
          />
        </GridFetchFrame>
      </ListingCellActionsProvider>

      {linkFor ? (
        <ListingLinkDrawer
          key={linkFor.row.id}
          listing={linkFor.row}
          initialTab={linkFor.tab}
          canCreate={can.create}
          onOpenChange={(o) => !o && setLinkFor(null)}
          onLink={(pid) => linkTo(linkFor.row, pid)}
          onCreate={(values, initial) => createQuick(linkFor.row, values, initial)}
          onReject={() => rejectSuggestion(linkFor.row)}
        />
      ) : null}
      <ConfirmDialog
        open={unlinkFor !== null}
        onOpenChange={(o) => !o && setUnlinkFor(null)}
        variant="danger"
        icon={Unlink}
        title={`Unlink ${unlinkFor?.sellerSku ?? 'listing'}?`}
        description="Inventory stops syncing to this listing and new orders for it raise a listing exception until it is linked again."
        records={
          unlinkFor
            ? {
                columns: [
                  { key: 'seller', label: 'Seller SKU' },
                  { key: 'store', label: 'Store' },
                  { key: 'product', label: 'Product' },
                ],
                rows: [
                  {
                    seller: unlinkFor.sellerSku,
                    store: unlinkFor.storeName,
                    product: unlinkFor.productSku ?? '',
                  },
                ],
              }
            : undefined
        }
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={async () => {
          if (unlinkFor) await unlink(unlinkFor);
        }}
      />
      {logFor ? (
        <ChangeLogDrawer
          open
          onOpenChange={(o) => !o && setLogFor(null)}
          entityType="listing"
          entityId={logFor.id}
          entityCode={logFor.sellerSku}
        />
      ) : null}
    </div>
  );
}
