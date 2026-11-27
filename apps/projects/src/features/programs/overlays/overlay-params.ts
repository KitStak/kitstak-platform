'use client';
/**
 * URL params of the program overlays (docs/programs/SPEC.md 4.8): `?log=2026-11-25[&run=][&builds=][&step=close]`,
 * `?plan=week|day[&from=]`, `?import=output|plan`, `?report=<runId|week:YYYY-MM-DD>`. Opening an
 * overlay keeps every other param (range, filters, the drawer), so closing it lands back where
 * the person was.
 *
 *   const overlays = useProgramOverlays();
 *   overlays.openLog({ date: '2026-11-25', run: 'run:abc:2026-11-25' });
 */
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { IsoDate } from '@/lib/program-types';

export const OVERLAY_KEYS = ['log', 'run', 'builds', 'step', 'plan', 'from', 'import', 'report', 'pkey'] as const;

export interface LogTarget {
  readonly date: IsoDate;
  readonly run?: string | null;
  readonly builds?: readonly string[] | null;
  readonly step?: 'close' | null;
  /** The program, when the page is not under /programs/KEY (Floor today, My Work). */
  readonly programKey?: string | null;
}

export function logHref(pathname: string, current: URLSearchParams, target: LogTarget): string {
  const search = new URLSearchParams(current.toString());
  for (const key of OVERLAY_KEYS) search.delete(key);
  search.set('log', target.date);
  if (target.run) search.set('run', target.run);
  if (target.builds?.length) search.set('builds', target.builds.join(','));
  if (target.step) search.set('step', target.step);
  if (target.programKey) search.set('pkey', target.programKey);
  return `${pathname}?${search.toString()}`;
}

export function useProgramOverlays() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const push = useCallback(
    (mutate: (search: URLSearchParams) => void) => {
      const search = new URLSearchParams(params?.toString() ?? '');
      for (const key of OVERLAY_KEYS) search.delete(key);
      mutate(search);
      const query = search.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const close = useCallback(() => push(() => undefined), [push]);
  const openLog = useCallback((target: LogTarget) => router.push(logHref(pathname, new URLSearchParams(params?.toString() ?? ''), target), { scroll: false }), [params, pathname, router]);
  const openPlanner = useCallback(
    (mode: 'week' | 'day' | '2weeks' = 'week', from?: IsoDate | null, programKey?: string | null) =>
      push((search) => {
        search.set('plan', mode);
        if (from) search.set('from', from);
        if (programKey) search.set('pkey', programKey);
      }),
    [push],
  );
  const openImport = useCallback((kind: 'output' | 'plan') => push((search) => search.set('import', kind)), [push]);
  const openReport = useCallback((target: string) => push((search) => search.set('report', target)), [push]);
  return { openLog, openPlanner, openImport, openReport, close };
}
