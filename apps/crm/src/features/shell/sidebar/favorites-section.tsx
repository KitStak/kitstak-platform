'use client';
import { usePathname } from 'next/navigation';
import { ChevronRight, Star, StarOff } from 'lucide-react';
import { SkeletonRows, Tooltip, cn, toast } from '@/components/ui';
import { useFavorites, useToggleFavorite } from '../api';
import { EntityIcon } from '../entity-icon';
import { useOrg } from '../org-context';
import { entityHref, routes } from '../routes';
import { FolderGlyph } from '../folder-icon';
import type { FavoriteDto } from '../api';
import { useShellStore } from '../store';
import { NavRow } from './nav-row';

/** Link for a favorite: boards / dashboards open directly; folders open their workspace filtered to them. */
export function favoriteHref(orgSlug: string, favorite: FavoriteDto): string | null {
  if (favorite.entityType === 'folder') {
    return favorite.workspaceId ? `${routes.workspace(orgSlug, favorite.workspaceId)}?folder=${favorite.entityId}` : null;
  }
  return entityHref(orgSlug, favorite.entityType, favorite.entityId);
}

/**
 * Collapsible list of starred boards, dashboards and folders (crosses workspaces).
 * `collapsible={false}` renders just the list, always open, for the top bar's Favorites menu.
 */
export function FavoritesSection({ collapsible = true }: { readonly collapsible?: boolean } = {}) {
  const { org } = useOrg();
  const pathname = usePathname() ?? '';
  const favorites = useFavorites(org.id);
  const toggleFavorite = useToggleFavorite(org.id);
  const storedOpen = useShellStore((state) => state.favoritesOpen);
  const open = collapsible ? storedOpen : true;
  const setOpen = useShellStore((state) => state.setFavoritesOpen);
  const items = (favorites.data ?? []).filter((favorite) => favoriteHref(org.slug, favorite));

  return (
    <section aria-label="Favorites" className="flex flex-col gap-px">
      {collapsible ? (
      <button
        type="button"
        id="sidebar-favorites"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 transition-transform duration-[var(--duration-fast)]', open && 'rotate-90')}
        />
        <Star aria-hidden className="size-3.5" />
        <span className="flex-1 text-left">Favorites</span>
        {items.length > 0 ? <span className="text-xs text-fg-muted tabular-nums">{items.length}</span> : null}
      </button>
      ) : null}
      {open ? (
        favorites.isPending ? (
          <SkeletonRows rows={2} className="px-1" />
        ) : favorites.isError ? (
          <button
            type="button"
            onClick={() => void favorites.refetch()}
            className="mx-2 rounded-sm px-2 py-1.5 text-left text-sm text-danger-text hover:bg-danger-subtle"
          >
            Couldn&apos;t load favorites. Retry
          </button>
        ) : items.length === 0 ? (
          <div className="mx-2 mb-1 flex items-start gap-2 rounded-md border border-dashed border-border-default px-3 py-2.5 text-sm text-fg-muted">
            <Star aria-hidden className="mt-0.5 size-3.5 shrink-0 text-icon" />
            <span>Star boards, dashboards and folders to pin them here.</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-px">
            {items.map((favorite) => {
              const href = favoriteHref(org.slug, favorite) ?? '#';
              return (
                <li key={favorite.id}>
                  <NavRow
                    href={href}
                    active={pathname === href || pathname.startsWith(`${href}/`)}
                    title={favorite.name}
                    icon={
                      favorite.entityType === 'dashboard' ? (
                        <EntityIcon type="dashboard" />
                      ) : favorite.entityType === 'folder' ? (
                        <FolderGlyph folderId={favorite.entityId} color={null} />
                      ) : (
                        <EntityIcon type="board" boardKind={favorite.boardKind} />
                      )
                    }
                    label={favorite.name}
                    actions={
                      <Tooltip content="Remove from favorites" side="right">
                        <button
                          type="button"
                          aria-label={`Remove ${favorite.name} from favorites`}
                          onClick={() =>
                            toggleFavorite.mutate(
                              {
                                entityType: favorite.entityType,
                                entityId: favorite.entityId,
                                favoriteId: favorite.id,
                                name: favorite.name,
                              },
                              { onError: () => toast.error("Couldn't remove from favorites") },
                            )
                          }
                          className="inline-flex size-6 items-center justify-center rounded-xs text-icon hover:bg-pressed hover:text-icon-strong focus-visible:outline-2 focus-visible:outline-focus"
                        >
                          <StarOff aria-hidden className="size-3.5" />
                        </button>
                      </Tooltip>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
