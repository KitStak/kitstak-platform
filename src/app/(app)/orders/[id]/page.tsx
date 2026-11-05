import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderDetailPage } from "@/components/orders/detail/order-detail-page";
import { presentOrderDetail } from "@/components/orders/detail/order-presenter";
import { getOrderDetail } from "@/server/repositories/orders";

export const metadata: Metadata = { title: "Shipment Order" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const slug = decodeURIComponent(id).toLowerCase();
  const detail = getOrderDetail(slug);
  if (!detail) {
    notFound();
  }
  // Bind the rendered record to the route slug (so /orders/so-0083 reads as
  // SO-0083 everywhere) and normalize seeded timestamps to business hours.
  return <OrderDetailPage detail={presentOrderDetail(detail, slug)} />;
}
