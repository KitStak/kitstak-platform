/**
 * Raw spreadsheet string → CellValue conversion per target column type, plus status/dropdown
 * label planning (new labels with semantic auto colors).
 */
import { LABEL_COLORS, type LabelColor } from '@/server/db/schema/column-types';
import { cellValueSchemaFor, type ColumnType, type Label, type StoredCellValue } from '@/server/db/schema/cell-values';
import {
  parseBoolean,
  parseCurrency,
  parseDate,
  parseEmail,
  parseNumber,
  parsePhone,
  parseUrl,
  splitList,
  type DateOrder,
} from './parse-values';
import { COUNTRY_CODES, COUNTRY_NAMES } from './countries';
import type { ConvertResult, TargetColumn } from './types';

function labelsOf(settings: unknown): Label[] {
  const list = (settings as { labels?: unknown } | null)?.labels;
  return Array.isArray(list) ? (list as Label[]) : [];
}

const SEMANTIC: readonly [RegExp, LabelColor, boolean][] = [
  [/^(done|complete(d)?|won|closed won|finished|resolved|active|approved|paid|qualified|yes|customer|live|shipped)$/i, 'green', true],
  [/^(stuck|blocked|lost|closed lost|failed|rejected|cancel(l)?ed|churned|overdue|high|critical|urgent)$/i, 'red', false],
  [/^(working on it|in progress|working|pending|on hold|negotiation|medium|review|in review|contacted)$/i, 'orange', false],
  [/^(new|open|to do|todo|not started|lead|discovery|low|prospect|backlog)$/i, 'blue', false],
];

const AUTO_ORDER: readonly LabelColor[] = [
  'blue', 'purple', 'teal', 'pink', 'sky', 'indigo', 'lime', 'berry', 'peach', 'brown', 'dark-blue', 'yellow',
];

/** Deterministic short id (FNV-1a) so previews and the import agree on new label ids. */
export function stableLabelId(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `imp_${hash.toString(36)}`;
}

export function newLabelId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `imp_${Array.from(bytes, (byte) => (byte % 36).toString(36)).join('')}`;
}

export interface LabelPlan {
  /** Full label list to store on the column (existing + added). */
  readonly labels: Label[];
  readonly added: Label[];
}

/** Merge distinct file values into a column's labels (case-insensitive by name). */
export function planLabels(
  existingSettings: unknown,
  values: readonly string[],
  options: { readonly isStatus: boolean; readonly max?: number; readonly idFactory?: (name: string) => string },
): LabelPlan {
  const existing = labelsOf(existingSettings);
  const byName = new Set(existing.map((label) => label.name.trim().toLowerCase()));
  const used = new Set(existing.map((label) => label.color));
  const added: Label[] = [];
  const max = options.max ?? 40;
  const makeId = options.idFactory ?? (() => newLabelId());
  let position = existing.reduce((top, label) => Math.max(top, label.position + 1), 0);
  for (const raw of values) {
    const name = raw.trim().slice(0, 100);
    if (!name || byName.has(name.toLowerCase())) continue;
    if (existing.filter((label) => !label.isDefault).length + added.length >= max) break;
    const semantic = SEMANTIC.find(([pattern]) => pattern.test(name));
    let color: LabelColor | undefined = semantic?.[1];
    if (!color || (used.has(color) && !semantic)) {
      color = AUTO_ORDER.find((candidate) => !used.has(candidate)) ?? LABEL_COLORS[(position * 5) % LABEL_COLORS.length];
    }
    used.add(color);
    byName.add(name.toLowerCase());
    added.push({
      id: makeId(name),
      name,
      color,
      position: position++,
      ...(options.isStatus && semantic?.[2] ? { isDone: true } : {}),
    });
  }
  const hasDefault = existing.some((label) => label.isDefault);
  const labels = [...existing.filter((label) => !label.isDefault), ...added];
  const withDefault =
    options.isStatus && !hasDefault
      ? [...labels, { id: 'default', name: '', color: 'gray' as const, position: position, isDefault: true }]
      : [...labels, ...existing.filter((label) => label.isDefault)];
  return { labels: withDefault, added };
}

export interface ConvertContext {
  readonly dateOrder: DateOrder;
  /** Default currency when a value has no symbol. */
  readonly currency: string;
  readonly matchMember: (value: string) => string | null;
  /** Currency code given for this row (e.g. a KitStak export's "(currency)" column); wins over the column default. */
  readonly rowCurrency?: string | null;
}

const ok = (value: StoredCellValue | null): ConvertResult => ({ ok: true, value });
const fail = (message: string): ConvertResult => ({ ok: false, message });

/** Label lookup by lower-cased name, built once per column settings object. */
const labelIndex = new WeakMap<object, Map<string, Label>>();

function findLabel(column: TargetColumn, name: string): Label | undefined {
  const settings = column.settings as object | null;
  let index = settings ? labelIndex.get(settings) : undefined;
  if (!index) {
    index = new Map();
    for (const label of labelsOf(column.settings)) {
      const key = label.name.trim().toLowerCase();
      if (!label.isDefault && !index.has(key)) index.set(key, label);
    }
    if (settings) labelIndex.set(settings, index);
  }
  return index.get(name.trim().toLowerCase());
}

