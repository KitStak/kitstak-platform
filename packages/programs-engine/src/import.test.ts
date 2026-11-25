import { describe, expect, it } from 'vitest';
import { VARIANTS } from './glove.fixture';
import { MAX_QTY_SCALED, dateCellProblem, matchVariant, noVariantMessage, parseDateCell, parseOutputCsv, parsePlanCsv, parsePlanPaste } from './import';

const MATCHES = VARIANTS.map((variant) => ({ id: variant.id, key: variant.key, name: variant.name, sku: variant.sku }));
const WEEK = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];

describe('matchVariant', () => {
  it('matches SKU, then key, then name, without regard to case or spaces', () => {
    expect(matchVariant('glove-s-brn', MATCHES)?.id).toBe('v-S-BRN');
    expect(matchVariant('XL-YLW', MATCHES)?.id).toBe('v-XL-YLW');
    expect(matchVariant('  medium   yellow ', MATCHES)?.id).toBe('v-M-YLW');
    expect(matchVariant('', MATCHES)).toBeNull();
    expect(matchVariant('GLOVE-XXL-RED', MATCHES)).toBeNull();
  });
  it('a SKU beats a key that looks the same', () => {
    const tricky = [
      { id: 'a', key: 'GLOVE-S-BRN', name: 'A', sku: null },
      { id: 'b', key: 'B', name: 'B', sku: 'GLOVE-S-BRN' },
    ];
    expect(matchVariant('GLOVE-S-BRN', tricky)?.id).toBe('b');
  });
  it('says why a token did not match', () => {
    expect(noVariantMessage('GLOVE-XXL-RED')).toBe('No variant has the SKU GLOVE-XXL-RED.');
    expect(noVariantMessage('Small Red')).toBe('No variant is called Small Red.');
  });
});

describe('parseDateCell', () => {
  it('reads full dates', () => {
    expect(parseDateCell('2026-11-30')).toBe('2026-11-30');
    expect(parseDateCell('11/30/2026')).toBe('2026-11-30');
    expect(parseDateCell('11/30/26')).toBe('2026-11-30');
    expect(parseDateCell('November 30, 2026')).toBe('2026-11-30');
    expect(parseDateCell('Monday, Nov 30 2026')).toBe('2026-11-30');
  });
  it('finds dates without a year among the planning days', () => {
    expect(parseDateCell('11/30', WEEK)).toBe('2026-11-30');
    expect(parseDateCell('Dec 2', WEEK)).toBe('2026-12-02');
    expect(parseDateCell('Thu Dec 3', WEEK)).toBe('2026-12-03');
    expect(parseDateCell('Dec 9', WEEK)).toBeNull();
    expect(parseDateCell('11/30')).toBeNull();
  });
  it('refuses what is not a date', () => {
    expect(parseDateCell('2026-02-30')).toBeNull();
    expect(parseDateCell('Smarch 3')).toBeNull();
    expect(parseDateCell('GLOVE-S-BRN')).toBeNull();
    expect(parseDateCell('2026-12-09', WEEK)).toBeNull();
  });
  it('refuses a weekday word that does not match the date, and says why', () => {
    // Nov 30, 2026 is a Monday, so "Tue Nov 30" could mean Tuesday Dec 1 or Monday Nov 30.
    expect(parseDateCell('Tue Nov 30', WEEK)).toBeNull();
    expect(dateCellProblem('Tue Nov 30', WEEK)).toBe('Nov 30 is a Monday, not a Tuesday.');
    expect(dateCellProblem('Friday, 2026-11-30')).toBe('2026-11-30 is a Monday, not a Friday.');
    expect(parseDateCell('Mon Nov 30', WEEK)).toBe('2026-11-30');
    expect(parseDateCell('Tuesday Dec 1', WEEK)).toBe('2026-12-01');
    expect(dateCellProblem('Mon Nov 30', WEEK)).toBeNull();
    expect(dateCellProblem('Dec 9', WEEK)).toBe('Dec 9 is outside the days you are planning.');
    expect(dateCellProblem('Nov 30')).toBe('Nov 30 has no year. Use dates like 2026-11-30.');
    expect(dateCellProblem('Smarch 3', WEEK)).toBe('The date Smarch 3 is not a date this can read.');
  });
  it('reports a wrong weekday in a pasted plan instead of moving it to another day', () => {
    const grid = parsePlanPaste({ text: 'SKU\tTue Nov 30\tTue Dec 1\nGLOVE-S-BRN\t100\t80', variants: MATCHES, dates: WEEK });
    expect(grid.cells).toEqual([{ variantId: 'v-S-BRN', date: '2026-12-01', qty: '80.000' }]);
    expect(grid.unmatched).toEqual([{ line: 1, raw: 'SKU\tTue Nov 30\tTue Dec 1', why: 'Nov 30 is a Monday, not a Tuesday.' }]);
    const rows = parsePlanPaste({ text: 'Tue Nov 30,S-BRN,100\nMon Nov 30,S-YLW,50', variants: MATCHES, dates: WEEK });
    expect(rows.cells).toEqual([{ variantId: 'v-S-YLW', date: '2026-11-30', qty: '50.000' }]);
    expect(rows.unmatched).toEqual([{ line: 1, raw: 'Tue Nov 30,S-BRN,100', why: 'Nov 30 is a Monday, not a Tuesday.' }]);
  });
});

