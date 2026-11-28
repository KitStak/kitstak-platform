import type { Metadata } from 'next';
import { AgencyPage } from '@/features/agencies/agencies-page';

export const metadata: Metadata = { title: 'Agency' };

export default async function Page({ params }: { readonly params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  return <AgencyPage vendorId={vendorId} />;
}
