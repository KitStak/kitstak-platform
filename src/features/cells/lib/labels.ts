/**
 * Pure helpers for status / dropdown labels (column settings `{ labels: Label[] }`).
 * Labels are keyed by a stable id, so renames and reorders never touch stored cell values.
 */
import { LABEL_COLORS, type Label, type LabelColor } from '@/server/db/schema/column-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const COLOR_SET: ReadonlySet<string> = new Set(LABEL_COLORS);

function toLabel(raw: unknown, index: number): Label | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const color = typeof raw.color === 'string' && COLOR_SET.has(raw.color) ? (raw.color as LabelColor) : 'gray';
  return {
    id: raw.id,
    name: raw.name,
    color,
    position: typeof raw.position === 'number' ? raw.position : index,
    ...(raw.isDone === true && { isDone: true }),
    ...(raw.isDefault === true && { isDefault: true }),
  };
}

/**
 * Palette order for the label color grid (8 columns): each column is one hue family —
 * vivid on top, the deeper / neighbouring tone in the middle, the light tint below.
 */
// prettier-ignore
export const LABEL_PALETTE_ORDER: readonly LabelColor[] = [
  'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink',
  'berry', 'peach', 'brown', 'lime', 'sky', 'dark-blue', 'indigo', 'gray',
  'red-light', 'orange-light', 'yellow-light', 'green-light', 'teal-light', 'blue-light', 'purple-light', 'pink-light',
];

/** Labels of a status/dropdown column in board order (position ascending). */
export function labelsFromSettings(settings: unknown): Label[] {
  if (!isRecord(settings) || !Array.isArray(settings.labels)) return [];
  return settings.labels
    .map((raw, index) => toLabel(raw, index))
    .filter((label): label is Label => label !== null)
    .sort((a, b) => a.position - b.position);
}

export function findLabel(labels: readonly Label[], id: unknown): Label | undefined {
  return typeof id === 'string' ? labels.find((label) => label.id === id) : undefined;
}

/** The label rendered for empty status cells (never stored). */
export function defaultLabel(labels: readonly Label[]): Label | undefined {
  return labels.find((label) => label.isDefault);
}

/** Labels a user can pick (the default/blank label is offered separately as "clear"). */
export function pickableLabels(labels: readonly Label[]): Label[] {
  return labels.filter((label) => !label.isDefault);
}

export function doneLabelIds(labels: readonly Label[]): ReadonlySet<string> {
  return new Set(labels.filter((label) => label.isDone).map((label) => label.id));
}

/** Case-insensitive name filter that keeps board order. */
export function filterLabels(labels: readonly Label[], query: string): Label[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...labels];
  return labels.filter((label) => label.name.toLowerCase().includes(needle));
}

/** Short unique label id (matches the settings schema `^[A-Za-z0-9_-]+$`). */
export function newLabelId(existing: readonly Label[], random: () => number = Math.random): string {
  const taken = new Set(existing.map((label) => label.id));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = `l_${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, '0')}`;
    if (!taken.has(id)) return id;
  }
  return `l_${Date.now().toString(36)}`;
}

/** First palette color not used yet (falls back to cycling the palette). */
export function nextLabelColor(labels: readonly Label[]): LabelColor {
  const used = new Set(labels.map((label) => label.color));
  const preferred = LABEL_COLORS.filter((color) => color !== 'gray');
  return preferred.find((color) => !used.has(color)) ?? preferred[labels.length % preferred.length] ?? 'blue';
}

/** Rewrite positions to 0..n-1 in array order (immutable). */
export function normalizePositions(labels: readonly Label[]): Label[] {
  return labels.map((label, index) => ({ ...label, position: index }));
}

/** Move a label from one index to another (immutable). */
export function moveLabel(labels: readonly Label[], from: number, to: number): Label[] {
  if (from === to || from < 0 || to < 0 || from >= labels.length || to >= labels.length) return [...labels];
  const next = [...labels];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return normalizePositions(next);
}

/** Exactly one label (or none) may be marked done for status columns. */
export function setDoneLabel(labels: readonly Label[], id: string | null): Label[] {
  return labels.map((label) => {
    const rest: Label = { id: label.id, name: label.name, color: label.color, position: label.position };
    const withDefault: Label = label.isDefault ? { ...rest, isDefault: true } : rest;
    return label.id === id ? { ...withDefault, isDone: true } : withDefault;
  });
}

/** Count how many items reference each label id in the given column. */
export function countLabelUsage(
  items: readonly { readonly values: Record<string, unknown> }[],
  columnKey: string,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: unknown) => {
    if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  for (const item of items) {
    const value = item.values[columnKey];
    if (!isRecord(value)) continue;
    if ('labelId' in value) bump(value.labelId);
    if (Array.isArray(value.labelIds)) value.labelIds.forEach(bump);
  }
  return counts;
}

export interface LabelValidation {
  readonly ok: boolean;
  /** label id → message */
  readonly errors: ReadonlyMap<string, string>;
}

/** Duplicate (case-insensitive) or over-long names are rejected; blank is only allowed on the default. */
export function validateLabels(labels: readonly Label[], kind: 'status' | 'dropdown'): LabelValidation {
  const errors = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const label of labels) {
    const name = label.name.trim();
    if (name.length > 100) errors.set(label.id, 'Keep label names under 100 characters');
    else if (!name && !label.isDefault && kind === 'dropdown') errors.set(label.id, 'Give this label a name');
    const key = name.toLowerCase();
    if (key) {
      const other = seen.get(key);
      if (other) errors.set(label.id, 'Another label already has this name');
      else seen.set(key, label.id);
    }
  }
  return { ok: errors.size === 0, errors };
}

/** Value of a status cell. */
export function statusLabelId(value: unknown): string | null {
  return isRecord(value) && typeof value.labelId === 'string' ? value.labelId : null;
}

/** Value of a dropdown cell. */
export function dropdownLabelIds(value: unknown): string[] {
  return isRecord(value) && Array.isArray(value.labelIds)
    ? value.labelIds.filter((id): id is string => typeof id === 'string')
    : [];
}
