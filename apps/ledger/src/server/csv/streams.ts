/**
 * The five setup streams of docs/ledger/SPEC.md 7.1 (customers, vendors, items, chart of accounts,
 * tax rates): their columns in file order, the other header names people use (QuickBooks Online's
 * own export columns among them), and how one row reads into canonical text. Canonical text is
 * exactly what the export writes, so an exported file read back is "unchanged" row by row.
 *
 * Pure: no database. The import check (`src/server/domain/setup-import.ts`) supplies the lookups
 * (terms, tax rates and accounts of the workspace) and the rows already in Ledger.
 */
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, PULSE_COST_CATEGORIES, type AccountSubtype, type AccountType } from '@/lib/ledger-enums';
import type { MappableColumn } from '@/lib/csv/headers';
import { cleanCell, readChoice, readChoiceList, readCode, readEmail, readEmailList, readPrice, readRatePct, readText, readYesNo, ratePctText, type Read } from './cells';
import { VENDOR_KINDS as VENDOR_KIND_VALUES, type VendorKind as VendorKindValue } from '@/lib/vendor-kinds';

export const SETUP_STREAMS = ['customers', 'vendors', 'items', 'accounts', 'tax_rates'] as const;
export type SetupStream = (typeof SETUP_STREAMS)[number];

export function isSetupStream(value: unknown): value is SetupStream {
  return typeof value === 'string' && (SETUP_STREAMS as readonly string[]).includes(value);
}



export interface StreamColumn extends MappableColumn {
  readonly key: string;
  readonly label: string;
  readonly required?: boolean;
}

export interface StreamDef {
  readonly id: SetupStream;
  readonly title: string;
  /** The file name the export writes and the import expects (SPEC 7.1). */
  readonly file: string;
  readonly columns: readonly StreamColumn[];
  /** In plain words: how a row finds the record it changes. */
  readonly match: string;
}

const ADDRESS_ALIASES = {
  line1: ['address', 'street', 'address 1', 'address line 1', 'billing address', 'billing street', 'bill to', 'street address'],
  city: ['billing city', 'town'],
  state: ['billing state', 'province', 'region', 'state province'],
  postal: ['zip', 'zip code', 'postcode', 'billing zip', 'billing zip code', 'billing postal code'],
  country: ['billing country'],
};

