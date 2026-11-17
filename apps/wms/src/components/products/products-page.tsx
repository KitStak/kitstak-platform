'use client';

/**
 * Products (`/products`, spec 05 §1). Shared grid (search mode, 27+ filters, chips, saved
 * views, column chooser, density, page sizes, async xlsx export) with the Logiwa header
 * (Bulk Import/Update ▾, Create new product) and bulk actions (Delete, Label) plus
 * Status ▾ (beyond Logiwa). Delete runs a guard check first: products with stock, open
 * orders/POs, kit usage or history are blocked and the dialog offers Deactivate instead.
 */
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileUp,
  History,
  Pencil,
  Plus,
  Power,
  Printer,
  RefreshCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { DataGrid, GridToolbar, useGrid, type RowAction } from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { ChangeLogDrawer, PrintOptionsModal } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InfoTip } from '@/components/ui/info-tip';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { apiFetch, apiRequest } from '@/lib/api-client';
import { PRODUCT_READ_PERMISSIONS } from '@/lib/grid-defs/products/permissions';
import { PRODUCTS_GRID_KEY } from '@/lib/grid-defs/products/products-grid';
import { aliasProductListParams } from '@/lib/grid-defs/products/list-query';
import type { ProductFormValues } from '@/lib/grid-defs/products/product-form';
import {
  bulkToast,
  CATALOG_CRUMBS,
  CatalogViewGate,
  SlowGridNotice,
  errorMessage,
  postBulk,
  productLabelRecords,
  useCatalogCan,
  useInvalidateCatalog,
  usePrefetchPrintouts,
  useProductFilterFields,
  type DeleteCheckRow,
  type ProductListRow,
} from './catalog-shared';
import { GridFetchFrame, usePrefetchGridFirstPage, useStickySearchMode } from './grid-state';
import { usePrefetchWizardOptions } from './wizard/context';
import { NewProductContext, buildProductColumns } from './product-columns';
import {
  ProductCreateDrawer,
  ProductEditDrawer,
  duplicateValues,
  type CreatedProduct,
} from './product-create-drawer';

const P = 'settings.products.';
const IMPORT_TIP =
  'Import new records from an Excel template, or update existing products and kit components in bulk. Every upload is validated row by row and kept in import history.';

type DeleteDialog = { rows: readonly DeleteCheckRow[] } | null;

/** SKU over name, both single-line with ellipsis + tooltip, so the confirm mini-table never wraps mid-token. */
function DeleteProductCell({ sku, name }: { readonly sku: string; readonly name: string }) {
  return (
    <span className="block max-w-[190px]" title={`${sku} · ${name}`}>
      <span className="block truncate whitespace-nowrap font-mono text-xs text-body">{sku}</span>
      <span className="block truncate whitespace-nowrap text-2xs text-secondary">{name}</span>
    </span>
  );
}

function BulkImportMenu() {
  const reason = null;
  return (
    <span className="inline-flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Bulk import/update
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[280px]">
          <DropdownMenuLabel>Import</DropdownMenuLabel>
          <DropdownMenuItem
            href="/imports/products"
            icon={FileUp}
            disabledReason={reason}
            description="New products with their primary pack type"
          >
            Products
          </DropdownMenuItem>
          <DropdownMenuItem
            href="/imports/pack-types"
            icon={FileUp}
            disabledReason={reason}
            description="Add or update pack types and their barcodes"
          >
            Pack types &amp; barcodes
          </DropdownMenuItem>
          <DropdownMenuItem
            href="/imports/replenishment-levels"
            icon={FileUp}
            disabledReason={reason}
            description="Min/max per warehouse"
          >
            Warehouse replenishment levels
          </DropdownMenuItem>
          <DropdownMenuItem
            href="/imports/sku-allocation"
            icon={FileUp}
            disabledReason={reason}
            description="Channel allocation per SKU"
          >
            SKU based inventory allocation
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Update</DropdownMenuLabel>
          <DropdownMenuItem
            href="/imports/products-update"
            icon={RefreshCcw}
            disabledReason={reason}
            description="Change fields on existing SKUs"
          >
            Products
          </DropdownMenuItem>
          <DropdownMenuItem
            href="/imports/kit-components"
            icon={RefreshCcw}
            disabledReason={reason}
            description="Replace the components of existing kits"
          >
            Kit-components
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <InfoTip content={IMPORT_TIP} label="How Excel imports work" />
    </span>
  );
}

