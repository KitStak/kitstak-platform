'use client';
/**
 * Schedule tab (docs/programs/SPEC.md 5.13): one card per schedule (rule, lines summary, status,
 * the next 3 runs, how far builds are made, and Edit, Pause or Resume, Skip a date, Run now and
 * End), "New schedule" with the shared editor plus Default status, and a month calendar that
 * dots each schedule's runs, crosses skipped days and labels days off.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarOff, CalendarX2, ChevronLeft, ChevronRight, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, Zap } from 'lucide-react';
import { addDays, monthOf, shiftMonth, shortDate, unitLabel } from '@kitstak/programs-engine';
import { Badge, Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Field, IconButton, IsoDatePicker, Select, Skeleton, Switch, Tooltip, cn, toast } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { useServerAction } from '@/lib/hooks/use-action';
import { useOrgCalendar, useSchedules } from '@/lib/hooks/use-programs';
import { usePeople } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import type { ScheduleDTO } from '@/lib/program-types';
import { createScheduleAction, deleteScheduleAction, endScheduleAction, pauseScheduleAction, resumeScheduleAction, runScheduleNowAction, skipScheduleDateAction, updateScheduleAction } from '@/server/actions/schedules';
import { ScheduleEditor, scheduleProblems, type ScheduleEditorValue } from '../editors';
import { useCurrentProgram } from '../program-context';
import { variantChartColor, monthLong } from '../overview/overview-model';
import { editorValueFor, linesSummary, monthGrid, newEditorValue, toScheduleInput } from './schedule-model';

const STATUS_TONE = { active: 'success', paused: 'warning', ended: 'neutral' } as const;
const STATUS_TEXT = { active: 'Active', paused: 'Paused', ended: 'Ended' } as const;

function useRefresh() {
  const { key } = useCurrentProgram();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
    await queryClient.invalidateQueries({ queryKey: qk.projectTasks(key) });
    await queryClient.invalidateQueries({ queryKey: ['programs', 'today'] });
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Editor dialog                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

function ScheduleDialog({ schedule, count, onOpenChange }: { readonly schedule: ScheduleDTO | null; readonly count: number; readonly onOpenChange: (open: boolean) => void }) {
  const { key, unit, variants, program, today, statuses } = useCurrentProgram();
  const refresh = useRefresh();
  const calendar = useOrgCalendar();
  const people = usePeople();
  const [value, setValue] = useState<ScheduleEditorValue>(() => (schedule ? editorValueFor(schedule, variants) : newEditorValue(variants, program.calendar.nextWorkDay, count)));
  const [defaultStatusId, setDefaultStatusId] = useState<string>(schedule?.defaultStatusId ?? 'auto');
  const [regenerate, setRegenerate] = useState(false);
  const [tried, setTried] = useState(false);
  const problems = scheduleProblems(value);
  const create = useServerAction(createScheduleAction, {
    errorTitle: "Couldn't save the schedule",
    successMessage: (saved) => `${saved.name} is saved. Builds are made ${saved.leadDays} days ahead.`,
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
  });
  const update = useServerAction(updateScheduleAction, {
    errorTitle: "Couldn't save the schedule",
    successMessage: 'Schedule saved.',
    onSuccess: async () => {
      await refresh();
      onOpenChange(false);
    },
  });
  const todoStatuses = statuses.filter((status) => status.category === 'todo' || status.category === 'in_progress');
  const submit = () => {
    setTried(true);
    if (Object.keys(problems).length > 0) return;
    const input = toScheduleInput(value, { skipDates: schedule?.skipDates ?? [], defaultAssigneeId: schedule?.defaultAssigneeId ?? null, defaultStatusId: defaultStatusId === 'auto' ? null : defaultStatusId });
    if (schedule) void update.run({ id: schedule.id, expectedVersion: schedule.version, patch: input, regenerateFuture: regenerate });
    else void create.run({ key, input });
  };
  const editorVariants = variants.filter((variant) => variant.status === 'active').map((variant) => ({ key: variant.key, name: variant.name, color: variant.color, defaultQty: variant.defaultQty }));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="w-[min(960px,calc(100vw-24px))]" data-testid="schedule-dialog">
        <DialogHeader
          icon={
            <span className="flex size-9 items-center justify-center rounded-lg bg-sunken text-icon">
              <CalendarClock aria-hidden className="size-4" />
            </span>
          }
          title={schedule ? `Edit ${schedule.name}` : 'New schedule'}
          description="A schedule makes builds ahead of time on the days you pick. Each day it makes is one run."
        />
        <DialogBody className="flex max-h-[68dvh] flex-col gap-4 overflow-y-auto">
          <ScheduleEditor
            value={value}
            onChange={setValue}
            variants={editorVariants}
            calendar={program.calendar}
            holidays={calendar.data?.holidays ?? []}
            today={today}
            unit={unit}
            people={(people.data ?? []).map((person) => ({ id: person.id, name: person.name, email: person.email, image: person.image ?? null }))}
            showErrors={tried}
            hideSwitch
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default status" hint="The status new builds start in.">
              {({ inputId }) => (
                <Select id={inputId} value={defaultStatusId} onValueChange={setDefaultStatusId} options={[{ value: 'auto', label: 'The first open status' }, ...todoStatuses.map((status) => ({ value: status.id, label: status.name }))]} />
              )}
            </Field>
          </div>
          {schedule ? <Switch checked={regenerate} onCheckedChange={setRegenerate} label="Also update builds already made after today that have no output" description="Builds with output, and builds someone changed by hand, stay as they are." /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.pending || update.pending} data-testid="schedule-save">
            {schedule ? 'Save schedule' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateDialog({ title, description, label, confirmLabel, initial, pending, onConfirm, onOpenChange, destructive }: { readonly title: string; readonly description: string; readonly label: string; readonly confirmLabel: string; readonly initial: string; readonly pending: boolean; readonly onConfirm: (date: string) => void; readonly onOpenChange: (open: boolean) => void; readonly destructive?: boolean }) {
  const [date, setDate] = useState(initial);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title={title} description={description} />
        <DialogBody>
          <Field label={label} required>
            {({ inputId }) => <IsoDatePicker id={inputId} value={date} onChange={(next) => next && setDate(next)} />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} loading={pending} onClick={() => onConfirm(date)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Card                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

type CardDialog = 'edit' | 'skip' | 'end' | 'delete' | null;

function ScheduleCard({ schedule, color, count }: { readonly schedule: ScheduleDTO; readonly color: string; readonly count: number }) {
  const { key, unit, program, capabilities, today } = useCurrentProgram();
  const refresh = useRefresh();
  const [dialog, setDialog] = useState<CardDialog>(null);
  const pause = useServerAction(pauseScheduleAction, { successMessage: `${schedule.name} is paused. It makes no new builds until you resume it.`, errorTitle: "Couldn't pause the schedule", onSuccess: refresh });
  const resume = useServerAction(resumeScheduleAction, { successMessage: `${schedule.name} is running again.`, errorTitle: "Couldn't resume the schedule", onSuccess: refresh });
  const skip = useServerAction(skipScheduleDateAction, {
    errorTitle: "Couldn't skip that date",
    onSuccess: async () => {
      setDialog(null);
      toast.success('Date skipped. Builds already made for it were cancelled if they had no output.');
      await refresh();
    },
  });
  const end = useServerAction(endScheduleAction, {
    errorTitle: "Couldn't end the schedule",
    successMessage: `${schedule.name} ends as you asked.`,
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });
  const remove = useServerAction(deleteScheduleAction, {
    errorTitle: "Couldn't delete the schedule",
    successMessage: (result) => `${schedule.name} is deleted. ${result.keptBuilds === 1 ? 'The 1 build it made stays.' : `The ${result.keptBuilds.toLocaleString('en-US')} builds it made stay.`}`,
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });
  const runNow = useServerAction(runScheduleNowAction, {
    errorTitle: "Couldn't make builds",
    successMessage: (result) => (result.builds === 0 ? 'Builds were already made for the lead window.' : `Made ${result.builds === 1 ? '1 build' : `${result.builds} builds`}${result.through ? ` through ${shortDate(result.through)}` : ''}.`),
    onSuccess: refresh,
  });
  const grid = useMemo(() => monthGrid(monthOf(today), [schedule], program.calendar, today).concat(monthGrid(shiftMonth(monthOf(today), 1), [schedule], program.calendar, today)), [schedule, program.calendar, today]);
  const upcoming = useMemo(() => {
    const seen = new Set<string>();
    return grid.filter((cell) => cell.date >= (schedule.nextDate ?? today) && cell.runs.some((run) => !run.skipped) && !seen.has(cell.date) && seen.add(cell.date)).slice(0, 3);
  }, [grid, schedule.nextDate, today]);
  const canPlan = capabilities.canPlan;
  const ended = schedule.status === 'ended';
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" data-testid="schedule-card">
      <header className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
            {schedule.name}
            <Badge tone={STATUS_TONE[schedule.status]} size="sm">
              {STATUS_TEXT[schedule.status]}
            </Badge>
          </h3>
          <p className="text-sm text-fg-secondary">{schedule.text.split(' · ')[0]}</p>
          <p className="text-xs text-fg-muted tabular-nums">{linesSummary(schedule, unit)}</p>
        </div>
        {canPlan ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${schedule.name}`} icon={<MoreHorizontal aria-hidden />} size="sm" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {!ended ? (
                <DropdownMenuItem icon={<Pencil aria-hidden />} onSelect={() => setDialog('edit')}>
                  Edit
                </DropdownMenuItem>
              ) : null}
              {schedule.status === 'active' ? (
                <DropdownMenuItem icon={<Pause aria-hidden />} description="Makes no new builds until resumed." onSelect={() => void pause.run({ id: schedule.id })}>
                  Pause
                </DropdownMenuItem>
              ) : null}
              {schedule.status === 'paused' ? (
                <DropdownMenuItem icon={<Play aria-hidden />} onSelect={() => void resume.run({ id: schedule.id })}>
                  Resume
                </DropdownMenuItem>
              ) : null}
              {!ended ? (
                <DropdownMenuItem icon={<CalendarX2 aria-hidden />} description="No builds that day." onSelect={() => setDialog('skip')}>
                  Skip a date
                </DropdownMenuItem>
              ) : null}
              {schedule.status === 'active' ? (
                <DropdownMenuItem icon={<Zap aria-hidden />} description={`Makes builds through the next ${schedule.leadDays} days now.`} onSelect={() => void runNow.run({ key })}>
                  Run now
                </DropdownMenuItem>
              ) : null}
              {!ended ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<CalendarOff aria-hidden />} description="Stops after a date you pick." onSelect={() => setDialog('end')}>
                    End
                  </DropdownMenuItem>
                </>
              ) : null}
              {capabilities.canManage ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} description="Builds it made stay." onSelect={() => setDialog('delete')} data-testid="schedule-delete">
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}

            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <div className="grid gap-3 border-t border-border-subtle pt-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Next runs</span>
          {upcoming.length === 0 ? (
            <span className="text-sm text-fg-muted">{ended ? 'This schedule has ended.' : schedule.status === 'paused' ? 'Paused. Resume it to plan runs.' : 'No runs in the next two months.'}</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {upcoming.map((cell) => (
                <li key={cell.date} className="rounded-md bg-sunken px-2 py-1 text-xs text-fg tabular-nums">
                  {new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${cell.date}T00:00:00Z`))} {shortDate(cell.date)} · {unitLabel(String(cell.runs[0]?.units ?? 0), unit)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-1 text-xs text-fg-muted sm:items-end sm:text-right">
          <span>{schedule.generatedThrough ? `Builds made through ${shortDate(schedule.generatedThrough)}` : 'No builds made yet'}</span>
          <span>
            Starts {shortDate(schedule.startsOn)}
            {schedule.endsOn ? ` · Ends ${shortDate(schedule.endsOn)}` : ''} · {schedule.leadDays} days ahead
          </span>
          {schedule.skipDates.length ? <span>{schedule.skipDates.length === 1 ? '1 day skipped' : `${schedule.skipDates.length} days skipped`}</span> : null}
        </div>
      </div>
      {dialog === 'edit' ? <ScheduleDialog schedule={schedule} count={count} onOpenChange={(open) => (open ? null : setDialog(null))} /> : null}
      {dialog === 'skip' ? (
        <DateDialog title={`Skip a date on ${schedule.name}`} description="No builds are made that day. Builds already made for it with no output are cancelled." label="Date" confirmLabel="Skip date" initial={schedule.nextDate ?? addDays(today, 1)} pending={skip.pending} onConfirm={(date) => void skip.run({ id: schedule.id, date })} onOpenChange={(open) => (open ? null : setDialog(null))} />
      ) : null}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => (open ? null : setDialog(null))}
        title={`Delete ${schedule.name}?`}
        description="The schedule stops making builds and goes away. Builds it already made stay, with their output and money. This cannot be undone."
        confirmLabel="Delete schedule"
        destructive
        loading={remove.pending}
        onConfirm={() => void remove.run({ id: schedule.id })}
      />
      {dialog === 'end' ? (
        <DateDialog title={`End ${schedule.name}`} description="The schedule makes no builds after this date. Builds already made stay." label="Last day" confirmLabel="End schedule" initial={today} pending={end.pending} onConfirm={(date) => void end.run({ id: schedule.id, endsOn: date })} onOpenChange={(open) => (open ? null : setDialog(null))} destructive />
      ) : null}
    </article>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Month preview                                                                                  */