/** The shared schema factory builds a new schema per call; reuse one per type (hot path). */
const schemaCache = new Map<ColumnType, ReturnType<typeof cellValueSchemaFor>>();

function validateCached(type: ColumnType, value: unknown): { ok: true; value: StoredCellValue | null } | { ok: false } {
  let schema = schemaCache.get(type);
  if (!schema) {
    schema = cellValueSchemaFor(type);
    schemaCache.set(type, schema);
  }
  const result = schema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

function convertRaw(raw: string, column: TargetColumn, ctx: ConvertContext): ConvertResult {
  const value = raw.trim();
  switch (column.type) {
    case 'text':
      return ok(value.slice(0, 2_000));
    case 'long_text':
      return ok(raw.slice(0, 50_000));
    case 'status': {
      const label = findLabel(column, value);
      return label ? ok({ labelId: label.id }) : fail(`"${value}" isn't a label on this column`);
    }
    case 'dropdown': {
      const ids: string[] = [];
      for (const part of splitList(value)) {
        const label = findLabel(column, part);
        if (!label) return fail(`"${part}" isn't an option on this column`);
        if (!ids.includes(label.id)) ids.push(label.id);
      }
      return ok({ labelIds: ids });
    }
    case 'people': {
      const ids: string[] = [];
      for (const part of value.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean)) {
        const id = ctx.matchMember(parseEmail(part)?.email ?? part);
        if (!id) return fail(`No teammate matches "${part}"`);
        if (!ids.includes(id)) ids.push(id);
      }
      return ok({ ids });
    }
    case 'date': {
      const parsed = parseDate(value, ctx.dateOrder);
      return parsed ? ok(parsed) : fail(`"${value}" isn't a date we recognize`);
    }
    case 'timeline': {
      const parts = value.split(/\s+(?:-|–|to)\s+|\s*–\s*/);
      const from = parseDate(parts[0] ?? '', ctx.dateOrder);
      const to = parseDate(parts[1] ?? parts[0] ?? '', ctx.dateOrder);
      if (!from || !to) return fail(`"${value}" isn't a date range we recognize`);
      return from.date <= to.date ? ok({ from: from.date, to: to.date }) : ok({ from: to.date, to: from.date });
    }
    case 'number': {
      const number = parseNumber(value) ?? parseCurrency(value)?.amount ?? null;
      return number === null ? fail(`"${value}" isn't a number`) : ok(number);
    }
    case 'rating': {
      const number = parseNumber(value);
      if (number === null) return fail(`"${value}" isn't a rating`);
      return ok(Math.max(0, Math.min(10, Math.round(number))));
    }
    case 'currency': {
      const parsed = parseCurrency(value);
      if (!parsed) return fail(`"${value}" isn't an amount`);
      const fallback = ctx.rowCurrency ?? (column.settings as { currency?: string } | null)?.currency ?? ctx.currency;
      return ok({ amount: parsed.amount, currency: parsed.currency ?? fallback });
    }
    case 'email': {
      const parsed = parseEmail(value);
      return parsed ? ok(parsed) : fail(`"${value}" isn't a valid email`);
    }
    case 'phone': {
      const phone = parsePhone(value);
      return phone ? ok({ phone }) : fail(`"${value}" isn't a phone number`);
    }
    case 'link': {
      const url = parseUrl(value) ?? parseUrl(`https://${value}`);
      return url ? ok({ url }) : fail(`"${value}" isn't a web address`);
    }
    case 'tags': {
      const tags = [...new Set(splitList(value).map((tag) => tag.replace(/^#/, '').slice(0, 64)))].slice(0, 100);
      return ok({ tags });
    }
    case 'checkbox': {
      const bool = parseBoolean(value);
      return bool === null ? fail(`"${value}" isn't yes/no`) : ok(bool);
    }
    case 'country': {
      const upper = value.toUpperCase();
      const code = COUNTRY_CODES.has(upper) ? upper : COUNTRY_NAMES[value.toLowerCase()];
      return code ? ok({ code }) : fail(`"${value}" isn't a country we recognize`);
    }
    case 'location':
      return ok({ address: value.slice(0, 500) });
    case 'connect_boards':
      return { ok: true, value: null, links: [...new Set(splitList(value))].slice(0, 50) };
    default:
      return fail(`"${column.title}" can't be imported into`);
  }
}

/** Convert one raw value. Empty strings clear the cell (null). */
export function convertValue(raw: string, column: TargetColumn, ctx: ConvertContext): ConvertResult {
  if (raw.trim() === '') return ok(column.type === 'checkbox' ? false : null);
  const result = convertRaw(raw, column, ctx);
  if (!result.ok || result.value === null) return result;
  const checked = validateCached(column.type, result.value);
  return checked.ok ? ok(checked.value) : fail(`"${raw.trim().slice(0, 60)}" isn't valid here`);
}
