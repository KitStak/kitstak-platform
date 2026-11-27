'use client';
/**
 * Main-column sections of the home page: recently visited, my work this week, updates feed.
 * Sections are `DashSection`s from `@kitstak/ui/dashboard`: one real header link at most, and
 * every empty state names the next step with a link (docs/design/UI-CLEANUP.md, "No dead ends").
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { DashSection, EmptyNote } from '@kitstak/ui/dashboard';
import { Avatar, Button, EmptyState, Skeleton, StatusPill, cn, toLabelColor } from '@/components/ui';
import type { HomeRecentDto, HomeUpdateDto, HomeWorkItemDto } from '@/features/shell/api';
import { EntityIcon } from '@/features/shell/entity-icon';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { columnsThatFit, formatDueLabel, formatRelativeTime, pluralize, proportions } from './format';

/** Shared error state for every section fed by the home query (never a false "all clear"). */
export function SectionError({ what, onRetry }: { readonly what: string; readonly onRetry: () => void }) {
  return (
    <EmptyState
      size="sm"
      illustration="error"
      title={`Couldn't load ${what}`}
      description="Check your connection, then try again."
      actions={
        <Button variant="secondary" size="sm" onClick={onRetry} data-testid="home-retry">
          Try again
        </Button>
      }
    />
  );
}

/** Fixed card height so board and dashboard cards (and their skeletons) never shift the page. */
const RECENT_CARD_HEIGHT = 136;

