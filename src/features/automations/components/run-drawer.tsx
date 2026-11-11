'use client';
/**
 * Run detail drawer: plain-language error with a next step, trigger before → after rendered as
 * cell values (status pills, people names), what each action did ("Set Stage to [Won]"),
 * a collapsible raw payload and one-click Retry.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, ChevronRight, ExternalLink, Filter, Pencil, RotateCcw } from 'lucide-react';
import { Button, Drawer, DrawerContent, StatusPill, toLabelColor, toast } from '@/components/ui';
import { errorMessage } from '@/lib/hooks';
import { routes } from '@/features/shell/routes';
import type { BoardRunDto } from '@/server/services/contracts/automations-center';
import type { AutomationDto } from '@/server/services/contracts/dto';
import { useRetryRun } from '../api';
import { draftFromAutomation, draftParts } from '../model/draft';
import { createResolver, type BuilderContext } from '../model/resolver';
import { explainRunError } from '../model/run-errors';
import { formatDateTime, formatDuration } from './format';
import { SentenceText } from './sentence';

export const STATUS_META: Readonly<
  Record<BoardRunDto['status'], { label: string; color: 'green' | 'red' | 'gray' | 'orange' }>
> = {
  succeeded: { label: 'Success', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
  skipped: { label: 'Skipped', color: 'gray' },
  pending: { label: 'Pending', color: 'orange' },
  running: { label: 'Running', color: 'orange' },
};

const ACTION_LABELS: Readonly<Record<string, string>> = {
  notify: 'Sent a notification',
  set_status: 'Changed a status',
  set_column: 'Set a column',
  clear_column: 'Cleared a column',
  set_date: 'Set a date',
  move_to_group: 'Moved to a group',
  assign_person: 'Assigned a person',
  create_item: 'Created an item',
  create_update: 'Posted an update',
  archive_item: 'Archived the item',
};

interface Outcome {
  readonly type: string;
  readonly detail?: Record<string, unknown>;
}

function Payload({ label, value }: { readonly label: string; readonly value: unknown }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-xs font-semibold text-fg-secondary">{label}</div>
      <pre className="max-h-40 overflow-auto rounded-md border border-border-subtle bg-sunken p-2 font-mono text-xs leading-5 whitespace-pre-wrap text-fg">
        {value === undefined || value === null ? 'empty' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function userNames(ids: readonly string[], context: BuilderContext): string {
  return ids.map((id) => context.users.find((user) => user.id === id)?.name ?? 'Former member').join(', ');
}

/** Cell value → inline display (status pill, people names, date, text); null when unknown shape. */
function cellDisplay(columnKey: string | undefined, value: unknown, context: BuilderContext): ReactNode | null {
  const column = columnKey ? context.columns.find((entry) => entry.key === columnKey) : undefined;
  if (value === undefined || value === null || value === '') return <span className="text-fg-muted">Empty</span>;
  if (column?.type === 'status' && typeof (value as { labelId?: unknown }).labelId === 'string') {
    const found = createResolver(context).label(column.key, (value as { labelId: string }).labelId);
    return found ? (
      // Subtle tone (label-tinted background, AA label text) so every palette color stays readable.
      <StatusPill
        label={found.name}
        color={toLabelColor(found.color)}
        className="min-w-0 align-middle"
      />
    ) : (
      <span className="text-fg-muted">Deleted label</span>
    );
  }
  if (column?.type === 'people' && Array.isArray((value as { ids?: unknown }).ids)) {
    const ids = (value as { ids: string[] }).ids;
    return ids.length ? userNames(ids, context) : 'Nobody';
  }
  if (typeof (value as { date?: unknown }).date === 'string') return (value as { date: string }).date;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof (value as { text?: unknown }).text === 'string') return (value as { text: string }).text;
  if (typeof (value as { number?: unknown }).number === 'number')
    return String((value as { number: number }).number);
  return null;
}

function FriendlyValue({
  label,
  value,
  context,
  columnKey,
}: {
  readonly label: string;
  readonly value: unknown;
  readonly context: BuilderContext;
  readonly columnKey?: string;
}) {
  const content = cellDisplay(columnKey, value, context);
  if (content === null) return <Payload label={label} value={value} />;
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-xs font-semibold text-fg-secondary">{label}</div>
      <div className="flex min-h-10 items-center rounded-md border border-border-subtle bg-sunken px-3 py-2 text-sm text-fg">
        {content}
      </div>
    </div>
  );
}

function Strong({ children }: { readonly children: ReactNode }) {
  return <span className="font-semibold">{children}</span>;
}

