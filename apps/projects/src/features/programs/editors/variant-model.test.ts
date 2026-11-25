import { describe, expect, it } from 'vitest';
import { inferAxes } from '@kitstak/programs-engine';
import {
  AXIS_PRESETS,
  EMPTY_GENERATOR,
  axisFromPreset,
  buildRows,
  effectivePatterns,
  existingComboKeys,
  foundText,
  generatorSummary,
  lineKeys,
  matrixKeys,
  moveAxis,
  moveValue,
  newRows,
  newValue,
  newVariantsSummary,
  patchOverrides,
  qtyCellProblem,
  rateCellProblem,
  rowConflicts,
  rowRates,
  toAxisInputs,
  toPayloadRows,
  toRuleInputs,
  valueFromInferred,
  type EditorAxis,
  type VariantGeneratorValue,
} from './variant-model';

const kits = { singular: 'kit', plural: 'kits' };
const size: EditorAxis = { id: 'a1', name: 'Size', values: [{ id: 's', label: 'Small', code: 'S', color: null }, { id: 'm', label: 'Medium', code: 'M', color: null }, { id: 'l', label: 'Large', code: 'L', color: null }, { id: 'xl', label: 'Extra large', code: 'XL', color: null }] };
const color: EditorAxis = { id: 'a2', name: 'Color', values: [{ id: 'brn', label: 'Brown', code: 'BRN', color: 'brown' }, { id: 'ylw', label: 'Yellow', code: 'YLW', color: 'yellow' }] };
const glove: VariantGeneratorValue = { ...EMPTY_GENERATOR, axes: [size, color] };

