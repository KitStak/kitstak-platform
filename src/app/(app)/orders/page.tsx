import type { Metadata } from "next";
import { OrdersPage } from "@/components/orders/orders-page";

export const metadata: Metadata = { title: "Shipment Orders" };

export default function Orders() {
  return <OrdersPage />;
}