/** "Set Stage to [Won]", "Assigned Maya Chen to Owner", "Moved to Closed won"… */
export function OutcomeLine({ outcome, context }: { readonly outcome: Outcome; readonly context: BuilderContext }) {
  const detail = outcome.detail ?? {};
  const term = context.term.toLowerCase();
  const columnKey = typeof detail.columnKey === 'string' ? detail.columnKey : undefined;
  const column = columnKey ? context.columns.find((entry) => entry.key === columnKey) : undefined;
  const columnName = column ? <Strong>{column.title}</Strong> : columnKey ? <Strong>a deleted column</Strong> : null;
  switch (outcome.type) {
    case 'set_status':
      if (columnName && typeof detail.labelId === 'string')
        return (
          <>
            Set {columnName} to {cellDisplay(columnKey, { labelId: detail.labelId }, context)}
          </>
        );
      break;
    case 'set_column': {
      if (!columnName) break;
      const shown = 'value' in detail ? cellDisplay(columnKey, detail.value, context) : null;
      return shown ? (
        <>
          Set {columnName} to {shown}
        </>
      ) : (
        <>Updated {columnName}</>
      );
    }
    case 'set_date':
      if (columnName)
        return typeof detail.date === 'string' ? (
          <>
            Set {columnName} to <Strong>{detail.date}</Strong>
          </>
        ) : (
          <>Set the date in {columnName}</>
        );
      break;
    case 'clear_column':
      if (columnName) return <>Cleared {columnName}</>;
      break;
    case 'assign_person':
      if (columnName && Array.isArray(detail.ids))
        return (
          <>
            {columnName} is now <Strong>{userNames(detail.ids as string[], context) || 'nobody'}</Strong>
          </>
        );
      break;
    case 'move_to_group': {
      if (detail.skipped === 'subitem') return <>Skipped moving: subitems stay with their parent</>;
      const group = context.groups.find((entry) => entry.id === detail.groupId);
      return (
        <>
          Moved the {term} to <Strong>{group?.title ?? 'another group'}</Strong>
        </>
      );
    }
    case 'notify': {
      const count = typeof detail.notified === 'number' ? detail.notified : null;
      if (count === null) break;
      return count === 0 ? (
        <>Nobody to notify (the recipients list was empty)</>
      ) : (
        <>
          Notified <Strong>{count === 1 ? '1 person' : `${count} people`}</Strong>
        </>
      );
    }
    case 'create_item': {
      const board = context.boards.find((entry) => entry.id === detail.boardId);
      return (
        <>
          Created an item on <Strong>{board?.name ?? 'another board'}</Strong>
        </>
      );
    }
    case 'archive_item':
      return <>Archived the {term}</>;
    default:
      break;
  }
  return <>{ACTION_LABELS[outcome.type] ?? outcome.type.replaceAll('_', ' ')}</>;
}

function triggerText(type: string | undefined, columnTitle: string | undefined, term: string): string {
  switch (type) {
    case 'manual_run':
      return 'Run manually';
    case 'column_changed':
      return `${columnTitle ?? 'A column'} changed`;
    case 'item_created':
      return `The ${term} was created`;
    case 'item_moved':
      return `The ${term} moved to another group`;
    case 'date_arrived':
      return 'A date arrived';
    default:
      return 'Trigger event';
  }
}

export interface RunDrawerProps {
  readonly run: BoardRunDto | null;
  readonly orgSlug: string;
  readonly context: BuilderContext;
  readonly canEdit: boolean;
  readonly onClose: () => void;
  /** Where focus goes when the drawer closes (the row that opened it). */
  readonly returnFocus: () => void;
  /** The automation that ran (undefined when it was deleted since). */
  readonly automation?: AutomationDto;
  readonly onEditAutomation?: (automation: AutomationDto) => void;
  /** Narrows run history to this run's automation. */
  readonly onFilterAutomation?: (automationId: string) => void;
}

