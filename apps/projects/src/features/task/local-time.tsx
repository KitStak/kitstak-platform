'use client';
/**
 * <LocalTime> shows a friendly relative time ("5 minutes ago") with the exact local date and
 * time on hover. The hover text is added after hydration so the server (UTC) and the browser
 * (your time zone) never disagree.
 */
import { useSyncExternalStore } from 'react';
import { formatRelative } from '@/lib/dates';

const noop = () => () => undefined;

/** False during SSR and hydration, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function LocalTime({
  iso,
  children,
  className,
}: {
  readonly iso: string;
  readonly children?: React.ReactNode;
  readonly className?: string;
}) {
  const hydrated = useHydrated();
  return (
    <time
      dateTime={iso}
      title={hydrated ? new Date(iso).toLocaleString() : undefined}
      className={className}
      suppressHydrationWarning
    >
      {children ?? formatRelative(iso)}
    </time>
  );
}
