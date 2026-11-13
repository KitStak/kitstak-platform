'use client';
/**
 * Linked CRM / WMS records for a task or project, with live status. On mount (at most once a
 * minute per owner) it re-reads stale links from the sibling apps, so a deal that moved to Won
 * or an order that shipped shows its new status without anyone pressing refresh. Records can be
 * linked (LinkRecordDialog) and unlinked when the viewer can edit.
 *
 *   <LinkedRecordsList owner={{ projectId }} links={links} canEdit invalidate={[qk.project(key)]} />
 */
import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Link2, Plus, RefreshCw, Unlink } from 'lucide-react';
import { Button, IconButton, toast } from '@/components/ui';
import { INTEGRATION_TARGET_LABELS } from '@/lib/constants';
import type { IntegrationLinkDTO } from '@/lib/types';
import { refreshLinksAction, removeLinkAction } from '@/server/actions/links';
import { LinkRecordDialog, type LinkOwner } from './link-record-dialog';
import { RecordChip, RecordStatus, SiblingAppMark } from './record-chip';
import { targetApp } from './status-tone';

const STALE_MS = 2 * 60_000;
const lastRefresh = new Map<string, number>();

function ownerKey(owner: LinkOwner): string {
  return 'taskId' in owner ? `task:${owner.taskId}` : `project:${owner.projectId}`;
}

export function LinkedRecordsList({
  owner,
  links,
  canEdit,
  invalidate = [],
  variant = 'rows',
  emptyText = 'Nothing linked yet. Link a CRM deal or a WMS order so both teams see the same progress.',
}: {
  readonly owner: LinkOwner;
  readonly links: readonly IntegrationLinkDTO[];
  readonly canEdit: boolean;
  /** Query keys to refresh after link changes (e.g. qk.project(key), qk.task(ref)). */
  readonly invalidate?: readonly QueryKey[];
  /** `rows` (panel list) or `chips` (compact wrap). */
  readonly variant?: 'rows' | 'chips';
  readonly emptyText?: string;
}) {
  const queryClient = useQueryClient();
  // Local edits (unlink, link, refresh) layered over the `links` prop until the parent's query
  // brings a new array; a new prop array always wins.
  const [local, setLocal] = useState<{
    readonly source: readonly IntegrationLinkDTO[];
    readonly items: readonly IntegrationLinkDTO[];
  } | null>(null);
  const items = local && local.source === links ? local.items : links;
  const setItems = (update: (current: readonly IntegrationLinkDTO[]) => readonly IntegrationLinkDTO[]) =>
    setLocal((state) => ({
      source: links,
      items: update(state && state.source === links ? state.items : links),
    }));
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const key = ownerKey(owner);

  const invalidateAll = () => {
    for (const queryKey of invalidate) void queryClient.invalidateQueries({ queryKey });
  };

  const pull = async (manual: boolean) => {
    lastRefresh.set(key, Date.now());
    const result = await refreshLinksAction(
      'taskId' in owner ? { taskId: owner.taskId } : { projectId: owner.projectId },
    );
    setRefreshing(false);
    if (result.ok) {
      setLocal({ source: links, items: result.data });
      invalidateAll();
      if (manual) toast.success('Statuses are up to date');
    } else if (manual) {
      toast.error('Couldn’t refresh linked records', result.error.message);
    }
  };

  // Live status: re-read stale links once when the list appears (no spinner for this pass).
  useEffect(() => {
    const stale = links.some((link) => !link.cachedAt || Date.now() - Date.parse(link.cachedAt) > STALE_MS);
    if (!stale || links.length === 0 || Date.now() - (lastRefresh.get(key) ?? 0) < 60_000) return;
    const timer = window.setTimeout(() => void pull(false), 0);
    return () => window.clearTimeout(timer);
    // Only on mount / owner change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const unlink = async (link: IntegrationLinkDTO) => {
    setItems((current) => current.filter((entry) => entry.id !== link.id));
    const result = await removeLinkAction({ linkId: link.id });
    if (!result.ok) {
      setItems((current) => [...current, link]);
      toast.error('Couldn’t unlink it', result.error.message);
      return;
    }
    toast.success(`${link.title ?? INTEGRATION_TARGET_LABELS[link.targetType]} unlinked`);
    invalidateAll();
  };

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-fg-muted">
        {items.length ? `${items.length} linked` : 'Linked records'}
      </span>
      <span className="flex items-center gap-0.5">
        {items.length ? (
          <IconButton
            size="sm"
            label="Refresh statuses"
            icon={<RefreshCw aria-hidden className={refreshing ? 'animate-spin' : undefined} />}
            onClick={() => {
              setRefreshing(true);
              void pull(true);
            }}
            disabled={refreshing}
          />
        ) : null}
        {canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Plus aria-hidden />}
            onClick={() => setAdding(true)}
            data-testid="linked-records-add"
          >
            Link
          </Button>
        ) : null}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2" data-testid="linked-records">
      {header}
      {items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border-default px-3 py-3">
          <p className="text-sm text-fg-secondary">{emptyText}</p>
          {canEdit ? (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Link2 aria-hidden />}
              onClick={() => setAdding(true)}
            >
              Link a record
            </Button>
          ) : null}
        </div>
      ) : variant === 'chips' ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((link) => (
            <RecordChip key={link.id} link={link} onRemove={canEdit ? () => void unlink(link) : undefined} />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-panel">
          {items.map((link) => (
            <li key={link.id} className="group flex min-h-11 items-center gap-2.5 px-3 py-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-panel">
                <SiblingAppMark app={targetApp(link.targetType)} size={16} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                {link.url ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-sm font-medium text-fg hover:underline"
                  >
                    {link.title ?? INTEGRATION_TARGET_LABELS[link.targetType]}
                  </a>
                ) : (
                  <span className="truncate text-sm font-medium text-fg">
                    {link.title ?? INTEGRATION_TARGET_LABELS[link.targetType]}
                  </span>
                )}
                <span className="truncate text-xs text-fg-muted">
                  {INTEGRATION_TARGET_LABELS[link.targetType]}
                </span>
              </span>
              <RecordStatus status={link.status} />
              {canEdit ? (
                <IconButton
                  size="sm"
                  label={`Unlink ${link.title ?? 'record'}`}
                  icon={<Unlink aria-hidden />}
                  onClick={() => void unlink(link)}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <LinkRecordDialog
        open={adding}
        onOpenChange={setAdding}
        owner={owner}
        existing={items}
        onLinked={(link) => {
          setItems((current) => [...current, link]);
          invalidateAll();
        }}
      />
    </div>
  );
}
