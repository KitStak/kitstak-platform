'use client';
/**
 * Item panel harness for critics: signs in via the normal session, picks the org's Deals
 * board and opens the panel on its first item (deep-linkable via `?item=`). The list on the
 * left stands in for the board table; the board-toolbar module mounts the same panel there.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { MessageSquare, Maximize2 } from 'lucide-react';
import { Button, EmptyState, Skeleton, labelColorVars, toLabelColor } from '@/components/ui';
import { ItemPanelRoute, useItemPanelUrlState } from '@/features/item-panel';
import { OrgProvider, useBoard, useBoards, useMe } from '@/lib/hooks';
import { OrgProvider as ShellOrgProvider } from '@/features/shell/org-context';
import { permissionsFor } from '@/server/rbac/permissions';
import type { GroupDto, ItemDto } from '@/server/services/contracts/dto';

type OpenItem = (itemId: string, tab?: 'updates') => void;

/** Memoized rows: URL changes (tab switches) re-render the panel, not 40 list rows. */
const DealRows = memo(function DealRows({
  items,
  groups,
  onOpen,
}: {
  readonly items: readonly ItemDto[];
  readonly groups: ReadonlyMap<string, GroupDto>;
  readonly onOpen: OpenItem;
}) {
  return (
    <ul className="overflow-hidden rounded-lg border border-border-subtle bg-panel" data-testid="dev-item-list">
      {items.slice(0, 40).map((item) => {
        const group = groups.get(item.groupId);
        return (
          <li key={item.id} role="row" data-item-id={item.id} className="group flex h-9 items-center gap-3 border-b border-border-subtle pr-2 last:border-b-0 hover:bg-hover">
            <span aria-hidden className="h-full w-1.5 shrink-0" style={{ background: labelColorVars(toLabelColor(group?.color, 'blue')).bg }} />
            <span className="min-w-0 flex-1 truncate text-base" data-testid="dev-item-name">{item.name}</span>
            <span className="hidden w-28 truncate text-xs text-fg-muted sm:block">{group?.title}</span>
            <Button size="xs" variant="ghost" leadingIcon={<MessageSquare aria-hidden />} aria-label={`Open updates for ${item.name}`} onClick={() => onOpen(item.id, 'updates')}>
              {item.updateCount || ''}
            </Button>
            <Button size="xs" variant="secondary" leadingIcon={<Maximize2 aria-hidden />} onClick={() => onOpen(item.id)} data-testid="open-item">
              Open
            </Button>
          </li>
        );
      })}
    </ul>
  );
});

function DealsList() {
  const boards = useBoards({ kind: 'deals' });
  const boardId = boards.data?.[0]?.id;
  const payload = useBoard(boardId);
  const panel = useItemPanelUrlState();
  const allItems = payload.data?.items;
  const items = useMemo(() => (allItems ?? []).filter((item) => !item.parentItemId), [allItems]);
  const groupList = payload.data?.groups;
  const groups = useMemo(() => new Map((groupList ?? []).map((group) => [group.id, group])), [groupList]);
  const openRef = useRef(panel.open);
  useEffect(() => {
    openRef.current = panel.open;
  }, [panel.open]);
  const onOpen = useCallback<OpenItem>((itemId, tab) => openRef.current(itemId, tab), []);
  const firstId = items[0]?.id;

  useEffect(() => {
    if (firstId && !panel.itemId && !window.location.search.includes('closed=1')) panel.setItem(firstId);
    // Open once on first load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId]);

  if (boards.isLoading || payload.isLoading) {
    return (
      <div aria-busy="true" data-skeleton className="flex flex-col gap-2 p-6">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} height={36} />
        ))}
      </div>
    );
  }
  if (!boardId || !payload.data) {
    return <EmptyState illustration="board" title="No Deals board" description="Seed the demo workspace to review the item panel." />;
  }
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-4 p-4 sm:p-8 xl:ml-[max(0px,calc(50vw-700px))]">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-fg-muted ">Dev harness</p>
        <h1 className="text-xl font-semibold">{payload.data.board.name} · item panel</h1>
        <p className="text-sm text-fg-secondary">Open any {payload.data.board.itemTerminology.toLowerCase()} to review the panel. The URL keeps the open item and tab.</p>
      </header>
      <DealRows items={items} groups={groups} onOpen={onOpen} />
      <ItemPanelRoute boardId={boardId} />
    </div>
  );
}

export function ItemPanelDevHarness() {
  const me = useMe();
  if (me.isLoading) return <div aria-busy="true" data-skeleton className="p-8"><Skeleton height={36} /></div>;
  const org = me.data?.organizations[0];
  if (!org) {
    return (
      <EmptyState
        illustration="workspace"
        title="Sign in to review the item panel"
        description="This harness uses the seeded demo organization."
        actions={
          <Link href="/login?next=/dev/item-panel" className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            Sign in
          </Link>
        }
      />
    );
  }
  return (
    <main className="min-h-screen bg-app">
      {/* Shell context too: panel add-ons (CRM actions) read the org slug / permissions from it. */}
      <ShellOrgProvider
        value={{
          org: { id: org.id, slug: org.slug, name: org.name, logo: org.logo },
          user: { id: me.data?.user.id ?? '', name: me.data?.user.name ?? '', email: me.data?.user.email ?? '', image: me.data?.user.image ?? null },
          role: org.role,
          permissions: permissionsFor([org.role]),
        }}
      >
        <OrgProvider orgId={org.id}>
          <DealsList />
        </OrgProvider>
      </ShellOrgProvider>
    </main>
  );
}
