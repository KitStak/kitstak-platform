import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductDetailPage, ProductDetailSkeleton } from "@/components/products/product-detail";

export const metadata: Metadata = { title: "Product Detail" };

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

async function Detail({ params }: PageProps) {
  const { id } = await params;
  return <ProductDetailPage id={id} />;
}

export default function Page({ params }: PageProps) {
  return (
    <Suspense fallback={<ProductDetailSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}
