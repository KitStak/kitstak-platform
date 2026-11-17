/** The CSV engine: reader, writer, cell readers and header mapping. */
import { describe, expect, it } from 'vitest';
import {
  CSV_LIMITS,
  cleanCell,
  editDistance,
  escapeCell,
  excelSerialToDate,
  exportFileName,
  guardFormula,
  headerSignature,
  headerSimilarity,
  headerWords,
  isFormulaLike,
  mapHeaders,
  mappingToPreset,
  normalizeChoice,
  normalizeHeader,
  normalizeNumber,
  parseBoolean,
  parseChoice,
  parseCode,
  parseCsv,
  parseDate,
  parseEmail,
  parseHours,
  parseInteger,
  parseMoney,
  parseMonth,
  parseNumber,
  parsePercent,
  parsePrice,
  parseText,
  rawCell,
  rowsToObjects,
  sniffDateOrder,
  sniffDelimiter,
  stripBom,
  toCsv,
  unguardFormula,
} from './index';

const BOM = String.fromCharCode(0xfeff);
const TAB = String.fromCharCode(9);
const CRLF = '\r\n';
const b = (n: number | string): bigint => BigInt(n);
const value = <T>(result: { ok: true; value: T } | { ok: false; message: string }): T | string => (result.ok ? result.value : `ERROR ${result.message}`);
const message = (result: { ok: true } | { ok: false; message: string }): string => (result.ok ? 'OK' : result.message);

