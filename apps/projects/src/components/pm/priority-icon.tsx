/** Priority glyph: urgent = filled alert square, high/medium/low = signal bars, none = dashes. */
import { PRIORITY_LABELS, type Priority } from '@/lib/constants';
import { cn } from '@/components/ui/cn';

export const PRIORITY_COLORS: Readonly<Record<Priority, string>> = {
  urgent: 'var(--danger)',
  high: 'var(--label-orange)',
  medium: 'var(--label-yellow)',
  low: 'var(--label-blue)',
  none: 'var(--icon-default)',
};

export function PriorityIcon({ priority, size = 14, className }: { readonly priority: Priority; readonly size?: number; readonly className?: string }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', className: cn('shrink-0', className), role: 'img' as const, 'aria-label': PRIORITY_LABELS[priority] };
  if (priority === 'urgent') {
    return (
      <svg {...common}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={PRIORITY_COLORS.urgent} />
        <path d="M8 4.5v4.2" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="1.05" fill="white" />
      </svg>
    );
  }
  if (priority === 'none') {
    return (
      <svg {...common}>
        {[2.5, 7, 11.5].map((x) => (
          <rect key={x} x={x} y="7.2" width="2.4" height="1.6" rx="0.8" fill="var(--icon-default)" opacity="0.6" />
        ))}
      </svg>
    );
  }
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
  return (
    <svg {...common}>
      {[0, 1, 2].map((index) => (
        <rect
          key={index}
          x={2 + index * 4.5}
          y={10 - index * 3}
          width="3"
          height={4 + index * 3}
          rx="1"
          fill={index < level ? PRIORITY_COLORS[priority] : 'var(--border-strong)'}
        />
      ))}
    </svg>
  );
}