describe('parseOutputCsv', () => {
  it('E46 three good lines and one unknown SKU', () => {
    const text = ['date,sku,qty,scrap', '2026-11-23,GLOVE-S-BRN,100,2', '2026-11-23,GLOVE-S-YLW,98', '2026-11-23,Medium Brown,"1,200"', '2026-11-23,GLOVE-XXL-RED,5'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([
      { workDate: '2026-11-23', variantId: 'v-S-BRN', qty: '100.000', scrapQty: '2.000' },
      { workDate: '2026-11-23', variantId: 'v-S-YLW', qty: '98.000', scrapQty: '0.000' },
      { workDate: '2026-11-23', variantId: 'v-M-BRN', qty: '1200.000', scrapQty: '0.000' },
    ]);
    expect(result.unmatched).toEqual([{ line: 5, raw: '2026-11-23,GLOVE-XXL-RED,5', why: 'No variant has the SKU GLOVE-XXL-RED.' }]);
  });
  it('reads columns in any order from the header', () => {
    const result = parseOutputCsv({ text: 'Variant\tScrap\tBuilt\tDay\nS-BRN\t1\t40\t11/23/2026', variants: MATCHES });
    expect(result.rows).toEqual([{ workDate: '2026-11-23', variantId: 'v-S-BRN', qty: '40.000', scrapQty: '1.000' }]);
  });
  it('works without a header and lists every bad line', () => {
    const text = ['2026-11-23,S-BRN,10', 'soon,S-BRN,10', ',S-BRN,10', '2026-11-23,,10', '2026-11-23,S-BRN,', '2026-11-23,S-BRN,ten', '2026-11-23,S-BRN,-4', '2026-11-23,S-BRN,4,bad'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toHaveLength(1);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, 'The date soon is not a date this can read.'],
      [3, 'This row has no date.'],
      [4, 'This row has no SKU or variant.'],
      [5, 'This row has no qty.'],
      [6, 'The qty ten is not a number.'],
      [7, 'The qty cannot be less than 0.'],
      [8, 'The scrap bad is not a number.'],
    ]);
  });
  it('adds up lines for the same variant and day and says which lines were combined', () => {
    const text = ['date,sku,qty,scrap', '2026-11-02,GLOVE-S-BRN,10,1', '2026-11-02,GLOVE-S-YLW,7', '2026-11-02,s-brn,5,2', '2026-11-03,GLOVE-S-BRN,4'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([
      { workDate: '2026-11-02', variantId: 'v-S-BRN', qty: '15.000', scrapQty: '3.000' },
      { workDate: '2026-11-02', variantId: 'v-S-YLW', qty: '7.000', scrapQty: '0.000' },
      { workDate: '2026-11-03', variantId: 'v-S-BRN', qty: '4.000', scrapQty: '0.000' },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.merged).toEqual([{ line: 4, raw: '2026-11-02,s-brn,5,2', why: 'Added to line 2, which also has Small Brown on 2026-11-02.' }]);
  });
  it('reads a header it does not know, finds the columns from the data, and says so', () => {
    const known = parseOutputCsv({ text: 'When,Kit,Made\n2026-11-23,S-BRN,3', variants: MATCHES });
    expect(known.rows).toEqual([{ workDate: '2026-11-23', variantId: 'v-S-BRN', qty: '3.000', scrapQty: '0.000' }]);
    expect(known.notes).toEqual([]);
    const result = parseOutputCsv({ text: 'Article,Amount,Stamp\nS-BRN,3,2026-11-23\nM-YLW,4.5,2026-11-24', variants: MATCHES });
    expect(result.rows).toEqual([
      { workDate: '2026-11-23', variantId: 'v-S-BRN', qty: '3.000', scrapQty: '0.000' },
      { workDate: '2026-11-24', variantId: 'v-M-YLW', qty: '4.500', scrapQty: '0.000' },
    ]);
    expect(result.notes).toEqual([{ code: 'header_guessed', line: 1, text: 'Line 1 was read as a header. The columns were found from the data: date in column 3, SKU or variant in column 1, qty in column 2.' }]);
    const plain = parseOutputCsv({ text: 'Stamp,Thing,Number\n2026-11-23,S-BRN,3', variants: MATCHES });
    expect(plain.rows).toHaveLength(1);
    expect(plain.notes[0]!.text.startsWith('Line 1 was read as a header.')).toBe(true);
  });
  it('a known header gives no note, and data in any order without a header is found too', () => {
    expect(parseOutputCsv({ text: 'date,sku,qty\n2026-11-23,S-BRN,3', variants: MATCHES }).notes).toEqual([]);
    const result = parseOutputCsv({ text: 'S-BRN,2026-11-23,3,1\nM-BRN,2026-11-24,4', variants: MATCHES });
    expect(result.rows).toEqual([
      { workDate: '2026-11-23', variantId: 'v-S-BRN', qty: '3.000', scrapQty: '1.000' },
      { workDate: '2026-11-24', variantId: 'v-M-BRN', qty: '4.000', scrapQty: '0.000' },
    ]);
    expect(result.notes).toEqual([]);
  });
  it('refuses a qty or scrap with more than 3 decimals instead of rounding', () => {
    const result = parseOutputCsv({ text: 'date,sku,qty,scrap\n2026-11-23,S-BRN,1.23456\n2026-11-23,M-BRN,2,0.0005\n2026-11-23,L-BRN,1.2300', variants: MATCHES });
    expect(result.rows).toEqual([{ workDate: '2026-11-23', variantId: 'v-L-BRN', qty: '1.230', scrapQty: '0.000' }]);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, 'Use up to 3 decimals.'],
      [3, 'Use up to 3 decimals for scrap.'],
    ]);
  });
  it('says when slash dates could mean two days, and reads them the way people pick', () => {
    const text = 'date,sku,qty\n02/11/2026,S-BRN,3\n03/11/2026,S-BRN,4';
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.dateOrder).toBe('month_first');
    expect(result.dateOrderNeeded).toBe(true);
    expect(result.rows.map((row) => row.workDate)).toEqual(['2026-02-11', '2026-03-11']);
    expect(result.notes).toEqual([{ code: 'dates_ambiguous', line: 2, text: 'Dates like 02/11/2026 can mean Feb 11, 2026 or Nov 2, 2026. They were read month first (Feb 11, 2026). Pick day first if that is wrong.' }]);
    const dayFirst = parseOutputCsv({ text, variants: MATCHES, dateOrder: 'day_first' });
    expect(dayFirst.rows.map((row) => row.workDate)).toEqual(['2026-11-02', '2026-11-03']);
    expect(dayFirst.notes).toEqual([]);
    expect(dayFirst.dateOrderNeeded).toBe(false);
  });
  it('one date that only works one way settles the whole file', () => {
    const dayFirst = parseOutputCsv({ text: 'date,sku,qty\n02/11/2026,S-BRN,3\n25/11/2026,S-BRN,4', variants: MATCHES });
    expect(dayFirst.dateOrder).toBe('day_first');
    expect(dayFirst.dateOrderNeeded).toBe(false);
    expect(dayFirst.rows.map((row) => row.workDate)).toEqual(['2026-11-02', '2026-11-25']);
    const monthFirst = parsePlanCsv({ text: 'date,sku,qty\n02/11/2026,S-BRN,3\n11/25/2026,S-BRN,4', variants: MATCHES });
    expect(monthFirst.dateOrder).toBe('month_first');
    expect(monthFirst.notes).toEqual([]);
    expect(monthFirst.rows.map((row) => row.buildDate)).toEqual(['2026-02-11', '2026-11-25']);
    const mixed = parseOutputCsv({ text: 'date,sku,qty\n25/11/2026,S-BRN,3\n11/25/2026,S-BRN,4', variants: MATCHES });
    expect(mixed.notes[0]!.code).toBe('dates_mixed');
    expect(mixed.unmatched.map((row) => row.line)).toEqual([2]);
  });
  it('the planning days settle slash dates in a paste', () => {
    const result = parsePlanPaste({ text: 'SKU\t1/12\t2/12\nS-BRN\t5\t6', variants: MATCHES, dates: WEEK });
    expect(result.dateOrder).toBe('day_first');
    expect(result.cells).toEqual([
      { variantId: 'v-S-BRN', date: '2026-12-01', qty: '5.000' },
      { variantId: 'v-S-BRN', date: '2026-12-02', qty: '6.000' },
    ]);
    expect(result.notes).toEqual([]);
  });
});

