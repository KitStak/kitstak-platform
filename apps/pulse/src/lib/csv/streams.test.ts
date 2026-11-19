/** Every stream definition, the import pipeline, templates and the round trip rule. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { STREAMS, STREAM_IDS, type StreamId } from '../streams';
import {
  COLUMN_TYPE_HINTS,
  STREAM_DEFS,
  type CostRecord,
  type JobRecord,
  type LooseRecord,
  type ProductionRecord,
  type RevenueRecord,
  type StreamRecord,
  anyStreamDef,
  errorReportCsv,
  formatCell,
  formatIssue,
  howToFillCsv,
  howToFillRows,
  mapHeaders,
  normalizeHeader,
  parseCsv,
  planLayout,
  readCell,
  readStreamCsv,
  readStreamRow,
  readStreamRows,
  recordKey,
  requiredColumns,
  streamColumns,
  streamDef,
  streamFileName,
  streamToCsv,
  templateCsv,
  templateExampleRows,
  templateHeaders,
  unguardFormula,
} from './index';

const b = (n: number | string): bigint => BigInt(n);
const BOM = String.fromCharCode(0xfeff);
const NO_LONG_DASH = /[‒-―]|--/;
const layoutsOf = (id: StreamId): ('totals' | 'lines')[] => (id === 'job_plans' ? ['totals', 'lines'] : ['totals']);

describe('stream definitions', () => {
  it('cover all 17 streams of the catalog', () => {
    expect(Object.keys(STREAM_DEFS).sort()).toEqual([...STREAM_IDS].sort());
    for (const id of STREAM_IDS) expect(streamDef(id).id).toBe(id);
  });
  it('agree with the catalog on the needed columns', () => {
    for (const stream of STREAMS) expect([...requiredColumns(stream.id)].sort(), stream.id).toEqual([...stream.needed].sort());
  });
  it('match the column lists of the spec', () => {
    const keys = (id: StreamId): string[] => anyStreamDef(id).columns.map((column) => column.key);
    expect(keys('clients')).toEqual(['client_code', 'name', 'status', 'contact_name', 'contact_email', 'phone', 'target_margin_pct', 'payment_terms_days', 'parts_owner', 'notes']);
    expect(keys('job_types')).toEqual(['job_type_code', 'name', 'unit_label', 'default_pricing_model', 'default_labor_class', 'default_units_per_labor_hour', 'target_margin_pct']);
    expect(keys('jobs')).toEqual(['job_number', 'name', 'client_code', 'job_type_code', 'site_code', 'kind', 'status', 'pricing_model', 'unit_label', 'planned_units', 'unit_price', 'fixed_price', 'bill_rate_per_hour', 'material_method', 'material_cost_per_unit', 'parts_owner', 'labor_class', 'units_per_labor_hour_standard', 'target_margin_pct', 'start_date', 'due_date', 'completed_date', 'po_number', 'owner_email', 'kit_sku', 'notes', 'wms_work_order', 'crm_deal_id', 'project_key', 'quote_units', 'quote_revenue', 'quote_labor_hours', 'quote_labor_cost', 'quote_material_cost', 'quote_other_cost']);
    expect(templateHeaders('job_plans')).toEqual(['job_number', 'plan', 'units', 'revenue', 'labor_hours', 'labor_cost', 'setup_hours', 'setup_cost', 'material_cost', 'other_cost']);
    expect(templateHeaders('job_plans', { layout: 'lines' })).toEqual(['job_number', 'plan', 'category', 'description', 'quantity', 'unit', 'unit_amount', 'amount', 'labor_class', 'service_code', 'item_sku']);
    expect(keys('production')).toEqual(['entry_id', 'work_date', 'job_number', 'shift', 'labor_class', 'units_good', 'units_scrap', 'units_rework', 'people', 'hours_each', 'labor_hours', 'overtime_hours', 'setup_hours', 'note']);
    expect(keys('labor_rates')).toEqual(['labor_class_code', 'labor_class_name', 'kind', 'site_code', 'effective_from', 'wage_per_hour', 'payroll_tax_pct', 'benefits_pct', 'other_burden_pct', 'overhead_per_hour', 'overtime_multiplier', 'bill_rate_per_hour', 'note']);
    expect(keys('indirect_time')).toEqual(['entry_id', 'work_date', 'site_code', 'labor_class', 'reason', 'people', 'labor_hours', 'overtime_hours', 'note']);
    expect(keys('paid_hours')).toEqual(['work_date', 'site_code', 'labor_class', 'paid_hours', 'paid_amount']);
    expect(keys('time_punches')).toEqual(['entry_id', 'employee_id', 'employee_name', 'work_date', 'site_code', 'job_number', 'reason', 'labor_class', 'hours', 'overtime_hours', 'pay_amount']);
    expect(keys('materials')).toEqual(['entry_id', 'usage_date', 'job_number', 'item_sku', 'item_name', 'quantity_used', 'quantity_scrapped', 'quantity_planned', 'unit_cost', 'uom', 'lot', 'supplied_by', 'note']);
    expect(keys('items')).toEqual(['item_sku', 'name', 'uom', 'unit_cost', 'supplied_by', 'client_code']);
    expect(keys('costs')).toEqual(['entry_id', 'cost_date', 'job_number', 'client_code', 'site_code', 'category', 'amount', 'vendor', 'reference', 'note']);
    expect(keys('revenue')).toEqual(['entry_id', 'revenue_date', 'job_number', 'client_code', 'kind', 'description', 'quantity', 'unit_price', 'amount', 'invoice_number', 'service_code', 'note']);
    expect(keys('services')).toEqual(['service_code', 'name', 'unit_label', 'billing', 'default_price', 'default_cost_per_unit', 'units_per_labor_hour_standard', 'labor_class', 'active']);
    expect(keys('services_done')).toEqual(['entry_id', 'work_date', 'client_code', 'job_number', 'service_code', 'quantity', 'unit_price', 'amount', 'labor_class', 'people', 'labor_hours', 'overtime_hours', 'material_cost', 'note']);
    expect(keys('target_pace')).toEqual(['job_type_code', 'service_code', 'client_code', 'labor_class', 'units_per_labor_hour', 'effective_from', 'note']);
    expect(keys('goals')).toEqual(['scope', 'scope_code', 'metric', 'month', 'value']);
  });
  it('give every column a label, help text, two examples and clean aliases', () => {
    for (const id of STREAM_IDS) {
      const def = anyStreamDef(id);
      const keys = new Set<string>();
      const names = new Map<string, string>();
      for (const column of def.columns) {
        expect(keys.has(column.key), `${id}.${column.key} is listed twice`).toBe(false);
        keys.add(column.key);
        expect(column.key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(column.label.length, `${id}.${column.key} label`).toBeGreaterThan(1);
        expect(column.help.length, `${id}.${column.key} help`).toBeGreaterThan(10);
        expect(column.help.endsWith('.'), `${id}.${column.key} help ends with a period`).toBe(true);
        expect(`${column.label} ${column.help} ${column.aliases.join(' ')}`).not.toMatch(NO_LONG_DASH);
        expect(column.examples).toHaveLength(2);
        expect(COLUMN_TYPE_HINTS[column.type]).toBeTruthy();
        if (column.type === 'choice') expect(column.values?.length ?? 0, `${id}.${column.key} values`).toBeGreaterThan(1);
        if (column.required) expect(column.examples.every((example) => example !== ''), `${id}.${column.key} needs an example in both rows`).toBe(true);
        // a header name can only ever point at one column of the stream
        for (const name of [column.key, column.label, ...column.aliases]) {
          const normal = normalizeHeader(name);
          const owner = names.get(normal);
          expect(owner === undefined || owner === column.key, `${id}: "${name}" maps to both ${owner} and ${column.key}`).toBe(true);
          names.set(normal, column.key);
        }
      }
      for (const key of [...def.keyColumns, ...def.lookAlikeColumns]) expect(keys.has(key), `${id} key column ${key}`).toBe(true);
      expect(def.matchRule).not.toMatch(NO_LONG_DASH);
    }
  });
  it('maps its own headers and labels back to itself', () => {
    for (const id of STREAM_IDS) {
      const def = anyStreamDef(id);
      const byKey = mapHeaders(def.columns.map((column) => column.key), def.columns, { fuzzy: false });
      expect(byKey.columns).toEqual(def.columns.map((column) => column.key));
      const byLabel = mapHeaders(def.columns.map((column) => column.label), def.columns, { fuzzy: false });
      expect(byLabel.columns, id).toEqual(def.columns.map((column) => column.key));
    }
  });
  it('marks money and wage columns for export', () => {
    expect(templateHeaders('labor_rates', { canSeeWages: false })).toEqual(['labor_class_code', 'labor_class_name', 'kind', 'site_code', 'effective_from', 'bill_rate_per_hour', 'note']);
    expect(templateHeaders('labor_rates', { canSeeMoney: false })).toEqual(['labor_class_code', 'labor_class_name', 'kind', 'site_code', 'effective_from', 'payroll_tax_pct', 'benefits_pct', 'other_burden_pct', 'overtime_multiplier', 'note']);
    expect(templateHeaders('production', { canSeeMoney: false, canSeeWages: false })).toEqual(templateHeaders('production'));
    expect(templateHeaders('costs', { canSeeMoney: false })).not.toContain('amount');
    expect(templateHeaders('paid_hours', { canSeeWages: false })).toEqual(['work_date', 'site_code', 'labor_class', 'paid_hours']);
    for (const stream of STREAMS) {
      const hasMoney = streamColumns(stream.id).some((column) => column.money) || streamColumns(stream.id, { layout: 'lines' }).some((column) => column.money);
      expect(hasMoney, `${stream.id} hasMoney`).toBe(stream.hasMoney || stream.id === 'goals' ? hasMoney : false);
    }
  });
  it('flags every money looking column, so an export for a no money reader drops it', () => {
    // Round three: target_margin_pct was a plain percent column, so three exports showed it to no money roles.
    // cost_date and revenue_date are days, not money.
    const moneyKey = /^(?!.*_date$).*(^|_)(price|cost|amount|margin|revenue|wage|pay|rate|burden|overhead|tax|benefits|cents)(_|$)/;
    const unflagged: string[] = [];
    for (const id of STREAM_IDS) {
      for (const layout of layoutsOf(id)) {
        for (const column of streamColumns(id, { layout })) {
          const looksLikeMoney = column.type === 'money' || column.type === 'price' || moneyKey.test(column.key);
          if (looksLikeMoney && !column.money && !column.wage) unflagged.push(`${id}.${column.key}`);
        }
        for (const header of templateHeaders(id, { canSeeMoney: false, canSeeWages: false, layout })) {
          if (moneyKey.test(header)) unflagged.push(`${id}.${header} is still in the no money file`);
        }
      }
    }
    expect(unflagged).toEqual([]);
    for (const id of ['clients', 'job_types', 'jobs'] as const) {
      expect(templateHeaders(id), id).toContain('target_margin_pct');
      expect(templateHeaders(id, { canSeeMoney: false }), id).not.toContain('target_margin_pct');
    }
  });
  it('turns column keys into record fields', () => {
    expect(recordKey('units_good')).toBe('unitsGood');
    expect(recordKey('units_per_labor_hour_standard')).toBe('unitsPerLaborHourStandard');
    expect(recordKey('name')).toBe('name');
    expect(streamFileName('services_done')).toBe('services_done.csv');
    expect(planLayout(['job_number', 'plan', 'category'])).toBe('lines');
    expect(planLayout(['job_number', 'plan', 'units'])).toBe('totals');
  });
  it('types the records', () => {
    expectTypeOf<ProductionRecord['workDate']>().toEqualTypeOf<string>();
    expectTypeOf<ProductionRecord['unitsGood']>().toEqualTypeOf<string>();
    expectTypeOf<ProductionRecord['laborHours']>().toEqualTypeOf<string | null>();
    expectTypeOf<CostRecord['amount']>().toEqualTypeOf<bigint>();
    expectTypeOf<CostRecord['category']>().toEqualTypeOf<'freight' | 'packaging' | 'equipment' | 'outside_service' | 'rework' | 'supplies' | 'storage' | 'rent' | 'utilities' | 'salaried_staff' | 'insurance' | 'other'>();
    expectTypeOf<RevenueRecord['kind']>().toEqualTypeOf<'invoice' | 'fee' | 'adjustment' | 'credit'>();
    expectTypeOf<JobRecord['targetMarginPct']>().toEqualTypeOf<number | null>();
    expectTypeOf<JobRecord['fixedPrice']>().toEqualTypeOf<bigint | null>();
    expectTypeOf<JobRecord['pricingModel']>().toEqualTypeOf<'per_unit' | 'fixed' | 'hourly' | null>();
    expectTypeOf<StreamRecord<'services'>['active']>().toEqualTypeOf<boolean | null>();
    expectTypeOf<StreamRecord<'clients'>['paymentTermsDays']>().toEqualTypeOf<number | null>();
  });
});

describe('templates', () => {
  it('have a header row and two example rows that import with no problems', () => {
    for (const id of STREAM_IDS) {
      for (const layout of layoutsOf(id)) {
        const csv = templateCsv(id, { layout });
        expect(csv.startsWith(BOM)).toBe(true);
        expect(csv).toContain('\r\n');
        const read = readStreamCsv(id, csv);
        expect(read.problems, `${id} ${layout}`).toEqual([]);
        expect(read.mapping.unmatched, `${id} ${layout}`).toEqual([]);
        expect(read.mapping.matches.every((match) => match.how === 'exact')).toBe(true);
        expect(read.counts, `${id} ${layout}`).toEqual({ rows: 2, ok: 2, withErrors: 0, withWarnings: 0 });
        expect(read.rows.flatMap((row) => row.messages), `${id} ${layout}`).toEqual([]);
        if (id === 'job_plans') expect(read.layout).toBe(layout);
        else expect(read.layout).toBeNull();
      }
    }
  });
  it('list every column in the how to fill file', () => {
    for (const id of STREAM_IDS) {
      const rows = howToFillRows(id);
      expect(rows.map((row) => row.column)).toEqual(templateHeaders(id));
      for (const row of rows) expect(`${row.whatToPut} ${row.kind}`).not.toMatch(NO_LONG_DASH);
      const parsed = parseCsv(howToFillCsv(id));
      expect(parsed.problems).toEqual([]);
      expect(parsed.headers).toEqual(['column', 'needed', 'what_to_put', 'kind_of_value', 'allowed_values', 'example']);
      expect(parsed.rows).toHaveLength(rows.length);
    }
    const production = howToFillRows('production');
    expect(production.find((row) => row.column === 'work_date')).toMatchObject({ needed: 'yes', kind: 'A date, like 2026-11-03', example: '2026-11-02' });
    expect(production.find((row) => row.column === 'labor_hours')).toMatchObject({ needed: 'no', example: '24' });
    expect(howToFillRows('costs').find((row) => row.column === 'category')?.allowedValues).toBe('freight, packaging, equipment, outside_service, rework, supplies, storage, rent, utilities, salaried_staff, insurance, other');
  });
  it('gives the production template the documented shape', () => {
    expect(templateExampleRows('production')[0]).toEqual(['', '2026-11-02', 'J-1042', 'day', 'PACK', '600', '12', '', '3', '8', '', '', '', 'First day of the run']);
    const read = readStreamCsv('production', templateCsv('production'));
    expect(read.rows[0]?.record).toEqual({
      entryId: null,
      workDate: '2026-11-02',
      jobNumber: 'J-1042',
      shift: 'day',
      laborClass: 'PACK',
      unitsGood: '600.000',
      unitsScrap: '12.000',
      unitsRework: null,
      people: '3.00',
      hoursEach: '8.00',
      laborHours: '24.00', // blank in the file: people x hours each
      overtimeHours: null,
      setupHours: null,
      note: 'First day of the run',
    });
    expect(read.rows[1]?.record).toMatchObject({ laborHours: '24.00', overtimeHours: '4.00', unitsRework: '8.000' });
  });
});

describe('round trip rule: export then import changes nothing', () => {
  it('holds for every stream', () => {
    for (const id of STREAM_IDS) {
      for (const layout of layoutsOf(id)) {
        const first = readStreamCsv(id, templateCsv(id, { layout }));
        const records = first.rows.map((row) => row.record as LooseRecord);
        const exported = streamToCsv(id, records, { layout });
        const second = readStreamCsv(id, exported);
        expect(second.problems, id).toEqual([]);
        expect(second.rows.map((row) => row.record), `${id} ${layout}`).toEqual(records);
        // and again: the export of the import is the same file, byte for byte
        expect(streamToCsv(id, second.rows.map((row) => row.record as LooseRecord), { layout })).toBe(exported);
      }
    }
  });
  it('keeps notes that look like formulas, phone numbers and negative money', () => {
    const records: LooseRecord[] = [
      { entryId: 'c-1', costDate: '2026-11-05', jobNumber: 'J-1042', clientCode: null, siteCode: null, category: 'freight', amount: b(-4500), vendor: '+1 555 0100', reference: '=REF-1', note: '- call client' },
      { entryId: 'c-2', costDate: '2026-11-06', jobNumber: null, clientCode: null, siteCode: null, category: 'rent', amount: b(1450000), vendor: 'Harbor, "Property" Group', reference: null, note: "'=starts with an apostrophe\nand has two lines" },
    ];
    const csv = streamToCsv('costs', records);
    expect(csv).toContain("'=REF-1");
    expect(csv).toContain("'- call client");
    expect(csv).toContain("'+1 555 0100");
    expect(csv).toContain(',-45.00,'); // money is a number: never guarded
    expect(csv).not.toContain("'-45.00");
    const read = readStreamCsv('costs', csv);
    expect(read.rows.map((row) => row.record)).toEqual(records);
  });
  it('writes each kind of value in a plain, re-readable form', () => {
    const column = (id: StreamId, key: string) => anyStreamDef(id).columns.find((candidate) => candidate.key === key) as never;
    expect(formatCell(column('costs', 'amount'), b(123450))).toEqual({ raw: '1234.50' });
    expect(formatCell(column('clients', 'target_margin_pct'), 2850)).toEqual({ raw: '28.5' });
    expect(formatCell(column('clients', 'target_margin_pct'), 3000)).toEqual({ raw: '30' });
    expect(formatCell(column('materials', 'unit_cost'), '0.0350')).toEqual({ raw: '0.035' });
    expect(formatCell(column('production', 'units_good'), '600.000')).toEqual({ raw: '600' });
    expect(formatCell(column('production', 'labor_hours'), '7.50')).toEqual({ raw: '7.5' });
    expect(formatCell(column('services', 'active'), false)).toEqual({ raw: 'no' });
    expect(formatCell(column('production', 'work_date'), '2026-11-02')).toEqual({ raw: '2026-11-02' });
    expect(formatCell(column('production', 'note'), '=x')).toBe('=x');
    expect(formatCell(column('production', 'note'), null)).toBe('');
    expect(formatCell(column('goals', 'value'), '45000.0000')).toEqual({ raw: '45000' });
  });
  it('drops money columns from an export for a reader who cannot see money', () => {
    const read = readStreamCsv('jobs', templateCsv('jobs'));
    const csv = streamToCsv('jobs', read.rows.map((row) => row.record as LooseRecord), { canSeeMoney: false });
    const headers = parseCsv(csv).headers;
    for (const hidden of ['unit_price', 'fixed_price', 'bill_rate_per_hour', 'material_cost_per_unit', 'quote_revenue', 'quote_labor_cost']) expect(headers).not.toContain(hidden);
    expect(headers).toContain('planned_units');
    expect(csv).not.toContain('13750');
  });
});

describe('reading real world files', () => {
  it('reads a messy production file: other header names, semicolons, decimal commas, day first dates', () => {
    const file = ['Date;Job #;Qty Finished;Scrap;Headcount;Hrs Each;OT Hours;Comments', '03/11/2026;J-1042;1.250;12;12;7,5;4;"first day; slow start"', '13/11/2026;J-1042;900;;10;8;;', ''].join('\r\n');
    const read = readStreamCsv('production', file);
    expect(read.delimiter).toBe(';');
    expect(read.problems).toEqual([]);
    expect(read.mapping.columns).toEqual(['work_date', 'job_number', 'units_good', 'units_scrap', 'people', 'hours_each', 'overtime_hours', 'note']);
    expect(read.dateOrder).toBe('DMY');
    expect(read.dateOrderSource).toBe('detected');
    expect(read.decimal).toBe(','); // "7,5" proves a decimal comma, so "1.250" is one thousand two hundred fifty
    expect(read.counts).toEqual({ rows: 2, ok: 2, withErrors: 0, withWarnings: 0 });
    expect(read.rows[0]?.record).toMatchObject({ workDate: '2026-11-03', jobNumber: 'J-1042', unitsGood: '1250.000', unitsScrap: '12.000', people: '12.00', hoursEach: '7.50', laborHours: '90.00', overtimeHours: '4.00', note: 'first day; slow start' });
    expect(read.rows[1]?.record).toMatchObject({ workDate: '2026-11-13', unitsGood: '900.000', laborHours: '80.00', overtimeHours: null });
  });
  it('reports each bad cell in plain words with its row number', () => {
    const file = ['work_date,job_number,units_good,labor_hours,overtime_hours', '2026-11-02,J-1042,600,24,', 'soon,J-1042,600,9x,', '2026-11-03,,abc,8,', '2026-11-04,J-1042,10,8,9', '', '2026-11-05,J-1042,50,,'].join('\n');
    const read = readStreamCsv('production', file);
    expect(read.counts).toEqual({ rows: 5, ok: 2, withErrors: 3, withWarnings: 1 });
    expect(read.rows[1]?.messages).toEqual(['Row 3, work_date: soon is not a date. Use a date like 2026-11-03.', 'Row 3, labor_hours: 9x is not a number of hours. Use 7.5 or 7:30.']);
    expect(read.rows[2]?.messages).toEqual(['Row 4, job_number: This column is needed and the cell is empty.', 'Row 4, units_good: abc is not a number.']);
    expect(read.rows[3]?.messages).toEqual(['Row 5, overtime_hours: Overtime hours cannot be more than the labor hours.']);
    expect(read.rows[4]).toMatchObject({ rowNumber: 7, ok: true });
    expect(read.rows[4]?.messages).toEqual(['Row 7, labor_hours: This row has units and no hours, so its labor cost is missing. Add people and hours each, or the labor hours.']);
    expect(read.rows[1]?.record).toBeNull();
    for (const row of read.rows) for (const text of row.messages) expect(text).not.toMatch(NO_LONG_DASH);
  });
  it('writes an error report with the file headers and a problem column', () => {
    const file = 'Date,Job,Units\nsoon,J-1,5\n2026-11-02,J-1,5\n2026-11-03,,x\n';
    const report = parseCsv(errorReportCsv(readStreamCsv('production', file)));
    expect(report.headers).toEqual(['Date', 'Job', 'Units', 'problem']);
    expect(report.rows).toEqual([
      ['soon', 'J-1', '5', 'work_date: soon is not a date. Use a date like 2026-11-03.'],
      ['2026-11-03', '', 'x', 'job_number: This column is needed and the cell is empty. units_good: x is not a number.'],
    ]);
  });
  it('stops with a clear problem when a needed column is missing', () => {
    const read = readStreamCsv('production', 'Date,Units\n2026-11-02,5\n');
    expect(read.ready).toBe(false);
    expect(read.rows).toEqual([]);
    expect(read.problems).toEqual([{ level: 'error', code: 'missing_column', row: null, message: 'This file has no job_number column, and it is needed. Add the column, or match one of your columns to it.' }]);
    // mapping it by hand fixes it
    const fixed = readStreamCsv('production', 'Date,Ref,Units\n2026-11-02,J-1,5\n', { preset: { ref: 'job_number' } });
    expect(fixed.ready).toBe(true);
    expect(fixed.rows[0]?.record).toMatchObject({ jobNumber: 'J-1' });
  });
  it('is not ready for an empty file', () => {
    const read = readStreamCsv('clients', '');
    expect(read.ready).toBe(false);
    expect(read.problems[0]?.code).toBe('empty_file');
  });
  it('still reads the rows under the limit when a file is too long', () => {
    const read = readStreamCsv('clients', 'client_code,name\nA,Acme\nB,Birch\nC,Cedar\n', { maxRows: 2 });
    expect(read.ready).toBe(true);
    expect(read.rows).toHaveLength(2);
    expect(read.problems[0]?.code).toBe('too_many_rows');
  });
  it('uses the date order it is told to use', () => {
    const file = 'work_date,job_number,units_good\n03/04/2026,J-1,5\n';
    expect(readStreamCsv('production', file).rows[0]?.record?.workDate).toBe('2026-03-04');
    expect(readStreamCsv('production', file)).toMatchObject({ dateOrder: 'MDY', dateOrderSource: 'default' });
    expect(readStreamCsv('production', file, { dateOrder: 'DMY' }).rows[0]?.record?.workDate).toBe('2026-04-03');
    expect(readStreamCsv('production', file, { dateOrder: 'DMY' }).dateOrderSource).toBe('option');
  });
  it('reads Excel serial dates, money with symbols and percents with signs', () => {
    const file = 'Labor Class,Effective Date,Wage,Payroll Tax,Benefits,Overhead,OT Multiplier\nPACK,46023,$16.00,9%,12,"$2.40",1.5\n';
    const read = readStreamCsv('labor_rates', file);
    expect(read.problems).toEqual([]);
    expect(read.rows[0]?.record).toMatchObject({ laborClassCode: 'PACK', effectiveFrom: '2026-01-01', wagePerHour: b(1600), payrollTaxPct: 900, benefitsPct: 1200, overheadPerHour: b(240), overtimeMultiplier: '1.50', otherBurdenPct: null });
    const low = readStreamCsv('labor_rates', 'labor_class_code,effective_from,wage_per_hour,overtime_multiplier\nPACK,2026-01-01,16,0.5\n');
    expect(low.rows[0]?.messages).toEqual(['Row 2, overtime_multiplier: 0.5 is too low. An overtime multiplier is 1 or more, like 1.5.']);
  });
  it('reads jobs with their quote in one file', () => {
    const file = 'Job Number,Job Name,Customer,Pricing,Order Qty,Price,Status,Due,Quoted Revenue,Quoted Hours\nJ-2001,Spring kits,ACME,Per Unit,"5,000",$2.75,In Progress,12/4/2026,"$13,750.00",125\n';
    const read = readStreamCsv('jobs', file);
    expect(read.mapping.unmatched).toEqual([]);
    expect(read.rows[0]?.messages).toEqual([]);
    expect(read.rows[0]?.record).toMatchObject({ jobNumber: 'J-2001', name: 'Spring kits', clientCode: 'ACME', pricingModel: 'per_unit', plannedUnits: '5000.000', unitPrice: '2.7500', status: 'active', dueDate: '2026-12-04', quoteRevenue: b(1375000), quoteLaborHours: '125.00', fixedPrice: null });
    const warned = readStreamCsv('jobs', 'job_number,name,client_code,start_date,due_date\nJ-1,x,ACME,2026-12-10,2026-12-01\n');
    expect(warned.rows[0]).toMatchObject({ ok: true });
    expect(warned.rows[0]?.messages).toEqual(['Row 2, due_date: The due date is before the start date.']);
  });
  it('tells the two quote and budget layouts apart by the header', () => {
    const totals = readStreamCsv('job_plans', 'job_number,plan,units,revenue,labor_hours,labor_cost\nJ-1,Quote,5000,13750,125,2720\n');
    expect(totals.layout).toBe('totals');
    expect(totals.rows[0]?.record).toMatchObject({ plan: 'quote', units: '5000.000', revenue: b(1375000), category: null });
    const lines = readStreamCsv('job_plans', 'job_number,plan,category,description,quantity,unit,unit_amount,amount\nJ-1,budget,labor,Packers,121,hour,21.76,\nJ-1,budget,,Boxes,1,flat,,\nJ-1,budget,other,Freight,,,,400\n');
    expect(lines.layout).toBe('lines');
    expect(lines.rows[0]?.record).toMatchObject({ category: 'labor', quantity: '121.000', unit: 'hour', unitAmount: '21.7600', amount: b(263296) });
    expect(lines.rows[1]?.messages).toEqual(['Row 3, category: This column is needed and the cell is empty. Use revenue, labor, setup, material or other.', 'Row 3, amount: Fill in the line amount, or both the quantity and the amount for one.']);
    expect(lines.rows[2]?.record).toMatchObject({ category: 'other', amount: b(40000) });
  });
  it('checks the rows of the other streams', () => {
    const revenue = readStreamCsv('revenue', 'revenue_date,job_number,client_code,kind,amount\n2026-11-07,,,fee,150\n2026-11-08,J-1,,Credit Memo,45.00\n2026-11-09,,ACME,invoice,"(20.00)"\n');
    expect(revenue.rows[0]?.messages).toEqual(['Row 2, job_number: Fill in job_number or client_code. Revenue has to belong to a job or a client.']);
    expect(revenue.rows[1]?.record).toMatchObject({ kind: 'credit', amount: b(-4500) });
    expect(revenue.rows[1]?.messages).toEqual(['Row 3, amount: A credit takes money off, so this amount was read as a negative number.']);
    expect(revenue.rows[2]?.record).toMatchObject({ kind: 'invoice', amount: b(-2000) });

    const punches = readStreamCsv('time_punches', 'employee_id,work_date,job_number,reason,hours,overtime_hours\nE-1,2026-11-02,J-1,meeting,8,\nE-1,2026-11-02,,,8,\nE-2,2026-11-02,J-1,,7:30,8\n');
    expect(punches.rows[0]?.messages).toEqual(['Row 2, reason: Fill in job_number or reason, not both.']);
    expect(punches.rows[1]).toMatchObject({ ok: true }); // neither: paid time on no job
    expect(punches.rows[2]?.messages).toEqual(['Row 4, overtime_hours: Overtime hours cannot be more than the labor hours.']);

    const pace = readStreamCsv('target_pace', 'job_type_code,service_code,units_per_labor_hour,effective_from\nKIT,LABEL,40,2026-01-01\n,,40,2026-01-01\nKIT,,0,2026-01-01\nKIT,,40,2026-01-01\n');
    expect(pace.rows.map((row) => row.ok)).toEqual([false, false, false, true]);
    expect(pace.rows[2]?.messages).toEqual(['Row 4, units_per_labor_hour: 0 must be more than zero.']);

    const goals = readStreamCsv('goals', 'scope,scope_code,metric,month,value\nCompany,,Margin %,,30\nclient,,revenue,Nov 2026,45000\nclient,ACME,profit,2026-11,-500\n');
    expect(goals.rows[0]?.record).toEqual({ scope: 'org', scopeCode: null, metric: 'margin_pct', month: null, value: '30.0000' });
    expect(goals.rows[1]?.messages).toEqual(['Row 3, scope_code: This column is needed for a client goal and the cell is empty.']);
    expect(goals.rows[2]?.record).toMatchObject({ month: '2026-11', value: '-500.0000' });

    const costs = readStreamCsv('costs', 'cost_date,category,amount,vendor\n2026-11-01,Lease,"14,500.00",Harbor\n2026-11-02,freight,-45,Northline\n2026-11-03,parking,10,x\n');
    expect(costs.rows[0]?.record).toMatchObject({ category: 'rent', amount: b(1450000), jobNumber: null, clientCode: null });
    expect(costs.rows[1]?.record).toMatchObject({ amount: b(-4500) });
    expect(costs.rows[2]?.messages[0]).toBe('Row 4, category: parking is not one of: freight, packaging, equipment, outside_service, rework, supplies, storage, rent, utilities, salaried_staff, insurance, other.');

    const materials = readStreamCsv('materials', 'usage_date,job_number,item_sku,quantity_used,unit_cost,supplied_by\n2026-11-02,J-1,LBL,1000,0.035,Customer\n2026-11-02,J-1,LBL,1000,-1,us\n');
    expect(materials.rows[0]?.record).toMatchObject({ unitCost: '0.0350', suppliedBy: 'client', quantityUsed: '1000.000' });
    expect(materials.rows[1]?.messages).toEqual(['Row 3, unit_cost: -1 cannot be below zero.']);

    const paid = readStreamCsv('paid_hours', 'work_date,paid_hours,paid_amount\n2026-11-02,104,-5\n');
    expect(paid.rows[0]?.messages).toEqual(['Row 2, paid_amount: -5 cannot be below zero.']);

    const clients = readStreamCsv('clients', 'client_code,name,contact_email,target_margin_pct,payment_terms_days,status\nACME,Acme,not an email,130,30.5,Open\n');
    expect(clients.rows[0]?.messages).toEqual(['Row 2, contact_email: not an email is not an email address.', 'Row 2, target_margin_pct: 130 is too high. The most allowed is 100%.', 'Row 2, payment_terms_days: 30.5 is not a whole number.']);
  });
  it('reads stored raw rows on the server with a chosen mapping', () => {
    const result = readStreamRows('clients', { headers: ['Code', 'Client'], rows: [['ACME', 'Acme Outdoor'], ['', 'No code']], columns: ['client_code', 'name'] });
    expect(result.rows[0]?.record).toMatchObject({ clientCode: 'ACME', name: 'Acme Outdoor', status: null });
    expect(result.rows[1]?.messages).toEqual(['Row 3, client_code: This column is needed and the cell is empty.']);
    const numbered = readStreamRows('clients', { headers: ['Code', 'Client'], rows: [['', 'x']], rowNumbers: [41], columns: ['client_code', 'name'] });
    expect(numbered.rows[0]?.messages[0]).toBe('Row 41, client_code: This column is needed and the cell is empty.');
  });
  it('reads a single row and a single cell', () => {
    const present = new Set(['client_code', 'name', 'parts_owner']);
    const row = readStreamRow('clients', { client_code: ' ACME ', name: "'=Acme", parts_owner: 'We' }, 14, present);
    expect(row.record).toMatchObject({ clientCode: 'ACME', name: '=Acme', partsOwner: 'us' });
    expect(unguardFormula("'=Acme")).toBe('=Acme');
    const column = anyStreamDef('production').columns.find((candidate) => candidate.key === 'labor_hours') as never;
    expect(readCell(column, '9x')).toEqual({ ok: false, message: '9x is not a number of hours. Use 7.5 or 7:30.' });
    expect(formatIssue(14, { column: 'labor_hours', message: '9x is not a number.' })).toBe('Row 14, labor_hours: 9x is not a number.');
    expect(formatIssue(31, { column: null, message: 'October is closed.' })).toBe('Row 31: October is closed.');
  });
});

describe('entry id help says what a blank entry id does', () => {
  const help = (stream: StreamId): string => anyStreamDef(stream).columns.find((column) => column.key === 'entry_id')?.help ?? '';

  it('says a blank id with the same job, day, shift and labor class updates that entry', () => {
    expect(help('production')).toBe('Leave blank and a row with the same job, day, shift and labor class updates that entry. No match adds a new one. Exports fill it in, so a file you export and import again updates the same rows.');
  });

  it('never claims a blank id always means a new row', () => {
    for (const stream of STREAM_IDS) {
      const text = help(stream);
      if (text) expect(text, stream).not.toMatch(/^Leave blank for a new row/);
    }
  });
});
