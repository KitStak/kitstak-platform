/**
 * The CSV streams of Pulse, declared once (docs/pulse/SPEC.md section 7). Each stream lists its
 * columns: the name, the kind of value, whether it is needed, other header names people use,
 * plain help text and two example values. The import screens, the templates, the "how to fill
 * this in" file, the exports and the typed records are all built from these definitions, so they
 * can never drift apart.
 *
 * The catalog of stream ids, names and file names lives in `../streams`.
 */
import { mulQuantityPrice } from '../money';
import { laborHoursFromCrew } from '../profit/labor';
import { type StreamId, streamInfo } from '../streams';

export type ColumnType =
  | 'text'
  | 'code'
  | 'email'
  | 'date'
  | 'month'
  | 'money'
  | 'price'
  | 'quantity'
  | 'hours'
  | 'headcount'
  | 'multiplier'
  | 'pace'
  | 'number'
  | 'percent'
  | 'integer'
  | 'boolean'
  | 'choice';

/** One column of a stream. */
export interface ColumnDef<K extends string = string, T extends ColumnType = ColumnType, R extends boolean = boolean, V extends string = string> {
  /** The header in templates and exports, in snake case. */
  readonly key: K;
  readonly type: T;
  /** True when a row cannot be saved without it. */
  readonly required: R;
  /** The name people see on the mapping screen. */
  readonly label: string;
  /** One plain sentence for the "how to fill this in" file. */
  readonly help: string;
  /** Other header names that map to this column on their own. */
  readonly aliases: readonly string[];
  /** Values for the two example rows of the template. */
  readonly examples: readonly [string, string];
  /** For `choice` columns: the allowed values. */
  readonly values?: readonly V[];
  /** For `choice` columns: other words people type, mapped to an allowed value. */
  readonly valueAliases?: Readonly<Record<string, V>>;
  /** Money columns are dropped from exports for readers who cannot see money. */
  readonly money?: boolean;
  /** Wage columns are dropped from exports for readers who cannot see wages. */
  readonly wage?: boolean;
  /** Money and number columns: allow values below zero. */
  readonly allowNegative?: boolean;
  /** Number columns: the value must be above zero. */
  readonly positive?: boolean;
  /** Percent columns: the highest allowed value in basis points. */
  readonly maxBp?: number;
  /** For streams with two layouts: the layout this column belongs to. No value means both. */
  readonly layout?: 'totals' | 'lines';
}

type ColumnSpec<R extends boolean, V extends string> = {
  readonly label: string;
  readonly help: string;
  readonly aliases?: readonly string[];
  readonly examples: readonly [string, string];
  readonly required?: R;
  readonly values?: readonly V[];
  readonly valueAliases?: Readonly<Record<string, V>>;
  readonly money?: boolean;
  readonly wage?: boolean;
  readonly allowNegative?: boolean;
  readonly positive?: boolean;
  readonly maxBp?: number;
  readonly layout?: 'totals' | 'lines';
};

function col<const K extends string, const T extends ColumnType, const R extends boolean = false, const V extends string = string>(key: K, type: T, spec: ColumnSpec<R, V>): ColumnDef<K, T, R, V> {
  return { ...spec, key, type, required: (spec.required ?? false) as R, aliases: spec.aliases ?? [] };
}

type Camel<S extends string> = S extends `${infer Head}_${infer Tail}` ? `${Head}${Capitalize<Camel<Tail>>}` : S;

type ValueOf<D> = D extends ColumnDef<string, infer T, boolean, infer V>
  ? T extends 'money'
    ? bigint
    : T extends 'percent' | 'integer'
      ? number
      : T extends 'boolean'
        ? boolean
        : T extends 'choice'
          ? V
          : string
  : never;

/**
 * The typed record of a list of columns. Keys are the column keys in camel case. Money is whole
 * cents (`bigint`); percents are basis points; hours, quantities and prices are fixed decimal
 * strings ready for Postgres `numeric`; dates are `YYYY-MM-DD`; a blank cell is `null`.
 */
export type RecordOf<C extends readonly ColumnDef[]> = {
  -readonly [D in C[number] as Camel<D['key']>]: D['required'] extends true ? ValueOf<D> : ValueOf<D> | null;
};

/** A cross field problem found after every cell of a row was read. */
export interface RowIssue {
  readonly level: 'error' | 'warning';
  /** The column the problem is on, or `null` for the whole row. */
  readonly column: string | null;
  /** Plain words that finish "Row 14, column: ...". */
  readonly message: string;
}

/** A row as loosely typed fields, for the cross field checks. Checks may fill in blanks. */
export type LooseRecord = Record<string, string | number | bigint | boolean | null>;

export interface StreamDef<ID extends StreamId = StreamId, C extends readonly ColumnDef[] = readonly ColumnDef[]> {
  readonly id: ID;
  readonly columns: C;
  /** Columns that tell an existing row from a new one, in plain words. */
  readonly matchRule: string;
  /** The key columns used to find the row to update. */
  readonly keyColumns: readonly string[];
  /** Columns compared by the "looks the same" check when a row has no key. Empty when the stream always has a key. */
  readonly lookAlikeColumns: readonly string[];
  /** Cross field checks. May fill computed fields on the record. `present` holds the mapped column keys. */
  readonly check?: (record: LooseRecord, present: ReadonlySet<string>) => RowIssue[];
}

function defineStream<const ID extends StreamId, const C extends readonly ColumnDef[]>(def: StreamDef<ID, C>): StreamDef<ID, C> {
  return def;
}

/* ------------------------------------------------------------------------------------------ */
/* Shared columns and lists                                                                    */
/* ------------------------------------------------------------------------------------------ */

const PARTS_OWNER_ALIASES = { we: 'us', ours: 'us', 'we buy': 'us', company: 'us', customer: 'client', 'client supplied': 'client', 'customer supplied': 'client' } as const;
const PRICING_ALIASES = { unit: 'per_unit', each: 'per_unit', piece: 'per_unit', 'per piece': 'per_unit', 'per each': 'per_unit', 'fixed price': 'fixed', flat: 'fixed', 'flat fee': 'fixed', hour: 'hourly', 'per hour': 'hourly', 'by the hour': 'hourly', 'time and materials': 'hourly' } as const;
const REASONS = ['meeting', 'training', 'cleanup', 'waiting', 'maintenance', 'break', 'other'] as const;
const REASON_ALIASES = { meetings: 'meeting', 'clean up': 'cleanup', cleaning: 'cleanup', wait: 'waiting', 'down time': 'waiting', downtime: 'waiting', idle: 'waiting', repair: 'maintenance', breaks: 'break', lunch: 'break', misc: 'other' } as const;

const ENTRY_ID_TAIL = 'Exports fill it in, so a file you export and import again updates the same rows.';

/** `blank` says what a row with no entry id does, in the words of this stream's match rule. */
const entryId = (blank = 'Leave blank to match the row by its other columns: a match updates that entry, and no match adds a new one.') =>
  col('entry_id', 'code', {
    label: 'Entry ID',
    help: `${blank} ${ENTRY_ID_TAIL}`,
    aliases: ['id', 'row id', 'pulse id'],
    examples: ['', ''],
  });

const note = (examples: readonly [string, string] = ['', '']) =>
  col('note', 'text', { label: 'Note', help: 'Anything worth remembering about this row.', aliases: ['notes', 'comment', 'comments', 'memo', 'remarks'], examples });

const siteCode = () =>
  col('site_code', 'code', { label: 'Site', help: 'The code or name of the site. Leave blank if you have one site.', aliases: ['site', 'location', 'warehouse', 'facility', 'plant', 'building'], examples: ['', ''] });

const laborClass = (examples: readonly [string, string] = ['PACK', 'PACK']) =>
  col('labor_class', 'code', {
    label: 'Labor class',
    help: 'The code or name of the labor class, like Packer or Temp packer. Leave blank to use your default class.',
    aliases: ['labor class code', 'class', 'role', 'position', 'job class', 'labor type', 'worker type'],
    examples,
  });

const overtimeHours = (examples: readonly [string, string] = ['', '4']) =>
  col('overtime_hours', 'hours', {
    label: 'Overtime hours',
    help: 'The part of the labor hours that was overtime. Leave blank if you do not split overtime by job.',
    aliases: ['ot hours', 'ot', 'overtime', 'ot hrs', 'overtime hrs'],
    examples,
  });

/* ------------------------------------------------------------------------------------------ */
/* Cross field checks                                                                          */
/* ------------------------------------------------------------------------------------------ */

function asNumber(value: unknown): number | null {
  return typeof value === 'string' && value !== '' ? Number(value) : typeof value === 'number' ? value : null;
}

