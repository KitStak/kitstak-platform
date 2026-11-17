import { redirect } from 'next/navigation';
import { routes, type NewJobPrefill } from '@/lib/routes';

/** Target types a sibling app may send, and the new job prefill each one maps to. */
const PREFILL_KEY: Readonly<Record<string, keyof NewJobPrefill>> = {
  crm_item: 'crmDeal',
  crm_account: 'crmAccountItemId',
  core_customer: 'coreCustomerId',
  wms_work_order: 'wmsWorkOrder',
  pm_project: 'project',
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Deep link from a sibling app: `/jobs/by-link?type=<target type>&id=<id>`. Sends the person to
 * the job tied to that record, or to a new job prefilled from it. The target is always built
 * from the type and id, never from a URL in the query.
 */
export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const type = Array.isArray(query.type) ? query.type[0] : query.type;
  const id = Array.isArray(query.id) ? query.id[0] : query.id;
  const key = type ? PREFILL_KEY[type] : undefined;
  if (!key || !id || !ID.test(id)) redirect(routes.jobs());
  redirect(routes.newJob({ [key]: id }));
}
