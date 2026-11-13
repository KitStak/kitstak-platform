'use client';
import './item-panel.css';

/**
 * <ItemPanel>: the item "card" that slides in from the right over any board view.
 *
 * Resizable (drag the left edge or use ←/→ on the handle; width remembered per browser) and
 * expandable to full page. Header: inline-editable name, board › group breadcrumb, prev/next
 * (also j / k), subscribers + invite, "…" menu. Tabs: Updates · Files · Activity log · Item
 * card. Esc closes (first Esc leaves a focused editor), focus is trapped and restored.
 *
 * Usually driven by the URL: `const panel = useItemPanelUrlState()` then
 * `<ItemPanel boardId={id} itemId={panel.itemId} open={panel.isOpen} onOpenChange={panel.onOpenChange}
 *   tab={panel.tab} onTabChange={panel.setTab} onNavigateItem={panel.setItem} focusUpdateId={panel.updateId} />`
 * or simply `<ItemPanelRoute boardId={id} />`.
 */
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Activity, ArchiveRestore, ChevronDown, ChevronUp, FileText, Maximize2, MessageSquare, Minimize2, Paperclip, X } from 'lucide-react';
import {
  Button,
  EmptyState,
  IconButton,
  Illustration,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  labelColorVars,
  toLabelColor,
  cn,
} from '@/components/ui';
import { CellServicesProvider, useBoardCellServices, type CellBoard } from '@/features/cells';
import { errorMessage, useApi, useBoard, useBoardStream, useItemDetail, useItemFiles, useItemUpdates, useMe, useOrgId } from '@/lib/hooks';
import { ApiClientError } from '@/lib/api';
import { DEFAULT_TAB, itemShareUrl, type PanelTab } from './lib/url-state';
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_KEY_STEP,
  clampPanelWidth,
  readStoredWidth,
  storeWidth,
  widthFromPointer,
} from './lib/panel-width';
import { usePanelData } from './hooks/use-panel-data';
import { useItemActions } from './hooks/use-item-actions';
import { ItemNameEditor } from './header/item-name-editor';
import { ItemMenu } from './header/item-menu';
import { CrmItemActions } from '@/features/crm/nav/crm-item-actions';
import { Subscribers } from './header/subscribers';
import { UpdatesTab as UpdatesTabView } from './updates/updates-tab';
import { FilesTab as FilesTabView } from './files/files-tab';
import { ActivityTab as ActivityTabView } from './activity/activity-tab';
import { ItemCardTab as ItemCardTabView } from './item-card/item-card-tab';
import { ProjectsTab } from './projects/projects-tab';
import { ProjectsHealthLine } from './projects/projects-health';
import { ProjectsMark } from './projects/projects-mark';
import { useItemProjects } from './projects/api';
import { useOptionalOrg } from '@/features/shell/org-context';

// Memoized: switching tabs re-renders the body, not every mounted tab.
const UpdatesTab = memo(UpdatesTabView);
const FilesTab = memo(FilesTabView);
const ActivityTab = memo(ActivityTabView);
const ItemCardTab = memo(ItemCardTabView);
import { copyToClipboard } from './updates/update-card';
import { useItemPanelUrlState } from './use-item-panel-url-state';

export interface ItemPanelProps {
  /** Board the panel is opened from (the item's own board is used once loaded). */
  readonly boardId: string;
  readonly itemId: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Controlled tab (URL state). Uncontrolled when omitted. */
  readonly tab?: PanelTab;
  readonly onTabChange?: (tab: PanelTab) => void;
  /** Switch the open item (prev/next, subitems, connected records). */
  readonly onNavigateItem?: (itemId: string) => void;
  /** Scroll to and highlight an update (shared update links). */
  readonly focusUpdateId?: string | null;
  /** Subscribe to the board's realtime stream (pass false if the host page already does). */
  readonly realtime?: boolean;
}

function isEditable(element: Element | null): boolean {
  if (!element) return false;
  const html = element as HTMLElement;
  return html.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT';
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'),
  );
}

/** Board rows: clicking one while the panel is open switches the item instead of closing. */
const ROW_SELECTOR = '[data-item-id]';
const KEEP_OPEN_SELECTOR = '[data-sonner-toaster], [data-sonner-toast], [data-testid="file-lightbox"]';
const INTERACTIVE_SELECTOR =
  'button, a[href], input, textarea, select, [role="button"], [role="checkbox"], [role="gridcell"] [tabindex], [contenteditable="true"], [data-ks-cell]';
