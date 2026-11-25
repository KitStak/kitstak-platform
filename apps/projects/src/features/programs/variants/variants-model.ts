/**
 * Pure helpers for the Variants tab (docs/programs/SPEC.md 5.11): seeding the matrix generator
 * with the program's saved attributes, the attributes payload (saved ids kept, new ones left
 * without ids), mapping new combinations to saved attribute ids after a save, and the checks that
 * keep variants unique when an attribute is removed.
 */
import type { AttributeAxisInput, AttributeDTO, VariantDTO } from '@/lib/program-types';
import { EMPTY_GENERATOR, type EditorAxis, type EditorRow, type VariantGeneratorValue } from '../editors/variant-model';

/** The generator value for the saved attributes (real ids, so existing combinations match). */
export function generatorFromAttributes(attributes: readonly AttributeDTO[]): VariantGeneratorValue {
  return {
    ...EMPTY_GENERATOR,
    axes: attributes.map((attribute) => ({ id: attribute.id, name: attribute.name, values: attribute.values.map((value) => ({ id: value.id, label: value.label, code: value.code, color: value.color })) })),
  };
}

/** Existing variants in the shape the generator checks against. */
export function existingForGenerator(variants: readonly VariantDTO[]) {
  return variants.map((variant) => ({ key: variant.key, name: variant.name, sku: variant.sku, attributes: { ...variant.attributes } }));
}

function sameCombo(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const left = Object.entries(a).filter(([, value]) => Boolean(value));
  const right = Object.entries(b).filter(([, value]) => Boolean(value));
  return left.length === right.length && left.every(([axis, value]) => b[axis] === value);
}

/** True when a generated row is a variant the program already has. */
export function isExistingRow(row: Pick<EditorRow, 'attributes'>, variants: readonly Pick<VariantDTO, 'attributes'>[]): boolean {
  return variants.some((variant) => sameCombo(row.attributes, variant.attributes));
}

/** Axes that are new (not saved yet) in the generator value. */
export function newAxes(axes: readonly EditorAxis[], attributes: readonly AttributeDTO[]): EditorAxis[] {
  const saved = new Set(attributes.map((attribute) => attribute.id));
  return axes.filter((axis) => !saved.has(axis.id) && axis.values.length > 0);
}

/** Saved attributes the generator value no longer has. */
export function removedAttributes(axes: readonly EditorAxis[], attributes: readonly AttributeDTO[]): AttributeDTO[] {
  const kept = new Set(axes.map((axis) => axis.id));
  return attributes.filter((attribute) => !kept.has(attribute.id));
}

/** True when the generator changes the saved attributes (names, values, order, added or removed). */
export function attributesChanged(axes: readonly EditorAxis[], attributes: readonly AttributeDTO[]): boolean {
  const live = axes.filter((axis) => axis.values.length > 0);
  if (live.length !== attributes.length) return true;
  return live.some((axis, index) => {
    const saved = attributes[index];
    if (!saved || saved.id !== axis.id || saved.name !== axis.name.trim() || saved.values.length !== axis.values.length) return true;
    return axis.values.some((value, valueIndex) => {
      const savedValue = saved.values[valueIndex];
      return !savedValue || savedValue.id !== value.id || savedValue.label !== value.label || savedValue.code !== value.code || (savedValue.color ?? null) !== (value.color ?? null);
    });
  });
}

/** The attributes payload: saved axes and values keep their ids, new ones go without. */
export function toSaveInputs(axes: readonly EditorAxis[], attributes: readonly AttributeDTO[]): AttributeAxisInput[] {
  const savedAxes = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  return axes
    .filter((axis) => axis.values.length > 0)
    .map((axis) => {
      const saved = savedAxes.get(axis.id);
      const savedValues = new Set(saved?.values.map((value) => value.id) ?? []);
      return {
        ...(saved ? { id: saved.id } : {}),
        name: axis.name.trim(),
        values: axis.values.map((value) => ({ ...(savedValues.has(value.id) ? { id: value.id } : {}), label: value.label.trim(), code: value.code.toUpperCase(), color: value.color })),
      };
    });
}

/**
 * Maps a generated row's attributes (editor ids) to the saved ids, by attribute name and value
 * code. Returns null when a value cannot be found (the save did not keep it).
 */
