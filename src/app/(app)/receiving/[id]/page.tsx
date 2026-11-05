import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPurchaseOrderDetail } from "@/server/repositories/purchase-orders";
import { PoDetail, type PoDetailData } from "@/components/receiving/po-detail";

interface PageProps {
  params: Promise<{ id: string }>;
}

const WAREHOUSE_LABELS: Record<string, string> = {
  "wh-mlt1": "MLT1 – Main Fulfillment",
  "wh-ks2": "KS2 – Overflow",
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const detail = getPurchaseOrderDetail(id);
  return { title: detail ? `${detail.purchaseOrder.code} — Purchase Order` : "Purchase Order" };
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const detail = getPurchaseOrderDetail(id);
  if (!detail) notFound();

  const po = detail.purchaseOrder;
  const data: PoDetailData = {
    id: po.id,
    code: po.code,
    vendorName: po.vendorName,
    referenceNumber: po.referenceNumber,
    status: po.status,
    poType: po.poType,
    totalQuantity: po.totalQuantity,
    receivedQuantity: po.receivedQuantity,
    purchasePrice: po.purchasePrice,
    expectedDate: po.expectedDate,
    receivedAt: po.receivedAt,
    createdAt: po.createdAt,
    clientName: po.clientName,
    clientCode: po.clientCode,
    warehouseLabel: WAREHOUSE_LABELS[po.warehouseId] ?? po.warehouseId,
  };

  return <PoDetail po={data} lines={detail.lines} />;
}
