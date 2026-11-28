/**
 * The People stream (docs/crew/SPEC.md section 7): its columns, the help for each, and the pure
 * reader of one row. The server resolves the codes (site, area, labor class, agency, lead) and the
 * row match; this file only turns cells into typed values with plain messages.
 *
 * Blank cells mean "keep what Crew has" on an update, so a file exported with fewer columns (a
 * supervisor never gets the pay columns) imports back with nothing changed.
 */
import { cleanCell, parseBoolean, parseChoice, parseCode, parseDate, parseEmail, parseText, type Coerced } from './coerce';
import { toScaled } from '../money';
import type { MappableColumn } from './headers';

/** Who may bring a column in: anyone with `import:run`, `person:private_read`, or `pay:manage`. */
export type ColumnRight = 'any' | 'private' | 'pay';

export interface PeopleColumn extends MappableColumn {
  readonly key: PeopleColumnKey;
  readonly label: string;
  readonly help: string;
  readonly right: ColumnRight;
  readonly examples: readonly [string, string];
}

export const PEOPLE_COLUMN_KEYS = [
  'employee_number',
  'first_name',
  'last_name',
  'preferred_name',
  'kind',
  'status',
  'site_code',
  'area_code',
  'labor_class',
  'agency',
  'agency_person_id',
  'start_date',
  'end_date',
  'email',
  'phone',
  'language',
  'lead_employee_number',
  'badge',
  'emergency_name',
  'emergency_phone',
  'pay_type',
  'overtime_exempt',
  'wage_per_hour',
] as const;
export type PeopleColumnKey = (typeof PEOPLE_COLUMN_KEYS)[number];

export const PERSON_KINDS = ['employee', 'temp', 'seasonal'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];
export const PERSON_STATUSES = ['active', 'on_leave', 'ended'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];
export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];
export const PAY_TYPES = ['hourly', 'salary'] as const;
export type PayType = (typeof PAY_TYPES)[number];

const col = (key: PeopleColumnKey, label: string, help: string, examples: readonly [string, string], extra: Partial<Pick<PeopleColumn, 'aliases' | 'required' | 'right'>> = {}): PeopleColumn => ({
  key,
  label,
  help,
  examples,
  right: extra.right ?? 'any',
  required: extra.required ?? false,
  aliases: extra.aliases ?? [],
});

