import { describe, expect, it } from 'vitest';
import { AXES } from './glove.fixture';
import {
  MAX_QTY_WHOLE_DIGITS,
  MAX_RATE_WHOLE_DIGITS,
  MAX_VARIANTS,
  MAX_VARIANT_KEY_LENGTH,
  MAX_VARIANT_NAME_LENGTH,
  QTY_TOO_LARGE,
  RATE_TOO_LARGE,
  SCRAP_TOO_LARGE,
  VALUE_CODE_RULE,
  VARIANT_KEY_RULE,
  applyPattern,
  axisNameProblem,
  decimalProblem,
  isSkuHeader,
  cartesian,
  combinationCount,
  conflictMessage,
  defaultPatterns,
  findConflicts,
  generateVariants,
  inferAxes,
  labelForCode,
  looksLikeNumber,
  patternProblem,
  plainNumber,
  splitCells,
  suggestCode,
  toCodeText,
  unknownPatternTokens,
  variantLimitMessage,
  type AttributeAxis,
} from './variants';

describe('generateVariants', () => {
  it('E27 Size x Color for GLOVE', () => {
    const variants = generateVariants({ axes: AXES, namePattern: '{Size} {Color}', keyPattern: '{Size.code}-{Color.code}', skuPattern: '{program}-{Size.code}-{Color.code}', programKey: 'GLOVE' });
    expect(variants).toHaveLength(8);
    expect(variants[0]).toMatchObject({ name: 'Small Brown', key: 'S-BRN', sku: 'GLOVE-S-BRN', attributes: { size: 'size-s', color: 'color-brn' } });
    expect(variants[7]).toMatchObject({ name: 'XL Yellow', key: 'XL-YLW', sku: 'GLOVE-XL-YLW' });
    expect(variants[1]!.name).toBe('Small Yellow');
    expect(new Set(variants.map((variant) => variant.comboKey)).size).toBe(8);
  });
  it('cleans keys and SKUs and falls back when a pattern makes nothing', () => {
    const variants = generateVariants({ axes: AXES, namePattern: '  ', keyPattern: '{size.CODE} / {color}', skuPattern: '', programKey: 'GLOVE' });
    expect(variants[0]).toMatchObject({ name: 'Small Brown', key: 'S-BROWN', sku: null });
  });
  it('builds default patterns from the real axis names', () => {
    expect(defaultPatterns(AXES)).toEqual({ namePattern: '{Size} {Color}', keyPattern: '{Size.code}-{Color.code}', skuPattern: '{program}-{Size.code}-{Color.code}' });
    const flavor: AttributeAxis[] = [
      { id: 'flavor', name: 'Flavor', values: [{ id: 'f-bbq', label: 'Barbecue', code: 'BBQ' }, { id: 'f-sea', label: 'Sea salt', code: 'SEA' }, { id: 'f-chs', label: 'Cheddar', code: 'CHS' }] },
      { id: 'pack', name: 'Pack size', values: [{ id: 'p-6', label: '6 pack', code: '6' }, { id: 'p-12', label: '12 pack', code: '12' }] },
      { id: 'none', name: 'Unused', values: [] },
    ];
    const patterns = defaultPatterns(flavor);
    expect(patterns).toEqual({ namePattern: '{Flavor} {Pack size}', keyPattern: '{Flavor.code}-{Pack size.code}', skuPattern: '{program}-{Flavor.code}-{Pack size.code}' });
    const variants = generateVariants({ axes: flavor, ...patterns, programKey: 'SNACK' });
    expect(variants).toHaveLength(6);
    expect(variants[0]).toMatchObject({ name: 'Barbecue 6 pack', key: 'BBQ-6', sku: 'SNACK-BBQ-6' });
    expect(variants[5]).toMatchObject({ name: 'Cheddar 12 pack', key: 'CHS-12', sku: 'SNACK-CHS-12' });
    expect(new Set(variants.map((variant) => variant.key)).size).toBe(6);
    expect(new Set(variants.map((variant) => variant.sku)).size).toBe(6);
    expect(new Set(variants.map((variant) => variant.name)).size).toBe(6);
    expect(findConflicts(variants, [])).toEqual([]);
    expect(defaultPatterns([])).toEqual({ namePattern: '', keyPattern: '', skuPattern: '{program}' });
  });
  it('an empty name or key pattern uses the defaults for the real axes', () => {
    const flavor: AttributeAxis[] = [{ id: 'flavor', name: 'Flavor', values: [{ id: 'f-bbq', label: 'Barbecue', code: 'BBQ' }, { id: 'f-sea', label: 'Sea salt', code: 'SEA' }] }];
    const variants = generateVariants({ axes: flavor, namePattern: '', keyPattern: ' ', skuPattern: null, programKey: 'SNACK' });
    expect(variants.map((variant) => [variant.name, variant.key, variant.sku])).toEqual([
      ['Barbecue', 'BBQ', null],
      ['Sea salt', 'SEA', null],
    ]);
  });
  it('refuses key and SKU patterns that name an attribute the matrix does not have', () => {
    const flavor: AttributeAxis[] = [{ id: 'flavor', name: 'Flavor', values: [{ id: 'f-bbq', label: 'Barbecue', code: 'BBQ' }, { id: 'f-sea', label: 'Sea salt', code: 'SEA' }] }];
    const run = (keyPattern: string, skuPattern: string | null) => () => generateVariants({ axes: flavor, namePattern: '{Flavor}', keyPattern, skuPattern, programKey: 'SNACK' });
    expect(run('{Size.code}-{Color.code}', null)).toThrow(new RangeError('The pattern uses {Size.code}, but no attribute is called Size.'));
    expect(run('{Flavor.code}', '{program}-{Size}')).toThrow(new RangeError('The pattern uses {Size}, but no attribute is called Size.'));
    expect(run('{flavor.CODE}', '{PROGRAM}-{Flavor.code}')).not.toThrow();
    expect(patternProblem('{Size} {Color}', flavor)).toBe('The pattern uses {Size}, but no attribute is called Size.');
    expect(patternProblem('{Flavor} {program}', flavor)).toBeNull();
    const names = generateVariants({ axes: flavor, namePattern: '{Flavor} {Szie}', keyPattern: '{Flavor.code}', skuPattern: null, programKey: 'SNACK' });
    expect(names[0]!.name).toBe('Barbecue {Szie}');
  });
  it('blocks more than 200 combinations', () => {
    const big: AttributeAxis[] = [
      { id: 'a', name: 'A', values: Array.from({ length: 15 }, (_, i) => ({ id: `a${i}`, label: `A${i}`, code: `A${i}` })) },
      { id: 'b', name: 'B', values: Array.from({ length: 14 }, (_, i) => ({ id: `b${i}`, label: `B${i}`, code: `B${i}` })) },
    ];
    expect(combinationCount(big)).toBe(210);
    expect(() => generateVariants({ axes: big, namePattern: '{A}', keyPattern: '{A.code}', skuPattern: null, programKey: 'X' })).toThrow(variantLimitMessage(210));
    expect(variantLimitMessage(210)).toBe(`That makes 210 variants. The limit is ${MAX_VARIANTS}.`);
  });
  it('cartesian keeps value order with the first axis outer and skips empty axes', () => {
    const combos = cartesian([...AXES, { id: 'empty', name: 'Empty', values: [] }]);
    expect(combos.map((combo) => combo.key).slice(0, 3)).toEqual(['S-BRN', 'S-YLW', 'M-BRN']);
    expect(cartesian([])).toEqual([]);
  });
});

