import { describe, expect, it } from 'vitest';
import { neutralizeFormula, parseCsv, toCsv, detectDelimiter } from './csv';
import { convertValue, planLabels, stableLabelId } from './convert';
import { buildHeaders, detectHeaderRow, profileColumn, profileColumns } from './infer';
import { autoMap, validateMapping } from './mapping';
import { detectDateOrder, parseCurrency, parseDate, parseEmail, parseNumber, parsePhone, parseUrl } from './parse-values';
import { buildColumnPlan, buildRows, overrideKey } from './plan';
import { nameSimilarity } from './text';
import type { TargetColumn } from './types';
import { buildErrorReport } from './error-report';

const noMember = () => null;
const ctx = { dateOrder: 'mdy' as const, currency: 'USD', matchMember: noMember };

describe('csv', () => {
  it('parses quoted fields with delimiters, quotes and newlines', () => {
    const result = parseCsv('name,notes\r\n"Doe, Jane","said ""hi""\nthen left"\r\nBob,ok\n');
    expect(result.rows).toEqual([
      ['name', 'notes'],
      ['Doe, Jane', 'said "hi"\nthen left'],
      ['Bob', 'ok'],
    ]);
    expect(result.totalRows).toBe(3);
  });

  it('detects semicolon and tab delimiters and strips the BOM', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(parseCsv('﻿a\tb\n1\t2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips blank lines and enforces row caps', () => {
    const result = parseCsv('a\n\n1\n2\n3', { maxRows: 2 });
    expect(result.rows).toEqual([['a'], ['1']]);
    expect(result.truncated).toBe(true);
    expect(result.totalRows).toBe(4);
  });

  it('neutralizes spreadsheet formulas on export but keeps negative numbers', () => {
    expect(neutralizeFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(neutralizeFormula('-42')).toBe('-42');
    expect(toCsv([['a,b', '@sum', 3, true, null]])).toBe(`"a,b",'@sum,3,true,`);
  });
});

describe('value parsers', () => {
  it('parses dates in several formats with day/month order', () => {
    expect(parseDate('2024-03-05')).toEqual({ date: '2024-03-05' });
    expect(parseDate('03/05/2024', 'mdy')).toEqual({ date: '2024-03-05' });
    expect(parseDate('03/05/2024', 'dmy')).toEqual({ date: '2024-05-03' });
    expect(parseDate('Mar 5, 2024')).toEqual({ date: '2024-03-05' });
    expect(parseDate('5 March 24')).toEqual({ date: '2024-03-05' });
    expect(parseDate('2024-03-05T14:30:00Z')).toEqual({ date: '2024-03-05', time: '14:30' });
    expect(parseDate('02/30/2024')).toBeNull();
    expect(parseDate('hello')).toBeNull();
  });

  it('detects day-first dates from samples', () => {
    expect(detectDateOrder(['13/02/2024', '01/03/2024'])).toBe('dmy');
    expect(detectDateOrder(['02/13/2024'])).toBe('mdy');
    expect(detectDateOrder(['2024-01-02'])).toBe('ymd');
  });

  it('parses numbers and currencies across locales', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('(1,200)')).toBe(-1200);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseCurrency('$12,000')).toMatchObject({ amount: 12000, currency: 'USD', hadSymbol: true });
    expect(parseCurrency('950,50 EUR')).toMatchObject({ amount: 950.5, currency: 'EUR' });
    expect(parseCurrency('£75')).toMatchObject({ amount: 75, currency: 'GBP' });
  });

  it('parses emails, phones and links', () => {
    expect(parseEmail('Jane Doe <JANE@Example.com>')).toEqual({ email: 'jane@example.com', label: 'Jane Doe' });
    expect(parseEmail('not-an-email')).toBeNull();
    expect(parsePhone('+1 (415) 555-0100')).toBe('+1 (415) 555-0100');
    expect(parsePhone('12')).toBeNull();
    expect(parseUrl('www.kitstak.example')).toBe('https://www.kitstak.example/');
    expect(parseUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('inference', () => {
  it('finds the header row below a title row', () => {
    const rows = [['Q3 export'], ['Name', 'Email', 'Amount'], ['Ada', 'ada@x.io', '1200'], ['Bob', 'bob@x.io', '50']];
    expect(detectHeaderRow(rows)).toBe(1);
    expect(detectHeaderRow([['1', '2'], ['3', '4']])).toBe(-1);
    expect(buildHeaders([['Name', 'Name', '']], 0)).toEqual(['Name', 'Name (2)', 'Column 3']);
  });

  it('infers column types with confidence', () => {
    expect(profileColumn(0, 'Email', ['a@x.io', 'b@y.io', '']).inferred).toBe('email');
    expect(profileColumn(0, 'Close date', ['2024-01-02', '2024-02-03']).inferred).toBe('date');
    expect(profileColumn(0, 'Value', ['$1,200', '$900']).inferred).toBe('currency');
    expect(profileColumn(0, 'Value', ['$1,200', '€900']).currency).toBe('USD');
    expect(profileColumn(0, 'Stage', ['Won', 'Lost', 'Won', 'Open']).inferred).toBe('status');
    expect(profileColumn(0, 'Phone', ['+1 415 555 0100', '(212) 555-0199']).inferred).toBe('phone');
    expect(profileColumn(0, 'Active', ['yes', 'no', 'yes']).inferred).toBe('checkbox');
    expect(profileColumn(0, 'Notes', ['free text one', 'another note']).inferred).toBe('text');
    const people = profileColumn(0, 'Owner', ['maya@corp.io', 'Liam Patel'], {
      members: [
        { userId: 'u1', name: 'Maya Chen', email: 'maya@corp.io' },
        { userId: 'u2', name: 'Liam Patel', email: 'liam@corp.io' },
      ],
    });
    expect(people.inferred).toBe('people');
  });
});

describe('mapping', () => {
  const board: TargetColumn[] = [
    { key: 'name', title: 'Deal', type: 'name', settings: {} },
    { key: 'email', title: 'Email address', type: 'email', settings: {} },
    { key: 'stage', title: 'Stage', type: 'status', settings: { labels: [{ id: 'won', name: 'Won', color: 'green', position: 0 }] } },
    { key: 'value', title: 'Deal value', type: 'currency', settings: { currency: 'USD' } },
    { key: 'progress', title: 'Progress', type: 'progress', settings: {} },
  ];

  it('scores header similarity with synonyms', () => {
    expect(nameSimilarity('E-mail', 'Email address')).toBeGreaterThan(0.9);
    expect(nameSimilarity('Amount', 'Deal value')).toBeGreaterThan(0.9);
    expect(nameSimilarity('Zip', 'Stage')).toBeLessThan(0.3);
  });

  it('auto-maps name, compatible existing columns and proposes new columns', () => {
    const headers = ['Deal name', 'E-mail', 'Status', 'Amount', 'Region', 'Empty'];
    const data = [
      ['Acme', 'a@acme.io', 'Won', '$100', 'EMEA', ''],
      ['Globex', 'g@globex.io', 'Lost', '$200', 'NA', ''],
    ];
    const profiles = profileColumns(headers, data);
    const mappings = autoMap(profiles, board);
    expect(mappings.map((mapping) => mapping.target)).toEqual([
      { kind: 'name' },
      { kind: 'existing', columnKey: 'email' },
      { kind: 'existing', columnKey: 'stage' },
      { kind: 'existing', columnKey: 'value' },
      { kind: 'new', type: 'status', title: 'Region' },
      { kind: 'skip' },
    ]);
    expect(validateMapping(mappings, board)).toEqual([]);
  });

  it('applies saved mapping templates first', () => {
    const profiles = profileColumns(['Name', 'Work mail'], [['A', 'a@x.io']]);
    const mappings = autoMap(profiles, board, { 'work mail': 'email' });
    expect(mappings[1]?.target).toEqual({ kind: 'existing', columnKey: 'email' });
  });

  it('reports missing name and duplicate targets', () => {
    const problems = validateMapping(
      [
        { sourceIndex: 0, target: { kind: 'existing', columnKey: 'email' }, confidence: 1, auto: true },
        { sourceIndex: 1, target: { kind: 'existing', columnKey: 'email' }, confidence: 1, auto: true },
        { sourceIndex: 2, target: { kind: 'new', type: 'text', title: 'Stage' }, confidence: 1, auto: true },
      ],
      board,
    );
    expect(problems.map((problem) => problem.sourceIndex)).toEqual([null, 1, 2]);
  });
});

describe('labels + conversion', () => {
  it('plans labels with semantic colors and stable ids', () => {
    const plan = planLabels(null, ['Won', 'Lost', 'Negotiation', 'won'], { isStatus: true, idFactory: (name) => stableLabelId(name) });
    expect(plan.added.map((label) => [label.name, label.color, label.isDone ?? false])).toEqual([
      ['Won', 'green', true],
      ['Lost', 'red', false],
      ['Negotiation', 'orange', false],
    ]);
    expect(plan.labels.at(-1)).toMatchObject({ id: 'default', isDefault: true });
    expect(stableLabelId('x')).toBe(stableLabelId('x'));
  });

  it('converts values per column type and reports problems', () => {
    const status: TargetColumn = { key: 's', title: 'S', type: 'status', settings: { labels: [{ id: 'l1', name: 'Open', color: 'blue', position: 0 }] } };
    expect(convertValue('open', status, ctx)).toEqual({ ok: true, value: { labelId: 'l1' } });
    expect(convertValue('Closed', status, ctx).ok).toBe(false);
    expect(convertValue('$1,200', { key: 'c', title: 'C', type: 'currency', settings: { currency: 'EUR' } }, ctx)).toEqual({
      ok: true,
      value: { amount: 1200, currency: 'USD' },
    });
    expect(convertValue('1200', { key: 'c', title: 'C', type: 'currency', settings: { currency: 'EUR' } }, ctx)).toEqual({
      ok: true,
      value: { amount: 1200, currency: 'EUR' },
    });
    expect(convertValue('bad', { key: 'e', title: 'E', type: 'email', settings: {} }, ctx).ok).toBe(false);
    expect(convertValue('a, b ,a', { key: 't', title: 'T', type: 'tags', settings: {} }, ctx)).toEqual({ ok: true, value: { tags: ['a', 'b'] } });
    expect(convertValue('Germany', { key: 'k', title: 'K', type: 'country', settings: {} }, ctx)).toEqual({ ok: true, value: { code: 'DE' } });
    expect(convertValue('Acme; Globex', { key: 'r', title: 'R', type: 'connect_boards', settings: {} }, ctx)).toEqual({
      ok: true,
      value: null,
      links: ['Acme', 'Globex'],
    });
    expect(convertValue('', { key: 'x', title: 'X', type: 'checkbox', settings: {} }, ctx)).toEqual({ ok: true, value: false });
  });

  it('builds row payloads with overrides, exclusions and dedupe keys', () => {
    const headers = ['Name', 'Email', 'Stage'];
    const data = [
      ['Ada', 'ada@x.io', 'Won'],
      ['', 'nobody@x.io', 'Lost'],
      ['Bob', 'not-an-email', 'Won'],
    ];
    const profiles = profileColumns(headers, data);
    const plan = buildColumnPlan(
      [
        { sourceIndex: 0, target: { kind: 'name' }, confidence: 1, auto: true },
        { sourceIndex: 1, target: { kind: 'new', type: 'email', title: 'Email' }, confidence: 1, auto: true },
        { sourceIndex: 2, target: { kind: 'new', type: 'status', title: 'Stage' }, confidence: 1, auto: true },
      ],
      profiles,
      [],
      data,
    );
    const first = buildRows({ dataRows: data, firstRowNumber: 2, plan, headers, ctx, dedupe: { mode: 'skip', key: 'new_1' } });
    expect(first.rows.map((row) => row.name)).toEqual(['Ada', 'Bob']);
    expect(first.rows[0]?.key).toBe('ada@x.io');
    expect(first.skippedRows).toEqual([3]);
    expect(first.issues.map((issue) => [issue.row, issue.column])).toEqual([
      [3, 'Name'],
      [4, 'Email'],
    ]);
    const fixed = buildRows({
      dataRows: data,
      firstRowNumber: 2,
      plan,
      headers,
      ctx,
      overrides: { [overrideKey(4, 1)]: 'bob@x.io' },
      excludedRows: new Set([2]),
      keyMap: { new_1: 'email', new_2: 'stage' },
    });
    expect(fixed.rows.map((row) => row.name)).toEqual(['Bob']);
    expect(fixed.rows[0]?.values.email).toEqual({ email: 'bob@x.io' });
    expect(Object.keys(fixed.rows[0]?.values ?? {})).toEqual(['email', 'stage']);
    const report = buildErrorReport(first.issues, [{ row: 9, message: 'boom' }]);
    expect(report.split('\r\n')).toHaveLength(4);
  });
});
