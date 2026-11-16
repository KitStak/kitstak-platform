'use client';
/**
 * My work: everything assigned to me across boards, bucketed by date (Past dates → Without a
 * date), with inline status/date editing, one-click "Mark done" (animated, with Undo), board
 * filter, search and a "Show done" toggle. Filters persist in the URL.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, ChevronDown, LayoutGrid, RotateCcw } from 'lucide-react';
import {
  Button,
  EmptyState,
  SearchInput,
  Select,
  Skeleton,
  Switch,
  Tooltip,
  cn,
  labelColorVars,
  toLabelColor,
  toast,
} from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { PageFrame } from '@/features/shell/pages/page-frame';
import type { MyWorkBoardDto, MyWorkItemDto } from '@/server/services/contracts/inbox-mywork';
import { useIsMutating } from '@tanstack/react-query';
import { useOrgId } from '@/lib/hooks/org-context';
import {
  DEFERRED_WRITE_MS,
  myWorkCellKey,
  useDeferredMyWorkCell,
  useMyWork,
  useMyWorkCell,
} from './api';
import { DateCell, StatusPillCell } from './my-work-cells';
import { useUrlState, writeSearchParam } from './use-url-state';
import {
  bucketFor,
  buildMyWorkView,
  doneLabelOf,
  isNeutralDoneLabel,
  labelFor,
  type BucketId,
  type MyWorkRow as Row,
  type MyWorkSection,
} from './my-work-model';

const LEAVE_MS = 180;
const SEARCH_DEBOUNCE_MS = 300;

/** Footer that reveals/hides contacts, accounts and boards without a due date. */
function RecordsNote({
  hidden,
  shown,
  onToggle,
}: {
  readonly hidden: number;
  readonly shown: boolean;
  readonly onToggle: () => void;
}) {
  if (!shown && hidden === 0) return null;
  return (
    <p className="text-center text-sm text-fg-muted" data-testid="my-work-records-note">
      {shown
        ? 'Showing contacts, accounts and boards without a due date.'
        : `${hidden} other assigned ${hidden === 1 ? 'item' : 'items'} (contacts, accounts, boards without a due date) ${hidden === 1 ? 'is' : 'are'} hidden.`}{' '}
      <button
        type="button"
        onClick={onToggle}
        data-testid="my-work-records-toggle"
        className="rounded-xs font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {shown ? 'Hide them' : 'Show them'}
      </button>
    </p>
  );
}
const GRID = 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(120px,180px)_148px_132px] sm:items-center sm:gap-3';

function itemHref(orgSlug: string, item: MyWorkItemDto): string {
  return `${routes.board(orgSlug, item.boardId)}?item=${item.id}`;
}

interface RowProps {
  readonly row: Row;
  readonly bucket: BucketId;
  readonly orgSlug: string;
  readonly leaving: boolean;
  readonly onStatus: (row: Row, labelId: string | null) => void;
  readonly onDate: (row: Row, date: string | null) => void;
  readonly onDone: (row: Row) => void;
}

