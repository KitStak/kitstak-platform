'use client';
/**
 * The program `...` menu (docs/programs/SPEC.md 5.5). Labeled sections, destructive items last
 * under Danger, and a one line description under every item that changes money or history.
 *
 * Sections: Create, Statement (This month, Last month, Pick a month; View, CSV and PDF per row;
 * Close last month for owners), Connect (Pulse job), Program, Danger.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  CalendarCheck2,
  CalendarX2,
  Copy,
  Eye,
  FileSpreadsheet,
  FileText,
  LayoutTemplate,
  Link2,
  Link2Off,
  Megaphone,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Receipt,
  Shapes,
  Trash2,
  ExternalLink,
  CalendarRange,
} from 'lucide-react';
import { firstDayOfMonth, monthOf, shiftMonth } from '@kitstak/programs-engine';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  IconButton,
  cn,
  toast,
} from '@/components/ui';
import { apiPath } from '@/lib/api-client';
import { useServerAction } from '@/lib/hooks/use-action';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { IsoMonth, ProgramDetailDTO } from '@/lib/program-types';
import { setProgramStatusAction } from '@/server/actions/programs';
import { newBuildLive } from '../kit/live-pages';
import { unlinkPulseJobAction } from '@/server/actions/program-links';
import { useShellStore } from '@/features/shell/store';
import { LinkPulseJobDialog } from '@/features/integrations/link-pulse-job-dialog';
import { ProgramDialogs, type ProgramDialog } from './program-dialogs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** "November" or "November 2025" when not this year. */
export function monthName(month: IsoMonth, currentYear?: string): string {
  const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
  return currentYear && month.slice(0, 4) !== currentYear ? `${name} ${month.slice(0, 4)}` : name;
}

export function statementHref(key: string, month: IsoMonth): string {
  return `${routes.program(key)}?statement=${month}`;
}

export function statementFileHref(key: string, month: IsoMonth, format: 'csv' | 'pdf'): string {
  return apiPath(`programs/${encodeURIComponent(key)}/statement`, { month, format });
}

const iconItemClass =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-icon outline-none hover:bg-hover hover:text-icon-strong data-[highlighted]:bg-hover data-[highlighted]:text-icon-strong';

/** One statement month: the label, then View, CSV and PDF as their own menu items. */
function StatementRow({ programKey, month, label, onView }: { readonly programKey: string; readonly month: IsoMonth; readonly label: string; readonly onView: () => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md py-0.5 pr-1 pl-2.5" data-testid={`statement-row-${month}`}>
      <Receipt aria-hidden className="size-4 shrink-0 text-icon" />
      <span className="ml-2 min-w-0 flex-1 truncate text-sm text-fg">{label}</span>
      <Menu.Item className={iconItemClass} onSelect={onView} aria-label={`View the ${label} statement`} title="View">
        <Eye aria-hidden className="size-4" />
      </Menu.Item>
      <Menu.Item asChild className={iconItemClass}>
        <a href={statementFileHref(programKey, month, 'csv')} download aria-label={`Download the ${label} statement as CSV`} title="CSV">
          <FileSpreadsheet aria-hidden className="size-4" />
        </a>
      </Menu.Item>
      <Menu.Item asChild className={iconItemClass}>
        <a href={statementFileHref(programKey, month, 'pdf')} download aria-label={`Download the ${label} statement as PDF`} title="PDF">
          <FileText aria-hidden className="size-4" />
        </a>
      </Menu.Item>
    </div>
  );
}

export interface ProgramMenuProps {
  readonly program: ProgramDetailDTO;
  readonly className?: string;
}

