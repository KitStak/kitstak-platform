import { describe, expect, it } from 'vitest';
import type { AttributeDTO, VariantDTO } from '@/lib/program-types';
import { attributesChanged, generatorFromAttributes, isExistingRow, keyFromName, mapRowAttributes, mergeForSave, newAxes, removalConflict, rowExistsByCodes, toSaveInputs, uniqueKey } from './variants-model';

const size: AttributeDTO = { id: 'attr-size', name: 'Size', position: 'a0', version: 1, values: [{ id: 'size-s', label: 'Small', code: 'S', color: null }, { id: 'size-xl', label: 'XL', code: 'XL', color: null }] };
const color: AttributeDTO = { id: 'attr-color', name: 'Color', position: 'a1', version: 1, values: [{ id: 'color-br', label: 'Brown', code: 'BR', color: null }, { id: 'color-ye', label: 'Yellow', code: 'YE', color: null }] };
const variant = (name: string, attributes: Record<string, string>): Pick<VariantDTO, 'name' | 'attributes' | 'status'> => ({ name, attributes, status: 'active' });

describe('variants model', () => {
  it('seeds the generator with saved ids and finds existing combinations', () => {
    const value = generatorFromAttributes([size, color]);
    expect(value.axes.map((axis) => axis.id)).toEqual(['attr-size', 'attr-color']);
    expect(isExistingRow({ attributes: { 'attr-size': 'size-s', 'attr-color': 'color-br' } }, [variant('Small Brown', { 'attr-size': 'size-s', 'attr-color': 'color-br' })])).toBe(true);
    expect(attributesChanged(value.axes, [size, color])).toBe(false);
  });

  it('keeps saved ids and leaves new values without ids', () => {
    const axes = [{ id: 'attr-size', name: 'Size', values: [...generatorFromAttributes([size]).axes[0]!.values, { id: 'v9', label: 'XXL', code: 'XXL', color: null }] }];
    const inputs = toSaveInputs(axes, [size]);
    expect(inputs[0]?.id).toBe('attr-size');
    expect(inputs[0]?.values.map((value) => value.id ?? null)).toEqual(['size-s', 'size-xl', null]);
    expect(attributesChanged(axes, [size])).toBe(true);
  });

  it('merges pasted axes by name and maps rows by code after the save', () => {
    const pasted = [{ id: 'a1', name: 'size', values: [{ id: 'v1', label: 'XXL', code: 'XXL', color: null }] }];
    const merged = mergeForSave([size, color], pasted, false);
    expect(merged.map((axis) => axis.name)).toEqual(['Size', 'Color']);
    expect(merged[0]?.values.map((value) => value.code)).toEqual(['S', 'XL', 'XXL']);
    expect(newAxes(merged, [size, color])).toEqual([]);
    const saved: AttributeDTO[] = [{ ...size, values: [...size.values, { id: 'size-xxl', label: 'XXL', code: 'XXL', color: null }] }, color];
    expect(mapRowAttributes({ attributes: { a1: 'v1' } }, pasted, saved)).toEqual({ 'attr-size': 'size-xxl' });
    expect(rowExistsByCodes({ attributes: { a1: 'v1' } }, pasted, [size], [])).toBe(false);
  });

  it('refuses a removal that makes two variants the same', () => {
    const list = [variant('Small Brown', { 'attr-size': 'size-s', 'attr-color': 'color-br' }), variant('Small Yellow', { 'attr-size': 'size-s', 'attr-color': 'color-ye' })];
    expect(removalConflict(list, ['attr-color'])).toBe('Small Brown and Small Yellow would match. Keep this attribute or retire one of them first.');
    expect(removalConflict(list, ['attr-size'])).toBeNull();
  });

  it('suggests short unique keys', () => {
    expect(keyFromName('XXL Brown')).toBe('XXL-BRO');
    expect(uniqueKey('S-BR', new Set(['S-BR']))).toBe('S-BR-2');
  });
});