function RecentCard({ recent }: { readonly recent: HomeRecentDto }) {
  const { org } = useOrg();
  const isBoard = recent.entityType === 'board';
  const href = isBoard ? routes.board(org.slug, recent.id) : routes.dashboard(org.slug, recent.id);
  const widths = proportions(recent.groups.map((group) => group.count));
  const noun = isBoard ? (recent.itemTerminology ?? 'Item') : 'widget';
  return (
    <li className="min-w-0">
      <Link
        href={href}
        data-testid="home-recent-card"
        className={cn(
          'group relative flex h-[var(--recent-card-h)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
          'hover:border-border-strong hover:bg-muted',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <span className="flex flex-1 flex-col gap-3 p-4">
          <span className="flex min-w-0 items-start gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken [&_svg]:size-[18px]">
              <EntityIcon type={isBoard ? 'board' : 'dashboard'} boardKind={recent.boardKind} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold text-fg underline-offset-2 group-hover:underline" title={recent.name}>
                {recent.name}
              </span>
              <span className="truncate text-xs text-fg-muted">
                {recent.workspaceName ?? 'Workspace'} · {formatRelativeTime(recent.visitedAt)}
              </span>
            </span>
          </span>
          <span className="mt-auto flex flex-col gap-1.5">
            <span className="text-sm text-fg-secondary tabular-nums">
              <span className="font-semibold text-fg">{recent.count.toLocaleString()}</span>{' '}
              {pluralize(noun.toLowerCase(), recent.count)}
            </span>
            {/* Same bar slot on every card (dashboards get an empty track) so metric lines align. */}
            <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
              {isBoard
                ? recent.groups.map((group, index) => (
                    <span
                      key={`${group.title}-${index}`}
                      // Each group's own label color: visible on the track in both themes and
                      // matching the dots in the hover breakdown.
                      className="border-r border-panel last:border-r-0"
                      style={{ width: `${widths[index] ?? 0}%`, background: `var(--label-${toLabelColor(group.color)})` }}
                    />
                  ))
                : null}
            </span>
          </span>
        </span>
        {isBoard && recent.groups.length > 0 ? (
          <span
            aria-hidden
            className={cn(
              // `invisible` (transitioned) keeps the hidden panel out of paint and hit-testing;
              // no reveal delay — the breakdown fades in as soon as the card is hovered instead
              // of popping over the metrics 300ms after the pointer settles.
              'pointer-events-none invisible absolute inset-x-0 bottom-0 flex translate-y-2 flex-col gap-1 border-t border-border-subtle bg-raised/95 px-4 py-3 opacity-0 backdrop-blur-sm',
              'transition-[opacity,transform,visibility] duration-[var(--duration-normal)] ease-[var(--ease-out)]',
              'group-hover:visible group-hover:translate-y-0 group-hover:opacity-100',
              'group-focus-visible:visible group-focus-visible:translate-y-0 group-focus-visible:opacity-100',
            )}
          >
            {recent.groups.slice(0, 4).map((group, index) => (
              <span key={`${group.title}-${index}`} className="flex items-center gap-2 text-xs">
                <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--label-${toLabelColor(group.color)})` }} />
                <span className="min-w-0 flex-1 truncate text-fg-secondary">{group.title}</span>
                <span className="font-semibold text-fg tabular-nums">{group.count}</span>
              </span>
            ))}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

const RECENT_CARD_MIN = 220;
const RECENT_GAP = 12;
const DEFAULT_COLUMNS = 4;

/** Live column count for a one-row card grid (ResizeObserver on the section). */
function useFittingColumns(minWidth: number, gap: number) {
  const ref = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setColumns(columnsThatFit(element.clientWidth, minWidth, gap));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [minWidth, gap]);
  return { ref, columns };
}

/** Mobile: a horizontal rail whose first card lines up with the page gutter (scroll-padding). */
const RAIL =
  '-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [&>li]:w-[240px] [&>li]:shrink-0 [&>li]:snap-start sm:mx-0 sm:grid sm:scroll-px-0 sm:overflow-visible sm:px-0 sm:pb-0 sm:[&>li]:w-auto';

export function RecentSection({
  recents,
  loading,
  error,
  onRetry,
}: {
  readonly recents: readonly HomeRecentDto[];
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
}) {
  const { ref, columns } = useFittingColumns(RECENT_CARD_MIN, RECENT_GAP);
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, recents.length - columns);
  // One full row (never an orphaned partial row); "See all" reveals the rest.
  const shown = expanded ? recents : recents.slice(0, columns);
  const gridStyle = {
    '--recent-cols': String(columns),
    '--recent-card-h': `${RECENT_CARD_HEIGHT}px`,
  } as React.CSSProperties;
  const canToggleMobile = recents.length > 1;

  // Nothing visited yet: hide the module entirely so real content (work, updates) leads the
  // page instead of an empty placeholder spending the above-the-fold slot.
  if (!loading && !error && recents.length === 0) return null;

  return (
    <section ref={ref} aria-labelledby="home-recents" className="flex flex-col gap-3" style={gridStyle}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-recents" className="text-md font-semibold text-fg">
          Recently visited
        </h2>
        {!loading && !error && (hidden > 0 || canToggleMobile) ? (
          <button
            type="button"
            aria-expanded={expanded}
            data-testid="home-recents-toggle"
            onClick={() => setExpanded((value) => !value)}
            // Same neutral look as a section's header link (crimson is reserved for the primary button).
            className={cn(
              'ks-dash-section-action h-7 cursor-pointer border-0 bg-transparent px-1.5 focus-visible:outline-2 focus-visible:outline-focus',
              hidden === 0 && 'sm:hidden',
            )}
          >
            {expanded ? 'Show less' : `See all ${recents.length}`}
            <ArrowRight aria-hidden className={cn('size-3.5 transition-transform', expanded && '-rotate-90')} />
          </button>
        ) : null}
      </div>
      {loading ? (
        <ul
          aria-hidden
          data-skeleton
          className={cn(RAIL, 'sm:[grid-template-columns:repeat(var(--recent-cols),minmax(0,1fr))]')}
          style={gridStyle}
        >
          {Array.from({ length: Math.max(columns, 2) }, (_, index) => (
            <li key={index}>
              <Skeleton height={RECENT_CARD_HEIGHT} rounded="lg" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <SectionError what="recent boards" onRetry={onRetry} />
      ) : (
        <>
          {/* Mobile rail: every recent, scrolled horizontally. */}
          <ul className={cn(expanded ? 'flex flex-col gap-3' : RAIL, 'sm:hidden')} data-testid="home-recents-rail">
            {recents.map((recent) => (
              <RecentCard key={`${recent.entityType}:${recent.id}`} recent={recent} />
            ))}
          </ul>
          <ul
            className="hidden gap-3 sm:grid sm:[grid-template-columns:repeat(var(--recent-cols),minmax(0,1fr))]"
            style={gridStyle}
            data-testid="home-recents-grid"
          >
            {shown.map((recent) => (
              <RecentCard key={`${recent.entityType}:${recent.id}`} recent={recent} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function WorkRow({ item, today }: { readonly item: HomeWorkItemDto; readonly today: string }) {
  const { org } = useOrg();
  const due = formatDueLabel(item.dueDate, today);
  return (
    <li>
      <Link
        href={routes.item(org.slug, item.boardId, item.id)}
        data-testid="home-work-row"
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:grid-cols-[minmax(0,1fr)_112px_88px]"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-fg underline-offset-2 group-hover:underline" title={item.name}>
            {item.name}
          </span>
          <span className="flex min-w-0 items-center gap-1 truncate text-xs text-fg-muted">
            <EntityIcon type="board" boardKind={item.boardKind} className="size-3" />
            <span className="truncate">{item.boardName}</span>
            <span aria-hidden>›</span>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--label-${toLabelColor(item.groupColor)})` }} />
            <span className="truncate">{item.groupTitle}</span>
          </span>
          {item.status ? (
            <span className="mt-1 flex sm:hidden" data-testid="home-work-pill-compact">
              <StatusPill label={item.status.name} color={toLabelColor(item.status.color)} className="min-w-0" />
            </span>
          ) : null}
        </span>
        <span className="hidden sm:flex">
          {item.status ? (
            <StatusPill label={item.status.name} color={toLabelColor(item.status.color)} className="min-w-0" />
          ) : (
            <span className="flex h-7 w-full items-center justify-center rounded-sm bg-[var(--label-gray)] text-xs text-[var(--label-gray-fg)]">
              No status
            </span>
          )}
        </span>
        <span
          className={cn(
            'inline-flex items-center justify-end gap-1 text-sm font-medium tabular-nums',
            due.tone === 'overdue' ? 'text-danger-text' : due.tone === 'today' ? 'text-warning-text' : 'text-fg-secondary',
          )}
        >
          {due.tone === 'overdue' ? <span className="sr-only">Overdue, </span> : null}
          {due.text}
        </span>
      </Link>
    </li>
  );
}

/** Body heights reserved while loading so a short result does not collapse the column. */
const WORK_BODY_MIN = 'min-h-[136px]';
const UPDATES_BODY_MIN = 'min-h-[156px]';

export function MyWorkSection({
  work,
  today,
  loading,
  error = false,
  onRetry,
}: {
  readonly work: readonly HomeWorkItemDto[];
  readonly today: string;
  readonly loading: boolean;
  readonly error?: boolean;
  readonly onRetry?: () => void;
}) {
  const { org } = useOrg();
  const overdue = work.filter((item) => item.overdue).length;
  const empty = !loading && !error && work.length === 0;
  return (
    <DashSection
      title="My work due this week"
      // Overdue is a number that matters: colored words in the header, not a tinted band.
      description={
        overdue > 0 ? (
          <span className="font-medium text-danger-text" data-testid="home-work-overdue">
            {overdue} overdue
          </span>
        ) : undefined
      }
      // The empty note carries the link when there is nothing to list (said once).
      action={empty ? undefined : { label: 'All my work', href: routes.myWork(org.slug) }}
      flush
    >
      {loading ? (
        <div className={cn('flex flex-col gap-2 p-4', WORK_BODY_MIN)} data-skeleton aria-hidden>
          {[0, 1].map((index) => (
            <Skeleton key={index} height={48} rounded="md" />
          ))}
        </div>
      ) : error ? (
        <div className={WORK_BODY_MIN}>
          <SectionError what="your work" onRetry={() => onRetry?.()} />
        </div>
      ) : work.length === 0 ? (
        <EmptyNote action={{ label: 'See everything assigned to you', href: routes.myWork(org.slug) }}>
          You&apos;re all caught up. Nothing assigned to you is due before the weekend.
        </EmptyNote>
      ) : (
        <ul className={cn('flex flex-col divide-y divide-border-subtle py-1', WORK_BODY_MIN)}>
          {work.map((item) => (
            <WorkRow key={item.id} item={item} today={today} />
          ))}
        </ul>
      )}
    </DashSection>
  );
}

export function UpdatesSection({
  updates,
  loading,
  error = false,
  onRetry,
}: {
  readonly updates: readonly HomeUpdateDto[];
  readonly loading: boolean;
  readonly error?: boolean;
  readonly onRetry?: () => void;
}) {
  const { org } = useOrg();
  return (
    <DashSection title="Latest updates" flush>
      {loading ? (
        <div className={cn('flex flex-col gap-3 p-4', UPDATES_BODY_MIN)} data-skeleton aria-hidden>
          {[0, 1].map((index) => (
            <Skeleton key={index} height={56} rounded="md" />
          ))}
        </div>
      ) : error ? (
        <div className={UPDATES_BODY_MIN}>
          <SectionError what="updates" onRetry={() => onRetry?.()} />
        </div>
      ) : updates.length === 0 ? (
        <EmptyNote action={{ label: 'Open your work to post one', href: routes.myWork(org.slug) }}>
          No updates yet. Comments your team posts on items will appear here.
        </EmptyNote>
      ) : (
        <ul className={cn('flex flex-col divide-y divide-border-subtle', UPDATES_BODY_MIN)}>
          {updates.map((update) => (
            <li key={update.id}>
              <Link
                href={`${routes.item(org.slug, update.boardId, update.itemId)}&update=${update.id}`}
                className="flex gap-3 px-4 py-3 transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <Avatar name={update.author?.name ?? 'Someone'} src={update.author?.image} colorKey={update.author?.id} size="md" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
                    <span className="shrink-0 font-semibold text-fg">{update.author?.name ?? 'Someone'}</span>
                    <span className="truncate text-fg-muted">
                      on <span className="font-medium text-fg-secondary">{update.itemName}</span> · {update.boardName}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-fg-muted">{formatRelativeTime(update.createdAt)}</span>
                  </span>
                  <span className="line-clamp-2 text-sm text-fg-secondary">{update.excerpt}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashSection>
  );
}
