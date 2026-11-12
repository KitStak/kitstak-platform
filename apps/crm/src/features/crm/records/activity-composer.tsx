'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CheckSquare,
  Mail,
  MonitorPlay,
  Phone,
  StickyNote,
  Users,
} from 'lucide-react';
import {
  Button,
  Checkbox,
  DatePicker,
  Field,
  Input,
  Select,
  Textarea,
  cn,
  labelColorStyle,
  toLabelColor,
  toast,
} from '@/components/ui';
import { ApiClientError } from '@/lib/api';
import { useOrgId } from '@/lib/hooks/org-context';
import type {
  ActivityOutcome,
  CrmLabelDto,
  Record360Dto,
  RecordRefDto,
  TimelineEntryDto,
} from '@/server/services/crm-contracts';
import { crmKeys, useLogActivity } from '../api';
import { StagePill } from '../components/crm-ui';
import { todayIso } from '../lib/format';

/** A linkable deal; stage + amount tell same-named deals apart. */
export interface ComposerDealOption extends RecordRefDto {
  readonly stage?: CrmLabelDto | null;
  readonly amountText?: string | null;
}

export interface ComposerOptions {
  readonly types: readonly CrmLabelDto[];
  readonly contacts: readonly RecordRefDto[];
  readonly deals: readonly ComposerDealOption[];
  readonly defaultContactIds: readonly string[];
  readonly defaultDealIds: readonly string[];
}

const NO_TIME = 'none';

