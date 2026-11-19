'use client';
/**
 * "Other time" for one site day: time not on a job (meetings, cleanup, waiting) and the paid
 * hours of the day. Shown under the day grid and on Labor, Time.
 */
import { useState } from 'react';
import { Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Select, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { INDIRECT_REASONS, INDIRECT_REASON_LABELS, type IndirectReason } from '@/lib/constants';
import { formatHours, formatMoney } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { decimalToCents } from '@/lib/money';
import { laborHoursFromCrew } from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import type { IndirectEntryDTO, LaborClassDTO, PaidHoursDTO } from '@/lib/types';
import {
  deleteIndirectEntryAction,
  restoreIndirectEntryAction,
  saveIndirectEntryAction,
  savePaidHoursAction,
} from '@/server/actions/log';
import { parseTyped, tidy } from './log-math';

const field =
  'h-10 w-full min-w-0 rounded-md border border-border-input bg-panel px-2 text-sm tabular-nums text-fg placeholder:text-fg-placeholder hover:border-border-input-hover focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-disabled sm:h-8';

const INVALIDATE = [qk.streams(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot()] as const;

interface Draft {
  id: string | null;
  version: number | null;
  reason: IndirectReason;
  laborClassId: string;
  people: string;
  hours: string;
  note: string;
}

const blankDraft = (): Draft => ({
  id: null,
  version: null,
  reason: 'meeting',
  laborClassId: '',
  people: '',
  hours: '',
  note: '',
});

export function OtherTimeStrip({
  date,
  siteId,
  indirect,
  paid,
  laborClasses,
  canEdit,
  seesMoney,
  shiftHours,
}: {
  readonly date: string;
  readonly siteId: string;
  readonly indirect: readonly IndirectEntryDTO[];
  readonly paid: readonly PaidHoursDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly canEdit: boolean;
  readonly seesMoney: boolean;
  readonly shiftHours: string;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useServerAction(saveIndirectEntryAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setError(problem.message),
  });
  const remove = useServerAction(deleteIndirectEntryAction, { invalidate: INVALIDATE });
  const restore = useServerAction(restoreIndirectEntryAction, { invalidate: INVALIDATE });
  const classes = laborClasses.filter((item) => !item.archivedAt);
  const className = (id: string | null) =>
    laborClasses.find((item) => item.id === id)?.name ?? 'Default class';

  async function submit() {
    if (!draft) return;
    const hours = parseTyped(draft.hours);
    const people = parseTyped(draft.people);
    if (hours === null || hours <= 0)
      return setError('Type the labor hours. For 6 people in a 30 minute meeting, that is 3.');
    if (people === null) return setError('People must be a number.');
    setError(null);
    const saved = await save.run({
      id: draft.id,
      version: draft.version,
      siteId,
      workDate: date,
      reason: draft.reason,
      laborClassId: draft.laborClassId || null,
      headcount: people > 0 ? people.toFixed(2) : null,
      hours: hours.toFixed(2),
      note: draft.note.trim() || null,
    });
    if (saved) {
      toast.success(draft.id ? 'Other time updated' : 'Other time added');
      setDraft(null);
    }
  }

  async function removeEntry(entry: IndirectEntryDTO) {
    const gone = await remove.run({ id: entry.id });
    if (!gone) return;
    toast.undo(
      `Removed ${formatHours(entry.hours, { style: 'unit' })} of ${INDIRECT_REASON_LABELS[entry.reason].toLowerCase()}`,
      { onUndo: async () => void (await restore.run({ id: entry.id })) },
    );
  }

  return (
    <section aria-labelledby="other-time-title" data-testid="other-time" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="other-time-title" className="text-base font-semibold text-fg">
            Other time
          </h2>
          <p className="text-sm text-fg-muted">
            Hours people were paid for that were not on a job: meetings, cleanup, waiting on parts. Pulse
            spreads this cost over the jobs.
          </p>
        </div>
        {canEdit && !draft ? (
          <Button
            variant="secondary"
            leadingIcon={<Plus aria-hidden />}
            onClick={() => (setError(null), setDraft(blankDraft()))}
          >
            Add other time
          </Button>
        ) : null}
      </div>
      {indirect.length === 0 && !draft ? (
        <p className="rounded-lg border border-dashed border-border-default bg-sunken px-4 py-3 text-sm text-fg-secondary">
          <Clock aria-hidden className="mr-1.5 inline size-4 align-[-3px] text-icon" />
          No time off the jobs is logged for this day. If the crew met, cleaned up or waited, add it here so
          the job numbers stay honest.
        </p>
      ) : null}
      {indirect.length > 0 ? (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {indirect.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-28 font-medium text-fg">{INDIRECT_REASON_LABELS[entry.reason]}</span>
              <span className="text-fg-secondary">{className(entry.laborClassId)}</span>
              <span className="tabular-nums text-fg-secondary">
                {entry.headcount ? `${tidy(entry.headcount)} ${Number(entry.headcount) === 1 ? 'person' : 'people'}, ` : ''}
                {formatHours(entry.hours, { style: 'unit' })}
              </span>
              {seesMoney && entry.costCents !== null ? (
                <span className="tabular-nums text-fg-secondary">{formatMoney(entry.costCents)}</span>
              ) : null}
              {entry.note ? (
                <span className="min-w-0 flex-1 truncate text-fg-muted">{entry.note}</span>
              ) : (
                <span className="flex-1" />
              )}
              {entry.source === 'punch' ? (
                <span className="text-xs text-fg-muted">From time punches</span>
              ) : null}
              {canEdit && !entry.locked && entry.source !== 'punch' ? (
                <span className="flex items-center gap-1">
                  <IconButton
                    label={`Edit ${INDIRECT_REASON_LABELS[entry.reason].toLowerCase()} time`}
                    icon={<Pencil aria-hidden />}
                    size="sm"
                    variant="ghost"
                    onClick={() => (
                      setError(null),
                      setDraft({
                        id: entry.id,
                        version: entry.version,
                        reason: entry.reason,
                        laborClassId: entry.laborClassId ?? '',
                        people: tidy(entry.headcount),
                        hours: tidy(entry.hours),
                        note: entry.note ?? '',
                      })
                    )}
                  />
                  <IconButton
                    label={`Remove ${INDIRECT_REASON_LABELS[entry.reason].toLowerCase()} time`}
                    icon={<Trash2 aria-hidden />}
                    size="sm"
                    variant="ghost"
                    loading={remove.pending}
                    onClick={() => void removeEntry(entry)}
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {draft ? (
        <form
          aria-label={draft.id ? 'Edit other time' : 'Add other time'}
          className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border-default bg-sunken p-3 sm:grid-cols-[150px_170px_90px_110px_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Reason</span>
            <Select
              autoFocus
              aria-label="Reason"
              className="h-10 px-2 sm:h-8"
              value={draft.reason}
              onValueChange={(value) => setDraft({ ...draft, reason: value as IndirectReason })}
              options={INDIRECT_REASONS.map((reason) => ({ value: reason, label: INDIRECT_REASON_LABELS[reason] }))}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-fg-muted">
            <span>Labor class</span>
            <Select
              aria-label="Labor class"
              className="h-10 px-2 sm:h-8"
              value={draft.laborClassId || 'default'}
              onValueChange={(value) => setDraft({ ...draft, laborClassId: value === 'default' ? '' : value })}
              options={[{ value: 'default', label: 'Default class' }, ...classes.map((item) => ({ value: item.id, label: item.name }))]}
            />
          </div>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            People
            <input
              className={cn(field, 'text-right')}
              inputMode="decimal"
              value={draft.people}
              onChange={(event) => setDraft({ ...draft, people: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            Labor hours
            <input
              className={cn(field, 'text-right')}
              inputMode="decimal"
              value={draft.hours}
              aria-invalid={Boolean(error) || undefined}
              onChange={(event) => (setError(null), setDraft({ ...draft, hours: event.target.value }))}
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs text-fg-muted sm:col-span-1">
            Note
            <input
              className={field}
              value={draft.note}
              maxLength={300}
              placeholder="What happened"
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>
          <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
            <Button type="submit" loading={save.pending}>
              {draft.id ? 'Save' : 'Add'}
            </Button>
            <Button type="button" variant="tertiary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
          <p
            className={cn('col-span-full text-xs', error ? 'text-danger-text' : 'text-fg-muted')}
            role={error ? 'alert' : undefined}
          >
            {error ??
              ((parseTyped(draft.people) ?? 0) > 0 && (parseTyped(draft.hours) ?? 0) > 0
                ? `That is ${formatHours((parseTyped(draft.hours) ?? 0) / (parseTyped(draft.people) ?? 1), { style: 'unit' })} for ${(parseTyped(draft.people) ?? 0) === 1 ? 'the 1 person' : `each of ${tidy(draft.people)} people`}. A full shift for them would be ${formatHours(laborHoursFromCrew(parseTyped(draft.people) ?? 0, shiftHours), { style: 'unit' })}.`
                : 'Labor hours are people times hours each. 6 people in a 30 minute meeting is 3 labor hours.')}
          </p>
        </form>
      ) : null}
      <PaidHoursRow date={date} siteId={siteId} paid={paid} canEdit={canEdit} seesMoney={seesMoney} />
    </section>
  );
}

/** Paid hours of the whole site for the day (the all classes row), typed from the time clock. */
function PaidHoursRow({
  date,
  siteId,
  paid,
  canEdit,
  seesMoney,
}: {
  readonly date: string;
  readonly siteId: string;
  readonly paid: readonly PaidHoursDTO[];
  readonly canEdit: boolean;
  readonly seesMoney: boolean;
}) {
  const all = paid.find((row) => row.laborClassId === null) ?? null;
  const byClass = paid.filter((row) => row.laborClassId !== null);
  const fromPunches = paid.some((row) => row.source === 'punch');
  const [hours, setHours] = useState<string | null>(null);
  const [pay, setPay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useServerAction(savePaidHoursAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setError(problem.message),
  });
  const shownHours = hours ?? tidy(all?.paidHours);
  const shownPay =
    pay ?? (all?.paidCents !== null && all?.paidCents !== undefined ? formatMoney(all.paidCents) : '');
  const classHours = byClass.reduce((total, row) => total + Number(row.paidHours), 0);
  const dirty = hours !== null || pay !== null;

  async function submit() {
    const typed = parseTyped(shownHours);
    if (typed === null) return setError('Paid hours must be a number.');
    let cents: number | null | undefined;
    if (seesMoney) {
      const text = shownPay.replace(/[$,\s]/g, '');
      if (text === '') cents = null;
      else if (!/^\d+(\.\d{1,2})?$/.test(text)) return setError('Type the pay like $13,190.33.');
      else cents = Number(decimalToCents(text));
    }
    setError(null);
    const saved = await save.run({
      siteId,
      workDate: date,
      laborClassId: null,
      paidHours: typed.toFixed(2),
      ...(cents === undefined ? {} : { paidCents: cents }),
      version: all?.version ?? null,
    });
    if (saved) {
      setHours(null);
      setPay(null);
      toast.success('Paid hours saved');
    }
  }

  return (
    <form
      aria-label="Paid hours for the day"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle px-3 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium text-fg">Paid hours</p>
        <p className="text-xs text-fg-muted">
          {fromPunches
            ? 'Filled in from the time punches of this day.'
            : byClass.length > 0
              ? `${formatHours(classHours, { style: 'unit' })} are typed by labor class under Labor, Time.`
              : 'All the hours the time clock paid at this site today. Pulse shows any paid time that is not on a job or a reason.'}
        </p>
      </div>
      <label className="flex w-28 flex-col gap-1 text-xs text-fg-muted">
        Hours paid
        <input
          className={cn(field, 'text-right')}
          inputMode="decimal"
          disabled={!canEdit || fromPunches}
          value={shownHours}
          onChange={(event) => (setError(null), setHours(event.target.value))}
          aria-label="Hours paid"
        />
      </label>
      {seesMoney ? (
        <label className="flex w-32 flex-col gap-1 text-xs text-fg-muted">
          Pay, if you know it
          <input
            className={cn(field, 'text-right')}
            inputMode="decimal"
            disabled={!canEdit || fromPunches}
            value={shownPay}
            placeholder="$"
            onChange={(event) => setPay(event.target.value)}
            aria-label="Gross pay for the day"
          />
        </label>
      ) : null}
      {canEdit && !fromPunches ? (
        <Button type="submit" variant="secondary" disabled={!dirty} loading={save.pending}>
          Save paid hours
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </form>
  );
}