describe('attribute names', () => {
  const size = (id: string, name: string): AttributeAxis => ({ id, name, values: [{ id: `${id}-s`, label: 'Small', code: 'S' }] });
  it('refuses two attributes whose names differ only by case', () => {
    const axes = [size('a', 'Size'), size('b', 'size')];
    expect(axisNameProblem(axes)).toBe('Two attributes are called Size. Give each a different name.');
    expect(() => generateVariants({ axes, namePattern: '', keyPattern: '', skuPattern: null, programKey: 'GLOVE' })).toThrow(new RangeError('Two attributes are called Size. Give each a different name.'));
    expect(axisNameProblem([size('a', ' Size '), size('b', 'SIZE')])).toBe('Two attributes are called Size. Give each a different name.');
  });
  it('defaultPatterns uses a repeated name once', () => {
    expect(defaultPatterns([size('a', 'Size'), size('b', 'size')])).toEqual({ namePattern: '{Size}', keyPattern: '{Size.code}', skuPattern: '{program}-{Size.code}' });
  });
  it('needs a name on every attribute with values, without braces or the word program', () => {
    expect(axisNameProblem([size('a', '  ')])).toBe('Give every attribute a name.');
    expect(axisNameProblem([{ id: 'x', name: '', values: [] }, size('a', 'Size')])).toBeNull();
    expect(axisNameProblem([size('a', '{Size}')])).toBe('The attribute name {Size} cannot use { or }.');
    expect(axisNameProblem([size('a', 'Program')])).toBe('An attribute cannot be called program. That word is kept for the program key.');
    expect(axisNameProblem(AXES)).toBeNull();
  });
});

describe('patterns', () => {
  it('fills tokens without regard to case and keeps unknown tokens', () => {
    expect(applyPattern('{program}-{SIZE.code} {Color} {Fit}', AXES, { size: 'size-xl', color: 'color-ylw' }, { program: 'GLOVE' })).toBe('GLOVE-XL Yellow {Fit}');
    expect(applyPattern('{Size}', AXES, {})).toBe('');
    expect(applyPattern('{program}', AXES, {})).toBe('');
    expect(unknownPatternTokens('{Size} {Fit} {program} {Color.code}', AXES)).toEqual(['{Fit}']);
  });
  it('toCodeText keeps only A to Z, digits and single dashes', () => {
    expect(toCodeText(' x-large  / navy blue ')).toBe('X-LARGE-NAVY-BLUE');
    expect(toCodeText('--a__b--')).toBe('AB');
  });
});

