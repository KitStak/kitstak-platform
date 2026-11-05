import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductDetail } from "@/server/repositories/products";
import { ProductDetailView } from "@/components/products/product-detail";

export const metadata: Metadata = { title: "Product Detail" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const detail = getProductDetail(id);
  if (!detail) notFound();
  return <ProductDetailView detail={detail} />;
}
