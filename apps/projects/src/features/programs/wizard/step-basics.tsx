'use client';
/**
 * Step 1 Basics (docs/programs/SPEC.md 5.4): appearance, name and key (live suggestion and taken
 * check), customer, description, owner, dates, time zone, what builds count, work days and the
 * monthly target. Fields fall back to the prefill until they are edited.
 */
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { ArrowLeft, Building2, CalendarDays, Handshake, LayoutTemplate, Copy, X } from 'lucide-react';
import { formatCents, shortDate } from '@kitstak/programs-engine';
import { Button, Combobox, Field, Input, IsoDatePicker, Switch, Textarea, ToggleGroup, UserPicker, cn } from '@/components/ui';
import { usePeople } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import { suggestProjectKey } from '@/lib/task-key';
import { useShell } from '@/features/shell/shell-context';
import { AppearancePicker } from '@/features/projects/appearance-picker';
import { WEEK_ORDER, WEEKDAY_SHORT } from '@/features/programs/editors';
import { UNIT_CHOICES, unitOf, type UnitChoice } from './wizard-model';
import type { StepProps } from './wizard-types';

export function timeZoneOptions(current: string): { value: string; label: string; description: string }[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  if (!zones.includes(current)) zones = [current, ...zones];
  return zones.map((zone) => {
    const [region, ...rest] = zone.split('/');
    return { value: zone, label: rest.length ? rest.join(' / ').replace(/_/g, ' ') : zone, description: rest.length ? (region ?? '') : 'Other' };
  });
}

/** "GLOVE is taken by the project Glove research. Try GLOVK." */
export function takenMessages(taken: readonly { readonly key: string; readonly name: string; readonly kind: 'project' | 'program' }[], name: string): Map<string, string> {
  const keys = new Set(taken.map((row) => row.key));
  const out = new Map<string, string>();
  for (const row of taken) {
    const others = new Set(keys);
    const next = suggestProjectKey(name || row.key, others);
    out.set(row.key, `${row.key} is taken by the ${row.kind} ${row.name}.${next && !keys.has(next) ? ` Try ${next}.` : ''}`);
  }
  return out;
}

function DateList({ label, hint, dates, onChange, testId }: { readonly label: string; readonly hint: string; readonly dates: readonly string[]; readonly onChange: (dates: string[]) => void; readonly testId: string }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span className="text-xs font-medium text-fg-secondary">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {dates.map((date) => (
          <span key={date} className="inline-flex h-7 items-center gap-1 rounded-full border border-border-subtle bg-panel pr-1 pl-2.5 text-xs text-fg">
            {shortDate(date)} {date.slice(0, 4)}
            <button type="button" aria-label={`Remove ${shortDate(date)}`} onClick={() => onChange(dates.filter((entry) => entry !== date))} className="inline-flex size-5 items-center justify-center rounded-full text-icon outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus">
              <X aria-hidden className="size-3" />
            </button>
          </span>
        ))}
        <IsoDatePicker value={null} onChange={(date) => (date && !dates.includes(date) ? onChange([...dates, date].sort()) : undefined)} placeholder="Add a day" aria-label={`Add to ${label.toLowerCase()}`} className="w-36" />
      </div>
      <span className="text-2xs text-fg-muted">{hint}</span>
    </div>
  );
}

export function WorkDayChips({ value, onChange, label }: { readonly value: readonly number[]; readonly onChange: (days: number[]) => void; readonly label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {WEEK_ORDER.map((day) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((entry) => entry !== day) : [...value, day].sort())}
            className={cn('h-8 min-w-12 rounded-md border px-2 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus', on ? 'border-border-strong bg-selected text-fg' : 'border-border-subtle bg-panel text-fg-muted hover:border-border-default hover:text-fg')}
          >
            {WEEKDAY_SHORT[day]}
          </button>
        );
      })}
    </div>
  );
}