describe('variant generator model', () => {
  it('makes the 4 x 2 GLOVE matrix with codes and SKUs', () => {
    const { rows, error, count } = buildRows(glove, 'GLOVE');
    expect(error).toBeNull();
    expect(count).toBe(8);
    expect(rows[0]).toMatchObject({ name: 'Small Brown', key: 'S-BRN', sku: 'GLOVE-S-BRN', include: true });
    expect(rows.map((row) => row.key)).toContain('XL-YLW');
    expect(effectivePatterns(glove)).toEqual({ name: '{Size} {Color}', key: '{Size.code}-{Color.code}', sku: '{program}-{Size.code}-{Color.code}' });
  });

  it('applies overrides, selection patches and the summary', () => {
    const { rows } = buildRows(glove, 'GLOVE');
    const all = rows.map((row) => row.comboKey);
    const withQty = { ...glove, overrides: patchOverrides({}, all, { defaultQty: '100' }) };
    expect(generatorSummary(buildRows(withQty, 'GLOVE').rows, kits)).toBe('8 variants · 800 kits per run at default qty');
    const leaveOut = { ...withQty, overrides: patchOverrides(withQty.overrides, [all[0] as string], { include: false }) };
    expect(generatorSummary(buildRows(leaveOut, 'GLOVE').rows, kits)).toBe('7 variants · 700 kits per run at default qty');
    expect(generatorSummary(buildRows(glove, 'GLOVE').rows, kits)).toBe('8 variants');
  });

  it('lays out a 2 attribute matrix and its row and column keys', () => {
    const { rows } = buildRows(glove, 'GLOVE');
    const matrix = matrixKeys(rows, glove.axes);
    expect(matrix?.rowAxis.name).toBe('Size');
    expect(matrix?.byCell.get('xl|ylw')?.name).toBe('Extra large Yellow');
    expect(lineKeys(rows, 'a2', 'ylw')).toHaveLength(4);
    expect(matrixKeys(rows, [size])).toBeNull();
  });

  it('prices rows: typed beats rules, rules beat the card', () => {
    const { rows } = buildRows({ ...glove, overrides: { 'a1=s|a2=brn': { unitPrice: '2.10' } } }, 'GLOVE');
    const rules = [{ id: 'r1', attributeId: 'a1', valueId: 'xl', op: 'add' as const, amount: '0.25' }];
    const result = rowRates(rows, rules, glove.axes, '1.95');
    expect(result.rates.get('a1=s|a2=brn')).toEqual({ price: '2.1000', source: 'typed', ruleText: null });
    expect(result.rates.get('a1=xl|a2=ylw')).toEqual({ price: '2.2000', source: 'rule', ruleText: 'Size is Extra large: add $0.25' });
    expect(result.rates.get('a1=m|a2=brn')).toMatchObject({ price: '1.9500', source: 'card' });
    expect(result.ruleUse.get('r1')).toBe(2);
    expect(result.conflicts.size).toBe(0);
    expect(rowRates(rows, [], glove.axes, null).rates.get('a1=m|a2=brn')).toEqual({ price: null, source: 'none', ruleText: null });
  });

  it('reports rule conflicts in plain words', () => {
    const { rows } = buildRows(glove, 'GLOVE');
    const rules = [
      { id: 'r1', attributeId: 'a1', valueId: 'xl', op: 'set' as const, amount: '2.20' },
      { id: 'r2', attributeId: 'a2', valueId: 'ylw', op: 'set' as const, amount: '2.00' },
    ];
    expect(rowRates(rows, rules, glove.axes, '1.95').conflicts.get('a1=xl|a2=ylw')).toBe('Two rules set a price for Extra large Yellow.');
  });

  it('finds clashes with existing variants', () => {
    const { rows } = buildRows(glove, 'GLOVE');
    const conflicts = rowConflicts(rows, [{ key: 'S-BRN', name: 'Old small', sku: null, attributes: {} }]);
    expect(conflicts.get('a1=s|a2=brn')).toMatch(/Old small/);
  });

  it('locks the combinations the program already has', () => {
    const { rows } = buildRows(glove, 'GLOVE');
    const existing = [{ key: 'S-BRN', name: 'Small Brown', sku: 'GLOVE-S-BRN', attributes: { a1: 's', a2: 'brn' } }];
    expect([...existingComboKeys(rows, existing)]).toEqual(['a1=s|a2=brn']);
    expect(newRows(rows, existing)).toHaveLength(7);
    const withQty = rows.map((row) => ({ ...row, defaultQty: '100' }));
    expect(newVariantsSummary(withQty, existing, kits)).toBe('7 new variants · 700 kits per run at default qty · 1 already in the program');
  });

  it('checks typed cells', () => {
    expect(rateCellProblem('1.95')).toBeNull();
    expect(rateCellProblem('1.12345')).toBe('Use up to 4 decimals for a rate.');
    expect(rateCellProblem('abc')).toBe('The rate abc is not a number.');
    expect(qtyCellProblem('100')).toBeNull();
    expect(qtyCellProblem('0')).toBe('Default qty must be more than 0.');
    expect(qtyCellProblem('1.2345')).toBe('Use up to 3 decimals.');
  });

  it('edits axes: presets, codes, moving', () => {
    const preset = axisFromPreset(AXIS_PRESETS[0]!, [size]);
    expect(preset.name).toBe('Size 2');
    expect(preset.values.map((value) => value.code)).toEqual(['S', 'M', 'L', 'XL']);
    const added = newValue(size, 'Small');
    expect(added.code).not.toBe('S');
    expect(moveAxis([size, color], 'a2', -1).map((axis) => axis.id)).toEqual(['a2', 'a1']);
    expect(moveValue(size, 'xl', 0).values[0]?.id).toBe('xl');
  });

  it('builds the wizard payload with names and codes', () => {
    const { rows } = buildRows({ ...glove, overrides: { 'a1=s|a2=brn': { defaultQty: '1,000', unitPrice: '$2' } } }, 'GLOVE');
    expect(toAxisInputs([size, { id: 'a9', name: 'Empty', values: [] }])).toHaveLength(1);
    expect(toRuleInputs([{ id: 'r1', attributeId: 'a1', valueId: 'xl', op: 'add', amount: '0.25' }], glove.axes)).toEqual([{ attributeId: 'Size', valueId: 'XL', op: 'add', amount: '0.25' }]);
    const payload = toPayloadRows(rows);
    expect(payload[0]).toMatchObject({ defaultQty: '1000', unitPrice: '2.0000' });
  });

  it('turns a pasted SKU list into axes and leaves out combinations nobody pasted', () => {
    const result = inferAxes({ text: 'GLOVE-S-BRN\nGLOVE-S-YLW\nGLOVE-M-BRN' });
    const value = valueFromInferred(result);
    const { rows } = buildRows(value, 'GLOVE');
    expect(rows.filter((row) => row.include)).toHaveLength(3);
    expect(foundText(result, kits)).toMatch(/^Found \d attributes? and 3 kits$/);
  });
});
