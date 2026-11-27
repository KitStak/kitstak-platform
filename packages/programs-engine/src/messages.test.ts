import { describe, expect, it } from 'vitest';
import { VARIANTS } from './glove.fixture';
import { parseOutputCsv, parsePlanCsv, parsePlanPaste } from './import';
import { MAX_QTY_TEXT, MAX_RATE_TEXT, placeNote, valueMessage } from './messages';
import { BUILD_RATE_DECIMALS_MESSAGE, NEGATIVE_BUILD_RATE_MESSAGE, NEGATIVE_RATE_MESSAGE, RATE_DECIMALS_MESSAGE, RATE_TOO_LARGE_MESSAGE, buildRateProblem, rateTextMessage, readRateText } from './price';
import { decimalProblem, extraCellsMessage, inferAxes, qtyMessage } from './variants';

const MATCHES = VARIANTS.map((variant) => ({ id: variant.id, key: variant.key, name: variant.name, sku: variant.sku }));
const WEEK = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];
const DASHES = /—|–|--/;

describe('B.2.1 a row with more cells than the header is refused with a row error', () => {
  it('says which row, in the words of the ruling, in the variant paste and every import', () => {
    const sheet = 'Size,Color,Qty\nSmall,Brown,100\nSmall,Yellow,100\nMedium,Brown,100,9';
    const paste = inferAxes({ text: sheet });
    expect(paste.unmatched.map((row) => row.line)).toEqual([4]);
    expect(paste.unmatched[0]?.why.startsWith('Row 4 has more cells than the header.')).toBe(true);
    expect(paste.rows).toHaveLength(2);

    const csv = 'date,sku,qty\n2026-11-30,GLOVE-S-BRN,10\n2026-11-30,GLOVE-S-YLW,10\n2026-11-30,GLOVE-M-BRN,10,4';
    for (const result of [parseOutputCsv({ text: csv, variants: MATCHES }), parsePlanCsv({ text: csv, variants: MATCHES }), parsePlanPaste({ text: csv, variants: MATCHES, dates: WEEK })]) {
      expect(result.unmatched.map((row) => row.line)).toEqual([4]);
      expect(result.unmatched[0]?.why.startsWith('Row 4 has more cells than the header.')).toBe(true);
    }
    const grid = parsePlanCsv({ text: 'SKU,2026-11-30,2026-12-01\nGLOVE-S-BRN,1,2\nGLOVE-S-YLW,1,2\nGLOVE-M-BRN,1,2,3', variants: MATCHES });
    expect(grid.unmatched[0]?.why.startsWith('Row 4 has more cells than the header.')).toBe(true);
  });
  it('never drops a cell quietly: nothing in the row is read', () => {
    const result = parseOutputCsv({ text: 'date,sku,qty\n2026-11-02,GLOVE-S-BRN,1,200', variants: MATCHES });
    expect(result.rows).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });
  it('words the other row checks the same way', () => {
    expect(extraCellsMessage(['a', 'b', 'c', 'd'], { kind: 'most', cells: 3 }, '\t', 7)).toBe('Row 7 has more cells than most rows. It has 4 cells and most rows have 3. Take out the extra tab.');
    expect(extraCellsMessage(['a', 'b', 'c', 'd'], { kind: 'columns', names: ['date', 'SKU or variant', 'qty'] }, ';', 2)).toBe('Row 2 has more cells than the columns read. It has 4 cells and a row needs 3: date, SKU or variant, and qty. Take out the extra semicolon.');
    expect(extraCellsMessage(['a', 'b', 'c'], { kind: 'header', cells: 2 }, '\t')).toBe('This row has more cells than the header. It has 3 cells and the header has 2. Take out the extra tab.');
  });
});

