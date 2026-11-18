'use client';
/**
 * One day of work on a job: the units made that day, then one line for each labor type that
 * worked it (people and hours). Used for the add form at the top of the Work log and for editing
 * a whole day where it sits. Each labor line saves as its own entry, all in one go.
 */
import { useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { Button, Field, IconButton, Input, Select, toast } from '@/components/ui';
import { formatPace } from '@/lib/format';
import { hoursToScaled, scaledToNumber, ZERO } from '@/lib/money';
import { unitsPerHour } from '@/lib/profit/pace';
import type { LaborClassDTO } from '@/lib/types';
import { deleteProductionEntriesAction, saveProductionBulkAction } from '@/server/actions/log';
import { readDecimal } from '../new-job-math';
import { planDaySave, repeatedLaborClass, type LaborLineInput, type WorkDay } from '../work-days';

const trim = (value: string | null | undefined): string =>
  value ? value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '') : '';

const positive = (value: string | null | undefined): string => (value && Number(value) > 0 ? trim(value) : '');

interface LineState {
  readonly key: number;
  readonly id: string | null;
  readonly version?: number;
  readonly laborClassId: string;
  readonly people: string;
  readonly hours: string;
  readonly setup: string;
  readonly overtime: string;
}

let nextKey = 1;
const blankLine = (laborClassId: string): LineState => ({
  key: nextKey++,
  id: null,
  laborClassId,
  people: '',
  hours: '',
  setup: '',
  overtime: '',
});