export const STREAMS: Readonly<Record<SetupStream, StreamDef>> = {
  customers: {
    id: 'customers',
    title: 'Customers',
    file: 'customers.csv',
    match: 'By customer code, else by name.',
    columns: [
      { key: 'customer_code', label: 'Customer code', required: true, aliases: ['code', 'client code', 'customer id', 'account no', 'account number'] },
      { key: 'name', label: 'Name', required: true, aliases: ['customer', 'customer name', 'customer full name', 'company', 'company name', 'display name'] },
      { key: 'billing_contact', label: 'Invoice contact', aliases: ['contact', 'contact name', 'full name', 'billing contact name', 'attention'] },
      { key: 'billing_emails', label: 'Invoice emails', aliases: ['email', 'emails', 'email address', 'billing email', 'invoice email', 'invoice emails', 'ap email'] },
      { key: 'phone', label: 'Phone', aliases: ['phone number', 'main phone', 'telephone'] },
      { key: 'billing_address_1', label: 'Address', aliases: ADDRESS_ALIASES.line1 },
      { key: 'city', label: 'City', aliases: ADDRESS_ALIASES.city },
      { key: 'state', label: 'State', aliases: ADDRESS_ALIASES.state },
      { key: 'postal_code', label: 'Postal code', aliases: ADDRESS_ALIASES.postal },
      { key: 'country', label: 'Country', aliases: ADDRESS_ALIASES.country },
      { key: 'terms', label: 'Terms', aliases: ['payment terms', 'customer terms'] },
      { key: 'tax_exempt', label: 'Tax exempt', aliases: ['exempt', 'tax exemption'] },
      { key: 'tax_rate', label: 'Tax rate', aliases: ['default tax rate', 'sales tax rate', 'tax code'] },
      { key: 'reminders', label: 'Reminders', aliases: ['send reminders', 'reminders on'] },
      { key: 'notes', label: 'Notes', aliases: ['note', 'memo'] },
    ],
  },
  vendors: {
    id: 'vendors',
    title: 'Vendors',
    file: 'vendors.csv',
    match: 'By name.',
    columns: [
      { key: 'name', label: 'Name', required: true, aliases: ['vendor', 'vendor name', 'company', 'company name', 'display name', 'supplier'] },
      { key: 'kinds', label: 'Kinds', aliases: ['kind', 'type', 'vendor type', 'category'] },
      { key: 'email', label: 'Email', aliases: ['email address', 'contact email'] },
      { key: 'phone', label: 'Phone', aliases: ['phone number', 'main phone', 'telephone'] },
      { key: 'address_1', label: 'Address', aliases: ADDRESS_ALIASES.line1 },
      { key: 'city', label: 'City', aliases: ADDRESS_ALIASES.city },
      { key: 'state', label: 'State', aliases: ADDRESS_ALIASES.state },
      { key: 'postal_code', label: 'Postal code', aliases: ADDRESS_ALIASES.postal },
      { key: 'country', label: 'Country', aliases: ADDRESS_ALIASES.country },
      { key: 'terms', label: 'Terms', aliases: ['payment terms'] },
      { key: 'default_account', label: 'Default account', aliases: ['expense account', 'default expense account', 'account', 'account number'] },
      { key: 'tracks_1099', label: 'Tracks 1099', aliases: ['1099', '1099 tracking', 'track payments for 1099', 'eligible for 1099'] },
      { key: 'w9_on_file', label: 'W 9 on file', aliases: ['w9', 'w-9', 'w9 on file'] },
      { key: 'notes', label: 'Notes', aliases: ['note', 'memo'] },
    ],
  },
  items: {
    id: 'items',
    title: 'Items',
    file: 'items.csv',
    match: 'By item code.',
    columns: [
      { key: 'item_code', label: 'Item code', required: true, aliases: ['code', 'sku', 'item', 'product code'] },
      { key: 'name', label: 'Name', required: true, aliases: ['item name', 'product/service name', 'product service name', 'product', 'service'] },
      { key: 'description', label: 'Description', aliases: ['sales description', 'invoice description'] },
      { key: 'unit_label', label: 'Unit', aliases: ['unit', 'uom', 'unit of measure'] },
      { key: 'default_price', label: 'Default price', aliases: ['price', 'rate', 'sales price', 'sales price/rate', 'sales price rate', 'unit price'] },
      { key: 'account_number', label: 'Revenue account number', required: true, aliases: ['account', 'income account', 'revenue account', 'account no'] },
      { key: 'tax_rate', label: 'Tax rate', aliases: ['sales tax', 'tax code', 'taxable'] },
    ],
  },
  accounts: {
    id: 'accounts',
    title: 'Chart of accounts',
    file: 'accounts.csv',
    match: 'By account number.',
    columns: [
      { key: 'account_number', label: 'Account number', required: true, aliases: ['number', 'acct #', 'account no', 'acct no', 'account code', 'code'] },
      { key: 'name', label: 'Name', required: true, aliases: ['account', 'account name', 'full name'] },
      { key: 'type', label: 'Type', required: true, aliases: ['account type'] },
      { key: 'subtype', label: 'Subtype', aliases: ['detail type', 'sub type', 'account subtype'] },
      { key: 'parent_number', label: 'Parent account number', aliases: ['parent', 'parent account', 'sub account of'] },
      { key: 'description', label: 'Description', aliases: ['notes'] },
      { key: 'pulse_cost_category', label: 'Pulse cost category', aliases: ['cost category', 'pulse category'] },
    ],
  },
  tax_rates: {
    id: 'tax_rates',
    title: 'Tax rates',
    file: 'tax_rates.csv',
    match: 'By name.',
    columns: [
      { key: 'name', label: 'Name', required: true, aliases: ['tax name', 'rate name', 'tax rate name', 'sales tax'] },
      { key: 'rate_pct', label: 'Rate percent', required: true, aliases: ['rate', 'tax rate', 'percent', 'rate percent', 'rate (%)'] },
      { key: 'account_number', label: 'Account number', aliases: ['account', 'liability account', 'tax account'] },
      { key: 'agency', label: 'Agency', aliases: ['tax agency', 'authority', 'collected for'] },
    ],
  },
};

export type Canonical = Readonly<Record<string, string>>;

export interface LookupAccount {
  readonly number: string;
  readonly type: AccountType;
  readonly systemKey: string | null;
}

