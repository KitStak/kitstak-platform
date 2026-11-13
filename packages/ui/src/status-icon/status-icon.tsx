/**
 * Projects workflow status glyph by category (Linear style): dashed ring = to do, half-filled
 * ring = in progress, filled check = done, cross = cancelled, tinted with the status's label
 * color. Same SVG as Projects' `StatusIcon` (apps/projects/src/components/pm/status-icon.tsx,
 * keep in lockstep) so a task reads the same in Projects, CRM and WMS. Tokens only.
 */
import * as React from 'react';

export type StatusIconCategory = 'todo' | 'in_progress' | 'done' | 'cancelled';

const CATEGORY_LABELS: Readonly<Record<StatusIconCategory, string>> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** Label palette names are lowercase words with dashes ("blue", "dark-blue", "pink-light"). */
const isPaletteName = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^[a-z]+(?:-[a-z]+)*$/.test(value);

export interface StatusIconProps {
  readonly category: StatusIconCategory;
  /** Label palette name (`--label-<color>`); anything else falls back to the default icon tone. */
  readonly color?: string | null;
  readonly size?: number;
  readonly className?: string;
  /** Accessible name; defaults to the category label. Pass `null` to hide it from assistive tech. */
  readonly label?: string | null;
}

export function StatusIcon({ category, color, size = 14, className, label }: StatusIconProps) {
  const tone = isPaletteName(color) ? `var(--label-${color})` : 'var(--icon-default)';
  const a11y =
    label === null
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': label ?? CATEGORY_LABELS[category] } as const);
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    className,
    style: { flexShrink: 0 },
    'data-status-category': category,
    ...a11y,
  };
  switch (category) {
    case 'todo':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke={tone} strokeWidth="1.6" strokeDasharray="2.2 1.6" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" stroke={tone} strokeWidth="1.6" />
          <path d="M8 3.5a4.5 4.5 0 0 1 0 9Z" fill={tone} />
        </svg>
      );
    case 'done':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill={tone} />
          <path
            d="m5 8.2 2 2 4-4.2"
            stroke="var(--surface-panel)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill="var(--icon-default)" opacity="0.55" />
          <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="var(--surface-panel)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}
