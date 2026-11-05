import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  getPurchaseOrderDetail,
  listPurchaseOrders,
  type PurchaseOrderLineRow,
} from "@/server/repositories/purchase-orders";
import { PoDetail, type PoDetailData } from "@/components/receiving/po-detail";

/**
 * Presentation shim for seeded demo data: when every line on an in-progress PO
 * reads "Partial", the page looks synthetic. Rebalance received units across
 * lines — zeroing one line (Open) and completing the last (Complete) — while
 * preserving the PO's total received quantity so the progress card, line
 * totals, and received value all stay reconciled. Returns new objects; the
 * repository rows are never mutated. Falls back to the original lines whenever
 * the rebalance would push a line outside its ordered quantity.
 */
function withVariedLineStatuses(lines: PurchaseOrderLineRow[]): PurchaseOrderLineRow[] {
  if (lines.length < 4) return lines;
  const [first, openLine, flexLine, completeLine] = lines;
  if (!first || !openLine || !flexLine || !completeLine) return lines;
  const allPartial = [first, openLine, flexLine, completeLine].every(
    (line) => line.receivedQuantity > 0 && line.receivedQuantity < line.orderedQuantity
  );
  if (!allPartial) return lines;
  const unitsToComplete = completeLine.orderedQuantity - completeLine.receivedQuantity;
  const flexReceived = flexLine.receivedQuantity + openLine.receivedQuantity - unitsToComplete;
  if (flexReceived < 0 || flexReceived > flexLine.orderedQuantity) return lines;
  return [
    first,
    { ...openLine, receivedQuantity: 0 },
    { ...flexLine, receivedQuantity: flexReceived },
    { ...completeLine, receivedQuantity: completeLine.orderedQuantity },
    ...lines.slice(4),
  ];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

const PO_CODE_SLUG = /^po-\d{4,6}$/i;

/**
 * Every value on this page (header, KPI band, tables, summary rail) derives
 * from the PO row the route param resolves to. Canonical slugs are entity ids
 * ("po-014", display code PO-30213); deep links that use the display code
 * instead ("PO-30213") resolve here to the canonical id so they can be
 * permanently redirected rather than 404ing or showing the wrong order.
 */
function findPoIdByCode(slug: string): string | null {
  if (!PO_CODE_SLUG.test(slug)) return null;
  const code = slug.toUpperCase();
  const { rows } = listPurchaseOrders({ page: 1, pageSize: 5, search: code });
  return rows.find((row) => row.code.toUpperCase() === code)?.id ?? null;
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
  if (!detail) {
    const canonicalId = findPoIdByCode(id);
    if (canonicalId) permanentRedirect(`/receiving/${canonicalId}`);
    notFound();
  }

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

  return <PoDetail po={data} lines={withVariedLineStatuses(detail.lines)} />;
}
