/**
 * Shared CRM deal facts (SPEC 6.2): the pure row parser, and the SQL against a throwaway CRM board
 * when the CRM tables exist.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dealFacts, dealFactsFromRow, dealFactsMany, toDealRates, type CrmDealRow } from './crm-deal-facts';
import { createTestOrg, databaseReady, type TestOrg } from './programs/test-support';

const stageColumn = {
  key: 'stage',
  title: 'Stage',
  type: 'status',
  settings: {
    labels: [
      { id: 'lead', name: 'Lead' },
      { id: 'won', name: 'Won', isDone: true },
      { id: 'closed_won', name: 'Closed won' },
      { id: 'later', name: 'Won back later', isDone: false },
    ],
  },
};
const columns = [
  { key: 'name', title: 'Deal', type: 'name', settings: {} },
  stageColumn,
  { key: 'deal_value', title: 'Deal value', type: 'currency', settings: {} },
  { key: 'close_date', title: 'Expected close', type: 'date', settings: {} },
  { key: 'price_kit', title: 'Price per kit', type: 'number', settings: {} },
  { key: 'monthly_fee', title: 'Monthly fee', type: 'currency', settings: {} },
  { key: 'setup', title: 'Setup fee', type: 'currency', settings: {} },
  { key: 'min', title: 'Monthly minimum', type: 'currency', settings: {} },
  { key: 'term_months', title: 'Contract length', type: 'number', settings: {} },
];

const row = (values: Record<string, unknown>, extra: Partial<CrmDealRow> = {}): CrmDealRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Winter liner add on',
  board_kind: 'deals',
  values,
  columns,
  account_id: '22222222-2222-4222-8222-222222222222',
  account_name: 'Gripwell Safety Supply',
  core_customer_id: null,
  ...extra,
});

describe('dealFactsFromRow', () => {
  it('reads value, currency, stage, close date, account and rates', () => {
    const facts = dealFactsFromRow(
      row({
        stage: { labelId: 'won' },
        deal_value: { amount: 386400, currency: 'usd' },
        close_date: { date: '2026-10-30' },
        price_kit: 1.95,
        monthly_fee: { amount: 1500, currency: 'USD' },
        setup: { amount: '2,500', currency: 'USD' },
        min: { amount: 30000, currency: 'USD' },
        term_months: 12,
      }),
    );
    expect(facts).toMatchObject({
      boardKind: 'deal',
      valueCents: BigInt(38640000),
      currency: 'USD',
      won: true,
      stageLabel: 'Won',
      closeDate: '2026-10-30',
      accountItemId: '22222222-2222-4222-8222-222222222222',
      accountName: 'Gripwell Safety Supply',
    });
    expect(facts.rates).toEqual({
      unitPrice: '1.9500',
      monthlyFeeCents: BigInt(150000),
      setupFeeCents: BigInt(250000),
      monthlyMinimumCents: BigInt(3000000),
      termMonths: 12,
    });
    expect(toDealRates(facts.rates)).toEqual({ unitPrice: '1.9500', monthlyFeeCents: BigInt(150000), setupFeeCents: BigInt(250000), monthlyMinimumCents: BigInt(3000000), termMonths: 12 });
  });

  it('uses the shared won rule (done flag first, then the word won)', () => {
    expect(dealFactsFromRow(row({ stage: { labelId: 'closed_won' } })).won).toBe(true);
    expect(dealFactsFromRow(row({ stage: { labelId: 'later' } })).won).toBe(false);
    expect(dealFactsFromRow(row({ stage: { labelId: 'lead' } })).won).toBe(false);
    expect(dealFactsFromRow(row({})).won).toBe(false);
  });

  it('leaves out what it cannot read instead of guessing', () => {
    const facts = dealFactsFromRow(row({ deal_value: { amount: '1,23' }, price_kit: 'call us', term_months: 0, close_date: 'soon' }));
    expect(facts.valueCents).toBeNull();
    expect(facts.currency).toBeNull();
    expect(facts.closeDate).toBeNull();
    expect(facts.rates).toEqual({});
  });

  it('reads a unit price by the same grouping rule as the money columns', () => {
    for (const bad of ['1,95', '1.234,56', '1,2,3']) {
      const facts = dealFactsFromRow(row({ price_kit: bad, monthly_fee: { amount: bad } }));
      expect(facts.rates.unitPrice, bad).toBeUndefined();
      expect(facts.rates.monthlyFeeCents, bad).toBeUndefined();
    }
    expect(dealFactsFromRow(row({ price_kit: '$1,234.5678' })).rates.unitPrice).toBe('1234.5678');
    expect(dealFactsFromRow(row({ price_kit: ' 1.95 ' })).rates.unitPrice).toBe('1.9500');
  });

  it('reads an account as its own account', () => {
    const facts = dealFactsFromRow(row({}, { board_kind: 'accounts', name: 'Gripwell Safety Supply', columns: [], account_id: null, account_name: null, core_customer_id: '33333333-3333-4333-8333-333333333333' }));
    expect(facts).toMatchObject({ boardKind: 'account', accountItemId: '11111111-1111-4111-8111-111111111111', accountName: 'Gripwell Safety Supply', valueCents: null, won: false });
  });
});

const ready = await databaseReady(['core.organization', 'crm.items', 'crm.columns', 'crm.boards', 'crm.groups', 'crm.workspaces', 'crm.customer_links', 'core.customers']);

describe.skipIf(!ready)('dealFacts (database)', () => {
  let org: TestOrg;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    org = await createTestOrg('deal-facts');
    const [workspace] = await org.query<{ id: string }>(`insert into crm.workspaces (org_id, name, position) values ($1, 'Sales', 'a0') returning id`, [org.orgId]);
    const board = async (kind: string) =>
      (await org.query<{ id: string }>(`insert into crm.boards (org_id, workspace_id, name, kind, position) values ($1, $2, $3, $4, 'a0') returning id`, [org.orgId, workspace!.id, kind, kind]))[0]!.id;
    const deals = await board('deals');
    const accounts = await board('accounts');
    const group = async (boardId: string) =>
      (await org.query<{ id: string }>(`insert into crm.groups (org_id, board_id, title, position) values ($1, $2, 'Open', 'a0') returning id`, [org.orgId, boardId]))[0]!.id;
    const dealGroup = await group(deals);
    const accountGroup = await group(accounts);
    let position = 0;
    for (const column of columns) {
      await org.query(`insert into crm.columns (org_id, board_id, key, title, type, settings, position) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`, [
        org.orgId,
        deals,
        column.key,
        column.title,
        column.type,
        JSON.stringify(column.settings),
        `a${position++}`,
      ]);
    }
    const [account] = await org.query<{ id: string }>(`insert into crm.items (org_id, board_id, group_id, name, position) values ($1, $2, $3, 'Gripwell Safety Supply', 'a0') returning id`, [org.orgId, accounts, accountGroup]);
    ids.account = account!.id;
    const [customer] = await org.query<{ id: string }>(`insert into core.customers (org_id, name, code) values ($1, 'Gripwell Safety Supply', 'GRIP') returning id`, [org.orgId]);
    ids.customer = customer!.id;
    await org.query(`insert into crm.customer_links (core_customer_id, org_id, board_id, item_id) values ($1, $2, $3, $4)`, [customer!.id, org.orgId, accounts, account!.id]);
    const deal = async (name: string, values: Record<string, unknown>) =>
      (await org.query<{ id: string }>(`insert into crm.items (org_id, board_id, group_id, name, position, values) values ($1, $2, $3, $4, 'a1', $5::jsonb) returning id`, [org.orgId, deals, dealGroup, name, JSON.stringify(values)]))[0]!.id;
    ids.won = await deal('Winter liner add on', { stage: { labelId: 'won' }, deal_value: { amount: 386400, currency: 'USD' }, account: { itemIds: [account!.id] }, price_kit: 1.95, term_months: 12 });
    ids.open = await deal('Spring gloves', { stage: { labelId: 'lead' }, deal_value: { amount: 1000, currency: 'EUR' } });
  });
  afterAll(async () => {
    await org?.destroy();
  });

  it('reads a won deal with its account and core customer', async () => {
    const facts = await dealFacts(org.db, org.orgId, ids.won!);
    expect(facts).toMatchObject({
      name: 'Winter liner add on',
      boardKind: 'deal',
      valueCents: BigInt(38640000),
      currency: 'USD',
      won: true,
      accountItemId: ids.account,
      accountName: 'Gripwell Safety Supply',
      coreCustomerId: ids.customer,
      rates: { unitPrice: '1.9500', termMonths: 12 },
    });
  });

  it('reads many in the order asked and skips unknown ids and other orgs', async () => {
    const many = await dealFactsMany(org.db, org.orgId, [ids.open!, '00000000-0000-4000-8000-000000000000', ids.won!, ids.account!]);
    expect(many.map((facts) => [facts.itemId, facts.boardKind, facts.won, facts.currency])).toEqual([
      [ids.open, 'deal', false, 'EUR'],
      [ids.won, 'deal', true, 'USD'],
      [ids.account, 'account', false, null],
    ]);
    expect(many[2]?.coreCustomerId).toBe(ids.customer);
    expect(await dealFacts(org.db, '00000000-0000-4000-8000-000000000001', ids.won!)).toBeNull();
  });
});