const CRUMB =
  'rounded-xs underline-offset-2 transition-colors duration-[var(--duration-fast)] ease-out hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus';
/** Tabs: inset focus ring (never clipped by the scroller), no -1px overhang (no vertical scroll). */
const TAB_LIST =
  'w-max gap-4 border-b-0 px-2 [&>button]:mb-0 [&>button]:shrink-0 [&>button]:rounded-xs [&>button]:px-1.5 [&>button]:whitespace-nowrap [&>button]:focus-visible:outline-offset-[-2px]';
/** Visited tabs stay mounted (switching back costs nothing); inactive ones are hidden. */
const KEEP_MOUNTED = 'data-[state=inactive]:hidden';

/** Second chance to restore focus after the close navigation settles. */
const FOCUS_REASSERT_MS = 250;

interface PanelNav {
  /** Items in board order; empty when the open item is not in the list (subitem, trashed). */
  ids: readonly string[];
}

function PanelSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" data-skeleton className="flex flex-col">
      <div className="flex h-12 items-center gap-2 border-b border-border-subtle px-4">
        <Skeleton width={180} height={10} rounded="full" />
      </div>
      <div className="flex flex-col gap-4 px-6 pt-4">
        <Skeleton width="62%" height={24} rounded="md" />
        <div className="flex gap-6">
          {[64, 44, 84, 72].map((width) => (
            <Skeleton key={width} width={width} height={12} rounded="full" />
          ))}
        </div>
        <Skeleton height={44} rounded="lg" />
        <Skeleton height={120} rounded="lg" />
        <Skeleton height={96} rounded="lg" />
      </div>
    </div>
  );
}

