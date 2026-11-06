/** Series colors for widgets: label palette tokens (never hex), with a stable fallback cycle. */
import { isLabelColor, type LabelColor } from '@/components/ui';

/** Ordered fallback for series without a semantic color (people, boards, text values). */
export const SERIES_CYCLE: readonly LabelColor[] = [
  'blue',
  'purple',
  'teal',
  'orange',
  'pink',
  'indigo',
  'green',
  'sky',
  'berry',
  'lime',
  'brown',
  'dark-blue',
];

export function seriesColor(color: string | undefined, index: number, overrides?: Readonly<Record<string, string>>, key?: string): LabelColor {
  const override = key ? overrides?.[key] : undefined;
  if (isLabelColor(override)) return override;
  if (isLabelColor(color)) return color;
  return SERIES_CYCLE[index % SERIES_CYCLE.length] as LabelColor;
}

/** CSS color value of a palette color (works in SVG `fill`/`stroke` style props). */
export function cssColor(color: LabelColor): string {
  return `var(--label-${color})`;
}

export function cssSubtle(color: LabelColor): string {
  return `var(--label-${color}-subtle)`;
}

export function cssFg(color: LabelColor): string {
  return `var(--label-${color}-fg)`;
}