/** "Mon to Fri · 2 holidays". */
export function workWeekText(days: readonly number[], holidays: number): string {
  const sorted = WEEK_ORDER.filter((day) => days.includes(day));
  let text = sorted.map((day) => WEEKDAY_SHORT[day]).join(', ');
  const contiguous = sorted.length > 2 && sorted.every((day, index) => index === 0 || WEEK_ORDER.indexOf(day) === WEEK_ORDER.indexOf(sorted[index - 1]!) + 1);
  if (contiguous) text = `${WEEKDAY_SHORT[sorted[0]!]} to ${WEEKDAY_SHORT[sorted.at(-1)!]}`;
  if (sorted.length === 0) text = 'No work days';
  return `${text} · ${holidays} ${holidays === 1 ? 'holiday' : 'holidays'}`;
}

function StartingFrom({ icon, label, title, detail, onChange }: { readonly icon: ReactNode; readonly label: string; readonly title: string; readonly detail?: string | null; readonly onChange: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-panel p-3 shadow-xs" data-testid="starting-from">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-icon [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="truncate text-sm font-semibold text-fg" title={[title, detail].filter(Boolean).join(' · ')}>
          {title}
          {detail ? <span className="font-normal text-fg-secondary"> · {detail}</span> : null}
        </p>
      </div>
      <Button variant="ghost" size="sm" leadingIcon={<ArrowLeft aria-hidden />} onClick={onChange} type="button">
        Change
      </Button>
    </div>
  );
}

export interface StepBasicsProps extends StepProps {
  readonly onChangeStart: () => void;
  readonly moneyVisible: boolean;
}

