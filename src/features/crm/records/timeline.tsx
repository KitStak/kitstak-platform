'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger, cn, labelColorStyle, toLabelColor } from '@/components/ui';
import { routes } from '@/features/shell/routes';
import type { TimelineEntryDto } from '@/server/services/crm-contracts';
import { formatDay, relativeDay } from '../lib/format';
import { activityIcon } from './activity-composer';

type Filter = 'all' | 'upcoming' | 'call' | 'email' | 'meeting' | 'notes';

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'call', label: 'Calls' },
  { value: 'email', label: 'Emails' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'notes', label: 'Notes & updates' },
];

export function matchesTimelineFilter(entry: TimelineEntryDto, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'upcoming':
      return entry.upcoming;
    case 'meeting':
      return entry.kind === 'meeting' || entry.kind === 'demo';
    case 'notes':
      return entry.kind === 'update' || entry.kind === 'note' || entry.kind === 'task';
    default:
      return entry.kind === filter;
  }
}

/** Merged activity + updates timeline with type filters and day grouping. */
export function Timeline({ entries, orgSlug }: { readonly entries: readonly TimelineEntryDto[]; readonly orgSlug: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = useMemo(() => entries.filter((entry) => matchesTimelineFilter(entry, filter)), [entries, filter]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((option) => [option.value, entries.filter((entry) => matchesTimelineFilter(entry, option.value)).length])),
    [entries],
  );
  // Design-system Tabs (Radix): roving tabindex, ←/→/Home/End, tab ↔ tabpanel wiring.
  return (
    <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} className="flex flex-col gap-4" data-testid="crm-timeline">
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <TabsList variant="pill" aria-label="Filter timeline">
          {FILTERS.map((option) => (
            <TabsTrigger key={option.value} value={option.value} variant="pill" className="shrink-0" data-testid={`crm-timeline-tab-${option.value}`}>
              {option.label}
              <span className="text-xs tabular-nums opacity-75">{counts[option.value]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {FILTERS.map((option) => (
        <TabsContent key={option.value} value={option.value}>
          {option.value === filter ? <TimelineList entries={entries} visible={visible} orgSlug={orgSlug} /> : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function TimelineList({
  entries,
  visible,
  orgSlug,
}: {
  readonly entries: readonly TimelineEntryDto[];
  readonly visible: readonly TimelineEntryDto[];
  readonly orgSlug: string;
}) {
  return (
    <>
      {visible.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="inbox"
          title={entries.length === 0 ? 'No activity yet' : 'Nothing matches this filter'}
          description={entries.length === 0 ? 'Log the first call, email or meeting to start the history.' : 'Try another filter.'}
        />
      ) : (
        <ol className="relative flex flex-col" aria-label="Activity timeline">
          <span aria-hidden className="absolute top-2 bottom-2 left-[15px] w-px bg-border-subtle" />
          {visible.map((entry, index) => {
            const previous = visible[index - 1];
            const showDivider = entry.upcoming !== previous?.upcoming || index === 0;
            return (
              <li key={entry.id} className="relative flex flex-col">
                {showDivider ? (
                  <span className="relative z-[1] mb-2 ml-9 text-xs font-semibold text-fg-muted ">
                    {entry.upcoming ? 'Upcoming' : 'History'}
                  </span>
                ) : null}
                <TimelineRow entry={entry} orgSlug={orgSlug} />
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function TimelineRow({ entry, orgSlug }: { readonly entry: TimelineEntryDto; readonly orgSlug: string }) {
  const color = toLabelColor(entry.typeLabel?.color ?? (entry.source === 'update' ? 'gray' : 'blue'));
  const pending = entry.id.startsWith('pending:');
  const day = entry.at.slice(0, 10);
  return (
    <div className={cn('group flex gap-3 pb-4', pending && 'opacity-60')} aria-busy={pending || undefined}>
      <span
        style={labelColorStyle(color)}
        className="relative z-[1] mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--lc-subtle)] text-[var(--lc-text)] ring-4 ring-[var(--surface-panel)]"
      >
        {activityIcon(entry.typeLabel?.name ?? entry.kind)}
      </span>
      <div className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 transition-colors duration-[var(--duration-fast)] group-hover:border-border-subtle group-hover:bg-sunken">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          {entry.boardId && !pending ? (
            <Link
              href={routes.item(orgSlug, entry.boardId, entry.itemId)}
              title={entry.title}
              className="min-w-0 truncate rounded-sm text-base font-medium text-fg outline-none hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              {entry.title}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-base font-medium text-fg" title={entry.title}>
              {entry.title}
            </span>
          )}
          <time dateTime={entry.at} title={formatDay(day)} className="shrink-0 text-xs tabular-nums text-fg-muted">
            {pending ? 'Saving…' : relativeDay(day)}
          </time>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-secondary">
          {entry.typeLabel ? <span>{entry.typeLabel.name}</span> : <span>Update</span>}
          {entry.status ? (
            <span
              style={labelColorStyle(toLabelColor(entry.status.color))}
              className="inline-flex h-[18px] items-center rounded-sm bg-[var(--lc-subtle)] px-1.5 font-semibold text-[var(--lc-text)]"
            >
              {entry.status.name}
            </span>
          ) : null}
          {entry.author ? <span>by {entry.author.name}</span> : null}
          {entry.relatedTo.length > 0 ? (
            <span className="truncate text-fg-muted">· {entry.relatedTo.map((ref) => ref.name).join(', ')}</span>
          ) : null}
        </div>
        {entry.body ? <p className="mt-1.5 line-clamp-3 text-sm whitespace-pre-line text-fg-secondary">{entry.body}</p> : null}
      </div>
    </div>
  );
}
