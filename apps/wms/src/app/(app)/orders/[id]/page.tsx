import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAuthContext } from '@/server/auth/context';
import { getAppDb } from '@/server/api/db';
import { getOrderDetail } from '@/server/repositories/orders';
import { OrderDetailPage } from '@/components/orders/detail/order-detail-page';

export const metadata: Metadata = { title: 'Shipment order' };
export const instant = false;

/** Edit Shipment Order: the order wizard in free mode + right rail. Accepts the order id or code. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  const detail = auth ? await getOrderDetail(await getAppDb(), auth, decodeURIComponent(id)) : null;
  if (!detail) notFound();
  return <OrderDetailPage initial={detail} />;
}
