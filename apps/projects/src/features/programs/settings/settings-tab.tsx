'use client';
/**
 * Program Settings tab (docs/programs/SPEC.md 5.16): General, Units and calendar, Money, Month
 * close, People, Pulse check and Danger zone. Each section saves on its own; program settings
 * carry a version so two people editing at once never overwrite each other silently.
 */
import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarCheck2, CheckCircle2, Lock, CalendarX2, Pause, Play, Trash2, TriangleAlert, UserPlus } from 'lucide-react';
import { formatCents, formatQty, lastDayOfMonth, monthOf, shortDate } from '@kitstak/programs-engine';
import { Badge, Button, ConfirmDialog, Field, IconButton, Input, IsoDatePicker, Select, Skeleton, Switch, Textarea, ToggleGroup, Tooltip, UserPicker, cn, toast } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { PROJECT_ROLES, PROJECT_ROLE_LABELS, type ProjectRole } from '@/lib/constants';
import { unwrap } from '@/lib/hooks/use-action';
import { usePeople } from '@/lib/hooks/use-data';
import { useCloseChecklist, useProgramPulse, useProgramSummary } from '@/lib/hooks/use-programs';
import { qk } from '@/lib/query-keys';
import type { IsoMonth } from '@/lib/program-types';
import { setProgramStatusAction, updateProgramAction, updateProgramSettingsAction } from '@/server/actions/programs';
import { addProjectMembersAction, removeProjectMemberAction, updateProjectMemberRoleAction } from '@/server/actions/projects';
import { useShell } from '@/features/shell/shell-context';
import { SettingsSection } from '@/features/projects/settings-shared';
import { useCurrentProject } from '@/features/projects/project-context';
import { AppearancePicker } from '@/features/projects/appearance-picker';
import { timeZoneOptions } from '@/features/programs/wizard/step-basics';
import { WEEK_ORDER, WEEKDAY_SHORT } from '../editors';
import { useCurrentProgram } from '../program-context';
import { ArchiveProgramDialog, DeleteProgramDialog, EndProgramDialog } from '../frame/program-dialogs';
import { healthBasisText } from '../kit/format';
import { centsToDollars, readMoney } from '../editors/price-model';
import { readQty, trimQty } from '../kit/qty-input';
import { ReopenMonthDialog } from '../close/reopen-dialog';
import { monthLong } from '../overview/overview-model';
import { buildTitlePreview, closeMonthsFor, settingsSectionsFor } from './settings-model';

const ROLE_HELP: Readonly<Record<ProjectRole, string>> = {
  owner: 'Can do everything, including prices, month close and delete',
  editor: 'Can plan builds, log output and change settings',
  commenter: 'Can view and comment',
  viewer: 'Can only look',
};

function useSave() {
  const { key } = useCurrentProgram();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const save = async (section: string, step: () => Promise<unknown>, success: string) => {
    setPending(section);
    try {
      await step();
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: qk.program(key) });
      await queryClient.invalidateQueries({ queryKey: ['programs'] });
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      toast.error(code === 'CONFLICT' ? 'Someone else changed these settings' : "Couldn't save your change", code === 'CONFLICT' ? 'We loaded their change. Look it over and save again.' : error instanceof Error ? error.message : 'Try again.');
      await queryClient.invalidateQueries({ queryKey: qk.program(key) });
      return false;
    } finally {
      setPending(null);
    }
  };
  return { save, pending };
}

function SaveBar({ dirty, pending, onSave, onReset }: { readonly dirty: boolean; readonly pending: boolean; readonly onSave: () => void; readonly onReset: () => void }) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
      {dirty ? (
        <Button variant="ghost" onClick={onReset} disabled={pending}>
          Undo changes
        </Button>
      ) : null}
      <Button onClick={onSave} disabled={!dirty} loading={pending}>
        Save
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* General                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

