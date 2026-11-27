'use client';

/**
 * Count plan timeline (M07): the plan's change log (plan + line entries) merged with its ledger
 * `Count` transactions, with filter chips All / Plan / Lines / Inventory. Status values use the
 * same casing as the pills ("Ready to Count"), and a recount line's first entry reads
 * "Recount line created (Ready to Count)" instead of "— → Ready To Count".
 */
import * as React from 'react';
import { ArrowLeftRight, FilePlus2, PencilLine, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/format';
import { useApiQuery } from '@/lib/query-client';
import { COUNT_QUERY_TIMEOUT_MS } from './counts-client';
import { statusLabel } from '@/lib/status-colors';
import { Button } from '@/components/ui/button';
import { SkeletonText } from '@/components/ui/skeleton';
import { changeLogMessage } from '@/components/shared/change-log-drawer';
import { ledgerEntrySchema, type LedgerEntry } from '@/components/shared/activity-timeline';
import { changeLogEntrySchema, parseList, type ChangeLogEntry } from '@/components/shared/contracts';

type Filter = 'all' | 'plan' | 'lines' | 'inventory';
type Kind = 'Create' | 'Update' | 'Delete' | 'Ledger';

interface Item {
  readonly id: string;
  readonly kind: Kind;
  readonly group: Exclude<Filter, 'all'>;
  readonly at: string;
  readonly label: string | null;
  readonly title: string;
  readonly source: string;
}

const EMPTY = new Set(['', 'None', '-', '\u2014', '\u2013', 'null']);

type ChangeFields = Pick<
  ChangeLogEntry,
  'type' | 'field' | 'fieldLabel' | 'fromValue' | 'toValue' | 'message' | 'lineLabel' | 'parentEntityType'
>;

/** Line label ("MLT1-A-01 (recount)") and plain-language text for one change-log row. */
export function countChangeParts(c: ChangeFields): { readonly label: string | null; readonly text: string } {
  const isLine = Boolean(c.parentEntityType);
  const label =
    c.lineLabel ??
    (isLine && c.message.includes(' -> ') ? c.message.slice(0, c.message.indexOf(' -> ')) : null);
  // Operational events (job created, count submitted, recount, Update Inv. reason): the text is stored as is.
  if (c.field === 'count_event')
    return {
      label,
      text:
        c.toValue ??
        (label && c.message.startsWith(`${label} -> `) ? c.message.slice(label.length + 4) : c.message),
    };
  if (c.type === 'Update' && c.field === 'status') {
    const to = c.toValue ? statusLabel(c.toValue) : 'None';
    if (!c.fromValue || EMPTY.has(c.fromValue.trim()))
      return { label, text: `${isLine ? 'Recount line created' : 'Created'} (${to})` };
    return { label, text: `Status changed from ${statusLabel(c.fromValue)} to ${to}` };
  }
  const text = changeLogMessage(c as ChangeLogEntry);
  // The shared message repeats the line label with an ASCII arrow ("B-1 -> …"); keep the text only.
  return {
    label,
    text:
      label && text.startsWith(`${label} -> `) ? text.slice(label.length + 4) : text.replace(/ --> /g, ' → '),
  };
}

/** Plain-language message for one change-log row (exported for tests): "B-1: Status changed from …". */
export function countChangeMessage(c: ChangeFields): string {
  const { label, text } = countChangeParts(c);
  return label ? `${label}: ${text}` : text;
}

const KIND_META = {
  Create: { icon: FilePlus2, dot: 'bg-success text-white' },
  Update: { icon: PencilLine, dot: 'bg-info text-white' },
  Delete: { icon: Trash2, dot: 'bg-danger text-white' },
  Ledger: { icon: ArrowLeftRight, dot: 'bg-fg-muted text-white' },
} as const;

const PAGE = 50;

export function CountTimeline({ planId }: { readonly planId: string }) {
  const fmt = useFormat();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [shown, setShown] = React.useState(PAGE);
  const changes = useApiQuery<unknown>(['change-log', 'count_plan', planId, 'timeline'], '/api/change-log', {
    query: { entityType: 'count_plan', entityId: planId, ps: 200 },
    timeoutMs: COUNT_QUERY_TIMEOUT_MS,
  });
  const ledger = useApiQuery<unknown>(
    ['timeline-ledger', `/api/counts/${planId}/ledger`],
    `/api/counts/${encodeURIComponent(planId)}/ledger`,
    { timeoutMs: COUNT_QUERY_TIMEOUT_MS },
  );
  // Sources are login emails; show the user's display name like the rest of the page.
  const actors = useApiQuery<Record<string, string>>(
    ['count-actors', planId],
    `/api/counts/${encodeURIComponent(planId)}/actors`,
    { staleTime: 60_000, timeoutMs: COUNT_QUERY_TIMEOUT_MS },
  );
  const nameOf = React.useCallback((source: string) => actors.data?.data?.[source] ?? source, [actors.data]);

  const items = React.useMemo<Item[]>(() => {
    const fromChanges = parseList(changeLogEntrySchema, changes.data?.data).map<Item>((c) => {
      const { label, text } = countChangeParts(c);
      return {
        id: `c:${c.id}`,
        kind: c.type,
        group: c.parentEntityType ? 'lines' : 'plan',
        at: c.at,
        label,
        title: text,
        source: nameOf(c.source),
      };
    });
    const fromLedger = parseList(ledgerEntrySchema, ledger.data?.data).map<Item>((l: LedgerEntry) => ({
      id: `l:${l.id}`,
      kind: 'Ledger',
      group: 'inventory',
      at: l.at,
      source: nameOf(l.source ?? 'System'),
      label: l.sku ?? null,
      title: `${l.type} ${l.quantity > 0 ? '+' : l.quantity < 0 ? '−' : ''}${Math.abs(l.quantity).toLocaleString()}${l.detail ? ` in ${l.detail}` : ''}`,
    }));
    return [...fromChanges, ...fromLedger].sort((a, b) => b.at.localeCompare(a.at));
  }, [changes.data, ledger.data, nameOf]);

  if (changes.isPending || ledger.isPending) return <SkeletonText lines={5} />;
  if (changes.error || ledger.error) {
    return (
      <p role="alert" className="text-xs text-danger">
        Activity could not be loaded.{' '}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => {
            void changes.refetch();
            void ledger.refetch();
          }}
        >
          Retry
        </button>
      </p>
    );
  }

  const counts: Record<Filter, number> = {
    all: items.length,
    plan: items.filter((i) => i.group === 'plan').length,
    lines: items.filter((i) => i.group === 'lines').length,
    inventory: items.filter((i) => i.group === 'inventory').length,
  };
  const visible = filter === 'all' ? items : items.filter((i) => i.group === filter);
  const chips: readonly { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'plan', label: 'Plan' },
    { key: 'lines', label: 'Lines' },
    { key: 'inventory', label: 'Inventory' },
  ];

  return (
    <div className="flex max-w-[880px] flex-col gap-3">
      <div role="radiogroup" aria-label="Filter activity" className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={filter === c.key}
            onClick={() => {
              setFilter(c.key);
              setShown(PAGE);
            }}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              filter === c.key
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border bg-surface text-secondary hover:text-foreground',
            )}
          >
            {c.label}
            <span className="tabular-nums opacity-80">{counts[c.key]}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-sm text-secondary">
          {filter === 'inventory'
            ? 'No inventory has been posted from this count yet. Update Inv. writes Count transactions here.'
            : filter === 'lines'
              ? 'No line activity yet.'
              : 'No activity recorded for this count plan yet.'}
        </p>
      ) : (
        <ol className="relative flex flex-col gap-4 pl-1" aria-label="Activity">
          <span className="absolute bottom-2 left-[13px] top-2 w-px bg-border" aria-hidden />
          {visible.slice(0, shown).map((item) => {
            const meta = KIND_META[item.kind];
            const Icon = meta.icon;
            return (
              <li key={item.id} className="relative flex gap-3">
                <span
                  className={cn(
                    'z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface',
                    meta.dot,
                  )}
                >
                  <Icon className="h-3 w-3" aria-hidden />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="break-words text-sm text-body">
                    {item.label ? (
                      <>
                        <span className="font-semibold text-foreground">{item.label}</span>
                        <span className="px-1.5 text-faint" aria-hidden>
                          ·
                        </span>
                        <span className="sr-only">: </span>
                      </>
                    ) : null}
                    {item.title}
                  </p>
                  <p className="text-2xs text-faint">
                    {fmt.gridDateTime(item.at)} · {item.source}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {visible.length > shown ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown(shown + PAGE)}>
          Show more ({visible.length - shown})
        </Button>
      ) : null}
    </div>
  );
}
