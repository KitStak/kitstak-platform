'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ArrowRight, Clock, CornerDownLeft, FileText, Search, X } from 'lucide-react';
import type { NavItem, NavMenu } from '@/config/nav-config';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '@/lib/api-client';
import type { ApiQueryData } from '@/lib/query-client';
import { useShortcut } from '@/lib/keyboard';
import { overlayClass } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { StatusPill } from '@/components/ui/status-pill';
import type { StatusDomain } from '@/lib/status-colors';
import { suppressNextTooltipFocus, Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  flattenPages,
  highlightParts,
  matchPages,
  MIN_RECORD_QUERY,
  orderSearchSections,
  pageRank,
  pushRecentSearch,
  readRecentSearches,
  RECORD_SEARCH_TIMEOUT_MS,
  seeAllLabel,
  withTimeout,
  writeRecentSearches,
} from './search-utils';
import { startRouteProgress } from './route-progress';

interface SearchHit {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly status?: { readonly label: string; readonly domain: StatusDomain };
  readonly href: string;
  readonly rank?: number;
}

interface SearchGroup {
  readonly key: string;
  readonly label: string;
  readonly singular?: string;
  readonly hits: readonly SearchHit[];
  readonly total?: number;
  readonly bestRank?: number;
  readonly seeAllHref?: string;
}

const RECORD_TYPES = 'orders,pos,products,locations,lps,jobs,clients,users,roles';
const DEBOUNCE_MS = 200;

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function Highlighted({ text, query }: { readonly text: string; readonly query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.match ? (
          <strong key={i} className="font-bold text-foreground">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

const itemClass =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-body data-[selected=true]:bg-primary-soft data-[selected=true]:text-primary';
const groupClass =
  'px-1.5 py-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]: [&_[cmdk-group-heading]]:text-faint';

const SKELETON_ROWS = 3;

/** Three 32px placeholder rows while record groups load (no spinner, no empty panel). */
function RecordsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="px-1.5 py-1">
      <p className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-xs text-secondary">
        <span
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
          aria-hidden
        />
        Searching records…
      </p>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="flex h-8 items-center gap-2.5 px-2.5">
          <span className="ks-skeleton h-3 w-24" />
          <span className="ks-skeleton h-2.5 flex-1" style={{ maxWidth: `${50 - i * 10}%` }} />
          <span className="ks-skeleton ml-auto h-2.5 w-10" />
        </div>
      ))}
    </div>
  );
}

/** Where Enter goes once results arrive: the first record hit, else the first page. PURE. */
function enterTarget(
  sections: readonly ('pages' | SearchGroup)[],
  pageHits: readonly { readonly href: string }[],
): string | null {
  for (const section of sections) {
    if (section === 'pages') {
      if (pageHits[0]) return pageHits[0].href;
      continue;
    }
    const hit = section.hits[0];
    if (hit) return hit.href;
  }
  return null;
}

function TypeLabel({ children }: { readonly children: React.ReactNode }) {
  return <span className="ml-auto shrink-0 text-2xs text-faint">{children}</span>;
}

/**
 * Global search (`/` or Ctrl+K): Pages (Logiwa parity, bold match) + scoped Records groups
 * from `GET /api/search`. Keyboard navigable; recent searches persist per browser.
 */
const searchTriggerClass =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-sunken text-xs text-fg-secondary outline-none transition-colors ' +
  'hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus min-[1440px]:w-44 min-[1440px]:px-3';

