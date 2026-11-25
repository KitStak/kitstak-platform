/**
 * Program accounts and deals for the Northwind demo (docs/programs/SPEC.md 7.1): four CRM
 * accounts that run kitting programs in Projects, their won deals (with the rate columns the
 * program wizard reads), and one won deal with no program yet so the "Start a program" banner
 * shows. Ids come from their own seeded RNG, so the rest of the generated data does not move.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '../index';
import { columns } from '../schema';
import { positionAfter } from '@/server/services/positions';
import type { SeedItem, UserIds } from './crm-data';
import { createRng, daysAgo, isoDay } from './rng';

const PROGRAM_SEED = 20_261_125;

interface ProgramAccount {
  readonly name: string;
  readonly domain: string;
  readonly city: string;
  readonly industry: string;
  readonly arr: number;
  readonly contact: { readonly name: string; readonly title: string };
  readonly deals: readonly {
    readonly name: string;
    readonly value: number;
    readonly closedDaysAgo: number;
    readonly rates?: {
      readonly unitPrice: number;
      readonly monthlyFee: number;
      readonly setupFee: number;
      readonly monthlyMinimum: number;
      readonly termMonths: number;
    };
    readonly termMonths?: number;
  }[];
}

export const PROGRAM_ACCOUNTS: readonly ProgramAccount[] = [
  {
    name: 'Gripwell Safety Supply',
    domain: 'gripwellsafety.example',
    city: 'Fort Worth, TX',
    industry: 'manufacturing',
    arr: 390_000,
    contact: { name: 'Carla Jennings', title: 'Director of Purchasing' },
    deals: [
      {
        name: 'Gripwell Safety Supply · Glove kitting program',
        value: 386_400,
        closedDaysAgo: 80,
        rates: { unitPrice: 1.85, monthlyFee: 1500, setupFee: 2500, monthlyMinimum: 30000, termMonths: 12 },
      },
      {
        name: 'Gripwell Safety Supply · Winter liner add on',
        value: 42_000,
        closedDaysAgo: 4,
        termMonths: 6,
      },
    ],
  },
  {
    name: 'Dude Brothers Outfitters',
    domain: 'dudebrothers.example',
    city: 'Denver, CO',
    industry: 'retail',
    arr: 150_000,
    contact: { name: 'Marcus Dude', title: 'Head of Operations' },
    deals: [
      { name: 'Dude Brothers · Grooming kit program', value: 148_000, closedDaysAgo: 72, termMonths: 12 },
    ],
  },
  {
    name: 'Mahco Hardware Supply',
    domain: 'mahcohardware.example',
    city: 'Tulsa, OK',
    industry: 'manufacturing',
    arr: 145_000,
    contact: { name: 'Priya Natarajan', title: 'Category Manager' },
    deals: [
      { name: 'Mahco Hardware · Hardware pack program', value: 144_000, closedDaysAgo: 78, termMonths: 12 },
    ],
  },
  {
    name: 'Brightcart Online',
    domain: 'brightcart.example',
    city: 'Austin, TX',
    industry: 'retail',
    arr: 210_000,
    contact: { name: 'Jordan Ellis', title: 'VP of Fulfillment' },
    deals: [{ name: 'Brightcart · Order kitting', value: 210_000, closedDaysAgo: 70, termMonths: 12 }],
  },
];

/** The rate columns the program wizard reads off a won deal (crm-deal-facts names). */
export const RATE_COLUMNS = [
  {
    key: 'unit_price',
    title: 'Unit price',
    type: 'number',
    settings: { unit: '$', format: 'plain', decimals: 2, unitPosition: 'prefix' },
  },
  { key: 'monthly_fee', title: 'Monthly fee', type: 'currency', settings: { currency: 'USD', decimals: 0 } },
  { key: 'setup_fee', title: 'Setup fee', type: 'currency', settings: { currency: 'USD', decimals: 0 } },
  {
    key: 'monthly_minimum',
    title: 'Monthly minimum',
    type: 'currency',
    settings: { currency: 'USD', decimals: 0 },
  },
  { key: 'term_months', title: 'Term months', type: 'number', settings: { format: 'plain', decimals: 0 } },
] as const;

