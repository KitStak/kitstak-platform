import { describe, expect, it } from 'vitest';
import { VARIANTS } from './glove.fixture';
import { MAX_QTY_SCALED, dateCellProblem, matchVariant, noVariantMessage, parseDateCell, parseOutputCsv, parsePlanCsv, parsePlanPaste } from './import';
import { inferAxes, qtyMessage } from './variants';

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
    expect(dateCellProblem('Smarch 3', WEEK)).toBe('Smarch 3 is not a real date. Use dates like 2026-11-30.');
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
      [2, 'soon is not a real date. Use dates like 2026-11-30.'],
      [3, 'This row has no date.'],
      [4, 'This row has no SKU or variant.'],
      [5, 'This row has no qty.'],
      [6, 'The qty ten is not a number.'],
      [7, 'The qty cannot be less than 0.'],
      [8, 'This row has 4 cells. A row needs 3: date, SKU or variant, and qty. Take out the extra comma, or put a cell that has a comma in quotes.'],
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
    expect(result.merged).toEqual([{ line: 4, raw: '2026-11-02,s-brn,5,2', why: 'Added to line 2, which also has Small Brown on Mon, Nov 2.' }]);
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
    const result = parseOutputCsv({ text: 'S-BRN,2026-11-23,3,1\nM-BRN,2026-11-24,4,0\nL-BRN,2026-11-24,5', variants: MATCHES });
    expect(result.rows).toEqual([
      { workDate: '2026-11-23', variantId: 'v-S-BRN', qty: '3.000', scrapQty: '1.000' },
      { workDate: '2026-11-24', variantId: 'v-M-BRN', qty: '4.000', scrapQty: '0.000' },
      { workDate: '2026-11-24', variantId: 'v-L-BRN', qty: '5.000', scrapQty: '0.000' },
    ]);
    expect(result.notes).toEqual([]);
    // A 4th cell on only half the rows is not a scrap column: that row is listed, not guessed.
    const half = parseOutputCsv({ text: 'S-BRN,2026-11-23,3,1\nM-BRN,2026-11-24,4', variants: MATCHES });
    expect(half.rows).toEqual([{ workDate: '2026-11-24', variantId: 'v-M-BRN', qty: '4.000', scrapQty: '0.000' }]);
    expect(half.unmatched.map((row) => row.line)).toEqual([1]);
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
    expect(result.merged).toEqual([{ line: 4, raw: 'Small Brown\t20', why: 'Added to line 2, which also has Small Brown on Mon, Nov 30.' }]);
  });
  it('lists every repeated variant and day it adds up, like the output import', () => {
    const result = parsePlanPaste({ text: 'SKU\tNov 30\nGLOVE-S-BRN\t100\nS-BRN\t50', variants: MATCHES, dates: WEEK });
    expect(result.cells).toEqual([{ variantId: 'v-S-BRN', date: '2026-11-30', qty: '150.000' }]);
    expect(result.merged).toEqual([{ line: 3, raw: 'S-BRN\t50', why: 'Added to line 2, which also has Small Brown on Mon, Nov 30.' }]);
    expect(result.unmatched).toEqual([]);
    const long = parsePlanPaste({ text: 'Nov 30,S-BRN,100\nNov 30,Small Brown,25\nDec 1,S-BRN,10', variants: MATCHES, dates: WEEK });
    expect(long.cells).toEqual([
      { variantId: 'v-S-BRN', date: '2026-11-30', qty: '125.000' },
      { variantId: 'v-S-BRN', date: '2026-12-01', qty: '10.000' },
    ]);
    expect(long.merged).toEqual([{ line: 2, raw: 'Nov 30,Small Brown,25', why: 'Added to line 1, which also has Small Brown on Mon, Nov 30.' }]);
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
    expect(result.unmatched).toEqual([
      { line: 2, raw: '12/9/2026,S-BRN,5', why: '12/9/2026 is outside the days you are planning.' },
      { line: 3, raw: 'Dec 1,S-BRN,0', why: 'The qty is 0, so this line plans nothing.' },
    ]);
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
    expect(result.unmatched).toEqual([{ line: 1, raw: 'Variant,2026-12-01,Later', why: 'Later is not a real date. Use dates like 2026-11-30.' }]);
  });
  it('says a grid date needs a year, and keeps reading the dated columns', () => {
    const result = parsePlanCsv({ text: 'Variant,Dec 1,2026-12-02\nL-YLW,10,20', variants: MATCHES });
    expect(result.rows).toEqual([{ buildDate: '2026-12-02', variantId: 'v-L-YLW', qty: '20.000' }]);
    expect(result.unmatched).toEqual([{ line: 1, raw: 'Variant,Dec 1,2026-12-02', why: 'Dec 1 has no year. Use dates like 2026-11-30.' }]);
  });
  it('lists repeated rows it adds up', () => {
    const result = parsePlanCsv({ text: 'build date,sku,planned\n2026-12-01,GLOVE-L-BRN,100\n2026-12-01,L-BRN,20', variants: MATCHES });
    expect(result.rows).toEqual([{ buildDate: '2026-12-01', variantId: 'v-L-BRN', qty: '120.000' }]);
    expect(result.merged).toEqual([{ line: 3, raw: '2026-12-01,L-BRN,20', why: 'Added to line 2, which also has Large Brown on Tue, Dec 1.' }]);
    const grid = parsePlanCsv({ text: 'Variant,2026-12-01\nL-YLW,10\nGLOVE-L-YLW,5', variants: MATCHES });
    expect(grid.rows).toEqual([{ buildDate: '2026-12-01', variantId: 'v-L-YLW', qty: '15.000' }]);
    expect(grid.merged).toEqual([{ line: 3, raw: 'GLOVE-L-YLW,5', why: 'Added to line 2, which also has Large Yellow on Tue, Dec 1.' }]);
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
    expect(parsePlanPaste({ text: 'SKU\tNov 30\nGLOVE-S-BRN\t100000000', variants: MATCHES, dates: WEEK }).unmatched[0]?.why).toBe('The qty is too large (Nov 30). Use up to 99,999,999.');
  });
  it('leaves out a day that adds up to the limit or more, and lists every line that fed it', () => {
    const text = ['date,sku,qty', '2026-11-23,GLOVE-S-BRN,99999999', '2026-11-23,GLOVE-S-BRN,1', '2026-11-23,GLOVE-S-YLW,5'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([{ workDate: '2026-11-23', variantId: 'v-S-YLW', qty: '5.000', scrapQty: '0.000' }]);
    expect(result.merged).toEqual([]);
    expect(result.unmatched).toEqual([
      { line: 2, raw: '2026-11-23,GLOVE-S-BRN,99999999', why: 'Left out: Small Brown on Mon, Nov 23 adds up to 100,000,000 or more with line 3. Use up to 99,999,999 for one day.' },
      { line: 3, raw: '2026-11-23,GLOVE-S-BRN,1', why: 'Left out: Small Brown on Mon, Nov 23 adds up to 100,000,000 or more with line 2. Use up to 99,999,999 for one day.' },
    ]);
    const scrap = parseOutputCsv({ text: 'date,sku,qty,scrap\n2026-11-23,GLOVE-S-BRN,1,99999999\n2026-11-23,GLOVE-S-BRN,1,1', variants: MATCHES });
    expect(scrap.rows).toEqual([]);
    expect(scrap.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, 'Left out: the scrap for Small Brown on Mon, Nov 23 adds up to 100,000,000 or more with line 3. Use up to 99,999,999 for one day.'],
      [3, 'Left out: the scrap for Small Brown on Mon, Nov 23 adds up to 100,000,000 or more with line 2. Use up to 99,999,999 for one day.'],
    ]);
    const plan = parsePlanCsv({ text: '2026-11-30,GLOVE-S-BRN,99999999\n2026-11-30,GLOVE-S-BRN,1', variants: MATCHES });
    expect(plan.rows).toEqual([]);
    expect(plan.merged).toEqual([]);
    expect(plan.unmatched.map((row) => row.line)).toEqual([1, 2]);
    const near = parsePlanCsv({ text: '2026-11-30,GLOVE-S-BRN,99999998.5\n2026-11-30,GLOVE-S-BRN,1.499', variants: MATCHES });
    expect(near.rows).toEqual([{ buildDate: '2026-11-30', variantId: 'v-S-BRN', qty: '99999999.999' }]);
  });
  it('the critic repro: the first line, the line that goes over and every later line are all listed', () => {
    const text = ['date,sku,qty', '2026-11-02,GLOVE-S-BRN,60000000', '2026-11-02,GLOVE-S-BRN,50000000', '2026-11-02,GLOVE-S-BRN,5', '2026-11-02,GLOVE-S-YLW,7'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([{ workDate: '2026-11-02', variantId: 'v-S-YLW', qty: '7.000', scrapQty: '0.000' }]);
    expect(result.merged).toEqual([]);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, 'Left out: Small Brown on Mon, Nov 2 adds up to 100,000,000 or more with lines 3 and 4. Use up to 99,999,999 for one day.'],
      [3, 'Left out: Small Brown on Mon, Nov 2 adds up to 100,000,000 or more with lines 2 and 4. Use up to 99,999,999 for one day.'],
      [4, 'Left out: Small Brown on Mon, Nov 2 adds up to 100,000,000 or more with lines 2 and 3. Use up to 99,999,999 for one day.'],
    ]);
    // The plan parsers do the same, in a grid too (each cell names its date).
    const plan = parsePlanCsv({ text: text.replace('date,sku,qty\n', ''), variants: MATCHES });
    expect(plan.unmatched.map((row) => row.line)).toEqual([1, 2, 3]);
    expect(plan.rows).toEqual([{ buildDate: '2026-11-02', variantId: 'v-S-YLW', qty: '7.000' }]);
    const grid = parsePlanPaste({ text: 'SKU\tNov 30\tDec 1\nGLOVE-S-BRN\t60000000\t4\nGLOVE-S-BRN\t50000000\t6', variants: MATCHES, dates: WEEK });
    expect(grid.cells).toEqual([{ variantId: 'v-S-BRN', date: '2026-12-01', qty: '10.000' }]);
    expect(grid.merged).toEqual([{ line: 3, raw: 'GLOVE-S-BRN\t50000000\t6', why: 'Added to line 2, which also has Small Brown on Tue, Dec 1.' }]);
    expect(grid.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, 'Left out: Small Brown on Mon, Nov 30 adds up to 100,000,000 or more with line 3. Use up to 99,999,999 for one day.'],
      [3, 'Left out: Small Brown on Mon, Nov 30 adds up to 100,000,000 or more with line 2. Use up to 99,999,999 for one day.'],
    ]);
  });
  it('names up to 5 other lines, then how many more', () => {
    const lines = Array.from({ length: 9 }, () => '2026-11-02,GLOVE-S-BRN,20000000');
    const result = parseOutputCsv({ text: ['date,sku,qty', ...lines].join('\n'), variants: MATCHES });
    expect(result.unmatched).toHaveLength(9);
    expect(result.unmatched[0]?.why).toBe('Left out: Small Brown on Mon, Nov 2 adds up to 100,000,000 or more with lines 3, 4, 5, 6, 7 and 3 more. Use up to 99,999,999 for one day.');
  });
});

