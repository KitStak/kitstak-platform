import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderDetailPage } from "@/components/orders/detail/order-detail-page";
import { getOrderDetail } from "@/server/repositories/orders";

export const metadata: Metadata = { title: "Shipment Order" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getOrderDetail(id);
  if (!detail) {
    notFound();
  }
  return <OrderDetailPage detail={detail} />;
}