export const PEOPLE_COLUMNS: readonly PeopleColumn[] = [
  col('employee_number', 'Employee number', 'The number on the time clock. Leave it empty for a temp and Crew makes one, like T-1001.', ['1024', ''], { aliases: ['number', 'employee id', 'emp no', 'emp number', 'badge number', 'id'] }),
  col('first_name', 'First name', 'Needed.', ['Maria', 'Luis'], { required: true, aliases: ['first', 'given name', 'firstname'] }),
  col('last_name', 'Last name', 'Needed.', ['Lopez', 'Ortega'], { required: true, aliases: ['last', 'surname', 'family name', 'lastname'] }),
  col('preferred_name', 'Preferred name', 'The name the person goes by, when it is not the first name.', ['', 'Lu'], { aliases: ['nickname', 'goes by'] }),
  col('kind', 'Kind', 'employee, temp or seasonal. Empty means employee, or temp when an agency is given.', ['employee', 'temp'], { aliases: ['type', 'person type', 'worker type'] }),
  col('status', 'Status', 'active, on_leave or ended. Ended needs an end date.', ['active', 'active'], { aliases: ['state'] }),
  col('site_code', 'Site code', 'The code of the home site, like MLT1. Empty means the default site.', ['MLT1', 'MLT1'], { aliases: ['site', 'home site', 'location', 'warehouse'] }),
  col('area_code', 'Area code', 'The code of the usual area at that site, like KIT1.', ['KIT1', 'RECV'], { aliases: ['area', 'usual area', 'department', 'line'] }),
  col('labor_class', 'Labor class', 'The code or name of a labor class from Settings.', ['EMP', 'TEMP'], { aliases: ['class', 'labor class code', 'job class'] }),
  col('agency', 'Agency', 'The temp agency name. A new name becomes an agency when that option is on.', ['', 'Brightway Staffing'], { aliases: ['agency name', 'staffing agency', 'vendor'] }),
  col('agency_person_id', 'Agency person id', 'The id the agency uses for this person.', ['', 'BW-5531'], { aliases: ['agency id', 'agency ref', 'agency employee id'] }),
  col('start_date', 'Start date', 'First day, like 2026-11-03.', ['2024-03-11', '2026-11-30'], { aliases: ['start', 'hire date', 'hired'] }),
  col('end_date', 'End date', 'Last day, when there is one.', ['', ''], { aliases: ['end', 'term date', 'last day'] }),
  col('email', 'Email', 'Used for schedule notices.', ['maria@example.com', ''], { aliases: ['email address', 'e-mail'] }),
  col('phone', 'Phone', 'A phone number.', ['555-0101', '555-0144'], { aliases: ['phone number', 'mobile', 'cell'] }),
  col('language', 'Language', 'en for English or es for Spanish, on the time clock.', ['en', 'es'], { aliases: ['lang', 'preferred language'] }),
  col('lead_employee_number', 'Lead employee number', 'The employee number of the person who leads them on the floor.', ['1001', '1001'], { aliases: ['lead', 'lead number', 'crew lead'] }),
  col('badge', 'Badge', 'What the badge scanner reads. Crew keeps only a hash of it, so exports leave it empty.', ['', ''], { aliases: ['badge id', 'badge code', 'card'] }),
  col('emergency_name', 'Emergency contact', 'Who to call. Needs a role that sees private details.', ['Ana Lopez', ''], { right: 'private', aliases: ['emergency contact', 'emergency contact name'] }),
  col('emergency_phone', 'Emergency phone', 'Their phone. Needs a role that sees private details.', ['555-0199', ''], { right: 'private', aliases: ['emergency contact phone'] }),
  col('pay_type', 'Pay type', 'hourly or salary. Payroll only.', ['hourly', ''], { right: 'pay', aliases: ['pay basis'] }),
  col('overtime_exempt', 'Overtime exempt', 'yes or no. Payroll only.', ['no', ''], { right: 'pay', aliases: ['exempt', 'ot exempt'] }),
  col('wage_per_hour', 'Wage per hour', 'Dollars per hour, like 19.50. Payroll only.', ['19.50', ''], { right: 'pay', aliases: ['wage', 'rate', 'hourly rate', 'pay rate'] }),
];

export const PEOPLE_COLUMN_BY_KEY: Readonly<Record<PeopleColumnKey, PeopleColumn>> = Object.fromEntries(PEOPLE_COLUMNS.map((column) => [column.key, column])) as Record<PeopleColumnKey, PeopleColumn>;

/** The columns a reader may see in a file: pay columns need pay rights, emergency columns private rights. */
export function peopleColumnsFor(rights: { readonly canSeePay: boolean; readonly canSeePrivate: boolean }): readonly PeopleColumn[] {
  return PEOPLE_COLUMNS.filter((column) => column.right === 'any' || (column.right === 'pay' ? rights.canSeePay : rights.canSeePrivate));
}

/** The typed values of one row. A key is present only when its cell was not empty. */
export interface PeopleRowValues {
  employee_number?: string;
  first_name?: string;
  last_name?: string;
  preferred_name?: string;
  kind?: PersonKind;
  status?: PersonStatus;
  site_code?: string;
  area_code?: string;
  labor_class?: string;
  agency?: string;
  agency_person_id?: string;
  start_date?: string;
  end_date?: string;
  email?: string;
  phone?: string;
  language?: Language;
  lead_employee_number?: string;
  badge?: string;
  emergency_name?: string;
  emergency_phone?: string;
  pay_type?: PayType;
  overtime_exempt?: boolean;
  /** Whole cents. */
  wage_per_hour?: number;
}

export interface CellIssue {
  readonly column: PeopleColumnKey | null;
  readonly level: 'error' | 'warning';
  readonly message: string;
}

const KIND_ALIASES: Readonly<Record<string, PersonKind>> = { emp: 'employee', staff: 'employee', full_time: 'employee', temporary: 'temp', agency: 'temp', season: 'seasonal' };
const STATUS_ALIASES: Readonly<Record<string, PersonStatus>> = { on_leave: 'on_leave', leave: 'on_leave', loa: 'on_leave', inactive: 'ended', terminated: 'ended', termed: 'ended' };
const LANGUAGE_ALIASES: Readonly<Record<string, Language>> = { english: 'en', spanish: 'es', espanol: 'es', ingles: 'en' };