describe('every line ends up in exactly one place', () => {
  // Long files: each data line is one cell, so it must be in exactly one of a row (as the first
  // line of its variant and day), merged or unmatched. Nothing is dropped without a word.
  const variantsByKey = new Map(MATCHES.map((variant) => [variant.id, variant]));
  function placed(text: string, kind: 'output' | 'plan'): Map<number, number> {
    const seen = new Map<number, number>();
    const add = (line: number): void => void seen.set(line, (seen.get(line) ?? 0) + 1);
    const body = text.split('\n');
    const result = kind === 'output' ? parseOutputCsv({ text, variants: MATCHES }) : parsePlanCsv({ text, variants: MATCHES });
    const rows = 'rows' in result ? (result.rows as readonly { variantId: string; workDate?: string; buildDate?: string }[]) : [];
    for (const row of rows) {
      const date = row.workDate ?? row.buildDate;
      const sku = variantsByKey.get(row.variantId)?.sku;
      // The first line in the file for that variant and day.
      const index = body.findIndex((raw, at) => at > 0 && raw.startsWith(`${date},${sku},`) && !result.unmatched.some((entry) => entry.line === at + 1) && !result.merged.some((entry) => entry.line === at + 1));
      add(index + 1);
    }
    for (const entry of result.merged) add(entry.line);
    for (const entry of result.unmatched) add(entry.line);
    return seen;
  }
  it('holds for random files with repeats, bad cells and days over the limit', () => {
    let state = 99;
    const random = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const skus = ['GLOVE-S-BRN', 'GLOVE-S-YLW', 'GLOVE-M-BRN', 'GLOVE-XXL-RED'];
    const qtys = ['5', '10', '0', '60000000', '50000000', '$10', 'ten', '2.5', ''];
    for (let run = 0; run < 300; run += 1) {
      for (const kind of ['output', 'plan'] as const) {
        const count = 1 + Math.floor(random() * 12);
        const lines = Array.from({ length: count }, () => `2026-11-0${1 + Math.floor(random() * 3)},${skus[Math.floor(random() * skus.length)]},${qtys[Math.floor(random() * qtys.length)]}`);
        const text = ['date,sku,qty', ...lines].join('\n');
        const seen = placed(text, kind);
        for (let line = 2; line <= count + 1; line += 1) expect(seen.get(line), `${kind} line ${line} of\n${text}`).toBe(1);
        expect([...seen.keys()].every((line) => line >= 2 && line <= count + 1)).toBe(true);
      }
    }
  });
});

