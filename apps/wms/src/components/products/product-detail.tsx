'use client';

/**
 * Product detail (`/products/[id]`). Identity header with actions (Edit, Print labels,
 * Duplicate, Deactivate/Activate, Change log, Delete), a stock band, then tabs that are
 * real sections over live tables (no synthesized slots). `?tab=` deep-links a tab.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Copy,
  History,
  PackageX,
  Pencil,
  Printer,
  Trash2,
} from 'lucide-react';
import { ChangeLogDrawer, PrintOptionsModal } from '@/components/shared';
import { DetailHeader } from '@/components/shared/detail-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { UnderlineTabs } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { apiFetch, apiRequest, isApiError } from '@/lib/api-client';
import { useFormat } from '@/lib/format';
import { useApiQuery } from '@/lib/query-client';
import type { ProductFormValues } from '@/lib/grid-defs/products/product-form';
import { headerBarcode } from '@/lib/grid-defs/products/header-barcode';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import {
  CATALOG_CRUMBS,
  ProductThumb,
  errorMessage,
  useSlow,
  useCatalogCan,
  useInvalidateCatalog,
  usePrefetchChangeLog,
  usePrefetchPrintouts,
  type DeleteCheckRow,
  type ProductDetailData,
} from './catalog-shared';
import {
  categoryBadge,
  duplicateValues,
  ProductCreateDrawer,
  ProductEditDrawer,
} from './product-create-drawer';
import { StagedNotices } from './page-skeletons';
import { OverflowFade } from './overflow-fade';
import {
  InventoryTab,
  KitTab,
  ListingsTab,
  OrdersTab,
  OverviewTab,
  PackTypesTab,
  PlanningTab,
  TransactionsTab,
} from './product-detail-sections';
import { ProductProgramsPanel } from './product-programs-panel';

const TABS = [
  'overview',
  'pack-types',
  'inventory',
  'orders',
  'listings',
  'kits',
  'planning',
  'transactions',
] as const;
type Tab = (typeof TABS)[number];

/** `notices` adds the CSS-staged slow/stalled notices (route-level fallback; works before hydration). */
export function ProductDetailSkeleton({ notices = true }: { readonly notices?: boolean } = {}) {
  return (
    <div className="relative flex flex-col gap-4 px-6 pt-5" aria-busy="true" aria-label="Loading product">
      <Skeleton className="h-3 w-24" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14" />
        <Skeleton className="h-7 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-8 w-full" />
      <SkeletonTable rows={8} columns={7} />
      {notices ? <StagedNotices title="This product" /> : null}
    </div>
  );
}

export function ProductDetailPage({ id }: { readonly id: string }) {
  // Warm the Edit drawer's form payload so Edit opens interactive at once.
  // Only roles that can edit get the form payload (the endpoint 403s for read-only roles).
  const canEditForm = useCatalogCan('settings.products.edit').allowed;
  useApiQuery<unknown>(['product-form', id], canEditForm ? `/api/products/${id}` : null, {
    query: { view: 'form' },
    staleTime: 60_000,
  });
  const q = useApiQuery<ProductDetailData>(['product-detail', id], `/api/products/${id}`, {
    retry: (count, error) =>
      !(isApiError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) && count < 2,
  });
  const slow = useSlow(q.isPending);
  if (q.isPending) {
    return (
      <>
        {slow ? (
          <div className="px-6 pt-4">
            <Callout
              variant="attention"
              title="This is taking longer than usual"
              action={
                <Button size="sm" onClick={() => void q.refetch()}>
                  Retry
                </Button>
              }
            >
              The server is slow to respond. You can keep waiting or retry.
            </Callout>
          </div>
        ) : null}
        <ProductDetailSkeleton notices={false} />
      </>
    );
  }
  if (q.error) {
    const notFound = isApiError(q.error) && q.error.code === 'NOT_FOUND';
    return (
      <div className="px-6 py-10">
        <EmptyState
          icon={PackageX}
          title={notFound ? 'Product not found' : 'Could not load the product'}
          description={
            notFound
              ? "It may have been deleted, or it belongs to a client you can't access."
              : q.error.message
          }
          action={
            notFound ? (
              <Link href="/products" className={buttonVariants({ variant: 'primary' })}>
                Back to products
              </Link>
            ) : (
              <Button variant="primary" onClick={() => void q.refetch()}>
                Retry
              </Button>
            )
          }
        />
      </div>
    );
  }
  return <ProductDetailView data={q.data.data} />;
}