function MyWorkRowView({ row, bucket, orgSlug, leaving, onStatus, onDate, onDone }: RowProps) {
  const { item, board, done } = row;
  const status = board.status;
  const doneLabel = doneLabelOf(board);
  // One-click completion only for a neutral "Done"/"Completed" label: a pipeline outcome
  // (Won, Lost) is picked explicitly from the status pill, never by ticking a circle.
  const canMarkDone = board.canEdit && isNeutralDoneLabel(doneLabel) && !done;
  const overdue = !done && bucketFor(item.date) === 'overdue';
  const group = labelColorVars(toLabelColor(item.groupColor, 'blue'));
  return (
    <li
      data-testid="my-work-row"
      data-item-id={item.id}
      className={cn(
        'group/row relative flex flex-col gap-2 border-b border-border-subtle py-2 pr-3 pl-4 last:border-b-0 sm:py-1.5',
        'transition-[opacity,transform,background-color] duration-[var(--duration-fast)] ease-out hover:bg-hover',
        GRID,
        leaving && 'pointer-events-none translate-x-3 opacity-0',
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: group.bg }} />
      <div className="flex min-w-0 items-center gap-2">
        {done ? (
          <span
            role="img"
            aria-label="Done"
            data-testid="my-work-done-state"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-white"
          >
            <Check aria-hidden className="size-3" strokeWidth={3} />
          </span>
        ) : canMarkDone ? (
          <Tooltip content={`Mark as ${doneLabel?.name ?? 'done'}`}>
            <button
              type="button"
              aria-label={`Mark ${item.name} done`}
              onClick={() => onDone(row)}
              data-testid="my-work-done"
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border-strong text-transparent',
                'transition-colors duration-[var(--duration-fast)] ease-out',
                'hover:border-success hover:text-success active:bg-success-subtle',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              )}
            >
              <Check aria-hidden className="size-3" strokeWidth={3} />
            </button>
          </Tooltip>
        ) : (
          // No done label (or view-only): keep the column aligned without a fake control.
          <span aria-hidden className="size-5 shrink-0" />
        )}
        <Link
          href={itemHref(orgSlug, item)}
          className={cn(
            'min-w-0 truncate rounded-xs text-base font-medium hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus',
            done ? 'text-fg-muted line-through decoration-fg-muted/60' : 'text-fg',
          )}
        >
          {item.name}
        </Link>
      </div>
      <Link
        href={routes.board(orgSlug, board.id)}
        className="flex min-w-0 items-center gap-1.5 rounded-xs pl-7 text-sm text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-focus sm:pl-0"
      >
        <LayoutGrid aria-hidden className="size-3.5 shrink-0 text-icon" />
        <span className="truncate">
          {board.name}
          <span className="text-fg-muted"> · {item.groupTitle}</span>
        </span>
      </Link>
      <div className="grid grid-cols-2 gap-2 pl-7 sm:contents">
        <div>
          {status ? (
            <StatusPillCell
              label={labelFor(board, item.statusLabelId)}
              labels={status.labels}
              columnTitle={status.title}
              disabled={!board.canEdit}
              onChange={(labelId) => onStatus(row, labelId)}
            />
          ) : (
            <span aria-hidden className="block h-8" />
          )}
        </div>
        <div>
          {board.date ? (
            <DateCell
              value={item.date}
              columnTitle={board.date.title}
              overdue={overdue}
              bucket={bucket}
              disabled={!board.canEdit}
              onChange={(date) => onDate(row, date)}
            />
          ) : (
            <span aria-hidden className="block h-8" />
          )}
        </div>
      </div>
    </li>
  );
}

const TONE: Readonly<Record<MyWorkSection['tone'], string>> = {
  danger: 'text-danger-text',
  primary: 'text-primary-text',
  neutral: 'text-fg',
};

function Section({
  section,
  collapsed,
  onToggle,
  children,
}: {
  readonly section: MyWorkSection;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  const id = `my-work-${section.id}`;
  return (
    <section aria-labelledby={`${id}-title`} data-testid="my-work-section" data-bucket={section.id}>
      <h2 id={`${id}-title`} className="mb-1.5">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={onToggle}
          className="group/head -ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-sm px-1.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 text-icon transition-transform duration-[var(--duration-fast)] ease-out',
              collapsed && '-rotate-90',
            )}
          />
          <span className={cn('text-md font-semibold', TONE[section.tone])}>
            {section.title}
          </span>
          <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary tabular-nums">
            {section.rows.length}
          </span>
        </button>
      </h2>
      {collapsed ? null : (
        <div id={id} className="overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs">
          <div
            aria-hidden
            className={cn(
              'hidden border-b border-border-subtle bg-muted/50 py-2 pr-3 pl-4 text-xs font-medium text-fg-muted',
              GRID,
            )}
          >
            <span className="pl-7">Item</span>
            <span>Board</span>
            <span className="text-center">Status</span>
            <span className="pl-3">Date</span>
          </div>
          <ul>{children}</ul>
        </div>
      )}
    </section>
  );
}

