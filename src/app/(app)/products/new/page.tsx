import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductNewPage } from "@/components/products/product-new-page";
import { ListPageSkeleton } from "@/components/products/page-skeletons";

export const metadata: Metadata = { title: "Create Product" };

export default function Page() {
  return (
    <Suspense fallback={<ListPageSkeleton title="Create product" />}>
      <ProductNewPage />
    </Suspense>
  );
}