function GeneralSection() {
  const { key, program, capabilities } = useCurrentProgram();
  const { project } = useCurrentProject();
  const { save, pending } = useSave();
  const people = usePeople();
  const [ending, setEnding] = useState(false);
  const initial = useMemo(
    () => ({ name: program.name, description: program.description ?? '', color: program.color ?? 'orange', icon: program.icon ?? 'repeat', ownerId: program.owner?.id ?? '', visibility: project.visibility, startDate: program.startDate, endDate: program.endDate, health: program.healthAuto ? 'auto' : (program.health ?? 'on_track') }),
    [program, project.visibility],
  );
  const [form, setForm] = useState(initial);
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setForm(initial);
  }
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const canEdit = capabilities.canEdit;
  const members = program.members.map((member) => member.person);
  const status = program.status;
  return (
    <SettingsSection id="general" title="General" description="Name, look, owner, who can open it, status and dates.">
      <div className="grid items-start gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
        <AppearancePicker color={form.color} icon={form.icon} onChange={(next) => set({ ...(next.color ? { color: next.color } : {}), ...(next.icon ? { icon: next.icon } : {}) })} disabled={!canEdit} size={48} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]">
          <Field label="Name" required>
            {({ inputId }) => <Input id={inputId} value={form.name} onChange={(event) => set({ name: event.target.value })} maxLength={120} disabled={!canEdit} />}
          </Field>
          <Field label="Key" hint={program.pulseJob ? 'The key cannot change while a Pulse job is linked.' : 'Build keys use it, like GLOVE-212.'}>
            {({ inputId }) => <Input id={inputId} value={key} readOnly disabled className="font-key" />}
          </Field>
          <Field label="Description" className="sm:col-span-2">
            {({ inputId }) => <Textarea id={inputId} value={form.description} onChange={(event) => set({ description: event.target.value })} rows={3} maxLength={20000} disabled={!canEdit} placeholder="What this program makes and for whom." />}
          </Field>
          <Field label="Owner">
            {({ inputId }) => (
              <Select id={inputId} value={form.ownerId} onValueChange={(ownerId) => set({ ownerId })} disabled={!canEdit} options={(members.length ? members : (people.data ?? [])).map((person) => ({ value: person.id, label: person.name }))} />
            )}
          </Field>
          <Field label="Who can open it">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={form.visibility}
                onValueChange={(visibility) => set({ visibility: visibility as 'org' | 'private' })}
                disabled={!capabilities.canManage}
                options={[
                  { value: 'org', label: 'Everyone in the workspace', description: 'Members who are not added see units only.' },
                  { value: 'private', label: 'Only people added', description: 'Others cannot find it.' },
                ]}
              />
            )}
          </Field>
          <Field label="Start date" hint="Refused when it would move into a closed month.">
            {({ inputId }) => <IsoDatePicker id={inputId} value={form.startDate} onChange={(startDate) => set({ startDate })} disabled={!canEdit} />}
          </Field>
          <Field label="End date" hint="Optional.">
            {({ inputId }) => <IsoDatePicker id={inputId} value={form.endDate} onChange={(endDate) => set({ endDate })} disabled={!canEdit} clearable />}
          </Field>
          <Field label="Health" hint={form.health === 'auto' ? healthBasisText(program.healthBasis, true) : 'Set by hand. It stays until you switch back to Auto.'}>
            {({ inputId }) => (
              <Select
                id={inputId}
                value={form.health}
                onValueChange={(health) => set({ health })}
                disabled={!canEdit}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'on_track', label: 'On track' },
                  { value: 'at_risk', label: 'At risk' },
                  { value: 'off_track', label: 'Off track' },
                ]}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Status</span>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status === 'active' ? 'success' : status === 'on_hold' ? 'warning' : 'neutral'}>{status === 'active' ? 'Running' : status === 'on_hold' ? 'Paused' : status === 'completed' ? 'Ended' : status}</Badge>
              {capabilities.canManage && status === 'active' ? (
                <Button size="sm" variant="secondary" loading={pending === 'status'} onClick={() => void save('status', () => unwrap(setProgramStatusAction({ key, status: 'on_hold' })), `${key} is paused. Schedules stop making builds.`)}>
                  <Pause aria-hidden />
                  Pause
                </Button>
              ) : null}
              {capabilities.canManage && status !== 'active' ? (
                <Button size="sm" variant="secondary" loading={pending === 'status'} onClick={() => void save('status', () => unwrap(setProgramStatusAction({ key, status: 'active' })), `${key} is running again.`)}>
                  <Play aria-hidden />
                  Resume
                </Button>
              ) : null}
              {capabilities.canManage && status !== 'completed' ? (
                <Button size="sm" variant="ghost" onClick={() => setEnding(true)}>
                  <CalendarX2 aria-hidden />
                  End
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {canEdit ? (
        <SaveBar
          dirty={dirty}
          pending={pending === 'general'}
          onReset={() => setForm(initial)}
          onSave={() =>
            void save(
              'general',
              () =>
                unwrap(
                  updateProgramAction({
                    key,
                    patch: {
                      name: form.name.trim(),
                      description: form.description.trim() || null,
                      color: form.color,
                      icon: form.icon,
                      ...(form.ownerId && form.ownerId !== initial.ownerId ? { ownerId: form.ownerId } : {}),
                      ...(form.visibility !== initial.visibility ? { visibility: form.visibility } : {}),
                      ...(form.startDate !== initial.startDate ? { startDate: form.startDate } : {}),
                      ...(form.endDate !== initial.endDate ? { endDate: form.endDate } : {}),
                      ...(form.health !== initial.health ? { healthOverride: form.health === 'auto' ? null : (form.health as 'on_track' | 'at_risk' | 'off_track') } : {}),
                    },
                  }),
                ),
              'Saved.',
            )
          }
        />
      ) : null}
      {ending ? <EndProgramDialog program={program} open={ending} onOpenChange={setEnding} /> : null}
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Units and calendar                                                                             */
/* ---------------------------------------------------------------------------------------------- */

function DateList({ dates, onChange, disabled, label }: { readonly dates: readonly string[]; readonly onChange: (dates: string[]) => void; readonly disabled?: boolean; readonly label: string }) {
  const [adding, setAdding] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {dates.length === 0 ? <span className="text-xs text-fg-muted">None</span> : null}
        {[...dates].sort().map((date) => (
          <span key={date} className="inline-flex items-center gap-1 rounded-md bg-sunken py-0.5 pr-0.5 pl-2 text-xs text-fg tabular-nums">
            {shortDate(date)} {date.slice(0, 4)}
            {disabled ? null : <IconButton label={`Remove ${shortDate(date)}`} icon={<Trash2 aria-hidden />} size="xs" onClick={() => onChange(dates.filter((entry) => entry !== date))} />}
          </span>
        ))}
        {disabled ? null : (
          <span className="w-40">
            <IsoDatePicker
              value={adding}
              onChange={(date) => {
                setAdding(null);
                if (date && !dates.includes(date)) onChange([...dates, date]);
              }}
              placeholder="Add a date"
              aria-label={`Add to ${label.toLowerCase()}`}
            />
          </span>
        )}
      </div>
    </div>
  );
}

function UnitsCalendarSection() {
  const { key, program, capabilities } = useCurrentProgram();
  const { save, pending } = useSave();
  const s = program.settings;
  const initial = useMemo(
    () => ({
      unitSingular: s.unitSingular,
      unitPlural: s.unitPlural,
      timezone: s.timezone,
      useWorkspace: s.workingDays === null,
      workingDays: s.workingDays ?? program.calendar.workingDays,
      extraDaysOff: s.extraDaysOff,
      extraWorkDays: s.extraWorkDays,
      buildTitlePattern: s.buildTitlePattern,
      autoStartOnOutput: s.autoStartOnOutput,
      autoDoneWhenFull: s.autoDoneWhenFull,
      remindAt: s.remindAt,
    }),
    [s, program.calendar.workingDays],
  );
  const [form, setForm] = useState(initial);
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setForm(initial);
  }
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const disabled = !capabilities.canEdit;
  const zones = useMemo(() => timeZoneOptions(form.timezone), [form.timezone]);
  // Only closed months the program had days in hold the time zone (A8).
  const startMonth = program.startDate ? monthOf(program.startDate) : null;
  const closedMonths = [...program.locks.programClosed, ...program.locks.pulseClosed].filter((month) => !startMonth || month >= startMonth).sort();
  const lockedMonths = closedMonths.length;
  const tzLocked = lockedMonths > 0 && form.timezone !== initial.timezone;
  const firstClosed = closedMonths[0];
  const preview = buildTitlePreview(form.buildTitlePattern, { programKey: key, unit: { singular: form.unitSingular, plural: form.unitPlural } });
  return (
    <SettingsSection id="units" title="Units and calendar" description="What a build counts, the program's day, its work days and how builds behave.">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="One unit is a">
          {({ inputId }) => <Input id={inputId} value={form.unitSingular} onChange={(event) => set({ unitSingular: event.target.value })} maxLength={24} disabled={disabled} />}
        </Field>
        <Field label="More than one">
          {({ inputId }) => <Input id={inputId} value={form.unitPlural} onChange={(event) => set({ unitPlural: event.target.value })} maxLength={24} disabled={disabled} />}
        </Field>
        <Field label="Time zone" error={tzLocked && firstClosed ? `${monthLong(firstClosed).split(' ')[0]} is closed, so the time zone cannot change.` : null} hint={lockedMonths > 0 && firstClosed ? `${monthLong(firstClosed).split(' ')[0]} is closed, so the time zone cannot change.` : 'Days and today are counted in this zone in every app.'}>
          {({ inputId }) => <Select id={inputId} value={form.timezone} onValueChange={(timezone) => set({ timezone })} options={zones} disabled={disabled || lockedMonths > 0} />}
        </Field>
      </div>
      <div className="mt-5 flex flex-col gap-4 rounded-lg border border-border-subtle p-4">
        <Switch checked={form.useWorkspace} onCheckedChange={(useWorkspace) => set({ useWorkspace })} label="Use the workspace calendar" description={form.useWorkspace ? `Work days and holidays come from the workspace: ${initial.workingDays.length === 5 ? 'Mon to Fri' : `${initial.workingDays.length} days a week`}, plus its holidays.` : 'This program uses its own work days. Workspace holidays still count.'} disabled={disabled} />
        {form.useWorkspace ? null : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Own work days</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Own work days">
              {WEEK_ORDER.map((day) => {
                const on = form.workingDays.includes(day);
                return (
                  <button key={day} type="button" aria-pressed={on} disabled={disabled} onClick={() => set({ workingDays: on ? form.workingDays.filter((entry) => entry !== day) : [...form.workingDays, day] })} className={cn('h-8 min-w-11 rounded-md border px-2 text-xs font-semibold outline-none focus-visible:outline-2 focus-visible:outline-focus', on ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-default bg-panel text-fg-secondary hover:border-border-strong')}>
                    {WEEKDAY_SHORT[day]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <DateList label="Extra days off" dates={form.extraDaysOff} onChange={(extraDaysOff) => set({ extraDaysOff })} disabled={disabled} />
          <DateList label="Extra work days" dates={form.extraWorkDays} onChange={(extraWorkDays) => set({ extraWorkDays })} disabled={disabled} />
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Build title pattern" hint={`Preview: ${preview}`}>
          {({ inputId }) => <Input id={inputId} value={form.buildTitlePattern} onChange={(event) => set({ buildTitlePattern: event.target.value })} maxLength={120} disabled={disabled} className="font-key" />}
        </Field>
        <Field label="Remind if no output by" hint="A note goes to the person on each build with no output logged.">
          {({ inputId }) => (
            <div className="flex items-center gap-2">
              <Switch checked={form.remindAt !== null} onCheckedChange={(on) => set({ remindAt: on ? (initial.remindAt ?? '18:00') : null })} aria-label="Send a reminder" disabled={disabled} />
              {form.remindAt !== null ? <Input id={inputId} type="time" value={form.remindAt} onChange={(event) => set({ remindAt: event.target.value || null })} disabled={disabled} className="w-32" /> : <span className="text-sm text-fg-muted">Off</span>}
            </div>
          )}
        </Field>
        <Switch checked={form.autoStartOnOutput} onCheckedChange={(autoStartOnOutput) => set({ autoStartOnOutput })} label="Start builds when output is logged" description="A build moves to In progress with its first output." disabled={disabled} />
        <Switch checked={form.autoDoneWhenFull} onCheckedChange={(autoDoneWhenFull) => set({ autoDoneWhenFull })} label="Mark done when full" description="A build is done once built reaches planned. People can change it in the log dialog." disabled={disabled} />
      </div>
      {disabled ? null : (
        <SaveBar
          dirty={dirty}
          pending={pending === 'units'}
          onReset={() => setForm(initial)}
          onSave={() =>
            void save(
              'units',
              () =>
                unwrap(
                  updateProgramSettingsAction({
                    key,
                    expectedVersion: s.version,
                    patch: {
                      unitSingular: form.unitSingular.trim(),
                      unitPlural: form.unitPlural.trim(),
                      ...(form.timezone !== initial.timezone ? { timezone: form.timezone } : {}),
                      workingDays: form.useWorkspace ? null : [...form.workingDays].sort(),
                      extraDaysOff: [...form.extraDaysOff],
                      extraWorkDays: [...form.extraWorkDays],
                      buildTitlePattern: form.buildTitlePattern,
                      autoStartOnOutput: form.autoStartOnOutput,
                      autoDoneWhenFull: form.autoDoneWhenFull,
                      remindAt: form.remindAt,
                    },
                  }),
                ),
              'Units and calendar saved.',
            )
          }
        />
      )}
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Money                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

function MoneySection() {
  const { key, program, capabilities, unit } = useCurrentProgram();
  const { save, pending } = useSave();
  const s = program.settings;
  const initial = useMemo(() => ({ target: centsToDollars(s.monthlyTargetCents), daily: s.dailyTargetUnits ? trimQty(s.dailyTargetUnits) : '', moneyMinRole: s.moneyMinRole, hourly: s.hourlyTimeBasis }), [s]);
  const [form, setForm] = useState(initial);
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setForm(initial);
  }
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const target = form.target.trim() ? readMoney(form.target) : null;
  const daily = readQty(form.daily);
  const errors = { target: target && !target.ok ? target.message : null, daily: daily.ok ? null : daily.message };
  const disabled = !capabilities.canManage;
  return (
    <SettingsSection id="money" title="Money" description="Goals, who sees money, and how hours count.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Monthly target" error={errors.target} hint="Forecast and health compare against it.">
          {({ inputId, invalid }) => <Input id={inputId} value={form.target} onChange={(event) => set({ target: event.target.value })} inputMode="decimal" invalid={invalid} leadingIcon={<span className="text-sm text-fg-muted">$</span>} disabled={disabled} />}
        </Field>
        <Field label={`Daily target (${unit.plural})`} error={errors.daily} hint="Used when money is hidden, and on Floor today.">
          {({ inputId, invalid }) => <Input id={inputId} value={form.daily} onChange={(event) => set({ daily: event.target.value })} inputMode="decimal" invalid={invalid} disabled={disabled} />}
        </Field>
        <Field label="Who sees money" hint="Only people added to this program count. Workspace members who are not added see units only.">
          {({ inputId }) => (
            <Select
              id={inputId}
              value={form.moneyMinRole}
              onValueChange={(moneyMinRole) => set({ moneyMinRole: moneyMinRole as ProjectRole })}
              disabled={disabled}
              options={[
                { value: 'owner', label: 'Owners only' },
                { value: 'editor', label: 'Editors and owners' },
                { value: 'viewer', label: 'Everyone in the program' },
              ]}
            />
          )}
        </Field>
        <Field label="Hours that count for the per hour line">
          {() => (
            <ToggleGroup
              label="Hours that count"
              value={form.hourly}
              onValueChange={(hourly) => set({ hourly })}
              options={[
                { value: 'billable', label: 'Billable time', disabled },
                { value: 'all', label: 'All time', disabled },
              ]}
            />
          )}
        </Field>
        <Field label="Currency" hint="Display only. Every app shows the same currency.">
          {({ inputId }) => <Input id={inputId} value={s.currency} readOnly disabled />}
        </Field>
      </div>
      {disabled ? <p className="mt-4 text-xs text-fg-muted">Only program owners change money settings.</p> : null}
      {disabled ? null : (
        <SaveBar
          dirty={dirty}
          pending={pending === 'money'}
          onReset={() => setForm(initial)}
          onSave={() => {
            if (errors.target || errors.daily) return;
            void save(
              'money',
              () =>
                unwrap(
                  updateProgramSettingsAction({
                    key,
                    expectedVersion: s.version,
                    patch: { monthlyTargetCents: target && target.ok ? target.cents : null, dailyTargetUnits: daily.ok ? (daily.qty ?? null) : null, moneyMinRole: form.moneyMinRole, hourlyTimeBasis: form.hourly },
                  }),
                ),
              'Money settings saved.',
            );
          }}
        />
      )}
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Month close                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function MonthRow({ month, onReopen }: { readonly month: IsoMonth; readonly onReopen: (month: IsoMonth) => void }) {
  const { key, program, today, capabilities } = useCurrentProgram();
  const router = useRouter();
  const people = usePeople();
  const closed = program.locks.programClosed.includes(month);
  const pulse = program.locks.pulseClosed.includes(month);
  const ended = lastDayOfMonth(month) < today;
  const checklist = useCloseChecklist(key, month, { enabled: ended });
  const data = checklist.data;
  const ready = data ? data.items.every((item) => !item.required || item.ok || item.key === 'adjustments') : false;
  const closer = data?.closedBy ? (people.data ?? []).find((person) => person.id === data.closedBy)?.name.split(' ')[0] : null;
  const state = closed ? `Closed${closer ? ` by ${closer}` : ''}${data?.closedAt ? ` on ${shortDate(data.closedAt.slice(0, 10))}` : ''}` : pulse ? 'Closed in Pulse' : !ended ? 'Open' : checklist.isLoading ? 'Checking' : ready ? 'Ready to close' : 'Open';
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5" data-testid={`close-month-${month}`}>
      <span className="w-36 text-sm font-medium text-fg">{monthLong(month)}</span>
      <Badge tone={closed || pulse ? 'neutral' : ready ? 'success' : 'outline'} size="sm" icon={closed || pulse ? <Lock aria-hidden /> : ready ? <CheckCircle2 aria-hidden /> : undefined}>
        {state}
      </Badge>
      {data?.totalCents && (closed || ended) ? <span className="text-xs text-fg-muted tabular-nums">{formatCents(data.totalCents, { cents: true })}</span> : null}
      <span className="ml-auto flex gap-1.5">
        {capabilities.canClose && ended && !closed ? (
          <Button size="sm" variant={ready ? 'primary' : 'secondary'} onClick={() => router.push(`/programs/${key}?close=${month}`)}>
            <CalendarCheck2 aria-hidden />
            Close {monthLong(month).split(' ')[0]}
          </Button>
        ) : null}
        {closed && data?.canReopen ? (
          <Button size="sm" variant="ghost" onClick={() => onReopen(month)}>
            Reopen
          </Button>
        ) : null}
      </span>
    </li>
  );
}

function MonthCloseSection() {
  const { program, today } = useCurrentProgram();
  const [reopening, setReopening] = useState<IsoMonth | null>(null);
  const months = closeMonthsFor(program.startDate, today);
  return (
    <SettingsSection id="close" title="Month close" description="Closing a month locks its output, prices and fees and saves its total. Owners can reopen it with a reason.">
      {months.length === 0 ? (
        <p className="text-sm text-fg-muted">The program has not started yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {months.map((month) => (
            <MonthRow key={month} month={month} onReopen={setReopening} />
          ))}
        </ul>
      )}
      {reopening ? <ReopenMonthDialog month={reopening} open onOpenChange={(open) => (open ? null : setReopening(null))} /> : null}
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* People                                                                                         */
/* ---------------------------------------------------------------------------------------------- */

function PeopleSection() {
  const { key, program, capabilities } = useCurrentProgram();
  const { user } = useShell();
  const people = usePeople();
  const { save } = useSave();
  const [role, setRole] = useState<ProjectRole>('editor');
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const canManage = capabilities.canManage;
  const owners = program.members.filter((member) => member.role === 'owner');
  const candidates = (people.data ?? []).filter((person) => !program.members.some((member) => member.userId === person.id));
  return (
    <SettingsSection
      id="people"
      title={`People (${program.members.length})`}
      description={`Members get notified and can be assigned builds. Money shows for ${program.settings.moneyMinRole === 'owner' ? 'owners' : program.settings.moneyMinRole === 'editor' ? 'editors and owners' : 'everyone added'}.`}
      action={
        canManage ? (
          <div className="flex items-center gap-2">
            <Select size="sm" aria-label="Role for new people" value={role} onValueChange={(value) => setRole(value as ProjectRole)} options={PROJECT_ROLES.map((entry) => ({ value: entry, label: `as ${PROJECT_ROLE_LABELS[entry]}` }))} className="w-32" />
            <UserPicker
              multiple
              people={candidates}
              meId={user.id}
              value={[]}
              onChange={(ids) => {
                if (ids.length) void save('people', () => unwrap(addProjectMembersAction({ projectId: program.id, members: ids.map((userId) => ({ userId, role })) })), ids.length === 1 ? `Added to ${key}.` : `Added ${ids.length} people.`);
              }}
              trigger={
                <Button size="sm" leadingIcon={<UserPlus aria-hidden />} disabled={candidates.length === 0}>
                  Add people
                </Button>
              }
            />
          </div>
        ) : null
      }
    >
      <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {program.members.map((member) => {
          const lastOwner = member.role === 'owner' && owners.length <= 1;
          return (
            <li key={member.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap">
              <div className="min-w-0 flex-1">
                <PersonAvatar userId={member.userId} showName />
                <p className="ml-7 truncate text-xs text-fg-muted">
                  {member.person.email}
                  {member.userId === user.id ? ' · you' : ''}
                </p>
              </div>
              <Tooltip content={lastOwner ? 'Every program needs an owner. Make someone else owner first.' : ROLE_HELP[member.role]}>
                <span>
                  <Select
                    size="sm"
                    aria-label={`Role for ${member.person.name}`}
                    value={member.role}
                    disabled={!canManage || lastOwner}
                    onValueChange={(next) => void save('people', () => unwrap(updateProjectMemberRoleAction({ projectId: program.id, userId: member.userId, role: next as ProjectRole })), `${member.person.name} is now ${PROJECT_ROLE_LABELS[next as ProjectRole].toLowerCase()}.`)}
                    options={PROJECT_ROLES.map((entry) => ({ value: entry, label: PROJECT_ROLE_LABELS[entry], description: ROLE_HELP[entry] }))}
                    className="w-32"
                  />
                </span>
              </Tooltip>
              {canManage && !lastOwner ? <IconButton label={`Remove ${member.person.name}`} icon={<Trash2 aria-hidden />} size="sm" onClick={() => setRemoving({ id: member.userId, name: member.person.name })} /> : <span className="w-7" />}
            </li>
          );
        })}
      </ul>
      {!canManage ? <p className="mt-3 text-xs text-fg-muted">Only program owners add people or change roles.</p> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
        title={removing ? `Remove ${removing.name}?` : 'Remove this person?'}
        description="They stop getting notes for this program. Builds assigned to them keep their assignee."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (!removing) return;
          const person = removing;
          setRemoving(null);
          void save('people', () => unwrap(removeProjectMemberAction({ projectId: program.id, userId: person.id })), `Removed ${person.name}.`);
        }}
      />
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Pulse check                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function PulseCheckSection() {
  const { key, today, variantById } = useCurrentProgram();
  const month = monthOf(today);
  const summary = useProgramSummary(key, month);
  const pulse = useProgramPulse(key);
  const parity = summary.data?.pulse;
  if (summary.isLoading) return <Skeleton height={120} rounded="lg" />;
  if (!parity || !parity.job) return null;
  const pulseRows = new Map((pulse.data?.stamped?.byVariant ?? []).map((row) => [row.variantId ?? 'none', row]));
  const rows = (summary.data?.byVariant ?? []).map((row) => {
    const other = pulseRows.get(row.variantId ?? 'none');
    const projects = row.perUnitCents ?? '0';
    const theirs = other?.revenueCents ?? null;
    return { id: row.variantId ?? 'none', name: row.variantId ? (variantById.get(row.variantId)?.name ?? row.name) : row.name, projects, pulse: theirs, units: row.units, pulseUnits: other?.units ?? null, match: theirs !== null && BigInt(theirs) === BigInt(projects) };
  });
  const matches = parity.state === 'matches';
  return (
    <SettingsSection
      id="pulse"
      title="Pulse check"
      description={`Projects and Pulse read the same stored numbers for ${parity.job.number}. This shows they agree.`}
      action={
        <a href={parity.job.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-fg-link hover:underline">
          Open in Pulse
        </a>
      }
    >
      <p className={cn('flex flex-wrap items-center gap-2 text-sm', matches ? 'text-success-text' : 'text-warning-text')} data-testid="pulse-check-line">
        {matches ? <CheckCircle2 aria-hidden className="size-4" /> : <TriangleAlert aria-hidden className="size-4" />}
        <span className="text-fg">
          This month in Projects {formatCents(parity.projectsCents, { cents: true })} · in Pulse {formatCents(parity.pulseCents, { cents: true })} · <span className={cn('font-semibold', matches ? 'text-success-text' : 'text-warning-text')}>{matches ? 'Matches' : parity.text}</span>
        </span>
      </p>
      {parity.lastSyncAt ? <p className="mt-1 text-xs text-fg-muted">Last sync {new Date(parity.lastSyncAt.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p> : null}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border-subtle">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-sunken/60 text-left text-xs text-fg-muted">
              <th scope="col" className="px-3 py-2 font-medium">Variant</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Units</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Projects</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Pulse</th>
              <th scope="col" className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border-subtle last:border-b-0">
                <td className="px-3 py-1.5 text-fg">{row.name}</td>
                <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">{formatQty(row.units)}</td>
                <td className="px-3 py-1.5 text-right text-fg tabular-nums">{formatCents(row.projects, { cents: true })}</td>
                <td className="px-3 py-1.5 text-right text-fg tabular-nums">{formatCents(row.pulse, { cents: true, empty: 'Not synced' })}</td>
                <td className="px-3 py-1.5">{row.match ? <Badge tone="success" size="sm">Matches</Badge> : <Badge tone="warning" size="sm">Different</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Danger zone                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function DangerSection() {
  const { program, key } = useCurrentProgram();
  const [open, setOpen] = useState<'archive' | 'delete' | null>(null);
  const closed = program.locks.programClosed.length > 0;
  return (
    <SettingsSection id="danger" title="Danger zone" description="Archive hides the program and keeps everything. Delete removes it.">
      <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-danger/30">
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">Archive {key}</p>
            <p className="text-xs text-fg-muted">Schedules stop. Builds, output and statements stay. You can restore it later.</p>
          </div>
          <Button variant="secondary" onClick={() => setOpen('archive')}>
            <Archive aria-hidden />
            Archive
          </Button>
        </li>
        <li className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">Delete {key}</p>
            <p className="text-xs text-fg-muted">{closed ? 'A month is closed, so this program cannot be deleted. Archive it instead.' : 'Only when no month is closed. You type the key to confirm.'}</p>
          </div>
          <Button variant="danger" disabled={closed} onClick={() => setOpen('delete')}>
            <Trash2 aria-hidden />
            Delete
          </Button>
        </li>
      </ul>
      {open === 'archive' ? <ArchiveProgramDialog program={program} open onOpenChange={(next) => (next ? null : setOpen(null))} /> : null}
      {open === 'delete' ? <DeleteProgramDialog program={program} open onOpenChange={(next) => (next ? null : setOpen(null))} /> : null}
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Tab                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

export function SettingsTab() {
  const { capabilities, program, moneyHidden } = useCurrentProgram();
  const pathname = usePathname();
  const sections = settingsSectionsFor({ canManage: capabilities.canManage, seesSync: capabilities.seesSync, moneyHidden, hasPulseJob: Boolean(program.pulseJob) });
  return (
    <div className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[180px_minmax(0,1fr)]" data-testid="settings-tab">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <ul className="sticky top-4 flex flex-col gap-0.5 text-sm">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`${pathname}#${section.id}`} className="block rounded-md px-2.5 py-1.5 text-fg-secondary hover:bg-hover hover:text-fg">
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-5">
        <GeneralSection />
        <UnitsCalendarSection />
        {moneyHidden ? null : <MoneySection />}
        {moneyHidden ? null : <MonthCloseSection />}
        <PeopleSection />
        {sections.some((section) => section.id === 'pulse') ? <PulseCheckSection /> : null}
        {capabilities.canManage ? <DangerSection /> : null}
      </div>
    </div>
  );
}