export function GlobalSearch({
  menus,
  extraPages,
}: {
  readonly menus: readonly NavMenu[];
  readonly extraPages: readonly NavItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [recent, setRecent] = React.useState<readonly string[]>([]);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const pages = React.useMemo(() => flattenPages(menus, extraPages), [menus, extraPages]);
  const pageHits = React.useMemo(() => matchPages(pages, query), [pages, query]);
  const recordsEnabled = open && debounced.length >= MIN_RECORD_QUERY;
  const recordQuery = { q: debounced, types: RECORD_TYPES, limit: 5 };
  const records = useQuery<ApiQueryData<readonly SearchGroup[]>, ApiError>({
    queryKey: ['search', recordQuery],
    queryFn: ({ signal }) =>
      apiRequest<readonly SearchGroup[]>('/api/search', {
        query: recordQuery,
        signal: withTimeout(signal, RECORD_SEARCH_TIMEOUT_MS),
      }),
    enabled: recordsEnabled,
    staleTime: 30_000,
    // A slow or failed search shows an explicit Retry; silent retries would keep the skeleton up.
    retry: false,
  });

  const openSearch = React.useCallback(() => {
    setRecent(readRecentSearches());
    setOpen(true);
  }, []);
  useShortcut('/', openSearch, { description: 'Open global search', group: 'Navigation' });
  useShortcut('mod+k', openSearch, {
    description: 'Open global search',
    group: 'Navigation',
    allowInInputs: true,
  });

  const go = (href: string): void => {
    const next = pushRecentSearch(recent, query);
    writeRecentSearches(next);
    setRecent(next);
    setOpen(false);
    setQuery('');
    startRouteProgress(href);
    router.push(href);
  };

  const groups = records.data?.data ?? [];
  const searching = recordsEnabled && (records.isFetching || debounced !== query.trim());
  const showSkeleton = searching && groups.length === 0;
  const nothing = query.trim().length > 0 && pageHits.length === 0 && groups.length === 0 && !searching;
  const sections = orderSearchSections(pageHits.length > 0 ? pageRank(pageHits, query) : null, groups);

  // Enter pressed while records are still loading (nothing to select yet): remember it and open
  // the best result as soon as it arrives instead of silently ignoring the key.
  const [pendingEnter, setPendingEnter] = React.useState(false);
  React.useEffect(() => {
    setPendingEnter(false);
  }, [query]);
  React.useEffect(() => {
    if (!pendingEnter || searching) return;
    setPendingEnter(false);
    const target = enterTarget(sections, pageHits);
    if (target) go(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the pending search settles
  }, [pendingEnter, searching]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (searching && pageHits.length === 0 && groups.length === 0) {
      e.preventDefault();
      setPendingEnter(true);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? openSearch() : setOpen(false))}>
      <Tooltip
        content={
          <span className="flex items-center gap-1.5">
            Search pages and records <Kbd>/</Kbd>
          </span>
        }
        side="bottom"
      >
        <DialogPrimitive.Trigger asChild>
          {/* Below 1440px a 32px icon button keeps the header inside 1280px; the "/" hint moves to the tooltip.
              Content sits in one wrapper span so page-level `button:has(> kbd)` overrides cannot resize it. */}
          <button
            ref={triggerRef}
            type="button"
            aria-label="Search pages and records"
            aria-keyshortcuts="/"
            className={searchTriggerClass}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="hidden min-w-0 flex-1 whitespace-nowrap text-left min-[1440px]:inline">
                Search…
              </span>
              <kbd className="hidden shrink-0 rounded border border-border-subtle bg-panel px-1.5 py-px text-2xs font-semibold text-fg-secondary min-[1440px]:inline">
                /
              </kbd>
            </span>
          </button>
        </DialogPrimitive.Trigger>
      </Tooltip>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={() => suppressNextTooltipFocus(triggerRef.current)}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Global search</DialogPrimitive.Title>
          <Command shouldFilter={false} loop label="Global search" onKeyDown={onKeyDown}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search pages, orders, POs, SKUs, LPs, locations, users…"
                className="h-12 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-faint"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="rounded p-1 text-faint hover:bg-neutral-soft hover:text-secondary"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <Command.List className="max-h-[min(60vh,480px)] overflow-y-auto py-1">
              {nothing ? (
                <div role="status" className="px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">
                    No results for &ldquo;{query.trim()}&rdquo;
                  </p>
                  <p className="mt-1 text-xs text-faint">
                    Try a full code (SO010916, PO002210), a SKU, an LP, a location, a user&apos;s email or a
                    page name.
                  </p>
                </div>
              ) : null}
              {records.isError && recordsEnabled && !records.isFetching ? (
                <p role="alert" className="flex items-center gap-2 px-4 py-2 text-xs text-danger">
                  Record search is unavailable right now.
                  <button
                    type="button"
                    onClick={() => void records.refetch()}
                    className="rounded font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
                  >
                    Retry
                  </button>
                </p>
              ) : null}
              {!query.trim() && recent.length > 0 ? (
                <Command.Group heading="Recent searches" className={groupClass}>
                  {recent.map((term) => (
                    <Command.Item
                      key={term}
                      value={`recent:${term}`}
                      onSelect={() => setQuery(term)}
                      className={itemClass}
                    >
                      <Clock className="h-3.5 w-3.5 text-faint" aria-hidden />
                      {term}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {!query.trim() && recent.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-faint">
                  Type a page name, order code, PO, SKU, barcode, LP or location.
                </p>
              ) : null}
              {sections.map((section) =>
                section === 'pages' ? (
                  <Command.Group key="pages" heading="Pages" className={groupClass}>
                    {pageHits.map((hit) => (
                      <Command.Item
                        key={hit.href}
                        value={`page:${hit.href}`}
                        onSelect={() => go(hit.href)}
                        className={itemClass}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                        <span className="min-w-0 truncate">
                          <Highlighted text={hit.label} query={query} />
                        </span>
                        <TypeLabel>Page</TypeLabel>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : (
                  <Command.Group key={section.key} heading={section.label} className={groupClass}>
                    {section.hits.map((hit) => (
                      <Command.Item
                        key={`${section.key}:${hit.id}`}
                        value={`${section.key}:${hit.id}`}
                        onSelect={() => go(hit.href)}
                        className={itemClass}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            <Highlighted text={hit.title} query={debounced} />
                          </span>
                          {hit.subtitle || hit.status ? (
                            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-faint">
                              {hit.status ? (
                                <StatusPill
                                  status={hit.status.label}
                                  domain={hit.status.domain}
                                  size="sm"
                                  className="shrink-0 text-2xs"
                                />
                              ) : null}
                              {hit.subtitle ? (
                                <span className="min-w-0 truncate">
                                  <Highlighted text={hit.subtitle} query={debounced} />
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                        <TypeLabel>{section.singular ?? section.label}</TypeLabel>
                      </Command.Item>
                    ))}
                    {section.seeAllHref ? (
                      <Command.Item
                        value={`seeall:${section.key}`}
                        onSelect={() => go(section.seeAllHref ?? '/')}
                        className={cn(itemClass, 'text-xs font-semibold text-primary')}
                      >
                        {seeAllLabel(section.total ?? section.hits.length, section.label)}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Command.Item>
                    ) : null}
                  </Command.Group>
                ),
              )}
              {showSkeleton ? <RecordsSkeleton /> : null}
            </Command.List>
            <div
              className={cn(
                'flex items-center gap-3 border-t border-border bg-surface-sunken px-3 py-2 text-2xs text-faint',
              )}
            >
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>
                  <CornerDownLeft className="h-2.5 w-2.5" aria-hidden />
                </Kbd>{' '}
                open
              </span>
              <span className="flex items-center gap-1">
                <Kbd>Esc</Kbd> close
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
