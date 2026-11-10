import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailPageSkeleton } from "@/components/layout/shell-skeleton";
import { OrderCreatePage } from "@/components/orders/wizard/order-create-page";

export const metadata: Metadata = { title: "Create shipment order" };

/** Create Shipment Order wizard (six steps, linear). */
export default function NewOrderPage() {
  return (
    <Suspense fallback={<DetailPageSkeleton />}>
      <OrderCreatePage />
    </Suspense>
  );
}
