"use client";

/**
 * Full-page product creation (`/products/new`): the Product Category chooser, then the
 * matching wizard in page layout. Deep links: `?category=product|kit|packaging` skips the
 * chooser, `?clientId=` preselects the client (used by M01/M05 "create missing SKU").
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import type { ProductCategory } from "@/lib/grid-defs/products/catalog-options";
import { emptyProductForm } from "@/lib/grid-defs/products/product-form";
import { CategoryChooser, categoryBadge } from "./product-create-drawer";
import { ProductWizard } from "./wizard/product-wizard";
import { useCatalogCan } from "./catalog-shared";

const SLUGS: Readonly<Record<string, ProductCategory>> = { product: "Product", kit: "Kit", packaging: "Packaging Material" };
const SLUG_OF: Readonly<Record<ProductCategory, string>> = { Product: "product", Kit: "kit", "Packaging Material": "packaging" };

export function ProductNewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const canCreate = useCatalogCan("settings.products.create");
  const category = SLUGS[params.get("category") ?? ""] ?? null;
  const clientId = params.get("clientId");
  const defaults = React.useMemo(() => (category ? emptyProductForm(category, clientId) : null), [category, clientId]);
  const pick = (c: ProductCategory) => {
    const next = new URLSearchParams(params.toString());
    next.set("category", SLUG_OF[c]);
    router.replace(`/products/new?${next.toString()}`);
  };

  if (!canCreate.isLoading && !canCreate.allowed) {
    return (
      <div className="px-6 py-10">
        <PageHeader title="Create product" />
        <p className="mt-6 text-[13px] text-secondary">You don&apos;t have permission to create products. Ask an administrator for the Products → Create permission.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col pb-8">
      <PageHeader
        title={category ? `Create ${category === "Packaging Material" ? "packaging material" : category.toLowerCase()}` : "Create product"}
        crumbLabel="Create product"
        helper={category ? "Complete each step. Required fields are marked *." : "Choose what you are creating."}
        actions={category ? (
          <span className="flex items-center gap-2">
            {categoryBadge(category)}
            <Button variant="ghost" onClick={() => router.replace("/products/new")}>Change category</Button>
          </span>
        ) : null}
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
            onCancel={() => router.push("/products")}
            onSaved={(r) => router.push(`/products/${r.id}`)}
          />
        ) : (
          <div className="max-w-[640px]"><CategoryChooser onPick={pick} /></div>
        )}
      </div>
    </div>
  );
}
