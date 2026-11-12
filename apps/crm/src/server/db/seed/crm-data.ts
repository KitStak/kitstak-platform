/**
 * Pure generator for the Northwind Robotics CRM dataset. Produces items per board template
 * (with connect_boards values on both sides) and a value-change history for the activity log.
 */
import {
  ACTIVITY_SUBJECTS,
  CITIES_BY_COUNTRY,
  COMPANY_PREFIXES,
  COMPANY_SUFFIXES,
  COUNTRIES_BY_REGION,
  DEAL_PATTERNS,
  FIRST_NAMES,
  JOB_TITLES,
  LAST_NAMES,
  LEAD_TITLES,
  NEXT_STEPS,
  ONBOARDING_TASKS,
  PHONE_PREFIX,
  PRODUCTS,
  SUFFIX_INDUSTRY,
  type DemoUser,
} from './fixtures';
import { daysAgo, isoDay, quarterEnd, type Rng } from './rng';

export type BoardKey =
  | 'crm-leads'
  | 'crm-contacts'
  | 'crm-accounts'
  | 'crm-deals'
  | 'crm-activities'
  | 'cs-onboarding'
  | 'cs-renewals';

export interface HistoryEntry {
  readonly columnKey: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly at: Date;
  readonly by: string;
}

export interface SeedItem {
  readonly id: string;
  readonly board: BoardKey;
  readonly group: string;
  readonly name: string;
  values: Record<string, unknown>;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly parentId?: string;
  readonly history: HistoryEntry[];
}

export type UserIds = Readonly<Record<DemoUser['key'], string>>;

const STAGE_PROBABILITY: Readonly<Record<string, number>> = {
  lead: 10,
  discovery: 20,
  proposal: 40,
  negotiation: 70,
  won: 100,
  lost: 0,
};
const STAGE_ORDER = ['lead', 'discovery', 'proposal', 'negotiation'] as const;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

function phone(rng: Rng, country: string): string {
  return `${PHONE_PREFIX[country] ?? '+1'} ${rng.int(200, 989)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`;
}

function person(rng: Rng): { first: string; last: string; name: string } {
  const first = rng.pick(FIRST_NAMES);
  const last = rng.pick(LAST_NAMES);
  return { first, last, name: `${first} ${last}` };
}

function connect(target: SeedItem, key: string, id: string): void {
  const current = (target.values[key] as { itemIds?: string[] } | undefined)?.itemIds ?? [];
  if (!current.includes(id)) target.values = { ...target.values, [key]: { itemIds: [...current, id] } };
}

export interface CrmDataset {
  readonly items: SeedItem[];
  readonly byBoard: (board: BoardKey) => SeedItem[];
}

