'use client';

/**
 * Product Category chooser + create wizard drawer (0.6 stub, owned by M09). Embeddable:
 *
 *   <ProductCreateDrawer open={open} onOpenChange={setOpen} defaultClientId={clientId}
 *     onCreated={(p) => addLine(p)} />
 *
 * M01 (shipment orders) and M05 (purchase orders) use it to add a missing SKU inline.
 * `ProductEditDrawer` reuses the same wizards in free mode with the client locked.
 */
import * as React from 'react';
import { Box, Boxes, Info, Package } from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import type { ProductCategory } from '@/lib/grid-defs/products/catalog-options';
import { emptyProductForm, type ProductFormValues } from '@/lib/grid-defs/products/product-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { RadioCards } from '@/components/ui/radio-cards';
import { SkeletonText } from '@/components/ui/skeleton';
import { DRAWER_WIZARD_BODY, ProductWizard } from './wizard/product-wizard';
import { useSlow } from './catalog-shared';

export interface CreatedProduct {
  readonly id: string;
  readonly sku: string;
  readonly version: number;
  readonly category: ProductCategory;
}

export const CATEGORY_CARDS = [
  {
    value: 'Product' as const,
    title: 'Product',
    description: 'Standard products.',
    icon: Box,
  },
  {
    value: 'Kit' as const,
    title: 'Kit',
    description: 'Kit-to-order or kit-to-stock products.',
    icon: Boxes,
  },
  {
    value: 'Packaging Material' as const,
    title: 'Packaging material',
    description: 'Matched to shipment packages for inventory tracking.',
    icon: Package,
  },
];

export function CategoryChooser({ onPick }: { readonly onPick: (c: ProductCategory) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-primary-soft/50 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">
          Please select the type of product category to proceed.
        </p>
        <p className="text-xs text-secondary">You can&apos;t change the category later.</p>
      </div>
      <RadioCards<ProductCategory>
        ariaLabel="Product category"
        chevron
        value={null}
        onChange={onPick}
        options={CATEGORY_CARDS}
      />
    </div>
  );
}

export function categoryBadge(category: ProductCategory): React.ReactNode {
  return (
    // A category is a type, so a neutral Tag (UI-CLEANUP "Pills"), not a coloured state.
    <Badge tone="outline" className="ml-2 align-middle">
      {category === 'Packaging Material' ? 'Packaging material' : category}
    </Badge>
  );
}

export interface ProductCreateDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly defaultClientId?: string | null;
  /** Skip the chooser and open this wizard directly. */
  readonly initialCategory?: ProductCategory;
  /** Prefill (e.g. Duplicate). */
  readonly initialValues?: ProductFormValues;
  readonly onCreated?: (product: CreatedProduct) => void;
}

export function ProductCreateDrawer({
  open,
  onOpenChange,
  defaultClientId = null,
  initialCategory,
  initialValues,
  onCreated,
}: ProductCreateDrawerProps) {
  const [category, setCategory] = React.useState<ProductCategory | null>(
    initialValues?.productCategory ?? initialCategory ?? null,
  );
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setCategory(initialValues?.productCategory ?? initialCategory ?? null);
      setDirty(false);
    }
  }, [open, initialCategory, initialValues]);
  const defaults = React.useMemo(
    () => (category ? (initialValues ?? emptyProductForm(category, defaultClientId)) : null),
    [category, initialValues, defaultClientId],
  );

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={60}
      dirty={dirty}
      title={
        category ? (
          <span className="flex items-center gap-1">
            {initialValues ? 'Duplicate product' : 'Create product'}
            {categoryBadge(category)}
            {initialValues || initialCategory ? null : (
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 h-6 px-1.5 text-xs font-medium"
                onClick={() => setCategory(null)}
                disabled={dirty}
                title={dirty ? 'Discard your changes to change the category' : 'Pick a different category'}
              >
                Change
              </Button>
            )}
          </span>
        ) : (
          'Product category'
        )
      }
      description={category ? undefined : 'Choose what you are creating.'}
      bodyClassName={category && defaults ? DRAWER_WIZARD_BODY : undefined}
    >
      {category && defaults ? (
        <div className="flex flex-1 flex-col gap-3">
          {initialValues ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm leading-5"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden />
              <div>
                <p className="font-semibold text-foreground">Duplicating</p>
                <p className="mt-0.5 text-secondary">
                  Every setting was copied. Enter a new SKU and barcodes, then save.
                </p>
              </div>
            </div>
          ) : null}
          <ProductWizard
            key={category}
            category={category}
            mode="create"
            defaultValues={defaults}
            draftScope={initialValues ? false : undefined}
            onDirtyChange={setDirty}
            onCancel={() => onOpenChange(false)}
            onSaved={(r) => {
              setDirty(false);
              onOpenChange(false);
              onCreated?.({ ...r, category });
            }}
          />
        </div>
      ) : (
        <CategoryChooser onPick={setCategory} />
      )}
    </Drawer>
  );
}