export function ProgramMenu({ program, className }: ProgramMenuProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const [dialog, setDialog] = useState<ProgramDialog>(null);
  const [pulseOpen, setPulseOpen] = useState(false);
  const caps = program.capabilities;
  const today = program.calendar.today;
  const thisMonth = monthOf(today);
  const lastMonth = shiftMonth(thisMonth, -1);
  const year = today.slice(0, 4);
  const lastClosed = program.locks.programClosed.includes(lastMonth);
  const lastMonthStarted = !program.startDate || program.startDate <= `${lastMonth}-31`;
  const pickMonths = Array.from({ length: 10 }, (_, index) => shiftMonth(thisMonth, -(index + 2))).filter((month) => !program.startDate || firstDayOfMonth(month) >= firstDayOfMonth(monthOf(program.startDate)));
  const running = program.status === 'active';
  const paused = program.status === 'on_hold';
  const ended = program.status === 'completed' || program.status === 'archived';
  const pulseJob = program.links.pulseJob;
  const pulseAvailable = program.setup.hasPulseJob !== null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.program(program.key) });
    void queryClient.invalidateQueries({ queryKey: ['programs'] });
  };
  const status = useServerAction(setProgramStatusAction, {
    errorTitle: "Couldn't change the program",
    onSuccess: refresh,
  });
  const unlinkJob = useServerAction(unlinkPulseJobAction, {
    errorTitle: "Couldn't remove the Pulse link",
    successMessage: (result) => (result.repostedRows > 0 ? `Removed the Pulse link. Revenue on ${result.repostedRows} open days now counts in ${program.key}.` : 'Removed the Pulse link.'),
    onSuccess: refresh,
  });

  const go = (href: string) => router.push(href);

  return (
    <>
      <DropdownMenu>
        <Menu.Trigger asChild>
          <IconButton label="Program actions" icon={<MoreHorizontal aria-hidden />} variant="outline" size="md" className={className} data-testid="program-menu" />
        </Menu.Trigger>
        <DropdownMenuContent align="end" className="w-[360px]" data-testid="program-menu-content">
          {(caps.canPlan && newBuildLive()) || caps.canEdit || (caps.canPropose && !program.moneyHidden) ? (
            <>
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              {caps.canPlan && newBuildLive() ? (
                <DropdownMenuItem icon={<Plus aria-hidden />} shortcut="B" onSelect={() => openQuickAdd({ projectId: program.id, mode: 'build' })} data-testid="program-menu-new-build">
                  New build
                </DropdownMenuItem>
              ) : null}
              {caps.canEdit ? (
                <DropdownMenuItem icon={<Shapes aria-hidden />} onSelect={() => go(`${routes.programTab(program.key, 'variants')}?add=1`)}>
                  Add variants
                </DropdownMenuItem>
              ) : null}
              {caps.canPropose && !program.moneyHidden ? (
                <DropdownMenuItem icon={<Receipt aria-hidden />} description="A dated draft. Prices change once it is published." onSelect={() => go(`${routes.programTab(program.key, 'price-card')}?new=1`)}>
                  New price version
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
            </>
          ) : null}

          {!program.moneyHidden ? (
            <>
              <DropdownMenuLabel>Statement</DropdownMenuLabel>
              <StatementRow programKey={program.key} month={thisMonth} label={`This month · ${monthName(thisMonth, year)}`} onView={() => go(statementHref(program.key, thisMonth))} />
              {lastMonthStarted ? <StatementRow programKey={program.key} month={lastMonth} label={`Last month · ${monthName(lastMonth, year)}`} onView={() => go(statementHref(program.key, lastMonth))} /> : null}
              {pickMonths.length > 0 ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger icon={<CalendarRange aria-hidden />}>Pick a month</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-[260px]">
                    {pickMonths.map((month) => (
                      <StatementRow key={month} programKey={program.key} month={month} label={monthName(month, year)} onView={() => go(statementHref(program.key, month))} />
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              {caps.canClose && lastMonthStarted && !lastClosed ? (
                <DropdownMenuItem icon={<CalendarCheck2 aria-hidden />} description="Check, lock and save the month's total." onSelect={() => go(`${routes.program(program.key)}?close=${lastMonth}`)} data-testid="program-menu-close">
                  Close {monthName(lastMonth, year)}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
            </>
          ) : null}

          {pulseAvailable && (pulseJob || caps.canManage) ? (
            <>
              <DropdownMenuLabel>Connect</DropdownMenuLabel>
              {pulseJob ? (
                <>
                  {pulseJob.url ? (
                    <DropdownMenuItem icon={<ExternalLink aria-hidden />} onSelect={() => window.open(pulseJob.url as string, '_blank', 'noopener')}>
                      Open Pulse job {pulseJob.title.split(' ')[0]}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem icon={<ExternalLink aria-hidden />} disabled description="Pulse is not set up to open jobs from here yet." data-testid="program-menu-open-pulse-off">
                      Open Pulse job {pulseJob.title.split(' ')[0]}
                    </DropdownMenuItem>
                  )}
                  {caps.canManage ? (
                    <DropdownMenuItem icon={<Link2Off aria-hidden />} description="Open days count in this program instead. Closed months keep their job." onSelect={() => void unlinkJob.run({ programKey: program.key })}>
                      Remove Pulse link
                    </DropdownMenuItem>
                  ) : null}
                </>
              ) : (
                <DropdownMenuItem icon={<Link2 aria-hidden />} description="Output and fees go to the job, for cost and margin." onSelect={() => setPulseOpen(true)} data-testid="program-menu-link-pulse">
                  Link Pulse job
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          ) : null}

          <DropdownMenuLabel>Program</DropdownMenuLabel>
          <DropdownMenuItem icon={<Copy aria-hidden />} description="Variants, rates and schedules come along." onSelect={() => go(routes.newProgram({ mode: 'copy', copy: program.key }))}>
            Copy program
          </DropdownMenuItem>
          <DropdownMenuItem icon={<LayoutTemplate aria-hidden />} onSelect={() => setDialog('template')}>
            Save as template
          </DropdownMenuItem>
          {caps.canEdit ? (
            <DropdownMenuItem icon={<Megaphone aria-hidden />} onSelect={() => setDialog('update')}>
              Post an update
            </DropdownMenuItem>
          ) : null}
          {caps.canManage && running ? (
            <DropdownMenuItem
              icon={<Pause aria-hidden />}
              description="Schedules stop making builds until you resume."
              onSelect={() => void status.run({ key: program.key, status: 'on_hold' }).then((result) => result && toast.success(`${program.key} is paused.`))}
            >
              Pause program
            </DropdownMenuItem>
          ) : null}
          {caps.canManage && (paused || program.status === 'planning') ? (
            <DropdownMenuItem icon={<Play aria-hidden />} onSelect={() => void status.run({ key: program.key, status: 'active' }).then((result) => result && toast.success(`${program.key} is running.`))}>
              {paused ? 'Resume program' : 'Start program'}
            </DropdownMenuItem>
          ) : null}
          {caps.canManage && !ended ? (
            <DropdownMenuItem icon={<CalendarX2 aria-hidden />} description="Sets an end date. You choose what happens to planned builds." onSelect={() => setDialog('end')}>
              End program
            </DropdownMenuItem>
          ) : null}

          {caps.canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Danger</DropdownMenuLabel>
              {program.status !== 'archived' ? (
                <DropdownMenuItem icon={<Archive aria-hidden />} description="Hides it from the sidebar. Nothing is deleted." onSelect={() => setDialog('archive')}>
                  Archive
                </DropdownMenuItem>
              ) : null}
              {caps.canPrice ? (
                <DropdownMenuItem icon={<Trash2 aria-hidden />} variant="danger" description="Only when no month is closed." onSelect={() => setDialog('delete')} className={cn(program.locks.programClosed.length > 0 && 'opacity-60')} disabled={program.locks.programClosed.length > 0}>
                  Delete
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ProgramDialogs program={program} open={dialog} onOpenChange={setDialog} />
      {pulseOpen ? <LinkPulseJobDialog open onOpenChange={setPulseOpen} target={{ kind: 'program', programKey: program.key, programId: program.id }} onLinked={refresh} /> : null}
    </>
  );
}
