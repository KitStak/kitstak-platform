'use client';
/**
 * One day of work on a job, typed in place: units, people and hours. Used for the add row at
 * the top of the Work log and for editing a row where it sits.
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button, Field, Input, Select, toast } from '@/components/ui';
import { formatPace } from '@/lib/format';
import { hoursToScaled, scaledToNumber } from '@/lib/money';
import { unitsPerHour } from '@/lib/profit/pace';
import type { LaborClassDTO, ProductionEntryDTO } from '@/lib/types';
import { saveProductionEntryAction } from '@/server/actions/log';
import { readDecimal } from '../new-job-math';

const trim = (value: string | null | undefined): string =>
  value ? value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '') : '';

export function WorkEntryForm({
  jobId,
  unit,
  row,
  today,
  laborClasses,
  defaultLaborClassId,
  onSaved,
  onCancel,
}: {
  readonly jobId: string;
  readonly unit: string;
  readonly row?: ProductionEntryDTO | null;
  readonly today: string;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly defaultLaborClassId: string | null;
  readonly onSaved: (created: boolean) => void | Promise<void>;
  readonly onCancel?: () => void;
}) {
  const [date, setDate] = useState(row?.workDate ?? today);
  const [laborClassId, setLaborClassId] = useState(
    row?.laborClassId ?? defaultLaborClassId ?? laborClasses[0]?.id ?? '',
  );
  const [good, setGood] = useState(trim(row?.unitsGood));
  const [scrap, setScrap] = useState(row && Number(row.unitsScrap) > 0 ? trim(row.unitsScrap) : '');
  const [people, setPeople] = useState(trim(row?.headcount));
  const [hours, setHours] = useState(row && Number(row.hours) > 0 ? trim(row.hours) : '');
  const [setup, setSetup] = useState(row && Number(row.setupHours) > 0 ? trim(row.setupHours) : '');
  const [overtime, setOvertime] = useState(
    row && Number(row.overtimeHours) > 0 ? trim(row.overtimeHours) : '',
  );
  const [note, setNote] = useState(row?.note ?? '');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const editing = Boolean(row);

  const goodText = readDecimal(good, 3);
  const hoursText = readDecimal(hours, 2);
  const setupText = readDecimal(setup, 2);
  // Pace for this row from the library: good units over hours that are not setup.
  const paceHours = hoursText
    ? scaledToNumber(hoursToScaled(hoursText) - hoursToScaled(setupText ?? '0'), 2)
    : 0;
  const pace = goodText && paceHours > 0 ? unitsPerHour(goodText, paceHours) : null;

  const save = async () => {
    const next: Record<string, string> = {};
    if (!date) next.workDate = 'Pick the day.';
    if (good.trim() && !goodText) next.unitsGood = 'Type a number, like 1200.';
    if (scrap.trim() && !readDecimal(scrap, 3)) next.unitsScrap = 'Type a number, like 15.';
    if (people.trim() && !readDecimal(people, 2)) next.headcount = 'Type how many people, like 4.';
    if (hours.trim() && !hoursText) next.hours = 'Type hours, like 32.';
    if (setup.trim() && !setupText) next.setupHours = 'Type hours, like 1.';
    if (overtime.trim() && !readDecimal(overtime, 2)) next.overtimeHours = 'Type hours, like 2.';
    if (!good.trim() && !hours.trim()) next.unitsGood = 'Type the units made, the hours worked, or both.';
    if (setupText && Number(setupText) > Number(hoursText ?? 0))
      next.setupHours = 'Setup hours are part of the labor hours, so they cannot be more.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    let result: Awaited<ReturnType<typeof saveProductionEntryAction>>;
    try {
      result = await saveProductionEntryAction({
        id: row?.id ?? null,
        jobId,
        workDate: date,
        laborClassId: laborClassId || null,
        unitsGood: goodText ?? '0',
        unitsScrap: readDecimal(scrap, 3) ?? '0',
        headcount: readDecimal(people, 2),
        hours: hoursText ?? '0',
        setupHours: setupText ?? '0',
        overtimeHours: readDecimal(overtime, 2) ?? '0',
        hoursConfirmed: true,
        note: note.trim() || null,
        version: row?.version,
      });
    } catch {
      setSaving(false);
      toast.error("Couldn't save the entry", 'Check your connection and try again.');
      return;
    }
    setSaving(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error("Couldn't save the entry", result.error.message);
      return;
    }
    if (!editing) {
      setGood('');
      setScrap('');
      setHours('');
      setSetup('');
      setOvertime('');
      setNote('');
    }
    await onSaved(result.data.created);
  };

  const firstError = Object.values(errors).find(Boolean);

  return (
    <form
      noValidate
      data-testid={editing ? 'work-edit-form' : 'work-add-form'}
      aria-label={editing ? 'Edit this entry' : 'Add a day of work'}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-[150px_minmax(140px,1fr)_repeat(6,minmax(76px,96px))]">
        <Field label="Day">
          {({ inputId }) => (
            <Input
              id={inputId}
              type="date"
              value={date}
              max={today}
              invalid={Boolean(errors.workDate)}
              onChange={(event) => setDate(event.target.value)}
              data-testid="work-date"
            />
          )}
        </Field>
        <Field label="Crew">
          {({ inputId }) => (
            <Select
              id={inputId}
              aria-label="Crew"
              value={laborClassId || undefined}
              placeholder="Labor class"
              onValueChange={setLaborClassId}
              options={laborClasses.map((item) => ({ value: item.id, label: item.name }))}
            />
          )}
        </Field>
        <Field label={`Good ${unit}`}>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={good}
              invalid={Boolean(errors.unitsGood)}
              onChange={(event) => setGood(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              data-testid="work-good"
            />
          )}
        </Field>
        <Field label="Scrapped">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={scrap}
              invalid={Boolean(errors.unitsScrap)}
              onChange={(event) => setScrap(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              data-testid="work-scrap"
            />
          )}
        </Field>
        <Field label="People">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={people}
              invalid={Boolean(errors.headcount)}
              onChange={(event) => setPeople(event.target.value)}
              inputMode="decimal"
              placeholder="4"
              data-testid="work-people"
            />
          )}
        </Field>
        <Field label="Labor hours">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={hours}
              invalid={Boolean(errors.hours)}
              onChange={(event) => setHours(event.target.value)}
              inputMode="decimal"
              placeholder="32"
              data-testid="work-hours"
            />
          )}
        </Field>
        <Field label="Setup hours">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={setup}
              invalid={Boolean(errors.setupHours)}
              onChange={(event) => setSetup(event.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          )}
        </Field>
        <Field label="Overtime">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={overtime}
              invalid={Boolean(errors.overtimeHours)}
              onChange={(event) => setOvertime(event.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          placeholder="Note, like short two people after lunch"
          containerClassName="min-w-[200px] flex-1"
        />
        <Button type="submit" loading={saving} leadingIcon={<Check aria-hidden />} data-testid="work-save">
          {editing ? 'Save' : 'Add the day'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" leadingIcon={<X aria-hidden />} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-fg-muted" aria-live="polite">
        {firstError ? (
          <span role="alert" className="font-medium text-danger-text">
            {firstError}
          </span>
        ) : pace !== null ? (
          <>
            That is <span className="font-medium text-fg tabular-nums">{formatPace(pace)}</span> {unit} per
            person per hour. Labor hours are people times hours each: 4 people for 8 hours is 32.
          </>
        ) : (
          'Labor hours are people times hours each: 4 people for 8 hours is 32. Setup and overtime are part of those hours.'
        )}
      </p>
    </form>
  );
}
