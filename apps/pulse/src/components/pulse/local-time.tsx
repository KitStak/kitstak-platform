'use client';
/**
 * Moments in time, shown in the reader's own time zone without a hydration mismatch.
 *
 * The server does not know the reader's time zone or clock, so "4 days ago" or "3:42 PM" worked
 * out there can differ from what the browser works out. React then throws the server HTML away
 * and logs a hydration error. These helpers render one fixed text (UTC, from the timestamp alone)
 * on the server and while the page hydrates, then switch to local time right after.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { formatRelative } from '@/lib/dates';

const subscribe = () => () => undefined;

/** False on the server and during hydration, true from the first render after it. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export type TimeStyle = 'day' | 'dayTime' | 'time' | 'short';

const OPTIONS: Readonly<Record<TimeStyle, Intl.DateTimeFormatOptions>> = {
  day: { month: 'short', day: 'numeric', year: 'numeric' },
  dayTime: { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  time: { hour: 'numeric', minute: '2-digit' },
  short: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(style: TimeStyle, utc: boolean): Intl.DateTimeFormat {
  const key = `${style}:${utc ? 'utc' : 'local'}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { ...OPTIONS[style], ...(utc ? { timeZone: 'UTC' } : {}) });
    formatters.set(key, found);
  }
  return found;
}

/**
 * "Nov 18, 2026, 3:42 PM" from a timestamp. With `local` false the text is in UTC and is the same
 * on every machine: pass `useHydrated()` so the first paint matches the server.
 */
export function formatMoment(iso: string | null | undefined, style: TimeStyle, local: boolean): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatter(style, !local).format(date);
}

/** A moment in the reader's own time zone: "Nov 18, 2026, 3:42 PM". */
export function LocalTime({ iso, style = 'dayTime', className }: { readonly iso: string | null | undefined; readonly style?: TimeStyle; readonly className?: string }) {
  const hydrated = useHydrated();
  if (!iso) return null;
  return (
    <time dateTime={iso} className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatMoment(iso, style, hydrated)}
    </time>
  );
}

/** "5 minutes ago", "yesterday", "Mar 3", kept fresh while the page stays open. The first paint shows the day. */
export function RelativeTime({ iso, className }: { readonly iso: string | null | undefined; readonly className?: string }) {
  const hydrated = useHydrated();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!iso) return null;
  return (
    <time dateTime={iso} title={formatMoment(iso, 'dayTime', hydrated)} className={className}>
      {hydrated ? formatRelative(iso) : formatMoment(iso, 'day', false)}
    </time>
  );
}
