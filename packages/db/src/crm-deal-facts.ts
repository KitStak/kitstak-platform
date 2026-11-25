/**
 * Shared CRM deal facts (docs/programs/SPEC.md 6.2, D10, A12): value, currency, won, close date,
 * account, core customer and the program rate columns of a CRM deal or account, read straight from
 * `crm.items`, `crm.columns` and `crm.customer_links`. CRM (`services/pulse-bridge.ts`) and
 * Projects (`integrations/crm.ts dealFactsFor`) both call it, so the won rule and the value math
 * are the same everywhere: won is the engine `isWonStage` over the stage label (`isDone` first,
 * then the whole word "won"); values go to cents with the engine `dealValueToCents`.
 *
 * Raw `sql` over a structural executor. Never throws because CRM is not installed: reads return
 * empty results and `crmDealFactsAvailable` reports false.
 */
import { sql } from 'drizzle-orm';
import { dealValueToCents, isWonStage, type DealRates } from '@kitstak/programs-engine/deal';
import { fromScaled, toScaled, type Cents } from '@kitstak/programs-engine/money';
import { plainNumber } from '@kitstak/programs-engine/variants';
import { isUuid, queryFirst, queryRows, sqlUuidList, ttlCache, type Executor } from './programs/executor';

export type { Executor } from './programs/executor';

export interface CrmDealRates {
  /** Dollars with 4 decimals ("1.9500"). */
  readonly unitPrice?: string;
  readonly monthlyFeeCents?: Cents;
  readonly setupFeeCents?: Cents;
  readonly monthlyMinimumCents?: Cents;
  readonly termMonths?: number;
}

export interface CrmDealFacts {
  readonly itemId: string;
  readonly name: string;
  readonly boardKind: 'deal' | 'account';
  /** Deal value in whole cents (deals only). */
  readonly valueCents: Cents | null;
  /** The value's currency code as stored, or null when the deal has none. */
  readonly currency: string | null;
  /** The deal's stage is won (A12). Always false for an account. */
  readonly won: boolean;
  readonly stageLabel: string | null;
  /** `YYYY-MM-DD`, from the deal's close date column. */
  readonly closeDate: string | null;
  readonly accountItemId: string | null;
  readonly accountName: string | null;
  readonly coreCustomerId: string | null;
  readonly rates: CrmDealRates;
}

/** The rate columns, matched by column key or title (case and punctuation insensitive). */
export const DEAL_RATE_COLUMN_NAMES: Readonly<Record<keyof CrmDealRates, readonly string[]>> = {
  unitPrice: ['unit price', 'price per kit', 'price per unit', 'kit price', 'rate per kit', 'unit rate'],
  monthlyFeeCents: ['monthly fee', 'management fee', 'program fee'],
  setupFeeCents: ['setup fee', 'set up fee', 'onboarding fee'],
  monthlyMinimumCents: ['monthly minimum', 'minimum monthly', 'monthly min', 'minimum'],
  termMonths: ['term months', 'term', 'term in months', 'contract months', 'contract term'],
};

const VALUE_COLUMN_NAMES = ['deal value', 'value', 'amount'];
const CLOSE_COLUMN_NAMES = ['close date', 'expected close', 'closed on', 'close'];

interface ColumnFacts {
  readonly key: string;
  readonly title: string;
  readonly type: string;
  readonly settings: unknown;
}

/** One item as the SQL reads it (exported for the unit tests). */
export interface CrmDealRow {
  readonly id: string;
  readonly name: string;
  readonly board_kind: string;
  readonly values: unknown;
  readonly columns: unknown;
  readonly account_id: string | null;
  readonly account_name: string | null;
  readonly core_customer_id: string | null;
}

const normalizeName = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  const parsed = jsonOf(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function columnsOf(value: unknown): ColumnFacts[] {
  const parsed = jsonOf(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const row = asRecord(item);
    return typeof row.key === 'string' ? [{ key: row.key, title: typeof row.title === 'string' ? row.title : '', type: String(row.type ?? ''), settings: row.settings }] : [];
  });
}

/** The first column whose key or title is one of `names` (in the order of `names`). */
function findColumn(columns: readonly ColumnFacts[], names: readonly string[], types?: readonly string[]): ColumnFacts | null {
  for (const name of names) {
    const hit = columns.find(
      (column) => (!types || types.includes(column.type)) && (normalizeName(column.key) === name || normalizeName(column.title) === name),
    );
    if (hit) return hit;
  }
  return null;
}

