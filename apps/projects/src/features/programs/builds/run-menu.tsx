'use client';
/**
 * The run menu (docs/programs/SPEC.md 5.7): Log run, Close run, Move run to day, Copy run to,
 * Print build tickets, Share report, and under Danger, Cancel run. Used by the runs view, list
 * group headers, the range bar and Floor today.
 */
import { CalendarDays, CheckCheck, ClipboardPen, Copy, FileBarChart, MoreHorizontal, Printer, XCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, IconButton } from '@/components/ui';
import type { RunDTO } from '@/lib/program-types';
import { useCurrentProgram } from '../program-context';
import { useProgramOverlays } from '../overlays/overlay-params';
import { openBuildDialog } from './build-dialogs';

export function ticketsHref(programKey: string, opts: { readonly run?: string; readonly from?: string; readonly to?: string }): string {
  const search = new URLSearchParams();
  if (opts.run) search.set('run', opts.run);
  if (opts.from) search.set('from', opts.from);
  if (opts.to) search.set('to', opts.to);
  return `/programs/${encodeURIComponent(programKey)}/tickets?${search.toString()}`;
}

export function RunMenu({ run, label, size = 'sm' }: { readonly run: RunDTO; readonly label?: string; readonly size?: 'sm' | 'md' }) {
  const { key, capabilities, today } = useCurrentProgram();
  const overlays = useProgramOverlays();
  const logDate = run.date > today ? null : run.date;
  const open = run.builds - run.done - run.cancelled;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size={size} label={label ?? `Actions for ${run.name}`} icon={<MoreHorizontal aria-hidden />} onClick={(event) => event.stopPropagation()} data-testid="run-menu" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuLabel>Run</DropdownMenuLabel>
        {capabilities.canLog && logDate ? (
          <>
            <DropdownMenuItem icon={<ClipboardPen aria-hidden />} onSelect={() => overlays.openLog({ date: logDate, run: run.id })}>
              Log run
            </DropdownMenuItem>
            <DropdownMenuItem icon={<CheckCheck aria-hidden />} description={open > 0 ? `${open} ${open === 1 ? 'build is' : 'builds are'} still open` : 'Every build is closed'} onSelect={() => overlays.openLog({ date: logDate, run: run.id, step: 'close' })}>
              Close run
            </DropdownMenuItem>
          </>
        ) : null}
        {capabilities.canPlan ? (
          <>
            <DropdownMenuItem icon={<CalendarDays aria-hidden />} description="Closed days are refused" onSelect={() => openBuildDialog({ kind: 'move-run', run })}>
              Move run to day
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => openBuildDialog({ kind: 'copy-run', run })}>
              Copy run to
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Share</DropdownMenuLabel>
        <DropdownMenuItem icon={<Printer aria-hidden />} description="Opens a print page in a new tab" onSelect={() => window.open(ticketsHref(key, { run: run.id }), '_blank', 'noopener')}>
          Print build tickets
        </DropdownMenuItem>
        <DropdownMenuItem icon={<FileBarChart aria-hidden />} onSelect={() => overlays.openReport(run.id)}>
          Share report
        </DropdownMenuItem>
        {capabilities.canPlan && run.state !== 'cancelled' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Danger</DropdownMenuLabel>
            <DropdownMenuItem icon={<XCircle aria-hidden />} variant="danger" description="Cancels every build in this run that has no output" onSelect={() => openBuildDialog({ kind: 'cancel-run', run })}>
              Cancel run
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
