'use client';
/**
 * Activity: who changed what on this job, with the value before and after, and the team's
 * notes. The newest is at the top.
 */
import { useMemo, useState } from 'react';
import { History, MessageSquarePlus, Send } from 'lucide-react';
import { Button, Skeleton, Textarea, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { PersonAvatar } from '@/components/pulse/person';
import { Teach } from '@/components/pulse/teach';
import { useShell } from '@/features/shell/shell-context';
import { apiGet, apiPath } from '@/lib/api-client';
import { JOB_STATUS_LABELS, type JobStatusValue } from '@/lib/constants';
import { formatMoney, formatNumber, formatPercentBp } from '@/lib/format';
import { useActivity } from '@/lib/hooks/use-data';
import { shortDate } from '@/lib/profit/calendar';
import type { ActivityDTO, Page } from '@/lib/types';
import { addNoteAction } from '@/server/actions/jobs';
import { useRefreshJob } from './job-data';
import type { JobTabProps } from './job-overview';
import { LoadError } from './job-ui';

const FIELD_WORDS: Readonly<Record<string, string>> = {
  name: 'Name',
  number: 'Job number',
  status: 'Stage',
  kind: 'How long it runs',
  plannedUnits: 'Planned units',
  unitLabel: 'Unit word',
  unitPrice: 'Price for one',
  billRateCents: 'Price for one hour',
  fixedPriceCents: 'Fixed price',
  materialCostPerUnit: 'Material cost for one',
  materialMethod: 'How material is costed',
  partsOwner: 'Who buys the parts',
  standardUph: 'Target pace',
  targetMarginBp: 'Target margin',
  startDate: 'Start date',
  dueDate: 'Due date',
  completedDate: 'Completed on',
  poNumber: 'PO number',
  ownerId: 'Owner',
  description: 'Notes',
  pinnedNote: 'Pinned note',
  jobTypeId: 'Kind of work',
  clientId: 'Client',
  siteId: 'Site',
  units: 'Units',
  unitsGood: 'Good units',
  unitsScrap: 'Scrapped',
  hours: 'Labor hours',
  laborHours: 'Labor hours',
  setupHours: 'Setup hours',
  overtimeHours: 'Overtime hours',
  headcount: 'People',
  workDate: 'Day',
  revenueCents: 'Revenue',
  laborCents: 'Labor cost',
  materialCents: 'Material cost',
  otherCents: 'Other cost',
  sharedCents: 'Time not on a job',
  amountCents: 'Amount',
  costDate: 'Day',
  revenueDate: 'Day',
  usageDate: 'Day',
  category: 'Kind',
  vendor: 'Paid to',
  invoiceNumber: 'Invoice number',
  quantity: 'How many',
  quantityUsed: 'Used',
  quantityScrapped: 'Scrapped',
  unitCost: 'Cost for one',
  note: 'Note',
  archivedAt: 'Archived',
};

const VERB_WORDS: Readonly<Record<string, string>> = {
  'job.created': 'created the job',
  'job.updated': 'changed the job',
  'job.status_changed': 'changed the stage',
  'job.deleted': 'deleted the job',
  'job.restored': 'brought the job back',
  'job.duplicated': 'copied the job',
  'job.archived': 'archived the job',
  'plan.revised': 'changed the plan',
  'price.changed': 'changed the price',
  'production.logged': 'logged a day of work',
  'production.edited': 'edited a work entry',
  'production.deleted': 'deleted a work entry',
  'production.restored': 'brought back a work entry',
  'material.logged': 'logged material used',
  'material.edited': 'edited material used',
  'material.deleted': 'deleted material used',
  'material.restored': 'brought back material used',
  'cost.logged': 'added a cost',
  'cost.edited': 'edited a cost',
  'cost.deleted': 'deleted a cost',
  'cost.restored': 'brought back a cost',
  'revenue.logged': 'added an invoice, fee or credit',
  'revenue.edited': 'edited an invoice, fee or credit',
  'revenue.deleted': 'deleted an invoice, fee or credit',
  'revenue.restored': 'brought back an invoice, fee or credit',
  'service_entry.logged': 'added an extra service',
  'service_entry.edited': 'edited an extra service',
  'service_entry.deleted': 'deleted an extra service',
  'service_entry.restored': 'brought back an extra service',
  'link.added': 'linked a record',
  'link.removed': 'removed a link',
  'note.added': 'left a note',
};

function verbWords(item: ActivityDTO): string {
  if (item.verb === 'plan.revised')
    return item.field === 'budget' ? 'changed the budget' : 'changed the quote';
  const known = VERB_WORDS[item.verb];
  if (known) return known;
  const [entity = 'record', action = 'changed'] = item.verb.split('.');
  return `${action.replace(/_/g, ' ')} ${entity.replace(/_/g, ' ')}`;
}

function show(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'blank';
  if (key === 'status' && typeof value === 'string' && value in JOB_STATUS_LABELS)
    return JOB_STATUS_LABELS[value as JobStatusValue];
  if (
    /Cents$/.test(key) &&
    (typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value)))
  )
    return formatMoney(Number(value));
  if (/Bp$/.test(key) && typeof value === 'number') return formatPercentBp(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return shortDate(value);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return shortDate(value.slice(0, 10));
  if (typeof value === 'string' && /^-?\d+\.\d+$/.test(value)) return formatNumber(value, { maxDigits: 4 });
  if (key === 'partsOwner') return value === 'client' ? 'The client' : 'We do';
  if (key === 'materialMethod') return value === 'actual' ? 'The parts really used' : 'A cost for each unit';
  if (key === 'kind')
    return value === 'ongoing' ? 'Ongoing' : value === 'one_time' ? 'One time' : String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return 'changed';
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** The fields that changed, as "Label: before to after". Ids of other records are left out. */
function changes(item: ActivityDTO): { label: string; before: string | null; after: string }[] {
  const before = (item.before && typeof item.before === 'object' ? item.before : {}) as Record<
    string,
    unknown
  >;
  const after = (item.after && typeof item.after === 'object' ? item.after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])].filter(
    (key) => key in FIELD_WORDS && !/Id$/.test(key),
  );
  const created = !item.before;
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .slice(0, 6)
    .map((key) => ({
      label: FIELD_WORDS[key] as string,
      before: created ? null : show(key, before[key]),
      after: show(key, after[key]),
    }));
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function JobActivity({ job }: JobTabProps) {
  const shell = useShell();
  const refresh = useRefreshJob();
  const first = useActivity({ jobId: job.id, limit: 50 });
  const [older, setOlder] = useState<readonly ActivityDTO[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [onlyNotes, setOnlyNotes] = useState(false);
  const canNote = shell.can('production:log');

  const nextCursor = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(first.data?.items ?? []), ...older]
      .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
      .filter((item) => !onlyNotes || item.verb === 'note.added');
  }, [first.data, older, onlyNotes]);

  const days = useMemo(() => {
    const map = new Map<string, ActivityDTO[]>();
    for (const item of items) {
      const day = item.createdAt.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await apiGet<Page<ActivityDTO>>(
        apiPath('activity', { job: job.id, limit: 50, cursor: nextCursor }),
      );
      setOlder((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      toast.error("Couldn't load older activity", error instanceof Error ? error.message : 'Try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  const addNote = async () => {
    const body = note.trim();
    if (!body) return;
    setSaving(true);
    const result = await addNoteAction({ jobId: job.id, body }).catch(() => null);
    setSaving(false);
    if (!result || !result.ok) {
      toast.error(
        "Couldn't save the note",
        result ? result.error.message : 'Check your connection and try again.',
      );
      return;
    }
    setNote('');
    await refresh();
    await first.refetch();
    toast.success('Note added');
  };

  return (
    <div className="flex flex-col gap-5" data-testid="job-activity">
      {canNote ? (
        <Panel title="Leave a note">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addNote();
            }}
          >
            <Textarea
              aria-label="Note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="What should the next person know? Short two people today, client moved the due date, waiting on boxes."
              data-testid="note-body"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">Everyone who can open this job can read it.</span>
              <Button
                type="submit"
                loading={saving}
                disabled={!note.trim()}
                leadingIcon={<Send aria-hidden />}
                data-testid="note-save"
              >
                Add the note
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel
        title="What happened"
        action={
          <Button
            variant="ghost"
            size="sm"
            pressed={onlyNotes}
            leadingIcon={<MessageSquarePlus aria-hidden />}
            onClick={() => setOnlyNotes((current) => !current)}
            data-testid="activity-only-notes"
          >
            {onlyNotes ? 'Show everything' : 'Notes only'}
          </Button>
        }
        bodyClassName="p-0"
      >
        {first.isError ? (
          <div className="p-4">
            <LoadError
              what="the activity"
              message={first.error instanceof Error ? first.error.message : undefined}
              onRetry={() => void first.refetch()}
            />
          </div>
        ) : first.isPending ? (
          <div className="flex flex-col gap-3 p-4" role="status" aria-busy="true">
            <span className="sr-only">Loading activity</span>
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex gap-3">
                <Skeleton width={24} height={24} rounded="full" />
                <Skeleton height={16} className="w-2/3" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <Teach
            testId="activity-empty"
            size="sm"
            icon={History}
            title={onlyNotes ? 'No notes yet' : 'Nothing has happened yet'}
            why={
              onlyNotes
                ? 'Notes the team leaves on this job show up here.'
                : 'Every change to this job is kept here: who did it, when, and the value before and after.'
            }
          />
        ) : (
          <div className="flex flex-col">
            {days.map(([day, list]) => (
              <section key={day} aria-label={shortDate(day)}>
                <h3 className="sticky top-0 border-y border-border-subtle bg-sunken px-4 py-1.5 text-xs font-medium text-fg-muted first:border-t-0">
                  {shortDate(day)}
                </h3>
                <ul className="flex flex-col divide-y divide-border-subtle">
                  {list.map((item) => {
                    const diff = item.verb === 'note.added' ? [] : changes(item);
                    return (
                      <li
                        key={item.id}
                        className="flex gap-3 px-4 py-3"
                        data-testid={item.verb === 'note.added' ? 'activity-note' : 'activity-item'}
                      >
                        <PersonAvatar
                          userId={item.actor?.id ?? null}
                          size="sm"
                          decorative
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-fg">
                            <span className="font-medium">
                              {item.actor?.name ?? (item.actorKind === 'user' ? 'Someone' : 'Pulse')}
                            </span>{' '}
                            <span className="text-fg-secondary">{verbWords(item)}</span>
                            <span className="ml-2 text-xs whitespace-nowrap text-fg-muted">
                              {timeOf(item.createdAt)}
                            </span>
                          </p>
                          {item.body ? (
                            <p
                              className={cn(
                                'mt-1 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-fg',
                                item.verb === 'note.added' ? 'bg-primary-subtle' : 'bg-sunken',
                              )}
                            >
                              {item.body}
                            </p>
                          ) : null}
                          {diff.length > 0 ? (
                            <dl className="mt-1 flex flex-col gap-0.5 text-xs text-fg-secondary">
                              {diff.map((change) => (
                                <div key={change.label} className="flex flex-wrap gap-x-1.5">
                                  <dt className="text-fg-muted">{change.label}:</dt>
                                  <dd className="min-w-0 break-words">
                                    {change.before !== null ? (
                                      <>
                                        <span className="line-through decoration-fg-muted/60">
                                          {change.before}
                                        </span>
                                        <span className="mx-1 text-fg-muted">to</span>
                                      </>
                                    ) : null}
                                    <span className="font-medium text-fg">{change.after}</span>
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {nextCursor ? (
              <div className="flex justify-center border-t border-border-subtle p-3">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loadingMore}
                  onClick={() => void loadMore()}
                  data-testid="activity-more"
                >
                  Show older activity
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
}