function overtimeCheck(record: LooseRecord, hoursKey: string): RowIssue[] {
  const hours = asNumber(record[hoursKey]);
  const overtime = asNumber(record.overtimeHours);
  if (overtime !== null && overtime > (hours ?? 0)) return [{ level: 'error', column: 'overtime_hours', message: 'Overtime hours cannot be more than the labor hours.' }];
  return [];
}

/* ------------------------------------------------------------------------------------------ */
/* The streams                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const clients = defineStream({
  id: 'clients',
  matchRule: 'client_code, else the name',
  keyColumns: ['client_code'],
  lookAlikeColumns: [],
  columns: [
    col('client_code', 'code', { required: true, label: 'Client code', help: 'A short code you use for this client. It ties jobs, costs and revenue to the client.', aliases: ['code', 'client id', 'client number', 'customer code', 'customer id', 'customer number', 'account code', 'account number'], examples: ['ACME', 'BIRCH'] }),
    col('name', 'text', { required: true, label: 'Name', help: 'The name of the client.', aliases: ['client', 'client name', 'customer', 'customer name', 'company', 'company name', 'account', 'account name'], examples: ['Acme Outdoor Co', 'Birch and Bloom'] }),
    col('status', 'choice', { label: 'Status', help: 'active or inactive. Blank means active.', values: ['active', 'inactive'], valueAliases: { yes: 'active', open: 'active', current: 'active', no: 'inactive', closed: 'inactive', archived: 'inactive' }, examples: ['active', 'active'] }),
    col('contact_name', 'text', { label: 'Contact name', help: 'Your main contact at the client.', aliases: ['contact', 'primary contact'], examples: ['Dana Reyes', 'Sam Okafor'] }),
    col('contact_email', 'email', { label: 'Contact email', help: 'The email address of your main contact.', aliases: ['email', 'e mail', 'email address'], examples: ['dana@acme-outdoor.example', 'sam@birchbloom.example'] }),
    col('phone', 'text', { label: 'Phone', help: 'A phone number for the client.', aliases: ['phone number', 'telephone', 'tel', 'contact phone'], examples: ['+1 555 0100', '555 0142'] }),
    col('target_margin_pct', 'percent', { label: 'Target margin %', help: 'The margin you want on this client, as a percent. 28 and 28% both mean 28 percent.', aliases: ['target margin', 'margin target', 'goal margin', 'margin goal'], maxBp: 10000, examples: ['30', '28'] }),
    col('payment_terms_days', 'integer', { label: 'Payment terms (days)', help: 'How many days the client has to pay an invoice.', aliases: ['payment terms', 'terms', 'net days', 'terms days'], examples: ['30', '45'] }),
    col('parts_owner', 'choice', { label: 'Who buys the parts', help: 'us if you buy the parts, client if the client sends them. Blank follows your workspace setting.', values: ['us', 'client'], valueAliases: PARTS_OWNER_ALIASES, aliases: ['parts owner', 'who buys parts', 'materials owner', 'supplied by'], examples: ['client', 'us'] }),
    col('notes', 'text', { label: 'Notes', help: 'Anything worth remembering about this client.', aliases: ['note', 'comment', 'comments', 'memo'], examples: ['Ships on Fridays', ''] }),
  ],
});

const jobTypes = defineStream({
  id: 'job_types',
  matchRule: 'job_type_code',
  keyColumns: ['job_type_code'],
  lookAlikeColumns: [],
  columns: [
    col('job_type_code', 'code', { required: true, label: 'Job type code', help: 'A short code for this kind of work.', aliases: ['code', 'type code', 'job type', 'work type code'], examples: ['KIT', 'RELABEL'] }),
    col('name', 'text', { required: true, label: 'Name', help: 'The name of this kind of work.', aliases: ['job type name', 'type name', 'work type', 'description'], examples: ['Kitting', 'Relabeling'] }),
    col('unit_label', 'text', { label: 'Unit word', help: 'What one finished unit is called, like kit or case. Blank means units.', aliases: ['unit', 'unit name', 'unit of measure', 'uom'], examples: ['kit', 'case'] }),
    col('default_pricing_model', 'choice', { label: 'Usual pricing', help: 'How jobs of this type are usually priced: per_unit, fixed or hourly.', values: ['per_unit', 'fixed', 'hourly'], valueAliases: PRICING_ALIASES, aliases: ['pricing model', 'pricing', 'price type'], examples: ['per_unit', 'per_unit'] }),
    col('default_labor_class', 'code', { label: 'Usual labor class', help: 'The labor class that usually does this work.', aliases: ['labor class', 'class', 'role'], examples: ['PACK', 'PACK'] }),
    col('default_units_per_labor_hour', 'pace', { label: 'Usual target pace', help: 'How many units one person should finish in an hour.', positive: true, aliases: ['units per labor hour', 'units per hour', 'uph', 'target pace', 'standard', 'standard rate', 'standard uph', 'pace'], examples: ['40', '120'] }),
    col('target_margin_pct', 'percent', { label: 'Target margin %', help: 'The margin you want on this kind of work, as a percent.', aliases: ['target margin', 'margin target', 'goal margin'], maxBp: 10000, examples: ['30', '35'] }),
  ],
});

const jobs = defineStream({
  id: 'jobs',
  matchRule: 'job_number',
  keyColumns: ['job_number'],
  lookAlikeColumns: [],
  columns: [
    col('job_number', 'code', { required: true, label: 'Job number', help: 'Your number for the job. Every other file points at a job with it.', aliases: ['job', 'job no', 'job id', 'job code', 'work order', 'work order number', 'wo', 'wo number', 'order number', 'project number'], examples: ['J-1042', 'J-1043'] }),
    col('name', 'text', { required: true, label: 'Name', help: 'A short name for the job.', aliases: ['job name', 'title', 'description', 'job description'], examples: ['Holiday gift kits', 'Spring catalog relabel'] }),
    col('client_code', 'code', { required: true, label: 'Client', help: 'The code or name of the client the job is for.', aliases: ['client', 'client name', 'customer', 'customer code', 'customer name', 'account'], examples: ['ACME', 'BIRCH'] }),
    col('job_type_code', 'code', { label: 'Job type', help: 'The code or name of the kind of work. Blank means General.', aliases: ['job type', 'type', 'work type', 'category'], examples: ['KIT', 'RELABEL'] }),
    siteCode(),
    col('kind', 'choice', { label: 'One time or ongoing', help: 'one_time for a job with an end, ongoing for work that repeats every month. Blank means one_time.', values: ['one_time', 'ongoing'], valueAliases: { 'one off': 'one_time', single: 'one_time', project: 'one_time', recurring: 'ongoing', monthly: 'ongoing', program: 'ongoing', standing: 'ongoing' }, aliases: ['job kind', 'recurring'], examples: ['one_time', 'one_time'] }),
    col('status', 'choice', { label: 'Status', help: 'planned, active, on_hold, completed or cancelled. Blank means planned.', values: ['planned', 'active', 'on_hold', 'completed', 'cancelled'], valueAliases: { open: 'active', 'in progress': 'active', started: 'active', running: 'active', hold: 'on_hold', paused: 'on_hold', done: 'completed', complete: 'completed', finished: 'completed', closed: 'completed', canceled: 'cancelled', 'not started': 'planned', new: 'planned', scheduled: 'planned' }, aliases: ['job status', 'state'], examples: ['active', 'planned'] }),
    col('pricing_model', 'choice', { label: 'Pricing', help: 'per_unit (a price for each unit), fixed (one price for the job) or hourly (a bill rate for each hour).', values: ['per_unit', 'fixed', 'hourly'], valueAliases: PRICING_ALIASES, aliases: ['pricing', 'price type', 'billing type'], examples: ['per_unit', 'fixed'] }),
    col('unit_label', 'text', { label: 'Unit word', help: 'What one finished unit is called, like kit or case.', aliases: ['unit', 'unit name', 'uom', 'unit of measure'], examples: ['kit', 'case'] }),
    col('planned_units', 'quantity', { label: 'Planned units', help: 'How many units the job is for.', aliases: ['planned qty', 'planned quantity', 'order quantity', 'order qty', 'quantity', 'qty', 'units ordered', 'total units'], examples: ['5000', '12000'] }),
    col('unit_price', 'price', { money: true, label: 'Price per unit', help: 'What the client pays for one unit. Up to 4 decimal places.', aliases: ['price', 'price per unit', 'unit rate', 'sell price', 'price each', 'rate per unit'], examples: ['2.75', ''] }),
    col('fixed_price', 'money', { money: true, label: 'Fixed price', help: 'The one price for the whole job, for fixed pricing.', aliases: ['job price', 'flat price', 'total price', 'contract price'], examples: ['', '9400.00'] }),
    col('bill_rate_per_hour', 'money', { money: true, label: 'Bill rate per hour', help: 'What the client pays for one labor hour, for hourly pricing.', aliases: ['bill rate', 'billing rate', 'hourly rate', 'rate per hour'], examples: ['', ''] }),
    col('material_method', 'choice', { label: 'Material cost method', help: 'standard (a set material cost for each unit) or actual (from the materials file). Blank means standard.', values: ['standard', 'actual'], valueAliases: { std: 'standard', 'per unit': 'standard', usage: 'actual', real: 'actual' }, aliases: ['material method', 'materials method'], examples: ['standard', 'actual'] }),
    col('material_cost_per_unit', 'price', { money: true, label: 'Material cost per unit', help: 'What you pay for the parts and supplies in one unit. 0 when the client sends everything.', aliases: ['material per unit', 'material cost', 'materials per unit', 'material cost each'], examples: ['0.45', ''] }),
    col('parts_owner', 'choice', { label: 'Who buys the parts', help: 'us or client. Blank follows the client.', values: ['us', 'client'], valueAliases: PARTS_OWNER_ALIASES, aliases: ['parts owner', 'who buys parts', 'supplied by'], examples: ['', 'client'] }),
    laborClass(),
    col('units_per_labor_hour_standard', 'pace', { label: 'Target pace', help: 'How many units one person should finish in an hour on this job.', positive: true, aliases: ['units per labor hour', 'units per hour', 'uph', 'standard uph', 'target pace', 'standard', 'standard rate', 'pace'], examples: ['40', '120'] }),
    col('target_margin_pct', 'percent', { label: 'Target margin %', help: 'The margin you want on this job, as a percent. Blank follows the job type or the client.', aliases: ['target margin', 'margin target', 'goal margin'], maxBp: 10000, examples: ['30', ''] }),
    col('start_date', 'date', { label: 'Start date', help: 'The day work starts.', aliases: ['start', 'starts', 'begin date', 'start on'], examples: ['2026-11-02', '2026-12-01'] }),
    col('due_date', 'date', { label: 'Due date', help: 'The day the job is due.', aliases: ['due', 'due on', 'deadline', 'ship date', 'need by', 'end date'], examples: ['2026-12-04', '2026-12-18'] }),
    col('completed_date', 'date', { label: 'Completed date', help: 'The day the job was finished. Only for completed jobs.', aliases: ['completed', 'completed on', 'finish date', 'finished', 'date completed', 'closed date'], examples: ['', ''] }),
    col('po_number', 'code', { label: 'PO number', help: 'The purchase order number from the client.', aliases: ['po', 'purchase order', 'client po', 'customer po'], examples: ['PO-88213', ''] }),
    col('owner_email', 'email', { label: 'Owner email', help: 'The email of the person who runs this job. They must be in your workspace.', aliases: ['owner', 'job owner', 'manager email', 'account manager'], examples: ['', ''] }),
    col('kit_sku', 'code', { label: 'Kit SKU', help: 'The SKU of the finished kit, if it has one.', aliases: ['sku', 'finished sku', 'item sku', 'product sku'], examples: ['KIT-HOLIDAY-24', ''] }),
    col('notes', 'text', { label: 'Notes', help: 'Anything worth remembering about this job.', aliases: ['note', 'comment', 'comments', 'memo'], examples: ['', ''] }),
    col('wms_work_order', 'code', { label: 'Warehouse work order', help: 'The work order code in KitStak WMS, to link the job to it.', aliases: ['wms work order', 'work order code', 'wms wo'], examples: ['', ''] }),
    col('crm_deal_id', 'code', { label: 'CRM deal', help: 'The deal in KitStak CRM that this job came from.', aliases: ['deal id', 'crm deal', 'deal', 'opportunity id'], examples: ['', ''] }),
    col('project_key', 'code', { label: 'Project', help: 'The project in KitStak Projects that tracks this job.', aliases: ['project', 'project id', 'projects key'], examples: ['', ''] }),
    col('quote_units', 'quantity', { label: 'Quoted units', help: 'Units in the quote. Fill in the quote columns to make the job with its quote in one file.', aliases: ['quoted units', 'quote qty', 'quoted quantity'], examples: ['5000', ''] }),
    col('quote_revenue', 'money', { money: true, label: 'Quoted revenue', help: 'What you told the client the job would bill.', aliases: ['quoted revenue', 'quote total', 'quote amount', 'quoted amount', 'quoted price'], examples: ['13750.00', ''] }),
    col('quote_labor_hours', 'hours', { label: 'Quoted labor hours', help: 'Total labor hours in the quote (people times hours each).', aliases: ['quoted labor hours', 'quoted hours', 'quote hours', 'estimated hours'], examples: ['125', ''] }),
    col('quote_labor_cost', 'money', { money: true, label: 'Quoted labor cost', help: 'Labor cost in the quote.', aliases: ['quoted labor cost', 'quoted labor', 'estimated labor cost'], examples: ['2720.00', ''] }),
    col('quote_material_cost', 'money', { money: true, label: 'Quoted material cost', help: 'Material cost in the quote.', aliases: ['quoted material cost', 'quoted materials', 'estimated material cost'], examples: ['2250.00', ''] }),
    col('quote_other_cost', 'money', { money: true, label: 'Quoted other cost', help: 'Other costs in the quote, like freight or packaging.', aliases: ['quoted other cost', 'quoted other', 'estimated other cost'], examples: ['400.00', ''] }),
  ],
  check: (record) => {
    const issues: RowIssue[] = [];
    const start = record.startDate;
    const due = record.dueDate;
    if (typeof start === 'string' && typeof due === 'string' && due < start) issues.push({ level: 'warning', column: 'due_date', message: 'The due date is before the start date.' });
    if (record.pricingModel === 'per_unit' && record.fixedPrice !== null && record.unitPrice === null) {
      issues.push({ level: 'warning', column: 'fixed_price', message: 'This job is priced per unit, so the fixed price is not used. Set pricing_model to fixed or fill in unit_price.' });
    }
    return issues;
  },
});

const jobPlans = defineStream({
  id: 'job_plans',
  matchRule: 'One row per job: job_number and plan set the totals. One row per line: all lines of a job_number and plan in the file replace the lines of that plan.',
  keyColumns: ['job_number', 'plan'],
  lookAlikeColumns: [],
  columns: [
    col('job_number', 'code', { required: true, label: 'Job number', help: 'The job this quote or budget is for.', aliases: ['job', 'job no', 'job id', 'work order', 'wo number'], examples: ['J-1042', 'J-1042'] }),
    col('plan', 'choice', { required: true, label: 'Quote or budget', help: 'quote is what you told the client. budget is what you think it will cost you.', values: ['quote', 'budget'], valueAliases: { quoted: 'quote', estimate: 'quote', bid: 'quote', budgeted: 'budget', 'cost plan': 'budget', plan: 'budget' }, aliases: ['plan type', 'type', 'version'], examples: ['quote', 'budget'] }),
    col('units', 'quantity', { layout: 'totals', label: 'Units', help: 'Units in the plan.', aliases: ['planned units', 'plan units', 'total units'], examples: ['5000', '5000'] }),
    col('revenue', 'money', { layout: 'totals', money: true, label: 'Revenue', help: 'What the job should bill.', aliases: ['total revenue', 'sales', 'price', 'total price', 'amount billed'], examples: ['13750.00', '13750.00'] }),
    col('labor_hours', 'hours', { layout: 'totals', label: 'Labor hours', help: 'Total labor hours (people times hours each), setup hours included.', aliases: ['hours', 'total hours', 'planned hours', 'labor hrs'], examples: ['125', '130'] }),
    col('labor_cost', 'money', { layout: 'totals', money: true, label: 'Labor cost', help: 'Labor cost, setup cost included.', aliases: ['labor', 'labor amount', 'labor total'], examples: ['2720.00', '2828.80'] }),
    col('setup_hours', 'hours', { layout: 'totals', label: 'Setup hours', help: 'The part of the labor hours that is setup with no finished units.', aliases: ['setup hrs', 'changeover hours'], examples: ['4', '4'] }),
    col('setup_cost', 'money', { layout: 'totals', money: true, label: 'Setup cost', help: 'The part of the labor cost that is setup.', aliases: ['setup', 'setup amount'], examples: ['87.04', '87.04'] }),
    col('material_cost', 'money', { layout: 'totals', money: true, label: 'Material cost', help: 'Cost of the parts and supplies you buy.', aliases: ['materials', 'material', 'materials cost', 'material total'], examples: ['2250.00', '2300.00'] }),
    col('other_cost', 'money', { layout: 'totals', money: true, label: 'Other cost', help: 'Other costs, like freight, packaging or outside help.', aliases: ['other', 'other costs', 'misc cost'], examples: ['400.00', '400.00'] }),
    col('category', 'choice', { layout: 'lines', label: 'Line type', help: 'revenue, labor, setup, material or other. A file with this column is read line by line.', values: ['revenue', 'labor', 'setup', 'material', 'other'], valueAliases: { sales: 'revenue', price: 'revenue', labour: 'labor', materials: 'material', parts: 'material', misc: 'other', freight: 'other' }, aliases: ['line type', 'line category', 'cost type'], examples: ['revenue', 'labor'] }),
    col('description', 'text', { layout: 'lines', label: 'Description', help: 'What the line is for.', aliases: ['line description', 'details', 'line name'], examples: ['Holiday gift kits', 'Packers'] }),
    col('quantity', 'quantity', { layout: 'lines', label: 'Quantity', help: 'How many units, hours or pieces.', aliases: ['qty', 'count'], examples: ['5000', '121'] }),
    col('unit', 'choice', { layout: 'lines', label: 'Counted in', help: 'unit (finished units), hour, each or flat.', values: ['unit', 'hour', 'each', 'flat'], valueAliases: { units: 'unit', hours: 'hour', hr: 'hour', hrs: 'hour', ea: 'each', piece: 'each', pieces: 'each', lump: 'flat', 'lump sum': 'flat' }, aliases: ['uom', 'unit of measure', 'per'], examples: ['unit', 'hour'] }),
    col('unit_amount', 'price', { layout: 'lines', money: true, label: 'Amount for one', help: 'The price or cost for one unit, hour or piece.', aliases: ['unit price', 'unit cost', 'rate', 'price each', 'cost each'], examples: ['2.75', '21.76'] }),
    col('amount', 'money', { layout: 'lines', money: true, allowNegative: true, label: 'Line amount', help: 'The total for the line. Blank means quantity times the amount for one.', aliases: ['line amount', 'line total', 'total', 'extended amount', 'ext amount'], examples: ['13750.00', '2632.96'] }),
    col('labor_class', 'code', { layout: 'lines', label: 'Labor class', help: 'For labor lines: the labor class.', aliases: ['class', 'role', 'labor class code'], examples: ['', 'PACK'] }),
    col('service_code', 'code', { layout: 'lines', label: 'Service', help: 'For a line that is an extra service: the service code.', aliases: ['service', 'vas code', 'vas'], examples: ['', ''] }),
    col('item_sku', 'code', { layout: 'lines', label: 'Item SKU', help: 'For material lines: the SKU of the part.', aliases: ['sku', 'item', 'part number', 'part'], examples: ['', ''] }),
  ],
  check: (record, present) => {
    if (!present.has('category')) return [];
    const issues: RowIssue[] = [];
    if (record.category === null) issues.push({ level: 'error', column: 'category', message: 'This column is needed and the cell is empty. Use revenue, labor, setup, material or other.' });
    if (record.amount === null) {
      const quantity = typeof record.quantity === 'string' ? record.quantity : null;
      const unitAmount = typeof record.unitAmount === 'string' ? record.unitAmount : null;
      if (quantity !== null && unitAmount !== null) {
        record.amount = mulQuantityPrice(quantity, unitAmount);
      } else {
        issues.push({ level: 'error', column: 'amount', message: 'Fill in the line amount, or both the quantity and the amount for one.' });
      }
    }
    return issues;
  },
});

const production = defineStream({
  id: 'production',
  matchRule: 'entry_id, else job_number, work_date, shift and labor_class',
  keyColumns: ['job_number', 'work_date', 'shift', 'labor_class'],
  lookAlikeColumns: [],
  columns: [
    entryId('Leave blank and a row with the same job, day, shift and labor class updates that entry. No match adds a new one.'),
    col('work_date', 'date', { required: true, label: 'Work date', help: 'The day the work was done.', aliases: ['date', 'day', 'production date', 'shift date', 'entry date'], examples: ['2026-11-02', '2026-11-03'] }),
    col('job_number', 'code', { required: true, label: 'Job number', help: 'The job the work was for.', aliases: ['job', 'job no', 'job id', 'work order', 'wo', 'wo number', 'order number'], examples: ['J-1042', 'J-1042'] }),
    col('shift', 'code', { label: 'Shift', help: 'The shift, like day or night. Blank means day.', aliases: ['shift name'], examples: ['day', 'day'] }),
    laborClass(),
    col('units_good', 'quantity', { required: true, label: 'Good units', help: 'How many good units were finished.', aliases: ['good units', 'units', 'units finished', 'qty finished', 'quantity finished', 'units completed', 'qty completed', 'kits finished', 'kits', 'units produced', 'qty produced', 'output', 'good qty', 'quantity good', 'qty good', 'finished units', 'completed'], examples: ['600', '720'] }),
    col('units_scrap', 'quantity', { label: 'Scrap units', help: 'Units that were thrown away.', aliases: ['scrap', 'scrapped', 'scrap qty', 'rejects', 'rejected', 'bad units', 'defects', 'waste'], examples: ['12', '5'] }),
    col('units_rework', 'quantity', { label: 'Rework units', help: 'Units that had to be done again.', aliases: ['rework', 'reworked', 'rework qty', 'redo'], examples: ['', '8'] }),
    col('people', 'headcount', { label: 'People', help: 'How many people worked on it.', aliases: ['headcount', 'head count', 'crew', 'crew size', 'workers', 'staff', 'employees', 'operators', 'hc'], examples: ['3', '3'] }),
    col('hours_each', 'hours', { label: 'Hours each', help: 'How many hours each person worked.', aliases: ['hours per person', 'hrs each', 'shift hours', 'shift length', 'hours worked each'], examples: ['8', '8'] }),
    col('labor_hours', 'hours', { label: 'Labor hours', help: 'Total labor hours: people times hours each. Leave blank and Pulse works it out. Type it for an uneven crew.', aliases: ['hours', 'total hours', 'man hours', 'person hours', 'total labor hours', 'labor hrs', 'hrs', 'hours worked'], examples: ['', '24'] }),
    overtimeHours(),
    col('setup_hours', 'hours', { label: 'Setup hours', help: 'The part of the labor hours spent on setup with no finished units. They cost the same and stay out of pace.', aliases: ['setup', 'setup hrs', 'changeover hours', 'changeover', 'prep hours'], examples: ['', ''] }),
    note(['First day of the run', '']),
  ],
  check: (record) => {
    const issues: RowIssue[] = [];
    if (record.laborHours === null) {
      const people = asNumber(record.people);
      const each = asNumber(record.hoursEach);
      if (people !== null && each !== null) record.laborHours = laborHoursFromCrew(String(record.people), String(record.hoursEach)).toFixed(2);
    }
    issues.push(...overtimeCheck(record, 'laborHours'));
    if ((asNumber(record.hoursEach) ?? 0) > 24) issues.push({ level: 'warning', column: 'hours_each', message: 'One person cannot work more than 24 hours in a day. Check the hours each.' });
    const setup = asNumber(record.setupHours);
    if (setup !== null && setup > (asNumber(record.laborHours) ?? 0)) issues.push({ level: 'error', column: 'setup_hours', message: 'Setup hours cannot be more than the labor hours.' });
    if (asNumber(record.unitsGood) !== null && (asNumber(record.unitsGood) ?? 0) > 0 && record.laborHours === null) {
      issues.push({ level: 'warning', column: 'labor_hours', message: 'This row has units and no hours, so its labor cost is missing. Add people and hours each, or the labor hours.' });
    }
    return issues;
  },
});

const laborRates = defineStream({
  id: 'labor_rates',
  matchRule: 'labor_class_code, site_code and effective_from',
  keyColumns: ['labor_class_code', 'site_code', 'effective_from'],
  lookAlikeColumns: [],
  columns: [
    col('labor_class_code', 'code', { required: true, label: 'Labor class code', help: 'A short code for the labor class, like PACK or LEAD.', aliases: ['labor class', 'class', 'class code', 'code', 'role', 'position', 'job class'], examples: ['PACK', 'TEMP'] }),
    col('labor_class_name', 'text', { label: 'Labor class name', help: 'The name of the labor class.', aliases: ['class name', 'name', 'role name', 'title'], examples: ['Packer', 'Temp packer'] }),
    col('kind', 'choice', { label: 'Employee or temp agency', help: 'employee for your own people, temp_agency for agency staff. Blank means employee.', values: ['employee', 'temp_agency'], valueAliases: { staff: 'employee', w2: 'employee', internal: 'employee', temp: 'temp_agency', agency: 'temp_agency', 'temp agency': 'temp_agency', contractor: 'temp_agency' }, aliases: ['type', 'worker type', 'employment type'], examples: ['employee', 'temp_agency'] }),
    siteCode(),
    col('effective_from', 'date', { required: true, label: 'Starts on', help: 'The first day this rate applies. Earlier work keeps the earlier rate.', aliases: ['effective date', 'effective', 'start date', 'from', 'starts', 'valid from', 'as of'], examples: ['2026-01-01', '2026-01-01'] }),
    col('wage_per_hour', 'money', { required: true, wage: true, money: true, label: 'Wage per hour', help: 'The hourly wage. For a temp agency class, the rate the agency bills you.', aliases: ['wage', 'hourly wage', 'pay rate', 'base rate', 'base wage', 'hourly rate', 'rate', 'wage rate'], examples: ['16.00', '24.50'] }),
    col('payroll_tax_pct', 'percent', { wage: true, label: 'Payroll taxes and workers comp %', help: 'Payroll taxes and workers comp, as a percent of the wage.', aliases: ['payroll tax', 'payroll taxes', 'tax pct', 'taxes', 'tax rate', 'employer taxes'], maxBp: 50000, examples: ['9', '0'] }),
    col('benefits_pct', 'percent', { wage: true, label: 'Benefits and paid time off %', help: 'Benefits and paid time off, as a percent of the wage.', aliases: ['benefits', 'benefit pct', 'benefits rate', 'fringe', 'fringe pct'], maxBp: 50000, examples: ['12', '0'] }),
    col('other_burden_pct', 'percent', { wage: true, label: 'Other %', help: 'Any other cost on top of the wage, as a percent of the wage.', aliases: ['other burden', 'other pct', 'burden', 'burden pct'], maxBp: 50000, examples: ['0', '0'] }),
    col('overhead_per_hour', 'money', { wage: true, money: true, label: 'Overhead per hour', help: 'Rent, supervision and other overhead you spread on each labor hour.', aliases: ['overhead', 'overhead rate', 'oh per hour', 'overhead per labor hour'], examples: ['2.40', '2.40'] }),
    col('overtime_multiplier', 'multiplier', { wage: true, label: 'Overtime multiplier', help: 'How much more an overtime hour pays. 1.5 means time and a half.', aliases: ['ot multiplier', 'overtime rate', 'ot rate', 'ot factor', 'overtime factor'], examples: ['1.5', '1.5'] }),
    col('bill_rate_per_hour', 'money', { money: true, label: 'Bill rate per hour', help: 'What you bill a client for an hour of this class on hourly jobs.', aliases: ['bill rate', 'billing rate', 'billable rate', 'charge rate'], examples: ['38.00', '38.00'] }),
    note(['2026 rates', 'Agency: Ready Staff']),
  ],
});

const indirectTime = defineStream({
  id: 'indirect_time',
  matchRule: 'entry_id, else a row with the same work_date, site, labor_class, reason and labor_hours looks the same',
  keyColumns: [],
  lookAlikeColumns: ['work_date', 'site_code', 'labor_class', 'reason', 'labor_hours'],
  columns: [
    entryId('Leave blank to add a new row. A row with the same day, site, labor class, reason and hours as one already here is left out, so time is not counted twice.'),
    col('work_date', 'date', { required: true, label: 'Work date', help: 'The day of the time.', aliases: ['date', 'day', 'entry date'], examples: ['2026-11-02', '2026-11-03'] }),
    siteCode(),
    laborClass(),
    col('reason', 'choice', { required: true, label: 'Reason', help: 'Why the time was not on a job: meeting, training, cleanup, waiting, maintenance, break or other.', values: REASONS, valueAliases: REASON_ALIASES, aliases: ['type', 'category', 'activity', 'code', 'indirect reason', 'indirect code'], examples: ['meeting', 'cleanup'] }),
    col('people', 'headcount', { label: 'People', help: 'How many people.', aliases: ['headcount', 'head count', 'crew', 'workers', 'staff'], examples: ['12', '3'] }),
    col('labor_hours', 'hours', { required: true, label: 'Labor hours', help: 'Total labor hours: people times hours each.', aliases: ['hours', 'total hours', 'man hours', 'person hours', 'hrs', 'indirect hours'], examples: ['6', '4.5'] }),
    overtimeHours(['', '']),
    note(['Monday safety meeting', '']),
  ],
  check: (record) => overtimeCheck(record, 'laborHours'),
});

const paidHours = defineStream({
  id: 'paid_hours',
  matchRule: 'work_date, site_code and labor_class',
  keyColumns: ['work_date', 'site_code', 'labor_class'],
  lookAlikeColumns: [],
  columns: [
    col('work_date', 'date', { required: true, label: 'Work date', help: 'The day the hours were paid for.', aliases: ['date', 'day', 'pay date', 'payroll date'], examples: ['2026-11-02', '2026-11-03'] }),
    siteCode(),
    laborClass(),
    col('paid_hours', 'hours', { required: true, label: 'Paid hours', help: 'Total hours payroll paid for that day.', aliases: ['hours', 'hours paid', 'total hours', 'payroll hours', 'clock hours', 'hrs'], examples: ['104', '98.5'] }),
    col('paid_amount', 'money', { wage: true, money: true, label: 'Paid amount', help: 'Gross pay for those hours, if you have it. It makes the payroll check exact.', aliases: ['amount', 'gross pay', 'pay', 'pay amount', 'gross', 'wages', 'payroll amount', 'total pay'], examples: ['1664.00', '1576.00'] }),
  ],
});

const timePunches = defineStream({
  id: 'time_punches',
  matchRule: 'entry_id, else employee_id, work_date, job_number or reason, and labor_class',
  keyColumns: ['employee_id', 'work_date', 'job_number', 'reason', 'labor_class'],
  lookAlikeColumns: [],
  columns: [
    entryId('Leave blank and a row with the same employee, day, job or reason, and labor class updates that entry. No match adds a new one.'),
    col('employee_id', 'code', { required: true, label: 'Employee ID', help: 'The ID of the person in your time clock or payroll system.', aliases: ['employee', 'employee number', 'employee no', 'emp id', 'emp no', 'badge', 'badge number', 'badge id', 'worker id', 'payroll id', 'associate id'], examples: ['E-1001', 'E-1002'] }),
    col('employee_name', 'text', { label: 'Employee name', help: 'The name of the person. Pulse uses it only to roll the hours up.', aliases: ['name', 'worker', 'worker name', 'associate', 'associate name', 'full name'], examples: ['Jordan Lee', 'Priya Shah'] }),
    col('work_date', 'date', { required: true, label: 'Work date', help: 'The day of the hours.', aliases: ['date', 'day', 'punch date', 'shift date', 'clock date'], examples: ['2026-11-02', '2026-11-02'] }),
    siteCode(),
    col('job_number', 'code', { label: 'Job number', help: 'The job the hours were on. Leave blank and fill in reason for time not on a job. Leave both blank for paid time on no job.', aliases: ['job', 'job no', 'job id', 'work order', 'wo', 'wo number', 'cost code', 'project'], examples: ['J-1042', ''] }),
    col('reason', 'choice', { label: 'Reason', help: 'For hours not on a job: meeting, training, cleanup, waiting, maintenance, break or other.', values: REASONS, valueAliases: REASON_ALIASES, aliases: ['indirect reason', 'activity', 'task', 'indirect code'], examples: ['', 'training'] }),
    laborClass(),
    col('hours', 'hours', { required: true, label: 'Hours', help: 'Hours this person worked on that job or reason that day.', aliases: ['hours worked', 'total hours', 'hrs', 'worked hours', 'duration', 'time', 'paid hours', 'reg hours'], examples: ['8', '2.5'] }),
    overtimeHours(['1', '']),
    col('pay_amount', 'money', { wage: true, money: true, label: 'Pay amount', help: 'Gross pay for these hours, if your file has it.', aliases: ['pay', 'gross pay', 'amount', 'wages', 'gross', 'earnings', 'total pay'], examples: ['136.00', '40.00'] }),
  ],
  check: (record) => {
    const issues = overtimeCheck(record, 'hours');
    if (record.jobNumber !== null && record.reason !== null) issues.push({ level: 'error', column: 'reason', message: 'Fill in job_number or reason, not both.' });
    return issues;
  },
});

const materials = defineStream({
  id: 'materials',
  matchRule: 'entry_id, else job_number, usage_date, item_sku and lot when lot is set, else a row with the same job_number, usage_date, item_sku, quantity_used and unit_cost looks the same',
  keyColumns: ['job_number', 'usage_date', 'item_sku', 'lot'],
  lookAlikeColumns: ['job_number', 'usage_date', 'item_sku', 'quantity_used', 'unit_cost'],
  columns: [
    entryId('Leave blank and a row with the same job, date, item and lot updates that entry. With no lot, a row with the same job, date, item, quantity and cost as one already here is left out.'),
    col('usage_date', 'date', { required: true, label: 'Usage date', help: 'The day the parts were used.', aliases: ['date', 'day', 'work date', 'issue date', 'transaction date', 'used on'], examples: ['2026-11-02', '2026-11-02'] }),
    col('job_number', 'code', { required: true, label: 'Job number', help: 'The job the parts were used on.', aliases: ['job', 'job no', 'job id', 'work order', 'wo', 'wo number'], examples: ['J-1042', 'J-1042'] }),
    col('item_sku', 'code', { required: true, label: 'Item SKU', help: 'The SKU or part number.', aliases: ['sku', 'item', 'item number', 'item code', 'part', 'part number', 'part no', 'material', 'component', 'product code'], examples: ['BOX-12X9', 'TISSUE-RED'] }),
    col('item_name', 'text', { label: 'Item name', help: 'The name of the part.', aliases: ['name', 'description', 'item description', 'part name', 'material name'], examples: ['Gift box 12 x 9', 'Red tissue paper'] }),
    col('quantity_used', 'quantity', { required: true, label: 'Quantity used', help: 'How many were used in good units.', aliases: ['qty used', 'used', 'quantity', 'qty', 'usage', 'consumed', 'qty consumed', 'issued', 'qty issued'], examples: ['600', '1200'] }),
    col('quantity_scrapped', 'quantity', { label: 'Quantity scrapped', help: 'How many were thrown away.', aliases: ['qty scrapped', 'scrapped', 'scrap', 'scrap qty', 'waste', 'damaged'], examples: ['8', ''] }),
    col('quantity_planned', 'quantity', { label: 'Quantity planned', help: 'How many the whole job should need. Pulse uses it to guess the material cost still to come.', aliases: ['qty planned', 'planned', 'planned qty', 'required', 'qty required', 'bom qty'], examples: ['5000', '10000'] }),
    col('unit_cost', 'price', { required: true, money: true, label: 'Unit cost', help: 'What you pay for one. Use 0 for parts the client sends. Up to 4 decimal places.', aliases: ['cost', 'cost each', 'cost per unit', 'price', 'unit price', 'each', 'avg cost', 'average cost'], examples: ['0.62', '0.035'] }),
    col('uom', 'text', { label: 'Counted in', help: 'How the part is counted, like each, roll or case.', aliases: ['unit', 'unit of measure', 'units', 'um'], examples: ['each', 'sheet'] }),
    col('lot', 'code', { label: 'Lot', help: 'The lot or batch number, if you track it.', aliases: ['lot number', 'lot no', 'batch', 'batch number'], examples: ['', ''] }),
    col('supplied_by', 'choice', { label: 'Who bought it', help: 'us or client. Blank follows the item, then the job.', values: ['us', 'client'], valueAliases: PARTS_OWNER_ALIASES, aliases: ['supplier', 'owner', 'parts owner', 'bought by', 'provided by'], examples: ['us', 'us'] }),
    note(),
  ],
});

const items = defineStream({
  id: 'items',
  matchRule: 'item_sku',
  keyColumns: ['item_sku'],
  lookAlikeColumns: [],
  columns: [
    col('item_sku', 'code', { required: true, label: 'Item SKU', help: 'The SKU or part number.', aliases: ['sku', 'item', 'item number', 'item code', 'part', 'part number', 'part no', 'product code'], examples: ['BOX-12X9', 'TISSUE-RED'] }),
    col('name', 'text', { required: true, label: 'Name', help: 'The name of the part.', aliases: ['item name', 'description', 'item description', 'part name'], examples: ['Gift box 12 x 9', 'Red tissue paper'] }),
    col('uom', 'text', { label: 'Counted in', help: 'How the part is counted, like each, roll or case. Blank means each.', aliases: ['unit', 'unit of measure', 'units', 'um'], examples: ['each', 'sheet'] }),
    col('unit_cost', 'price', { money: true, label: 'Unit cost', help: 'What you pay for one. Up to 4 decimal places.', aliases: ['cost', 'cost each', 'cost per unit', 'price', 'standard cost', 'avg cost', 'average cost'], examples: ['0.62', '0.035'] }),
    col('supplied_by', 'choice', { label: 'Who buys it', help: 'us or client. Blank follows the job.', values: ['us', 'client'], valueAliases: PARTS_OWNER_ALIASES, aliases: ['supplier', 'owner', 'parts owner', 'bought by'], examples: ['us', 'us'] }),
    col('client_code', 'code', { label: 'Client', help: 'The client this part belongs to, if it is only for one client.', aliases: ['client', 'customer', 'customer code', 'owner code'], examples: ['ACME', ''] }),
  ],
});

const costs = defineStream({
  id: 'costs',
  matchRule: 'entry_id, else the job, client or company with cost_date, category and reference when reference is set, else a row with the same job, client or company, cost_date, category and amount looks the same',
  keyColumns: ['job_number', 'client_code', 'cost_date', 'category', 'reference'],
  lookAlikeColumns: ['job_number', 'client_code', 'cost_date', 'category', 'amount'],
  columns: [
    entryId('Leave blank and a row with the same job, client or company, date, category and reference updates that entry. With no reference, a row with the same date, category and amount as one already here is left out.'),
    col('cost_date', 'date', { required: true, label: 'Cost date', help: 'The day of the cost.', aliases: ['date', 'day', 'invoice date', 'bill date', 'expense date', 'posting date', 'transaction date'], examples: ['2026-11-05', '2026-11-01'] }),
    col('job_number', 'code', { label: 'Job number', help: 'The job the cost is for. Leave job_number and client_code blank for a company cost like rent.', aliases: ['job', 'job no', 'job id', 'work order', 'wo', 'wo number'], examples: ['J-1042', ''] }),
    col('client_code', 'code', { label: 'Client', help: 'The client the cost is for, when it is not for one job.', aliases: ['client', 'customer', 'customer code', 'client name', 'customer name'], examples: ['', ''] }),
    siteCode(),
    col('category', 'choice', { required: true, label: 'Category', help: 'freight, packaging, equipment, outside_service, rework, supplies, storage, rent, utilities, salaried_staff, insurance or other.', values: ['freight', 'packaging', 'equipment', 'outside_service', 'rework', 'supplies', 'storage', 'rent', 'utilities', 'salaried_staff', 'insurance', 'other'], valueAliases: { shipping: 'freight', delivery: 'freight', postage: 'freight', boxes: 'packaging', 'outside services': 'outside_service', 'outside help': 'outside_service', subcontractor: 'outside_service', contractor: 'outside_service', supply: 'supplies', lease: 'rent', utility: 'utilities', power: 'utilities', electric: 'utilities', salaries: 'salaried_staff', salary: 'salaried_staff', 'salaried staff': 'salaried_staff', misc: 'other', miscellaneous: 'other' }, aliases: ['type', 'cost type', 'cost category', 'expense type', 'expense category', 'account', 'gl account'], examples: ['freight', 'rent'] }),
    col('amount', 'money', { required: true, money: true, allowNegative: true, label: 'Amount', help: 'The cost. A vendor credit is a negative amount, like -45.00.', aliases: ['cost', 'total', 'expense', 'value', 'cost amount', 'net amount', 'debit'], examples: ['385.00', '14500.00'] }),
    col('vendor', 'text', { label: 'Vendor', help: 'Who you paid.', aliases: ['supplier', 'payee', 'vendor name', 'paid to', 'carrier'], examples: ['Northline Freight', 'Harbor Property Group'] }),
    col('reference', 'code', { label: 'Reference', help: 'The bill or invoice number. With it, a second import updates the row and does not add it twice.', aliases: ['ref', 'reference number', 'invoice number', 'invoice no', 'bill number', 'document number', 'doc number'], examples: ['NF-20417', 'RENT-2026-11'] }),
    note(),
  ],
});

const revenue = defineStream({
  id: 'revenue',
  matchRule: 'entry_id, else the job or client with invoice_number and description when invoice_number is set, else a row with the same job or client, revenue_date, kind and amount looks the same',
  keyColumns: ['job_number', 'client_code', 'invoice_number', 'description'],
  lookAlikeColumns: ['job_number', 'client_code', 'revenue_date', 'kind', 'amount'],
  columns: [
    entryId('Leave blank and a row with the same job or client, invoice number and description updates that entry. With no invoice number, a row with the same date, kind and amount as one already here is left out.'),
    col('revenue_date', 'date', { required: true, label: 'Revenue date', help: 'The day of the invoice, fee, adjustment or credit.', aliases: ['date', 'day', 'invoice date', 'bill date', 'posting date', 'transaction date'], examples: ['2026-11-07', '2026-11-12'] }),
    col('job_number', 'code', { label: 'Job number', help: 'The job the money is for. Fill in job_number or client_code.', aliases: ['job', 'job no', 'job id', 'work order', 'wo', 'wo number'], examples: ['J-1042', ''] }),
    col('client_code', 'code', { label: 'Client', help: 'The client the money is for, when it is not for one job.', aliases: ['client', 'customer', 'customer code', 'client name', 'customer name', 'bill to'], examples: ['', 'ACME'] }),
    col('kind', 'choice', { required: true, label: 'Kind', help: 'invoice (what you billed, a memo that never changes profit), fee, adjustment or credit.', values: ['invoice', 'fee', 'adjustment', 'credit'], valueAliases: { invoices: 'invoice', billed: 'invoice', bill: 'invoice', fees: 'fee', surcharge: 'fee', charge: 'fee', adjust: 'adjustment', adj: 'adjustment', credits: 'credit', 'credit memo': 'credit', refund: 'credit', discount: 'credit' }, aliases: ['type', 'revenue type', 'transaction type', 'line type'], examples: ['invoice', 'fee'] }),
    col('description', 'text', { label: 'Description', help: 'What the line is for.', aliases: ['details', 'line description', 'item', 'item description'], examples: ['Holiday gift kits, week 1', 'Rush fee'] }),
    col('quantity', 'quantity', { label: 'Quantity', help: 'How many, if the line has a quantity.', aliases: ['qty', 'units', 'count'], examples: ['3000', ''] }),
    col('unit_price', 'price', { money: true, label: 'Price for one', help: 'The price for one, if the line has a quantity.', aliases: ['price', 'rate', 'price each', 'unit rate'], examples: ['2.75', ''] }),
    col('amount', 'money', { required: true, money: true, allowNegative: true, label: 'Amount', help: 'The total for the row. Credits take money off, so they are negative.', aliases: ['total', 'revenue', 'line amount', 'line total', 'invoice amount', 'net amount', 'extended amount', 'credit amount'], examples: ['8250.00', '150.00'] }),
    col('invoice_number', 'code', { label: 'Invoice number', help: 'Your invoice number. With it, a second import updates the row and does not add it twice.', aliases: ['invoice', 'invoice no', 'inv number', 'inv no', 'document number', 'doc number', 'reference'], examples: ['INV-5001', ''] }),
    col('service_code', 'code', { label: 'Service', help: 'The extra service the line is for, if any.', aliases: ['service', 'vas code', 'vas'], examples: ['', ''] }),
    note(),
  ],
  check: (record) => {
    const issues: RowIssue[] = [];
    if (record.jobNumber === null && record.clientCode === null) issues.push({ level: 'error', column: 'job_number', message: 'Fill in job_number or client_code. Revenue has to belong to a job or a client.' });
    if (record.kind === 'credit' && typeof record.amount === 'bigint' && record.amount > BigInt(0)) {
      record.amount = -record.amount;
      issues.push({ level: 'warning', column: 'amount', message: 'A credit takes money off, so this amount was read as a negative number.' });
    }
    return issues;
  },
});

const services = defineStream({
  id: 'services',
  matchRule: 'service_code',
  keyColumns: ['service_code'],
  lookAlikeColumns: [],
  columns: [
    col('service_code', 'code', { required: true, label: 'Service code', help: 'A short code for the extra service.', aliases: ['code', 'service', 'vas code', 'vas', 'service id'], examples: ['LABEL', 'SHRINK'] }),
    col('name', 'text', { required: true, label: 'Name', help: 'The name of the service.', aliases: ['service name', 'description', 'vas name'], examples: ['Apply label', 'Shrink wrap'] }),
    col('unit_label', 'text', { label: 'Unit word', help: 'What one is called, like label or pallet. Blank means units.', aliases: ['unit', 'unit name', 'uom', 'unit of measure'], examples: ['label', 'pallet'] }),
    col('billing', 'choice', { label: 'Billed', help: 'per_unit, per_hour or flat. Blank means per_unit.', values: ['per_unit', 'per_hour', 'flat'], valueAliases: { unit: 'per_unit', each: 'per_unit', 'per each': 'per_unit', hour: 'per_hour', hourly: 'per_hour', 'flat fee': 'flat', fixed: 'flat' }, aliases: ['billing type', 'billing method', 'price type', 'charge type'], examples: ['per_unit', 'per_unit'] }),
    col('default_price', 'price', { money: true, label: 'Usual price', help: 'What you usually charge for one.', aliases: ['price', 'rate', 'unit price', 'sell price', 'charge'], examples: ['0.35', '12.00'] }),
    col('default_cost_per_unit', 'price', { money: true, label: 'Usual material cost for one', help: 'What the supplies for one cost you.', aliases: ['cost', 'cost per unit', 'unit cost', 'material cost'], examples: ['0.04', '1.10'] }),
    col('units_per_labor_hour_standard', 'pace', { label: 'Target pace', help: 'How many one person should finish in an hour.', positive: true, aliases: ['units per labor hour', 'units per hour', 'uph', 'standard uph', 'target pace', 'standard', 'pace'], examples: ['200', '14'] }),
    laborClass(),
    col('active', 'boolean', { label: 'Active', help: 'yes or no. Blank means yes.', aliases: ['is active', 'enabled', 'status', 'in use'], examples: ['yes', 'yes'] }),
  ],
});

const servicesDone = defineStream({
  id: 'services_done',
  matchRule: 'entry_id, else a row with the same client, job, work_date, service_code and quantity looks the same',
  keyColumns: [],
  lookAlikeColumns: ['client_code', 'job_number', 'work_date', 'service_code', 'quantity'],
  columns: [
    entryId('Leave blank to add a new row. A row with the same client, job, day, service and quantity as one already here is left out, so it is not counted twice.'),
    col('work_date', 'date', { required: true, label: 'Work date', help: 'The day the service was done.', aliases: ['date', 'day', 'service date', 'entry date'], examples: ['2026-11-03', '2026-11-04'] }),
    col('client_code', 'code', { required: true, label: 'Client', help: 'The client the service was for.', aliases: ['client', 'customer', 'customer code', 'client name', 'customer name'], examples: ['ACME', 'ACME'] }),
    col('job_number', 'code', { label: 'Job number', help: 'The job the service belongs to, if any.', aliases: ['job', 'job no', 'job id', 'work order', 'wo', 'wo number'], examples: ['J-1042', ''] }),
    col('service_code', 'code', { required: true, label: 'Service', help: 'The code or name of the service.', aliases: ['service', 'vas code', 'vas', 'service name', 'activity'], examples: ['LABEL', 'SHRINK'] }),
    col('quantity', 'quantity', { required: true, label: 'Quantity', help: 'How many were done.', aliases: ['qty', 'units', 'count', 'quantity done', 'qty done'], examples: ['1200', '18'] }),
    col('unit_price', 'price', { money: true, label: 'Price for one', help: 'What the client pays for one. Blank uses the usual price of the service.', aliases: ['price', 'rate', 'price each', 'unit rate'], examples: ['0.35', ''] }),
    col('amount', 'money', { money: true, label: 'Amount', help: 'A flat amount for the row. Blank means quantity times the price for one.', aliases: ['total', 'revenue', 'charge', 'line amount', 'billed amount'], examples: ['', '216.00'] }),
    laborClass(),
    col('people', 'headcount', { label: 'People', help: 'How many people worked on it.', aliases: ['headcount', 'head count', 'crew', 'workers', 'staff'], examples: ['2', '1'] }),
    col('labor_hours', 'hours', { label: 'Labor hours', help: 'Total labor hours: people times hours each.', aliases: ['hours', 'total hours', 'man hours', 'person hours', 'hrs'], examples: ['6', '1.5'] }),
    overtimeHours(['', '']),
    col('material_cost', 'money', { money: true, label: 'Material cost', help: 'What the supplies for this row cost you.', aliases: ['materials', 'material', 'supplies cost', 'materials cost'], examples: ['48.00', '19.80'] }),
    note(),
  ],
  check: (record) => overtimeCheck(record, 'laborHours'),
});

const targetPace = defineStream({
  id: 'target_pace',
  matchRule: 'job_type_code or service_code, client_code, labor_class and effective_from',
  keyColumns: ['job_type_code', 'service_code', 'client_code', 'labor_class', 'effective_from'],
  lookAlikeColumns: [],
  columns: [
    col('job_type_code', 'code', { label: 'Job type', help: 'The job type the pace is for. Fill in job_type_code or service_code, not both.', aliases: ['job type', 'type', 'work type'], examples: ['KIT', ''] }),
    col('service_code', 'code', { label: 'Service', help: 'The extra service the pace is for.', aliases: ['service', 'vas code', 'vas'], examples: ['', 'LABEL'] }),
    col('client_code', 'code', { label: 'Client', help: 'Only for this client. Blank means every client.', aliases: ['client', 'customer', 'customer code'], examples: ['', 'ACME'] }),
    col('labor_class', 'code', { label: 'Labor class', help: 'Only for this labor class. Blank means every class.', aliases: ['class', 'role', 'labor class code'], examples: ['', ''] }),
    col('units_per_labor_hour', 'pace', { required: true, positive: true, label: 'Target pace', help: 'How many units one person should finish in an hour.', aliases: ['units per hour', 'uph', 'target pace', 'pace', 'standard', 'standard rate', 'standard uph', 'rate', 'units per person per hour', 'uplh'], examples: ['40', '200'] }),
    col('effective_from', 'date', { required: true, label: 'Starts on', help: 'The first day this target applies.', aliases: ['effective date', 'effective', 'start date', 'from', 'starts', 'valid from', 'as of'], examples: ['2026-01-01', '2026-06-01'] }),
    note(['From last year average', 'Time study, May 2026']),
  ],
  check: (record) => {
    if (record.jobTypeCode !== null && record.serviceCode !== null) return [{ level: 'error', column: 'service_code', message: 'Fill in job_type_code or service_code, not both.' }];
    if (record.jobTypeCode === null && record.serviceCode === null) return [{ level: 'error', column: 'job_type_code', message: 'Fill in job_type_code or service_code. A target pace has to be for a job type or a service.' }];
    return [];
  },
});

const goals = defineStream({
  id: 'goals',
  matchRule: 'scope, scope_code, metric and month',
  keyColumns: ['scope', 'scope_code', 'metric', 'month'],
  lookAlikeColumns: [],
  columns: [
    col('scope', 'choice', { required: true, label: 'Goal for', help: 'org (the whole company), site, client, job_type or service.', values: ['org', 'site', 'client', 'job_type', 'service'], valueAliases: { company: 'org', all: 'org', organization: 'org', customer: 'client', 'job type': 'job_type', type: 'job_type', vas: 'service', 'vas service': 'service' }, aliases: ['level', 'goal for', 'applies to'], examples: ['org', 'client'] }),
    col('scope_code', 'code', { label: 'Code', help: 'The code of the site, client, job type or service. Leave blank for org.', aliases: ['code', 'scope id', 'name', 'target code'], examples: ['', 'ACME'] }),
    col('metric', 'choice', { required: true, label: 'Measure', help: 'margin_pct, profit, revenue, units_per_labor_hour, labor_pct_of_revenue, cost_per_unit or utilization_pct.', values: ['margin_pct', 'profit', 'revenue', 'units_per_labor_hour', 'labor_pct_of_revenue', 'cost_per_unit', 'utilization_pct'], valueAliases: { margin: 'margin_pct', 'margin percent': 'margin_pct', 'margin %': 'margin_pct', sales: 'revenue', uph: 'units_per_labor_hour', pace: 'units_per_labor_hour', 'units per hour': 'units_per_labor_hour', 'labor percent': 'labor_pct_of_revenue', 'labor pct': 'labor_pct_of_revenue', 'labor %': 'labor_pct_of_revenue', 'cost per unit': 'cost_per_unit', utilization: 'utilization_pct', 'utilization %': 'utilization_pct' }, aliases: ['measure', 'kpi', 'goal type', 'target type'], examples: ['margin_pct', 'revenue'] }),
    col('month', 'month', { label: 'Month', help: 'The month the goal is for, like 2026-11. Blank means every month.', aliases: ['period', 'period month', 'goal month', 'for month'], examples: ['', '2026-11'] }),
    col('value', 'number', { required: true, allowNegative: true, label: 'Goal', help: 'The goal. A percent for the percent measures (30 means 30 percent), dollars for profit, revenue and cost per unit.', aliases: ['goal', 'target', 'amount', 'target value', 'goal value'], examples: ['30', '45000'] }),
  ],
  check: (record) => {
    if (record.scope !== 'org' && record.scope !== null && record.scopeCode === null) return [{ level: 'error', column: 'scope_code', message: `This column is needed for a ${String(record.scope).replace('_', ' ')} goal and the cell is empty.` }];
    return [];
  },
});

/** Every stream definition, keyed by stream id. */
export const STREAM_DEFS = {
  clients,
  job_types: jobTypes,
  jobs,
  job_plans: jobPlans,
  production,
  labor_rates: laborRates,
  indirect_time: indirectTime,
  paid_hours: paidHours,
  time_punches: timePunches,
  materials,
  items,
  costs,
  revenue,
  services,
  services_done: servicesDone,
  target_pace: targetPace,
  goals,
} as const satisfies { readonly [S in StreamId]: StreamDef<S> };

