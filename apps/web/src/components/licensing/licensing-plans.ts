/**
 * What each combination of products adds, for the "turn them on" section on the home page.
 * Cross-app lines describe what the apps' code does today: the Projects ↔ CRM/WMS lines come from
 * the Projects app's record triggers and automation catalogue (see src/generated/projects).
 */
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';
import type { Stack } from '../site-links';

export interface Plan {
  readonly title: string;
  readonly body: string;
  readonly included: readonly string[];
}

const SHARED = ['One sign-in across apps', 'Shared customers and items', 'One admin portal and billing'];

const recordTrigger = (kind: string): string =>
  PROJECTS_CATALOG.recordTriggers.find((r) => r.kind === kind)?.title ?? kind;

const CRM_PROJECTS = [recordTrigger('crm_deal_won'), 'Tasks linked to deals and accounts'];
const WMS_PROJECTS = [recordTrigger('wms_receipt_discrepancy'), 'Order numbers in a task become links'];

const PLANS: Readonly<Record<string, Plan>> = {
  crm: {
    title: 'CRM on its own',
    body: 'Run accounts, pipelines and follow-ups. Add the warehouse or Projects later and your customers are already there.',
    included: [...SHARED, 'Boards, automations, dashboards'],
  },
  wms: {
    title: 'WMS on its own',
    body: 'Run receiving, inventory, orders and shipping. Add the CRM or Projects later and your clients carry over.',
    included: [...SHARED, 'Locations, counts, packing, returns'],
  },
  projects: {
    title: 'Projects on its own',
    body: 'Plan and run the work: tasks, timelines, workload and automations. Add the CRM or the WMS and tasks can point at the deals and orders they are for.',
    included: [...SHARED, 'Six views, cycles, goals, templates'],
  },
  'crm,wms': {
    title: 'CRM and WMS',
    body: 'Sales and the warehouse work from the same records. A won deal can become an order without anyone retyping it.',
    included: [...SHARED, 'Deals flow into orders', 'Inventory visible on the account'],
  },
  'crm,projects': {
    title: 'CRM and Projects',
    body: 'The work a deal creates is planned next to the deal. When it is won, the delivery project starts itself.',
    included: [...SHARED, ...CRM_PROJECTS],
  },
  'wms,projects': {
    title: 'WMS and Projects',
    body: 'Problems on the floor turn into tasks with an owner and a date, linked to the receipt, order or count they came from.',
    included: [...SHARED, ...WMS_PROJECTS],
  },
  'crm,wms,projects': {
    title: 'The whole stack',
    body: 'Sales, the warehouse and the work between them share one customer list. A project for a customer shows their deal stage and what the warehouse sees.',
    included: [...SHARED, 'Deals flow into orders', recordTrigger('crm_deal_won'), recordTrigger('wms_receipt_discrepancy')],
  },
};

export function planFor(stack: Stack): Plan {
  return PLANS[stack.join(',')] ?? PLANS['crm,wms,projects']!;
}