export function mapRowAttributes(row: Pick<EditorRow, 'attributes'>, axes: readonly EditorAxis[], saved: readonly AttributeDTO[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [axisId, valueId] of Object.entries(row.attributes)) {
    const axis = axes.find((entry) => entry.id === axisId);
    const value = axis?.values.find((entry) => entry.id === valueId);
    if (!axis || !value) return null;
    const attribute = saved.find((entry) => entry.name.trim().toLowerCase() === axis.name.trim().toLowerCase());
    const savedValue = attribute?.values.find((entry) => entry.code.toUpperCase() === value.code.toUpperCase());
    if (!attribute || !savedValue) return null;
    out[attribute.id] = savedValue.id;
  }
  return out;
}

/**
 * The message when removing attributes would make two variants the same:
 * "Small Brown and Small Brown would match. Keep this attribute or retire one of them first."
 * Null when the remaining combinations stay unique.
 */
export function removalConflict(variants: readonly Pick<VariantDTO, 'name' | 'attributes' | 'status'>[], removedIds: readonly string[]): string | null {
  if (removedIds.length === 0) return null;
  const seen = new Map<string, string>();
  for (const variant of variants.filter((entry) => entry.status === 'active')) {
    const rest = Object.entries(variant.attributes)
      .filter(([attributeId]) => !removedIds.includes(attributeId))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([a, v]) => `${a}=${v}`)
      .join('|');
    const other = seen.get(rest);
    if (other !== undefined) return `${other} and ${variant.name} would match. Keep this attribute or retire one of them first.`;
    seen.set(rest, variant.name);
  }
  return null;
}

/** "3 new variants" / "1 new variant" / "No new variants". */
export function newCountText(count: number): string {
  if (count === 0) return 'No new variants';
  return count === 1 ? '1 new variant' : `${count} new variants`;
}

/** A short variant key from a name: "Small Brown" becomes "S-BR"-like "SMALL-BROWN" capped to 16. */
export function keyFromName(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const short = words.length === 1 ? (words[0] as string).slice(0, 8) : words.map((word) => word.slice(0, words.length > 3 ? 1 : 3)).join('-');
  return short.slice(0, 16);
}

/** Next free key: KEY, KEY-2, KEY-3 ... */
export function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!base) return base;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 16 - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}

/**
 * The full attribute list to save. With `replace` (Edit attributes) the editor axes are the whole
 * list. Without it (Add variants, Paste a list) saved attributes stay, pasted axes merge into a
 * saved one with the same name (new value codes are added) and other axes are added at the end.
 */
export function mergeForSave(attributes: readonly AttributeDTO[], axes: readonly EditorAxis[], replace: boolean): EditorAxis[] {
  if (replace) return axes.filter((axis) => axis.values.length > 0).map((axis) => ({ ...axis, values: [...axis.values] }));
  const out: EditorAxis[] = attributes.map((attribute) => ({ id: attribute.id, name: attribute.name, values: attribute.values.map((value) => ({ id: value.id, label: value.label, code: value.code, color: value.color })) }));
  for (const axis of axes.filter((entry) => entry.values.length > 0)) {
    const index = out.findIndex((entry) => entry.id === axis.id || entry.name.trim().toLowerCase() === axis.name.trim().toLowerCase());
    if (index < 0) {
      out.push({ ...axis, values: [...axis.values] });
      continue;
    }
    const target = out[index] as EditorAxis;
    const codes = new Set(target.values.map((value) => value.code.toUpperCase()));
    out[index] = { ...target, values: [...target.values, ...axis.values.filter((value) => !codes.has(value.code.toUpperCase()))] };
  }
  return out;
}

/** True when a generated row matches a variant the program has, comparing attribute names and value codes. */
export function rowExistsByCodes(row: Pick<EditorRow, 'attributes'>, axes: readonly EditorAxis[], attributes: readonly AttributeDTO[], variants: readonly Pick<VariantDTO, 'attributes'>[]): boolean {
  const mapped = mapRowAttributes(row, axes, attributes);
  return mapped !== null && variants.some((variant) => sameCombo(mapped, variant.attributes));
}