describe('findConflicts', () => {
  const generated = generateVariants({ axes: AXES, namePattern: '{Size} {Color}', keyPattern: '{Size.code}-{Color.code}', skuPattern: '{program}-{Size.code}-{Color.code}', programKey: 'GLOVE' });
  it('finds clashes with existing variants', () => {
    const conflicts = findConflicts(generated, [
      { key: 's-brn', name: 'Old small', sku: null, attributes: { size: 'size-s', color: 'color-brn' } },
      { key: 'OTHER', name: 'medium yellow', sku: 'GLOVE-L-BRN', attributes: {} },
    ]);
    expect(conflicts).toEqual([
      { comboKey: generated[0]!.comboKey, field: 'combo', with: 'Old small' },
      { comboKey: generated[0]!.comboKey, field: 'key', with: 'Old small' },
      { comboKey: generated[3]!.comboKey, field: 'name', with: 'medium yellow' },
      { comboKey: generated[4]!.comboKey, field: 'sku', with: 'medium yellow' },
    ]);
  });
  it('finds clashes among the new variants', () => {
    const twins = [generated[0]!, { ...generated[1]!, key: 'S-BRN' }];
    expect(findConflicts(twins, [])).toEqual([{ comboKey: generated[1]!.comboKey, field: 'key', with: 'Small Brown' }]);
  });
  it('says each clash', () => {
    expect(conflictMessage({ field: 'combo', with: 'Small Brown' })).toBe('Small Brown already has these values.');
    expect(conflictMessage({ field: 'key', with: 'Small Brown' })).toBe('Small Brown already uses this key.');
    expect(conflictMessage({ field: 'name', with: 'Small Brown' })).toBe('Small Brown already uses this name.');
    expect(conflictMessage({ field: 'sku', with: 'Small Brown' })).toBe('Small Brown already uses this SKU.');
    expect(conflictMessage({ field: 'key_length', with: 'Small Brown', length: 20 })).toBe('This key has 20 characters. The limit is 16. Use shorter codes or a shorter key pattern.');
    expect(conflictMessage({ field: 'name_length', with: 'Small Brown', length: 101 })).toBe('This name has 101 characters. The limit is 80.');
  });
  it('flags keys over 16 and names over 80 characters, the database rules, before save', () => {
    const axis = (id: string, name: string, code: string, label: string): AttributeAxis => ({ id, name, values: [{ id: `${id}-1`, label, code }] });
    const long = generateVariants({
      axes: [axis('a', 'Size', 'ABCDEF', 'Small'), axis('b', 'Color', 'GHIJKL', 'Brown'), axis('c', 'Grip', 'MNOPQR', 'Soft')],
      namePattern: '',
      keyPattern: '',
      skuPattern: null,
      programKey: 'GLOVE',
    });
    expect(long[0]!.key).toBe('ABCDEF-GHIJKL-MNOPQR');
    expect(VARIANT_KEY_RULE.test(long[0]!.key)).toBe(false);
    expect(findConflicts(long, [])).toEqual([{ comboKey: long[0]!.comboKey, field: 'key_length', with: long[0]!.name, length: 20 }]);
    expect(conflictMessage(findConflicts(long, [])[0]!)).toBe('This key has 20 characters. The limit is 16. Use shorter codes or a shorter key pattern.');

    const fifty = 'x'.repeat(50);
    const wordy = generateVariants({
      axes: [axis('a', 'Size', 'S', `Small ${fifty}`.slice(0, 50)), axis('b', 'Color', 'B', `Brown ${fifty}`.slice(0, 50))],
      namePattern: '{Size} {Color}',
      keyPattern: '{Size.code}-{Color.code}',
      skuPattern: null,
      programKey: 'GLOVE',
    });
    expect(wordy[0]!.name).toHaveLength(101);
    const nameProblem = findConflicts(wordy, []);
    expect(nameProblem).toEqual([{ comboKey: wordy[0]!.comboKey, field: 'name_length', with: wordy[0]!.name, length: 101 }]);
    expect(conflictMessage(nameProblem[0]!)).toBe('This name has 101 characters. The limit is 80.');

    // At the limits there is nothing to fix.
    const edge = [{ ...long[0]!, key: 'ABCDEF-GHIJKL-MN', name: 'n'.repeat(80) }];
    expect(edge[0]!.key).toHaveLength(MAX_VARIANT_KEY_LENGTH);
    expect(edge[0]!.name).toHaveLength(MAX_VARIANT_NAME_LENGTH);
    expect(VARIANT_KEY_RULE.test(edge[0]!.key)).toBe(true);
    expect(findConflicts(edge, [])).toEqual([]);
    // The GLOVE matrix is well inside both limits.
    expect(findConflicts(generated, [])).toEqual([]);
  });
});

describe('suggestCode', () => {
  it('uses the known words first', () => {
    expect(suggestCode('Small', new Set())).toBe('S');
    expect(suggestCode('Extra large', new Set())).toBe('XL');
    expect(suggestCode('X-Large', new Set())).toBe('XL');
    expect(suggestCode('Brown', new Set())).toBe('BRN');
    expect(suggestCode('grey', new Set())).toBe('GRY');
  });
  it('keeps short labels and cuts long ones to 3 letters', () => {
    expect(suggestCode('xs', new Set())).toBe('XS');
    expect(suggestCode('Teal', new Set())).toBe('TEA');
    expect(suggestCode('!!', new Set())).toBe('V');
  });
  it('adds a digit until the code is free', () => {
    expect(suggestCode('Brown', new Set(['brn']))).toBe('BRN2');
    expect(suggestCode('Brown', new Set(['BRN', 'BRN2']))).toBe('BRN3');
  });
  it('reads codes back to labels', () => {
    expect(labelForCode('brn')).toBe('Brown');
    expect(labelForCode('S')).toBe('Small');
    expect(labelForCode('Q7')).toBe('Q7');
  });
});