/** What a row may point at, by lower case name or number. Values are the canonical spelling. */
export interface Lookups {
  readonly terms: ReadonlyMap<string, string>;
  readonly taxRates: ReadonlyMap<string, string>;
  readonly accounts: ReadonlyMap<string, LookupAccount>;
}

export interface RowIssue {
  /** The column the problem is in, or null for the whole row. */
  readonly column: string | null;
  readonly message: string;
}

/** What a new record gets for a column the file does not have. */
export const CREATE_DEFAULTS: Readonly<Record<SetupStream, Canonical>> = {
  customers: { tax_exempt: 'no', reminders: 'yes' },
  vendors: { tracks_1099: 'no', w9_on_file: 'no' },
  items: {},
  accounts: {},
  tax_rates: {},
};

/** An empty canonical record (every column blank), then the stream defaults. */
export function blankRecord(stream: SetupStream): Canonical {
  const out: Record<string, string> = {};
  for (const column of STREAMS[stream].columns) out[column.key] = '';
  return { ...out, ...CREATE_DEFAULTS[stream] };
}

/** QuickBooks account types and other common words for the five types, with the subtype they imply. */
const ACCOUNT_TYPE_WORDS: Readonly<Record<string, readonly [AccountType, AccountSubtype]>> = {
  asset: ['asset', 'other_current'],
  assets: ['asset', 'other_current'],
  bank: ['asset', 'bank'],
  'accounts receivable': ['asset', 'receivable'],
  'accounts receivable a r': ['asset', 'receivable'],
  'other current assets': ['asset', 'other_current'],
  'other current asset': ['asset', 'other_current'],
  'fixed assets': ['asset', 'fixed'],
  'fixed asset': ['asset', 'fixed'],
  'other assets': ['asset', 'other'],
  liability: ['liability', 'other'],
  liabilities: ['liability', 'other'],
  'accounts payable': ['liability', 'payable'],
  'accounts payable a p': ['liability', 'payable'],
  'credit card': ['liability', 'card'],
  'other current liabilities': ['liability', 'other'],
  'other current liability': ['liability', 'other'],
  'long term liabilities': ['liability', 'other'],
  equity: ['equity', 'equity'],
  revenue: ['revenue', 'revenue'],
  income: ['revenue', 'revenue'],
  'other income': ['revenue', 'revenue'],
  expense: ['expense', 'expense'],
  expenses: ['expense', 'expense'],
  'other expense': ['expense', 'expense'],
  'cost of goods sold': ['expense', 'cost_of_service'],
  'cost of service': ['expense', 'cost_of_service'],
};

const DEFAULT_SUBTYPE: Readonly<Record<AccountType, AccountSubtype>> = {
  asset: 'other_current',
  liability: 'other',
  equity: 'equity',
  revenue: 'revenue',
  expense: 'expense',
};

function readAccountType(text: string): Read<readonly [AccountType, AccountSubtype]> {
  const key = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const found = ACCOUNT_TYPE_WORDS[key];
  if (found) return { ok: true, value: found };
  return { ok: false, message: `${text} is not an account type. Use asset, liability, equity, revenue or expense.` };
}

const KIND_ALIASES: Readonly<Record<string, VendorKindValue>> = {
  'temp agency': 'temp_agency',
  staffing: 'temp_agency',
  'staffing agency': 'temp_agency',
  freight: 'carrier',
  shipping: 'carrier',
  vendor: 'supplier',
  utilities: 'utility',
  services: 'service',
};

