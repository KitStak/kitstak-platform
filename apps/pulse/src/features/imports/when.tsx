'use client';
import { cn } from '@/components/ui/cn';

const FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Nov 18, 2026, 9:14 AM" in the reader's own time zone. */
export function formatWhen(iso: string | null | undefined, dayOnly = false): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (dayOnly ? DAY : FORMAT).format(date);
}

/** A moment in time. The server and the browser may sit in different time zones, so the text may differ on first paint. */
export function When({ iso, dayOnly, className }: { readonly iso: string | null | undefined; readonly dayOnly?: boolean; readonly className?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} suppressHydrationWarning className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatWhen(iso, dayOnly)}
    </time>
  );
}