function PageSkeleton() {
  return (
    <div data-skeleton aria-hidden className="flex flex-col gap-6">
      {[4, 3].map((rows, sectionIndex) => (
        <div key={sectionIndex} className="flex flex-col gap-2">
          <Skeleton width={140} height={20} />
          <div className="rounded-lg border border-border-subtle bg-panel">
            {Array.from({ length: rows }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
              >
                <Skeleton width={20} height={20} rounded="full" />
                <Skeleton height={14} width={`${40 - index * 4}%`} />
                <span className="flex-1" />
                <Skeleton width={140} height={28} className="hidden sm:block" />
                <Skeleton width={110} height={14} className="hidden sm:block" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MyWorkPage() {
  const { org } = useOrg();
  const myWork = useMyWork();
  const orgId = useOrgId();
  const setCell = useMyWorkCell();
  const deferCell = useDeferredMyWorkCell();
  const writing = useIsMutating({ mutationKey: myWorkCellKey(orgId) });
  // A queued/in-flight edit would be lost on reload: ask before leaving. Deferred (Undo window)
  // writes are flushed with keepalive on pagehide instead.
  useEffect(() => {
    if (writing === 0) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [writing]);
  const [searchParam, setSearchParam] = useUrlState('q', SEARCH_DEBOUNCE_MS);
  const [boardId, setBoardId] = useUrlState('board');
  const [doneParam, setDoneParam] = useUrlState('done');
  const [recordsParam, setRecordsParam] = useUrlState('records');
  const [collapsed, setCollapsed] = useState<ReadonlySet<BucketId>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const search = searchParam ?? '';
  const showDone = doneParam === '1';
  const showRecords = recordsParam === '1';
  const setShowDone = useCallback((on: boolean) => setDoneParam(on ? '1' : null), [setDoneParam]);
  const setShowRecords = useCallback((on: boolean) => setRecordsParam(on ? '1' : null), [setRecordsParam]);

  const view = useMemo(
    () => (myWork.data ? buildMyWorkView(myWork.data, { boardId, search, showDone, showRecords }) : null),
    [myWork.data, boardId, search, showDone, showRecords],
  );

  const writeStatus = useCallback(
    (board: MyWorkBoardDto, item: MyWorkItemDto, labelId: string | null) => {
      if (!board.status) return;
      setCell.mutate({
        itemId: item.id,
        boardId: board.id,
        columnKey: board.status.key,
        value: labelId ? { labelId } : null,
        patch: { statusLabelId: labelId },
      });
    },
    [setCell],
  );

  const onStatus = useCallback(
    (row: Row, labelId: string | null) => {
      const previous = row.item.statusLabelId;
      if (previous === labelId) return;
      const next = labelFor(row.board, labelId);
      const status = row.board.status;
      if (status && (next?.isDone || next?.isClosed) && !showDone) {
        // Leaves the list: animate out and offer Undo. The write waits out the Undo window, so
        // an undone change never reaches the server (no automations, no notifications).
        let pending: { cancel: () => boolean } | null = null;
        let undone = false;
        setLeaving((current) => new Set(current).add(row.item.id));
        setTimeout(() => {
          if (!undone)
            pending = deferCell(
              {
                itemId: row.item.id,
                boardId: row.board.id,
                columnKey: status.key,
                value: labelId ? { labelId } : null,
                patch: { statusLabelId: labelId },
              },
              { statusLabelId: previous },
              DEFERRED_WRITE_MS - LEAVE_MS,
            );
          setLeaving((current) => {
            const copy = new Set(current);
            copy.delete(row.item.id);
            return copy;
          });
        }, LEAVE_MS);
        toast.undo(`${row.item.name} marked ${next.name}`, {
          duration: DEFERRED_WRITE_MS,
          onUndo: () => {
            undone = true;
            // Already sent (window elapsed / tab hidden): write the previous value back.
            if (pending && !pending.cancel()) writeStatus(row.board, row.item, previous);
          },
        });
        return;
      }
      writeStatus(row.board, row.item, labelId);
    },
    [showDone, writeStatus, deferCell],
  );

  const onDone = useCallback(
    (row: Row) => {
      const label = doneLabelOf(row.board);
      if (label) onStatus(row, label.id);
    },
    [onStatus],
  );

  const onDate = useCallback(
    (row: Row, date: string | null) => {
      if (!row.board.date || date === row.item.date) return;
      setCell.mutate({
        itemId: row.item.id,
        boardId: row.board.id,
        columnKey: row.board.date.key,
        // Keep a stored time of day; only the calendar day changes here.
        value: date ? { date, ...(row.item.time ? { time: row.item.time } : {}) } : null,
        patch: { date },
      });
    },
    [setCell],
  );

  const boardOptions = [
    { value: 'all', label: 'All boards' },
    ...(myWork.data?.boards ?? []).map((board) => ({ value: board.id, label: board.name })),
  ];
  const filtered = Boolean(search.trim()) || Boolean(boardId);
  const assignedTotal = myWork.data?.items.length ?? 0;

  return (
    <PageFrame
      title="My work"
      icon={<CalendarCheck />}
      width="wide"
    >
      <div className="-mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onValueChange={(value) => setSearchParam(value || null)}
          placeholder="Search my items"
          aria-label="Search my items"
          containerClassName="sm:w-72"
        />
        <Select
          value={boardId ?? 'all'}
          onValueChange={(value) => setBoardId(value === 'all' ? null : value)}
          options={boardOptions}
          aria-label="Filter by board"
          className="sm:w-56"
        />
        <span className="hidden flex-1 sm:block" />
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <span className="text-sm text-fg-muted tabular-nums" aria-live="polite">
            {view ? `${view.total} ${view.total === 1 ? 'item' : 'items'}` : ''}
          </span>
          <Switch
            checked={showDone}
            onCheckedChange={setShowDone}
            label="Show done"
            data-testid="my-work-show-done"
          />
        </div>
      </div>

      <div aria-busy={myWork.isPending || undefined} className="flex flex-col gap-6">
        {myWork.isPending ? (
          <PageSkeleton />
        ) : myWork.isError ? (
          <EmptyState
            illustration="error"
            title="We couldn't load your work"
            description="Check your connection and try again."
            actions={
              <Button
                variant="secondary"
                leadingIcon={<RotateCcw aria-hidden />}
                onClick={() => void myWork.refetch()}
              >
                Try again
              </Button>
            }
          />
        ) : assignedTotal === 0 ? (
          <EmptyState
            illustration="board"
            title="Nothing assigned to you yet"
            description="Items where you're in a People column land here, grouped by date."
            actions={
              <Link
                href={routes.home(org.slug)}
                className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Go to Home
              </Link>
            }
          />
        ) : view && view.sections.length === 0 ? (
          filtered ? (
            <EmptyState
              illustration="search"
              title="No items match"
              description="Try a different search or board."
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearchParam(null);
                    setBoardId(null);
                    writeSearchParam('q', null);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              illustration="favorites"
              title="You're all done"
              description={
                view.hiddenDone > 0
                  ? `All ${view.hiddenDone} assigned work items are done.`
                  : 'Nothing with a due date is assigned to you right now.'
              }
              actions={
                <>
                  {view.hiddenDone > 0 ? (
                    <Button variant="secondary" onClick={() => setShowDone(true)}>
                      Show done items
                    </Button>
                  ) : null}
                  {view.hiddenRecords > 0 ? (
                    <Button variant="secondary" onClick={() => setShowRecords(true)}>
                      Show other records
                    </Button>
                  ) : null}
                </>
              }
            />
          )
        ) : (
          view?.sections.map((section) => (
            <Section
              key={section.id}
              section={section}
              collapsed={collapsed.has(section.id)}
              onToggle={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })
              }
            >
              {section.rows.map((row) => (
                <MyWorkRowView
                  key={row.item.id}
                  row={row}
                  bucket={section.id}
                  orgSlug={org.slug}
                  leaving={leaving.has(row.item.id)}
                  onStatus={onStatus}
                  onDate={onDate}
                  onDone={onDone}
                />
              ))}
            </Section>
          ))
        )}
        {view && view.hiddenDone > 0 && view.sections.length > 0 && !showDone ? (
          <p className="text-center text-sm text-fg-muted">
            {view.hiddenDone} done {view.hiddenDone === 1 ? 'item is' : 'items are'} hidden.{' '}
            <button
              type="button"
              onClick={() => setShowDone(true)}
              className="rounded-xs font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              Show done
            </button>
          </p>
        ) : null}
        {view && view.sections.length > 0 ? (
          <RecordsNote
            hidden={view.hiddenRecords}
            shown={showRecords}
            onToggle={() => setShowRecords(!showRecords)}
          />
        ) : null}
        {myWork.data?.truncated ? (
          <p className="text-center text-sm text-fg-muted">
            Showing your 1,000 most recently updated items. Filter by board to narrow it down.
          </p>
        ) : null}
      </div>
    </PageFrame>
  );
}
