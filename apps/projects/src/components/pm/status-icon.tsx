/**
 * Workflow status glyph by category (Linear-style): empty ring = to do, half ring = in progress,
 * check = done, cross = cancelled. Tinted with the status color.
 */
import type { StatusCategory } from '@/lib/constants';
import { STATUS_CATEGORY_LABELS } from '@/lib/constants';
import { isLabelColor } from '@/components/ui/label-color';
import { cn } from '@/components/ui/cn';

export interface StatusIconProps {
  readonly category: StatusCategory;
  readonly color?: string | null;
  readonly size?: number;
  readonly className?: string;
  /** Accessible name; defaults to the category label. */
  readonly label?: string;
}

export function StatusIcon({ category, color, size = 14, className, label }: StatusIconProps) {
  const tone = isLabelColor(color) ? `var(--label-${color})` : 'var(--icon-default)';
  const common = { width: size, height: size, viewBox: '0 0 16 16', className: cn('shrink-0', className), role: 'img' as const, 'aria-label': label ?? STATUS_CATEGORY_LABELS[category] };
  switch (category) {
    case 'todo':
      return (
        <svg {...common} fill="none">
          <circle cx="8" cy="8" r="6" stroke={tone} strokeWidth="1.6" strokeDasharray="2.2 1.6" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...common} fill="none">
          <circle cx="8" cy="8" r="6" stroke={tone} strokeWidth="1.6" />
          <path d="M8 3.5a4.5 4.5 0 0 1 0 9Z" fill={tone} />
        </svg>
      );
    case 'done':
      return (
        <svg {...common} fill="none">
          <circle cx="8" cy="8" r="7" fill={tone} />
          <path d="m5 8.2 2 2 4-4.2" stroke="var(--surface-panel)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...common} fill="none">
          <circle cx="8" cy="8" r="7" fill="var(--icon-default)" opacity="0.55" />
          <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="var(--surface-panel)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}
