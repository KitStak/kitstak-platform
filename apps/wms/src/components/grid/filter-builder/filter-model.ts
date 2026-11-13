/**
 * Filter builder model: editor drafts ↔ grid-grammar filters, and chip text. PURE.
 */
import type { GridFilter } from '@/server/query/grid-query';
import { TEXT_FILTER_OP_LABELS, type FilterFieldDef, type TextFilterOp } from '../grid-types';
import {
  describeDateSpec,
  dateEditorToSpec,
  specToDateEditor,
  EMPTY_DATE_EDITOR,
  type DateEditorValue,
} from './date-presets';

export const EMPTY_OPTION_VALUE = '__empty__';

export type FilterDraft =
  | {
      readonly type: 'enum';
      readonly values: readonly string[];
      /** true = "not in" (exclude the checked values). */ readonly exclude?: boolean;
    }
  | { readonly type: 'text'; readonly op: TextFilterOp; readonly value: string }
  | { readonly type: 'number'; readonly min: number | null; readonly max: number | null }
  | { readonly type: 'boolean'; readonly value: boolean | null }
  | { readonly type: 'date'; readonly date: DateEditorValue };

export function emptyDraft(def: FilterFieldDef): FilterDraft {
  switch (def.type) {
    case 'enum':
      return { type: 'enum', values: [] };
    case 'text':
      return { type: 'text', op: 'ct', value: '' };
    case 'number':
      return { type: 'number', min: null, max: null };
    case 'boolean':
      return { type: 'boolean', value: null };
    case 'date':
      return { type: 'date', date: EMPTY_DATE_EDITOR };
  }
}

/** Existing filter → editor draft (falls back to an empty draft on op mismatch). */
export function filterToDraft(def: FilterFieldDef, filter: GridFilter | undefined): FilterDraft {
  if (!filter) return emptyDraft(def);
  switch (def.type) {
    case 'enum':
      if (filter.op === 'in') return { type: 'enum', values: filter.values };
      if (filter.op === 'nin') return { type: 'enum', values: filter.values, exclude: true };
      if (filter.op === 'empty') return { type: 'enum', values: [EMPTY_OPTION_VALUE] };
      return emptyDraft(def);
    case 'text':
      if (filter.op === 'eq' || filter.op === 'ct' || filter.op === 'sw' || filter.op === 'ew')
        return { type: 'text', op: filter.op, value: filter.value };
      if (filter.op === 'ex' || filter.op === 'empty') return { type: 'text', op: filter.op, value: '' };
      if (filter.op === 'nin') return { type: 'text', op: 'nin', value: filter.values.join(', ') };
      return emptyDraft(def);
    case 'number':
      if (filter.op === 'rng') return { type: 'number', min: toNum(filter.min), max: toNum(filter.max) };
      if (filter.op === 'eq') return { type: 'number', min: toNum(filter.value), max: toNum(filter.value) };
      return emptyDraft(def);
    case 'boolean':
      return filter.op === 'bool' ? { type: 'boolean', value: filter.value } : emptyDraft(def);
    case 'date':
      return filter.op === 'date' ? { type: 'date', date: specToDateEditor(filter.date) } : emptyDraft(def);
  }
}