describe('parsePlanPaste', () => {
  it('reads a grid of variants by dates and adds up repeats', () => {
    const text = ['SKU\tMon Nov 30\t12/1\tDec 2\tDec 9', 'GLOVE-S-BRN\t100\t100\t\t5', 'GLOVE-S-YLW\t50\t0\tx', 'Small Brown\t20', 'GLOVE-XXL-RED\t10', '\t5'].join('\n');
    const result = parsePlanPaste({ text, variants: MATCHES, dates: WEEK });
    expect(result.cells).toEqual([
      { variantId: 'v-S-BRN', date: '2026-11-30', qty: '120.000' },
      { variantId: 'v-S-BRN', date: '2026-12-01', qty: '100.000' },
      { variantId: 'v-S-YLW', date: '2026-11-30', qty: '50.000' },
    ]);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([
      [1, 'Dec 9 is outside the days you are planning.'],
      [3, 'The qty x is not a number (Dec 2).'],
      [5, 'No variant has the SKU GLOVE-XXL-RED.'],
      [6, 'This row has no SKU or variant.'],
    ]);
    expect(result.merged).toEqual([{ line: 4, raw: 'Small Brown\t20', why: 'Added to line 2, which also has Small Brown on 2026-11-30.' }]);
  });
  it('lists every repeated variant and day it adds up, like the output import', () => {
    const result = parsePlanPaste({ text: 'SKU\tNov 30\nGLOVE-S-BRN\t100\nS-BRN\t50', variants: MATCHES, dates: WEEK });
    expect(result.cells).toEqual([{ variantId: 'v-S-BRN', date: '2026-11-30', qty: '150.000' }]);
    expect(result.merged).toEqual([{ line: 3, raw: 'S-BRN\t50', why: 'Added to line 2, which also has Small Brown on 2026-11-30.' }]);
    expect(result.unmatched).toEqual([]);
    const long = parsePlanPaste({ text: 'Nov 30,S-BRN,100\nNov 30,Small Brown,25\nDec 1,S-BRN,10', variants: MATCHES, dates: WEEK });
    expect(long.cells).toEqual([
      { variantId: 'v-S-BRN', date: '2026-11-30', qty: '125.000' },
      { variantId: 'v-S-BRN', date: '2026-12-01', qty: '10.000' },
    ]);
    expect(long.merged).toEqual([{ line: 2, raw: 'Nov 30,Small Brown,25', why: 'Added to line 1, which also has Small Brown on 2026-11-30.' }]);
    expect(parsePlanPaste({ text: 'Nov 30,S-BRN,100', variants: MATCHES, dates: WEEK }).merged).toEqual([]);
  });
  it('stays a grid when a header date is outside the planning days, and still reads the other columns', () => {
    const outside = parsePlanPaste({ text: 'SKU\tDec 5\nGLOVE-S-BRN\t100\nGLOVE-S-YLW\t50', variants: MATCHES, dates: ['2026-11-30'] });
    expect(outside.cells).toEqual([]);
    expect(outside.unmatched).toEqual([{ line: 1, raw: 'SKU\tDec 5', why: 'Dec 5 is outside the days you are planning.' }]);
    const mixed = parsePlanPaste({ text: 'SKU\tNov 30\tDec 5\tDec 1\nGLOVE-S-BRN\t100\t7\t80', variants: MATCHES, dates: WEEK });
    expect(mixed.cells).toEqual([
      { variantId: 'v-S-BRN', date: '2026-11-30', qty: '100.000' },
      { variantId: 'v-S-BRN', date: '2026-12-01', qty: '80.000' },
    ]);
    expect(mixed.unmatched).toEqual([{ line: 1, raw: 'SKU\tNov 30\tDec 5\tDec 1', why: 'Dec 5 is outside the days you are planning.' }]);
  });
  it('reads rows of date, variant and qty', () => {
    const result = parsePlanPaste({ text: 'Nov 30,S-BRN,100\n12/9/2026,S-BRN,5\nDec 1,S-BRN,0', variants: MATCHES, dates: WEEK });
    expect(result.cells).toEqual([{ variantId: 'v-S-BRN', date: '2026-11-30', qty: '100.000' }]);
    expect(result.unmatched).toEqual([{ line: 2, raw: '12/9/2026,S-BRN,5', why: '12/9/2026 is outside the days you are planning.' }]);
  });
});

