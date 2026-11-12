'use client';

/**
 * Full-page product creation (`/products/new`): the Product Category chooser, then the
 * matching wizard in page layout. Deep links: `?category=product|kit|packaging` skips the
 * chooser, `?clientId=` preselects the client (used by M01/M05 "create missing SKU").
 */
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import type { ProductCategory } from '@/lib/grid-defs/products/catalog-options';
import { emptyProductForm } from '@/lib/grid-defs/products/product-form';
import { CategoryChooser, categoryBadge } from './product-create-drawer';
import { ProductWizard } from './wizard/product-wizard';
import { usePrefetchWizardOptions } from './wizard/context';
import Link from 'next/link';
import { CATALOG_CRUMBS, CatalogViewGate } from './catalog-shared';

const SLUGS: Readonly<Record<string, ProductCategory>> = {
  product: 'Product',
  kit: 'Kit',
  packaging: 'Packaging Material',
};
const SLUG_OF: Readonly<Record<ProductCategory, string>> = {
  Product: 'product',
  Kit: 'kit',
  'Packaging Material': 'packaging',
};

/**
 * Gated like /products: a skeleton while permissions load, then the 403 status screen for roles
 * without Products → Create, so the chooser and wizard never render for them.
 */
export function ProductNewPage() {
  // Clients and the other option lists load with the permission check, so the wizard's Client
  // field is ready when it opens (no "Loading clients…" after the page renders).
  const params = useSearchParams();
  usePrefetchWizardOptions(params.get('clientId'));
  return (
    <CatalogViewGate
      permission="settings.products.create"
      title="Create product"
      deniedTitle="You don't have permission to create products"
      deniedDescription="Your role does not include Products › Create. Ask an administrator to update your role in Settings › Roles."
      deniedActions={
        <Link
          href="/products"
          className="inline-flex h-8 items-center rounded-md border border-border-strong/70 bg-surface px-3 text-sm font-semibold text-body hover:bg-surface-sunken"
        >
          Back to products
        </Link>
      }
    >
      <ProductNewInner />
    </CatalogViewGate>
  );
}

function ProductNewInner() {
  const router = useRouter();
  const params = useSearchParams();
  // Local pick wins so the wizard renders on the click frame; the URL is synced with native
  // history (Next keeps useSearchParams in step) instead of a router round trip.
  const [picked, setPicked] = React.useState<ProductCategory | null | undefined>(undefined);
  const category = picked !== undefined ? picked : (SLUGS[params.get('category') ?? ''] ?? null);
  const clientId = params.get('clientId');
  const defaults = React.useMemo(
    () => (category ? emptyProductForm(category, clientId) : null),
    [category, clientId],
  );
  const pick = (c: ProductCategory) => {
    const next = new URLSearchParams(params.toString());
    next.set('category', SLUG_OF[c]);
    setPicked(c);
    window.history.replaceState(null, '', `/products/new?${next.toString()}`);
  };
  const resetCategory = () => {
    setPicked(null);
    window.history.replaceState(null, '', '/products/new');
  };

  return (
    <div className="flex min-h-0 flex-col pb-8">
      <PageHeader
        title={
          category
            ? `Create ${category === 'Packaging Material' ? 'packaging material' : category.toLowerCase()}`
            : 'Create product'
        }
        breadcrumbs={[...CATALOG_CRUMBS, { label: 'Create product' }]}
        helper={
          category ? 'Complete each step. Required fields are marked *.' : 'Choose what you are creating.'
        }
        actions={
          category ? (
            <span className="flex items-center gap-2">
              {categoryBadge(category)}
              <Button variant="ghost" onClick={resetCategory}>
                Change category
              </Button>
            </span>
          ) : null
        }
      />
      <div className="mx-auto w-full max-w-[1080px] px-6 pt-4">
        {category && defaults ? (
          <ProductWizard
            key={category}
            category={category}
            mode="create"
            variant="page"
            defaultValues={defaults}
            guardUnsaved
            onCancel={() => router.push('/products')}
            onSaved={(r) => router.push(`/products/${r.id}`)}
          />
        ) : (
          <div className="max-w-[640px]">
            <CategoryChooser onPick={pick} />
          </div>
        )}
      </div>
    </div>
  );
}