describe('a qty with a dollar sign', () => {
  it('is refused, because it is almost always a price column read as the qty', () => {
    const result = parseOutputCsv({ text: 'date,sku,qty\n2026-11-02,GLOVE-S-BRN,$10', variants: MATCHES });
    expect(result.rows).toEqual([]);
    expect(result.unmatched).toEqual([{ line: 2, raw: '2026-11-02,GLOVE-S-BRN,$10', why: 'The qty $10 looks like a price. Type only how many units.' }]);
    const scrap = parseOutputCsv({ text: 'date,sku,qty,scrap\n2026-11-02,GLOVE-S-BRN,10,$2', variants: MATCHES });
    expect(scrap.unmatched[0]?.why).toBe('The scrap $2 looks like a price. Type only how many units.');
    expect(parsePlanCsv({ text: '2026-11-30,GLOVE-S-BRN,$1.95', variants: MATCHES }).unmatched[0]?.why).toBe('The qty $1.95 looks like a price. Type only how many units.');
    expect(parsePlanPaste({ text: 'SKU\tNov 30\nGLOVE-S-BRN\t$5', variants: MATCHES, dates: WEEK }).unmatched[0]?.why).toBe('The qty $5 looks like a price (Nov 30). Type only how many units.');
    // A dollar sign on something that is not a number at all is still not a number.
    expect(parseOutputCsv({ text: 'date,sku,qty\n2026-11-02,GLOVE-S-BRN,$ten', variants: MATCHES }).unmatched[0]?.why).toBe('The qty $ten is not a number.');
    // A plain number with a thousands comma still reads.
    expect(parseOutputCsv({ text: 'date,sku,qty\n2026-11-02,GLOVE-S-BRN,"1,200"', variants: MATCHES }).rows[0]?.qty).toBe('1200.000');
  });
});

