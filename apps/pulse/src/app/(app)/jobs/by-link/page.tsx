import { redirect } from 'next/navigation';
import { routes, type NewJobPrefill } from '@/lib/routes';
import { findJobsByLink } from '@/server/domain';
import { pageContext } from '@/server/page';

type LinkType = Parameters<typeof findJobsByLink>[1];

/** Target types a sibling app may send: the link type Pulse stores, and the new job prefill it maps to. */
const TARGETS: Readonly<Record<string, { readonly link: LinkType; readonly prefill?: keyof NewJobPrefill }>> =
  {
    crm_item: { link: 'crm_deal', prefill: 'crmDeal' },
    crm_deal: { link: 'crm_deal', prefill: 'crmDeal' },
    crm_account: { link: 'crm_account', prefill: 'crmAccountItemId' },
    core_customer: { link: 'core_customer', prefill: 'coreCustomerId' },
    wms_work_order: { link: 'wms_work_order', prefill: 'wmsWorkOrder' },
    wms_shipment_order: { link: 'wms_shipment_order' },
    wms_client: { link: 'wms_client', prefill: 'coreCustomerId' },
    pm_project: { link: 'pm_project', prefill: 'project' },
    pm_task: { link: 'pm_task' },
  };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Deep link from a sibling app: `/jobs/by-link?type=<target type>&id=<id>`. Opens the job tied
 * to that record when there is exactly one, lists them when there are several (the jobs list,
 * searched by the first one's client), and otherwise opens a new job prefilled from the record.
 * The target is always built from the type and id, never from a URL in the query.
 */
export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const type = Array.isArray(query.type) ? query.type[0] : query.type;
  const id = Array.isArray(query.id) ? query.id[0] : query.id;
  const target = type ? TARGETS[type] : undefined;
  if (!target || !id || !ID.test(id)) redirect(routes.jobs());
  const { ctx } = await pageContext(
    `/jobs/by-link?type=${encodeURIComponent(type ?? '')}&id=${encodeURIComponent(id)}`,
  );
  let jobs: Awaited<ReturnType<typeof findJobsByLink>> = [];
  try {
    jobs = await findJobsByLink(ctx, target.link, id);
  } catch {
    jobs = [];
  }
  const record =
    target.link === 'crm_deal' ||
    target.link === 'wms_work_order' ||
    target.link === 'pm_project' ||
    target.link === 'pm_task' ||
    target.link === 'wms_shipment_order';
  // A deal, a work order or a project belongs to one job: open it. A client or an account has many: show the list.
  if (jobs.length === 1 && record) redirect(routes.job((jobs[0] as { number: string }).number));
  if (jobs.length > 0)
    redirect(
      `${routes.jobs({ tab: 'all' })}&q=${encodeURIComponent((jobs[0] as { clientName: string }).clientName)}`,
    );
  redirect(target.prefill ? routes.newJob({ [target.prefill]: id }) : routes.jobs());
}
