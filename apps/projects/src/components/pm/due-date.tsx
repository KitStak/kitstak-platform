'use client';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { formatDue, todayIso } from '@/lib/dates';

/** Friendly due date ("Today", "Fri", "Mar 3"); red when overdue, amber when due today. */
export function DueDate({
  date,
  done = false,
  showIcon = true,
  className,
}: {
  readonly date: string | null;
  readonly done?: boolean;
  readonly showIcon?: boolean;
  readonly className?: string;
}) {
  if (!date) return null;
  const today = todayIso();
  const overdue = !done && date < today;
  const dueToday = !done && date === today;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-xs tabular-nums',
        overdue ? 'font-medium text-danger-text' : dueToday ? 'font-medium text-warning-text' : 'text-fg-secondary',
        done && 'text-fg-muted',
        className,
      )}
      title={overdue ? `Overdue (due ${date})` : `Due ${date}`}
    >
      {showIcon ? <CalendarDays aria-hidden className="size-3.5" /> : null}
      {formatDue(date, today)}
    </span>
  );
}
