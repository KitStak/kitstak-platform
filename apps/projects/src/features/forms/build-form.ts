/**
 * Build forms (docs/programs/SPEC.md 5.17): a form on a program whose settings map a Variant
 * question (a choice list of the program's active variants, or a SKU typed in), a Qty question and
 * a Date question. Each response makes a build through `createBuild` with `planned_from = 'form'`.
 * Pure helpers, unit tested.
 */
import type { FormField, FormSettings } from '@/lib/form-types';
import { newFieldId } from './form-starters';

export interface BuildMapping {
  readonly variantFieldId?: string;
  readonly qtyFieldId?: string;
  readonly dateFieldId?: string;
}

export type BuildFormSettings = FormSettings & { readonly build?: BuildMapping };

export interface FormProgram {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly color: string | null;
  readonly icon: string | null;
  readonly unit: { readonly singular: string; readonly plural: string };
  readonly variants: readonly { readonly id: string; readonly name: string; readonly sku: string | null }[];
}

export type VariantQuestion = 'list' | 'sku';

/** The starting questions and mapping of a build form for one program. */
export function buildFormStarter(program: FormProgram, variantQuestion: VariantQuestion): { fields: FormField[]; settings: BuildFormSettings } {
  const variant: FormField =
    variantQuestion === 'list'
      ? { id: newFieldId(), label: `Which ${program.unit.singular}?`, type: 'select', required: true, options: program.variants.map((entry) => ({ id: newFieldId(), label: entry.name })), mapTo: null }
      : { id: newFieldId(), label: 'SKU', type: 'short_text', required: true, helpText: `The SKU of the ${program.unit.singular}, like ${program.variants[0]?.sku ?? `${program.key}-S-BRN`}.`, mapTo: null };
  const qty: FormField = { id: newFieldId(), label: `How many ${program.unit.plural}?`, type: 'number', required: true, mapTo: null };
  const date: FormField = { id: newFieldId(), label: 'For which day?', type: 'date', required: false, helpText: 'Leave empty for the next work day.', mapTo: null };
  const notes: FormField = { id: newFieldId(), label: 'Notes for the floor', type: 'long_text', required: false, mapTo: 'description' };
  return {
    fields: [variant, qty, date, notes],
    settings: { build: { variantFieldId: variant.id, qtyFieldId: qty.id, dateFieldId: date.id }, confirmationMessage: `Thanks! Your ${program.unit.plural} are on the plan.` },
  };
}

/** Questions that can answer each part of the mapping. */
export function mappingChoices(fields: readonly FormField[]): { variant: FormField[]; qty: FormField[]; date: FormField[] } {
  return {
    variant: fields.filter((field) => field.type === 'select' || field.type === 'short_text'),
    qty: fields.filter((field) => field.type === 'number'),
    date: fields.filter((field) => field.type === 'date'),
  };
}

/** What is missing before the form can make builds, or null. */
export function mappingProblem(fields: readonly FormField[], mapping: BuildMapping | undefined): string | null {
  if (!mapping?.variantFieldId || !fields.some((field) => field.id === mapping.variantFieldId)) return 'Pick the question that names the kit.';
  if (!mapping.qtyFieldId || !fields.some((field) => field.id === mapping.qtyFieldId)) return 'Pick the question that says how many.';
  const qty = fields.find((field) => field.id === mapping.qtyFieldId);
  if (qty && !qty.required) return 'Make the how many question required.';
  return null;
}

/** The variant choice list brought up to date with the program's active variants (kept answers stay). */
export function syncVariantOptions(field: FormField, variants: FormProgram['variants']): FormField {
  if (field.type !== 'select') return field;
  const existing = new Map((field.options ?? []).map((option) => [option.label.toLowerCase(), option]));
  return { ...field, options: variants.map((variant) => existing.get(variant.name.toLowerCase()) ?? { id: newFieldId(), label: variant.name }) };
}