type FormPayload = ProductFormValues & { id: string; version: number; clientName: string };

export function ProductEditDrawer({
  productId,
  onOpenChange,
  onSaved,
}: {
  readonly productId: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved?: (r: { id: string; sku: string; version: number }) => void;
}) {
  const q = useApiQuery<FormPayload>(
    ['product-form', productId ?? ''],
    productId ? `/api/products/${productId}` : null,
    { query: { view: 'form' }, staleTime: 60_000 },
  );
  const [dirty, setDirty] = React.useState(false);
  const data = q.data?.data;
  const slow = useSlow(q.isPending && productId !== null);
  return (
    <Drawer
      open={productId !== null}
      onOpenChange={(o) => {
        if (!o) setDirty(false);
        onOpenChange(o);
      }}
      width={60}
      dirty={dirty}
      bodyClassName={data && !q.isPending && !q.error ? DRAWER_WIZARD_BODY : undefined}
      title={
        data ? (
          <span>
            Edit product <span className="font-mono text-base text-secondary">{data.sku}</span>
            {categoryBadge(data.productCategory)}
          </span>
        ) : (
          'Edit product'
        )
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-3">
          {slow ? (
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
          ) : null}
          <SkeletonText lines={8} />
        </div>
      ) : q.error ? (
        <Callout
          variant="error"
          title="Could not load the product"
          action={
            <Button size="sm" onClick={() => void q.refetch()}>
              Retry
            </Button>
          }
        >
          {q.error.message}
        </Callout>
      ) : data ? (
        <ProductWizard
          key={`${data.id}:${data.version}`}
          category={data.productCategory}
          mode="edit"
          productId={data.id}
          clientName={data.clientName}
          defaultValues={data}
          onDirtyChange={setDirty}
          onCancel={() => onOpenChange(false)}
          onSaved={(r) => {
            setDirty(false);
            onOpenChange(false);
            onSaved?.(r);
          }}
        />
      ) : null}
    </Drawer>
  );
}

/** Turns a loaded product into create-wizard values for Duplicate (new SKU, no barcodes). */
export function duplicateValues(source: FormPayload): ProductFormValues {
  const { id: _id, version: _v, clientName: _c, ...rest } = source;
  void _id;
  void _v;
  void _c;
  return {
    ...rest,
    sku: `${source.sku}-COPY`.slice(0, 100),
    barcode: '',
    packTypes: source.packTypes
      .map((p) => ({ ...p, id: null, key: `pk_${Math.random().toString(36).slice(2, 10)}`, barcodes: [] }))
      .map((p, _i, all) => ({
        ...p,
        parentKey: p.parentKey
          ? (all[source.packTypes.findIndex((x) => x.key === p.parentKey)]?.key ?? null)
          : null,
      })),
    channelAllocations: source.channelAllocations.map((a) => ({
      ...a,
      key: `ca_${Math.random().toString(36).slice(2, 9)}`,
    })),
  };
}
