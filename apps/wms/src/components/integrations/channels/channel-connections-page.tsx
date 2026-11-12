'use client';

/**
 * `/integrations/channels/[provider]` — Connection List (spec 06 §7a): Store name · Client ·
 * Warehouse · Status · Connection · Methods, row ⋯ Show details · Edit · Change log · Run download ·
 * Delete; Connect Store drawer; Edit Store Connection drawer.
 */
import * as React from 'react';
import { pauseLabel } from '@/lib/grid-defs/integrations/monitoring';
import { DEMO_FEED_NOTE } from '@/lib/grid-defs/integrations/logs';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Eye, History, MoreHorizontal, Pencil, Play, Plus, Store, Trash2 } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { CHANNELS, svgDataUri } from '@/lib/channel-catalog';
import { brandMarkSvg } from '@/components/integrations/shared/brand-marks';
import { maskSecret } from '@/lib/grid-defs/integrations/common';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable, Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { Callout } from '@/components/ui/callout';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import {
  DateTimeText,
  DetailList,
  EntityChangeLogDrawer,
  Muted,
  NO_PERMISSION,
  StatRow,
  useAction,
  useModuleDates,
  usePagePerms,
  usePrefetchDetails,
  type BulkResponse,
} from '@/components/integrations/shared/shared';
import type {
  CatalogCard,
  ChannelConnectionDetail,
  ChannelConnectionRow,
} from '@/server/repositories/channels';
import type { RunSummary } from '@/server/integrations/runtime/channel-runtime';
import { ConnectStoreDrawer } from './connect-store-drawer';
import { EditStoreDrawer } from './edit-store-drawer';

const PERMS = ['create_setup', 'edit_setup', 'delete_setup'] as const;

