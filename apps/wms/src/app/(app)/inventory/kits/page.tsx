import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { KitInventoryPage } from "@/components/kits/kit-inventory-page";

export const metadata: Metadata = { title: "Kit Inventory" };

/** Kit Inventory report (kit_inventory_stats). Grid state lives in the URL, so it renders inside Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KitInventoryPage />
    </Suspense>
  );
}