function toNum(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type DraftResult =
  { readonly ok: true; readonly filter: GridFilter } | { readonly ok: false; readonly reason: string };

/** Draft → filter, or the reason Apply is disabled. */
export function draftToFilter(def: FilterFieldDef, draft: FilterDraft): DraftResult {
  const field = def.field;
  switch (draft.type) {
    case 'enum': {
      const values = draft.values.filter((v) => v !== EMPTY_OPTION_VALUE);
      const wantsEmpty = draft.values.includes(EMPTY_OPTION_VALUE);
      if (wantsEmpty && values.length === 0) return { ok: true, filter: { field, op: 'empty' } };
      if (values.length === 0) return { ok: false, reason: 'Select at least one value' };
      if (wantsEmpty) return { ok: false, reason: '"Empty" cannot be combined with other values' };
      return { ok: true, filter: { field, op: draft.exclude ? 'nin' : 'in', values } };
    }
    case 'text': {
      if (draft.op === 'ex' || draft.op === 'empty') return { ok: true, filter: { field, op: draft.op } };
      const value = draft.value.trim();
      if (!value) return { ok: false, reason: 'Enter a value' };
      if (draft.op === 'nin') {
        const values = value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        return values.length
          ? { ok: true, filter: { field, op: 'nin', values } }
          : { ok: false, reason: 'Enter a value' };
      }
      return { ok: true, filter: { field, op: draft.op, value } };
    }
    case 'number': {
      if (draft.min === null && draft.max === null)
        return { ok: false, reason: 'Enter a minimum or a maximum' };
      if (draft.min !== null && draft.max !== null && draft.min > draft.max)
        return { ok: false, reason: 'Min must not exceed Max' };
      return {
        ok: true,
        filter: {
          field,
          op: 'rng',
          ...(draft.min !== null ? { min: String(draft.min) } : {}),
          ...(draft.max !== null ? { max: String(draft.max) } : {}),
        },
      };
    }
    case 'boolean':
      if (draft.value === null) return { ok: false, reason: 'Choose Yes or No' };
      return { ok: true, filter: { field, op: 'bool', value: draft.value } };
    case 'date': {
      const spec = dateEditorToSpec(draft.date);
      if (!spec)
        return { ok: false, reason: draft.date.preset ? 'Complete the date range' : 'Choose a date option' };
      return { ok: true, filter: { field, op: 'date', date: spec } };
    }
  }
}

function optionLabel(def: FilterFieldDef | undefined, value: string): string {
  return def?.options?.find((o) => o.value === value)?.label ?? value;
}

/** Second line of a chip: the value summary. */
export function describeFilterValue(filter: GridFilter, def?: FilterFieldDef): string {
  switch (filter.op) {
    case 'in':
      return filter.values.map((v) => optionLabel(def, v)).join(', ');
    case 'nin':
      return `Not ${filter.values.map((v) => optionLabel(def, v)).join(', ')}`;
    case 'eq':
      return def?.type === 'number' ? `= ${filter.value}` : `${TEXT_FILTER_OP_LABELS.eq} "${filter.value}"`;
    case 'ct':
    case 'sw':
    case 'ew':
      return `${TEXT_FILTER_OP_LABELS[filter.op]} "${filter.value}"`;
    case 'ex':
      return TEXT_FILTER_OP_LABELS.ex;
    case 'empty':
      return TEXT_FILTER_OP_LABELS.empty;
    case 'rng':
      if (filter.min !== undefined && filter.max !== undefined) return `${filter.min} to ${filter.max}`;
      return filter.min !== undefined ? `≥ ${filter.min}` : `≤ ${filter.max ?? ''}`;
    case 'bool':
      return filter.value ? 'Yes' : 'No';
    case 'date':
      return describeDateSpec(filter.date);
  }
}

export interface FilterChipModel {
  readonly key: string;
  readonly field: string;
  readonly label: string;
  readonly value: string;
}

export function toChips(
  filters: readonly GridFilter[],
  fields: readonly FilterFieldDef[],
): readonly FilterChipModel[] {
  return filters.map((filter, index) => {
    const def = fields.find((f) => f.field === filter.field);
    return {
      key: `${filter.field}:${index}`,
      field: filter.field,
      label: def?.label ?? filter.field,
      value: describeFilterValue(filter, def),
    };
  });
}

/** Splits chips into visible ones and the "+N" overflow. */
export function splitChips<T>(
  chips: readonly T[],
  max: number,
): { readonly visible: readonly T[]; readonly overflow: readonly T[] } {
  return { visible: chips.slice(0, max), overflow: chips.slice(max) };
}

/** Field list filter for the popover search box. */
export function searchFields(fields: readonly FilterFieldDef[], query: string): readonly FilterFieldDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return fields;
  return fields.filter((f) => f.label.toLowerCase().includes(q) || f.field.toLowerCase().includes(q));
}

/** Pinned (favourite) fields first, preserving definition order otherwise. */
export function orderByPinned(
  fields: readonly FilterFieldDef[],
  pinned: readonly string[],
): readonly FilterFieldDef[] {
  const set = new Set(pinned);
  return [...fields.filter((f) => set.has(f.field)), ...fields.filter((f) => !set.has(f.field))];
}
