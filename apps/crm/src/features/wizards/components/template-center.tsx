'use client';
/**
 * Template center: category rail + fuzzy search + template cards with a mock-board thumbnail,
 * and a detail view with an interactive live preview and "What's included".
 */
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft, Columns3, Eye, LayoutDashboard, Layers, ListChecks, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  SearchInput,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  cn,
} from '@/components/ui';
import type { TemplateGalleryEntry } from '@/server/services/wizards-gallery';
import { GALLERY_NAV, countLabel, entrySummary, filterGallery, navCounts, type GalleryNav } from '../model/gallery';
import { InlineError } from './primitives';
import { BoardGlyph, TemplateGlyph, ViewGlyph } from './template-icons';
import { BoardPreview } from './template-visuals';
import { TemplateThumbnail } from './template-thumbnail';

/** One-line intro under each category heading (the rail already shows the label itself). */
const NAV_BLURB: Readonly<Record<GalleryNav, string>> = {
  recommended: 'Most-used by revenue teams this month',
  all: 'Every board and solution in the KitStak library',
  crm: 'Leads, contacts, accounts and deals that link together',
  sales: 'Quotes, partners and everything around the close',
  marketing: 'Campaigns and events that feed the pipeline',
  'customer-success': 'Onboarding, renewals and support after the sale',
  projects: 'Plans, owners and timelines in one place',
  operations: 'Vendors, requests and the work that keeps things running',
  hr: 'Hiring and onboarding for growing teams',
  blank: 'Your columns, your groups, your way',
};

const ACRONYMS = new Set(['crm', 'arr', 'sla', 'ats', 'cpq', 'abm', 'it', 'hr']);

