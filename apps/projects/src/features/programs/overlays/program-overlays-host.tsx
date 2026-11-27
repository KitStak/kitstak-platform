'use client';
/**
 * Opens the program overlays from the URL on any page (docs/programs/SPEC.md 5.5, mounted in
 * `features/shell/app-shell.tsx`): `?log` (Log output), `?plan` (Build planner), `?import`
 * (Import output or plan) and `?report` (Share a production report). The program comes from the
 * path (`/programs/KEY/...`) or from `pkey` on pages outside a program (Floor today, My Work).
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { IsoDate } from '@/lib/program-types';
import { LogOutputDialog } from '../log-output/log-output-dialog';
import { BuildPlanner } from '../planner/build-planner';
import { ImportDialog } from '../imports/import-dialog';
import { ShareReportDialog } from '../reports/share-report-dialog';
import { OVERLAY_KEYS } from './overlay-params';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(['new', 'today']);

function programKeyOf(pathname: string, params: URLSearchParams): string | null {
  const fromParam = params.get('pkey');
  if (fromParam && /^[A-Z][A-Z0-9]{1,9}$/.test(fromParam)) return fromParam;
  const match = /^\/programs\/([^/?#]+)/.exec(pathname);
  const key = match?.[1] ? decodeURIComponent(match[1]) : null;
  return key && !RESERVED.has(key) ? key.toUpperCase() : null;
}

export function ProgramOverlaysHost() {
  const params = useSearchParams();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const search = new URLSearchParams(params?.toString() ?? '');
  const key = programKeyOf(pathname, search);

  const replace = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params?.toString() ?? '');
    mutate(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const close = () => replace((next) => OVERLAY_KEYS.forEach((name) => next.delete(name)));

  if (!key) return null;
  const log = search.get('log');
  const plan = search.get('plan');
  const importKind = search.get('import');
  const report = search.get('report');

  if (log && ISO.test(log)) {
    const builds = search.get('builds');
    return (
      <LogOutputDialog
        key={`${key}:${log}`}
        programKey={key}
        date={log}
        runId={search.get('run')}
        buildIds={builds ? builds.split(',').filter(Boolean) : null}
        startOnClose={search.get('step') === 'close'}
        onDateChange={(date: IsoDate) =>
          replace((next) => {
            next.set('log', date);
            next.delete('run');
            next.delete('builds');
            next.delete('step');
          })
        }
        onClose={close}
      />
    );
  }
  if (plan === 'week' || plan === 'day' || plan === '2weeks') {
    const from = search.get('from');
    return <BuildPlanner key={key} programKey={key} mode={plan} from={from && ISO.test(from) ? from : null} onClose={close} />;
  }
  if (importKind === 'output' || importKind === 'plan') return <ImportDialog key={`${key}:${importKind}`} programKey={key} kind={importKind} onClose={close} />;
  if (report) return <ShareReportDialog key={`${key}:${report}`} programKey={key} target={report} onClose={close} />;
  return null;
}
