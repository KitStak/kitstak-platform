'use client';
/**
 * Schedule editor (docs/programs/SPEC.md 5.4 Step 4, 5.13): the switch, name, Repeats (with day
 * chips and the every few weeks stepper), first and last day, Make builds ahead, Skip days off,
 * "What to build each time" (include, qty, Vary by day, assignee; Same qty for all, Use default
 * qty) and the preview: a 2 week calendar, the next 5 runs (skipped holidays named) and the count
 * the server will make now ("40 builds and 4,000 kits in the next 7 days").
 */
import { Fragment, useMemo, useState } from 'react';
import { CalendarDays, Minus, Plus } from 'lucide-react';
import type { ProgramCalendar } from '@kitstak/programs-engine';
import { Button, Checkbox, Field, IconButton, Input, IsoDatePicker, Popover, PopoverContent, PopoverTrigger, Select, Switch, UserPicker, cn, type PickerPerson } from '@/components/ui';
import type { IsoDate, UnitLabel } from '@/lib/program-types';
import { VariantDot } from '../kit/chips';
import { VaryByDayRow } from './vary-by-day-row';
import { WEEKDAY_SHORT, WEEK_ORDER, dayText, generationCount, generationText, nextRunsText, scheduleProblems, twoWeeks, type ScheduleEditorValue, type ScheduleLineValue, type SchedulePatternValue } from './schedule-model';

export interface ScheduleVariant {
  readonly key: string;
  readonly name: string;
  readonly color: string | null;
  readonly defaultQty: string | null;
}

export interface ScheduleEditorProps {
  readonly value: ScheduleEditorValue;
  readonly onChange: (value: ScheduleEditorValue) => void;
  readonly variants: readonly ScheduleVariant[];
  readonly calendar: ProgramCalendar;
  readonly holidays?: readonly { readonly date: IsoDate; readonly name: string }[];
  /** Today in the program time zone. */
  readonly today: IsoDate;
  readonly unit: UnitLabel;
  readonly people?: readonly PickerPerson[];
  /** Show problems (after Continue was pressed). */
  readonly showErrors?: boolean;
  /** Hide the on and off switch (the Schedule tab edits an existing schedule). */
  readonly hideSwitch?: boolean;
  readonly disabled?: boolean;
}

const PATTERNS: readonly { readonly value: SchedulePatternValue; readonly label: string; readonly description: string }[] = [
  { value: 'daily', label: 'Every day', description: 'Seven days a week' },
  { value: 'weekdays', label: 'Every work day', description: 'Uses the program work days' },
  { value: 'custom_days', label: 'On certain days', description: 'Pick the days of the week' },
  { value: 'every_n_weeks', label: 'Every few weeks', description: 'Pick the days and how often' },
];

function Stepper({ value, min, max, onChange, label, disabled }: { readonly value: number; readonly min: number; readonly max: number; readonly onChange: (value: number) => void; readonly label: string; readonly disabled?: boolean }) {
  return (
    <span className="inline-flex h-8 items-center rounded-md border border-border-input bg-panel" role="group" aria-label={label}>
      <IconButton label={`Fewer ${label.toLowerCase()}`} size="sm" icon={<Minus aria-hidden />} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} />
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value.replace(/\D/g, ''), 10);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
        className="h-full w-10 bg-transparent text-center text-sm font-medium tabular-nums outline-none"
      />
      <IconButton label={`More ${label.toLowerCase()}`} size="sm" icon={<Plus aria-hidden />} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} />
    </span>
  );
}

function DayChips({ days, onChange, workingDays, disabled }: { readonly days: readonly number[]; readonly onChange: (days: number[]) => void; readonly workingDays: readonly number[]; readonly disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
      {WEEK_ORDER.map((day) => {
        const on = days.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? days.filter((entry) => entry !== day) : [...days, day])}
            className={cn(
              'h-8 min-w-11 rounded-md border px-2 text-xs font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-focus',
              on ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-default bg-panel text-fg-secondary hover:border-border-strong',
              !workingDays.includes(day) && !on && 'text-fg-muted',
            )}
          >
            {WEEKDAY_SHORT[day]}
          </button>
        );
      })}
    </div>
  );
}