/** The number in a cell: a currency `{ amount }`, a number, or numeric text. */
function cellNumber(cell: unknown): string | number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'string') return cell.trim() === '' ? null : cell.trim();
  if (typeof cell === 'object') {
    const record = cell as Record<string, unknown>;
    for (const key of ['amount', 'value', 'number']) {
      const inner = record[key];
      if (typeof inner === 'number' || typeof inner === 'string') return cellNumber(inner);
    }
  }
  return null;
}

function cellCurrency(cell: unknown): string | null {
  if (cell && typeof cell === 'object' && typeof (cell as { currency?: unknown }).currency === 'string') {
    const code = ((cell as { currency: string }).currency ?? '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : null;
  }
  return null;
}

function cellDate(cell: unknown): string | null {
  const raw = typeof cell === 'string' ? cell : cell && typeof cell === 'object' ? (cell as { date?: unknown }).date : null;
  if (typeof raw !== 'string') return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function priceOf(value: string | number | null): string | undefined {
  if (value === null) return undefined;
  try {
    // The engine NUMBER grouping rule runs before anything is stripped (the same rule as
    // dealValueToCents), so a European `1,95` or `1.234,56` and a stray `1,2,3` are refused
    // instead of read 100 times too large.
    const text = typeof value === 'string' ? plainNumber(value) : value;
    if (text === null) return undefined;
    const scaled = toScaled(text, 4);
    return scaled >= BigInt(0) && scaled < BigInt(10_000_000_000) ? fromScaled(scaled, 4) : undefined;
  } catch {
    return undefined;
  }
}

function centsOf(value: string | number | null): Cents | undefined {
  if (value === null) return undefined;
  const cents = dealValueToCents(value);
  return cents !== null && cents >= BigInt(0) ? cents : undefined;
}

function termOf(value: string | number | null): number | undefined {
  if (value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 600 ? parsed : undefined;
}

/** The stage label of the item (id, name, done flag) from the board's status column settings. */
function stageOf(columns: readonly ColumnFacts[], values: Record<string, unknown>): { name: string | null; isDone: boolean | null } | null {
  const column = columns.find((item) => item.key === 'stage') ?? findColumn(columns, ['stage', 'deal stage', 'status'], ['status']);
  if (!column) return null;
  const cell = asRecord(values[column.key]);
  const labelId = typeof cell.labelId === 'string' ? cell.labelId : null;
  if (!labelId) return null;
  const labels = asRecord(column.settings).labels;
  const label = Array.isArray(labels) ? labels.map(asRecord).find((item) => item.id === labelId) : undefined;
  if (!label) return { name: null, isDone: null };
  return {
    name: typeof label.name === 'string' ? label.name : null,
    isDone: typeof label.isDone === 'boolean' ? label.isDone : null,
  };
}

/** Pure: the facts of one item row. */
export function dealFactsFromRow(row: CrmDealRow): CrmDealFacts {
  const values = asRecord(row.values);
  const columns = columnsOf(row.columns);
  const isDeal = row.board_kind === 'deals';
  const valueColumn = isDeal ? (columns.find((column) => column.key === 'deal_value') ?? findColumn(columns, VALUE_COLUMN_NAMES, ['currency', 'number'])) : null;
  const valueCell = valueColumn ? values[valueColumn.key] : undefined;
  const closeColumn = isDeal ? (columns.find((column) => column.key === 'close_date') ?? findColumn(columns, CLOSE_COLUMN_NAMES, ['date'])) : null;
  const stage = isDeal ? stageOf(columns, values) : null;

  const rates: { -readonly [K in keyof CrmDealRates]?: CrmDealRates[K] } = {};
  const rateCell = (field: keyof CrmDealRates) => {
    const column = findColumn(columns, DEAL_RATE_COLUMN_NAMES[field]);
    return column ? cellNumber(values[column.key]) : null;
  };
  const unitPrice = priceOf(rateCell('unitPrice'));
  if (unitPrice !== undefined) rates.unitPrice = unitPrice;
  const monthlyFee = centsOf(rateCell('monthlyFeeCents'));
  if (monthlyFee !== undefined) rates.monthlyFeeCents = monthlyFee;
  const setupFee = centsOf(rateCell('setupFeeCents'));
  if (setupFee !== undefined) rates.setupFeeCents = setupFee;
  const minimum = centsOf(rateCell('monthlyMinimumCents'));
  if (minimum !== undefined) rates.monthlyMinimumCents = minimum;
  const term = termOf(rateCell('termMonths'));
  if (term !== undefined) rates.termMonths = term;

  const valueNumber = cellNumber(valueCell);
  return {
    itemId: row.id,
    name: row.name,
    boardKind: isDeal ? 'deal' : 'account',
    valueCents: valueNumber === null ? null : dealValueToCents(valueNumber),
    currency: cellCurrency(valueCell),
    won: stage ? isWonStage({ isDone: stage.isDone, name: stage.name }) : false,
    stageLabel: stage?.name ?? null,
    closeDate: closeColumn ? cellDate(values[closeColumn.key]) : null,
    accountItemId: isDeal ? (row.account_id && isUuid(row.account_id) ? row.account_id : null) : row.id,
    accountName: isDeal ? row.account_name : row.name,
    coreCustomerId: row.core_customer_id,
    rates,
  };
}

/** The deal rates in the engine shape (`dealPrefill`). */
export function toDealRates(rates: CrmDealRates): DealRates {
  return {
    unitPrice: rates.unitPrice ?? null,
    monthlyFeeCents: rates.monthlyFeeCents ?? null,
    setupFeeCents: rates.setupFeeCents ?? null,
    monthlyMinimumCents: rates.monthlyMinimumCents ?? null,
    termMonths: rates.termMonths ?? null,
  };
}

const available = ttlCache<boolean>();

/** True when the CRM tables exist (cached for a minute per executor). Never throws. */
export async function crmDealFactsAvailable(db: Executor): Promise<boolean> {
  const cached = available.get(db);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    const row = await queryFirst<{ ok: boolean }>(
      db,
      sql`select (to_regclass('crm.items') is not null and to_regclass('crm.columns') is not null
                  and to_regclass('crm.boards') is not null and to_regclass('crm.customer_links') is not null) as ok`,
    );
    value = row?.ok === true;
  } catch {
    value = false;
  }
  available.set(db, value);
  return value;
}

/** Facts of several deals or accounts of the org, in the order asked. Unknown ids are left out. */
export async function dealFactsMany(db: Executor, orgId: string, itemIds: readonly string[]): Promise<CrmDealFacts[]> {
  const ids = [...new Set(itemIds.filter(isUuid))];
  if (!isUuid(orgId) || ids.length === 0) return [];
  if (!(await crmDealFactsAvailable(db))) return [];
  const rows = await queryRows<CrmDealRow>(
    db,
    sql`select i.id::text as id, i.name, b.kind::text as board_kind, i.values,
               (select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'title', c.title, 'type', c.type::text, 'settings', c.settings) order by c.position), '[]'::jsonb)
                  from crm.columns c where c.board_id = i.board_id and c.deleted_at is null) as columns,
               a.id::text as account_id, a.name as account_name,
               (select cl.core_customer_id::text from crm.customer_links cl
                 where cl.org_id = i.org_id and cl.item_id = coalesce(a.id, case when b.kind::text = 'accounts' then i.id end)
                 order by cl.core_customer_id limit 1) as core_customer_id
          from crm.items i
          join crm.boards b on b.id = i.board_id and b.deleted_at is null
          left join crm.items a on b.kind::text = 'deals' and a.id::text = i.values #>> '{account,itemIds,0}'
                                and a.org_id = i.org_id and a.deleted_at is null
         where i.org_id = ${orgId}::uuid and i.id in ${sqlUuidList(ids)} and i.deleted_at is null
           and b.kind::text in ('deals', 'accounts')`,
  );
  const byId = new Map(rows.map((row) => [row.id, dealFactsFromRow(row)]));
  return ids.flatMap((id) => {
    const facts = byId.get(id);
    return facts ? [facts] : [];
  });
}

/** Facts of one deal or account, or null when it is not a live deal or account of the org. */
export async function dealFacts(db: Executor, orgId: string, itemId: string): Promise<CrmDealFacts | null> {
  return (await dealFactsMany(db, orgId, [itemId]))[0] ?? null;
}