describe('parsePlanCsv', () => {
  it('reads long rows with full dates', () => {
    const result = parsePlanCsv({ text: 'build date,sku,planned\n2026-12-01,GLOVE-L-BRN,100\n2026-12-01,GLOVE-L-BRN,20\n12/1,GLOVE-L-BRN,1', variants: MATCHES });
    expect(result.rows).toEqual([{ buildDate: '2026-12-01', variantId: 'v-L-BRN', qty: '120.000' }]);
    expect(result.unmatched[0]!.why).toBe('12/1 has no year. Use dates like 2026-11-30.');
  });
  it('reads a grid with full date headers', () => {
    const result = parsePlanCsv({ text: 'Variant,2026-12-01,2026-12-02\nL-YLW,10,20', variants: MATCHES });
    expect(result.rows).toEqual([
      { buildDate: '2026-12-01', variantId: 'v-L-YLW', qty: '10.000' },
      { buildDate: '2026-12-02', variantId: 'v-L-YLW', qty: '20.000' },
    ]);
  });
  it('lists a grid header it cannot read', () => {
    const result = parsePlanCsv({ text: 'Variant,2026-12-01,Later\nL-YLW,10,20', variants: MATCHES });
    expect(result.unmatched).toEqual([{ line: 1, raw: 'Variant,2026-12-01,Later', why: 'The date Later is not a date this can read.' }]);
  });
  it('says a grid date needs a year, and keeps reading the dated columns', () => {
    const result = parsePlanCsv({ text: 'Variant,Dec 1,2026-12-02\nL-YLW,10,20', variants: MATCHES });
    expect(result.rows).toEqual([{ buildDate: '2026-12-02', variantId: 'v-L-YLW', qty: '20.000' }]);
    expect(result.unmatched).toEqual([{ line: 1, raw: 'Variant,Dec 1,2026-12-02', why: 'Dec 1 has no year. Use dates like 2026-11-30.' }]);
  });
  it('lists repeated rows it adds up', () => {
    const result = parsePlanCsv({ text: 'build date,sku,planned\n2026-12-01,GLOVE-L-BRN,100\n2026-12-01,L-BRN,20', variants: MATCHES });
    expect(result.rows).toEqual([{ buildDate: '2026-12-01', variantId: 'v-L-BRN', qty: '120.000' }]);
    expect(result.merged).toEqual([{ line: 3, raw: '2026-12-01,L-BRN,20', why: 'Added to line 2, which also has Large Brown on 2026-12-01.' }]);
    const grid = parsePlanCsv({ text: 'Variant,2026-12-01\nL-YLW,10\nGLOVE-L-YLW,5', variants: MATCHES });
    expect(grid.rows).toEqual([{ buildDate: '2026-12-01', variantId: 'v-L-YLW', qty: '15.000' }]);
    expect(grid.merged).toEqual([{ line: 3, raw: 'GLOVE-L-YLW,5', why: 'Added to line 2, which also has Large Yellow on 2026-12-01.' }]);
  });
});