type Confirm = { kind: 'status' } | { kind: 'delete'; check: DeleteCheckRow } | null;

function ProductDetailView({ data }: { readonly data: ProductDetailData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fmt = useFormat();
  const invalidate = useInvalidateCatalog();
  const p = data.product;
  const can = {
    edit: useCatalogCan('settings.products.edit').allowed,
    create: useCatalogCan('settings.products.create').allowed,
    del: useCatalogCan('settings.products.delete').allowed,
    log: useCatalogCan('settings.products.change_log').allowed,
    label: useCatalogCan('settings.products.label').allowed,
  };
  usePrefetchPrintouts(can.label, p.clientId);
  usePrefetchChangeLog('product', p.id, can.log);
  const raw = params.get('tab');
  const urlTab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';
  // Local state drives the render (instant, never lost to a pending router transition); the URL
  // mirrors it so every tab is shareable, and back/forward or a pasted link resyncs it.
  const [tab, setTabState] = React.useState<Tab>(urlTab);
  React.useEffect(() => setTabState(urlTab), [urlTab]);
  const setTab = (t: string) => {
    if (!(TABS as readonly string[]).includes(t)) return;
    setTabState(t as Tab);
    const next = new URLSearchParams(window.location.search);
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    // Native history API: syncs useSearchParams without a server round trip (Next docs, "Native History API").
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${next.toString() ? `?${next.toString()}` : ''}`,
    );
  };

  const [editing, setEditing] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [pointerTabs, setPointerTabs] = React.useState(false);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const [duplicate, setDuplicate] = React.useState<ProductFormValues | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  // Optimistic status: flips the pill as soon as the server replies; the refetch runs in the background.
  const [statusOverride, setStatusOverride] = React.useState<{
    readonly from: string;
    readonly to: string;
  } | null>(null);
  const status = statusOverride && statusOverride.from === p.status ? statusOverride.to : p.status;
  const active = status === 'Active';

  const labelRecords = () => {
    const packs = data.packTypes.flatMap((pt) =>
      pt.barcodes.map((b) => ({
        sku: p.sku,
        barcode: b,
        name: p.name,
        clientCode: p.clientCode,
        packType: pt.packType,
      })),
    );
    return packs.length
      ? packs
      : [
          {
            sku: p.sku,
            barcode: p.barcode || p.sku,
            name: p.name,
            clientCode: p.clientCode,
            packType: p.uom,
          },
        ];
  };

  const toggleStatus = async () => {
    try {
      const to = active ? 'Inactive' : 'Active';
      await apiFetch(`/api/products/${p.id}/status`, {
        method: 'POST',
        body: { status: to, version: p.version },
      });
      setStatusOverride({ from: p.status, to });
      toast.success('Success', active ? `${p.sku} was deactivated.` : `${p.sku} was activated.`);
    } catch (error) {
      toast.error('Error', errorMessage(error));
    }
    void invalidate();
  };

  const startDelete = async () => {
    try {
      const { data: rows } = await apiRequest<DeleteCheckRow[]>('/api/products/bulk/delete-check', {
        method: 'POST',
        body: { ids: [p.id] },
      });
      const check = rows[0];
      if (check) setConfirm({ kind: 'delete', check });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    }
  };

  const doDelete = async () => {
    try {
      const { data: result } = await apiRequest<{ succeeded: string[]; failed: { message: string }[] }>(
        '/api/products/bulk/delete',
        { method: 'POST', body: { ids: [p.id] } },
      );
      if (result.failed[0]) {
        toast.error('Could not delete', result.failed[0].message);
        return;
      }
      toast.success('Success', `${p.sku} was deleted.`);
      await invalidate();
      router.push('/products');
    } catch (error) {
      toast.error('Error', errorMessage(error));
    }
  };

  const openDuplicate = async () => {
    try {
      const form = await apiFetch<Parameters<typeof duplicateValues>[0]>(`/api/products/${p.id}`, {
        query: { view: 'form' },
      });
      setDuplicate(duplicateValues(form));
    } catch (error) {
      toast.error('Could not duplicate', errorMessage(error));
    }
  };

  const isKit = p.productCategory === 'Kit';
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'pack-types', label: 'Pack types & barcodes', count: data.packTypes.length },
    { key: 'inventory', label: 'Inventory', count: data.inventory.length },
    { key: 'orders', label: 'Orders & POs', count: data.openOrders.length + data.openPos.length },
    { key: 'listings', label: 'Listings', count: data.listings.length },
    {
      key: 'kits',
      label: isKit ? 'Components' : 'Used in kits',
      count: isKit ? data.components.length : data.usedInKits.length,
    },
    ...(isKit ? [] : [{ key: 'planning', label: 'Replenishment' }]),
    { key: 'transactions', label: 'Transactions' },
  ];

  const deleteCheck = confirm?.kind === 'delete' ? confirm.check : null;
  const atpTotal = data.atp.reduce((s, a) => s + a.currentAtp, 0);
  const undamagedTotal = data.atp.reduce((s, a) => s + a.undamaged, 0);

  return (
    <div className="flex min-h-0 flex-col pb-10">
      <Breadcrumbs items={[...CATALOG_CRUMBS, { label: p.sku }]} className="px-6 pt-3" />
      <DetailHeader
        backHref="/products"
        backLabel="Products"
        title={
          <span className="flex items-center gap-3">
            <ProductThumb url={p.imageUrl} size={44} label={p.name} />
            <span className="font-mono">{p.sku}</span>
          </span>
        }
        status={status}
        statusDomain="active"
        badges={
          <>
            {categoryBadge(p.productCategory)}
            {p.kitType ? (
              <Badge tone="info" size="sm">
                {p.kitType}
              </Badge>
            ) : null}
            {p.isHazmat ? (
              <Badge tone="danger" size="sm">
                Hazardous
              </Badge>
            ) : null}
            {p.isDigital ? (
              <Badge tone="neutral" size="sm">
                Digital
              </Badge>
            ) : null}
          </>
        }
        meta={
          <>
            <span className="font-medium text-body">{p.name}</span>
            <span>{p.clientName}</span>
            <HeaderBarcode
              productBarcode={p.barcode}
              packTypes={data.packTypes}
              conflict={data.barcodeConflicts.length > 0}
            />
            <span>Created {fmt.date(p.createdAt)}</span>
          </>
        }
        actions={
          <>
            {can.edit ? (
              <Button variant="primary" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit
              </Button>
            ) : null}
            {can.label ? (
              <Button variant="secondary" onClick={() => setLabels(labelRecords())}>
                <Printer className="h-3.5 w-3.5" aria-hidden />
                Print labels
              </Button>
            ) : null}
            {can.create ? (
              <Button variant="secondary" onClick={() => void openDuplicate()}>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Duplicate
              </Button>
            ) : null}
            {can.edit ? (
              <Button variant="secondary" onClick={() => setConfirm({ kind: 'status' })}>
                {active ? (
                  <Ban className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                )}
                {active ? 'Deactivate' : 'Activate'}
              </Button>
            ) : null}
            {can.log || can.del ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" aria-label="More actions">
                    More
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  {can.log ? (
                    <DropdownMenuItem icon={History} onSelect={() => setLogOpen(true)}>
                      Change log
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    icon={Boxes}
                    href={`/inventory/by-location?q=${encodeURIComponent(p.sku)}&qm=eq`}
                  >
                    View inventory
                  </DropdownMenuItem>
                  {can.del ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem icon={Trash2} destructive onSelect={() => void startDelete()}>
                        Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      {/* Two availability figures, named apart so they never read as a mismatch:
          Unallocated = on hand − allocated − damaged (pickable now);
          ATP = undamaged on hand − all open order demand (allocated or not), as on the Inventory tab. */}
      <div className="grid grid-cols-2 gap-3 px-6 md:grid-cols-4 xl:grid-cols-7">
        <StatTile
          label="On hand"
          value={fmt.quantity(data.totals.onHand)}
          sublabel={`${data.inventory.length} location bucket${data.inventory.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Unallocated"
          value={fmt.quantity(data.totals.available)}
          tone={data.totals.available > 0 ? 'success' : 'default'}
          infoLabel="How Unallocated is calculated"
          info={
            <>
              On hand − allocated − damaged = {fmt.quantity(data.totals.onHand)} −{' '}
              {fmt.quantity(data.totals.allocated)} − {fmt.quantity(data.totals.damaged)}. Stock on shelves
              that no order has reserved yet.
            </>
          }
        />
        <StatTile
          label="ATP"
          value={fmt.quantity(atpTotal)}
          tone={atpTotal < 0 ? 'danger' : 'default'}
          infoLabel="How ATP is calculated"
          sublabel="Available to promise"
          info={
            <>
              Undamaged on hand − open order demand = {fmt.quantity(undamagedTotal)} −{' '}
              {fmt.quantity(data.totals.openSo)}. Unlike Unallocated, it also subtracts open orders that are
              not allocated yet. Per warehouse on the Inventory tab.
            </>
          }
        />
        <StatTile label="Allocated" value={fmt.quantity(data.totals.allocated)} />
        <StatTile
          label="Damaged"
          value={fmt.quantity(data.totals.damaged)}
          tone={data.totals.damaged ? 'danger' : 'default'}
        />
        <StatTile
          label="Open order demand"
          value={fmt.quantity(data.totals.openSo)}
          sublabel={`${data.openOrders.length} order${data.openOrders.length === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Inbound"
          value={fmt.quantity(data.totals.openPo)}
          sublabel={`${data.openPos.length} open PO${data.openPos.length === 1 ? '' : 's'}`}
        />
      </div>

      {/* Pointer clicks show only the active underline; the focus ring is for keyboard focus. */}
      <div
        data-pointer={pointerTabs || undefined}
        onPointerDown={() => setPointerTabs(true)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') setPointerTabs(false);
        }}
        className="mt-5 [&[data-pointer]_[role=tab]]:shadow-none [&[data-pointer]_[role=tab]]:outline-none [&[data-pointer]_[role=tab]]:ring-0"
      >
        {/* Narrow widths: the tab row scrolls; fades + chevrons show that more tabs exist. */}
        <OverflowFade selector="[role=tablist]" fadeClassName="from-background" label="tabs">
          <UnderlineTabs
            className="gap-4 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [&_[role=tab]]:shrink-0 [&_[role=tab]]:px-1.5 [&_[role=tab]:focus-visible]:rounded-md [&_[role=tab]:focus-visible]:ring-primary/25 [&_[role=tab]:focus:not(:focus-visible)]:ring-0 [&_[role=tab]:focus:not(:focus-visible)]:outline-none"
            ariaLabel="Product sections"
            tabs={tabs}
            active={tab}
            onChange={setTab}
          />
        </OverflowFade>
      </div>
      <div className="px-6 pt-4">
        {data.barcodeConflicts.length ? (
          <Callout
            variant="attention"
            title={`Barcode ${p.barcode} is also used by ${data.barcodeConflicts.length} other product${data.barcodeConflicts.length === 1 ? '' : 's'}`}
            className="mb-4"
          >
            Scanning this barcode at receiving or picking is ambiguous. Change the barcode on one of:{' '}
            {data.barcodeConflicts.map((c, i) => (
              <React.Fragment key={c.id}>
                {i ? ', ' : ''}
                <Link href={`/products/${c.id}`} className="font-medium text-primary hover:underline">
                  {c.sku}
                </Link>
              </React.Fragment>
            ))}
            .
          </Callout>
        ) : null}
        {!active ? (
          <Callout variant="attention" title="This product is inactive" className="mb-4">
            It can&apos;t be added to new orders or purchase orders. Activate it to use it again.
          </Callout>
        ) : null}
        {tab === 'overview' ? <OverviewTab data={data} /> : null}
        {tab === 'pack-types' ? (
          <PackTypesTab data={data} canEdit={can.edit} onSaved={() => void invalidate()} />
        ) : null}
        {tab === 'inventory' ? <InventoryTab data={data} /> : null}
        {tab === 'orders' ? <OrdersTab data={data} /> : null}
        {tab === 'listings' ? <ListingsTab data={data} /> : null}
        {tab === 'kits' ? (
          <div className="flex flex-col gap-4">
            <KitTab data={data} />
            {isKit ? <ProductProgramsPanel productId={p.id} /> : null}
          </div>
        ) : null}
        {tab === 'planning' ? (
          <PlanningTab data={data} onEdit={can.edit ? () => setEditing(true) : undefined} />
        ) : null}
        {tab === 'transactions' ? (
          <TransactionsTab
            data={data}
            canAddStock={can.edit}
            onOpenChangeLog={can.log ? () => setLogOpen(true) : undefined}
          />
        ) : null}
      </div>

      {editing ? (
        <ProductEditDrawer
          productId={p.id}
          onOpenChange={(o) => !o && setEditing(false)}
          onSaved={() => void invalidate()}
        />
      ) : null}
      <ProductCreateDrawer
        open={duplicate !== null}
        onOpenChange={(o) => !o && setDuplicate(null)}
        initialValues={duplicate ?? undefined}
        onCreated={(c) => {
          setDuplicate(null);
          void invalidate();
          router.push(`/products/${c.id}`);
        }}
      />
      {logOpen ? (
        <ChangeLogDrawer
          open
          onOpenChange={setLogOpen}
          entityType="product"
          entityId={p.id}
          entityCode={p.sku}
        />
      ) : null}
      <PrintOptionsModal
        open={labels !== null}
        onOpenChange={(o) => !o && setLabels(null)}
        typeKeys={['product-label']}
        records={labels ?? []}
        clientId={p.clientId}
        title="Print product labels"
      />
      <ConfirmDialog
        open={confirm?.kind === 'status'}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant={active ? 'attention' : 'info'}
        icon={active ? Ban : CheckCircle2}
        title={active ? `Deactivate ${p.sku}?` : `Activate ${p.sku}?`}
        description={
          active
            ? "Inactive products can't be added to new orders or purchase orders. Stock and history stay as they are."
            : 'The product can be ordered and received again.'
        }
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={toggleStatus}
      />
      <ConfirmDialog
        open={deleteCheck !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant={deleteCheck?.reason ? 'attention' : 'danger'}
        icon={deleteCheck?.reason ? Ban : Trash2}
        title={deleteCheck?.reason ? `${p.sku} can't be deleted` : `Delete ${p.sku}?`}
        description={
          deleteCheck?.reason
            ? `${deleteCheck.reason}. Deactivate it instead so it can't be ordered or received.`
            : 'This action cannot be undone. Linked channel listings become unlinked.'
        }
        records={{
          columns: [
            { key: 'sku', label: 'Product' },
            { key: 'result', label: 'Delete' },
          ],
          rows: [
            {
              sku: (
                <span className="block max-w-[260px]" title={`${p.sku} · ${p.name}`}>
                  <span className="block truncate whitespace-nowrap font-mono">{p.sku}</span>
                  <span className="block truncate whitespace-nowrap text-2xs text-secondary">{p.name}</span>
                </span>
              ),
              result: deleteCheck?.reason ? (
                <span className="whitespace-nowrap text-danger">Blocked</span>
              ) : (
                <span className="whitespace-nowrap text-success">Can be deleted</span>
              ),
            },
          ],
        }}
        confirmLabel={deleteCheck?.reason ? (active && can.edit ? 'Deactivate' : 'Close') : 'Yes'}
        cancelLabel="No"
        onConfirm={async () => {
          if (!deleteCheck?.reason) await doDelete();
          else if (active && can.edit) await toggleStatus();
        }}
      />
    </div>
  );
}

/** Product barcode, else the primary pack type's first barcode (labelled), else a muted "No barcode". */
function HeaderBarcode({
  productBarcode,
  packTypes,
  conflict,
}: {
  readonly productBarcode: string | null | undefined;
  readonly packTypes: ProductDetailData['packTypes'];
  readonly conflict: boolean;
}) {
  const { value, source } = headerBarcode(productBarcode, packTypes);
  if (!value)
    return (
      <span
        className="text-faint"
        title="No barcode stored on the product or its pack types. Labels print the SKU."
      >
        No barcode
      </span>
    );
  return (
    <span title={source ? `Barcode of the ${source} pack type` : undefined}>
      Barcode <span className="font-mono">{value}</span>
      {source ? <span className="text-faint"> ({source})</span> : null}
      {conflict ? (
        <Badge tone="warning" size="sm" className="ml-1.5">
          Conflict
        </Badge>
      ) : null}
    </span>
  );
}
