'use client';

/**
 * Wave-rule wizard steps (Logiwa 02 §2): 1.General · 2.Selection · 3.Schedule · 4.Assign.
 * Every step reads/writes the one react-hook-form instance owned by the Wizard.
 */
import * as React from 'react';
import Link from 'next/link';
import type { UseFormReturn } from 'react-hook-form';
import { Clock, Plus, Search, Sparkles, Trash2, UserCheck, Users, UsersRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField, FormSection } from '@/components/ui/form';
import { NumberInput } from '@/components/ui/number-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioCards } from '@/components/ui/radio-cards';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import { TimePicker } from '@/components/ui/time-picker';
import { YesNoToggle } from '@/components/ui/yes-no-toggle';
import { errorTextClass, labelClass } from '@/components/ui/control-styles';
import { cn } from '@/lib/utils';
import type { FilterFieldDef } from '@/components/grid';
import { WEEKDAYS, WAVE_DELETE_METHODS } from '@/lib/enums';
import { ORDER_CONDITION_FIELDS, WAVE_ORDER_BY_OPTIONS } from '@/lib/grid-defs/jobs/conditions';
import { jobTypesCopy } from '@/lib/grid-defs/jobs/copy';
import { WAVE_PRIORITIES, type WaveRuleFormValues } from '@/lib/grid-defs/jobs/forms';
import {
  formatWaveCountdown,
  HIGH_FREQUENCY_RUNS,
  MAX_REPEAT_MINUTES,
  MIN_REPEAT_MINUTES,
  nextRunAt,
  normalizeTimes,
  timesForPeriod,
} from '@/lib/grid-defs/jobs/schedule';
import type { WaveRuleOptions } from '@/server/repositories/wave-rules-options';
import { ConditionsEditor, OrderByEditor, SortableList } from './rule-editors';

export type F = WaveRuleFormValues;
type Form = UseFormReturn<F>;

export const OP_FOR_WAVE: Readonly<Record<string, string | null>> = {
  Picking: 'Picking',
  'AI Job': 'Picking',
  'Cycle Count': 'Count',
  Replenishment: 'Replenishment',
  'Order Merge': null,
};

const DAY_LABELS: Readonly<Record<(typeof WEEKDAYS)[number], string>> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

function errorOf(form: Form, name: string): string | undefined {
  const err = (form.formState.errors as Record<string, { message?: string } | undefined>)[name];
  return err?.message;
}

/* ------------------------------------------------------------- checkable ordered list */

interface CheckItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | null;
}

/** Numbered, checkable, drag-sortable list. Selected ids keep the on-screen precedence. */