describe('grid messages name the day in place', () => {
  const grid = (cell: string): string | undefined => parsePlanPaste({ text: `SKU\tNov 30\nGLOVE-S-BRN\t${cell}`, variants: MATCHES, dates: WEEK }).unmatched[0]?.why;
  it('builds each message from its parts, so the cell text never breaks the sentence', () => {
    expect(grid('5.')).toBe('The qty 5. is not a number (Nov 30).');
    expect(grid('abc. def')).toBe('The qty abc. def is not a number (Nov 30).');
    expect(grid('1.23456')).toBe('Use up to 3 decimals (Nov 30).');
    expect(grid('-4')).toBe('The qty cannot be less than 0 (Nov 30).');
    expect(grid('$5. ok')).toBe('The qty $5. ok is not a number (Nov 30).');
    expect(grid('100000000')).toBe('The qty is too large (Nov 30). Use up to 99,999,999.');
  });
});

describe('a leading zero thousands group is never a number', () => {
  it('refuses 0,500 and 00,123 as a qty or scrap instead of reading them 1,000 times too large', () => {
    for (const cell of ['0,500', '00,123', '0,5']) {
      const output = parseOutputCsv({ text: `date,sku,qty\n2026-11-02,GLOVE-S-BRN,"${cell}"`, variants: MATCHES });
      expect(output.rows).toEqual([]);
      expect(output.unmatched[0]?.why).toBe(`The qty ${cell} is not a number.`);
      const scrap = parseOutputCsv({ text: `date,sku,qty,scrap\n2026-11-02,GLOVE-S-BRN,10,"${cell}"`, variants: MATCHES });
      expect(scrap.rows).toEqual([]);
      expect(scrap.unmatched[0]?.why).toBe(`The scrap ${cell} is not a number.`);
      expect(parsePlanCsv({ text: `2026-11-30,GLOVE-S-BRN,"${cell}"`, variants: MATCHES }).rows).toEqual([]);
      expect(parsePlanPaste({ text: `SKU\tNov 30\nGLOVE-S-BRN\t${cell}`, variants: MATCHES, dates: WEEK }).unmatched[0]?.why).toBe(`The qty ${cell} is not a number (Nov 30).`);
    }
    // A plain leading zero with no comma is still a number.
    expect(parseOutputCsv({ text: 'date,sku,qty\n2026-11-02,GLOVE-S-BRN,0500', variants: MATCHES }).rows[0]?.qty).toBe('500.000');
  });
});