export function RunDrawer({
  run,
  orgSlug,
  context,
  canEdit,
  onClose,
  returnFocus,
  automation,
  onEditAutomation,
  onFilterAutomation,
}: RunDrawerProps) {
  const retry = useRetryRun(context.boardId);
  const explained = explainRunError(run?.error ?? null);
  const event = run?.triggerEvent as
    | { before?: unknown; after?: unknown; type?: string; columnKey?: string }
    | undefined;
  const outcomes = ((run?.result as { actions?: Outcome[] } | null)?.actions ?? []).filter(
    (entry) => typeof entry?.type === 'string',
  );
  const column = event?.columnKey ? context.columns.find((entry) => entry.key === event.columnKey) : undefined;
  const term = context.term.toLowerCase();
  const sentence = automation ? draftParts(draftFromAutomation(automation), createResolver(context)) : null;

  const doRetry = () => {
    if (!run) return;
    retry.mutate(run.id, {
      onSuccess: (result) => {
        if (result.status === 'succeeded') toast.success('Run retried successfully');
        else toast.error('Retry did not succeed', result.error ?? undefined);
        onClose();
      },
      onError: (cause) => toast.error('Couldn’t retry the run', errorMessage(cause)),
    });
  };

  return (
    <Drawer open={run !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {run ? (
        <DrawerContent
          width={520}
          title={run.automationName}
          description={formatDateTime(run.createdAt)}
          data-testid="run-drawer"
          onOpenAutoFocus={focusPanel}
          onCloseAutoFocus={(closeEvent) => {
            closeEvent.preventDefault();
            returnFocus();
          }}
        >
          <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
              {explained ? (
                // Failed runs lead with what went wrong and what to do next.
                <div role="alert" className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3">
                  <p className="font-semibold text-danger-text">{explained.title}</p>
                  <p className="mt-1 text-sm text-fg">{explained.hint}</p>
                </div>
              ) : null}
              <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-sunken px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill label={STATUS_META[run.status].label} color={STATUS_META[run.status].color} />
                  <span className="text-sm text-fg-secondary">Took {formatDuration(run.durationMs)}</span>
                </div>
                {sentence ? (
                  <p className="text-sm leading-6 text-fg" data-testid="run-drawer-sentence">
                    <SentenceText parts={sentence} term={context.term} />
                  </p>
                ) : (
                  <p className="text-sm text-fg-secondary">This automation has since been deleted.</p>
                )}
              </div>
              <section className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{context.term}</h3>
                {run.itemId && run.itemName ? (
                  <Link
                    href={`${routes.board(orgSlug, context.boardId)}?item=${run.itemId}`}
                    className="inline-flex items-center gap-1 self-start rounded-xs font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {run.itemName}
                    <ExternalLink aria-hidden className="size-3.5" />
                  </Link>
                ) : (
                  <p className="text-sm text-fg-secondary">This {term} was deleted.</p>
                )}
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">What triggered it</h3>
                <p className="text-sm text-fg">{triggerText(event?.type, column?.title, term)}</p>
                {'before' in (event ?? {}) || 'after' in (event ?? {}) ? (
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
                    <FriendlyValue label="Before" value={event?.before} context={context} columnKey={event?.columnKey} />
                    <ArrowRight aria-hidden className="mt-8 hidden size-4 shrink-0 text-icon sm:block" />
                    <FriendlyValue label="After" value={event?.after} context={context} columnKey={event?.columnKey} />
                  </div>
                ) : null}
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">What it did</h3>
                {outcomes.length > 0 ? (
                  <ol className="flex flex-col gap-1.5" data-testid="run-outcomes">
                    {outcomes.map((outcome, index) => (
                      <li key={index} className="flex items-start gap-2.5 text-sm leading-6 text-fg">
                        <span
                          aria-hidden
                          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-subtle text-[11px] font-semibold text-success-text tabular-nums"
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <OutcomeLine outcome={outcome} context={context} />
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-fg-secondary">
                    {run.status === 'failed'
                      ? 'No action completed; every change was rolled back.'
                      : 'No actions recorded.'}
                  </p>
                )}
              </section>
              <details className="group rounded-md border border-border-subtle">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-fg transition-colors duration-[var(--duration-fast)] hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-4 text-icon transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] group-open:rotate-90"
                  />
                  Raw payload
                </summary>
                <div className="px-3 pb-3">
                  <Payload label="Trigger event" value={run.triggerEvent} />
                  <div className="h-2" />
                  <Payload label="Result" value={run.result} />
                </div>
              </details>
            </div>
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-6 py-4">
              {automation && onFilterAutomation ? (
                <Button
                  variant="ghost"
                  leadingIcon={<Filter aria-hidden />}
                  onClick={() => {
                    onFilterAutomation(automation.id);
                    onClose();
                  }}
                  data-testid="run-filter-automation"
                >
                  Runs for this automation
                </Button>
              ) : null}
              {automation && onEditAutomation && canEdit ? (
                <Button
                  variant="secondary"
                  leadingIcon={<Pencil aria-hidden />}
                  onClick={() => {
                    onClose();
                    onEditAutomation(automation);
                  }}
                  data-testid="run-edit-automation"
                >
                  Edit automation
                </Button>
              ) : null}
              {run.status === 'failed' || run.status === 'skipped' ? (
                <Button
                  leadingIcon={<RotateCcw aria-hidden />}
                  onClick={doRetry}
                  loading={retry.isPending}
                  disabled={!canEdit || !run.itemId}
                  data-testid="run-retry"
                >
                  Retry run
                </Button>
              ) : null}
            </footer>
          </div>
        </DrawerContent>
      ) : null}
    </Drawer>
  );
}

/** Focus the panel itself on open (keeps the close button's tooltip from popping and eating Esc). */
function focusPanel(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}