function readWage(text: string): Coerced<number> {
  const plain = text.replace(/[$\s,]/g, '').replace(/\/(hr|hour|h)$/i, '');
  if (!/^\d+(\.\d+)?$/.test(plain)) return { ok: false, message: `${text} is not a wage. Use dollars per hour, like 19.50.` };
  const cents = Number(toScaled(plain, 2));
  if (cents > 1_000_000) return { ok: false, message: `${text} is more than Crew can store as a wage per hour.` };
  return { ok: true, value: cents };
}

const READERS: Readonly<Record<PeopleColumnKey, (text: string) => Coerced<string | number | boolean>>> = {
  employee_number: (text) => parseCode(text, 40),
  first_name: (text) => parseText(text, 80),
  last_name: (text) => parseText(text, 80),
  preferred_name: (text) => parseText(text, 80),
  kind: (text) => parseChoice(text, PERSON_KINDS, KIND_ALIASES),
  status: (text) => parseChoice(text, PERSON_STATUSES, STATUS_ALIASES),
  site_code: (text) => parseCode(text, 40),
  area_code: (text) => parseCode(text, 40),
  labor_class: (text) => parseCode(text, 80),
  agency: (text) => parseText(text, 120),
  agency_person_id: (text) => parseCode(text, 80),
  start_date: (text) => parseDate(text),
  end_date: (text) => parseDate(text),
  email: (text) => parseEmail(text),
  phone: (text) => parseCode(text, 40),
  language: (text) => parseChoice(text, LANGUAGES, LANGUAGE_ALIASES),
  lead_employee_number: (text) => parseCode(text, 40),
  badge: (text) => parseCode(text, 120),
  emergency_name: (text) => parseText(text, 120),
  emergency_phone: (text) => parseCode(text, 40),
  pay_type: (text) => parseChoice(text, PAY_TYPES, { salaried: 'salary', hour: 'hourly' }),
  overtime_exempt: (text) => parseBoolean(text),
  wage_per_hour: (text) => readWage(text),
};

/**
 * Reads one row of cells (keyed by column) into typed values. Rights refuse the pay and private
 * columns with a plain sentence on the cell. Never throws.
 */
export function readPeopleRow(cells: Readonly<Partial<Record<PeopleColumnKey, string>>>, rights: { readonly canManagePay: boolean; readonly canSeePrivate: boolean }): { readonly values: PeopleRowValues; readonly issues: CellIssue[] } {
  const values: Record<string, string | number | boolean> = {};
  const issues: CellIssue[] = [];
  for (const column of PEOPLE_COLUMNS) {
    const text = cleanCell(cells[column.key]);
    if (text === '') {
      if (column.required) issues.push({ column: column.key, level: 'error', message: `${column.label} is needed.` });
      continue;
    }
    if (column.right === 'pay' && !rights.canManagePay) {
      issues.push({ column: column.key, level: 'error', message: `Your role cannot bring in ${column.key}. Leave the column empty, or ask someone with payroll rights to import it.` });
      continue;
    }
    if (column.right === 'private' && !rights.canSeePrivate) {
      issues.push({ column: column.key, level: 'error', message: `Your role cannot bring in ${column.key}. Leave the column empty.` });
      continue;
    }
    const read = READERS[column.key](text);
    if (read.ok) values[column.key] = read.value;
    else issues.push({ column: column.key, level: 'error', message: read.message });
  }
  const typed = values as PeopleRowValues;
  if (typed.start_date && typed.end_date && typed.end_date < typed.start_date) issues.push({ column: 'end_date', level: 'error', message: 'The end date is before the start date.' });
  if (typed.status === 'ended' && !typed.end_date) issues.push({ column: 'end_date', level: 'error', message: 'An ended person needs an end date.' });
  if (typed.kind && typed.kind !== 'temp' && typed.agency) issues.push({ column: 'kind', level: 'error', message: `Only temps come from an agency. Set kind to temp or clear the agency.` });
  return { values: typed, issues };
}

/** "Row 14, wage_per_hour: 19,5x is not a wage." */
export function issueText(rowNumber: number, issue: Pick<CellIssue, 'column' | 'message'>): string {
  return issue.column ? `Row ${rowNumber}, ${issue.column}: ${issue.message}` : `Row ${rowNumber}: ${issue.message}`;
}