/** "crm" → "CRM", "lead score" → "Lead score". */
export function formatTag(tag: string): string {
  return tag
    .split(' ')
    .map((word, index) => (ACRONYMS.has(word) ? word.toUpperCase() : index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Horizontal scroller that fades its edges so clipped chips read as "more this way". */
export const EDGE_FADE =
  'max-md:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)] max-md:pr-7';

export interface TemplateCenterProps {
  readonly entries: readonly TemplateGalleryEntry[] | undefined;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onUse: (entry: TemplateGalleryEntry) => void;
  readonly nav: GalleryNav;
  readonly onNavChange: (nav: GalleryNav) => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** Why "Use template" is unavailable (role can't create boards), or null. */
  readonly blockedReason?: (entry: TemplateGalleryEntry) => string | null;
}

/** "Use template" that explains itself when the role can't create (tooltip on a focusable wrapper). */
function UseButton({
  reason,
  children,
  ...props
}: {
  readonly reason: string | null;
  readonly children: ReactNode;
} & Omit<ComponentProps<typeof Button>, 'children'>) {
  if (!reason) return <Button {...props}>{children}</Button>;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-focus" aria-label={`${String(children)} unavailable. ${reason}`}>
        <Button {...props} disabled aria-disabled tabIndex={-1} onClick={undefined}>
          {children}
        </Button>
      </span>
    </Tooltip>
  );
}

export function TemplateCenter(props: TemplateCenterProps) {
  const selected = props.entries?.find((entry) => entry.id === props.selectedId) ?? null;
  return selected ? (
    <TemplateDetail
      entry={selected}
      onBack={() => props.onSelect(null)}
      onUse={() => props.onUse(selected)}
      blockedReason={props.blockedReason?.(selected) ?? null}
    />
  ) : (
    <TemplateGallery {...props} />
  );
}

function CardSkeleton() {
  return (
    <div data-skeleton className="overflow-hidden rounded-xl border border-border-subtle bg-raised">
      <Skeleton className="h-[156px] w-full" rounded="sm" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton width="60%" height={16} />
        <Skeleton width="95%" height={12} />
        <Skeleton width="70%" height={12} />
      </div>
    </div>
  );
}

function TemplateGallery({
  entries,
  loading,
  error,
  onRetry,
  onSelect,
  onUse,
  nav,
  onNavChange,
  query,
  onQueryChange,
  blockedReason,
}: TemplateCenterProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => filterGallery(entries ?? [], nav, query), [entries, nav, query]);
  const counts = useMemo(() => navCounts(entries ?? []), [entries]);
  const searching = query.trim().length > 0;
  const navLabel = GALLERY_NAV.find((item) => item.id === nav)?.label ?? '';
  const heading = searching ? `Results for “${query.trim()}”` : NAV_BLURB[nav];

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="template-center">
      <header className="flex flex-col gap-3 border-b border-border-subtle pt-5 pr-14 pb-4 pl-4 sm:flex-row sm:items-center sm:pr-16 sm:pl-6">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-xl font-semibold text-fg">Template center</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-fg-secondary [text-wrap:balance]">
            Start from a proven board, or a whole connected CRM.
          </DialogPrimitive.Description>
        </div>
        <SearchInput
          ref={searchRef}
          value={query}
          onValueChange={onQueryChange}
          placeholder="Search templates, columns or use cases"
          aria-label="Search templates"
          size="lg"
          containerClassName="sm:w-[360px]"
          data-testid="template-search"
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Template categories"
          data-testid="template-categories"
          className={cn(
            'flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle bg-sunken px-3 py-2 [scrollbar-width:none] md:w-60 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:px-3 md:py-4',
            EDGE_FADE,
          )}
        >
          {GALLERY_NAV.map((item) => {
            const active = !searching && nav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  onQueryChange('');
                  onNavChange(item.id);
                }}
                className={cn(
                  'flex h-8 shrink-0 items-center justify-between gap-3 rounded-md px-3 text-left text-base whitespace-nowrap',
                  'transition-colors duration-[var(--duration-instant)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                  active ? 'bg-primary-selected font-semibold text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
                )}
              >
                <span className="flex items-center gap-2">
                  {item.id === 'recommended' ? <Sparkles aria-hidden className="size-4 text-primary" /> : null}
                  {item.label}
                </span>
                {entries ? <span className="hidden text-xs text-fg-muted tabular-nums md:inline">{counts[item.id]}</span> : null}
              </button>
            );
          })}
        </nav>
        <section aria-label={heading || 'Templates'} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold text-fg [text-wrap:balance]" aria-live="polite" data-testid="template-heading">
              <span className="sr-only">{searching ? '' : `${navLabel}: `}</span>
              {heading}
            </h3>
            {entries ? (
              <span className="shrink-0 text-sm whitespace-nowrap text-fg-muted">
                {results.length} {results.length === 1 ? 'template' : 'templates'}
              </span>
            ) : null}
          </div>
          {error ? (
            <InlineError onRetry={onRetry}>We couldn’t load templates. Check your connection.</InlineError>
          ) : loading || !entries ? (
            <div aria-busy="true" className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
              {Array.from({ length: 6 }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyState
              illustration="search"
              title="No templates match"
              description={
                <span className="flex flex-col items-center gap-3">
                  <span className="[text-wrap:balance]">Try a different word, like “pipeline” or “hiring”, or browse a category.</span>
                  <span className="flex flex-wrap justify-center gap-1.5" data-testid="template-empty-categories">
                    {(['crm', 'sales', 'projects', 'operations'] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          onQueryChange('');
                          onNavChange(id);
                        }}
                        className="inline-flex h-8 items-center rounded-full border border-border-default bg-raised px-3 text-sm font-medium text-fg transition-colors duration-[var(--duration-fast)] hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.97]"
                      >
                        {GALLERY_NAV.find((item) => item.id === id)?.label}
                      </button>
                    ))}
                  </span>
                </span>
              }
              actions={
                <>
                  <Button variant="secondary" onClick={() => onQueryChange('')}>
                    Clear search
                  </Button>
                  <Button
                    onClick={() => {
                      const blank = entries.find((entry) => entry.id === 'blank');
                      if (blank) onUse(blank);
                    }}
                  >
                    Start from scratch
                  </Button>
                </>
              }
            />
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6" data-testid="template-grid">
              {results.map((entry) => (
                <TemplateCard
                  key={entry.id}
                  entry={entry}
                  onPreview={() => onSelect(entry.id)}
                  onUse={() => onUse(entry)}
                  blockedReason={blockedReason?.(entry) ?? null}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function TemplateCard({
  entry,
  onPreview,
  onUse,
  blockedReason,
}: {
  readonly entry: TemplateGalleryEntry;
  readonly onPreview: () => void;
  readonly onUse: () => void;
  readonly blockedReason: string | null;
}) {
  const firstBoard = entry.boards[0];
  return (
    <li
      data-testid="template-card"
      data-template-id={entry.id}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-raised shadow-xs',
        'transition-[transform,box-shadow,border-color] duration-[var(--duration-normal)] ease-out',
        'hover:-translate-y-0.5 hover:border-border-default hover:shadow-md focus-within:-translate-y-0.5 focus-within:shadow-md',
      )}
    >
      <div className="relative h-[156px] border-b border-border-subtle">
        {firstBoard ? (
          <TemplateThumbnail
            board={firstBoard}
            accent={entry.accent}
            icon={<TemplateGlyph entry={entry} />}
            suite={entry.type === 'solution' ? entry.boards : undefined}
          />
        ) : null}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center gap-2 bg-gradient-to-t group-hover:[&>*]:pointer-events-auto group-focus-within:[&>*]:pointer-events-auto from-[var(--surface-raised)] via-[var(--surface-raised)]/90 to-transparent px-3 pt-6 pb-3',
            'opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 max-md:hidden',
          )}
        >
          <Button size="sm" variant="secondary" leadingIcon={<Eye aria-hidden />} onClick={onPreview} tabIndex={-1}>
            Preview
          </Button>
          <UseButton size="sm" onClick={onUse} data-testid="template-use-quick" reason={blockedReason}>
            Use template
          </UseButton>
        </div>
      </div>
      <button
        type="button"
        onClick={onPreview}
        aria-label={`${entry.name}: preview template`}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <div className="pointer-events-none flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md"
            style={{
              background: `color-mix(in srgb, var(--label-${entry.accent}) 18%, transparent)`,
              color: `var(--label-${entry.accent}-text)`,
            }}
          >
            <TemplateGlyph entry={entry} className="size-3.5" />
          </span>
          <h4 className="truncate text-md font-semibold text-fg">{entry.name}</h4>
        </div>
        <p className="line-clamp-2 text-sm text-fg-secondary">{entry.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          {entry.type === 'solution' ? (
            <Badge size="sm" tone="primary" icon={<Layers aria-hidden />}>
              {entry.boards.length} connected boards
            </Badge>
          ) : null}
          <span className="text-xs text-fg-muted">{entrySummary(entry)}</span>
          {entry.includesDashboard ? (
            <Badge size="sm" icon={<LayoutDashboard aria-hidden />}>
              Dashboard
            </Badge>
          ) : null}
          {entry.includesForm && entry.type === 'board' ? <Badge size="sm">Includes form</Badge> : null}
        </div>
      </div>
    </li>
  );
}

function TemplateDetail({
  entry,
  onBack,
  onUse,
  blockedReason,
}: {
  readonly entry: TemplateGalleryEntry;
  readonly onBack: () => void;
  readonly onUse: () => void;
  readonly blockedReason: string | null;
}) {
  const [boardIndex, setBoardIndex] = useState(0);
  const board = entry.boards[boardIndex] ?? entry.boards[0];
  const useRef_ = useRef<HTMLButtonElement>(null);
  const totalViews = entry.boards.reduce((sum, item) => sum + item.views.length, 0);

  useEffect(() => {
    useRef_.current?.focus();
  }, []);

  // Esc steps back to the grid (one level) instead of dropping the whole template center.
  // Window capture phase: runs before the dialog's own Escape handling wherever focus is
  // (even <body>), but leaves open tooltips/menus/confirms alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="listbox"],[role="menu"],[role="alertdialog"]')) return;
      event.stopPropagation();
      onBack();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="template-detail">
      <header className="flex items-center gap-3 border-b border-border-subtle py-3 pr-14 pl-4 sm:pl-6">
        <Button variant="ghost" size="sm" leadingIcon={<ArrowLeft aria-hidden />} onClick={onBack}>
          Back to templates
        </Button>
        <DialogPrimitive.Title className="sr-only">{entry.name} template</DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">{entry.description}</DialogPrimitive.Description>
      </header>
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 bg-sunken px-4 py-5 sm:px-6 lg:overflow-y-auto">
          {entry.boards.length > 1 ? (
            <Tabs value={String(boardIndex)} onValueChange={(value) => setBoardIndex(Number(value))} className="mb-4">
              <TabsList aria-label="Boards in this solution" className={cn('max-w-full overflow-x-auto [scrollbar-width:none]', EDGE_FADE)}>
                {entry.boards.map((item, index) => (
                  <TabsTrigger key={item.templateId} value={String(index)}>
                    <BoardGlyph templateId={item.templateId} className="size-4" />
                    {item.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : null}
          {board ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Views on this board">
                {board.views.map((view, index) => {
                  return (
                    <span
                      key={`${view.name}-${index}`}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm',
                        index === 0 ? 'bg-raised font-semibold text-fg shadow-xs' : 'text-fg-secondary',
                      )}
                    >
                      <ViewGlyph type={view.type} className="size-3.5" />
                      {view.name}
                    </span>
                  );
                })}
              </div>
              <BoardPreview key={board.templateId} board={board} />
              <p className="mt-3 text-sm text-fg-muted">
                Example data to show the board in use.
                {board.columns.some((column) => column.type === 'status' && column.labels?.length) ? ' Click a status to try it.' : ''}
              </p>
            </>
          ) : null}
        </div>
        <aside className="flex shrink-0 flex-col gap-5 border-border-subtle px-4 py-5 sm:px-6 lg:w-[340px] lg:overflow-y-auto lg:border-l">
          <div className="flex flex-col gap-3">
            <span
              className="inline-flex size-10 items-center justify-center rounded-lg"
              style={{
                background: `color-mix(in srgb, var(--label-${entry.accent}) 18%, transparent)`,
                color: `var(--label-${entry.accent}-text)`,
              }}
            >
              <TemplateGlyph entry={entry} className="size-5" />
            </span>
            <h3 className="text-xl font-semibold text-fg">{entry.name}</h3>
            <p className="text-base text-fg-secondary [text-wrap:pretty]">{entry.description}</p>
            {blockedReason ? (
              <div className="flex flex-col gap-1.5">
                <Tooltip content={blockedReason}>
                  <span tabIndex={0} className="flex rounded-md focus-visible:outline-2 focus-visible:outline-focus">
                    <Button size="lg" fullWidth disabled tabIndex={-1} data-testid="template-use">
                      {entry.type === 'solution' ? 'Install CRM suite' : 'Use template'}
                    </Button>
                  </span>
                </Tooltip>
                <p className="text-sm text-fg-secondary" data-testid="template-use-blocked">
                  {blockedReason}. You can still browse every template.
                </p>
              </div>
            ) : (
              <Button ref={useRef_} size="lg" fullWidth onClick={onUse} data-testid="template-use">
                {entry.type === 'solution' ? 'Install CRM suite' : 'Use template'}
              </Button>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-fg-secondary">What’s included</h4>
            <ul className="flex flex-col gap-2 text-base text-fg">
              <li className="flex items-center gap-2">
                <Layers aria-hidden className="size-4 text-icon" />
                {entry.boards.length === 1 ? '1 board' : `${entry.boards.length} connected boards`}
              </li>
              <li className="flex items-center gap-2">
                <Columns3 aria-hidden className="size-4 text-icon" />
                {countLabel(board?.columns.length ?? 0, 'column')}{entry.boards.length > 1 ? ` on ${board?.name}` : ''}
              </li>
              <li className="flex items-center gap-2">
                <ListChecks aria-hidden className="size-4 text-icon" />
                {countLabel(board?.groups.length ?? 0, 'group')} · {countLabel(totalViews, 'view')}
              </li>
              {entry.includesDashboard ? (
                <li className="flex items-center gap-2">
                  <LayoutDashboard aria-hidden className="size-4 text-icon" />
                  Sales dashboard with 9 widgets
                </li>
              ) : null}
            </ul>
          </div>
          {board ? (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-fg-secondary">Columns</h4>
              <div className="flex flex-wrap gap-1.5">
                {board.columns.map((column) => (
                  <span key={column.key} className="rounded-sm bg-muted px-2 py-0.5 text-sm text-fg">
                    {column.title}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-fg-secondary">Good for</h4>
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags" data-testid="template-tags">
              {entry.tags.slice(0, 5).map((tag) => (
                <li
                  key={tag}
                  className="inline-flex h-6 items-center rounded-full border border-border-subtle bg-sunken px-2.5 text-sm text-fg"
                >
                  {formatTag(tag)}
                </li>
              ))}
            </ul>
            <p className="text-xs text-fg-muted">Made by KitStak</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
