import { describe, expect, it } from 'vitest';
import { buildFormStarter, mappingChoices, mappingProblem, syncVariantOptions, type FormProgram } from './build-form';

const program: FormProgram = {
  id: 'p1',
  key: 'ECOMM',
  name: 'Ecommerce orders',
  color: null,
  icon: null,
  unit: { singular: 'order', plural: 'orders' },
  variants: [
    { id: 'v1', name: 'Gift box', sku: 'ECOMM-GIFT' },
    { id: 'v2', name: 'Standard', sku: 'ECOMM-STD' },
  ],
};

describe('build forms', () => {
  it('starts with a variant list, a qty and a date, all mapped', () => {
    const { fields, settings } = buildFormStarter(program, 'list');
    expect(fields.map((field) => field.type)).toEqual(['select', 'number', 'date', 'long_text']);
    expect(fields[0]!.options?.map((option) => option.label)).toEqual(['Gift box', 'Standard']);
    expect(settings.build).toEqual({ variantFieldId: fields[0]!.id, qtyFieldId: fields[1]!.id, dateFieldId: fields[2]!.id });
    expect(mappingProblem(fields, settings.build)).toBeNull();
  });
  it('can ask for a SKU instead', () => {
    const { fields } = buildFormStarter(program, 'sku');
    expect(fields[0]).toMatchObject({ type: 'short_text', label: 'SKU' });
    expect(mappingChoices(fields).variant).toHaveLength(1);
  });
  it('says what is missing', () => {
    const { fields } = buildFormStarter(program, 'list');
    expect(mappingProblem(fields, {})).toBe('Pick the question that names the kit.');
    expect(mappingProblem(fields, { variantFieldId: fields[0]!.id })).toBe('Pick the question that says how many.');
  });
  it('keeps option ids when the list is refreshed', () => {
    const { fields } = buildFormStarter(program, 'list');
    const synced = syncVariantOptions(fields[0]!, [...program.variants, { id: 'v3', name: 'Rush', sku: null }]);
    expect(synced.options?.[0]?.id).toBe(fields[0]!.options?.[0]?.id);
    expect(synced.options).toHaveLength(3);
  });
});