/** 15-minute time slots ("09:30" → "9:30 AM") for the token-styled time Select. */
export function timeSlots(stepMinutes = 15): { value: string; label: string }[] {
  const slots = [{ value: NO_TIME, label: 'No time' }];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const value = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    const label = `${hours % 12 === 0 ? 12 : hours % 12}:${String(mins).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
    slots.push({ value, label });
  }
  return slots;
}

const TIME_SLOTS = timeSlots();

const OUTCOMES: readonly { value: ActivityOutcome; label: string }[] = [
  { value: 'completed', label: 'Completed' },
  { value: 'connected', label: 'Connected' },
  { value: 'left_voicemail', label: 'Left voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'scheduled', label: 'Scheduled (upcoming)' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function activityIcon(kind: string, className = 'size-4'): ReactNode {
  const text = kind.toLowerCase();
  if (text.includes('call')) return <Phone aria-hidden className={className} />;
  if (text.includes('email') || text.includes('mail')) return <Mail aria-hidden className={className} />;
  if (text.includes('meeting')) return <Users aria-hidden className={className} />;
  if (text.includes('demo')) return <MonitorPlay aria-hidden className={className} />;
  if (text.includes('task')) return <CheckSquare aria-hidden className={className} />;
  if (text.includes('note') || text.includes('update')) return <StickyNote aria-hidden className={className} />;
  return <CalendarClock aria-hidden className={className} />;
}

function toIso(date: Date): string {
  return todayIso(date);
}

function fromIso(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export interface ActivityComposerProps {
  readonly options: ComposerOptions;
  readonly fromItemId: string;
  /** 360 record whose timeline gets the optimistic entry. */
  readonly recordKey?: { readonly kind: 'contacts' | 'accounts'; readonly itemId: string };
  readonly onLogged?: () => void;
  readonly onCancel?: () => void;
  readonly autoFocus?: boolean;
  /** Start as a scheduled follow-up (from the Next steps empty state). */
  readonly initialOutcome?: ActivityOutcome;
}

function friendlyError(cause: unknown): string {
  if (cause instanceof ApiClientError && cause.status >= 400 && cause.status < 500 && cause.status !== 429) return cause.message;
  return 'Something went wrong on our side. Your notes are still here, try again.';
}

/** Type chips → subject/outcome/date → notes → linked records → Log. Optimistic in the timeline. */
export function ActivityComposer({
  options,
  fromItemId,
  recordKey,
  onLogged,
  onCancel,
  autoFocus,
  initialOutcome = 'completed',
}: ActivityComposerProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const log = useLogActivity();
  const [typeId, setTypeId] = useState(options.types[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [outcome, setOutcome] = useState<ActivityOutcome>(initialOutcome);
  const [date, setDate] = useState(() => {
    if (initialOutcome !== 'scheduled') return todayIso();
    const next = new Date();
    next.setDate(next.getDate() + 2);
    return todayIso(next);
  });
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [contactIds, setContactIds] = useState<string[]>([...options.defaultContactIds]);
  const [dealIds, setDealIds] = useState<string[]>([...options.defaultDealIds]);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const type = options.types.find((entry) => entry.id === typeId) ?? null;
  const linked = contactIds.length + dealIds.length;

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
  const related = useMemo(() => [...options.contacts, ...options.deals], [options.contacts, options.deals]);

  const submit = async () => {
    if (!type) return setError('Pick an activity type');
    if (linked === 0) return setError('Link at least one contact or deal');
    const durationValue = duration.trim() === '' ? undefined : Math.max(0, Math.round(Number(duration)));
    if (durationValue !== undefined && !Number.isFinite(durationValue)) return setError('Duration must be a number');
    setError(null);
    const key = recordKey ? crmKeys.record(orgId, recordKey.kind, recordKey.itemId) : null;
    const previous = key ? queryClient.getQueryData<Record360Dto>(key) : undefined;
    if (key && previous) {
      const optimistic: TimelineEntryDto = {
        id: `pending:${Date.now()}`,
        source: 'activity',
        kind: 'other',
        title: subject.trim() || `${type.name}`,
        body: notes.trim() || null,
        at: `${date}T${time || '12:00'}:00.000Z`,
        author: null,
        status: null,
        typeLabel: type,
        upcoming: outcome === 'scheduled' || date > todayIso(),
        itemId: fromItemId,
        boardId: '',
        relatedTo: related.filter((entry) => contactIds.includes(entry.id) || dealIds.includes(entry.id)),
      };
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<Record360Dto>(key, { ...previous, timeline: [optimistic, ...previous.timeline] });
    }
    try {
      const result = await log.mutateAsync({
        typeLabelId: type.id,
        subject: subject.trim() || undefined,
        outcome,
        date,
        time: time || undefined,
        durationMinutes: durationValue,
        notes: notes.trim() || undefined,
        contactIds,
        dealIds,
        fromItemId,
      });
      toast.success(result.upcoming ? `${type.name} scheduled` : `${type.name} logged`, result.name);
      setSubject('');
      setNotes('');
      setDuration('');
      onLogged?.();
    } catch (cause) {
      if (key && previous) queryClient.setQueryData(key, previous);
      // One contextual toast (the generic mutation toast is suppressed) with a Retry action.
      toast.undo('Couldn’t log the activity', {
        description: friendlyError(cause),
        undoLabel: 'Retry',
        onUndo: () => retryRef.current?.(),
      });
    }
  };

  // Latest submit for the error toast's Retry (the toast outlives this render).
  useEffect(() => {
    retryRef.current = () => void submit();
  });

  if (options.types.length === 0) {
    return <p className="text-sm text-fg-muted">The Activities board has no activity types to choose from.</p>;
  }

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="crm-activity-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <div role="radiogroup" aria-label="Activity type" className="flex flex-wrap gap-1.5">
        {options.types.map((entry) => {
          const selected = entry.id === typeId;
          return (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTypeId(entry.id)}
              style={labelColorStyle(toLabelColor(entry.color))}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none transition-[background-color,border-color,color] duration-[var(--duration-fast)]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.98]',
                selected
                  ? 'border-transparent bg-[var(--lc-bg)] text-[var(--lc-fg)]'
                  : 'border-border-default bg-panel text-fg-secondary hover:border-border-strong hover:bg-hover hover:text-fg',
              )}
            >
              {activityIcon(entry.name)}
              {entry.name}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Subject">
          {({ inputId }) => (
            <Input
              id={inputId}
              autoFocus={autoFocus}
              value={subject}
              maxLength={200}
              placeholder={type ? `${type.name}: short summary` : 'Short summary'}
              onChange={(event) => setSubject(event.target.value)}
              data-testid="crm-activity-subject"
            />
          )}
        </Field>
        <Field label="Outcome">
          {({ inputId }) => (
            <Select id={inputId} value={outcome} onValueChange={(value) => setOutcome(value as ActivityOutcome)} options={OUTCOMES} />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_120px_120px]">
        <Field label="Date" className="col-span-2 sm:col-span-1">
          {({ inputId }) => (
            <DatePicker id={inputId} value={fromIso(date)} clearable={false} onChange={(value) => value && setDate(toIso(value))} />
          )}
        </Field>
        <Field label="Time">
          {({ inputId }) => (
            <Select
              id={inputId}
              value={time || NO_TIME}
              onValueChange={(value) => setTime(value === NO_TIME ? '' : value)}
              options={TIME_SLOTS}
              data-testid="crm-activity-time"
            />
          )}
        </Field>
        <Field label="Minutes">
          {({ inputId }) => (
            <Input
              id={inputId}
              type="number"
              min={0}
              inputMode="numeric"
              value={duration}
              placeholder="30"
              onChange={(event) => setDuration(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Notes" hint="Ctrl/⌘ + Enter to log">
        {({ inputId, describedBy }) => (
          <Textarea
            id={inputId}
            aria-describedby={describedBy}
            rows={3}
            value={notes}
            placeholder="What happened, what was agreed, what’s next…"
            onChange={(event) => setNotes(event.target.value)}
            data-testid="crm-activity-notes"
          />
        )}
      </Field>
      {related.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-semibold text-fg-secondary">Linked to</legend>
          <div className="flex max-h-36 flex-col gap-1.5 overflow-y-auto">
            {options.contacts.map((entry) => (
              <LinkOption
                key={entry.id}
                label={entry.name}
                kind="Contact"
                checked={contactIds.includes(entry.id)}
                onChange={() => setContactIds((list) => toggle(list, entry.id))}
              />
            ))}
            {options.deals.map((entry) => (
              <LinkOption
                key={entry.id}
                label={entry.name}
                kind="Deal"
                checked={dealIds.includes(entry.id)}
                onChange={() => setDealIds((list) => toggle(list, entry.id))}
                detail={
                  entry.stage || entry.amountText ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      {entry.stage ? <StagePill label={entry.stage} className="h-5 max-w-28 text-2xs" /> : null}
                      {entry.amountText ? <span className="text-xs tabular-nums text-fg-secondary">{entry.amountText}</span> : null}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={log.isPending}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={log.isPending} disabled={linked === 0} data-testid="crm-activity-submit">
          {outcome === 'scheduled' || date > todayIso() ? 'Schedule' : 'Log activity'}
        </Button>
      </div>
    </form>
  );
}

function LinkOption({
  label,
  kind,
  checked,
  onChange,
  detail,
}: {
  readonly label: string;
  readonly kind: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly detail?: ReactNode;
}) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover">
      <Checkbox checked={checked} onCheckedChange={onChange} aria-label={`${kind}: ${label}`} />
      <span className="min-w-0 flex-1 truncate text-sm text-fg" title={label}>
        {label}
      </span>
      {detail}
      <span className="shrink-0 text-xs text-fg-muted">{kind}</span>
    </label>
  );
}