/** Reads the mapped cells of one row (keys are stream columns) into canonical text and its problems. */
export function readRow(stream: SetupStream, cells: Readonly<Record<string, string>>, lookups: Lookups, fileAccounts: ReadonlySet<string> = new Set()): { readonly record: Canonical; readonly issues: RowIssue[] } {
  const record: Record<string, string> = {};
  const issues: RowIssue[] = [];
  const def = STREAMS[stream];
  const take = (column: string, read: Read<string>): void => {
    if (read.ok) record[column] = read.value;
    else issues.push({ column, message: read.message });
  };
  const lookup = (column: string, text: string, map: ReadonlyMap<string, string>, what: string): void => {
    const found = map.get(text.toLowerCase());
    if (found) record[column] = found;
    else issues.push({ column, message: `${text} is not one of your ${what}.` });
  };
  const account = (column: string, text: string, wanted?: AccountType): void => {
    const found = lookups.accounts.get(text.toLowerCase());
    if (!found) {
      if (fileAccounts.has(text.toLowerCase())) record[column] = text;
      else issues.push({ column, message: `Account ${text} is not in your chart of accounts.` });
      return;
    }
    if (wanted && found.type !== wanted) issues.push({ column, message: `Account ${found.number} is not a ${wanted} account.` });
    else record[column] = found.number;
  };

  for (const column of def.columns) {
    if (!(column.key in cells)) continue;
    const text = cleanCell(cells[column.key]);
    if (text === '') {
      if (column.required) issues.push({ column: column.key, message: `${column.label} is needed.` });
      else if (!(column.key in record)) record[column.key] = CREATE_DEFAULTS[stream][column.key] ?? '';
      continue;
    }
    switch (`${stream}.${column.key}`) {
      case 'customers.customer_code':
      case 'items.item_code':
      case 'accounts.account_number':
        take(column.key, readCode(text, column.key === 'account_number' ? 20 : 40));
        break;
      case 'customers.billing_emails':
        take(column.key, readEmailList(text));
        break;
      case 'vendors.email':
        take(column.key, readEmail(text));
        break;
      case 'customers.tax_exempt':
      case 'customers.reminders':
      case 'vendors.tracks_1099':
      case 'vendors.w9_on_file':
        take(column.key, readYesNo(text));
        break;
      case 'customers.terms':
      case 'vendors.terms':
        lookup(column.key, text, lookups.terms, 'payment terms');
        break;
      case 'customers.tax_rate':
      case 'items.tax_rate':
        lookup(column.key, text, lookups.taxRates, 'tax rates');
        break;
      case 'vendors.default_account':
        account(column.key, text);
        break;
      case 'items.account_number':
        account(column.key, text, 'revenue');
        break;
      case 'tax_rates.account_number':
        account(column.key, text, 'liability');
        break;
      case 'accounts.parent_number':
        account(column.key, text);
        break;
      case 'items.default_price':
        take(column.key, readPrice(text));
        break;
      case 'tax_rates.rate_pct': {
        const rate = readRatePct(text);
        if (rate.ok) record[column.key] = ratePctText(rate.value);
        else issues.push({ column: column.key, message: rate.message });
        break;
      }
      case 'vendors.kinds': {
        const kinds = readChoiceList(text, VENDOR_KIND_VALUES, KIND_ALIASES);
        if (kinds.ok) record[column.key] = kinds.value.join(', ');
        else issues.push({ column: column.key, message: kinds.message });
        break;
      }
      case 'accounts.type': {
        const type = readAccountType(text);
        if (type.ok) {
          record[column.key] = type.value[0];
          if (!('subtype' in cells) || cleanCell(cells.subtype) === '') record.subtype = type.value[1];
        } else issues.push({ column: column.key, message: type.message });
        break;
      }
      case 'accounts.subtype': {
        const subtype = readChoice(text, ACCOUNT_SUBTYPES);
        if (subtype.ok) record[column.key] = subtype.value;
        else issues.push({ column: column.key, message: subtype.message });
        break;
      }
      case 'accounts.pulse_cost_category': {
        const category = readChoice(text, PULSE_COST_CATEGORIES);
        if (category.ok) record[column.key] = category.value;
        else issues.push({ column: column.key, message: category.message });
        break;
      }
      default:
        take(column.key, readText(text, column.key === 'notes' || column.key === 'description' ? 2000 : 200));
    }
  }
  if (stream === 'accounts' && record.type && !record.subtype) {
    record.subtype = DEFAULT_SUBTYPE[record.type as AccountType];
  }
  if (stream === 'accounts' && record.parent_number && record.parent_number.toLowerCase() === (record.account_number ?? '').toLowerCase()) {
    issues.push({ column: 'parent_number', message: 'An account cannot be its own parent.' });
  }
  return { record, issues };
}

/** The column a row is matched on (SPEC 7.1 row match). */
export const KEY_COLUMN: Readonly<Record<SetupStream, string>> = { customers: 'customer_code', vendors: 'name', items: 'item_code', accounts: 'account_number', tax_rates: 'name' };

/** The value a row is matched on, lower cased (SPEC 7.1 row match). */
export function rowKey(stream: SetupStream, record: Canonical): string {
  const key = stream === 'customers' ? record.customer_code : stream === 'items' ? record.item_code : stream === 'accounts' ? record.account_number : record.name;
  return (key ?? '').toLowerCase();
}

export { ACCOUNT_TYPES };
