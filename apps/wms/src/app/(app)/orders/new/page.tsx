import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderWizardSkeleton } from "@/components/orders/wizard/order-wizard-skeleton";
import { OrderCreatePage } from "@/components/orders/wizard/order-create-page";
import { requirePagePermission } from "@/server/auth/permissions";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";

export const metadata: Metadata = { title: "Create shipment order" };

const ROUTE = "/orders/new";

/** Permission gate: roles without Create Shipment Order are sent to the shared 403 page. */
async function GatedCreate() {
  await requirePagePermission(ORDER_PERMISSIONS.create, ROUTE);
  return <OrderCreatePage />;
}

/** Create Shipment Order wizard (six steps, linear). */
export default function NewOrderPage() {
  return (
    <Suspense fallback={<OrderWizardSkeleton />}>
      <GatedCreate />
    </Suspense>
  );
}