export function ItemPanel({
  boardId,
  itemId,
  open,
  onOpenChange,
  tab: tabProp,
  onTabChange,
  onNavigateItem,
  focusUpdateId = null,
  realtime = true,
}: ItemPanelProps) {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? PANEL_DEFAULT_WIDTH : clampPanelWidth(readStoredWidth(), window.innerWidth),
  );
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const isOpen = open && itemId !== null;
  const detail = useItemDetail(isOpen ? itemId : undefined);
  const boardCache = useBoard(isOpen ? boardId : undefined);
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastItemIdRef = useRef<string | null>(itemId);
  const wasOpenRef = useRef(false);
  const navRef = useRef<PanelNav>({ ids: [] });
  // Where j / k step from: follows the prop, but moves ahead immediately on a key press so
  // fast repeats never act on a stale item while the URL / render catches up.
  const currentIdRef = useRef<string | null>(itemId);

  // Accessible name right away: the detail query, else the row from the board cache.
  const label = detail.data?.item.name ?? boardCache.data?.items.find((entry) => entry.id === itemId)?.name ?? 'Item';

  useEffect(() => {
    if (itemId) lastItemIdRef.current = itemId;
    currentIdRef.current = itemId;
  }, [itemId]);

  // Remember what opened the panel. Layout effects run before Radix's (passive) auto-focus.
  useLayoutEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const active = document.activeElement as HTMLElement | null;
      returnFocusRef.current = active && active !== document.body && !contentRef.current?.contains(active) ? active : null;
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const restoreFocus = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    // The user already moved focus somewhere outside the panel (e.g. clicked a board cell).
    if (active && active !== document.body && !contentRef.current?.contains(active)) return;
    const opener = returnFocusRef.current;
    returnFocusRef.current = null;
    const id = lastItemIdRef.current;
    const row = id ? document.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-item-id="${CSS.escape(id)}"]`) : null;
    let target: HTMLElement | null = null;
    if (opener?.isConnected && (!row || row.contains(opener))) target = opener;
    else if (row) target = row.querySelector<HTMLElement>('[data-testid="open-item"]') ?? (row.tabIndex >= 0 ? row : (tabbables(row)[0] ?? null));
    else if (opener?.isConnected) target = opener;
    if (!target) return;
    target.focus();
    // Closing also navigates (history.back / replaceState); if that re-render drops focus to
    // <body> a moment later, put it back.
    const reassert = () => {
      if (target.isConnected && (document.activeElement === document.body || document.activeElement === null)) target.focus();
    };
    requestAnimationFrame(reassert);
    window.setTimeout(reassert, FOCUS_REASSERT_MS);
  }, []);

  useEffect(() => {
    const onResize = () => setWidth((current) => clampPanelWidth(current, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging) setWidth(widthFromPointer(event.clientX, window.innerWidth));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    storeWidth(width);
  };
  const onHandleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? PANEL_KEY_STEP : event.key === 'ArrowRight' ? -PANEL_KEY_STEP : 0;
    if (event.key === 'Home') {
      event.preventDefault();
      const next = clampPanelWidth(PANEL_DEFAULT_WIDTH, window.innerWidth);
      setWidth(next);
      storeWidth(next);
    }
    if (!delta) return;
    event.preventDefault();
    const next = clampPanelWidth(width + delta, window.innerWidth);
    setWidth(next);
    storeWidth(next);
  };

  /** While focus is in the panel, Tab wraps inside it; j / k step through items. */
  const onContentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = contentRef.current;
    if (!root) return;
    if (event.key === 'Tab') {
      const list = tabbables(root);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target as Element)) return;
    if ((event.target as Element).closest('[role="menu"], [role="listbox"], [role="dialog"]:not([data-testid="item-panel"])')) return;
    if (event.key !== 'j' && event.key !== 'k') return;
    const { ids } = navRef.current;
    const index = currentIdRef.current ? ids.indexOf(currentIdRef.current) : -1;
    const target = index < 0 ? undefined : ids[event.key === 'j' ? index + 1 : index - 1];
    if (!target || !onNavigateItem) return;
    event.preventDefault();
    currentIdRef.current = target;
    onNavigateItem(target);
  };

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          aria-label={label}
          data-testid="item-panel"
          data-resizing={dragging ? 'true' : undefined}
          data-expanded={expanded ? 'true' : undefined}
          style={{ width: expanded ? '100vw' : `min(${width}px, 100vw)` }}
          onKeyDown={onContentKeyDown}
          onOpenAutoFocus={(event) => {
            // Focus the panel itself (not the resize handle): Esc / j / k work right away.
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            // A URL-driven dialog has no Trigger, so Radix cannot restore focus: do it here.
            event.preventDefault();
            restoreFocus();
          }}
          onEscapeKeyDown={(event) => {
            const active = document.activeElement;
            // Non-modal: Esc while working on the board (a cell editor, a menu) belongs to the board.
            if (active && active !== document.body && !contentRef.current?.contains(active) && isEditable(active)) {
              event.preventDefault();
              return;
            }
            if (!isEditable(active)) return;
            event.preventDefault();
            if ((active as HTMLElement).isContentEditable && !document.querySelector('[data-testid="mention-popup"]')) {
              setTimeout(() => (active as HTMLElement).blur(), 0);
            }
          }}
          onFocusOutside={(event) => {
            // Non-modal: focus may move to the board (clicking a row); only a click elsewhere closes.
            event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            const target = event.target as Element | null;
            if (target?.closest?.(KEEP_OPEN_SELECTOR)) {
              event.preventDefault();
              return;
            }
            const row = target?.closest?.<HTMLElement>(ROW_SELECTOR);
            if (!row) return;
            // Clicking another row switches the card in place instead of closing it.
            event.preventDefault();
            const rowId = row.dataset.itemId;
            if (rowId && rowId !== itemId && !target?.closest(INTERACTIVE_SELECTOR)) onNavigateItem?.(rowId);
          }}
          className="ks-item-panel @container fixed top-0 right-0 bottom-0 z-[var(--z-modal)] flex flex-col border-l border-border-subtle bg-raised text-fg shadow-modal outline-none data-[state=closed]:animate-slide-out-right data-[state=open]:animate-slide-in-right"
        >
          {!expanded ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              aria-valuemin={480}
              aria-valuemax={1200}
              aria-valuenow={Math.round(width)}
              tabIndex={0}
              data-dragging={dragging ? 'true' : undefined}
              data-print-hide
              className="ks-panel-resize hidden sm:block"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={() => {
                const next = clampPanelWidth(PANEL_DEFAULT_WIDTH, window.innerWidth);
                setWidth(next);
                storeWidth(next);
              }}
              onKeyDown={onHandleKey}
            />
          ) : null}
          {itemId ? (
            <PanelBody
              boardId={boardId}
              itemId={itemId}
              expanded={expanded}
              onToggleExpanded={() => setExpanded((value) => !value)}
              onClose={() => onOpenChange(false)}
              tab={tabProp}
              onTabChange={onTabChange}
              onNavigateItem={onNavigateItem}
              focusUpdateId={focusUpdateId}
              realtime={realtime}
              navRef={navRef}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface PanelBodyProps {
  readonly boardId: string;
  readonly itemId: string;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
  readonly onClose: () => void;
  readonly tab?: PanelTab;
  readonly onTabChange?: (tab: PanelTab) => void;
  readonly onNavigateItem?: (itemId: string) => void;
  readonly focusUpdateId: string | null;
  readonly realtime: boolean;
  readonly navRef: MutableRefObject<PanelNav>;
}

/** Delay before the tab is written to the URL (see setTab). */
const URL_SYNC_DELAY_MS = 350;

/** Own writes from another tab/device of the same user must still show up live. */
const REFRESH_OWN = ['updates.changed', 'files.changed'] as const;

/** Horizontal tab strip that scrolls on narrow panels, with edge fades and active-tab reveal. */
function TabStrip({ active, children, className }: { readonly active: string; readonly children: ReactNode; readonly className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const left = element.scrollLeft > 1;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [measure]);
  useEffect(() => {
    const strip = ref.current;
    const trigger = strip?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!strip || !trigger) return;
    // Horizontal-only reveal (scrollIntoView would also scroll ancestors vertically).
    const left = trigger.offsetLeft - 16;
    const right = trigger.offsetLeft + trigger.offsetWidth + 16 - strip.clientWidth;
    if (strip.scrollLeft > left) strip.scrollTo({ left, behavior: 'smooth' });
    else if (strip.scrollLeft < right) strip.scrollTo({ left: right, behavior: 'smooth' });
  }, [active]);
  return (
    <div className={cn('relative', className)}>
      <div ref={ref} onScroll={measure} className="ks-tab-strip overflow-x-auto overflow-y-hidden overscroll-x-contain">
        {children}
      </div>
      <span aria-hidden data-on={edges.left || undefined} className="ks-tab-fade ks-tab-fade-left" />
      <span aria-hidden data-on={edges.right || undefined} className="ks-tab-fade ks-tab-fade-right" />
    </div>
  );
}

function PanelBody({
  boardId: boardIdProp,
  itemId,
  expanded,
  onToggleExpanded,
  onClose,
  tab: tabProp,
  onTabChange,
  onNavigateItem,
  focusUpdateId,
  realtime,
  navRef,
}: PanelBodyProps) {
  const api = useApi();
  const orgId = useOrgId();
  const router = useRouter();
  const data = usePanelData(itemId, boardIdProp);
  const me = useMe();
  // The local tab is the source of truth (instant switch). The URL follows in a transition and
  // only pushes a tab back in when it changes from outside (deep link, Back).
  const [tab, setLocalTab] = useState<PanelTab>(tabProp ?? DEFAULT_TAB);
  const [visited, setVisited] = useState<ReadonlySet<PanelTab>>(() => new Set([tabProp ?? DEFAULT_TAB]));
  const [lastTabProp, setLastTabProp] = useState(tabProp);
  if (tabProp !== lastTabProp) {
    setLastTabProp(tabProp);
    if (tabProp && tabProp !== tab) setLocalTab(tabProp);
  }
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));
  // The URL write re-renders the host page (Next syncs history into useSearchParams), so it
  // trails the click: rapid tab hopping never waits on it.
  const onTabChangeRef = useRef(onTabChange);
  useEffect(() => {
    onTabChangeRef.current = onTabChange;
  }, [onTabChange]);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
  }, []);
  const setTab = (next: PanelTab) => {
    setLocalTab(next);
    setLastTabProp(next);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      urlTimer.current = null;
      startTransition(() => onTabChangeRef.current?.(next));
    }, URL_SYNC_DELAY_MS);
  };
  const updates = useItemUpdates(itemId);
  const files = useItemFiles(itemId);
  // KitStak Projects tab: only when the org has Projects (and its tables exist). Top-level records only.
  const shellOrg = useOptionalOrg();
  const projectsEntitled = shellOrg?.apps?.entitled.projects ?? false;
  const projectsEligible = projectsEntitled && data.item?.parentItemId === null;
  const projectsQuery = useItemProjects(itemId, projectsEligible);
  // Entitlement comes from the server-rendered shell, so the tab (and a ?itemTab=projects deep
  // link) renders right away with a skeleton; it only disappears if the pm schema turns out missing.
  const projectsAvailable = projectsEligible && projectsQuery.data?.available !== false;
  const projectsCount = projectsAvailable ? (projectsQuery.data?.work.projects.length ?? 0) + (projectsQuery.data?.work.openTasks ?? 0) : 0;
  const actions = useItemActions(data.boardId, data.term);
  const baseServices = useBoardCellServices(data.boardId, data.payload?.items ?? []);
  const linked = data.detail?.linkedItems;
  const services = useMemo(
    () => ({
      ...baseServices,
      linkedItems: new Map(
        (linked ?? []).map((link) => [
          link.id,
          { id: link.id, name: link.name, boardId: link.boardId, boardName: link.boardName, groupTitle: null },
        ]),
      ),
    }),
    [baseServices, linked],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileUrl = useCallback((fileId: string, download?: boolean) => api.files.url(fileId, download), [api]);

  useBoardStream({ boardId: data.boardId, currentUserId: data.me?.id, enabled: realtime, refreshOwn: REFRESH_OWN });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [itemId, tab]);

  const org = me.data?.organizations.find((entry) => entry.id === orgId);
  const canModerate = org?.role === 'owner' || org?.role === 'admin';
  const item = data.item;
  const removed = Boolean(item?.archivedAt || item?.deletedAt);
  const canEdit = data.canEdit && !removed;
  const navigate = useCallback((id: string) => onNavigateItem?.(id), [onNavigateItem]);
  const inList = data.neighbors.index > 0;

  useEffect(() => {
    navRef.current = { ids: inList ? data.orderedIds : [] };
  }, [data.orderedIds, inList, navRef]);

  const board: CellBoard = useMemo(
    () => ({ id: data.boardId, itemTerminology: data.term, columns: data.columns, groups: data.groups, canEdit }),
    [canEdit, data.boardId, data.columns, data.groups, data.term],
  );

  if (data.isLoading && !item) {
    return (
      <>
        <DialogPrimitive.Title className="sr-only">Loading</DialogPrimitive.Title>
        <PanelSkeleton />
      </>
    );
  }

  if (!item) {
    const notFound = data.error instanceof ApiClientError && (data.error.status === 404 || data.error.status === 403);
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-12 items-center justify-end border-b border-border-subtle px-3">
          <DialogPrimitive.Close asChild>
            <IconButton label="Close panel" icon={<X aria-hidden />} shortcut={['Esc']} />
          </DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Title className="sr-only">{notFound ? 'Item not found' : 'Could not load item'}</DialogPrimitive.Title>
        <EmptyState
          className="flex-1"
          visual={<Illustration name="error" size={152} />}
          title={notFound ? 'This item isn’t available' : 'Couldn’t load this item'}
          description={notFound ? 'It may have been deleted, moved to a board you can’t access, or the link is wrong.' : errorMessage(data.error)}
          actions={
            <>
              {notFound ? null : (
                <Button variant="primary" onClick={data.refetch}>
                  Try again
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const groupColor = labelColorVars(toLabelColor(data.group?.color, 'blue'));
  const updateCount = (updates.data?.length ?? item.updateCount) || 0;
  const fileCount = files.data?.length ?? 0;
  const boardName = data.payload?.board.name ?? data.detail?.board.name ?? 'Board';
  const boardHref = org ? `/${org.slug}/boards/${data.boardId}` : null;
  const inner = expanded ? 'mx-auto w-full max-w-[880px]' : '';

  const jumpToGroup = () => {
    const header = document.querySelector<HTMLElement>(`[data-kind="group-header"][data-group-id="${CSS.escape(item.groupId)}"]`);
    if (header) header.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else if (boardHref) router.push(boardHref);
  };

  return (
    <CellServicesProvider value={services}>
      <div className="flex min-h-0 flex-1 flex-col">
        <DialogPrimitive.Title className="sr-only">{item.name}</DialogPrimitive.Title>
        <header className="flex flex-col border-b border-border-subtle">
          <div className={cn('flex h-12 items-center gap-1.5 pr-2 pl-4', inner)} data-print-hide>
            <nav aria-label="Breadcrumb" className="min-w-[112px] flex-1 @min-[480px]:min-w-[140px]">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm text-fg-secondary">
                <li className="flex min-w-[3ch] shrink-[3] items-center">
                  {boardHref ? (
                    <Link href={boardHref} className={cn(CRUMB, 'truncate')} data-testid="item-panel-crumb-board">
                      {boardName}
                    </Link>
                  ) : (
                    <span className="truncate">{boardName}</span>
                  )}
                </li>
                <li aria-hidden className="shrink-0 text-fg-muted">
                  ›
                </li>
                <li className="flex min-w-[6ch] shrink items-center gap-1.5">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: groupColor.bg }} />
                  <button
                    type="button"
                    onClick={jumpToGroup}
                    className={cn(CRUMB, 'min-w-0 truncate font-medium')}
                    style={{ color: groupColor.text }}
                    aria-label={`Go to group ${data.group?.title ?? ''}`}
                    data-testid="item-panel-crumb-group"
                  >
                    {data.group?.title ?? 'Group'}
                  </button>
                </li>
              </ol>
            </nav>
            {inList && onNavigateItem ? (
              <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={`${data.term} ${data.neighbors.index} of ${data.neighbors.total}`}>
                <IconButton
                  size="sm"
                  label={`Previous ${data.term.toLowerCase()}`}
                  shortcut={['K']}
                  icon={<ChevronUp aria-hidden />}
                  disabled={!data.neighbors.prevId}
                  onClick={() => data.neighbors.prevId && navigate(data.neighbors.prevId)}
                  data-testid="item-panel-prev"
                />
                <span className="hidden min-w-12 text-center text-xs text-fg-muted tabular-nums @min-[600px]:inline" aria-hidden>
                  {data.neighbors.index} / {data.neighbors.total}
                </span>
                <IconButton
                  size="sm"
                  label={`Next ${data.term.toLowerCase()}`}
                  shortcut={['J']}
                  icon={<ChevronDown aria-hidden />}
                  disabled={!data.neighbors.nextId}
                  onClick={() => data.neighbors.nextId && navigate(data.neighbors.nextId)}
                  data-testid="item-panel-next"
                />
              </div>
            ) : null}
            <span aria-hidden className="mx-0.5 hidden h-5 w-px shrink-0 bg-border-subtle @min-[600px]:block" />
            <Subscribers itemId={item.id} users={data.users} me={data.me} canEdit={canEdit} term={data.term} />
            <span className="flex shrink-0 items-center">
              <CrmItemActions
                itemId={item.id}
                itemName={item.name}
                boardKind={data.payload?.board.kind ?? data.detail?.board.kind}
                canEdit={canEdit}
                isSubitem={item.parentItemId !== null}
              />
            </span>
            <span className="flex shrink-0 items-center">
              <ItemMenu
                item={item}
                term={data.term}
                groups={data.groups}
                canEdit={canEdit}
                expanded={expanded}
                onToggleExpanded={onToggleExpanded}
                onCopyLink={() => copyToClipboard(itemShareUrl(window.location, item.id), 'Link copied')}
                onOpenInNewTab={() => window.open(itemShareUrl(window.location, item.id, { tab }), '_blank', 'noopener')}
                onPrint={() => window.print()}
                onDuplicate={() => actions.duplicate(item, navigate)}
                onMoveToGroup={(group) => actions.moveToGroup(item, group.id, group.title)}
                onMoveToBoard={(targetId, name) => actions.moveToBoard(item, targetId, name, onClose)}
                onArchive={() => {
                  actions.archive(item);
                  onClose();
                }}
                onDelete={() => {
                  actions.remove(item);
                  onClose();
                }}
              />
            </span>
            <IconButton
              className="hidden shrink-0 @min-[600px]:inline-flex"
              label={expanded ? 'Collapse to side panel' : 'Expand to full page'}
              icon={expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
              onClick={onToggleExpanded}
              data-testid="item-panel-expand"
            />
            <DialogPrimitive.Close asChild>
              <IconButton className="shrink-0" label="Close panel" icon={<X aria-hidden />} shortcut={['Esc']} data-testid="item-panel-close" />
            </DialogPrimitive.Close>
          </div>
          <div className={cn('px-2 pt-1 pb-2', inner)}>
            <ItemNameEditor name={item.name} term={data.term} readOnly={!canEdit} onRename={(name) => actions.rename(item, name)} />
            {projectsAvailable && projectsQuery.data?.available ? (
              <div className="px-2 pt-1">
                <ProjectsHealthLine
                  projects={projectsQuery.data.work.projects}
                  openTasks={projectsQuery.data.work.openTasks}
                  onOpen={() => setTab('projects')}
                />
              </div>
            ) : null}
          </div>
          {removed ? (
            <div className={cn('px-4 pb-2', inner)}>
              <div role="status" className="flex items-center gap-3 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-sm text-warning-text">
                <ArchiveRestore aria-hidden className="size-4 shrink-0" />
                <span className="flex-1">
                  This {data.term.toLowerCase()} is {item.deletedAt ? 'in the trash' : 'archived'}. Restore it to make changes.
                </span>
                <Button size="xs" variant="secondary" loading={actions.restoring} onClick={() => actions.restore(item)}>
                  Restore
                </Button>
              </div>
            </div>
          ) : null}
        </header>
        <Tabs value={tab} onValueChange={(value) => setTab(value as PanelTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border-subtle" data-print-hide>
            <TabStrip active={tab} className={cn('px-2', inner)}>
              <TabsList aria-label={`${data.term} sections`} className={TAB_LIST}>
                <TabsTrigger value="updates" icon={<MessageSquare aria-hidden />} count={updateCount} data-testid="tab-updates">
                  Updates
                </TabsTrigger>
                <TabsTrigger value="files" icon={<Paperclip aria-hidden />} count={fileCount || undefined} data-testid="tab-files">
                  Files
                </TabsTrigger>
                <TabsTrigger value="activity" icon={<Activity aria-hidden />} data-testid="tab-activity">
                  Activity log
                </TabsTrigger>
                <TabsTrigger value="card" icon={<FileText aria-hidden />} data-testid="tab-card">
                  {data.term} card
                </TabsTrigger>
                {projectsAvailable ? (
                  <TabsTrigger value="projects" icon={<ProjectsMark size={14} />} count={projectsCount || undefined} data-testid="tab-projects">
                    Projects
                  </TabsTrigger>
                ) : null}
              </TabsList>
            </TabStrip>
          </div>
          <div ref={scrollRef} data-panel-scroll className="min-h-0 flex-1 overflow-y-auto bg-sunken">
            <div className={cn('px-4 py-5', expanded ? inner : 'sm:px-6')}>
              {visited.has('updates') ? (
                <TabsContent value="updates" forceMount className={KEEP_MOUNTED}>
                  <UpdatesTab
                    itemId={item.id}
                    boardId={data.boardId}
                    term={data.term}
                    me={data.me}
                    users={data.users}
                    usersById={data.usersById}
                    canWrite={canEdit}
                    canModerate={canModerate}
                    focusUpdateId={focusUpdateId}
                    fileUrl={fileUrl}
                    expectedCount={item.updateCount}
                  />
                </TabsContent>
              ) : null}
              {visited.has('files') ? (
                <TabsContent value="files" forceMount className={KEEP_MOUNTED}>
                  <FilesTab itemId={item.id} boardId={data.boardId} term={data.term} canWrite={canEdit} columns={data.columns} usersById={data.usersById} />
                </TabsContent>
              ) : null}
              {visited.has('activity') ? (
                <TabsContent value="activity" forceMount className={KEEP_MOUNTED}>
                  <ActivityTab item={item} columns={data.columns} board={board} users={data.users} term={data.term} />
                </TabsContent>
              ) : null}
              {visited.has('card') ? (
                <TabsContent value="card" forceMount className={KEEP_MOUNTED}>
                  <ItemCardTab
                    item={item}
                    detail={data.detail}
                    columns={data.columns}
                    board={board}
                    users={data.users}
                    term={data.term}
                    canEdit={canEdit}
                    onOpenItem={navigate}
                  />
                </TabsContent>
              ) : null}
              {visited.has('projects') && projectsAvailable ? (
                <TabsContent value="projects" forceMount className={KEEP_MOUNTED}>
                  <ProjectsTab itemId={item.id} recordName={item.name} term={data.term} canEdit={canEdit} />
                </TabsContent>
              ) : null}
            </div>
          </div>
        </Tabs>
      </div>
    </CellServicesProvider>
  );
}

/** URL-driven panel: reads/writes `?item=` and `?itemTab=` and handles prev/next. */
export function ItemPanelRoute({ boardId, realtime }: { readonly boardId: string; readonly realtime?: boolean }) {
  const panel = useItemPanelUrlState();
  return (
    <ItemPanel
      boardId={boardId}
      itemId={panel.itemId}
      open={panel.isOpen}
      onOpenChange={panel.onOpenChange}
      tab={panel.tab}
      onTabChange={panel.setTab}
      onNavigateItem={panel.setItem}
      focusUpdateId={panel.updateId}
      realtime={realtime}
    />
  );
}