export function ProductsPage() {
  // Page 1, saved views and the filter field lists start loading with the permission check, not after it.
  usePrefetchGridFirstPage(PRODUCTS_GRID_KEY, '/api/products');
  useProductFilterFields();
  return (
    <CatalogViewGate permission={PRODUCT_READ_PERMISSIONS} title="Products">
      <ProductsGrid />
    </CatalogViewGate>
  );
}

function ProductsGrid() {
  const router = useRouter();
  const params = useSearchParams();
  const invalidate = useInvalidateCatalog();
  const fields = useProductFilterFields();
  // Logiwa-style deep links (?sku=&skuqt=eq&ps=100) are rewritten to the grid grammar once.
  const legacy = params.has('sku') || params.has('search') || params.has('skuqt');
  // Deferred one macrotask past the first commit: the App Router installs its history patch and
  // action queue in its own (parent) effects, which run after this child effect.
  const rewrote = React.useRef(false);
  React.useEffect(() => {
    if (!legacy || rewrote.current) return;
    rewrote.current = true;
    const target = `/products?${aliasProductListParams(new URLSearchParams(params.toString())).toString()}`;
    const t = window.setTimeout(() => router.replace(target, { scroll: false }), 0);
    return () => {
      window.clearTimeout(t);
      rewrote.current = false;
    };
  }, [legacy, params, router]);
  const g = useGrid<ProductListRow>({ gridKey: PRODUCTS_GRID_KEY, path: '/api/products', fields });
  // Warm the Create drawer's client list once the grid has its first page (never competes with it).
  usePrefetchWizardOptions(null, !g.isLoading);
  const searchGrid = useStickySearchMode(g.toolbarProps.grid);
  const columns = React.useMemo(() => buildProductColumns(), []);
  const can = {
    create: useCatalogCan(`${P}create`).allowed,
    edit: useCatalogCan(`${P}edit`).allowed,
    del: useCatalogCan(`${P}delete`).allowed,
    imp: useCatalogCan(`${P}import_file`).allowed,
    log: useCatalogCan(`${P}change_log`).allowed,
    label: useCatalogCan(`${P}label`).allowed,
  };

  usePrefetchPrintouts(can.label);
  const seen = React.useRef(new Map<string, ProductListRow>());
  React.useEffect(() => {
    for (const r of g.rows) seen.current.set(r.id, r);
  }, [g.rows]);
  const selected = React.useMemo(
    () => g.rows.filter((r) => g.selectedIds.includes(r.id)),
    [g.rows, g.selectedIds],
  );
  const skuOf = (id: string) => seen.current.get(id)?.sku ?? 'Product';

  const [createOpen, setCreateOpen] = React.useState(params.get('create') === '1');
  const [duplicate, setDuplicate] = React.useState<ProductFormValues | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [logFor, setLogFor] = React.useState<ProductListRow | null>(null);
  const [labels, setLabels] = React.useState<readonly unknown[] | null>(null);
  const [delDialog, setDelDialog] = React.useState<DeleteDialog>(null);
  const [checking, setChecking] = React.useState(false);

  const finish = async () => {
    g.clearSelection();
    await invalidate();
  };

  const [newId, setNewId] = React.useState<string | null>(null);
  const onCreated = async (p: CreatedProduct) => {
    setNewId(p.id);
    // Show the new row first (Created desc, page 1), whatever sort/page the user was on.
    const sorted =
      g.grid.query.sort.length === 1 &&
      g.grid.query.sort[0]?.field === 'createdAt' &&
      g.grid.query.sort[0]?.dir === 'desc';
    if (!sorted && g.grid.query.sort.length) g.grid.setSort([{ field: 'createdAt', dir: 'desc' }]);
    if (g.grid.query.page !== 1) g.grid.setPage(1);
    await invalidate();
    g.refetch();
  };

  const startDelete = async (ids: readonly string[]) => {
    setChecking(true);
    try {
      const { data } = await apiRequest<DeleteCheckRow[]>('/api/products/bulk/delete-check', {
        method: 'POST',
        body: { ids },
      });
      setDelDialog({ rows: data });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  const setStatus = async (ids: readonly string[], status: 'Active' | 'Inactive') => {
    try {
      const result = await postBulk('/api/products/bulk/status', { ids, status });
      bulkToast(result, skuOf, { done: status === 'Active' ? 'activated' : 'deactivated', noun: 'product' });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      await finish();
    }
  };

  const deleteRows = async (ids: readonly string[]) => {
    try {
      const result = await postBulk('/api/products/bulk/delete', { ids });
      bulkToast(result, skuOf, { done: 'deleted', noun: 'product' });
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      await finish();
    }
  };

  const openDuplicate = async (row: ProductListRow) => {
    try {
      const form = await apiFetch<Parameters<typeof duplicateValues>[0]>(`/api/products/${row.id}`, {
        query: { view: 'form' },
      });
      setDuplicate(duplicateValues(form));
    } catch (error) {
      toast.error('Could not duplicate', errorMessage(error));
    }
  };

  const rowActions = (row: ProductListRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, href: `/products/${row.id}` },
    ...(can.edit ? [{ key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setEditId(row.id) }] : []),
    ...(can.log ? [{ key: 'log', label: 'Change log', icon: History, onSelect: () => setLogFor(row) }] : []),
    ...(can.create
      ? [{ key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => void openDuplicate(row) }]
      : []),
    ...(can.edit
      ? [
          row.status === 'Active'
            ? {
                key: 'deactivate',
                label: 'Deactivate',
                icon: Ban,
                onSelect: () => void setStatus([row.id], 'Inactive'),
              }
            : {
                key: 'activate',
                label: 'Activate',
                icon: CheckCircle2,
                onSelect: () => void setStatus([row.id], 'Active'),
              },
        ]
      : []),
    ...(can.label
      ? [
          {
            key: 'label',
            label: 'Print label',
            icon: Printer,
            onSelect: () => setLabels(productLabelRecords([row])),
          },
        ]
      : []),
    ...(can.del
      ? [
          {
            key: 'delete',
            label: 'Delete',
            icon: Trash2,
            destructive: true,
            onSelect: () => void startDelete([row.id]),
          },
        ]
      : []),
  ];

  const none = g.selectedIds.length === 0 ? 'Select at least one product' : null;

  const trailing = (
    <div className="flex items-center gap-2">
      {can.edit ? (
        <DropdownMenu>
          <DisabledReason reason={none}>
            <DropdownMenuTrigger asChild disabled={Boolean(none)}>
              <Button variant="secondary" disabled={Boolean(none)} aria-label="Status of selected products">
                <Power className="h-3.5 w-3.5" aria-hidden />
                Status
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </DisabledReason>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem
              icon={CheckCircle2}
              disabledReason={
                selected.every((r) => r.status === 'Active')
                  ? 'Every selected product is already active'
                  : null
              }
              onSelect={() => void setStatus(g.selectedIds, 'Active')}
            >
              Activate
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={Ban}
              disabledReason={
                selected.every((r) => r.status === 'Inactive')
                  ? 'Every selected product is already inactive'
                  : null
              }
              onSelect={() => void setStatus(g.selectedIds, 'Inactive')}
            >
              Deactivate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {can.del ? (
        <DisabledReason reason={none}>
          <Button
            variant="secondary"
            disabled={Boolean(none) || checking}
            onClick={() => void startDelete(g.selectedIds)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Delete
          </Button>
        </DisabledReason>
      ) : null}
      {can.label ? (
        <DisabledReason reason={none}>
          <Button
            variant="secondary"
            disabled={Boolean(none)}
            onClick={() =>
              setLabels(
                productLabelRecords(
                  g.selectedIds
                    .map((id) => seen.current.get(id))
                    .filter((r): r is ProductListRow => Boolean(r)),
                ),
              )
            }
          >
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Label
          </Button>
        </DisabledReason>
      ) : null}
    </div>
  );

  const deletable = (delDialog?.rows ?? []).filter((r) => !r.reason);
  const blocked = (delDialog?.rows ?? []).filter((r) => r.reason);
  const blockedActive = blocked.filter((r) => r.status === 'Active');
  const records = delDialog
    ? {
        columns: [
          { key: 'product', label: 'Product' },
          { key: 'status', label: 'Status' },
          { key: 'result', label: 'Delete' },
        ],
        rows: delDialog.rows.map((r) => ({
          product: <DeleteProductCell sku={r.sku} name={r.name} />,
          status: <StatusPill status={r.status} domain="active" size="sm" />,
          result: r.reason ? (
            <span className="block min-w-[7rem] text-danger">
              <span className="block whitespace-nowrap font-medium">Blocked</span>
              <span className="block text-2xs leading-snug">{r.reason}</span>
            </span>
          ) : (
            <span className="block min-w-[7rem] whitespace-nowrap text-success">Can be deleted</span>
          ),
        })),
      }
    : undefined;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden pb-4">
      <PageHeader
        title="Products"
        breadcrumbs={[CATALOG_CRUMBS[0], { label: 'Products' }]}
        tabs="products"
        actions={
          <>
            {can.imp ? <BulkImportMenu /> : null}
            {can.create ? (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Create new product
              </Button>
            ) : null}
          </>
        }
      />
      <GridToolbar
        {...g.toolbarProps}
        grid={searchGrid}
        searchPlaceholder="Search by SKU, name or barcode"
        bulkNoun="product"
        trailing={trailing}
      />
      <SlowGridNotice
        pending={g.isLoading || (g.isFetching && g.rows.length === 0)}
        onRetry={g.refetch}
        noun="products"
      />
      <GridFetchFrame fetching={g.isFetching} pending={g.isLoading}>
        <NewProductContext.Provider value={newId}>
          <DataGrid<ProductListRow>
            {...g.gridProps}
            columns={columns}
            getRowId={(row) => row.id}
            rowActions={rowActions}
            onRowClick={(row) => router.push(`/products/${row.id}`)}
            emptyTitle="No products match this view"
            emptyDescription="Clear the filters, import products from Excel, or create one."
            emptyAction={
              can.create ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Create new product
                </Button>
              ) : undefined
            }
          />
        </NewProductContext.Provider>
      </GridFetchFrame>

      <ProductCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(p) => void onCreated(p)}
      />
      <ProductCreateDrawer
        open={duplicate !== null}
        onOpenChange={(o) => !o && setDuplicate(null)}
        initialValues={duplicate ?? undefined}
        onCreated={(p) => {
          setDuplicate(null);
          void onCreated(p);
        }}
      />
      <ProductEditDrawer
        productId={editId}
        onOpenChange={(o) => !o && setEditId(null)}
        onSaved={() => void invalidate()}
      />
      {logFor ? (
        <ChangeLogDrawer
          open
          onOpenChange={(o) => !o && setLogFor(null)}
          entityType="product"
          entityId={logFor.id}
          entityCode={logFor.sku}
        />
      ) : null}
      <PrintOptionsModal
        open={labels !== null}
        onOpenChange={(o) => !o && setLabels(null)}
        typeKeys={['product-label']}
        records={labels ?? []}
        title="Print product labels"
      />

      <ConfirmDialog
        open={delDialog !== null}
        onOpenChange={(o) => !o && setDelDialog(null)}
        variant={deletable.length ? 'danger' : 'attention'}
        icon={deletable.length ? Trash2 : Ban}
        title={
          deletable.length
            ? `Delete ${deletable.length} product${deletable.length === 1 ? '' : 's'}?`
            : `${blocked.length === 1 ? 'This product' : 'These products'} can't be deleted`
        }
        description={
          deletable.length
            ? 'This action cannot be undone. Linked channel listings become unlinked.'
            : "Products with stock, open orders, kit usage or history are kept for traceability. Deactivate them instead so they can't be ordered or received."
        }
        records={records}
        confirmLabel={
          deletable.length ? 'Yes' : blockedActive.length ? `Deactivate ${blockedActive.length}` : 'Close'
        }
        cancelLabel="No"
        onConfirm={async () => {
          if (deletable.length) await deleteRows(deletable.map((r) => r.id));
          else if (blockedActive.length)
            await setStatus(
              blockedActive.map((r) => r.id),
              'Inactive',
            );
        }}
      >
        {deletable.length && blocked.length ? (
          <Callout
            variant="attention"
            title={`${blocked.length} product${blocked.length === 1 ? ' is' : 's are'} blocked and will be skipped`}
            action={
              blockedActive.length && can.edit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const ids = blockedActive.map((r) => r.id);
                    setDelDialog(null);
                    void setStatus(ids, 'Inactive');
                  }}
                >
                  Deactivate {blockedActive.length} instead
                </Button>
              ) : undefined
            }
          >
            Yes deletes only the products marked &ldquo;Can be deleted&rdquo;.
          </Callout>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
