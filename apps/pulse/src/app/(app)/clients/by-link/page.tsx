import { redirect } from 'next/navigation';
import { routes } from '@/lib/routes';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Deep link from a sibling app: `/clients/by-link?coreCustomerId=<id>` or `?crmAccountItemId=<id>`.
 * Sends the person to the Pulse client tied to that record. When no client is tied to it, they
 * land on the Clients tab of Profit, where the client can be added. The target is always built
 * here, never from a URL in the query.
 */
export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const pick = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const id = pick(query.coreCustomerId) ?? pick(query.crmAccountItemId);
  // A sibling record id is not a Pulse client id: never guess a client page from it.
  if (!id || !ID.test(id)) redirect(routes.profit());
  redirect(routes.profit({ by: 'client' }));
}