function SameQtyPopover({ onApply, disabled }: { readonly onApply: (qty: string) => void; readonly disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          Same qty for all
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3" align="end">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onApply(text.replace(/,/g, '').trim());
            setOpen(false);
          }}
        >
          <Input autoFocus inputMode="decimal" aria-label="Qty for every variant" value={text} onChange={(event) => setText(event.target.value)} placeholder="100" />
          <Button type="submit" size="sm" disabled={!/^\d{1,8}(\.\d{1,3})?$/.test(text.replace(/,/g, '').trim())}>
            Apply to all
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function ScheduleEditor({ value, onChange, variants, calendar, holidays = [], today, unit, people = [], showErrors, hideSwitch, disabled }: ScheduleEditorProps) {
  const [openDays, setOpenDays] = useState<readonly string[]>(() => value.lines.filter((line) => line.qtyByWeekday).map((line) => line.variantKey));
  const problems = showErrors ? scheduleProblems(value) : {};
  const set = (patch: Partial<ScheduleEditorValue>) => onChange({ ...value, ...patch });
  const lineByKey = new Map(value.lines.map((line) => [line.variantKey, line]));
  const setLine = (key: string, patch: Partial<ScheduleLineValue>) => {
    const existing = lineByKey.get(key) ?? { variantKey: key, include: true, qty: '', qtyByWeekday: null, assigneeId: null };
    const next = { ...existing, ...patch };
    set({ lines: lineByKey.has(key) ? value.lines.map((line) => (line.variantKey === key ? next : line)) : [...value.lines, next] });
  };
  const count = useMemo(() => generationCount(value, calendar, today), [value, calendar, today]);
  const days = useMemo(() => twoWeeks(value, calendar, today, today), [value, calendar, today]);
  const next = useMemo(() => nextRunsText(value, calendar, today, holidays), [value, calendar, today, holidays]);
  const off = !value.enabled;

  return (
    <div className="flex flex-col gap-5" data-testid="schedule-editor">
      {!hideSwitch ? (
        <label className="flex items-center gap-3 rounded-lg border border-border-default bg-panel px-3.5 py-3">
          <Switch checked={value.enabled} onCheckedChange={(enabled) => set({ enabled })} disabled={disabled} aria-label="Make builds on a schedule" />
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-fg">Make builds on a schedule</span>
            <span className="text-xs text-fg-muted">Builds are made ahead of time, so the floor sees them in the run.</span>
          </span>
        </label>
      ) : null}

      <div className={cn('flex flex-col gap-5', off && 'pointer-events-none opacity-50')} aria-disabled={off || undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={problems.name} hint="This is the run name everywhere.">
            {(ids) => <Input id={ids.inputId} value={value.name} onChange={(event) => set({ name: event.target.value })} maxLength={80} disabled={disabled || off} />}
          </Field>
          <Field label="Repeats" required error={problems.days}>
            {(ids) => (
              <Select
                id={ids.inputId}
                value={value.pattern}
                disabled={disabled || off}
                onValueChange={(pattern) => set({ pattern: pattern as SchedulePatternValue, days: value.days.length ? value.days : calendar.workingDays })}
                options={PATTERNS.map((option) => ({ value: option.value, label: option.label, description: option.description }))}
              />
            )}
          </Field>
        </div>
        {value.pattern === 'custom_days' || value.pattern === 'every_n_weeks' ? (
          <div className="flex flex-wrap items-center gap-3">
            {value.pattern === 'every_n_weeks' ? (
              <span className="inline-flex items-center gap-2 text-sm text-fg-secondary">
                Every
                <Stepper value={value.intervalWeeks} min={1} max={12} onChange={(intervalWeeks) => set({ intervalWeeks })} label="Weeks" disabled={disabled || off} />
                {value.intervalWeeks === 1 ? 'week on' : 'weeks on'}
              </span>
            ) : null}
            <DayChips days={value.days} onChange={(days) => set({ days })} workingDays={calendar.workingDays} disabled={disabled || off} />
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="First day" required error={problems.startsOn}>
            {(ids) => <IsoDatePicker id={ids.inputId} value={value.startsOn} onChange={(startsOn) => set({ startsOn: startsOn ?? value.startsOn })} disabled={disabled || off} />}
          </Field>
          <Field label="Last day" error={problems.endsOn} hint="Optional">
            {(ids) => <IsoDatePicker id={ids.inputId} value={value.endsOn} onChange={(endsOn) => set({ endsOn })} clearable disabled={disabled || off} />}
          </Field>
          <Field label="Make builds ahead" hint={value.leadDays === 0 ? 'Builds are made each morning for that day.' : `Builds from today through the next ${value.leadDays} ${value.leadDays === 1 ? 'day are' : 'days are'} made for you.`}>
            {() => (
              <span className="inline-flex items-center gap-2 text-sm text-fg-secondary">
                <Stepper value={value.leadDays} min={0} max={60} onChange={(leadDays) => set({ leadDays })} label="Days" disabled={disabled || off} />
                days
              </span>
            )}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <Switch checked={value.skipHolidays} onCheckedChange={(skipHolidays) => set({ skipHolidays })} disabled={disabled || off} aria-label="Skip days off" />
          Skip days off
        </label>

        <section className="flex flex-col gap-2" aria-label="What to build each time">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">What to build each time</h3>
            <span className="flex items-center gap-1">
              <SameQtyPopover disabled={disabled || off} onApply={(qty) => set({ lines: variants.map((variant) => ({ ...(lineByKey.get(variant.key) ?? { variantKey: variant.key, include: true, qtyByWeekday: null, assigneeId: null }), qty })) })} />
              <Button variant="ghost" size="sm" disabled={disabled || off} onClick={() => set({ lines: variants.map((variant) => ({ ...(lineByKey.get(variant.key) ?? { variantKey: variant.key, include: true, qtyByWeekday: null, assigneeId: null }), qty: variant.defaultQty ? variant.defaultQty.replace(/\.0+$/, '') : '' })) })}>
                Use default qty
              </Button>
            </span>
          </div>
          {problems.lines ? (
            <p className="text-xs text-danger-text" role="alert">
              {problems.lines}
            </p>
          ) : null}
          <div className="overflow-auto rounded-lg border border-border-subtle">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-sunken text-left text-2xs font-semibold tracking-wide text-fg-muted uppercase">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <span className="sr-only">Include</span>
                  </th>
                  <th className="px-2 py-2">Variant</th>
                  <th className="w-28 px-2 py-2 text-right">Qty</th>
                  <th className="w-28 px-2 py-2">Vary by day</th>
                  {people.length ? <th className="w-44 px-2 py-2">Assignee</th> : null}
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => {
                  const line = lineByKey.get(variant.key) ?? { variantKey: variant.key, include: false, qty: '', qtyByWeekday: null, assigneeId: null };
                  const open = openDays.includes(variant.key);
                  const problem = problems[`line:${variant.key}`];
                  return (
                    <Fragment key={variant.key}>
                      <tr className={cn('border-t border-border-subtle', !line.include && 'opacity-60')} data-testid="schedule-line">
                        <td className="px-3 py-1.5">
                          <Checkbox checked={line.include} disabled={disabled || off} onCheckedChange={(checked) => setLine(variant.key, { include: checked === true, qty: line.qty || (variant.defaultQty ?? '').replace(/\.0+$/, '') })} aria-label={`Build ${variant.name}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <VariantDot color={variant.color} />
                            <span className="truncate font-medium text-fg">{variant.name}</span>
                          </span>
                          {problem ? <span className="block text-2xs text-danger-text">{problem}</span> : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Qty for ${variant.name}`}
                            value={line.qty}
                            disabled={disabled || off || !line.include}
                            onChange={(event) => setLine(variant.key, { qty: event.target.value })}
                            className={cn('h-7 w-full rounded-md border bg-panel px-2 text-right text-sm tabular-nums outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] disabled:bg-muted', problem ? 'border-danger' : 'border-border-input hover:border-border-input-hover')}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <label className="inline-flex items-center gap-2 text-xs text-fg-secondary">
                            <Switch
                              checked={open}
                              disabled={disabled || off || !line.include}
                              aria-label={`Vary by day for ${variant.name}`}
                              onCheckedChange={(checked) => {
                                setOpenDays(checked ? [...openDays, variant.key] : openDays.filter((key) => key !== variant.key));
                                if (!checked) setLine(variant.key, { qtyByWeekday: null });
                                else if (!line.qtyByWeekday) setLine(variant.key, { qtyByWeekday: {} });
                              }}
                            />
                            {open ? 'On' : 'Off'}
                          </label>
                        </td>
                        {people.length ? (
                          <td className="px-2 py-1.5">
                            <UserPicker people={[...people]} value={line.assigneeId} onChange={(assigneeId) => setLine(variant.key, { assigneeId })} placeholder="No one" allowNone disabled={disabled || off || !line.include} aria-label={`Assignee for ${variant.name}`} />
                          </td>
                        ) : null}
                      </tr>
                      {open && line.include ? (
                        <tr className="bg-sunken/40">
                          <td />
                          <td colSpan={people.length ? 4 : 3} className="px-2 pt-1 pb-2.5">
                            <VaryByDayRow name={variant.name} baseQty={line.qty} value={line.qtyByWeekday ?? {}} onChange={(qtyByWeekday) => setLine(variant.key, { qtyByWeekday })} workingDays={calendar.workingDays} disabled={disabled || off} className="max-w-md" />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-3.5" aria-label="Preview" data-testid="schedule-preview">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <CalendarDays aria-hidden className="size-4 text-icon" />
            Preview
          </div>
          <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Next two weeks">
            {WEEK_ORDER.map((day) => (
              <span key={day} role="columnheader" className="text-2xs font-semibold text-fg-muted uppercase">
                {WEEKDAY_SHORT[day]}
              </span>
            ))}
            {days.map((day) => (
              <span
                key={day.date}
                role="gridcell"
                aria-label={`${dayText(day.date)}${day.occurs ? ', builds' : day.skipped ? ', skipped day off' : ', no builds'}`}
                className={cn('flex h-10 flex-col items-center justify-center gap-0.5 rounded-md border text-xs tabular-nums', day.isToday ? 'border-primary' : 'border-transparent', !day.workDay && 'bg-sunken text-fg-muted', day.date < today && 'opacity-50')}
              >
                {Number(day.date.slice(8, 10))}
                {day.occurs ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : day.skipped ? <span aria-hidden className="h-0.5 w-2.5 rounded-full bg-warning" /> : <span aria-hidden className="size-1.5" />}
              </span>
            ))}
          </div>
          <p className="text-xs text-fg-secondary" data-testid="schedule-next-runs">
            {next}
          </p>
          <p className="text-sm font-semibold text-fg" data-testid="schedule-generation">
            {generationText(count, unit, value.leadDays)}
          </p>
        </section>
      </div>
    </div>
  );
}
