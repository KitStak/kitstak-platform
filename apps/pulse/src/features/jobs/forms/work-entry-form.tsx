'use client';
/**
 * One day of work on a job: the units made that day, then one line for each labor class that
 * worked it (people, hours each and labor hours, the same three boxes as the Log work grid). Used
 * to add a day and to edit a whole day. The day is saved in one go through `PUT /api/v1/log/days`.
 *
 * A day is never overwritten by accident. When the job already has work on the picked day the
 * form says so before anything is saved and offers to open that day. The server checks again.
 */
import { useMemo, useRef, useState } from 'react';
import { Check, Info, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { Button, Field, IconButton, Input, IsoDatePicker, Select, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { applyField, crewQuestion, hoursEachFrom, parseTyped, tidy } from '@/features/log/log-math';
import { formatHours, formatNumber, formatPace } from '@/lib/format';
import { unitsPerHour } from '@/lib/profit/pace';
import { shortDate } from '@/lib/profit/calendar';
import type { LaborClassDTO, ProductionEntryDTO } from '@/lib/types';
import {
  groupWorkDays,
  planDayLines,
  repeatedLaborLines,
  saveDay,
  shiftWords,
  type DaySaveBody,
  type WorkDay,
} from '../work-days';

/**
 * Every box and button on the form is 40px tall with a mouse, and 44px on a tablet or a touch
 * screen (the text field inside is then 42px), so a gloved thumb hits the box it means.
 */
const TOUCH = 'h-10 max-lg:h-11 pointer-coarse:h-11';

interface LineState {
  readonly key: number;
  readonly id: string | null;
  readonly laborClassId: string;
  /** "day" for a new line; a line read from the day keeps its shift. */
  readonly shift: string;
  /** The Projects task of a line read from the day, kept as it was. New lines are untagged. */
  readonly pmTaskId: string | null;
  readonly people: string;
  readonly hoursEach: string;
  readonly hours: string;
  readonly setup: string;
  readonly overtime: string;
}

type LineField = 'people' | 'hoursEach' | 'hours' | 'setup' | 'overtime';

let nextKey = 1;
const blankLine = (laborClassId: string): LineState => ({
  key: nextKey++,
  id: null,
  laborClassId,
  shift: 'day',
  pmTaskId: null,
  people: '',
  hoursEach: '',
  hours: '',
  setup: '',
  overtime: '',
});

const fixed = (text: string, places: number): string => (parseTyped(text) ?? 0).toFixed(places);

/** What a saved day looked like, for the Undo of the save. */
export interface DaySaved {
  readonly mode: 'create' | 'edit';
  /** The day before the save (edit only). */
  readonly before: WorkDay | null;
  /** The day as it is now. */
  readonly entries: readonly ProductionEntryDTO[];
  readonly workDate: string;
}

export function WorkEntryForm({
  jobId,
  unit,
  day,
  days,
  today,
  startDate = null,
  shiftHours,
  laborClasses,
  defaultLaborClassId,
  onSaved,
  onCancel,
  onOpenDay,
  onStale,
  unitsFrom = null,
}: {
  /** Set on a job a KitStak program feeds: units come from builds, so the form takes hours and crew only. */
  readonly unitsFrom?: string | null;
  readonly jobId: string;
  readonly unit: string;
  /** The day being edited. Leave it out to add a new day. */
  readonly day?: WorkDay | null;
  /** Every day that already has work on this job, so the form can say so before it saves. */
  readonly days: readonly WorkDay[];
  readonly today: string;
  /** The job's start day: a day before it is asked about first. */
  readonly startDate?: string | null;
  /** Hours in a full shift, for the "is that right" check on labor hours. */
  readonly shiftHours: string;
  readonly laborClasses: readonly LaborClassDTO[];
  readonly defaultLaborClassId: string | null;
  readonly onSaved: (saved: DaySaved) => void | Promise<void>;
  readonly onCancel?: () => void;
  /** Opens a day that already has work, to edit it. */
  readonly onOpenDay: (workDate: string) => void;
  /** Someone else changed the day while it was open: load it again. */
  readonly onStale?: () => void | Promise<void>;
}) {
  const firstClass = defaultLaborClassId ?? laborClasses[0]?.id ?? '';
  const editing = Boolean(day);
  const [date, setDate] = useState<string | null>(day?.workDate ?? today);
  const [good, setGood] = useState(tidy(day?.unitsGood));
  const [scrap, setScrap] = useState(tidy(day?.unitsScrap));
  const [note, setNote] = useState(day?.notes[0] ?? '');
  const [lines, setLines] = useState<readonly LineState[]>(() =>
    day
      ? day.rows.map((row) => ({
          key: nextKey++,
          id: row.id,
          laborClassId: row.laborClassId ?? '',
          shift: row.shift || 'day',
          pmTaskId: row.pmTaskId ?? null,
          people: tidy(row.headcount),
          hoursEach: hoursEachFrom(row.hours, row.headcount),
          hours: tidy(row.hours),
          setup: tidy(row.setupHours),
          overtime: tidy(row.overtimeHours),
        }))
      : [blankLine(firstClass)],
  );
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  /** A day the server said already has work, before the list on screen knew about it. */
  const [serverDay, setServerDay] = useState<WorkDay | null>(null);
  /** The "Is that right?" questions the person already said yes to, so the second press saves. */
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const updateLine = (key: number, field: LineField, text: string) =>
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        // People times hours each fills labor hours, the same rule as the Log work grid.
        const next = applyField(
          { ...line, unitsGood: '', unitsScrap: '', unitsRework: '', note: '', pmTaskId: null, taskUnits: '' },
          field,
          text,
        );
        return { ...line, people: next.people, hoursEach: next.hoursEach, hours: next.hours, setup: next.setup, overtime: next.overtime };
      }),
    );

  const addLine = () =>
    setLines((current) => {
      const used = new Set(current.map((line) => line.laborClassId));
      const unused = laborClasses.find((item) => !used.has(item.id))?.id ?? '';
      return [...current, blankLine(unused)];
    });

  const removeLine = (key: number) => setLines((current) => current.filter((line) => line.key !== key));

  // The day that already holds work on the picked date. Editing a day does not clash with itself.
  const clash = useMemo(() => {
    if (!date || (day && date === day.workDate)) return null;
    return days.find((item) => item.workDate === date) ?? (serverDay?.workDate === date ? serverDay : null);
  }, [date, day, days, serverDay]);

  const goodNumber = parseTyped(good);
  // Pace for the day: good units over the labor hours that are not setup, across every line.
  const paceHours = lines.reduce(
    (total, line) => total + (parseTyped(line.hours) ?? 0) - (parseTyped(line.setup) ?? 0),
    0,
  );
  const setupTotal = lines.reduce((total, line) => total + (parseTyped(line.setup) ?? 0), 0);
  const pace = goodNumber && goodNumber > 0 && paceHours > 0 ? unitsPerHour(String(goodNumber), paceHours.toFixed(2)) : null;
  /** "Nov 17", with the year when it is not this year, so a day a year back never reads as this week. */
  const dayWords = (value: string): string => (value.slice(0, 4) === today.slice(0, 4) ? shortDate(value) : `${shortDate(value)}, ${value.slice(0, 4)}`);
  // The Log work grid leaves a job off the days before it starts. The form says so, and asks.
  const beforeStart =
    !clash && date && startDate && date < startDate && !(day && day.workDate === date)
      ? `This job starts on ${dayWords(startDate)}, so ${dayWords(date)} is before it starts. Is that the right day?`
      : null;
  const questions = [
    ...(beforeStart ? [beforeStart] : []),
    ...lines
      .map((line) =>
        crewQuestion(
          { ...line, unitsGood: '', unitsScrap: '', unitsRework: '', note: '', pmTaskId: null, taskUnits: '' },
          shiftHours,
        ),
      )
      .filter((question): question is string => question !== null),
  ];

  const check = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!date) next.workDate = 'Pick the day.';
    else if (date > today) next.workDate = 'Work cannot be dated after today. Pick today or an earlier day.';
    if (good.trim() && goodNumber === null) next.unitsGood = 'Type a number, like 1200.';
    if (scrap.trim() && parseTyped(scrap) === null) next.unitsScrap = 'Type a number, like 15.';
    lines.forEach((line, index) => {
      const at = (field: string) => `${field}.${index}`;
      const people = parseTyped(line.people);
      const each = parseTyped(line.hoursEach);
      const hours = parseTyped(line.hours);
      const setup = parseTyped(line.setup);
      const overtime = parseTyped(line.overtime);
      if (people === null) next[at('headcount')] = 'Type how many people, like 4.';
      if (each === null) next[at('hoursEach')] = 'Type the hours each person worked, like 8.';
      else if (each > 24) next[at('hoursEach')] = 'Hours each cannot be more than 24.';
      if (hours === null) next[at('hours')] = 'Type labor hours, like 32.';
      if (setup === null) next[at('setupHours')] = 'Type setup hours, like 1.';
      if (overtime === null) next[at('overtimeHours')] = 'Type overtime hours, like 2.';
      if (hours !== null && setup !== null && setup > hours)
        next[at('setupHours')] = 'Setup hours are part of the labor hours, so they cannot be more.';
      if (hours !== null && overtime !== null && overtime > hours)
        next[at('overtimeHours')] = 'Overtime hours are part of the labor hours, so they cannot be more.';
      // Every labor class on the day needs its hours. One line may stay empty when only units are known.
      if (hours === 0 && (lines.length > 1 || (people ?? 0) > 0))
        next[at('hours')] =
          lines.length > 1 ? 'Type the hours for each labor class, or take the empty line off.' : 'Add the hours each.';
      if ((hours ?? 0) > 0 && people === 0) next[at('headcount')] = 'Add people: how many worked these hours.';
    });
    if (lines.length === 0) next.lines = 'Add at least one labor class.';
    if (!(goodNumber && goodNumber > 0) && !lines.some((line) => (parseTyped(line.hours) ?? 0) > 0))
      next.unitsGood ??= 'Type the units made, the hours worked, or both.';
    for (const index of repeatedLaborLines(lines.map((line) => ({ laborClassId: line.laborClassId || null, shift: line.shift, pmTaskId: line.pmTaskId }))))
      next[`laborClassId.${index}`] = 'Each labor class can only be on the day once. Put its people and hours on one line.';
    return next;
  };

  // Unusual hours ask first: the first press shows the question, the second press saves.
  const questionKey = questions.join('|');
  const asking = questions.length > 0 && confirmed !== questionKey;
  const awaitingYes = questions.length > 0 && confirmed === questionKey;
  const save = async () => {
    if (clash) return;
    const next = check();
    setErrors(next);
    if (Object.keys(next).length > 0 || !date) return;
    if (asking) {
      setConfirmed(questionKey);
      return;
    }
    const body: DaySaveBody = {
      jobId,
      workDate: date,
      mode: day ? 'edit' : 'create',
      ...(day ? { fromDate: day.workDate, read: day.rows.map((row) => ({ id: row.id, version: row.version })) } : {}),
      lines: planDayLines({
        unitsGood: unitsFrom ? '0.000' : fixed(good, 3),
        unitsScrap: unitsFrom ? '0.000' : fixed(scrap, 3),
        unitsRework: day ? day.rows.reduce((total, row) => total + Number(row.unitsRework), 0).toFixed(3) : '0',
        note: note.trim() || null,
        lines: lines.map((line) => ({
          id: line.id,
          laborClassId: line.laborClassId || null,
          shift: line.shift,
          pmTaskId: line.pmTaskId,
          headcount: (parseTyped(line.people) ?? 0) > 0 ? fixed(line.people, 2) : null,
          hours: fixed(line.hours, 2),
          setupHours: fixed(line.setup, 2),
          overtimeHours: fixed(line.overtime, 2),
        })),
      }),
    };
    setSaving(true);
    try {
      const result = await saveDay(body);
      if (!result.ok) {
        if (result.reason === 'day_exists') {
          // The list on screen did not have this day yet. Show it, and let the person open it.
          setServerDay(groupWorkDays(result.fresh)[0] ?? null);
          return;
        }
        if (result.reason === 'stale') {
          toast.error('Someone else changed this day', 'Here is the day as it is now. Check it and save again.');
          await onStale?.();
          return;
        }
        // The server names lines as entries.N.field: map them onto the boxes of this form.
        setErrors(
          Object.fromEntries(
            Object.entries(result.fields).map(([key, value]) => {
              const match = /^(?:entries|lines)\.(\d+)\.(\w+)$/.exec(key);
              return [match ? `${match[2]}.${match[1]}` : key, value];
            }),
          ),
        );
        toast.error("Couldn't save the day", result.message);
        return;
      }
      if (!editing) {
        setGood('');
        setScrap('');
        setNote('');
        setLines([blankLine(firstClass)]);
        setErrors({});
        setConfirmed(null);
        // The day just saved has work now. Start the next one on today when today is still free,
        // else on no day, so a good save never ends on the "already has work" notice.
        const taken = new Set([...days.map((item) => item.workDate), date]);
        setDate(taken.has(today) ? null : today);
      }
      await onSaved({ mode: day ? 'edit' : 'create', before: day ?? null, entries: result.entries, workDate: date });
      // The keyboard goes back to the top of the form, ready for the next day.
      if (!editing) requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-testid="work-date"]')?.focus());
    } finally {
      setSaving(false);
    }
  };

  const firstError = Object.values(errors).find(Boolean);
  // A class already on another line of the same shift is shown, marked and not offered again.
  const optionsFor = (line: LineState) =>
    laborClasses.map((item) => {
      const other = lines.findIndex((each) => each.key !== line.key && each.laborClassId === item.id && each.shift === line.shift);
      return other < 0 ? { value: item.id, label: item.name } : { value: item.id, label: item.name, description: `Already on line ${other + 1}`, disabled: true };
    });
  const classNames = new Map(laborClasses.map((item) => [item.id, item.name]));
  const clashWords = clash
    ? [
        `${formatNumber(clash.unitsGood, { maxDigits: 0 })} good ${unit}`,
        clash.hoursConfirmed ? `${formatHours(clash.hours)} labor hours` : 'no hours yet',
        [...new Set(clash.laborClassIds.map((id) => (id ? (classNames.get(id) ?? 'A labor class') : 'No labor class')))].join(', '),
      ].join(', ')
    : '';

  return (
    <form
      ref={formRef}
      noValidate
      data-testid={editing ? 'work-edit-form' : 'work-add-form'}
      aria-label={editing ? 'Edit this day' : 'Add a day of work'}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[190px_repeat(2,minmax(96px,140px))]">
        <Field label="Day" className="col-span-2 sm:col-span-1">
          {({ inputId }) => (
            <IsoDatePicker
              id={inputId}
              value={date}
              max={today}
              clearable={false}
              displayFormat="EEE, MMM d, yyyy"
              invalid={Boolean(errors.workDate)}
              aria-describedby={clash ? 'work-day-exists' : undefined}
              triggerClassName={TOUCH}
              onChange={(value) => {
                setDate(value);
                setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'workDate')));
              }}
              data-testid="work-date"
            />
          )}
        </Field>
        <Field label={`Good ${unit}`}>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={unitsFrom ? '' : good}
              placeholder={unitsFrom ? 'From builds' : undefined}
              invalid={Boolean(errors.unitsGood)}
              disabled={Boolean(clash) || Boolean(unitsFrom)}
              onChange={(event) => setGood(event.target.value)}
              inputMode="decimal"
              containerClassName={TOUCH}
              data-testid="work-good"
            />
          )}
        </Field>
        <Field label="Scrapped">
          {({ inputId }) => (
            <Input
              id={inputId}
              value={unitsFrom ? '' : scrap}
              placeholder={unitsFrom ? 'From builds' : undefined}
              invalid={Boolean(errors.unitsScrap)}
              disabled={Boolean(clash) || Boolean(unitsFrom)}
              onChange={(event) => setScrap(event.target.value)}
              inputMode="decimal"
              containerClassName={TOUCH}
              data-testid="work-scrap"
            />
          )}
        </Field>
      </div>

      {unitsFrom ? (
        <p className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-sm text-fg-secondary" data-testid="work-units-from-builds">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          Units for this job come from builds in Projects ({unitsFrom}). Log hours and crew here.
        </p>
      ) : null}

      {clash ? (
        <div
          id="work-day-exists"
          role="status"
          data-testid="work-day-exists"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--warning)] bg-warning-subtle px-3 py-2.5"
        >
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-warning-text" />
          <p className="min-w-0 flex-1 basis-64 text-sm text-fg">
            <span className="font-medium">{dayWords(clash.workDate)} already has work on this job:</span>{' '}
            <span className="tabular-nums">{clashWords}.</span>{' '}
            {editing
              ? 'Pick another day, or open that day to change it.'
              : 'A day is saved once, so the boxes below are off. Pick another day, or open that day to change its numbers or add a labor class.'}
          </p>
          <Button
            type="button"
            variant="primary"
            className={TOUCH}
            leadingIcon={<Pencil aria-hidden />}
            onClick={() => onOpenDay(clash.workDate)}
            data-testid="work-open-existing"
          >
            Edit {shortDate(clash.workDate)}
          </Button>
        </div>
      ) : null}

      {/* While the picked day already has work, nothing typed here could be saved: the boxes are off. */}
      <fieldset disabled={Boolean(clash)} className="m-0 min-w-0 border-0 p-0">
      <div className="flex flex-col gap-2" data-testid="work-lines">
        {lines.map((line, index) => {
          const error = (field: string) => errors[`${field}.${index}`];
          const testId = (name: string) => (index === 0 ? `work-${name}` : `work-${name}-${index}`);
          const box = (field: LineField, label: string, errorKey: string, name: string) => (
            <Field label={label}>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  aria-label={`${label}, line ${index + 1}`}
                  value={line[field]}
                  invalid={Boolean(error(errorKey))}
                  onChange={(event) => updateLine(line.key, field, event.target.value)}
                  inputMode="decimal"
                  containerClassName={TOUCH}
                  data-testid={testId(name)}
                />
              )}
            </Field>
          );
          return (
            <div
              key={line.key}
              role="group"
              aria-label={`Labor class line ${index + 1}`}
              className={cn(
                'grid grid-cols-2 items-end gap-2 rounded-lg border border-border-subtle bg-panel p-2.5',
                'sm:grid-cols-3 md:grid-cols-[minmax(130px,1.5fr)_repeat(5,minmax(0,1fr))_40px]',
              )}
              data-testid={`work-line-${index}`}
            >
              <Field
                label="Labor class"
                labelAside={shiftWords(line.shift) ? <span className="text-xs font-medium text-fg-secondary">{shiftWords(line.shift)}</span> : undefined}
                className="col-span-2 sm:col-span-3 md:col-span-1"
              >
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    aria-label={`Labor class, line ${index + 1}${shiftWords(line.shift) ? `, ${shiftWords(line.shift)?.toLowerCase()}` : ''}`}
                    value={line.laborClassId || undefined}
                    placeholder="Pick one"
                    invalid={Boolean(error('laborClassId'))}
                    className={TOUCH}
                    onValueChange={(value) =>
                      setLines((current) =>
                        current.map((item) => (item.key === line.key ? { ...item, laborClassId: value } : item)),
                      )
                    }
                    options={optionsFor(line)}
                  />
                )}
              </Field>
              {box('people', 'People', 'headcount', 'people')}
              {box('hoursEach', 'Hours each', 'hoursEach', 'hours-each')}
              {box('hours', 'Labor hours', 'hours', 'hours')}
              {box('setup', 'Setup hours', 'setupHours', 'setup')}
              {box('overtime', 'Overtime', 'overtimeHours', 'overtime')}
              {lines.length > 1 ? (
                <IconButton
                  label={`Remove labor class, line ${index + 1}`}
                  icon={<Trash2 aria-hidden />}
                  size="lg"
                  className="justify-self-end max-lg:size-11 pointer-coarse:size-11"
                  onClick={() => removeLine(line.key)}
                  data-testid={`work-line-remove-${index}`}
                />
              ) : (
                <span aria-hidden className="hidden md:block" />
              )}
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="ghost"
            className={TOUCH}
            leadingIcon={<Plus aria-hidden />}
            onClick={addLine}
            data-testid="work-add-line"
          >
            Add a labor class
          </Button>
        </div>
      </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Note"
          disabled={Boolean(clash)}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          placeholder="Note, like short two people after lunch"
          containerClassName={cn('min-w-[200px] flex-1', TOUCH)}
        />
        <Button
          type="submit"
          loading={saving}
          disabled={Boolean(clash)}
          className={TOUCH}
          leadingIcon={<Check aria-hidden />}
          data-testid="work-save"
        >
          {awaitingYes ? (editing ? 'Yes, save the day' : 'Yes, add the day') : editing ? 'Save the day' : 'Add the day'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" className={TOUCH} leadingIcon={<X aria-hidden />} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 text-xs text-fg-muted" aria-live="polite">
        {firstError ? (
          <p role="alert" className="font-medium text-danger-text" data-testid="work-error">
            {firstError}
          </p>
        ) : null}
        {questions.map((question) => (
          <p key={question} className="font-medium text-[var(--label-yellow-text)]" data-testid="work-crew-question">
            {question}
          </p>
        ))}
        {awaitingYes ? (
          <p role="alert" className="font-medium text-fg" data-testid="work-crew-confirm">
            Check the hours above. If they are right, press {editing ? 'Yes, save the day' : 'Yes, add the day'}.
          </p>
        ) : null}
        {firstError ? null : pace !== null ? (
          <p>
            That is <span className="font-medium text-fg tabular-nums">{formatPace(pace)}</span> {unit} per person
            per hour for the day{setupTotal > 0 ? ', with setup hours left out' : ''}.
          </p>
        ) : (
          <p>
            Add a line for each labor class that worked the day. Type people and hours each, and labor hours fill in.
            Type over labor hours when people worked different hours.
          </p>
        )}
      </div>
    </form>
  );
}