describe('semicolon files (Excel in many countries)', () => {
  it('reads an output CSV with semicolons and no header note', () => {
    const text = ['Date;SKU;Qty', '2026-11-23;GLOVE-S-BRN;10', '2026-11-23;GLOVE-S-YLW;"1.200,5"', '2026-11-24;GLOVE-M-BRN;12'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([
      { workDate: '2026-11-23', variantId: 'v-S-BRN', qty: '10.000', scrapQty: '0.000' },
      { workDate: '2026-11-24', variantId: 'v-M-BRN', qty: '12.000', scrapQty: '0.000' },
    ]);
    // A decimal comma is never read as a bigger number.
    expect(result.unmatched).toEqual([{ line: 3, raw: '2026-11-23;GLOVE-S-YLW;"1.200,5"', why: 'The qty 1.200,5 is not a number.' }]);
    expect(result.notes).toEqual([]);
  });
  it('reads a plan CSV with semicolons, with and without a header', () => {
    const rows = parsePlanCsv({ text: ['date;sku;qty', '2026-11-30;GLOVE-S-BRN;100', '2026-11-30;GLOVE-XL-YLW;50'].join('\n'), variants: MATCHES }).rows;
    expect(rows).toEqual([
      { buildDate: '2026-11-30', variantId: 'v-S-BRN', qty: '100.000' },
      { buildDate: '2026-11-30', variantId: 'v-XL-YLW', qty: '50.000' },
    ]);
    expect(parsePlanCsv({ text: '2026-11-30;GLOVE-S-BRN;100\n2026-12-01;GLOVE-S-BRN;80', variants: MATCHES }).rows).toHaveLength(2);
    expect(parsePlanPaste({ text: 'SKU;Nov 30;Dec 1\nGLOVE-S-BRN;100;80', variants: MATCHES, dates: WEEK }).cells).toEqual([
      { variantId: 'v-S-BRN', date: '2026-11-30', qty: '100.000' },
      { variantId: 'v-S-BRN', date: '2026-12-01', qty: '80.000' },
    ]);
  });
});

describe('qty limits (the database CHECK, below 100,000,000)', () => {
  it('refuses a qty or scrap of 100,000,000 or more', () => {
    expect(MAX_QTY_SCALED).toBe(BigInt('99999999999'));
    const text = ['date,sku,qty,scrap', '2026-11-23,GLOVE-S-BRN,5000000000,0', '2026-11-23,GLOVE-S-YLW,99999999.999,0', '2026-11-23,GLOVE-M-BRN,5,100000000', '2026-11-23,GLOVE-M-YLW,100000000,0'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([{ workDate: '2026-11-23', variantId: 'v-S-YLW', qty: '99999999.999', scrapQty: '0.000' }]);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, 'The qty is too large. Use up to 99,999,999.'],
      [4, 'The scrap is too large. Use up to 99,999,999.'],
      [5, 'The qty is too large. Use up to 99,999,999.'],
    ]);
    expect(parsePlanCsv({ text: '2026-11-30,GLOVE-S-BRN,100000000', variants: MATCHES }).unmatched[0]?.why).toBe('The qty is too large. Use up to 99,999,999.');
    expect(parsePlanCsv({ text: '2026-11-30,GLOVE-S-BRN,99999999', variants: MATCHES }).rows).toEqual([{ buildDate: '2026-11-30', variantId: 'v-S-BRN', qty: '99999999.000' }]);
    expect(parsePlanPaste({ text: 'SKU\tNov 30\nGLOVE-S-BRN\t100000000', variants: MATCHES, dates: WEEK }).unmatched[0]?.why).toBe('The qty is too large. Use up to 99,999,999 (Nov 30).');
  });
  it('refuses lines that add up to the limit or more', () => {
    const text = ['date,sku,qty', '2026-11-23,GLOVE-S-BRN,99999999', '2026-11-23,GLOVE-S-BRN,1', '2026-11-23,GLOVE-S-YLW,5'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([{ workDate: '2026-11-23', variantId: 'v-S-YLW', qty: '5.000', scrapQty: '0.000' }]);
    expect(result.merged).toEqual([]);
    expect(result.unmatched).toEqual([{ line: 3, raw: '2026-11-23,GLOVE-S-BRN,1', why: 'The qty for Small Brown on 2026-11-23 adds up to 100,000,000 or more. Use up to 99,999,999.' }]);
    const scrap = parseOutputCsv({ text: 'date,sku,qty,scrap\n2026-11-23,GLOVE-S-BRN,1,99999999\n2026-11-23,GLOVE-S-BRN,1,1', variants: MATCHES });
    expect(scrap.rows).toEqual([]);
    expect(scrap.unmatched[0]?.why).toBe('The scrap for Small Brown on 2026-11-23 adds up to 100,000,000 or more. Use up to 99,999,999.');
    const plan = parsePlanCsv({ text: '2026-11-30,GLOVE-S-BRN,99999999\n2026-11-30,GLOVE-S-BRN,1', variants: MATCHES });
    expect(plan.rows).toEqual([]);
    expect(plan.merged).toEqual([]);
    expect(plan.unmatched).toEqual([{ line: 2, raw: '2026-11-30,GLOVE-S-BRN,1', why: 'The qty for Small Brown on 2026-11-30 adds up to 100,000,000 or more. Use up to 99,999,999.' }]);
    const near = parsePlanCsv({ text: '2026-11-30,GLOVE-S-BRN,99999998.5\n2026-11-30,GLOVE-S-BRN,1.499', variants: MATCHES });
    expect(near.rows).toEqual([{ buildDate: '2026-11-30', variantId: 'v-S-BRN', qty: '99999999.999' }]);
  });
});