function DetailsDrawer({
  id,
  onOpenChange,
  onEdit,
  canEdit,
}: {
  readonly id: string | null;
  readonly onOpenChange: (o: boolean) => void;
  readonly onEdit: () => void;
  readonly canEdit: boolean;
}) {
  const dates = useModuleDates();
  const q = useApiQuery<ChannelConnectionDetail>(
    ['channel-connection', id ?? ''],
    id ? `/api/channels/${id}` : null,
    { staleTime: 0 },
  );
  const d = q.data?.data;
  return (
    <Drawer
      open={id !== null}
      onOpenChange={onOpenChange}
      width={45}
      title={d ? d.storeName : 'Store connection'}
      description={d ? `${d.clientName} · ${d.isSandbox ? 'KitStak Sandbox' : d.distribution}` : undefined}
      footer={
        d && canEdit ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          </div>
        ) : undefined
      }
    >
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !d ? (
        <EmptyState
          title="Couldn't load this connection"
          description={q.error?.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <StatRow
            stats={[
              {
                label: 'Status',
                value: <StatusPill status={d.status === 'Completed' ? 'Completed' : d.status} />,
              },
              { label: 'Orders', value: d.counts.orders },
              { label: 'Listings', value: d.counts.listings },
              {
                label: 'Missing orders',
                value: d.openMissing,
                tone: d.openMissing > 0 ? 'danger' : undefined,
              },
            ]}
          />
          {d.demoFeed ? (
            <p className="rounded-lg bg-info-soft px-3 py-2 text-xs text-body">{DEMO_FEED_NOTE}</p>
          ) : null}
          {d.pauseReason ? (
            <p
              className={
                pauseLabel(d.pauseReason)?.tone === 'neutral'
                  ? 'rounded-lg bg-surface-sunken px-3 py-2 text-xs text-secondary'
                  : 'rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning'
              }
            >
              {pauseLabel(d.pauseReason)?.label ?? 'Paused'}: {d.pauseReason.replace(/^Demo store: /, '')}
            </p>
          ) : null}
          <DetailList
            title="General"
            items={[
              { label: 'Client', value: d.clientName },
              { label: 'Connection', value: d.isActive ? 'Activated' : 'Deactivated' },
              {
                label: 'Authorization',
                value: d.isSandbox
                  ? 'Not needed'
                  : `${d.authMethod}${Object.values(d.credentialHints).length > 0 ? ` · ${Object.values(d.credentialHints).map(maskSecret).join(' ')}` : ' · none stored'}`,
              },
              { label: 'API version', value: d.apiVersion },
              {
                label: 'Warehouses',
                value:
                  d.mappings.map((m) => `${m.channelLocationName} → ${m.warehouseCode}`).join(', ') ||
                  'Not linked',
                wide: true,
              },
            ]}
          />
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-secondary">Channel methods</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {d.methods.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1 font-medium">{m.method}</span>
                  <span className="text-2xs text-secondary">
                    every{' '}
                    {m.intervalMinutes >= 60
                      ? `${Math.round(m.intervalMinutes / 60)} h`
                      : `${m.intervalMinutes} min`}
                  </span>
                  <span className="w-36 text-right text-2xs text-faint">
                    {m.lastRunAt ? `Last ${dates.dateTime(m.lastRunAt)}` : 'Never run'}
                  </span>
                  <StatusPill status={m.status} domain="active" size="sm" />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}

export function ChannelConnectionsPage({ provider }: { readonly provider: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const perms = usePagePerms('integrations.integrations', PERMS);
  const entry = CHANNELS.find((c) => c.key === provider);
  const catalog = useApiQuery<CatalogCard[]>(['integration-catalog'], '/api/channels/catalog', {
    staleTime: 15_000,
  });
  const card = catalog.data?.data.find((c) => c.kind === 'channel' && c.key === provider);
  const list = useApiQuery<ChannelConnectionRow[]>(['channel-connections', provider], `/api/channels`, {
    query: { provider },
  });
  const [connect, setConnect] = React.useState(params.get('connect') === '1');
  // Back from the Shopify Public App install: ?connected=<id> opens Warehouse mapping; ?oauthError= explains what failed.
  const connectedId = params.get('connected');
  const [oauthError, setOauthError] = React.useState(params.get('oauthError'));
  const [editing, setEditing] = React.useState<{
    id: string;
    tab?: 'general' | 'warehouse' | 'advanced' | 'configuration';
  } | null>(connectedId ? { id: connectedId, tab: 'warehouse' } : null);
  React.useEffect(() => {
    if (!connectedId && !params.get('oauthError')) return;
    if (connectedId)
      toast.success(
        'Store connected',
        "Shopify approved the KitStak app. Link the store's locations to warehouses, then turn on its methods.",
      );
    router.replace(`/integrations/channels/${provider}`, { scroll: false });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [details, setDetails] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<ChannelConnectionRow | null>(null);
  const [toDelete, setToDelete] = React.useState<ChannelConnectionRow | null>(null);
  const action = useAction([['channel-connections', provider], ['integration-catalog']]);
  const [running, setRunning] = React.useState<string | null>(null);
  const name = entry?.name ?? provider;
  const rows = list.data?.data ?? [];
  const refresh = () => {
    void list.refetch();
    void catalog.refetch();
  };
  usePrefetchDetails('channel-connection', '/api/channels', perms.edit_setup ? rows.map((r) => r.id) : []);

  const runDownload = async (row: ChannelConnectionRow) => {
    setRunning(row.id);
    try {
      const d = await apiRequest<ChannelConnectionDetail>(`/api/channels/${row.id}`);
      const method = d.data.methods.find((m) => m.method === 'Download Orders');
      if (!method) return;
      const res = await action.run<RunSummary>(`/api/integration-logs/methods/${method.id}/run`, 'POST', {});
      if (res)
        (res.status === 'Successful' || res.status === 'No Data'
          ? toast.success
          : res.status === 'Partially Successful'
            ? toast.warning
            : toast.error)(
          `Download Orders · ${res.status}`,
          res.message ?? `${res.success} downloaded · ${res.error} failed`,
        );
      refresh();
    } finally {
      setRunning(null);
    }
  };

  if (!entry) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          title="Unknown channel"
          description={`There is no channel called “${provider}”.`}
          action={
            <Link href="/integrations/channels">
              <Button>Back to integrations</Button>
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={`${name} Connection List`}
        crumbLabel={`${name} Connections`}
        helpHref={`/integrations/help#${provider}`}
        helper={`Your connected ${name} stores. Create another connection or configure an existing one.`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/integrations/channels"
              className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Go back to integration list
            </Link>
            {perms.create_setup ? (
              <DisabledReason
                reason={entry.availability === 'coming-soon' ? "This integration isn't available yet" : null}
              >
                <Button
                  variant="primary"
                  disabled={entry.availability === 'coming-soon'}
                  onClick={() => setConnect(true)}
                >
                  <Plus className="h-4 w-4" />
                  Connect Store
                </Button>
              </DisabledReason>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-col gap-3 px-6 pb-6">
        {oauthError ? (
          <Callout
            variant="error"
            title="Shopify install didn't finish"
            onDismiss={() => setOauthError(null)}
          >
            {oauthError}
          </Callout>
        ) : null}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={svgDataUri(brandMarkSvg('channel', entry.key, entry.logoSvg))}
            alt=""
            width={40}
            height={40}
            className="rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">{name}</p>
            <p className="truncate text-xs text-secondary">{entry.description}</p>
          </div>
          {card && !card.hasLiveApi ? (
            <Badge
              tone="neutral"
              title="KitStak has no live API adapter for this channel yet: connections are simulated KitStak Sandbox stores"
            >
              Sandbox only · no live API yet
            </Badge>
          ) : null}
          {card?.hasLiveApi && !card.liveVerified ? (
            <Badge
              tone="warning"
              title="The live adapter has not yet completed a successful call against a real store in this workspace. Connect a store with its credentials and Run a method to verify it."
            >
              Beta · live adapter not yet verified
            </Badge>
          ) : null}
          {card?.liveVerified ? (
            <Badge
              tone="success"
              title="A credentialed store in this workspace has completed successful live API calls"
            >
              Live API · verified
            </Badge>
          ) : null}
          <Link
            href={`/integrations/help#${provider}`}
            target="_blank"
            className="text-xs font-medium text-primary hover:underline"
          >
            Learn more
          </Link>
          {list.isPending ? (
            <Skeleton className="h-5 w-24 rounded-full" aria-label="Loading connections" />
          ) : list.isError ? null : (
            <Badge tone={rows.length > 0 ? 'success' : 'neutral'}>{rows.length} connected</Badge>
          )}
        </div>
        {list.isPending ? (
          <SkeletonTable rows={4} columns={6} />
        ) : list.isError ? (
          <EmptyState
            title="Couldn't load connections"
            description={list.error.message}
            action={<Button onClick={() => void list.refetch()}>Retry</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Store}
            title={`No ${name} stores connected`}
            description="Connect a store with a custom app, or try the flow with a KitStak Sandbox store."
            action={
              perms.create_setup ? (
                <Button variant="primary" onClick={() => setConnect(true)}>
                  <Plus className="h-4 w-4" />
                  Connect Store
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-sunken text-2xs font-semibold text-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left">Store name</th>
                  <th className="px-3 py-2.5 text-left">Client</th>
                  <th className="px-3 py-2.5 text-left">Warehouse</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Connection</th>
                  <th className="px-3 py-2.5 text-left">Methods</th>
                  <th className="px-3 py-2.5 text-left">Last order</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-sunken/50">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:underline"
                        onClick={() => (perms.edit_setup ? setEditing({ id: r.id }) : setDetails(r.id))}
                      >
                        {r.storeName}
                      </button>
                      {r.isSandbox ? (
                        <Badge size="sm" tone="info" className="ml-2">
                          Sandbox
                        </Badge>
                      ) : null}
                      {r.demoFeed ? (
                        <Tooltip content={DEMO_FEED_NOTE}>
                          <span tabIndex={0} className="ml-2 rounded-full">
                            <Badge size="sm" tone="neutral">
                              Demo feed
                            </Badge>
                          </span>
                        </Tooltip>
                      ) : null}
                      {r.openMissing > 0 ? (
                        <Link
                          href={`/integrations/monitoring/missing-orders?f.connectionId=in:${r.id}`}
                          className="ml-2"
                        >
                          <Badge size="sm" tone="danger">
                            {r.openMissing} missing
                          </Badge>
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{r.clientName}</td>
                    <td className="px-3 py-2.5">
                      {r.warehouses.length > 0 ? (
                        r.warehouses.join(', ')
                      ) : (
                        <Tooltip content="Link store locations in Edit → Warehouse">
                          <span className="text-warning">Not linked</span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-3 py-2.5">
                      {r.isActive ? (
                        <span className="font-medium text-success">Activated</span>
                      ) : (
                        <span className="text-secondary">Deactivated</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.pauseReason ? (
                        <Tooltip content={r.pauseReason}>
                          <span tabIndex={0}>
                            <Badge size="sm" tone={pauseLabel(r.pauseReason)?.tone ?? 'warning'}>
                              {pauseLabel(r.pauseReason)?.label ?? 'Paused'}
                            </Badge>
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="tabular-nums">{r.activeMethods} of 4 active</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-secondary">
                      <DateTimeText value={r.lastOrderAt} empty="None yet" />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${r.storeName}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem icon={Eye} onSelect={() => setDetails(r.id)}>
                            Show details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            icon={Pencil}
                            disabledReason={perms.edit_setup ? null : NO_PERMISSION}
                            onSelect={() => setEditing({ id: r.id })}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            icon={Play}
                            disabledReason={
                              !perms.edit_setup
                                ? NO_PERMISSION
                                : running === r.id
                                  ? 'Running…'
                                  : r.pauseReason
                            }
                            onSelect={() => void runDownload(r)}
                          >
                            Run Download Orders now
                          </DropdownMenuItem>
                          <DropdownMenuItem icon={History} onSelect={() => setLog(r)}>
                            Change log
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            icon={History}
                            onSelect={() =>
                              router.push(
                                `/integrations/logs/history?f.storeName=eq:${encodeURIComponent(r.storeName)}`,
                              )
                            }
                          >
                            Channel history
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            icon={Trash2}
                            destructive
                            disabledReason={perms.delete_setup ? null : NO_PERMISSION}
                            onSelect={() => setToDelete(r)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConnectStoreDrawer
        open={connect}
        onOpenChange={setConnect}
        provider={provider}
        providerName={name}
        hasLiveApi={card?.hasLiveApi ?? false}
        publicAppEnabled={card?.publicApp ?? false}
        onConnected={(d) => {
          setConnect(false);
          refresh();
          setEditing({ id: d.id, tab: 'warehouse' });
        }}
      />
      <EditStoreDrawer
        id={editing?.id ?? null}
        initialTab={editing?.tab}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={refresh}
      />
      <DetailsDrawer
        id={details}
        onOpenChange={(o) => !o && setDetails(null)}
        canEdit={perms.edit_setup}
        onEdit={() => {
          const id = details;
          setDetails(null);
          if (id) setEditing({ id });
        }}
      />
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/channels/${log.id}/change-log` : null}
        title={`Change log · ${log?.storeName ?? ''}`}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.storeName ?? ''}?`}
        description="Its channel methods, run history, listings and missing orders are removed. Orders already downloaded stay. Connections with open orders can't be deleted. Deactivate them instead."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={
          toDelete
            ? {
                columns: [
                  { key: 'store', label: 'Store' },
                  { key: 'client', label: 'Client' },
                  { key: 'wh', label: 'Warehouse' },
                ],
                rows: [
                  {
                    store: toDelete.storeName,
                    client: toDelete.clientName,
                    wh: toDelete.warehouses.join(', ') || '—',
                  },
                ],
              }
            : undefined
        }
        onConfirm={async () => {
          if (!toDelete) return;
          const res = await action.run<BulkResponse>(`/api/channels/${toDelete.id}`, 'DELETE');
          if (res) toast.success('Success', `${toDelete.storeName} deleted.`);
          setToDelete(null);
          refresh();
        }}
      />
    </div>
  );
}