export function WorkEntryForm({
  jobId,
  unit,
  day,
  today,
  laborClasses,
  defaultLaborClassId,
  onSaved,
  onCancel,
}: {
  readonly jobId: string;
  readonly unit: string;
  readonly day?: WorkDay | null;
  readonly today: string;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly defaultLaborClassId: string | null;
  readonly onSaved: (created: number) => void | Promise<void>;
  readonly onCancel?: () => void;
}) {
  const firstClass = defaultLaborClassId ?? laborClasses[0]?.id ?? '';
  const editing = Boolean(day);
  const [date, setDate] = useState(day?.workDate ?? today);
  const [good, setGood] = useState(positive(day?.unitsGood));
  const [scrap, setScrap] = useState(positive(day?.unitsScrap));
  const [note, setNote] = useState(day?.notes[0] ?? '');
  const [lines, setLines] = useState<readonly LineState[]>(() =>
    day
      ? day.rows.map((row) => ({
          key: nextKey++,
          id: row.id,
          version: row.version,
          laborClassId: row.laborClassId ?? '',
          people: trim(row.headcount),
          hours: positive(row.hours),
          setup: positive(row.setupHours),
          overtime: positive(row.overtimeHours),
        }))
      : [blankLine(firstClass)],
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);

  const updateLine = (key: number, change: Partial<LineState>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));

  const addLine = () =>
    setLines((current) => {
      const used = new Set(current.map((line) => line.laborClassId));
      const unused = laborClasses.find((item) => !used.has(item.id))?.id ?? '';
      return [...current, blankLine(unused)];
    });

  const removeLine = (key: number) => setLines((current) => current.filter((line) => line.key !== key));

  const goodText = readDecimal(good, 3);
  // Pace for the day: good units over the labor hours that are not setup, across every line.
  const paceScaled = lines.reduce(
    (total, line) =>
      total + hoursToScaled(readDecimal(line.hours, 2) ?? '0') - hoursToScaled(readDecimal(line.setup, 2) ?? '0'),
    ZERO,
  );
  const paceHours = scaledToNumber(paceScaled, 2);
  const pace = goodText && paceHours > 0 ? unitsPerHour(goodText, paceHours) : null;

  const check = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!date) next.workDate = 'Pick the day.';
    if (good.trim() && !goodText) next.unitsGood = 'Type a number, like 1200.';
    if (scrap.trim() && !readDecimal(scrap, 3)) next.unitsScrap = 'Type a number, like 15.';
    lines.forEach((line, index) => {
      const at = (field: string) => `${field}.${index}`;
      const hoursText = readDecimal(line.hours, 2);
      const setupText = readDecimal(line.setup, 2);
      if (line.people.trim() && !readDecimal(line.people, 2)) next[at('headcount')] = 'Type how many people, like 4.';
      if (line.hours.trim() && !hoursText) next[at('hours')] = 'Type hours, like 32.';
      if (line.setup.trim() && !setupText) next[at('setupHours')] = 'Type hours, like 1.';
      if (line.overtime.trim() && !readDecimal(line.overtime, 2)) next[at('overtimeHours')] = 'Type hours, like 2.';
      if (setupText && Number(setupText) > Number(hoursText ?? 0))
        next[at('setupHours')] = 'Setup hours are part of the labor hours, so they cannot be more.';
      if (index > 0 && !line.hours.trim()) next[at('hours')] = 'Type the hours for each labor type you added.';
    });
    if (lines.length === 0) next.lines = 'Add at least one labor type.';
    if (!good.trim() && !lines.some((line) => line.hours.trim()))
      next.unitsGood = 'Type the units made, the hours worked, or both.';
    if (repeatedLaborClass(lines.map((line) => ({ laborClassId: line.laborClassId || null }))) !== null)
      next.lines = 'Each labor type can only be on the day once. Put its people and hours on one line.';
    return next;
  };

  const save = async () => {
    const next = check();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const parsed: LaborLineInput[] = lines.map((line) => ({
      id: line.id,
      version: line.version,
      laborClassId: line.laborClassId || null,
      headcount: readDecimal(line.people, 2),
      hours: readDecimal(line.hours, 2) ?? '0',
      setupHours: readDecimal(line.setup, 2) ?? '0',
      overtimeHours: readDecimal(line.overtime, 2) ?? '0',
    }));
    const plan = planDaySave({
      jobId,
      workDate: date,
      unitsGood: goodText ?? '0',
      unitsScrap: readDecimal(scrap, 3) ?? '0',
      note: note.trim() || null,
      lines: parsed,
      existingIds: day?.rows.map((row) => row.id) ?? [],
    });
    setSaving(true);
    try {
      const result = await saveProductionBulkAction({ entries: plan.entries });
      if (!result.ok) {
        setErrors(result.error.fields ?? {});
        toast.error("Couldn't save the day", result.error.message);
        return;
      }
      if (plan.removeIds.length > 0) {
        const removed = await deleteProductionEntriesAction({ ids: plan.removeIds });
        if (!removed.ok) toast.error("Couldn't remove a labor type", removed.error.message);
      }
      if (!editing) {
        setGood('');
        setScrap('');
        setNote('');
        setLines([blankLine(firstClass)]);
      }
      await onSaved(result.data.created);
    } catch {
      toast.error("Couldn't save the day", 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const firstError = Object.values(errors).find(Boolean);
  const options = laborClasses.map((item) => ({ value: item.id, label: item.name }));

  return (
    <form
      noValidate
      data-testid={editing ? 'work-edit-form' : 'work-add-form'}
      aria-label={editing ? 'Edit this day' : 'Add a day of work'}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[150px_repeat(2,minmax(96px,140px))]">
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
      </div>

      <div className="flex flex-col gap-2" data-testid="work-lines">
        {lines.map((line, index) => {
          const err = (field: string) => Boolean(errors[`${field}.${index}`]);
          const id = (name: string) => (index === 0 ? `work-${name}` : `work-${name}-${index}`);
          return (
            <div
              key={line.key}
              className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4 lg:grid-cols-[minmax(160px,1fr)_repeat(4,minmax(76px,110px))_36px]"
              data-testid={`work-line-${index}`}
            >
              <Field label="Labor type">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    aria-label={`Labor type, line ${index + 1}`}
                    value={line.laborClassId || undefined}
                    placeholder="Labor type"
                    onValueChange={(value) => updateLine(line.key, { laborClassId: value })}
                    options={options}
                  />
                )}
              </Field>
              <Field label="People">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    value={line.people}
                    invalid={err('headcount')}
                    onChange={(event) => updateLine(line.key, { people: event.target.value })}
                    inputMode="decimal"
                    placeholder="4"
                    data-testid={id('people')}
                  />
                )}
              </Field>
              <Field label="Labor hours">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    value={line.hours}
                    invalid={err('hours')}
                    onChange={(event) => updateLine(line.key, { hours: event.target.value })}
                    inputMode="decimal"
                    placeholder="32"
                    data-testid={id('hours')}
                  />
                )}
              </Field>
              <Field label="Setup hours">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    value={line.setup}
                    invalid={err('setupHours')}
                    onChange={(event) => updateLine(line.key, { setup: event.target.value })}
                    inputMode="decimal"
                    placeholder="0"
                  />
                )}
              </Field>
              <Field label="Overtime">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    value={line.overtime}
                    invalid={err('overtimeHours')}
                    onChange={(event) => updateLine(line.key, { overtime: event.target.value })}
                    inputMode="decimal"
                    placeholder="0"
                  />
                )}
              </Field>
              {lines.length > 1 ? (
                <IconButton
                  label={`Remove labor type, line ${index + 1}`}
                  icon={<Trash2 aria-hidden />}
                  size="sm"
                  onClick={() => removeLine(line.key)}
                  data-testid={`work-line-remove-${index}`}
                />
              ) : (
                <span aria-hidden />
              )}
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={<Plus aria-hidden />}
            onClick={addLine}
            data-testid="work-add-line"
          >
            Add labor type
          </Button>
        </div>
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
            person per hour for the day. Labor hours are people times hours each: 4 people for 8 hours is 32.
          </>
        ) : (
          'Add a line for each labor type that worked the day. Labor hours are people times hours each: 4 people for 8 hours is 32.'
        )}
      </p>
    </form>
  );
}