describe('a row with more cells than the sheet has columns is never read in part', () => {
  const SPLIT = 'This row has 4 cells. The header has 3. Put "1,200" in quotes, or type it as 1200.';
  const LIKE = 'This row has 4 cells. The header has 3. Put a number like 1,200 in quotes, or type it as 1200.';
  it('an output CSV with an unquoted 1,200 or 0,500 lists the row, with the header', () => {
    const text = ['date,sku,qty', '2026-11-02,GLOVE-S-BRN,1,200', '2026-11-02,GLOVE-S-YLW,0,500', '2026-11-02,GLOVE-M-BRN,"1,200"'].join('\n');
    const result = parseOutputCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([{ workDate: '2026-11-02', variantId: 'v-M-BRN', qty: '1200.000', scrapQty: '0.000' }]);
    expect(result.unmatched).toEqual([
      { line: 2, raw: '2026-11-02,GLOVE-S-BRN,1,200', why: SPLIT },
      { line: 3, raw: '2026-11-02,GLOVE-S-YLW,0,500', why: LIKE },
    ]);
  });
  it('a plan CSV with an unquoted 1,200 or 0,500 lists the row, with the header', () => {
    const text = ['date,sku,qty', '2026-11-30,GLOVE-S-BRN,1,200', '2026-11-30,GLOVE-S-YLW,0,500', '2026-11-30,GLOVE-M-BRN,1200'].join('\n');
    const result = parsePlanCsv({ text, variants: MATCHES });
    expect(result.rows).toEqual([{ buildDate: '2026-11-30', variantId: 'v-M-BRN', qty: '1200.000' }]);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, SPLIT],
      [3, LIKE],
    ]);
  });
  it('without a header the row is held to the columns read', () => {
    const output = parseOutputCsv({ text: ['2026-11-02,GLOVE-S-BRN,10', '2026-11-02,GLOVE-S-YLW,1,200', '2026-11-02,GLOVE-M-BRN,7', '2026-11-02,GLOVE-M-YLW,0,500'].join('\n'), variants: MATCHES });
    expect(output.rows.map((row) => [row.variantId, row.qty, row.scrapQty])).toEqual([
      ['v-S-BRN', '10.000', '0.000'],
      ['v-M-BRN', '7.000', '0.000'],
    ]);
    expect(output.unmatched.map((row) => [row.line, row.why])).toEqual([
      [2, 'This row has 4 cells. A row needs 3: date, SKU or variant, and qty. Put "1,200" in quotes, or type it as 1200.'],
      [4, 'This row has 4 cells. A row needs 3: date, SKU or variant, and qty. Put a number like 1,200 in quotes, or type it as 1200.'],
    ]);
    const plan = parsePlanCsv({ text: ['2026-11-30,GLOVE-S-BRN,10', '2026-11-30,GLOVE-S-YLW,1,200'].join('\n'), variants: MATCHES });
    expect(plan.rows).toEqual([{ buildDate: '2026-11-30', variantId: 'v-S-BRN', qty: '10.000' }]);
    expect(plan.unmatched[0]?.why).toBe('This row has 4 cells. A row needs 3: date, SKU or variant, and qty. Put "1,200" in quotes, or type it as 1200.');
  });
  it('a scrap column every row fills is still read', () => {
    const result = parseOutputCsv({ text: ['2026-11-02,GLOVE-S-BRN,10,1', '2026-11-02,GLOVE-S-YLW,7,0'].join('\n'), variants: MATCHES });
    expect(result.rows.map((row) => [row.qty, row.scrapQty])).toEqual([
      ['10.000', '1.000'],
      ['7.000', '0.000'],
    ]);
    expect(result.unmatched).toEqual([]);
  });
  it('a grid row with more cells than its header of dates is listed, not read under the wrong days', () => {
    const result = parsePlanCsv({ text: ['SKU,2026-11-30,2026-12-01', 'GLOVE-S-BRN,1,200,50', 'GLOVE-S-YLW,10,20'].join('\n'), variants: MATCHES });
    expect(result.rows).toEqual([
      { buildDate: '2026-11-30', variantId: 'v-S-YLW', qty: '10.000' },
      { buildDate: '2026-12-01', variantId: 'v-S-YLW', qty: '20.000' },
    ]);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([[2, 'This row has 4 cells. The header has 3. Put "1,200" in quotes, or type it as 1200.']]);
  });
  it('a tab or semicolon sheet names the extra delimiter', () => {
    const tabs = parsePlanPaste({ text: ['date\tsku\tqty', '2026-11-30\tGLOVE-S-BRN\t10\t5'].join('\n'), variants: MATCHES, dates: WEEK });
    expect(tabs.unmatched[0]?.why).toBe('This row has 4 cells. The header has 3. Take out the extra tab.');
    const semis = parseOutputCsv({ text: ['date;sku;qty', '2026-11-30;GLOVE-S-BRN;10;5'].join('\n'), variants: MATCHES });
    expect(semis.unmatched[0]?.why).toBe('This row has 4 cells. The header has 3. Take out the extra semicolon.');
  });
  it('blank cells past the header are fine', () => {
    const result = parseOutputCsv({ text: ['date,sku,qty', '2026-11-02,GLOVE-S-BRN,10,,'].join('\n'), variants: MATCHES });
    expect(result.rows).toHaveLength(1);
    expect(result.unmatched).toEqual([]);
  });
});