/** The typed record of one row of a stream. */
export type StreamRecord<S extends StreamId = StreamId> = RecordOf<(typeof STREAM_DEFS)[S]['columns']>;

export type ClientRecord = StreamRecord<'clients'>;
export type JobTypeRecord = StreamRecord<'job_types'>;
export type JobRecord = StreamRecord<'jobs'>;
export type JobPlanRecord = StreamRecord<'job_plans'>;
export type ProductionRecord = StreamRecord<'production'>;
export type LaborRateRecord = StreamRecord<'labor_rates'>;
export type IndirectTimeRecord = StreamRecord<'indirect_time'>;
export type PaidHoursRecord = StreamRecord<'paid_hours'>;
export type TimePunchRecord = StreamRecord<'time_punches'>;
export type MaterialRecord = StreamRecord<'materials'>;
export type ItemRecord = StreamRecord<'items'>;
export type CostRecord = StreamRecord<'costs'>;
export type RevenueRecord = StreamRecord<'revenue'>;
export type ServiceRecord = StreamRecord<'services'>;
export type ServiceEntryRecord = StreamRecord<'services_done'>;
export type TargetPaceRecord = StreamRecord<'target_pace'>;
export type GoalRecord = StreamRecord<'goals'>;

/** The definition of a stream. */
export function streamDef<S extends StreamId>(id: S): (typeof STREAM_DEFS)[S] {
  return STREAM_DEFS[id];
}

