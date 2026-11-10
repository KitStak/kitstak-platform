import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/layout/shell-skeleton";
import { WarehousesPage } from "@/components/facility/warehouses/warehouses-page";

export const metadata: Metadata = { title: "Warehouse" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WarehousesPage />
    </Suspense>
  );
}