export function CheckableOrderList({
  items,
  selected,
  onChange,
  ariaLabel,
  invalid,
}: {
  readonly items: readonly CheckItem[];
  readonly selected: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly ariaLabel: string;
  readonly invalid?: boolean;
}) {
  const [order, setOrder] = React.useState<string[]>(() => [
    ...selected.filter((id) => items.some((i) => i.id === id)),
    ...items.map((i) => i.id).filter((id) => !selected.includes(id)),
  ]);
  React.useEffect(() => {
    setOrder((prev) => {
      const known = prev.filter((id) => items.some((i) => i.id === id));
      return [...known, ...items.map((i) => i.id).filter((id) => !known.includes(id))];
    });
  }, [items]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = order.map((id) => byId.get(id)).filter((i): i is CheckItem => Boolean(i));
  const emit = (nextOrder: readonly string[], nextSelected: ReadonlySet<string>) =>
    onChange(nextOrder.filter((id) => nextSelected.has(id)));
  const sel = new Set(selected);
  return (
    <div className={cn('rounded-lg p-1', invalid && 'ring-2 ring-danger/60')}>
      <SortableList
        ariaLabel={ariaLabel}
        items={rows}
        getId={(i) => i.id}
        onReorder={(next) => {
          const ids = next.map((i) => i.id);
          setOrder(ids);
          emit(ids, sel);
        }}
        renderItem={(item) => (
          <Checkbox
            checked={sel.has(item.id)}
            onCheckedChange={(c) => {
              const nextSel = new Set(sel);
              if (c === true) nextSel.add(item.id);
              else nextSel.delete(item.id);
              emit(order, nextSel);
            }}
            label={item.label}
            description={item.hint ?? undefined}
          />
        )}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- general */

export function GeneralStep({
  form,
  options,
  loading,
  optionsLoading = loading,
}: {
  readonly form: Form;
  readonly options: WaveRuleOptions | undefined;
  readonly loading: boolean;
  /** True while the options for the currently selected warehouse are still loading (no false "none" state). */
  readonly optionsLoading?: boolean;
}) {
  const op = form.watch('operationType');
  const warehouseId = form.watch('warehouseId');
  const deleteOn = form.watch('deleteIfNotStarted') ?? false;
  const deleteMethod = form.watch('deleteMethod') ?? 'None';
  const wantOp = OP_FOR_WAVE[op];
  const jobTypes = (options?.jobTypes ?? [])
    .filter((t) => t.operationType === wantOp)
    .map((t) => ({ id: t.id, label: t.code, hint: t.description }));
  const typeError = errorOf(form, 'jobTypeIds');
  const mergeError = errorOf(form, 'mergeRuleIds');
  // Critic R4: the job-type section itself gets the error state (red outline + inline text), also
  // before a warehouse is chosen.
  const showTypeError = (!warehouseId || !optionsLoading) && Boolean(typeError);
  return (
    <div className="flex flex-col gap-5">
      <section aria-label="General settings" className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField<F> name="name" label="Rule set name" required>
            {(c) => (
              <TextField
                {...c}
                value={(c.value as string | undefined) ?? ''}
                onChange={(e) => c.onChange(e.target.value)}
                placeholder="Rule set name"
                maxLength={100}
              />
            )}
          </FormField>
          <FormField<F> name="warehouseId" label="Warehouse" required>
            {(c) => (
              <Select
                id={c.id}
                aria-label="Warehouse"
                value={(c.value as string | undefined) || null}
                onChange={(v) => {
                  c.onChange(v ?? '');
                  form.setValue('jobTypeIds', [], { shouldDirty: true });
                  form.setValue('assigneeUserIds', [], { shouldDirty: true });
                  // Critic R3: a stale "Select at least one job type" must not sit under the loading list.
                  form.clearErrors(['jobTypeIds', 'mergeRuleIds', 'assigneeUserIds']);
                }}
                onBlur={c.onBlur}
                invalid={c.invalid}
                disabled={loading}
                placeholder="Select warehouse"
                options={(options?.warehouses ?? []).map((w) => ({
                  value: w.id,
                  label: w.name.startsWith(w.code) ? w.name : `${w.code} · ${w.name}`,
                }))}
              />
            )}
          </FormField>
        </div>
        {op === 'Cycle Count' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField<F> name="countType" label="Count type" required>
              {(c) => (
                <SegmentedControl
                  ariaLabel="Count type"
                  value={((c.value as string | null | undefined) ?? 'Location') as 'Location' | 'SKU'}
                  onChange={(v) => c.onChange(v)}
                  options={[
                    { value: 'Location', label: 'Location' },
                    { value: 'SKU', label: 'SKU' },
                  ]}
                />
              )}
            </FormField>
            <FormField<F>
              name="lockLocations"
              label="Lock locations"
              info="Counted locations are blocked for picking and putaway until the count is approved."
            >
              {(c) => (
                <YesNoToggle
                  id={c.id}
                  value={Boolean(c.value)}
                  onChange={(v) => c.onChange(v)}
                  ariaLabel="Lock locations"
                />
              )}
            </FormField>
          </div>
        ) : null}
        {op === 'Replenishment' ? (
          <FormField<F>
            name="softAllocation"
            label="Enable soft allocation for dynamic replenishment"
            info="Reserves the source stock for the replenishment task so waves don't allocate it to orders."
          >
            {(c) => (
              <YesNoToggle
                id={c.id}
                value={Boolean(c.value)}
                onChange={(v) => c.onChange(v)}
                ariaLabel="Soft allocation"
              />
            )}
          </FormField>
        ) : null}
      </section>

      {op !== 'Order Merge' ? (
        <FormSection
          title="Priority & delete options"
          collapsible
          defaultOpen={Boolean(form.getValues('priority') !== 'None' || deleteOn)}
        >
          <div className="flex flex-col gap-4">
            <FormField<F> name="priority" label="Priority">
              {(c) => (
                <SegmentedControl
                  ariaLabel="Priority"
                  value={((c.value as string | undefined) ?? 'None') as (typeof WAVE_PRIORITIES)[number]}
                  onChange={(v) => c.onChange(v)}
                  options={WAVE_PRIORITIES.map((p) => ({ value: p, label: p }))}
                />
              )}
            </FormField>
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-sunken/40 p-3">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField<F> name="deleteIfNotStarted" label="Delete the jobs if not started">
                  {(c) => (
                    <YesNoToggle
                      id={c.id}
                      value={Boolean(c.value)}
                      onChange={(v) => {
                        c.onChange(v);
                        if (!v) {
                          form.setValue('deleteMethod', 'None', { shouldDirty: true });
                          form.setValue('deleteTime', null, { shouldDirty: true });
                        }
                      }}
                      ariaLabel="Delete the jobs if not started"
                    />
                  )}
                </FormField>
                <FormField<F> name="deleteMethod" label="Delete method" required={deleteOn}>
                  {(c) => (
                    <Select
                      id={c.id}
                      value={(c.value as string | undefined) ?? 'None'}
                      onChange={(v) => {
                        c.onChange(v ?? 'None');
                        form.setValue('deleteTime', null, { shouldDirty: true });
                      }}
                      invalid={c.invalid}
                      disabled={!deleteOn}
                      options={WAVE_DELETE_METHODS.map((m) => ({ value: m, label: m }))}
                    />
                  )}
                </FormField>
                {deleteMethod === 'After Hours' ? (
                  <FormField<F> name="deleteTime" label="Hours after creation" required>
                    {(c) => (
                      <NumberInput
                        id={c.id}
                        value={c.value ? Number(c.value) : null}
                        onChange={(v) => c.onChange(v === null ? null : String(v))}
                        min={1}
                        max={999}
                        invalid={c.invalid}
                        disabled={!deleteOn}
                      />
                    )}
                  </FormField>
                ) : (
                  <FormField<F>
                    name="deleteTime"
                    label="Delete time"
                    required={deleteMethod === 'At Specific Time'}
                  >
                    {(c) => (
                      <TimePicker
                        id={c.id}
                        value={(c.value as string | null | undefined) ?? null}
                        onChange={(v) => c.onChange(v)}
                        invalid={c.invalid}
                        disabled={!deleteOn || deleteMethod !== 'At Specific Time'}
                      />
                    )}
                  </FormField>
                )}
              </div>
            </div>
          </div>
        </FormSection>
      ) : null}

      {op === 'Order Merge' ? (
        <FormSection
          title="Order merge rules"
          description="Select at least one rule. Drag and reorder the execution sequence."
        >
          {!warehouseId ? (
            <p className="text-xs text-faint">Fill in the information above to list order merge rules.</p>
          ) : optionsLoading ? (
            <div
              className="h-10 animate-pulse rounded-md bg-surface-sunken"
              aria-busy="true"
              aria-label="Loading order merge rules"
            />
          ) : (options?.mergeRules ?? []).length === 0 ? (
            <p className="text-xs text-faint">
              No order merge rules found for the selected warehouse. Add them in Settings → Data setup → Order
              merge rule.
            </p>
          ) : (
            <CheckableOrderList
              ariaLabel="Order merge rules"
              invalid={Boolean(mergeError)}
              items={(options?.mergeRules ?? []).map((m) => ({ id: m.value, label: m.label }))}
              selected={form.watch('mergeRuleIds') ?? []}
              onChange={(ids) =>
                form.setValue('mergeRuleIds', ids, {
                  shouldDirty: true,
                  shouldValidate: form.formState.isSubmitted,
                })
              }
            />
          )}
          {mergeError && !optionsLoading ? (
            <p className={errorTextClass} role="alert">
              {mergeError}
            </p>
          ) : null}
        </FormSection>
      ) : (
        <FormSection title="Select job types" description={jobTypesCopy(op)}>
          <div
            id="wr-job-types"
            role="group"
            aria-label="Job types"
            aria-invalid={showTypeError || undefined}
            aria-describedby={showTypeError ? 'wr-job-types-error' : undefined}
            className={cn(
              'rounded-lg transition-colors',
              showTypeError ? 'border border-danger bg-danger-soft/40 p-2' : '',
            )}
          >
            {!warehouseId ? (
              <p className={cn('text-xs', showTypeError ? 'text-danger' : 'text-faint')}>
                Fill in the information above to list job types.
              </p>
            ) : optionsLoading ? (
              <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading job types">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-md bg-surface-sunken" />
                ))}
              </div>
            ) : jobTypes.length === 0 ? (
              <p className="text-xs text-faint">
                You don&apos;t have any {wantOp?.toLowerCase()} job type in this warehouse.{' '}
                <Link className="text-primary hover:underline" href="/settings/job-types">
                  Create a job type
                </Link>
                .
              </p>
            ) : (
              <CheckableOrderList
                ariaLabel="Job types"
                invalid={Boolean(typeError)}
                items={jobTypes}
                selected={form.watch('jobTypeIds') ?? []}
                onChange={(ids) =>
                  form.setValue('jobTypeIds', ids, {
                    shouldDirty: true,
                    shouldValidate: form.formState.isSubmitted,
                  })
                }
              />
            )}
          </div>
          {showTypeError ? (
            <p id="wr-job-types-error" className={errorTextClass} role="alert">
              {typeError ?? 'Select at least one job type'}
            </p>
          ) : null}
          {jobTypes.length > 0 ? (
            <p className="text-xs text-faint">
              Need another one?{' '}
              <Link
                className="text-primary hover:underline"
                href="/settings/job-types"
                target="_blank"
                rel="noopener"
              >
                Create job type
              </Link>{' '}
              opens in a new tab; reopen this step to see it.
            </p>
          ) : null}
        </FormSection>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- selection */

export function selectionFields(options: WaveRuleOptions | undefined): FilterFieldDef[] {
  return ORDER_CONDITION_FIELDS.map((f) => {
    const dyn =
      f.field === 'orderType'
        ? options?.enumOptions.orderType
        : f.field === 'productGroup'
          ? options?.enumOptions.productGroup
          : f.field === 'client'
            ? options?.enumOptions.client
            : undefined;
    if (!dyn) return f;
    // Order facts carry lookup / client ids (domain/facts.orderFacts).
    return { ...f, options: dyn.map((o) => ({ value: o.value, label: o.label })) };
  });
}

export function SelectionStep({
  form,
  options,
}: {
  readonly form: Form;
  readonly options: WaveRuleOptions | undefined;
}) {
  const fields = React.useMemo(() => selectionFields(options), [options]);
  return (
    <div className="flex flex-col gap-5">
      <FormSection
        title="Filters"
        description="Only orders matching every filter join the wave. Leave empty to select every open order of the warehouse."
      >
        <ConditionsEditor
          scope="wave-rule-filters"
          fields={fields}
          value={form.watch('filters') ?? []}
          onChange={(next) => form.setValue('filters', next, { shouldDirty: true })}
        />
      </FormSection>
      <FormSection
        title="Order by"
        description="Order release sort: which orders are allocated first when stock is short."
      >
        <OrderByEditor
          options={WAVE_ORDER_BY_OPTIONS}
          value={form.watch('orderBy') ?? []}
          onChange={(next) => form.setValue('orderBy', next, { shouldDirty: true })}
          placeholder="Search and select order by method"
          emptyText="No order by method have been added yet."
        />
      </FormSection>
    </div>
  );
}

/* --------------------------------------------------------------- schedule */

function SetTimePopover({
  disabled,
  onAdd,
}: {
  readonly disabled: boolean;
  readonly onAdd: (times: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<'specific' | 'period'>('specific');
  const [time, setTime] = React.useState<string | null>(null);
  const [every, setEvery] = React.useState<number | null>(60);
  const [from, setFrom] = React.useState<string | null>('08:00');
  const [to, setTo] = React.useState<string | null>('17:00');
  // Critic R4: validate the interval instead of clamping it silently (4 → 5).
  const everyError =
    tab !== 'period'
      ? null
      : every === null
        ? 'Enter how often the rule repeats'
        : every < MIN_REPEAT_MINUTES
          ? `The minimum is ${MIN_REPEAT_MINUTES} minutes`
          : every > MAX_REPEAT_MINUTES
            ? `The maximum is ${MAX_REPEAT_MINUTES} minutes`
            : null;
  const generated =
    tab === 'period' && !everyError && every && from && to ? timesForPeriod(every, from, to) : [];
  const periodError =
    tab === 'period' && !everyError && from && to && generated.length === 0 ? 'To must be after From' : null;
  const highFrequency = generated.length > HIGH_FREQUENCY_RUNS;
  const canSet =
    tab === 'specific' ? Boolean(time) : !everyError && generated.length > 0 && generated.length <= 288;
  const [attempted, setAttempted] = React.useState(false);
  // The time field commits on blur/Enter, so "Set" stays clickable for a typed-but-uncommitted
  // time (the blur on mousedown commits it first); a missing time is reported inline instead.
  const specificError = attempted && tab === 'specific' && !time ? 'Enter a time as HH:mm' : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="primary" size="sm" disabled={disabled}>
          <Clock className="h-3.5 w-3.5" aria-hidden />
          Set time
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-3">
        <SegmentedControl
          size="sm"
          ariaLabel="Time mode"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'specific', label: 'Set specific time' },
            { value: 'period', label: 'Set time period' },
          ]}
        />
        <div className="mt-3 flex flex-col gap-2">
          {tab === 'specific' ? (
            <>
              <TimePicker
                value={time}
                onChange={setTime}
                aria-label="Specific time"
                invalid={Boolean(specificError)}
              />
              {specificError ? <p className={errorTextClass}>{specificError}</p> : null}
            </>
          ) : (
            <>
              <label className={labelClass} htmlFor="wr-every">
                Repeat every (minutes)
              </label>
              <NumberInput
                id="wr-every"
                value={every}
                onChange={setEvery}
                invalid={Boolean(everyError)}
                aria-invalid={Boolean(everyError)}
                aria-describedby="wr-every-hint"
              />
              <p
                id="wr-every-hint"
                className={everyError ? errorTextClass : 'text-2xs text-faint'}
                role={everyError ? 'alert' : undefined}
              >
                {everyError ?? `Between ${MIN_REPEAT_MINUTES} and ${MAX_REPEAT_MINUTES} minutes.`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>From</span>
                  <TimePicker value={from} onChange={setFrom} aria-label="From" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>To</span>
                  <TimePicker value={to} onChange={setTo} aria-label="To" />
                </div>
              </div>
              {everyError ? null : periodError ? (
                <p className={errorTextClass}>{periodError}</p>
              ) : (
                <p className="text-2xs text-faint">
                  {generated.length} start times: {generated.slice(0, 4).join(', ')}
                  {generated.length > 4 ? '…' : ''}
                </p>
              )}
              {highFrequency ? (
                <p
                  className="rounded-md bg-warning-soft px-2 py-1.5 text-2xs leading-4 text-[#8A5300]"
                  role="status"
                >
                  {generated.length} runs a day. Every run selects orders, allocates stock and creates jobs;
                  check this is intended.
                </p>
              ) : null}
            </>
          )}
          <Button
            variant="primary"
            className="self-end"
            disabled={tab === 'period' && !canSet}
            onClick={() => {
              if (!canSet) {
                setAttempted(true);
                return;
              }
              onAdd(tab === 'specific' && time ? [time] : generated);
              setTime(null);
              setAttempted(false);
              setOpen(false);
            }}
          >
            {tab === 'period' && generated.length > 0
              ? `Set ${generated.length} time${generated.length === 1 ? '' : 's'}`
              : 'Set'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ScheduleStep({ form, timezone }: { readonly form: Form; readonly timezone: string }) {
  const days = form.watch('scheduleDays') ?? [];
  const times = form.watch('scheduleTimes') ?? [];
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const setTimes = (next: readonly string[]) =>
    form.setValue('scheduleTimes', normalizeTimes(next), { shouldDirty: true });
  const toggleDay = (d: (typeof WEEKDAYS)[number]) =>
    form.setValue(
      'scheduleDays',
      days.includes(d) ? days.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || days.includes(x)),
      { shouldDirty: true },
    );
  const timeError = errorOf(form, 'scheduleTimes');
  const next = now !== null ? nextRunAt(days, times, timezone, new Date(now)) : null;
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Days" description="With no days selected, the rule only runs when you press Run.">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Days">
          {WEEKDAYS.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                  on
                    ? 'border-[var(--success-text)] bg-[var(--label-green-subtle)] text-success'
                    : 'border-border bg-surface-sunken text-secondary hover:border-border-strong',
                )}
              >
                {DAY_LABELS[d]}
                {on ? <X className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
              </button>
            );
          })}
        </div>
      </FormSection>
      <FormSection
        title="Time"
        description={`Times are in ${timezone}.`}
        action={
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
                times.length > HIGH_FREQUENCY_RUNS
                  ? 'bg-warning-soft text-[#8A5300]'
                  : 'bg-primary-soft text-primary',
              )}
              title={
                times.length > HIGH_FREQUENCY_RUNS
                  ? 'High frequency: every run allocates stock and creates jobs'
                  : undefined
              }
            >
              {times.length} daily frequency
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={picked.size === 0}
              onClick={() => {
                setTimes(times.filter((t) => !picked.has(t)));
                setPicked(new Set());
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Remove
            </Button>
            <SetTimePopover disabled={days.length === 0} onAdd={(add) => setTimes([...times, ...add])} />
          </span>
        }
      >
        <div
          className={cn('overflow-hidden rounded-lg border', timeError ? 'border-danger' : 'border-border')}
        >
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-surface-sunken">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    aria-label="Select all times"
                    checked={
                      times.length > 0 && picked.size === times.length
                        ? true
                        : picked.size > 0
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={(c) => setPicked(c === true ? new Set(times) : new Set())}
                  />
                </th>
                <th className="px-3 py-2 text-2xs font-semibold text-faint">No</th>
                <th className="px-3 py-2 text-2xs font-semibold text-faint">Start time</th>
              </tr>
            </thead>
            <tbody>
              {times.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-xs text-faint">
                    {days.length === 0
                      ? 'Pick at least one day, then set times.'
                      : 'No repeat time has been selected yet.'}
                  </td>
                </tr>
              ) : (
                times.map((t, i) => (
                  <tr key={t} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <Checkbox
                        aria-label={`Select ${t}`}
                        checked={picked.has(t)}
                        onCheckedChange={(c) =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (c === true) n.add(t);
                            else n.delete(t);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-secondary">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium tabular-nums">{t}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {timeError ? (
          <p className={errorTextClass} role="alert">
            {timeError}
          </p>
        ) : null}
        <p className="text-xs text-secondary">
          {next ? (
            <>
              Next run{' '}
              <span className="font-semibold text-foreground">
                {next.toLocaleString('en-US', {
                  timeZone: timezone,
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })}
              </span>{' '}
              · in{' '}
              <span className="font-mono tabular-nums">
                {formatWaveCountdown(next.getTime() - (now ?? 0))}
              </span>
            </>
          ) : days.length > 0 ? (
            'Set at least one start time for the selected days.'
          ) : (
            'Not scheduled: the rule runs only when you press Run.'
          )}
        </p>
      </FormSection>
    </div>
  );
}

/* ----------------------------------------------------------------- assign */

function ToggleGrid<T extends { readonly id: string }>({
  rows,
  columns,
  selected,
  onChange,
  search,
  empty,
}: {
  readonly rows: readonly T[];
  readonly columns: readonly { readonly label: string; readonly value: (r: T) => React.ReactNode }[];
  readonly selected: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly search: (r: T) => string;
  readonly empty: string;
}) {
  const [q, setQ] = React.useState('');
  const shown = rows.filter((r) => search(r).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      <TextField
        size="sm"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter"
        aria-label="Filter"
        leading={<Search className="h-3.5 w-3.5" aria-hidden />}
      />
      <div className="ks-scroll max-h-[320px] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-surface-sunken">
            <tr>
              {columns.map((c) => (
                <th key={c.label} className="px-3 py-2 text-2xs font-semibold text-faint">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-2xs font-semibold text-faint">Assigned</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-xs text-faint">
                  {empty}
                </td>
              </tr>
            ) : null}
            {shown.map((r) => {
              const on = selected.includes(r.id);
              return (
                <tr key={r.id} className="border-t border-border">
                  {columns.map((c) => (
                    <td key={c.label} className="px-3 py-1.5">
                      {c.value(r)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right">
                    <span className="inline-flex items-center gap-2 text-xs text-secondary">
                      {on ? 'Assigned' : 'Unassigned'}
                      <Switch
                        checked={on}
                        onCheckedChange={(v) =>
                          onChange(v ? [...selected, r.id] : selected.filter((x) => x !== r.id))
                        }
                        aria-label={`Assign ${search(r)}`}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AssignStep({
  form,
  options,
}: {
  readonly form: Form;
  readonly options: WaveRuleOptions | undefined;
}) {
  const mode = form.watch('assignMode') ?? 'Pool';
  const roleError = errorOf(form, 'assigneeRoleIds');
  const userError = errorOf(form, 'assigneeUserIds');
  // Critic R3: only task executors are offered. Assignees saved before that rule (client, viewer or
  // service accounts) are dropped once the options load, and the step says so.
  const [dropped, setDropped] = React.useState(0);
  React.useEffect(() => {
    if (!options || options.users.length + options.roles.length === 0) return;
    const users = new Set(options.users.map((u) => u.id));
    const roles = new Set(options.roles.map((r) => r.id));
    const curUsers = form.getValues('assigneeUserIds') ?? [];
    const curRoles = form.getValues('assigneeRoleIds') ?? [];
    const keepUsers = curUsers.filter((id) => users.has(id));
    const keepRoles = curRoles.filter((id) => roles.has(id));
    const removed = curUsers.length - keepUsers.length + curRoles.length - keepRoles.length;
    if (removed === 0) return;
    form.setValue('assigneeUserIds', keepUsers, { shouldDirty: true });
    form.setValue('assigneeRoleIds', keepRoles, { shouldDirty: true });
    setDropped(removed);
  }, [options, form]);
  return (
    <div className="flex flex-col gap-4">
      {dropped > 0 ? (
        <p
          className="rounded-md border border-[#F0D9A8] bg-[#FFF7E6] px-3 py-2 text-xs text-[#7A4B00] dark:border-[#5C4520] dark:bg-[#2A2112] dark:text-[#F3CF8C]"
          role="status"
        >
          {dropped === 1
            ? "1 previous assignee can't execute tasks in this warehouse and was removed."
            : `${dropped} previous assignees can't execute tasks in this warehouse and were removed.`}{' '}
          Save to apply.
        </p>
      ) : null}
      <RadioCards
        ariaLabel="Assignment"
        value={mode}
        onChange={(v) => form.setValue('assignMode', v, { shouldDirty: true })}
        options={[
          {
            value: 'Pool',
            title: 'Add to job pool',
            description: 'Any user can execute the created jobs from the pool.',
            icon: UsersRound,
          },
          {
            value: 'Roles',
            title: 'Assign to user roles',
            description: 'The users with the selected roles can execute the jobs.',
            icon: Users,
          },
          {
            value: 'Users',
            title: 'Assign to users',
            description:
              'Only assigned users can execute the created jobs. Several users share the jobs round-robin.',
            icon: UserCheck,
          },
        ]}
      />
      {mode === 'Roles' ? (
        <FormSection
          title="Roles"
          description="Roles that can execute tasks. Client and view-only roles are not listed."
        >
          <ToggleGrid
            rows={options?.roles ?? []}
            search={(r) => r.name}
            empty="No roles can execute tasks"
            selected={form.watch('assigneeRoleIds') ?? []}
            onChange={(ids) => form.setValue('assigneeRoleIds', ids, { shouldDirty: true })}
            columns={[
              { label: 'Role name', value: (r) => <span className="font-medium">{r.name}</span> },
              { label: 'User type', value: (r) => r.category ?? 'Operation' },
            ]}
          />
          {roleError ? (
            <p className={errorTextClass} role="alert">
              {roleError}
            </p>
          ) : null}
        </FormSection>
      ) : null}
      {mode === 'Users' ? (
        <FormSection
          title="Users"
          description="Operational users of this warehouse who can execute tasks. Client, view-only and integration accounts are not listed."
        >
          <ToggleGrid
            rows={options?.users ?? []}
            search={(u) => `${u.name} ${u.email}`}
            empty="No users who can execute tasks in this warehouse"
            selected={form.watch('assigneeUserIds') ?? []}
            onChange={(ids) => form.setValue('assigneeUserIds', ids, { shouldDirty: true })}
            columns={[
              { label: 'Name', value: (u) => <span className="font-medium">{u.name}</span> },
              { label: 'Email', value: (u) => <span className="text-secondary">{u.email}</span> },
              { label: 'Role', value: (u) => u.role },
              { label: 'User type', value: (u) => u.userType },
            ]}
          />
          {userError ? (
            <p className={errorTextClass} role="alert">
              {userError}
            </p>
          ) : null}
        </FormSection>
      ) : null}
    </div>
  );
}

export function AiJobGate() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-base font-semibold text-foreground">AI Jobs is not active</p>
      <p className="max-w-sm text-sm text-secondary">
        You don&apos;t have any job type selected for the AI feature. Activate the AI Jobs app to let AI waves
        optimize your picking jobs.
      </p>
      <Link href="/settings/apps" className="text-sm font-semibold text-primary hover:underline">
        Go to Settings → Apps
      </Link>
    </div>
  );
}