/* ---------------------------------------------------------------------------------------------- */

function MonthPreview({ schedules, colors }: { readonly schedules: readonly ScheduleDTO[]; readonly colors: ReadonlyMap<string, string> }) {
  const { program, today, unit } = useCurrentProgram();
  const calendar = useOrgCalendar();
  const [month, setMonth] = useState(monthOf(today));
  const cells = useMemo(() => monthGrid(month, schedules, program.calendar, today), [month, schedules, program.calendar, today]);
  const holidays = new Map((calendar.data?.holidays ?? []).map((holiday) => [holiday.date, holiday.name]));
  const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Calendar
          <span className="flex items-center rounded-md border border-border-subtle">
            <IconButton label="Previous month" size="sm" icon={<ChevronLeft aria-hidden />} onClick={() => setMonth(shiftMonth(month, -1))} />
            <span className="min-w-[110px] text-center text-xs font-medium text-fg-secondary">{monthLong(month)}</span>
            <IconButton label="Next month" size="sm" icon={<ChevronRight aria-hidden />} onClick={() => setMonth(shiftMonth(month, 1))} />
          </span>
        </span>
      }
      action={
        <span className="hidden items-center gap-3 text-xs text-fg-muted sm:flex">
          {schedules.map((schedule) => (
            <span key={schedule.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ background: colors.get(schedule.id) }} />
              {schedule.name}
            </span>
          ))}
        </span>
      }
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-7 border-b border-border-subtle text-center text-2xs font-medium text-fg-muted">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <span key={day} className="py-1.5">
            {day}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7" data-testid="schedule-month">
        {cells.map((cell) => {
          const holiday = holidays.get(cell.date);
          const tip = [
            `${shortDate(cell.date)}${holiday ? ` · ${holiday}` : cell.dayOff ? ' · Day off' : !cell.workDay ? ' · Not a work day' : ''}`,
            ...cell.runs.map((run) => `${byId.get(run.scheduleId)?.name ?? 'Schedule'}: ${run.skipped ? 'skipped' : unitLabel(String(run.units), unit)}`),
          ].join('\n');
          return (
            <li key={cell.date} className={cn('min-h-[64px] border-r border-b border-border-subtle p-1.5 text-xs [&:nth-child(7n)]:border-r-0', !cell.inMonth && 'bg-sunken/50 text-fg-muted', !cell.workDay && cell.inMonth && 'bg-sunken/30')}>
              <Tooltip content={<span className="whitespace-pre-line">{tip}</span>}>
                <span tabIndex={cell.runs.length ? 0 : -1} className="flex h-full flex-col gap-1 outline-none focus-visible:outline-2 focus-visible:outline-focus">
                  <span className={cn('inline-flex size-5 items-center justify-center rounded-full tabular-nums', cell.isToday ? 'bg-primary font-semibold text-primary-fg' : 'text-fg-secondary')}>{Number(cell.date.slice(8, 10))}</span>
                  {holiday || cell.dayOff ? <span className="truncate text-2xs text-warning-text">{holiday ?? 'Day off'}</span> : null}
                  <span className="flex flex-wrap gap-1">
                    {cell.runs.map((run) => (
                      <span key={run.scheduleId} className={cn('inline-flex items-center gap-1 text-2xs tabular-nums', run.skipped ? 'text-fg-muted line-through' : 'text-fg-secondary')}>
                        <span aria-hidden className={cn('size-2 rounded-full', run.skipped && 'opacity-40')} style={{ background: colors.get(run.scheduleId) }} />
                        <span className="max-sm:hidden">{run.units}</span>
                      </span>
                    ))}
                  </span>
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Tab                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

export function ScheduleTab({ initialSchedules }: { readonly initialSchedules: readonly ScheduleDTO[] }) {
  const { key, capabilities, activeVariants } = useCurrentProgram();
  const params = useSearchParams();
  const schedules = useSchedules(key, { initialData: [...initialSchedules] });
  const list = useMemo(() => schedules.data ?? [], [schedules.data]);
  const [creating, setCreating] = useState(() => params?.get('new') === '1' && capabilities.canPlan && activeVariants.length > 0);
  const [showEnded, setShowEnded] = useState(false);
  const colors = useMemo(() => new Map(list.map((schedule, index) => [schedule.id, variantChartColor(null, index)])), [list]);
  const ended = list.filter((schedule) => schedule.status === 'ended');
  const shown = list.filter((schedule) => showEnded || schedule.status !== 'ended');
  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5" data-testid="schedule-tab">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold text-fg">
          Schedules
          <span className="text-sm font-normal text-fg-muted tabular-nums">{list.length - ended.length}</span>
        </h2>
        {ended.length ? <Switch checked={showEnded} onCheckedChange={setShowEnded} label={`Show ended (${ended.length})`} size="sm" /> : null}
        {capabilities.canPlan ? (
          <Button className="ml-auto" onClick={() => setCreating(true)} disabled={activeVariants.length === 0} data-testid="new-schedule">
            <Plus aria-hidden />
            New schedule
          </Button>
        ) : null}
      </header>
      {schedules.isLoading ? (
        <Skeleton height={160} rounded="lg" />
      ) : list.length === 0 ? (
        <EmptyState
          visual={<CalendarClock aria-hidden className="size-10 text-icon" />}
          title="No schedules"
          description={activeVariants.length === 0 ? 'Add variants first. A schedule makes builds of them on the days you pick.' : 'Builds are only made when you plan them.'}
          actions={capabilities.canPlan && activeVariants.length > 0 ? <Button onClick={() => setCreating(true)}>New schedule</Button> : null}
        />
      ) : (
        <div className={cn('grid gap-3', shown.length > 1 && 'md:grid-cols-2')}>
          {shown.map((schedule) => (
            <ScheduleCard key={schedule.id} schedule={schedule} color={colors.get(schedule.id) ?? 'var(--chart-1)'} count={list.length} />
          ))}
        </div>
      )}
      {list.length > 0 ? <MonthPreview schedules={list.filter((schedule) => schedule.status !== 'ended')} colors={colors} /> : null}
      {creating ? <ScheduleDialog schedule={null} count={list.length} onOpenChange={setCreating} /> : null}
    </div>
  );
}
