'use client';
import { LocalTime } from '@/components/pulse/local-time';

const FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Nov 18, 2026, 9:14 AM" in the reader's own time zone. */
export function formatWhen(iso: string | null | undefined, dayOnly = false): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (dayOnly ? DAY : FORMAT).format(date);
}

/**
 * A moment in time, in the reader's own time zone. The server does not know that zone, so the
 * first paint is in UTC and the text switches to local time as soon as the page is live.
 */
export function When({ iso, dayOnly, className }: { readonly iso: string | null | undefined; readonly dayOnly?: boolean; readonly className?: string }) {
  return <LocalTime iso={iso} style={dayOnly ? 'day' : 'dayTime'} className={className} />;
}