describe('parseCsv', () => {
  it('reads a simple file', () => {
    const parsed = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(parsed.delimiter).toBe(',');
    expect(parsed.headers).toEqual(['a', 'b', 'c']);
    expect(parsed.rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    expect(parsed.rowNumbers).toEqual([2, 3]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.hadBom).toBe(false);
  });
  it('handles a byte order mark, CRLF, lone CR and no final line end', () => {
    expect(parseCsv(`${BOM}a,b${CRLF}1,2${CRLF}`)).toMatchObject({ hadBom: true, headers: ['a', 'b'], rows: [['1', '2']] });
    expect(parseCsv('a,b\r1,2\r3,4').rows).toEqual([['1', '2'], ['3', '4']]);
    expect(parseCsv('a,b\n1,2').rows).toEqual([['1', '2']]);
    expect(stripBom(`${BOM}x`)).toBe('x');
  });
  it('reads quoted cells with separators, quotes and line breaks inside', () => {
    const parsed = parseCsv('name,note\n"Acme, Inc.","He said ""rush"" it"\n"Line one\nLine two",ok\n"multi\r\nline",x\n');
    expect(parsed.rows).toEqual([
      ['Acme, Inc.', 'He said "rush" it'],
      ['Line one\nLine two', 'ok'],
      ['multi\r\nline', 'x'],
    ]);
    expect(parsed.rowNumbers).toEqual([2, 3, 4]);
  });
  it('keeps a quote in the middle of a plain cell, and text after a closing quote', () => {
    expect(parseCsv('a,b\n5" tape,"x"y\n').rows).toEqual([['5" tape', 'xy']]);
  });
  it('keeps outer spaces inside quotes and leaves cells untrimmed', () => {
    expect(parseCsv('a,b\n"  padded  ", plain \n').rows).toEqual([['  padded  ', ' plain ']]);
  });
  it('skips blank lines but numbers rows the way a spreadsheet does', () => {
    const parsed = parseCsv('\n\na,b\n\n1,2\n,\n   \n3,4\n\n');
    expect(parsed.headers).toEqual(['a', 'b']);
    expect(parsed.rows).toEqual([['1', '2'], ['3', '4']]);
    expect(parsed.rowNumbers).toEqual([5, 8]);
  });
  it('keeps a row whose only cell is a quoted empty text', () => {
    expect(parseCsv('a\n""\nx\n').rows).toEqual([[''], ['x']]);
  });
  it('detects semicolon and tab files, and ignores separators inside quotes', () => {
    expect(parseCsv('a;b;c\n1,5;2;3\n').rows).toEqual([['1,5', '2', '3']]);
    expect(parseCsv(`a${TAB}b\n1${TAB}2\n`)).toMatchObject({ delimiter: TAB, rows: [['1', '2']] });
    expect(sniffDelimiter('name;note\n"a,b,c,d";x\n"e,f,g";y\n')).toBe(';');
    expect(sniffDelimiter('a,b,c\n"x;y;z;w",2,3\n')).toBe(',');
    expect(sniffDelimiter('single\ncolumn\n')).toBe(',');
    expect(sniffDelimiter('')).toBe(',');
    expect(sniffDelimiter(`${BOM}a;b\n1;2\n`)).toBe(';');
  });
  it('lets the caller force the separator', () => {
    expect(parseCsv('a;b\n1;2\n', { delimiter: ',' }).headers).toEqual(['a;b']);
  });
  it('pads short rows and reports extra cells', () => {
    const parsed = parseCsv('a,b,c\n1\n1,2,3,4\n1,2,3,,\n');
    expect(parsed.rows).toEqual([['1', '', ''], ['1', '2', '3'], ['1', '2', '3']]);
    expect(parsed.problems).toEqual([{ level: 'warning', code: 'extra_cells', row: 3, message: 'Row 3 has more cells than the header row. The extra cells are ignored.' }]);
  });
  it('trims headers, drops trailing empty ones and flags duplicates and blanks', () => {
    const parsed = parseCsv(' Job Number , Units ,,Units,,\nJ-1,5,x,6\n');
    expect(parsed.headers).toEqual(['Job Number', 'Units', '', 'Units']);
    expect(parsed.problems.map((problem) => problem.code)).toEqual(['blank_header', 'duplicate_header']);
    expect(parsed.problems[1]?.message).toBe('The header "Units" is there twice. Only the first one is used.');
    expect(rowsToObjects(parsed)).toEqual([{ 'Job Number': 'J-1', Units: '5' }]);
  });
  it('reports an empty file and a quote that never closes', () => {
    expect(parseCsv('').problems[0]).toMatchObject({ level: 'error', code: 'empty_file' });
    expect(parseCsv('\n\n  \n').problems[0]?.code).toBe('empty_file');
    const open = parseCsv('a,b\n1,"never closed\n2,3\n');
    expect(open.problems[0]).toEqual({ level: 'error', code: 'unclosed_quote', row: 2, message: 'Row 2 opens a quote that is never closed. Check for a missing " mark.' });
  });
  it('enforces the limits in plain words', () => {
    expect(CSV_LIMITS).toEqual({ maxBytes: 10 * 1024 * 1024, maxRows: 50000, maxColumns: 200, maxCellLength: 2000 });
    const rows = parseCsv('a\n1\n2\n3\n', { maxRows: 2 });
    expect(rows.rows).toHaveLength(2);
    expect(rows.problems[0]).toMatchObject({ code: 'too_many_rows', message: 'This file has 3 rows. The limit is 2. Split it into smaller files.' });
    const columns = parseCsv('a,b,c\n1,2,3\n', { maxColumns: 2 });
    expect(columns.headers).toEqual(['a', 'b']);
    expect(columns.problems[0]?.code).toBe('too_many_columns');
    const long = parseCsv(`a\n${'x'.repeat(30)}\n`, { maxCellLength: 10 });
    expect(long.rows[0]?.[0]).toHaveLength(10);
    expect(long.problems[0]).toMatchObject({ code: 'cell_too_long', row: 2 });
    const big = parseCsv('a\n1234567890\n', { maxBytes: 5 });
    expect(big.problems[0]).toMatchObject({ level: 'error', code: 'file_too_large' });
    expect(big.rows).toEqual([]);
  });
  it('reads 50,000 rows quickly', () => {
    const lines = ['work_date,job_number,units_good,note'];
    for (let i = 0; i < 50000; i += 1) lines.push(`2026-11-02,J-${i},${i},"note, with comma ${i}"`);
    const started = Date.now();
    const parsed = parseCsv(lines.join('\n'));
    expect(parsed.rows).toHaveLength(50000);
    expect(parsed.rows[49999]).toEqual(['2026-11-02', 'J-49999', '49999', 'note, with comma 49999']);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('toCsv', () => {
  it('writes CRLF and a byte order mark by default', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe(`${BOM}a,b${CRLF}1,2${CRLF}`);
    expect(toCsv(['a'], [['1']], { bom: false, lineEnd: 'lf' })).toBe('a\n1\n');
    expect(toCsv(['a', 'b'], [])).toBe(`${BOM}a,b${CRLF}`);
  });
  it('quotes cells that need it', () => {
    expect(escapeCell('Acme, Inc.')).toBe('"Acme, Inc."');
    expect(escapeCell('He said "rush"')).toBe('"He said ""rush"""');
    expect(escapeCell('two\nlines')).toBe('"two\nlines"');
    expect(escapeCell(' padded ')).toBe('" padded "');
    expect(escapeCell('plain')).toBe('plain');
    expect(escapeCell('a;b', { delimiter: ';' })).toBe('"a;b"');
    expect(escapeCell('a;b')).toBe('a;b');
  });
  it('writes numbers, bigints, booleans and blanks', () => {
    expect(toCsv(['a', 'b', 'c', 'd', 'e', 'f'], [[1.5, b(-4500), true, false, null, undefined]], { bom: false })).toBe(`a,b,c,d,e,f${CRLF}1.5,-4500,yes,no,,${CRLF}`);
    expect(escapeCell(Number.NaN)).toBe('');
  });
  it('guards text cells against formulas, and leaves numbers alone', () => {
    for (const text of ['=SUM(A1:A9)', '+1 555 0100', '- call client', '@handle', `${TAB}tabbed`, '\rreturn']) {
      expect(isFormulaLike(text)).toBe(true);
      expect(guardFormula(text)).toBe(`'${text}`);
    }
    expect(guardFormula('plain')).toBe('plain');
    expect(guardFormula('')).toBe('');
    expect(guardFormula("it's fine")).toBe("it's fine");
    expect(toCsv(['note', 'amount'], [['=1+1', rawCell('-45.00')]], { bom: false })).toBe(`note,amount${CRLF}'=1+1,-45.00${CRLF}`);
    expect(toCsv(['note'], [['=1+1']], { bom: false, guard: false })).toBe(`note${CRLF}=1+1${CRLF}`);
    expect(escapeCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
  it('round trips every guarded text exactly', () => {
    const texts = ['- call client', '+1 555 0100', '=A1', '@x', "'=already guarded", "''+two", "'plain apostrophe", 'plain', '', "'", "'-"];
    for (const text of texts) expect(unguardFormula(guardFormula(text))).toBe(text);
    expect(unguardFormula("'plain apostrophe")).toBe("'plain apostrophe");
    expect(unguardFormula("'=1+1")).toBe('=1+1');
    expect(unguardFormula("''=1+1")).toBe("'=1+1");
  });
  it('survives a full write then read', () => {
    const rows = [
      ['Acme, Inc.', 'He said "rush"', 'two\nlines', ' padded ', '- call client', '+1 555 0100'],
      ['', 'x', '', 'y', '', '=1+1'],
    ];
    for (const delimiter of [',', ';', TAB] as const) {
      const parsed = parseCsv(toCsv(['a', 'b', 'c', 'd', 'e', 'f'], rows, { delimiter }), { delimiter });
      expect(parsed.problems).toEqual([]);
      expect(parsed.rows.map((row) => row.map((cell) => unguardFormula(cell)))).toEqual(rows);
    }
  });
  it('names export files', () => {
    expect(exportFileName('production', 'Northwind Robotics', '2026-11-01', '2026-11-30')).toBe('pulse-production-northwind-robotics-2026-11-01-to-2026-11-30.csv');
    expect(exportFileName('job_plans', 'kitstak')).toBe('pulse-job-plans-kitstak.csv');
    expect(exportFileName('costs', 'kitstak', '2026-11-01')).toBe('pulse-costs-kitstak-from-2026-11-01.csv');
    expect(exportFileName('costs', 'kitstak', null, '2026-11-30')).toBe('pulse-costs-kitstak-to-2026-11-30.csv');
  });
});

describe('cell readers', () => {
  it('cleans raw cells', () => {
    expect(cleanCell('  x  ')).toBe('x');
    expect(cleanCell(`${BOM}x${String.fromCharCode(0x200b)}`)).toBe('x');
    expect(cleanCell(`1${String.fromCharCode(0xa0)}234`)).toBe('1 234');
    expect(cleanCell("'- call client")).toBe('- call client');
    expect(cleanCell("'+1 555")).toBe('+1 555');
    expect(cleanCell("'quoted")).toBe("'quoted");
    expect(cleanCell(null)).toBe('');
    expect(cleanCell(undefined)).toBe('');
  });
  it('normalizes numbers in US and European styles', () => {
    expect(normalizeNumber('1,234.50')).toBe('1234.50');
    expect(normalizeNumber('1.234,50')).toBe('1234.50');
    expect(normalizeNumber('1 234,50')).toBe('1234.50');
    expect(normalizeNumber("1'234.50")).toBe('1234.50');
    expect(normalizeNumber('1,234')).toBe('1234');
    expect(normalizeNumber('1,234,567')).toBe('1234567');
    expect(normalizeNumber('12,5')).toBe('12.5');
    expect(normalizeNumber('1.234.567')).toBe('1234567');
    expect(normalizeNumber('1.234')).toBe('1.234');
    expect(normalizeNumber('.5')).toBe('0.5');
    expect(normalizeNumber('5.')).toBe('5');
    expect(normalizeNumber('-7')).toBe('-7');
    expect(normalizeNumber('-0')).toBe('0');
    expect(normalizeNumber('+7')).toBe('7');
    expect(normalizeNumber('1,234', ',')).toBe('1.234');
    expect(normalizeNumber('1.234', ',')).toBe('1234');
    expect(normalizeNumber('1,23', '.')).toBeNull();
    for (const bad of ['', 'abc', '9x', '1,2,3', '1.2.3,4.5', '12,34,567', '.', ',', '1e5', '--1']) expect(normalizeNumber(bad)).toBeNull();
  });
  it('reads numbers with a scale and bounds', () => {
    expect(value(parseNumber('3,000', { scale: 3 }))).toBe('3000.000');
    expect(value(parseNumber('12.34567', { scale: 3 }))).toBe('12.346');
    expect(value(parseNumber('0', { scale: 2 }))).toBe('0.00');
    expect(message(parseNumber('9x', { scale: 2 }))).toBe('9x is not a number.');
    expect(message(parseNumber('-5', { scale: 2 }))).toBe('-5 cannot be below zero.');
    expect(value(parseNumber('-5', { scale: 2, min: null }))).toBe('-5.00');
    expect(message(parseNumber('0', { scale: 3, positive: true }))).toBe('0 must be more than zero.');
    expect(message(parseNumber('100000000', { scale: 3 }))).toBe('100000000 is too big. It must be under 100,000,000.');
    expect(value(parseNumber('99999999.999', { scale: 3 }))).toBe('99999999.999');
    expect(message(parseNumber('0.5', { scale: 2, min: '1' }))).toBe('0.5 is too low. The lowest allowed is 1.');
  });
  it('reads whole numbers', () => {
    expect(value(parseInteger('30'))).toBe(30);
    expect(value(parseInteger('1,000'))).toBe(1000);
    expect(value(parseInteger('30.0'))).toBe(30);
    expect(message(parseInteger('30.5'))).toBe('30.5 is not a whole number.');
    expect(message(parseInteger('abc'))).toBe('abc is not a whole number.');
    expect(message(parseInteger('-1'))).toBe('-1 cannot be below zero.');
    expect(message(parseInteger('500', { max: 365 }))).toBe('500 is too big. The most allowed is 365.');
  });
  it('reads money with symbols, separators and every way of writing a negative', () => {
    expect(value(parseMoney('1234.5'))).toBe(b(123450));
    expect(value(parseMoney('$1,234.50'))).toBe(b(123450));
    expect(value(parseMoney('(45.00)'))).toBe(b(-4500));
    expect(value(parseMoney('-45'))).toBe(b(-4500));
    expect(value(parseMoney('($1,045.10)'))).toBe(b(-104510));
    expect(value(parseMoney('-$45.00'))).toBe(b(-4500));
    expect(value(parseMoney('$-45.00'))).toBe(b(-4500));
    expect(value(parseMoney('45.00-'))).toBe(b(-4500));
    expect(value(parseMoney(`${String.fromCharCode(0x2212)}45`))).toBe(b(-4500));
    expect(value(parseMoney('1.234,50 €'))).toBe(b(123450));
    expect(value(parseMoney('USD 45'))).toBe(b(4500));
    expect(value(parseMoney('CA$45.10'))).toBe(b(4510));
    expect(value(parseMoney('£0.99'))).toBe(b(99));
    expect(value(parseMoney('+12'))).toBe(b(1200));
    expect(value(parseMoney('0'))).toBe(b(0));
    expect(value(parseMoney('12.345'))).toBe(b(1235));
    expect(value(parseMoney('1234.5000000001'))).toBe(b(123450));
    expect(message(parseMoney('abc'))).toBe('abc is not an amount of money.');
    expect(message(parseMoney('$'))).toBe('$ is not an amount of money.');
    expect(message(parseMoney('12 dollars'))).toBe('12 dollars is not an amount of money.');
    expect(message(parseMoney('-45', { allowNegative: false }))).toBe('-45 cannot be below zero.');
    expect(message(parseMoney('100000000000'))).toBe('100000000000 is too big.');
    expect(value(parseMoney('99999999999.99'))).toBe(b('9999999999999'));
  });
  it('reads unit prices to 4 places', () => {
    expect(value(parsePrice('$0.0350'))).toBe('0.0350');
    expect(value(parsePrice('2.75'))).toBe('2.7500');
    expect(value(parsePrice('0,035'))).toBe('0.0350');
    expect(message(parsePrice('-1'))).toBe('-1 cannot be below zero.');
    expect(message(parsePrice('free'))).toBe('free is not a price.');
    expect(message(parsePrice('1000000'))).toBe('1000000 is too big. It must be under 1,000,000.');
  });
  it('reads percents: 28 and 28% both mean 28 percent', () => {
    expect(value(parsePercent('28'))).toBe(2800);
    expect(value(parsePercent('28%'))).toBe(2800);
    expect(value(parsePercent('28.5 %'))).toBe(2850);
    expect(value(parsePercent('9 percent'))).toBe(900);
    expect(value(parsePercent('0.28'))).toBe(28);
    expect(value(parsePercent('0'))).toBe(0);
    expect(message(parsePercent('lots'))).toBe('lots is not a percent. Use a number like 28 or 28%.');
    expect(message(parsePercent('-5%'))).toBe('-5% cannot be below zero.');
    expect(message(parsePercent('120', { maxBp: 10000 }))).toBe('120 is too high. The most allowed is 100%.');
    expect(value(parsePercent('-5', { minBp: -10000 }))).toBe(-500);
  });
  it('reads hours as 7.5, 7:30 and in words', () => {
    expect(value(parseHours('7.5'))).toBe('7.50');
    expect(value(parseHours('7,5'))).toBe('7.50');
    expect(value(parseHours('7:30'))).toBe('7.50');
    expect(value(parseHours('0:45'))).toBe('0.75');
    expect(value(parseHours('7:20'))).toBe('7.33');
    expect(value(parseHours('7:30:00'))).toBe('7.50');
    expect(value(parseHours('120:15'))).toBe('120.25');
    expect(value(parseHours('7h 30m'))).toBe('7.50');
    expect(value(parseHours('7h30m'))).toBe('7.50');
    expect(value(parseHours('7.5 hrs'))).toBe('7.50');
    expect(value(parseHours('8 hours'))).toBe('8.00');
    expect(value(parseHours('90 min'))).toBe('1.50');
    expect(value(parseHours('45m'))).toBe('0.75');
    expect(value(parseHours('1,024.5'))).toBe('1024.50');
    expect(value(parseHours('0'))).toBe('0.00');
    expect(message(parseHours('9x'))).toBe('9x is not a number of hours. Use 7.5 or 7:30.');
    expect(message(parseHours('7:75'))).toBe('7:75 is not a time. Minutes go from 00 to 59.');
    expect(message(parseHours('-2'))).toBe('-2 cannot be below zero.');
    expect(message(parseHours('100000000'))).toBe('100000000 is too big.');
  });
  it('reads dates in the common formats', () => {
    expect(value(parseDate('2026-11-03'))).toBe('2026-11-03');
    expect(value(parseDate('2026-1-3'))).toBe('2026-01-03');
    expect(value(parseDate('2026/11/03'))).toBe('2026-11-03');
    expect(value(parseDate('2026.11.03'))).toBe('2026-11-03');
    expect(value(parseDate('20261103'))).toBe('2026-11-03');
    expect(value(parseDate('2026-11-03T14:30:00Z'))).toBe('2026-11-03');
    expect(value(parseDate('2026-11-03 14:30'))).toBe('2026-11-03');
    expect(value(parseDate('11/3/2026'))).toBe('2026-11-03');
    expect(value(parseDate('11/03/26'))).toBe('2026-11-03');
    expect(value(parseDate('11-3-2026'))).toBe('2026-11-03');
    expect(value(parseDate('11.3.2026'))).toBe('2026-11-03');
    expect(value(parseDate('11/3/2026 8:00 AM'))).toBe('2026-11-03');
    expect(value(parseDate('3/11/2026', { dateOrder: 'DMY' }))).toBe('2026-11-03');
    expect(value(parseDate('Nov 3 2026'))).toBe('2026-11-03');
    expect(value(parseDate('Nov 3, 2026'))).toBe('2026-11-03');
    expect(value(parseDate('November 3rd, 2026'))).toBe('2026-11-03');
    expect(value(parseDate('3 Nov 2026'))).toBe('2026-11-03');
    expect(value(parseDate('3-Nov-26'))).toBe('2026-11-03');
    expect(value(parseDate('Sept 1 2026'))).toBe('2026-09-01');
    expect(value(parseDate('1/2/99'))).toBe('1999-01-02');
  });
  it('reads Excel serial numbers', () => {
    expect(value(parseDate('46329'))).toBe('2026-11-03');
    expect(value(parseDate('46329.75'))).toBe('2026-11-03');
    expect(excelSerialToDate(45000)).toBe('2023-03-15');
    expect(excelSerialToDate(61)).toBe('1900-03-01');
    expect(excelSerialToDate(0)).toBeNull();
    expect(message(parseDate('123'))).toBe('123 is not a date. Use a date like 2026-11-03.');
    expect(message(parseDate('1234567'))).toBe('1234567 is not a date. Use a date like 2026-11-03.');
  });
  it('explains dates it cannot read', () => {
    expect(message(parseDate('soon'))).toBe('soon is not a date. Use a date like 2026-11-03.');
    expect(message(parseDate('2026-02-30'))).toBe('2026-02-30 is not a real date. Check the month and the day.');
    expect(message(parseDate('2/30/2026'))).toBe('2/30/2026 is not a real date. Check the month and the day.');
    expect(message(parseDate('13/11/2026'))).toBe('13/11/2026 is not a real date when read as month/day/year. If your file has the day first, change the date order.');
    expect(message(parseDate('11/13/2026', { dateOrder: 'DMY' }))).toBe('11/13/2026 is not a real date when read as day/month/year. If your file has the month first, change the date order.');
    expect(message(parseDate('0206-11-03'))).toBe('0206-11-03 has the year 206. Check the year.');
    expect(message(parseDate('Foo 3 2026'))).toBe('Foo 3 2026 is not a date. Use a date like 2026-11-03.');
    expect(value(parseDate('2028-02-29'))).toBe('2028-02-29');
    expect(message(parseDate('2027-02-29'))).toContain('not a real date');
  });
  it('works out the date order of a column', () => {
    expect(sniffDateOrder(['3/11/2026', '13/11/2026'])).toBe('DMY');
    expect(sniffDateOrder(['11/3/2026', '11/13/2026'])).toBe('MDY');
    expect(sniffDateOrder(['3/4/2026', '5/6/2026'])).toBeNull();
    expect(sniffDateOrder(['13/11/2026', '11/13/2026'])).toBeNull();
    expect(sniffDateOrder(['2026-11-03', ''])).toBeNull();
  });
  it('reads months', () => {
    expect(value(parseMonth('2026-11'))).toBe('2026-11');
    expect(value(parseMonth('2026-11-01'))).toBe('2026-11');
    expect(value(parseMonth('11/2026'))).toBe('2026-11');
    expect(value(parseMonth('Nov 2026'))).toBe('2026-11');
    expect(value(parseMonth('November, 2026'))).toBe('2026-11');
    expect(message(parseMonth('2026-13'))).toBe('2026-13 is not a month. Use a month like 2026-11.');
    expect(message(parseMonth('next month'))).toBe('next month is not a month. Use a month like 2026-11.');
  });
  it('reads yes and no', () => {
    for (const yes of ['yes', 'YES', 'true', '1', 'y', 'On']) expect(value(parseBoolean(yes))).toBe(true);
    for (const no of ['no', 'No', 'false', '0', 'n', 'off']) expect(value(parseBoolean(no))).toBe(false);
    expect(message(parseBoolean('maybe'))).toBe('maybe is not yes or no.');
  });
  it('reads a choice from a list, with aliases', () => {
    const values = ['per_unit', 'fixed', 'hourly'] as const;
    expect(value(parseChoice('per_unit', values))).toBe('per_unit');
    expect(value(parseChoice('Per Unit', values))).toBe('per_unit');
    expect(value(parseChoice('PER-UNIT', values))).toBe('per_unit');
    expect(value(parseChoice('Flat fee', values, { 'flat fee': 'fixed' }))).toBe('fixed');
    expect(message(parseChoice('weekly', values))).toBe('weekly is not one of: per_unit, fixed, hourly.');
    expect(normalizeChoice(' Time & Materials ')).toBe('time_and_materials');
  });
  it('reads text, codes and emails', () => {
    expect(value(parseText('hello'))).toBe('hello');
    expect(message(parseText('x'.repeat(2001)))).toBe('This text is longer than 2,000 characters.');
    expect(value(parseCode('J-1042'))).toBe('J-1042');
    expect(message(parseCode('a\nb'))).toBe('A code cannot have a line break in it.');
    expect(message(parseCode('x'.repeat(121)))).toContain('is longer than 120 characters.');
    expect(value(parseEmail('Dana@Acme.Example'))).toBe('dana@acme.example');
    expect(message(parseEmail('dana at acme'))).toBe('dana at acme is not an email address.');
  });
  it('shortens long cells in messages', () => {
    expect(message(parseNumber('x'.repeat(60), { scale: 2 }))).toBe(`${'x'.repeat(37)}... is not a number.`);
  });
});

describe('header mapping', () => {
  const columns = [
    { key: 'work_date', label: 'Work date', aliases: ['date', 'day'], required: true },
    { key: 'job_number', label: 'Job number', aliases: ['job', 'job no', 'work order'], required: true },
    { key: 'units_good', label: 'Good units', aliases: ['good units', 'qty finished', 'units finished'], required: true },
    { key: 'units_scrap', label: 'Scrap units', aliases: ['scrap'] },
    { key: 'labor_hours', label: 'Labor hours', aliases: ['hours', 'man hours'] },
    { key: 'overtime_hours', label: 'Overtime hours', aliases: ['ot hours'] },
    { key: 'note', label: 'Note', aliases: ['notes', 'comment'] },
  ];
  it('normalizes headers', () => {
    expect(normalizeHeader('Units Good')).toBe('unitsgood');
    expect(normalizeHeader('units_good')).toBe('unitsgood');
    expect(normalizeHeader(' UNITS-GOOD! ')).toBe('unitsgood');
    expect(headerWords('qtyFinished (units)')).toEqual(['qty', 'finished', 'unit']);
    expect(headerWords('Job #')).toEqual(['job']);
    expect(headerWords('No')).toEqual(['no']);
  });
  it('maps the four spellings from the spec to units_good', () => {
    for (const header of ['Units Good', 'units_good', 'Good units', 'qty finished']) {
      expect(mapHeaders(['Date', 'Job', header], columns).columns).toEqual(['work_date', 'job_number', 'units_good']);
    }
  });
  it('says how each header matched', () => {
    const mapping = mapHeaders(['WORK DATE', 'Job No.', 'Units Finished', 'Labour Hours', 'Scrapped units', 'Machine'], columns);
    expect(mapping.columns).toEqual(['work_date', 'job_number', 'units_good', 'labor_hours', null, null]);
    expect(mapping.matches.map((match) => match.how)).toEqual(['exact', 'alias', 'alias', 'fuzzy']);
    expect(mapping.matches[3]?.score).toBeGreaterThanOrEqual(0.84);
    expect(mapping.unmatched.map((item) => item.header)).toEqual(['Scrapped units', 'Machine']);
    expect(mapping.unmatched[0]?.suggestions[0]?.column).toBe('units_scrap');
    expect(mapping.unmatched[1]?.suggestions).toEqual([]);
    expect(mapping.missingRequired).toEqual([]);
  });
  it('matches words in another order and small typos', () => {
    expect(mapHeaders(['Hours (labor)'], columns).columns).toEqual(['labor_hours']);
    expect(mapHeaders(['Overtme Hours'], columns).columns).toEqual(['overtime_hours']);
    expect(mapHeaders(['Job Numbr'], columns).columns).toEqual(['job_number']);
    expect(mapHeaders(['Job Numbr'], columns, { fuzzy: false }).columns).toEqual([null]);
  });
  it('does not guess when two columns are about as close', () => {
    const mapping = mapHeaders(['Units'], columns);
    expect(mapping.columns).toEqual([null]);
    expect(mapping.unmatched[0]?.suggestions.map((suggestion) => suggestion.column).sort()).toEqual(['units_good', 'units_scrap']);
  });
  it('feeds each column from one header, the first one', () => {
    const mapping = mapHeaders(['Date', 'work_date', 'Day'], columns);
    expect(mapping.columns).toEqual([null, 'work_date', null]);
    expect(mapHeaders(['Date', 'Day'], columns).columns).toEqual(['work_date', null]);
  });
  it('lists needed columns that are missing', () => {
    expect(mapHeaders(['Job', 'Hours'], columns).missingRequired).toEqual(['work_date', 'units_good']);
    expect(mapHeaders([], columns).missingRequired).toEqual(['work_date', 'job_number', 'units_good']);
  });
  it('lets a saved mapping win, including "ignore this header"', () => {
    const preset = { finished: 'units_good', date: null, machine: null };
    const mapping = mapHeaders(['Date', 'Posting Day', 'Finished', 'Machine', 'Job'], columns, { preset: { ...preset, postingday: 'work_date' } });
    expect(mapping.columns).toEqual([null, 'work_date', 'units_good', null, 'job_number']);
    expect(mapping.matches.filter((match) => match.how === 'preset').map((match) => match.header)).toEqual(['Posting Day', 'Finished']);
    expect(mapping.unmatched).toEqual([]);
    // a preset that names an unknown column is ignored
    expect(mapHeaders(['Finished'], columns, { preset: { finished: 'nope' } }).columns).toEqual([null]);
  });
  it('saves a mapping as a preset keyed by the header set', () => {
    const headers = ['Posting Day', 'Finished', 'Machine'];
    const preset = mappingToPreset(headers, ['work_date', 'units_good', null]);
    expect(preset).toEqual({ postingday: 'work_date', finished: 'units_good', machine: null });
    expect(mapHeaders(headers, columns, { preset }).columns).toEqual(['work_date', 'units_good', null]);
    expect(headerSignature(headers)).toBe(headerSignature(['machine', 'FINISHED', 'posting_day']));
    expect(headerSignature(headers)).not.toBe(headerSignature(['Posting Day', 'Finished']));
    expect(headerSignature(headers)).toMatch(/^h[0-9a-f]{8}n3$/);
  });
  it('scores similarity sensibly', () => {
    expect(headerSimilarity('Units Good', 'units_good')).toBe(1);
    expect(headerSimilarity('Good units', 'units_good')).toBe(0.95);
    expect(headerSimilarity('Machine', 'units_good')).toBeLessThan(0.5);
    expect(headerSimilarity('', 'units_good')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
});
