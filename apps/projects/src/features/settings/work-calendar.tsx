'use client';
/**
 * Work calendar (/settings/calendar, docs/programs/SPEC.md 5.19, A15): the workspace time zone,
 * work days, holidays (add, rename, remove, copy last year's) and daily capacity hours. Programs
 * use it unless they set their own days. Owners and admins edit; everyone else reads it.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, CopyPlus, Factory, Globe, Info, Lock, Trash2 } from 'lucide-react';
import { shortDate, weekdayName } from '@kitstak/programs-engine';
import { Button, Combobox, EmptyState, IconButton, Input, IsoDatePicker, toast } from '@/components/ui';
import { Page, Panel } from '@/components/layout/page';
import type { OrgCalendarDTO } from '@/lib/program-types';
import { routes } from '@/lib/routes';
import { updateOrgCalendarAction } from '@/server/actions/org-calendar';
import { useShell } from '@/features/shell/shell-context';
import { WorkDayChips, timeZoneOptions, workWeekText } from '@/features/programs/wizard/step-basics';
import { calendarProblems, copyLastYear, type CalendarDraft } from './calendar-model';

function draftOf(calendar: OrgCalendarDTO): CalendarDraft {
  return { timezone: calendar.timezone, workingDays: calendar.workingDays, holidays: calendar.holidays, capacity: calendar.dailyCapacityHours ? calendar.dailyCapacityHours.replace(/\.00$/, '') : '' };
}

function same(a: CalendarDraft, b: CalendarDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function WorkCalendar({ initial, today }: { readonly initial: OrgCalendarDTO; readonly today: string }) {
  const router = useRouter();
  const { orgRole } = useShell();
  const canEdit = orgRole === 'owner' || orgRole === 'admin';
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<CalendarDraft>(() => draftOf(initial));
  const [newDate, setNewDate] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState(false);
  const [tried, setTried] = useState(false);
  const zones = useMemo(() => timeZoneOptions(draft.timezone), [draft.timezone]);
  const problems = calendarProblems(draft);
  const dirty = !same(draft, draftOf(saved));
  const year = Number(today.slice(0, 4));
  const lastYear = draft.holidays.filter((holiday) => holiday.date.startsWith(`${year - 1}-`)).length;
  const upcoming = draft.holidays.filter((holiday) => holiday.date >= today).length;

  const save = async () => {
    setTried(true);
    if (Object.keys(problems).length) return;
    setPending(true);
    const result = await updateOrgCalendarAction({
      expectedVersion: saved.version,
      patch: { timezone: draft.timezone, workingDays: [...draft.workingDays], holidays: draft.holidays.map((holiday) => ({ date: holiday.date, name: holiday.name.trim() })), dailyCapacityHours: draft.capacity.trim() ? draft.capacity.trim() : null },
    });
    setPending(false);
    if (!result.ok) {
      toast.error("Couldn't save the calendar", result.error.message);
      if (result.error.code === 'CONFLICT') router.refresh();
      return;
    }
    setSaved(result.data);
    setDraft(draftOf(result.data));
    setTried(false);
    toast.success('Work calendar saved', 'Changes apply to future builds and forecasts. Logged output does not change.');
    router.refresh();
  };

  const addHoliday = () => {
    if (!newDate) return;
    if (draft.holidays.some((holiday) => holiday.date === newDate)) {
      toast.info('That day is already a holiday');
      return;
    }
    setDraft({ ...draft, holidays: [...draft.holidays, { date: newDate, name: newName.trim() || 'Holiday' }].sort((a, b) => a.date.localeCompare(b.date)) });
    setNewDate(null);
    setNewName('');
  };

  return (
    <Page
      title="Work calendar"
      subtitle="Work days and holidays for every program that uses the workspace calendar."
      breadcrumbs={[{ label: 'Settings', href: routes.settings() }, { label: 'Work calendar' }]}
      width="narrow"
      actions={
        canEdit ? (
          <div className="flex items-center gap-2">
            {dirty ? <Button variant="ghost" onClick={() => setDraft(draftOf(saved))}>Discard changes</Button> : null}
            <Button onClick={() => void save()} loading={pending} disabled={!dirty} data-testid="calendar-save">Save calendar</Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4" data-testid="work-calendar">
        <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-subtle/50 px-3 py-2.5 text-sm text-fg">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info-text" />
          Changes apply to future builds and forecasts. Logged output does not change.
        </p>
        {!canEdit ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted"><Lock aria-hidden className="size-4" />You can view the calendar. Owners and admins can change it.</p>
        ) : null}

        <Panel title="Week">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary"><Globe aria-hidden className="size-3.5" />Time zone</span>
              <Combobox aria-label="Time zone" options={zones} value={draft.timezone} onValueChange={(value) => (value ? setDraft({ ...draft, timezone: value }) : undefined)} searchPlaceholder="Search time zones" disabled={!canEdit} className="h-10" />
              <span className="text-2xs text-fg-muted">Program days start and end at midnight here.</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary"><Factory aria-hidden className="size-3.5" />Daily capacity</span>
              <Input aria-label="Daily capacity hours" value={draft.capacity} inputMode="decimal" disabled={!canEdit} invalid={tried && Boolean(problems.capacity)} onChange={(event) => setDraft({ ...draft, capacity: event.target.value })} trailing={<span className="text-xs text-fg-muted">hours a day</span>} containerClassName="h-10" data-testid="calendar-capacity" />
              <span className={tried && problems.capacity ? 'text-2xs font-medium text-danger-text' : 'text-2xs text-fg-muted'}>{tried && problems.capacity ? problems.capacity : 'Optional. Floor today and Workload show planned hours against it.'}</span>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-xs font-medium text-fg-secondary">Work days</span>
              {canEdit ? <WorkDayChips value={draft.workingDays} onChange={(days) => setDraft({ ...draft, workingDays: days })} label="Work days" /> : null}
              <span className={tried && problems.workingDays ? 'text-2xs font-medium text-danger-text' : 'text-2xs text-fg-muted'}>{tried && problems.workingDays ? problems.workingDays : `${workWeekText(draft.workingDays, 0).split(' · ')[0]} · ${upcoming} ${upcoming === 1 ? 'holiday' : 'holidays'} ahead`}</span>
            </div>
          </div>
        </Panel>

        <Panel
          title="Holidays"
          action={
            canEdit && lastYear > 0 ? (
              <Button variant="ghost" size="sm" leadingIcon={<CopyPlus aria-hidden />} onClick={() => { const next = copyLastYear(draft.holidays, year); const added = next.length - draft.holidays.length; setDraft({ ...draft, holidays: next }); toast.success(added ? `Added ${added} ${added === 1 ? 'holiday' : 'holidays'} for ${year}` : `Every holiday from ${year - 1} is already in ${year}`); }} data-testid="copy-last-year">
                Copy last year&apos;s holidays
              </Button>
            ) : undefined
          }
          bodyClassName="p-0"
        >
          {draft.holidays.length === 0 ? (
            <EmptyState size="sm" illustration="workspace" title="No holidays yet" description="Add the days the floor is closed. Schedules skip them and forecasts leave them out." />
          ) : (
            <table className="w-full text-sm" data-testid="holidays-table">
              <thead className="border-b border-border-subtle bg-sunken/60 text-left text-xs text-fg-muted">
                <tr>
                  <th scope="col" className="w-48 px-4 py-2 font-medium">Date</th>
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="w-12"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {draft.holidays.map((holiday, index) => (
                  <tr key={holiday.date} className={holiday.date < today ? 'border-b border-border-subtle text-fg-muted last:border-0' : 'border-b border-border-subtle last:border-0'}>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                      <span className="font-medium text-fg">{weekdayName(holiday.date).slice(0, 3)} {shortDate(holiday.date)}</span>
                      <span className="ml-1.5 text-xs text-fg-muted">{holiday.date.slice(0, 4)}</span>
                    </td>
                    <td className="px-4 py-1.5">
                      {canEdit ? (
                        <Input aria-label={`Name of the holiday on ${shortDate(holiday.date)}`} value={holiday.name} invalid={tried && Boolean(problems[`holiday:${index}`])} onChange={(event) => setDraft({ ...draft, holidays: draft.holidays.map((entry, at) => (at === index ? { ...entry, name: event.target.value } : entry)) })} maxLength={80} />
                      ) : (
                        holiday.name
                      )}
                      {tried && problems[`holiday:${index}`] ? <p role="alert" className="mt-1 text-2xs font-medium text-danger-text">{problems[`holiday:${index}`]}</p> : null}
                    </td>
                    <td className="px-2 py-1.5">
                      {canEdit ? <IconButton size="sm" label={`Remove ${holiday.name || 'holiday'}`} icon={<Trash2 aria-hidden />} onClick={() => setDraft({ ...draft, holidays: draft.holidays.filter((_, at) => at !== index) })} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canEdit ? (
            <form
              className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                addHoliday();
              }}
            >
              <IsoDatePicker value={newDate} onChange={setNewDate} placeholder="Pick a day" aria-label="Holiday date" className="w-44" />
              <Input aria-label="Holiday name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Thanksgiving" containerClassName="w-56" maxLength={80} />
              <Button type="submit" variant="secondary" leadingIcon={<CalendarPlus aria-hidden />} disabled={!newDate} data-testid="add-holiday">Add holiday</Button>
            </form>
          ) : null}
        </Panel>
      </div>
    </Page>
  );
}