export function generateCrmData(rng: Rng, users: UserIds, today: Date): CrmDataset {
  const items: SeedItem[] = [];
  const add = (item: Omit<SeedItem, 'history'> & { history?: HistoryEntry[] }): SeedItem => {
    const full: SeedItem = { ...item, history: item.history ?? [] };
    items.push(full);
    return full;
  };
  const sellers = [users.daniel, users.sofia, users.maya, users.ethan];
  const createdWithin = (maxDays: number) => daysAgo(today, rng.int(1, maxDays) + rng.next());

  // Accounts --------------------------------------------------------------------------------
  const companyNames = rng
    .sample(
      COMPANY_PREFIXES.flatMap((prefix) => COMPANY_SUFFIXES.map((suffix) => ({ prefix, suffix }))),
      60,
    )
    .map(({ prefix, suffix }) => ({ name: `${prefix} ${suffix}`, suffix }));
  const accounts = companyNames.map((company, index) => {
    const group = index < 35 ? 'customers' : index < 55 ? 'prospects' : 'churned';
    const region = rng.pickWeighted<'na' | 'emea' | 'apac' | 'latam'>([
      ['na', 6],
      ['emea', 3],
      ['apac', 2],
      ['latam', 1],
    ]);
    const country = rng.pick(COUNTRIES_BY_REGION[region]);
    const domain = `${slug(company.name)}.example`;
    const arr = group === 'prospects' ? 0 : rng.int(4, 180) * 5_000;
    return add({
      id: rng.uuid(),
      board: 'crm-accounts',
      group,
      name: company.name,
      createdAt: createdWithin(540),
      createdBy: rng.pick(sellers),
      values: {
        industry: { labelIds: [SUFFIX_INDUSTRY[company.suffix] ?? 'manufacturing'] },
        size: {
          labelId: rng.pickWeighted([
            ['s2', 3],
            ['s3', 4],
            ['s4', 3],
            ['s5', 2],
            ['s1', 1],
          ]),
        },
        ...(arr > 0 && { arr: { amount: arr, currency: 'USD' } }),
        region: { labelId: region },
        health: {
          labelId:
            group === 'churned'
              ? 'at_risk'
              : rng.pickWeighted([
                  ['healthy', 6],
                  ['watch', 3],
                  ['at_risk', 1],
                ]),
        },
        owner: { ids: [rng.pick(sellers)] },
        website: { url: `https://www.${domain}`, text: domain },
        hq: { address: `${rng.pick(CITIES_BY_COUNTRY[country] ?? ['Chicago, IL'])}` },
      },
    });
  });
  const accountMeta = new Map(
    accounts.map((account) => [
      account.id,
      {
        domain: `${slug(account.name)}.example`,
        region: (account.values.region as { labelId: string }).labelId,
      },
    ]),
  );

  // Contacts (2 per account) ----------------------------------------------------------------
  const contactsByAccount = new Map<string, SeedItem[]>();
  for (const account of accounts) {
    const meta = accountMeta.get(account.id) as { domain: string; region: string };
    for (let index = 0; index < 2; index += 1) {
      const who = person(rng);
      const role = index === 0 ? 'decision' : rng.pick(['champion', 'other'] as const);
      const country = rng.pick(COUNTRIES_BY_REGION[meta.region as keyof typeof COUNTRIES_BY_REGION]);
      const contact = add({
        id: rng.uuid(),
        board: 'crm-contacts',
        group: role === 'decision' ? 'decision' : role === 'champion' ? 'champions' : 'other',
        name: who.name,
        createdAt: createdWithin(400),
        createdBy: rng.pick(sellers),
        values: {
          email: { email: `${slug(who.first)}.${slug(who.last)}@${meta.domain}` },
          phone: { phone: phone(rng, country), country },
          job_title: rng.pick(JOB_TITLES[role]),
          type: {
            labelId:
              account.group === 'customers'
                ? role === 'champion'
                  ? 'champion'
                  : 'customer'
                : account.group === 'churned'
                  ? 'former'
                  : 'prospect',
          },
          owner: account.values.owner as { ids: string[] },
          last_contacted: { date: isoDay(today, -rng.int(0, 90)) },
          linkedin: {
            url: `https://www.linkedin.com/in/${slug(who.first)}-${slug(who.last)}-${rng.int(100, 999)}`,
          },
          country: { code: country },
        },
      });
      connect(contact, 'account', account.id);
      connect(account, 'contacts', contact.id);
      contactsByAccount.set(account.id, [...(contactsByAccount.get(account.id) ?? []), contact]);
    }
  }

  // Deals -----------------------------------------------------------------------------------
  const thisQuarterEnd = quarterEnd(today, 0);
  const stagePlan: ReadonlyArray<readonly [string, number]> = [
    ['lead', 20],
    ['discovery', 32],
    ['proposal', 30],
    ['negotiation', 26],
    ['won', 36],
    ['lost', 20],
  ];
  const dealAccounts = accounts.filter((account) => account.group !== 'churned');
  const deals: SeedItem[] = [];
  let dealCounter = 0;
  for (const [stage, total] of stagePlan) {
    for (let index = 0; index < total; index += 1) {
      dealCounter += 1;
      const account = rng.pick(dealAccounts);
      const product = rng.pick(PRODUCTS);
      const name = rng
        .pick(DEAL_PATTERNS)
        .replace('{company}', account.name)
        .replace('{product}', product)
        .replace('{n}', String(rng.int(1, 9)));
      const owner = rng.pick(sellers);
      const createdAt = createdWithin(stage === 'won' || stage === 'lost' ? 300 : 150);
      const closed = stage === 'won' || stage === 'lost';
      const closeDate = closed
        ? isoDay(today, -rng.int(2, 120))
        : rng.chance(0.55)
          ? isoDay(
              today,
              rng.int(
                1,
                Math.max(2, Math.round((Date.parse(thisQuarterEnd) - today.getTime()) / 86_400_000)),
              ),
            )
          : isoDay(today, rng.int(60, 170));
      const group =
        stage === 'won'
          ? 'closed_won'
          : stage === 'lost'
            ? 'closed_lost'
            : closeDate <= thisQuarterEnd
              ? 'this_quarter'
              : 'next_quarter';
      const startDate = createdAt.toISOString().slice(0, 10);
      const value = rng.int(3, 90) * 5_000;
      const deal = add({
        id: rng.uuid(),
        board: 'crm-deals',
        group,
        name: dealCounter % 17 === 0 ? `${name} (phase 2)` : name,
        createdAt,
        createdBy: owner,
        values: {
          stage: { labelId: stage },
          owner: { ids: [owner] },
          deal_value: { amount: value, currency: 'USD' },
          probability: STAGE_PROBABILITY[stage] ?? 0,
          close_date: { date: closeDate },
          priority: {
            labelId: rng.pickWeighted([
              ['critical', 1],
              ['high', 3],
              ['medium', 4],
              ['low', 2],
            ]),
          },
          timeline: { from: startDate < closeDate ? startDate : closeDate, to: closeDate },
          source: {
            labelId: rng.pickWeighted([
              ['website', 4],
              ['referral', 3],
              ['event', 2],
              ['outbound', 3],
              ['partner', 2],
              ['linkedin', 2],
              ['webinar', 1],
            ]),
          },
          ...(!closed && { next_step: rng.pick(NEXT_STEPS) }),
        },
      });
      // Stage history: walked forward from "lead" to the current stage.
      const reached = closed
        ? rng.int(1, STAGE_ORDER.length)
        : STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]) + 1;
      let previous: string | null = null;
      const steps: string[] = [...STAGE_ORDER.slice(0, reached), ...(closed ? [stage] : [])];
      steps.forEach((step, stepIndex) => {
        const at = new Date(
          createdAt.getTime() +
            ((stepIndex + 1) / (steps.length + 1)) * (today.getTime() - createdAt.getTime()),
        );
        deal.history.push({
          columnKey: 'stage',
          before: previous ? { labelId: previous } : null,
          after: { labelId: step },
          at,
          by: owner,
        });
        previous = step;
      });
      connect(deal, 'account', account.id);
      connect(account, 'deals', deal.id);
      const people = rng.sample(contactsByAccount.get(account.id) ?? [], rng.int(1, 2));
      for (const contact of people) {
        connect(deal, 'contacts', contact.id);
        connect(contact, 'deals', deal.id);
      }
      deals.push(deal);
    }
  }

  // Leads ----------------------------------------------------------------------------------
  const leadStatus: ReadonlyArray<readonly [string, number]> = [
    ['new', 5],
    ['working', 4],
    ['contacted', 4],
    ['nurturing', 2],
    ['qualified', 3],
    ['unqualified', 2],
  ];
  for (let index = 0; index < 220; index += 1) {
    const who = person(rng);
    const status = rng.pickWeighted(leadStatus);
    const company = `${rng.pick(COMPANY_PREFIXES)} ${rng.pick(COMPANY_SUFFIXES)}`;
    const country = rng.pickWeighted<string>([
      ['US', 8],
      ['CA', 1],
      ['DE', 2],
      ['GB', 2],
      ['NL', 1],
      ['JP', 1],
      ['BR', 1],
      ['AU', 1],
    ]);
    const group =
      status === 'new'
        ? 'new'
        : status === 'qualified'
          ? 'qualified'
          : status === 'unqualified'
            ? 'disqualified'
            : 'active';
    add({
      id: rng.uuid(),
      board: 'crm-leads',
      group,
      name: who.name,
      createdAt: createdWithin(status === 'new' ? 14 : 120),
      createdBy: rng.pick([users.liam, users.liam, users.sofia]),
      values: {
        status: { labelId: status },
        owner: { ids: [rng.pick([users.liam, users.sofia, users.daniel])] },
        company,
        job_title: rng.pick(LEAD_TITLES),
        email: { email: `${slug(who.first)}.${slug(who.last)}@${slug(company)}.example` },
        phone: { phone: phone(rng, country), country },
        source: {
          labelId: rng.pickWeighted([
            ['website', 5],
            ['webinar', 2],
            ['event', 2],
            ['linkedin', 3],
            ['referral', 2],
            ['outbound', 3],
            ['partner', 1],
          ]),
        },
        lead_score:
          status === 'unqualified'
            ? rng.int(5, 35)
            : status === 'qualified'
              ? rng.int(70, 99)
              : rng.int(25, 85),
        priority: {
          labelId: rng.pickWeighted([
            ['high', 2],
            ['medium', 4],
            ['low', 3],
          ]),
        },
        country: { code: country },
      },
    });
  }

  // Activities -------------------------------------------------------------------------------
  const openDeals = deals.filter(
    (deal) => !['won', 'lost'].includes((deal.values.stage as { labelId: string }).labelId),
  );
  for (let index = 0; index < 180; index += 1) {
    const deal = rng.pick(index % 4 === 0 ? deals : openDeals);
    const type = rng.pickWeighted<string>([
      ['call', 4],
      ['meeting', 3],
      ['email', 4],
      ['demo', 2],
      ['task', 2],
    ]);
    const upcoming = rng.chance(0.35);
    const day = upcoming ? rng.int(0, 30) : -rng.int(1, 120);
    const owner = (deal.values.owner as { ids: string[] }).ids[0] as string;
    const contacts = (deal.values.contacts as { itemIds: string[] } | undefined)?.itemIds ?? [];
    const activity = add({
      id: rng.uuid(),
      board: 'crm-activities',
      group: upcoming ? 'upcoming' : 'completed',
      name: `${rng.pick(ACTIVITY_SUBJECTS[type] ?? ['Follow-up'])} — ${deal.name.split(' — ')[0]?.split(':')[0] ?? deal.name}`,
      createdAt: daysAgo(today, Math.max(1, -day + rng.int(0, 5))),
      createdBy: owner,
      values: {
        type: { labelId: type },
        status: {
          labelId: upcoming
            ? 'planned'
            : rng.pickWeighted([
                ['done', 9],
                ['cancelled', 1],
              ]),
        },
        owner: { ids: [owner] },
        date: {
          date: isoDay(today, day),
          time: `${String(rng.int(8, 17)).padStart(2, '0')}:${rng.pick(['00', '15', '30', '45'])}`,
        },
        duration: type === 'email' ? 5 : rng.pick([15, 30, 45, 60, 90]),
        notes:
          type === 'email' ? 'Logged from inbox.' : 'Discussed timeline, success criteria and next steps.',
      },
    });
    connect(activity, 'deal', deal.id);
    if (contacts[0]) connect(activity, 'contact', contacts[0]);
  }

  // Customer success: onboarding projects + renewals ----------------------------------------------
  const wonDeals = deals
    .filter((deal) => (deal.values.stage as { labelId: string }).labelId === 'won')
    .slice(0, 24);
  wonDeals.forEach((deal, index) => {
    const accountId = (deal.values.account as { itemIds: string[] }).itemIds[0] as string;
    const account = accounts.find((entry) => entry.id === accountId);
    const group = index < 10 ? 'active' : index < 16 ? 'scheduled' : 'live';
    const start = group === 'scheduled' ? rng.int(3, 40) : -rng.int(10, 120);
    const length = rng.int(30, 90);
    const taskCount = rng.int(4, 7);
    const project = add({
      id: rng.uuid(),
      board: 'cs-onboarding',
      group,
      name: `${account?.name ?? deal.name} onboarding`,
      createdAt: daysAgo(today, Math.max(1, -start + 5)),
      createdBy: users.hannah,
      values: {
        owner: { ids: [users.hannah] },
        status: {
          labelId:
            group === 'live'
              ? 'done'
              : group === 'scheduled'
                ? 'not_started'
                : rng.pickWeighted([
                    ['working', 6],
                    ['stuck', 2],
                  ]),
        },
        priority: {
          labelId: rng.pickWeighted([
            ['critical', 1],
            ['high', 3],
            ['medium', 3],
          ]),
        },
        timeline: { from: isoDay(today, start), to: isoDay(today, start + length) },
        kickoff: { date: isoDay(today, start) },
        units: rng.int(4, 60),
      },
    });
    if (account) connect(project, 'account', account.id);
    ONBOARDING_TASKS.slice(0, taskCount).forEach((task, taskIndex) => {
      const progress = group === 'live' ? 1 : group === 'scheduled' ? 0 : rng.next();
      const done = taskIndex / taskCount < progress;
      add({
        id: rng.uuid(),
        board: 'cs-onboarding',
        group,
        parentId: project.id,
        name: task,
        createdAt: project.createdAt,
        createdBy: users.hannah,
        values: {
          sub_owner: { ids: [taskIndex % 3 === 2 ? users.ethan : users.hannah] },
          sub_status: {
            labelId: done
              ? 'done'
              : taskIndex / taskCount < progress + 0.2
                ? rng.pickWeighted([
                    ['working', 4],
                    ['stuck', 1],
                  ])
                : 'todo',
          },
          sub_due: { date: isoDay(today, start + Math.round(((taskIndex + 1) / taskCount) * length)) },
        },
      });
    });
  });

  const customers = accounts.filter((account) => account.group === 'customers');
  customers.slice(0, 40).forEach((account, index) => {
    const offset = rng.int(-30, 330);
    const closed = offset < 0;
    const stage = closed
      ? rng.pickWeighted([
          ['renewed', 4],
          ['churned', 1],
        ])
      : offset < 90
        ? rng.pickWeighted([
            ['upcoming', 2],
            ['negotiating', 3],
          ])
        : 'upcoming';
    const arr = (account.values.arr as { amount: number } | undefined)?.amount ?? rng.int(4, 60) * 5_000;
    const renewal = add({
      id: rng.uuid(),
      board: 'cs-renewals',
      group: closed ? 'closed' : offset < 90 ? 'next_90' : 'later',
      name: `${account.name} — FY${(today.getUTCFullYear() + (offset > 60 ? 1 : 0)) % 100} renewal`,
      createdAt: daysAgo(today, rng.int(20, 200)),
      createdBy: users.hannah,
      values: {
        stage: { labelId: stage },
        risk: {
          labelId:
            (account.values.health as { labelId: string }).labelId === 'at_risk'
              ? 'high'
              : rng.pickWeighted([
                  ['low', 5],
                  ['medium', 3],
                  ['high', 1],
                ]),
        },
        owner: { ids: [index % 4 === 0 ? users.daniel : users.hannah] },
        renewal_date: { date: isoDay(today, offset) },
        arr: { amount: arr, currency: 'USD' },
        ...(rng.chance(0.4) && { expansion: { amount: rng.int(1, 20) * 5_000, currency: 'USD' } }),
        probability: stage === 'renewed' ? 100 : stage === 'churned' ? 0 : rng.int(55, 95),
      },
    });
    connect(renewal, 'account', account.id);
  });

  return { items, byBoard: (board) => items.filter((item) => item.board === board) };
}