/** Adds the rate columns to the Deals board (after its last column). */
export async function addRateColumns(
  db: Executor,
  orgId: string,
  dealsBoardId: string,
  createdBy: string,
): Promise<void> {
  const existing = await db
    .select({ key: columns.key, position: columns.position })
    .from(columns)
    .where(and(eq(columns.orgId, orgId), eq(columns.boardId, dealsBoardId)));
  let last =
    existing
      .map((c) => c.position)
      .sort()
      .at(-1) ?? null;
  for (const column of RATE_COLUMNS) {
    if (existing.some((c) => c.key === column.key)) continue;
    last = positionAfter(last);
    await db.insert(columns).values({
      orgId,
      boardId: dealsBoardId,
      key: column.key,
      title: column.title,
      type: column.type,
      settings: column.settings as never,
      width: 140,
      position: last,
      createdBy,
    });
  }
}

/** Accounts, one contact each and the won program deals, connected both ways. */
export function programItems(users: UserIds, today: Date): SeedItem[] {
  const rng = createRng(PROGRAM_SEED);
  const out: SeedItem[] = [];
  for (const account of PROGRAM_ACCOUNTS) {
    const owner =
      account.name.startsWith('Gripwell') || account.name.startsWith('Brightcart') ? users.sofia : users.maya;
    const accountItem: SeedItem = {
      id: rng.uuid(),
      board: 'crm-accounts',
      group: 'customers',
      name: account.name,
      createdAt: daysAgo(today, 120 + rng.int(0, 40)),
      createdBy: owner,
      values: {
        industry: { labelIds: [account.industry] },
        size: { labelId: 's3' },
        arr: { amount: account.arr, currency: 'USD' },
        region: { labelId: 'na' },
        health: { labelId: 'healthy' },
        owner: { ids: [owner] },
        website: { url: `https://www.${account.domain}`, text: account.domain },
        hq: { address: account.city },
      },
      history: [],
    };
    out.push(accountItem);
    const [first, ...rest] = account.contact.name.split(' ');
    const contact: SeedItem = {
      id: rng.uuid(),
      board: 'crm-contacts',
      group: 'decision',
      name: account.contact.name,
      createdAt: daysAgo(today, 110),
      createdBy: owner,
      values: {
        email: { email: `${(first ?? '').toLowerCase()}.${rest.join('').toLowerCase()}@${account.domain}` },
        job_title: account.contact.title,
        type: { labelId: 'customer' },
        owner: { ids: [owner] },
        last_contacted: { date: isoDay(today, -rng.int(1, 9)) },
        account: { itemIds: [accountItem.id] },
      },
      history: [],
    };
    out.push(contact);
    accountItem.values = { ...accountItem.values, contacts: { itemIds: [contact.id] } };
    const dealIds: string[] = [];
    for (const deal of account.deals) {
      const closeDate = isoDay(today, -deal.closedDaysAgo);
      const createdAt = daysAgo(today, deal.closedDaysAgo + 45);
      const id = rng.uuid();
      dealIds.push(id);
      const rates = deal.rates;
      out.push({
        id,
        board: 'crm-deals',
        group: 'closed_won',
        name: deal.name,
        createdAt,
        createdBy: owner,
        values: {
          stage: { labelId: 'won' },
          owner: { ids: [owner] },
          deal_value: { amount: deal.value, currency: 'USD' },
          probability: 100,
          close_date: { date: closeDate },
          priority: { labelId: 'high' },
          timeline: { from: createdAt.toISOString().slice(0, 10), to: closeDate },
          source: { labelId: 'referral' },
          account: { itemIds: [accountItem.id] },
          contacts: { itemIds: [contact.id] },
          ...(rates
            ? {
                unit_price: rates.unitPrice,
                monthly_fee: { amount: rates.monthlyFee, currency: 'USD' },
                setup_fee: { amount: rates.setupFee, currency: 'USD' },
                monthly_minimum: { amount: rates.monthlyMinimum, currency: 'USD' },
                term_months: rates.termMonths,
              }
            : { term_months: deal.termMonths ?? 12 }),
        },
        history: [
          {
            columnKey: 'stage',
            before: { labelId: 'negotiation' },
            after: { labelId: 'won' },
            at: new Date(`${closeDate}T16:00:00Z`),
            by: owner,
          },
        ],
      });
    }
    accountItem.values = { ...accountItem.values, deals: { itemIds: dealIds } };
    contact.values = { ...contact.values, deals: { itemIds: dealIds } };
  }
  return out;
}

/** Northwind is licensed for CRM, Projects and Pulse (Portal shows those cards). */
export async function grantDemoApps(db: Executor, orgId: string): Promise<void> {
  for (const app of ['crm', 'projects', 'pulse'] as const) {
    await db.execute(sql`insert into core.entitlements (org_id, module, status, source) values (${orgId}::uuid, ${app}, 'active', 'manual')
      on conflict do nothing`);
  }
}
