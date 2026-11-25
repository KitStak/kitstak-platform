import { redirect } from 'next/navigation';
import { isProductId } from '@kitstak/billing/catalog';

/** Old deep link from locked tiles (`/billing/upgrade?module=crm`). It now lands on the picker. */
export default async function UpgradePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const moduleParam = typeof params.module === 'string' ? params.module : '';
  redirect(isProductId(moduleParam) ? `/billing/plan?add=${moduleParam}` : '/billing/plan');
}