/** The definition of a stream as plain column data, for code that handles any stream. */
export function anyStreamDef(id: StreamId): StreamDef {
  return STREAM_DEFS[id] as unknown as StreamDef;
}

/** Column key in camel case, the field name on the typed record: `units_good` is `unitsGood`. */
export function recordKey(columnKey: string): string {
  return columnKey.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

export type PlanLayout = 'totals' | 'lines';

/** Which layout a quotes and budgets file uses: `lines` when it has a `category` column, else `totals`. */
export function planLayout(mappedColumns: Iterable<string>): PlanLayout {
  for (const key of mappedColumns) if (key === 'category') return 'lines';
  return 'totals';
}

export interface ColumnFilter {
  /** Drop money columns. Default: keep them. */
  readonly canSeeMoney?: boolean;
  /** Drop wage columns. Default: keep them. */
  readonly canSeeWages?: boolean;
  /** For quotes and budgets: which layout. Default `totals`. */
  readonly layout?: PlanLayout;
}

/**
 * The columns of a stream for a template or an export, in file order. Money columns are left out
 * for readers who cannot see money, and wage columns for readers who cannot see wages.
 */
export function streamColumns(id: StreamId, filter: ColumnFilter = {}): ColumnDef[] {
  const layout = filter.layout ?? 'totals';
  return anyStreamDef(id).columns.filter((column) => {
    if (column.layout !== undefined && column.layout !== layout) return false;
    if (column.wage && filter.canSeeWages === false) return false;
    if (column.money && filter.canSeeMoney === false) return false;
    return true;
  });
}

/** The needed columns of a stream. It matches the `needed` list in the stream catalog. */
export function requiredColumns(id: StreamId): string[] {
  return anyStreamDef(id).columns.filter((column) => column.required).map((column) => column.key);
}

/** The file name of a stream template, like `production.csv`. */
export function streamFileName(id: StreamId): string {
  return streamInfo(id)?.file ?? `${id}.csv`;
}
