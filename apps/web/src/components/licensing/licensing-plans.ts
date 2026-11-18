/**
 * What each combination of products adds, for the "turn them on" section on the home page.
 * Cross-app lines describe what the apps' code does today: the Projects ↔ CRM/WMS lines come from
 * the Projects app's record triggers and automation catalogue (see src/generated/projects).
 * Plans without Pulse are written out one by one; plans with Pulse are composed from them below.
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

/*
 * Pulse lines follow docs/pulse/SPEC.md section 8 (what Pulse pulls in from each app and what it
 * shows back). Pulse copies rows and never changes CRM or WMS data, so the wording stays at
 * "pulls in" and "keeps in step".
 */
type Sibling = Exclude<Stack[number], 'pulse'>;

const SIBLING_NAME: Readonly<Record<Sibling, string>> = { crm: 'CRM', wms: 'WMS', projects: 'Projects' };

const PULSE_ALONE: Plan = {
  title: 'Pulse on its own',
  body: 'See what each job earned and what it really cost. Type your numbers or bring them in by CSV. Add the CRM, the WMS or Projects later and they link up.',
  included: [
    'One sign-in across apps',
    'One admin portal and billing',
    'Profit by job, client and service',
    'CSV in and out for every kind of data',
  ],
};

const PULSE_WITH: Readonly<Record<Sibling, { readonly body: string; readonly pulls: string; readonly line: string }>> = {
  crm: {
    body: 'A won deal becomes a job with the client, the quote and the start date filled in. The deal shows the profit on the jobs made from it.',
    pulls: 'won deals',
    line: 'Create a job from a won deal',
  },
  wms: {
    body: 'Work orders become jobs and finished kits come in as units done. You add the people and hours, and the work order shows the job profit.',
    pulls: 'work orders',
    line: 'Work orders become jobs',
  },
  projects: {
    body: 'Link a job to a project and the time logged there can count as labor hours on the job. An alert in Pulse can become a task in Projects.',
    pulls: 'project time',
    line: 'Project time counts as labor hours',
  },
};

function joinWords(words: readonly string[]): string {
  return words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** Pulse stacked with one or more of the other apps: the plan for those apps plus what Pulse links to. */
function pulsePlan(siblings: readonly Sibling[]): Plan {
  const base = PLANS[siblings.join(',')]!;
  if (siblings.length === 1) {
    const link = PULSE_WITH[siblings[0]!];
    return {
      title: `${SIBLING_NAME[siblings[0]!]} and Pulse`,
      body: link.body,
      included: [...base.included, link.line, 'Job profit shown in both apps'],
    };
  }
  const isWhole = siblings.length === 3;
  const pulls = joinWords(siblings.map((id) => PULSE_WITH[id].pulls));
  return {
    title: isWhole ? 'The whole stack' : `${siblings.map((id) => SIBLING_NAME[id]).join(', ')} and Pulse`,
    body: `${isWhole ? 'Sales, the warehouse, the work between them and the profit on every job, with one sign-in. ' : ''}Pulse pulls in ${pulls}, and shows job profit on the screens your team already uses.`,
    included: [...base.included, 'Jobs in Pulse linked to their source records', 'Job profit shown in every app'],
  };
}

export function planFor(stack: Stack): Plan {
  if (stack.includes('pulse')) {
    const siblings = stack.filter((id) => id !== 'pulse');
    return siblings.length === 0 ? PULSE_ALONE : pulsePlan(siblings);
  }
  return PLANS[stack.join(',')] ?? PLANS['crm,wms,projects']!;
}
