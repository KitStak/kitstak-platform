'use client';

/** Dashboards index: searchable cards with a live layout thumbnail, favorites and quick actions. */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, ExternalLink, LayoutDashboard, Lock, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react';
import {
  Avatar,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  SearchInput,
  Skeleton,
  ToggleGroup,
  cn,
  toast,
} from '@/components/ui';
import { useDashboards, useFavorites, useToggleFavorite, useWorkspaces } from '@/lib/hooks';
import { useOrg } from '@/features/shell/org-context';
import type { DashboardDto } from '@/server/services/contracts/dto';
import { CreateDashboardDialog } from './components/create-dashboard-dialog';
import { LayoutThumbnail } from './components/layout-thumbnail';
import { useDashboardSources, useDeleteDashboard, useDuplicateDashboard } from './hooks';
import './dashboards.css';

/** "2h ago" style age of a timestamp (coarse; refreshed whenever the list re-renders). */
export function updatedAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function DashboardsList() {
  const { org, permissions } = useOrg();
  const router = useRouter();
  const dashboards = useDashboards();
  const workspaces = useWorkspaces();
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const duplicate = useDuplicateDashboard();
  const remove = useDeleteDashboard();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'favorites'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<DashboardDto | null>(null);
  const canEdit = permissions.includes('dashboard:write');
  const sources = useDashboardSources();
  const people = useMemo(() => new Map((sources.data?.users ?? []).map((person) => [person.id, person])), [sources.data?.users]);
  const favoriteIds = useMemo(
    () => new Set((favorites.data ?? []).filter((entry) => entry.entityType === 'dashboard').map((entry) => entry.entityId)),
    [favorites.data],
  );
  const list = (dashboards.data ?? []).filter((dashboard) => {
    if (scope === 'favorites' && !favoriteIds.has(dashboard.id)) return false;
    const q = query.trim().toLowerCase();
    return !q || `${dashboard.name} ${dashboard.description ?? ''}`.toLowerCase().includes(q);
  });
  const workspaceName = (id: string | null) => workspaces.data?.find((workspace) => workspace.id === id)?.name ?? 'No workspace';

  return (
    <div className="h-full overflow-y-auto" data-testid="dashboards-list">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-primary-subtle text-primary-text [&_svg]:size-5">
            <LayoutDashboard />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg">Dashboards</h1>
            <p className="text-base text-fg-secondary">Live KPIs, forecasts and team views across your boards.</p>
          </div>
          {canEdit ? (
            <Button leadingIcon={<Plus />} onClick={() => setCreateOpen(true)} data-testid="new-dashboard">
              New dashboard
            </Button>
          ) : null}
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={query} onValueChange={setQuery} placeholder="Search dashboards" aria-label="Search dashboards" containerClassName="w-full sm:w-72" />
          <ToggleGroup
            label="Show"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: 'all', label: 'All' },
              { value: 'favorites', label: 'Favorites', icon: <Star /> },
            ]}
          />
          <span className="ml-auto text-sm text-fg-muted tabular-nums">{dashboards.data ? `${list.length} of ${dashboards.data.length}` : ''}</span>
        </div>
        {dashboards.isPending ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-skeleton aria-busy="true">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-panel p-4">
                <Skeleton height={120} rounded="md" />
                <Skeleton width="60%" height={18} />
                <Skeleton width="40%" height={14} />
              </li>
            ))}
          </ul>
        ) : dashboards.isError ? (
          <EmptyState illustration="error" title="Couldn't load dashboards" actions={<Button variant="secondary" onClick={() => void dashboards.refetch()}>Try again</Button>} />
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default bg-panel">
            <EmptyState
              illustration={query || scope === 'favorites' ? 'search' : 'board'}
              title={query ? `No dashboards match “${query}”` : scope === 'favorites' ? 'No favorite dashboards yet' : 'Build your first dashboard'}
              description={query || scope === 'favorites' ? 'Try another search or show all dashboards.' : 'Combine numbers from Deals, Leads and Activities into one live view.'}
              actions={
                query || scope === 'favorites' ? (
                  <Button variant="secondary" onClick={() => { setQuery(''); setScope('all'); }}>Show all</Button>
                ) : canEdit ? (
                  <Button leadingIcon={<Plus />} onClick={() => setCreateOpen(true)}>New dashboard</Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((dashboard) => {
              const favorite = favoriteIds.has(dashboard.id);
              const boards = ((dashboard.config as { boardIds?: unknown[] }).boardIds ?? []).length;
              const href = `/${org.slug}/dashboards/${dashboard.id}`;
              const owner = dashboard.createdBy ? people.get(dashboard.createdBy) : undefined;
              return (
                <li key={dashboard.id} className="group relative flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-panel shadow-xs transition-[transform,box-shadow,border-color] duration-[var(--duration-fast)] ease-out hover:-translate-y-0.5 hover:border-border-default hover:shadow-md focus-within:border-border-default">
                  <div className="h-32 border-b border-border-subtle bg-sunken p-3">
                    <LayoutThumbnail widgets={dashboard.widgets} />
                  </div>
                  <div className="flex items-start gap-2 p-4">
                    <div className="min-w-0 flex-1">
                      <Link href={href} className="block truncate text-md font-semibold text-fg outline-none after:absolute after:inset-0 after:content-[''] hover:text-primary-text focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-focus" data-testid="dashboard-card-link">
                        {dashboard.name}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-fg-muted">
                        {(dashboard.config as { privacy?: string }).privacy === 'private' ? <Lock aria-label="Private" className="size-3.5" /> : null}
                        {workspaceName(dashboard.workspaceId)} · {dashboard.widgets.length} {dashboard.widgets.length === 1 ? 'widget' : 'widgets'} · {boards} {boards === 1 ? 'board' : 'boards'}
                      </p>
                      {dashboard.description ? <p className="mt-1.5 line-clamp-2 text-sm text-fg-secondary">{dashboard.description}</p> : null}
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted" data-testid="dashboard-card-meta">
                        {owner ? <Avatar name={owner.name} src={owner.image ?? null} colorKey={owner.id} size="xs" showTooltip /> : null}
                        <span className="truncate">
                          {owner ? `${owner.name} · ` : ''}Updated <time dateTime={dashboard.updatedAt}>{updatedAgo(dashboard.updatedAt)}</time>
                        </span>
                      </p>
                    </div>
                    <div className="relative z-[1] flex items-center gap-0.5">
                      <IconButton
                        label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                        size="sm"
                        icon={<Star className={cn(favorite && 'fill-[var(--warning-accent)] text-[var(--warning-accent)]')} />}
                        onClick={() => toggleFavorite.mutate({ entityType: 'dashboard', entityId: dashboard.id, favorite: !favorite, name: dashboard.name })}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={`Actions for ${dashboard.name}`} size="sm" icon={<MoreHorizontal />} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem icon={<ExternalLink />} onSelect={() => router.push(href)}>Open</DropdownMenuItem>
                          {canEdit ? (
                            <>
                              <DropdownMenuItem icon={<Copy />} onSelect={() => duplicate.mutate({ dashboardId: dashboard.id }, { onSuccess: (copy) => toast.success('Dashboard duplicated', copy.name) })}>
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem icon={<Trash2 />} variant="danger" onSelect={() => setDeleting(dashboard)}>
                                Delete
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <CreateDashboardDialog open={createOpen} onOpenChange={setCreateOpen} orgSlug={org.slug} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="The dashboard and its widgets move to trash. Boards are not affected."
        confirmLabel="Delete dashboard"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
