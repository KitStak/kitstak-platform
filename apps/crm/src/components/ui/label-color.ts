import type { CSSProperties } from 'react';
import { LABEL_COLORS, type LabelColor } from '@/server/db/schema/column-types';

export { LABEL_COLORS, type LabelColor };

/** Human-friendly names for the label palette (used in pickers and aria labels). */
export const LABEL_COLOR_NAMES: Readonly<Record<LabelColor, string>> = {
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  gray: 'Gray',
  blue: 'Blue',
  'dark-blue': 'Dark blue',
  purple: 'Purple',
  pink: 'Pink',
  teal: 'Teal',
  yellow: 'Mustard',
  lime: 'Lime',
  brown: 'Brown',
  sky: 'Sky',
  berry: 'Berry',
  indigo: 'Indigo',
  peach: 'Peach',
  'green-light': 'Mint',
  'orange-light': 'Apricot',
  'red-light': 'Blush',
  'blue-light': 'Powder blue',
  'purple-light': 'Lavender',
  'pink-light': 'Rose',
  'teal-light': 'Aqua',
  'yellow-light': 'Butter',
};

const LABEL_COLOR_SET: ReadonlySet<string> = new Set(LABEL_COLORS);

export function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === 'string' && LABEL_COLOR_SET.has(value);
}

/** Coerce unknown input (e.g. persisted data) to a palette color, defaulting to gray. */
export function toLabelColor(value: unknown, fallback: LabelColor = 'gray'): LabelColor {
  return isLabelColor(value) ? value : fallback;
}

export interface LabelColorVars {
  readonly bg: string;
  readonly hover: string;
  readonly subtle: string;
  readonly fg: string;
  /** The color as readable text / icon on a panel (AA in both themes), e.g. group titles. */
  readonly text: string;
}

/** CSS variable references for a label color. */
export function labelColorVars(color: LabelColor): LabelColorVars {
  return {
    bg: `var(--label-${color})`,
    hover: `var(--label-${color}-hover)`,
    subtle: `var(--label-${color}-subtle)`,
    fg: `var(--label-${color}-fg)`,
    text: `var(--label-${color}-text)`,
  };
}

/**
 * Text colour for a status pill: the label's text colour with a share of ink mixed in
 * (`--pill-text-mix`, per theme) so it stays AA on its own `-subtle` tint for every label colour.
 * Works wherever `labelColorStyle` has set `--lc-text`.
 */
export const PILL_TEXT_CLASS = 'text-[color-mix(in_srgb,var(--lc-text),var(--text-primary)_var(--pill-text-mix))]';

/** Same colour as an inline CSS value, for a given palette colour. */
export function pillTextColor(color: LabelColor): string {
  return `color-mix(in srgb, var(--label-${color}-text), var(--text-primary) var(--pill-text-mix))`;
}

/**
 * Inline style exposing a label color as `--lc-bg/--lc-hover/--lc-subtle/--lc-fg/--lc-text` so components
 * can style states with plain classes, e.g. `bg-[var(--lc-bg)] hover:bg-[var(--lc-hover)]`.
 */
export function labelColorStyle(color: LabelColor): CSSProperties {
  const vars = labelColorVars(color);
  return {
    '--lc-bg': vars.bg,
    '--lc-hover': vars.hover,
    '--lc-subtle': vars.subtle,
    '--lc-fg': vars.fg,
    '--lc-text': vars.text,
  } as CSSProperties;
}

/**
 * Deterministic palette color for a string (chart series, workspace tiles). A short, calm set:
 * identity comes from names and initials, so this never needs the whole rainbow.
 */
const HASH_COLORS: readonly LabelColor[] = ['dark-blue', 'teal', 'indigo', 'brown', 'sky', 'gray'];

export function colorForString(value: string): LabelColor {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return HASH_COLORS[(hash >>> 0) % HASH_COLORS.length] ?? 'blue';
}