describe('qty words match the variant paste', () => {
  it('uses the same message for the same problem in imports and in inferAxes', () => {
    const csv = parseOutputCsv({ text: 'date,sku,qty\n2026-11-02,GLOVE-S-BRN,-4\n2026-11-02,GLOVE-S-YLW,1.23456\n2026-11-02,GLOVE-M-BRN,100000000\n2026-11-02,GLOVE-M-YLW,$10', variants: MATCHES });
    const paste = inferAxes({ text: 'Size,Color,Qty\nSmall,Brown,-4\nSmall,Yellow,1.23456\nMedium,Brown,100000000\nMedium,Yellow,$10' });
    const expected = ['The qty cannot be less than 0.', 'Use up to 3 decimals.', 'The qty is too large. Use up to 99,999,999.', 'The qty $10 looks like a price. Type only how many units.'];
    expect(csv.unmatched.map((row) => row.why)).toEqual(expected);
    expect(paste.unmatched.map((row) => row.why)).toEqual(expected);
    expect(expected).toEqual([qtyMessage('negative', 'qty'), qtyMessage('decimals', 'qty'), qtyMessage('too_large', 'qty'), qtyMessage('price', 'qty', undefined, '$10')]);
  });
  it('says a date that is not real in plain words', () => {
    expect(dateCellProblem('2026-02-30')).toBe('2026-02-30 is not a real date. Use dates like 2026-11-30.');
  });
});