describe('inferAxes', () => {
  it('E40 a list of SKUs', () => {
    const result = inferAxes({ text: 'GLOVE-S-BRN\nGLOVE-S-YLW\nGLOVE-M-BRN\nGLOVE-XL-YLW\n' });
    expect(result.mode).toBe('sku');
    expect(result.axes).toEqual([
      { name: 'Size', values: [{ label: 'Small', code: 'S' }, { label: 'Medium', code: 'M' }, { label: 'XL', code: 'XL' }] },
      { name: 'Color', values: [{ label: 'Brown', code: 'BRN' }, { label: 'Yellow', code: 'YLW' }] },
    ]);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toMatchObject({ sku: 'GLOVE-S-BRN', name: 'Small Brown', attributes: { Size: 'Small', Color: 'Brown' } });
    expect(result.unmatched).toEqual([]);
  });
  it('names SKU parts the same way as names: Size and Color from known values, else Part N', () => {
    // The same values typed as names get the same attribute names.
    const asNames = inferAxes({ text: 'Small Brown\nSmall Yellow\nMedium Brown' });
    const asSkus = inferAxes({ text: 'GLOVE-S-BRN\nGLOVE-S-YLW\nGLOVE-M-BRN' });
    expect(asSkus.axes.map((axis) => axis.name)).toEqual(asNames.axes.map((axis) => axis.name));
    expect(asSkus.axes.map((axis) => axis.name)).toEqual(['Size', 'Color']);
    // Parts that are not known sizes or colors keep the Part N fallback for the wizard to rename.
    const plain = inferAxes({ text: 'KIT-A1-Q7\nKIT-B2-Q8' });
    expect(plain.axes.map((axis) => axis.name)).toEqual(['Part 1', 'Part 2']);
    expect(plain.rows[0]!.attributes).toEqual({ 'Part 1': 'A1', 'Part 2': 'Q7' });
    // A mix: a known size part and an unknown part.
    const mixed = inferAxes({ text: 'GLOVE-S-Q7\nGLOVE-L-Q8' });
    expect(mixed.axes.map((axis) => axis.name)).toEqual(['Size', 'Part 2']);
    expect(mixed.rows[1]!.attributes).toEqual({ Size: 'Large', 'Part 2': 'Q8' });
    // Two parts that are both colors never share a name.
    const twoColors = inferAxes({ text: 'GLOVE-BRN-YLW\nGLOVE-YLW-BRN' });
    expect(twoColors.axes.map((axis) => axis.name)).toEqual(['Color', 'Color 2']);
  });
  it('sends a repeated SKU to unmatched so the same variant is never made twice', () => {
    const result = inferAxes({ text: 'A-1\nB-2\nA-1' });
    expect(result.rows.map((row) => row.sku)).toEqual(['A-1', 'B-2']);
    expect(result.unmatched).toEqual([{ line: 3, raw: 'A-1', why: 'This SKU is already on line 1.' }]);
    const cased = inferAxes({ text: 'GLOVE-S-BRN\nglove-s-brn\nGLOVE-M-BRN' });
    expect(cased.rows).toHaveLength(2);
    expect(cased.unmatched).toEqual([{ line: 2, raw: 'glove-s-brn', why: 'This SKU is already on line 1.' }]);
    const oneLine = inferAxes({ text: 'GLOVE-S-BRN, GLOVE-S-YLW, GLOVE-S-BRN' });
    expect(oneLine.rows).toHaveLength(2);
    expect(oneLine.unmatched).toEqual([{ line: 1, raw: 'GLOVE-S-BRN', why: 'This SKU is already on line 1.' }]);
  });
  it('sends a repeated SKU or the same values again to unmatched in a sheet', () => {
    const result = inferAxes({ text: 'Size,Color,SKU\nSmall,Brown,GLOVE-S-BRN\nLarge,Brown,GLOVE-S-BRN\nsmall,brown,GLOVE-S-BRN-2\nLarge,Yellow,GLOVE-L-YLW' });
    expect(result.mode).toBe('columns');
    expect(result.rows.map((row) => row.sku)).toEqual(['GLOVE-S-BRN', 'GLOVE-L-YLW']);
    expect(result.unmatched).toEqual([
      { line: 3, raw: 'Large,Brown,GLOVE-S-BRN', why: 'This SKU is already on line 2.' },
      { line: 4, raw: 'small,brown,GLOVE-S-BRN-2', why: 'These values are already on line 2.' },
    ]);
    // Brown and Large were only on rows that were left out or kept once, so the axes hold what the rows use.
    expect(result.axes).toEqual([
      { name: 'Size', values: [{ label: 'Small', code: 'S' }, { label: 'Large', code: 'L' }] },
      { name: 'Color', values: [{ label: 'Brown', code: 'BRN' }, { label: 'Yellow', code: 'YLW' }] },
    ]);
  });
  it('lists a SKU with a different number of parts', () => {
    const result = inferAxes({ text: 'GLOVE-S-BRN\nGLOVE-S-YLW\nGLOVE-M-BRN-X\n' });
    expect(result.unmatched).toEqual([{ line: 3, raw: 'GLOVE-M-BRN-X', why: 'This SKU has 4 parts. The others have 3.' }]);
    expect(result.rows).toHaveLength(2);
  });
  it('uses the separator given, and keeps a first part that differs', () => {
    const result = inferAxes({ text: 'S_BRN\nM_YLW', separator: '_' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size', 'Color']);
    expect(result.rows[1]!.name).toBe('Medium Yellow');
  });
  it('refuses more than 4 parts', () => {
    const result = inferAxes({ text: 'A-B-C-D-E-F\nA-X-C-D-E-G' });
    expect(result.axes).toEqual([]);
    expect(result.unmatched[0]!.why).toBe('This SKU has 5 parts after the program code. The limit is 4.');
  });
  it('reads SKUs typed on one line with commas as a SKU list', () => {
    const result = inferAxes({ text: 'GLOVE-S-BRN, GLOVE-S-YLW, GLOVE-M-BRN' });
    expect(result.mode).toBe('sku');
    expect(result.axes).toHaveLength(2);
    expect(result.axes.map((axis) => axis.values.map((value) => value.label))).toEqual([
      ['Small', 'Medium'],
      ['Brown', 'Yellow'],
    ]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.sku)).toEqual(['GLOVE-S-BRN', 'GLOVE-S-YLW', 'GLOVE-M-BRN']);
    expect(result.unmatched).toEqual([]);
    const tabs = inferAxes({ text: 'GLOVE-S-BRN\tGLOVE-S-YLW\nGLOVE-M-BRN;GLOVE-M-YLW, GLOVE-L\n' });
    expect(tabs.mode).toBe('sku');
    expect(tabs.rows).toHaveLength(4);
    expect(tabs.unmatched).toEqual([{ line: 2, raw: 'GLOVE-L', why: 'This SKU has 2 parts. The others have 3.' }]);
    expect(inferAxes({ text: 'SKU,Qty\nGLOVE-S-BRN,100' }).mode).toBe('columns');
  });
  it('E41 a sheet with a header row', () => {
    const rows = ['Size\tColor\tSKU', 'Small\tBrown\tGLOVE-S-BRN', 'Small\tYellow\tGLOVE-S-YLW', 'Medium\tBrown\tGLOVE-M-BRN', 'Medium\tYellow\tGLOVE-M-YLW', 'Large\tBrown\tGLOVE-L-BRN', 'Large\tYellow\tGLOVE-L-YLW', 'XL\tBrown\tGLOVE-XL-BRN', 'XL\tYellow\tGLOVE-XL-YLW'];
    const result = inferAxes({ text: rows.join('\n') });
    expect(result.mode).toBe('columns');
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size', 'Color']);
    expect(result.axes[0]!.values.map((value) => value.code)).toEqual(['S', 'M', 'L', 'XL']);
    expect(result.rows).toHaveLength(8);
    expect(result.rows.map((row) => row.sku)).toEqual(rows.slice(1).map((row) => row.split('\t')[2]));
  });
  it('reads a comma sheet with qty and rate, and lists bad rows', () => {
    const text = ['Fit,Name,Default qty,Price', 'Slim,"Slim, tall",100,$1.95', 'Wide,Wide,abc,2', ',Blank,1,1', 'Wide,Wide 2,5,x', 'slim,Slim again,1,1'].join('\n');
    const result = inferAxes({ text });
    expect(result.axes).toEqual([{ name: 'Fit', values: [{ label: 'Slim', code: 'SLI' }] }]);
    expect(result.rows[0]).toMatchObject({ name: 'Slim, tall', qty: '100', rate: '1.95' });
    // "slim" is the same Fit as line 2, so it would make the same variant twice.
    expect(result.rows).toHaveLength(1);
    expect(result.unmatched.map((row) => row.why)).toEqual(['The qty abc is not a number.', 'This row has no Fit.', 'The rate x is not a number.', 'These values are already on line 2.']);
  });
  it('reads a sheet with no header and names the attributes', () => {
    const result = inferAxes({ text: 'S\tBRN\nS\tYLW\nM\tBRN' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Attribute 1', 'Attribute 2']);
    expect(result.rows).toHaveLength(3);
  });
  it('keeps 4 attributes at most', () => {
    const result = inferAxes({ text: 'A,B,C,D,E\n1a,2b,3c,4d,5e\n1b,2b,3c,4d,5e' });
    expect(result.axes).toHaveLength(4);
    expect(result.unmatched[0]!.why).toBe('Only 4 attributes fit. The column E was left out.');
  });
  it('keeps 200 rows at most', () => {
    const text = Array.from({ length: 202 }, (_, i) => `K-${i}`).join('\n');
    const result = inferAxes({ text });
    expect(result.rows).toHaveLength(200);
    expect(result.unmatched).toHaveLength(2);
  });
  it('reads hyphenated labels in a sheet with no header as columns, not as SKUs', () => {
    const result = inferAxes({ text: 'X-Large,Dark-Brown\nX-Small,Light-Tan' });
    expect(result.mode).toBe('columns');
    expect(result.axes.map((axis) => axis.name)).toEqual(['Attribute 1', 'Attribute 2']);
    expect(result.axes.map((axis) => axis.values.map((value) => value.label))).toEqual([
      ['X-Large', 'X-Small'],
      ['Dark-Brown', 'Light-Tan'],
    ]);
    expect(result.axes[0]!.values[0]!.code).toBe('XL');
    expect(result.rows).toHaveLength(2);
    expect(result.unmatched).toEqual([]);
  });
  it('still reads code shaped SKUs with no shared prefix as a SKU list', () => {
    const result = inferAxes({ text: 'S-BRN, M-YLW\nL-BRN' });
    expect(result.mode).toBe('sku');
    expect(result.rows.map((row) => row.name)).toEqual(['Small Brown', 'Medium Yellow', 'Large Brown']);
  });
  it('drops a SKU column header instead of listing it as a bad SKU', () => {
    const result = inferAxes({ text: 'SKU\nGLOVE-S-BRN\nGLOVE-M-YLW' });
    expect(result.mode).toBe('sku');
    expect(result.unmatched).toEqual([]);
    expect(result.rows.map((row) => row.sku)).toEqual(['GLOVE-S-BRN', 'GLOVE-M-YLW']);
    expect(result.axes.map((axis) => axis.values.map((value) => value.label))).toEqual([['Small', 'Medium'], ['Brown', 'Yellow']]);
    for (const header of ['SKU', 'sku', 'Item', 'Code', 'Kit', 'Variant', 'Item code', 'Kit SKU', 'SKUs']) expect(isSkuHeader(header)).toBe(true);
    for (const word of ['GLOVE-S-BRN', 'Small', 'Size and color']) expect(isSkuHeader(word)).toBe(false);
  });
  it('refuses a qty or rate with too many decimals instead of rounding', () => {
    const result = inferAxes({ text: 'Fit,Qty,Rate\nSlim,1.23456,1.95\nWide,10,1.23456\nTall,5,-1' });
    expect(result.rows).toEqual([]);
    expect(result.unmatched.map((row) => row.why)).toEqual(['Use up to 3 decimals.', 'Use up to 4 decimals for a rate.', 'A rate cannot be less than $0.']);
    expect(decimalProblem('1.2300', 3, 'qty')).toBeNull();
  });
  it('an empty paste reads nothing', () => {
    expect(inferAxes({ text: '  \n' })).toEqual({ mode: 'sku', axes: [], rows: [], unmatched: [], notes: [] });
  });
});

describe('cells and numbers', () => {
  it('splits quoted commas and tabs', () => {
    expect(splitCells('a, "b, c" ,"say ""hi"""', ',')).toEqual(['a', 'b, c', 'say "hi"']);
    expect(splitCells('a\t"b"\t', '\t')).toEqual(['a', 'b', '']);
  });
  it('reads money and qty numbers', () => {
    expect(looksLikeNumber('1,200')).toBe(true);
    expect(looksLikeNumber('$1.95')).toBe(true);
    expect(looksLikeNumber('.5')).toBe(true);
    expect(looksLikeNumber('S-BRN')).toBe(false);
    expect(plainNumber('$1,200.50')).toBe('1200.50');
    expect(plainNumber('x')).toBeNull();
  });
  it('never reads a leading zero thousands group (a European 0.5) as a number', () => {
    for (const cell of ['0,500', '00,123', '0,5', '$0,500']) {
      expect(looksLikeNumber(cell)).toBe(false);
      expect(plainNumber(cell)).toBeNull();
    }
    expect(plainNumber('0500')).toBe('0500');
    expect(plainNumber('1,500')).toBe('1500');
    const result = inferAxes({ text: 'Fit,Qty,Rate\nSlim,"0,500",1.95\nWide,"00,123",1.95\nTall,10,"0,500"\nShort,10,"0,5"' });
    expect(result.rows).toEqual([]);
    expect(result.unmatched.map((row) => row.why)).toEqual(['The qty 0,500 is not a number.', 'The qty 00,123 is not a number.', 'The rate 0,500 is not a number.', 'The rate 0,5 is not a number.']);
  });
});

describe('codes in other scripts', () => {
  const origin: AttributeAxis = { id: 'o', name: 'Origin', values: [{ id: 'jp', label: '日本', code: '日本' }, { id: 'cn', label: '中国', code: '中国' }] };
  it('gives values with no letters A to Z a V code, so keys and SKUs are never empty', () => {
    const variants = generateVariants({ axes: [origin], namePattern: '', keyPattern: '', skuPattern: '{program}-{Origin.code}', programKey: 'G' });
    expect(variants.map((variant) => [variant.name, variant.key, variant.sku])).toEqual([
      ['日本', 'V', 'G-V'],
      ['中国', 'V2', 'G-V2'],
    ]);
    expect(findConflicts(variants, [])).toEqual([]);
    expect(suggestCode('日本', new Set())).toBe('V');
  });
  it('a key pattern of labels falls back to the codes, and a SKU of only the program key is refused', () => {
    expect(generateVariants({ axes: [origin], namePattern: '', keyPattern: '{Origin}', skuPattern: null, programKey: 'G' }).map((variant) => variant.key)).toEqual(['V', 'V2']);
    expect(() => generateVariants({ axes: [origin], namePattern: '', keyPattern: '', skuPattern: '{program}-{Origin}', programKey: 'G' })).toThrow(
      new RangeError('The SKU pattern makes only the program key for 日本. Give each value a code with letters A to Z or numbers.'),
    );
  });
  it('flags empty keys as a clash', () => {
    const empty = { comboKey: 'a', attributes: { o: 'jp' }, name: '日本', key: '', sku: null };
    expect(findConflicts([empty, { ...empty, comboKey: 'b', attributes: { o: 'cn' }, name: '中国' }], [])).toEqual([{ comboKey: 'b', field: 'key', with: '日本' }]);
  });
  it('folds accents into codes', () => {
    expect(toCodeText('Café Crème')).toBe('CAFE-CREME');
    expect(suggestCode('Écru', new Set())).toBe('ECR');
  });
});

describe('inferAxes reads number columns and repeated names', () => {
  it('a number column with no header is the qty, never an attribute', () => {
    const result = inferAxes({ text: 'Small,Brown,100\nSmall,Yellow,200\nMedium,Brown,50' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Attribute 1', 'Attribute 2']);
    expect(result.rows.map((row) => row.qty)).toEqual(['100', '200', '50']);
    expect(result.unmatched).toEqual([]);
  });
  it('a number column with $ or 4 decimals is the rate', () => {
    const dollars = inferAxes({ text: 'Small,Brown,100,$1.95\nSmall,Yellow,200,$2.05' });
    expect(dollars.rows.map((row) => [row.qty, row.rate])).toEqual([
      ['100', '1.95'],
      ['200', '2.05'],
    ]);
    const decimals = inferAxes({ text: 'Small,1.9525\nLarge,2.1000' });
    expect(decimals.axes).toHaveLength(1);
    expect(decimals.rows.map((row) => row.rate)).toEqual(['1.9525', '2.1000']);
  });
  it('renames a second column with the same name and says so', () => {
    const result = inferAxes({ text: 'Size,size,Color\nSmall,S,Brown\nLarge,L,Yellow' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size', 'size 2', 'Color']);
    expect(result.notes).toEqual([{ line: 1, text: 'Two columns are called size. The second one is now size 2.' }]);
    // The axes now pass the generator's own name check.
    expect(axisNameProblem(result.axes.map((axis) => ({ name: axis.name, values: [{ id: '', label: '', code: '' }] })))).toBeNull();
  });
  it('leaves out a column called program with the reason', () => {
    const result = inferAxes({ text: 'Size,Program\nSmall,A\nLarge,B' });
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size']);
    expect(result.unmatched[0]?.why).toBe('An attribute cannot be called program. That word is kept for the program key. The column Program was left out.');
  });
  it('reads a semicolon sheet and refuses a qty above the column limit', () => {
    const result = inferAxes({ text: 'Size;Color;Qty\nSmall;Brown;100\nLarge;Yellow;100000000000' });
    expect(result.mode).toBe('columns');
    expect(result.rows).toHaveLength(1);
    expect(result.unmatched[0]?.why).toBe('The qty is too large. Use up to 99,999,999.');
    expect(splitCells('a; "b; c" ;d', ';')).toEqual(['a', 'b; c', 'd']);
  });
  it('holds qty and rate to the database CHECKs (qty below 100,000,000, rate below $1,000,000)', () => {
    expect(MAX_QTY_WHOLE_DIGITS).toBe(8);
    expect(MAX_RATE_WHOLE_DIGITS).toBe(6);
    expect(QTY_TOO_LARGE).toBe('The qty is too large. Use up to 99,999,999.');
    expect(SCRAP_TOO_LARGE).toBe('The scrap is too large. Use up to 99,999,999.');
    expect(RATE_TOO_LARGE).toBe('The rate is too large. Use up to $999,999.9999.');
    expect(decimalProblem('99999999.999', 3, 'qty')).toBeNull();
    expect(decimalProblem('100000000', 3, 'qty')).toBe(QTY_TOO_LARGE);
    expect(decimalProblem('999999.9999', 4, 'rate')).toBeNull();
    expect(decimalProblem('1000000', 4, 'rate')).toBe(RATE_TOO_LARGE);
    expect(decimalProblem('5000000', 4, 'rate')).toBe(RATE_TOO_LARGE);
    const sheet = inferAxes({ text: 'Size,Qty,Rate\nSmall,99999999,$999999.9999\nMedium,5,$1000000\nLarge,100000000,$1' });
    expect(sheet.rows.map((row) => [row.qty, row.rate])).toEqual([['99999999', '999999.9999']]);
    expect(sheet.unmatched.map((row) => [row.line, row.why])).toEqual([
      [3, RATE_TOO_LARGE],
      [4, QTY_TOO_LARGE],
    ]);
    expect(splitCells('a; "b; c" ;d', ';')).toEqual(['a', 'b; c', 'd']);
  });
});

describe('inferAxes reads a pasted list of names as names', () => {
  const allCodesPass = (result: ReturnType<typeof inferAxes>): boolean => result.axes.every((axis) => axis.values.every((value) => VALUE_CODE_RULE.test(value.code)));
  it('Small Brown, Small Yellow, Medium Brown, XL Yellow: labels as typed, known codes, no SKU', () => {
    const result = inferAxes({ text: 'Small Brown\nSmall Yellow\nMedium Brown\nXL Yellow' });
    expect(result.axes).toEqual([
      { name: 'Size', values: [{ label: 'Small', code: 'S' }, { label: 'Medium', code: 'M' }, { label: 'XL', code: 'XL' }] },
      { name: 'Color', values: [{ label: 'Brown', code: 'BRN' }, { label: 'Yellow', code: 'YLW' }] },
    ]);
    expect(result.rows.map((row) => [row.name, row.sku, row.attributes])).toEqual([
      ['Small Brown', null, { Size: 'Small', Color: 'Brown' }],
      ['Small Yellow', null, { Size: 'Small', Color: 'Yellow' }],
      ['Medium Brown', null, { Size: 'Medium', Color: 'Brown' }],
      ['XL Yellow', null, { Size: 'XL', Color: 'Yellow' }],
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.notes).toEqual([{ line: 1, text: 'These lines were read as names, not SKUs, so the kits have no SKU yet. Each part of a name is one attribute.' }]);
  });
  it('a shared first word that is a value (Small) is kept, never dropped as a program code', () => {
    const result = inferAxes({ text: 'Small Brown\nSmall Yellow' });
    expect(result.axes.map((axis) => [axis.name, axis.values.map((value) => value.label)])).toEqual([
      ['Size', ['Small']],
      ['Color', ['Brown', 'Yellow']],
    ]);
    expect(result.rows.map((row) => row.name)).toEqual(['Small Brown', 'Small Yellow']);
    // A shared part that looks like a program code is still dropped.
    const coded = inferAxes({ text: 'GLOVE Small Brown\nGLOVE Large Brown' });
    expect(coded.axes.map((axis) => axis.name)).toEqual(['Size', 'Color']);
    expect(coded.rows.map((row) => row.name)).toEqual(['Small Brown', 'Large Brown']);
  });
  it('a shared word that is not a value names the attribute after it (size 7, size 8)', () => {
    const result = inferAxes({ text: 'size 7\nsize 8\nSize 9' });
    expect(result.axes).toEqual([{ name: 'Size', values: [{ label: '7', code: '7' }, { label: '8', code: '8' }, { label: '9', code: '9' }] }]);
    expect(result.rows.map((row) => [row.name, row.attributes])).toEqual([
      ['7', { Size: '7' }],
      ['8', { Size: '8' }],
      ['9', { Size: '9' }],
    ]);
    expect(result.notes).toEqual([
      { line: 1, text: 'Every line starts with size, so Size is the name of the attribute, not a value.' },
      { line: 1, text: 'These lines were read as names, not SKUs, so the kits have no SKU yet. Each part of a name is one attribute.' },
    ]);
    // With more parts, the word names the part right after it and the rest are named from their values.
    const longer = inferAxes({ text: 'width 10 Brown\nwidth 12 Yellow' });
    expect(longer.axes.map((axis) => [axis.name, axis.values.map((value) => value.label)])).toEqual([
      ['Width', ['10', '12']],
      ['Color', ['Brown', 'Yellow']],
    ]);
    // When the values are known sizes, Size wins and the shared word is only left out.
    const known = inferAxes({ text: 'glove Small\nglove Large' });
    expect(known.axes.map((axis) => [axis.name, axis.values.map((value) => value.label)])).toEqual([['Size', ['Small', 'Large']]]);
    expect(known.notes[0]).toEqual({ line: 1, text: 'Every line starts with glove, so it was left out of the values.' });
    // A word that cannot be an attribute name falls back to Part 1.
    const reserved = inferAxes({ text: 'program 7\nprogram 8' });
    expect(reserved.axes.map((axis) => axis.name)).toEqual(['Part 1']);
    // One line alone is never split this way.
    expect(inferAxes({ text: 'size 7' }).axes.map((axis) => axis.name)).toEqual(['Part 1', 'Part 2']);
  });
  it('Strawberry and Banana get codes the database takes', () => {
    const result = inferAxes({ text: 'Strawberry\nBanana' });
    expect(result.axes).toEqual([{ name: 'Part 1', values: [{ label: 'Strawberry', code: 'STR' }, { label: 'Banana', code: 'BAN' }] }]);
    expect(result.rows.map((row) => [row.name, row.sku])).toEqual([
      ['Strawberry', null],
      ['Banana', null],
    ]);
    expect(allCodesPass(result)).toBe(true);
  });
  it('Extra Large is one value, not a third part', () => {
    const result = inferAxes({ text: 'Small Brown\nExtra Large Yellow\nX Large Brown' });
    expect(result.unmatched).toEqual([]);
    expect(result.axes[0]).toEqual({ name: 'Size', values: [{ label: 'Small', code: 'S' }, { label: 'Extra Large', code: 'XL' }, { label: 'X Large', code: 'XL2' }] });
    expect(result.rows.map((row) => row.name)).toEqual(['Small Brown', 'Extra Large Yellow', 'X Large Brown']);
  });
  it('lower case names get a first capital, short known codes are spelled out, and repeats are listed', () => {
    const result = inferAxes({ text: 'small brown\ns ylw\nSMALL BROWN\nDark Brown Small' });
    expect(result.rows.map((row) => row.name)).toEqual(['Small Brown', 'Small Yellow']);
    expect(result.unmatched).toEqual([
      { line: 3, raw: 'SMALL BROWN', why: 'These values are already on line 1.' },
      { line: 4, raw: 'Dark Brown Small', why: 'This name has 3 parts. The others have 2. To use a value of more than one word, paste a sheet with one column per attribute.' },
    ]);
  });
  it('mixed case with dashes reads as names too', () => {
    const result = inferAxes({ text: 'Small-Brown\nLarge-Yellow' });
    expect(result.rows.map((row) => [row.name, row.sku])).toEqual([
      ['Small Brown', null],
      ['Large Yellow', null],
    ]);
  });
  it('a SKU list typed in lower case is still a SKU list', () => {
    const result = inferAxes({ text: 'glove-s-brn\nglove-m-ylw' });
    expect(result.notes).toEqual([]);
    expect(result.rows.map((row) => [row.sku, row.name])).toEqual([
      ['GLOVE-S-BRN', 'Small Brown'],
      ['GLOVE-M-YLW', 'Medium Yellow'],
    ]);
  });
});

describe('inferAxes codes always pass the database CHECK', () => {
  it('a SKU part longer than 6 or with other characters gets a short code, and the SKU is kept', () => {
    const result = inferAxes({ text: 'STRAWBERRY\nBANANA\nKIWI.2' });
    expect(result.axes[0]!.values).toEqual([
      { label: 'STRAWBERRY', code: 'STR' },
      { label: 'BANANA', code: 'BANANA' },
      { label: 'KIWI.2', code: 'KIW' },
    ]);
    expect(result.rows.map((row) => row.sku)).toEqual(['STRAWBERRY', 'BANANA', 'KIWI.2']);
  });
  it('a shared first part that is a known value (S) is kept, and one that looks like a program code is dropped', () => {
    const small = inferAxes({ text: 'S-BRN\nS-YLW' });
    expect(small.axes.map((axis) => axis.values.map((value) => value.code))).toEqual([['S'], ['BRN', 'YLW']]);
    const program = inferAxes({ text: 'KIT7-A\nKIT7-B' });
    expect(program.axes.map((axis) => axis.values.map((value) => value.code))).toEqual([['A', 'B']]);
  });
  it('holds for random pasted lists', () => {
    let state = 7;
    const random = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const words = ['Small', 'Extra Large', 'brown', 'Strawberry', 'BANANAS', 'KIT.1', 'x', 'Navy', 'XXL', 'Ünïcode', '日本', 'GLOVE', 'A_B', 'Medium-Tall'];
    for (let run = 0; run < 400; run += 1) {
      const sep = [' ', '-', '_', '/'][Math.floor(random() * 4)]!;
      const lines = Array.from({ length: 1 + Math.floor(random() * 6) }, () => Array.from({ length: 1 + Math.floor(random() * 3) }, () => words[Math.floor(random() * words.length)]).join(sep));
      const result = inferAxes({ text: lines.join('\n') });
      for (const axis of result.axes) for (const value of axis.values) expect(VALUE_CODE_RULE.test(value.code), `${value.code} from ${JSON.stringify(lines)}`).toBe(true);
      for (const row of result.rows) expect(row.sku === null || !/\s/.test(row.sku)).toBe(true);
    }
  });
});

describe('inferAxes refuses a dollar sign in a qty column', () => {
  it('reads $10 under Qty as a price read as the qty', () => {
    const result = inferAxes({ text: 'Size,Qty\nSmall,$10\nLarge,10' });
    expect(result.rows.map((row) => row.qty)).toEqual(['10']);
    expect(result.unmatched).toEqual([{ line: 2, raw: 'Small,$10', why: 'The qty $10 looks like a price. Type only how many units.' }]);
  });
});

describe('inferAxes never makes an axis from a stray cell', () => {
  it('a row with more cells than the header is listed, and the other rows keep their axes', () => {
    const result = inferAxes({ text: 'Size,Color,Qty\nSmall,Brown,0,500\nSmall,Yellow,100\nLarge,Brown,"1,200"' });
    expect(result.mode).toBe('columns');
    expect(result.axes.map((axis) => axis.name)).toEqual(['Size', 'Color']);
    expect(result.rows.map((row) => [row.attributes, row.qty])).toEqual([
      [{ Size: 'Small', Color: 'Yellow' }, '100'],
      [{ Size: 'Large', Color: 'Brown' }, '1200'],
    ]);
    expect(result.unmatched).toEqual([{ line: 2, raw: 'Small,Brown,0,500', why: 'Row 2 has more cells than the header. It has 4 cells and the header has 3. Put a number like 1,200 in quotes, or type it as 1200.' }]);
  });
  it('names a split thousands number', () => {
    const result = inferAxes({ text: 'Size,Color,Qty\nSmall,Brown,1,200\nSmall,Yellow,100' });
    expect(result.unmatched[0]?.why).toBe('Row 2 has more cells than the header. It has 4 cells and the header has 3. Put "1,200" in quotes, or type it as 1200.');
    expect(result.axes.map((axis) => axis.values.map((value) => value.label))).toEqual([['Small'], ['Yellow']]);
  });
  it('a decimal rate split by a comma gets the plain fix, not the 1,200 hint', () => {
    const result = inferAxes({ text: 'Size,Color,Qty\nLarge,Brown,2.10,5\nSmall,Yellow,100' });
    expect(result.unmatched[0]?.why).toBe('Row 2 has more cells than the header. It has 4 cells and the header has 3. Take out the extra comma, or put a cell that has a comma in quotes.');
  });
  it('a stray text cell gets the plain fix', () => {
    const result = inferAxes({ text: 'Size\tColor\nSmall\tBrown\tOops\nSmall\tYellow' });
    expect(result.unmatched[0]?.why).toBe('Row 2 has more cells than the header. It has 3 cells and the header has 2. Take out the extra tab.');
    expect(result.rows).toHaveLength(1);
  });
  it('with no header, a row longer than most rows is listed instead of adding a column', () => {
    const result = inferAxes({ text: 'Small,Brown,100\nSmall,Yellow,100\nMedium,Brown,0,500' });
    expect(result.axes).toHaveLength(2);
    expect(result.rows).toHaveLength(2);
    expect(result.unmatched).toEqual([{ line: 3, raw: 'Medium,Brown,0,500', why: 'Row 3 has more cells than most rows. It has 4 cells and most rows have 3. Put a number like 1,200 in quotes, or type it as 1200.' }]);
  });
  it('the qty words match the imports', () => {
    const result = inferAxes({ text: 'Size,Color,Qty\nSmall,Brown,-4\nSmall,Yellow,ten' });
    expect(result.unmatched.map((row) => row.why)).toEqual(['The qty cannot be less than 0.', 'The qty ten is not a number.']);
    expect(decimalProblem('-4', 3, 'qty')).toBe('The qty cannot be less than 0.');
  });
});