export function StepBasics({ state, set, data, problems, showErrors, onChangeStart, moneyVisible }: StepBasicsProps) {
  const { user, can } = useShell();
  const people = usePeople();
  const b = state.basics;
  const err = (field: string) => (showErrors ? (problems[field] ?? null) : null);
  const zones = useMemo(() => timeZoneOptions(b.timezone), [b.timezone]);
  const takenSet = useMemo(() => new Set(data.taken.map((row) => row.key)), [data.taken]);
  const patch = (change: Partial<typeof b>) => set((s) => ({ ...s, basics: { ...s.basics, ...change } }));
  const keyTaken = takenSet.has(b.key.toUpperCase()) ? takenMessages(data.taken, b.name).get(b.key.toUpperCase()) : null;
  const customerOptions = data.customers.map((customer) => ({ value: `${customer.kind}:${customer.id}`, label: customer.name, description: customer.kind === 'core' ? 'Customer' : 'CRM account', icon: customer.kind === 'core' ? <Building2 aria-hidden /> : <Handshake aria-hidden /> }));
  const customerValue = b.customer ? `${b.customer.kind}:${b.customer.id}` : null;
  if (b.customer && !customerOptions.some((option) => option.value === customerValue)) customerOptions.unshift({ value: customerValue!, label: b.customer.name, description: b.customer.kind === 'core' ? 'Customer' : 'CRM account', icon: b.customer.kind === 'core' ? <Building2 aria-hidden /> : <Handshake aria-hidden /> });
  const mode = state.start.mode;
  const deal = data.deal;

  return (
    <div className="flex flex-col gap-5" data-testid="wizard-basics">
      {mode === 'deal' && state.start.crmItemTitle ? (
        <StartingFrom
          icon={<Handshake aria-hidden />}
          label="Starting from a won deal"
          title={deal?.accountName ?? state.start.crmItemTitle}
          detail={[deal ? deal.name : null, deal?.valueCents ? formatCents(deal.valueCents) : null, deal?.closeDate ? `Won ${shortDate(deal.closeDate)}` : null].filter(Boolean).join(' · ') || null}
          onChange={onChangeStart}
        />
      ) : mode === 'template' && state.start.templateName ? (
        <StartingFrom icon={<LayoutTemplate aria-hidden />} label="Starting from a template" title={state.start.templateName} onChange={onChangeStart} />
      ) : mode === 'copy' && state.start.copyKey ? (
        <StartingFrom icon={<Copy aria-hidden />} label="Copying a program" title={data.programs.find((program) => program.key === state.start.copyKey)?.name ?? state.start.copyKey} detail={state.start.copyKey} onChange={onChangeStart} />
      ) : null}

      <div className="flex items-start gap-4">
        <div className="pt-6">
          <AppearancePicker color={b.color} icon={b.icon} size={44} onChange={(next) => patch({ ...(next.color ? { color: next.color } : {}), ...(next.icon ? { icon: next.icon } : {}) })} />
        </div>
        <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
          <Field label="Program name" required hint="For example Glove kitting" error={err('name')}>
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                value={b.name}
                size="lg"
                maxLength={80}
                aria-describedby={describedBy}
                invalid={invalid}
                autoFocus
                data-field="name"
                data-testid="program-name"
                onChange={(event) => {
                  const name = event.target.value;
                  set((s) => ({ ...s, basics: { ...s.basics, name, key: s.basics.keyEdited ? s.basics.key : suggestProjectKey(name, takenSet) } }));
                }}
              />
            )}
          </Field>
          <Field label="Key" required hint={b.key ? `Build ids: ${b.key}-1, ${b.key}-2` : 'Short code for build ids'} error={err('key') ?? keyTaken ?? null}>
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                value={b.key}
                size="lg"
                aria-describedby={describedBy}
                invalid={invalid}
                className="font-key uppercase"
                data-field="key"
                data-testid="program-key"
                onChange={(event) => patch({ key: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6), keyEdited: true })}
              />
            )}
          </Field>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" hint="Optional. The shared customer list and CRM accounts.">
          {({ inputId }) => (
            <Combobox
              id={inputId}
              options={[{ value: 'none', label: 'No customer' }, ...customerOptions]}
              value={customerValue ?? 'none'}
              placeholder="No customer"
              searchPlaceholder="Search customers and accounts"
              onValueChange={(value) => {
                if (!value || value === 'none') return patch({ customer: null });
                const [kind, ...rest] = value.split(':');
                const id = rest.join(':');
                const found = data.customers.find((entry) => entry.kind === kind && entry.id === id) ?? (b.customer?.id === id ? b.customer : null);
                patch({ customer: found ? { kind: found.kind, id: found.id, name: found.name } : null });
              }}
              className="h-10"
            />
          )}
        </Field>
        <Field label="What do builds count?" error={err('unit')}>
          {() => (
            <div className="flex flex-col gap-2">
              <ToggleGroup label="What do builds count?" value={b.unitChoice} onValueChange={(value: UnitChoice) => patch({ unitChoice: value })} options={UNIT_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))} className="flex-wrap" />
              {b.unitChoice === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input aria-label="One" value={b.customOne} onChange={(event) => patch({ customOne: event.target.value.slice(0, 24) })} placeholder="case" />
                  <Input aria-label="Many" value={b.customMany} onChange={(event) => patch({ customMany: event.target.value.slice(0, 24) })} placeholder="cases" />
                </div>
              ) : null}
            </div>
          )}
        </Field>
      </div>

      <Field label="Description" hint="Optional. What you build, for whom, and anything the floor should know.">
        {({ inputId, describedBy }) => <Textarea id={inputId} rows={3} value={b.description} aria-describedby={describedBy} onChange={(event) => patch({ description: event.target.value })} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-secondary">Owner</span>
          <UserPicker people={people.data ?? []} meId={user.id} value={b.ownerId} onChange={(id) => (id ? patch({ ownerId: id }) : undefined)} allowNone={false} className="h-10 w-full" aria-label="Owner" />
          <span className="text-2xs text-fg-muted">Runs the program and manages its people</span>
        </div>
        <Field label="Time zone" hint="Program days start and end in this zone.">
          {({ inputId }) => <Combobox id={inputId} options={zones} value={b.timezone} onValueChange={(value) => (value ? patch({ timezone: value }) : undefined)} searchPlaceholder="Search time zones" className="h-10" />}
        </Field>
        <div className="flex flex-col gap-1.5" data-field="startDate">
          <span className="text-xs font-medium text-fg-secondary">Starts <span className="text-danger-text">*</span></span>
          <IsoDatePicker size="lg" clearable={false} value={b.startDate} onChange={(date) => (date ? set((s) => ({ ...s, basics: { ...s.basics, startDate: date }, price: { ...s.price, effectiveFrom: s.price.effectiveFrom < date ? date : s.price.effectiveFrom }, schedule: { ...s.schedule, startsOn: s.schedule.startsOn < date ? date : s.schedule.startsOn } })) : undefined)} aria-label="Starts" />
          {err('startDate') ? <span role="alert" className="text-2xs font-medium text-danger-text">{err('startDate')}</span> : null}
        </div>
        <div className="flex flex-col gap-1.5" data-field="endDate">
          <span className="text-xs font-medium text-fg-secondary">Ends</span>
          <IsoDatePicker size="lg" value={b.endDate} onChange={(date) => patch({ endDate: date })} placeholder="No end date" clearable aria-label="Ends" />
          {err('endDate') ? <span role="alert" className="text-2xs font-medium text-danger-text">{err('endDate')}</span> : <span className="text-2xs text-fg-muted">Leave empty for an ongoing program</span>}
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" data-field="workingDays">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg"><CalendarDays aria-hidden className="size-4 text-icon" />Work days</h3>
            <p className="text-xs text-fg-muted">{b.useWorkspace ? workWeekText(data.calendar.workingDays, data.calendar.holidays.length) : 'This program sets its own work days.'}</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm text-fg">
            Use the workspace calendar
            <Switch checked={b.useWorkspace} onCheckedChange={(checked) => patch({ useWorkspace: checked, workingDays: checked ? data.calendar.workingDays : b.workingDays.length ? b.workingDays : data.calendar.workingDays })} aria-label="Use the workspace calendar" />
          </label>
        </div>
        {b.useWorkspace ? (
          can('workspace:manage') ? (
            <Link href={routes.calendarSettings()} className="self-start text-xs font-medium text-fg-secondary underline-offset-2 hover:text-fg hover:underline">Edit workspace calendar</Link>
          ) : null
        ) : (
          <WorkDayChips value={b.workingDays} onChange={(days) => patch({ workingDays: days })} label="Work days" />
        )}
        {err('workingDays') ? <span role="alert" className="text-2xs font-medium text-danger-text">{err('workingDays')}</span> : null}
        <div className="grid gap-4 border-t border-border-subtle pt-3 sm:grid-cols-2">
          <DateList label="Days off for this program" hint="Optional. Builds are not planned on these days." dates={b.extraDaysOff} onChange={(dates) => patch({ extraDaysOff: dates })} testId="days-off" />
          <DateList label="Extra work days" hint="Optional. Days the program works even when the calendar is off." dates={b.extraWorkDays} onChange={(dates) => patch({ extraWorkDays: dates })} testId="extra-work-days" />
        </div>
      </section>

      {moneyVisible ? (
        <Field label="Monthly revenue target" hint="Optional. Used for the % of target and health." error={err('target')}>
          {({ inputId, describedBy, invalid }) => (
            <Input id={inputId} value={b.target} inputMode="decimal" aria-describedby={describedBy} invalid={invalid} leadingIcon={<span className="text-sm text-fg-muted">$</span>} onChange={(event) => patch({ target: event.target.value })} containerClassName="sm:w-60" data-field="target" />
          )}
        </Field>
      ) : null}
      <p className="sr-only" aria-live="polite">Counting {unitOf(b).plural}</p>
    </div>
  );
}