describe('B.2.2 a column of numbers is the Qty column, never an attribute', () => {
  it('under a header with no Qty header', () => {
    const result = inferAxes({ text: 'Size,Color,Amount\nSmall,Brown,100\nSmall,Yellow,120\nMedium,Brown,90' });
    expect(result.mode).toBe('columns');
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size', 'Color']);
    expect(result.rows.map((row) => row.qty)).toEqual(['100', '120', '90']);
    expect(result.unmatched).toEqual([]);
  });
  it('with no header row', () => {
    const result = inferAxes({ text: 'Small,Brown,100\nSmall,Yellow,120' });
    expect(result.axes).toHaveLength(2);
    expect(result.rows.map((row) => row.qty)).toEqual(['100', '120']);
  });
  it('a number column that looks like prices is the Rate column when no Rate header exists', () => {
    const result = inferAxes({ text: 'Size,Qty,Each\nSmall,100,$1.95\nLarge,50,$2.20' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size']);
    expect(result.rows.map((row) => [row.qty, row.rate])).toEqual([
      ['100', '1.95'],
      ['50', '2.20'],
    ]);
  });
  it('when a Qty header exists, a second column of counts is left out with the reason, not made an attribute', () => {
    const result = inferAxes({ text: 'Size,Pack,Qty\nSmall,12,100\nLarge,24,50' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size']);
    expect(result.rows.map((row) => [row.attributes, row.qty, row.rate])).toEqual([
      [{ Size: 'Small' }, '100', null],
      [{ Size: 'Large' }, '50', null],
    ]);
    expect(result.unmatched.map((row) => [row.line, row.why])).toEqual([[1, 'The column Pack has only numbers and was left out. An attribute needs words, such as Small or Brown.']]);
  });
  it('a column with any word in it is still an attribute', () => {
    const result = inferAxes({ text: 'Size,Length,Qty\nSmall,10,100\nLarge,12 in,50' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size', 'Length']);
  });
});

describe('B.2.3 one message table for qty, scrap and rate problems', () => {
  it('builds the qty and scrap words', () => {
    expect(valueMessage('qty', 'not_a_number', 'Nov 30', '5.')).toBe('The qty 5. is not a number (Nov 30).');
    expect(valueMessage('qty', 'price', undefined, '$10')).toBe('The qty $10 looks like a price. Type only how many units.');
    expect(valueMessage('scrap', 'negative')).toBe('The scrap cannot be less than 0.');
    expect(valueMessage('qty', 'decimals')).toBe('Use up to 3 decimals.');
    expect(valueMessage('scrap', 'decimals')).toBe('Use up to 3 decimals for scrap.');
    expect(valueMessage('qty', 'too_large', 'Nov 30')).toBe(`The qty is too large (Nov 30). Use up to ${MAX_QTY_TEXT}.`);
    expect(valueMessage('qty', 'not_a_number')).toBe('The qty is not a number.');
  });
  it('builds the rate words, and the price module reads them from the table', () => {
    expect(valueMessage('rate', 'not_a_number', undefined, 'abc')).toBe('The rate abc is not a number.');
    expect(NEGATIVE_RATE_MESSAGE).toBe('A rate cannot be less than $0.');
    expect(RATE_DECIMALS_MESSAGE).toBe('Use up to 4 decimals for a rate.');
    expect(RATE_TOO_LARGE_MESSAGE).toBe(`The rate is too large. Use up to ${MAX_RATE_TEXT}.`);
    expect(NEGATIVE_BUILD_RATE_MESSAGE).toBe('A build rate cannot be less than $0.');
    expect(BUILD_RATE_DECIMALS_MESSAGE).toBe('Use up to 4 decimals for a build rate.');
    expect(buildRateProblem('abc')).toBe('The build rate abc is not a number.');
    expect(buildRateProblem('$1000000')).toBe(RATE_TOO_LARGE_MESSAGE);
    expect(rateTextMessage('below_zero', '-1', 'Nov 30')).toBe('A rate cannot be less than $0 (Nov 30).');
    expect(placeNote('  ')).toBe('');
  });
  it('the variant paste, the imports and the price card give the same words for the same cell', () => {
    // Qty: the paste and the output CSV.
    for (const cell of ['-5', '1.23456', '100000000', '$10', 'ten']) {
      const paste = inferAxes({ text: `Size,Qty\nSmall,${cell}\nLarge,5` }).unmatched.find((row) => row.line === 2)?.why;
      const csv = parseOutputCsv({ text: `date,sku,qty\n2026-11-02,GLOVE-S-BRN,${cell}`, variants: MATCHES }).unmatched[0]?.why;
      expect(paste).toBeDefined();
      expect(paste).toBe(csv);
    }
    // Rate: the paste, the price card reader and decimalProblem.
    for (const cell of ['-1', '1.23456', '1000000', 'abc', '0,500']) {
      const paste = inferAxes({ text: `Size,Qty,Rate\nSmall,1,${cell.includes(',') ? `"${cell}"` : cell}\nLarge,1,1.95` }).unmatched.find((row) => row.line === 2)?.why;
      const read = readRateText(cell);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(paste).toBe(rateTextMessage(read.problem, cell));
    }
    expect(decimalProblem('-1', 4, 'rate')).toBe(NEGATIVE_RATE_MESSAGE);
    expect(decimalProblem('1.23456', 4, 'rate')).toBe(RATE_DECIMALS_MESSAGE);
    expect(decimalProblem('1000000', 4, 'rate')).toBe(RATE_TOO_LARGE_MESSAGE);
    expect(decimalProblem('-1', 3, 'qty')).toBe(qtyMessage('negative', 'qty'));
  });
  it('uses plain words with no dashes', () => {
    const fields = ['qty', 'scrap', 'rate', 'build_rate'] as const;
    const problems = ['not_a_number', 'price', 'negative', 'decimals', 'too_large'] as const;
    for (const field of fields) for (const problem of problems) expect(DASHES.test(valueMessage(field, problem, 'Nov 30', 'x'))).toBe(false);
  });
});
