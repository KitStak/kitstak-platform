import { ProductDetailSkeleton } from "@/components/products/product-detail";

/**
 * Route-level loading state: shows shimmer tiles and an 8-row inventory table
 * skeleton so navigating from the products list never flashes empty cards.
 */
export default function ProductDetailLoading() {
  return <ProductDetailSkeleton />;
}
