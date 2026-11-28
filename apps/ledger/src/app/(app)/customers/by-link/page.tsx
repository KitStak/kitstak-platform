import { notFound, redirect } from 'next/navigation';
import { customerByLink } from '@/server/domain/records';
import { ledgerPage } from '@/server/page';

/** Deep link in from CRM, WMS and Pulse (SPEC 9.9): `?coreCustomerId=` or `?crmAccountItemId=`. */
export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const page = await ledgerPage('/customers/by-link', 'customers');
  if (page.blocked) redirect('/customers');
  const one = (value: string | string[] | undefined): string | null => (typeof value === 'string' ? value : null);
  const id = await customerByLink(page.ctx, { coreCustomerId: one(query.coreCustomerId), crmAccountItemId: one(query.crmAccountItemId) });
  if (!id) notFound();
  redirect(`/customers/${id}`);
}
