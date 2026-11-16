'use client';

/** `/integrations/carriers/[provider]` — carrier setups (spec 06 §7b): list, Add New Connection, Edit (5 tabs), Change log, Delete. */
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ChevronLeft,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Truck,
} from 'lucide-react';
import { useApiQuery } from '@/lib/query-client';
import { CARRIERS, monogramSvg, svgDataUri } from '@/lib/channel-catalog';
import { brandMarkSvg } from '@/components/integrations/shared/brand-marks';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import {
  EntityChangeLogDrawer,
  NO_PERMISSION,
  useAction,
  usePagePerms,
  usePrefetchDetails,
  type BulkResponse,
  integrationDomain,
} from '@/components/integrations/shared/shared';
import type { CarrierConnectionRow } from '@/server/repositories/carriers';
import { AddCarrierDrawer } from './add-carrier-drawer';
import { EditCarrierDrawer } from './edit-carrier-drawer';

const PERMS = ['create_setup', 'edit_setup', 'delete_setup'] as const;
const PROVIDER_OF: Readonly<Record<string, string>> = {
  'stamps-com': 'usps-stamps',
  'custom-carrier': 'custom',
};

export function CarrierConnectionsPage({ provider: slug }: { readonly provider: string }) {
  const params = useSearchParams();
  const perms = usePagePerms('integrations.integrations', PERMS);
  const sandbox = slug === 'kitstaks-sandbox';
  const entry = sandbox
    ? {
        name: 'KitStak Sandbox',
        logoSvg: monogramSvg('KS', '#2E6BE6'),
        description: 'Built-in test carrier: realistic rates, labels and voids with no account needed.',
        availability: 'available',
      }
    : CARRIERS.find((c) => c.key === slug);
  const provider = PROVIDER_OF[slug] ?? slug;
  const list = useApiQuery<CarrierConnectionRow[]>(['carrier-connections', provider], '/api/carriers', {
    query: { provider },
  });
  const [add, setAdd] = React.useState(params.get('connect') === '1');
  const [edit, setEdit] = React.useState<string | null>(null);
  usePrefetchDetails(
    'carrier-connection',
    '/api/carriers',
    (list.data?.data ?? []).map((r) => r.id),
  );
  const [log, setLog] = React.useState<CarrierConnectionRow | null>(null);
  const [toDelete, setToDelete] = React.useState<CarrierConnectionRow | null>(null);
  const action = useAction([['carrier-connections', provider], ['integration-catalog']]);
  const rows = list.data?.data ?? [];
  if (!entry)
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState
          title="Unknown carrier"
          description={`There is no carrier called “${slug}”.`}
          action={
            <Link href="/integrations/carriers">
              <Button>Back to integrations</Button>
            </Link>
          }
        />
      </div>
    );
  const soon = entry.availability === 'coming-soon';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={`${entry.name} Integration`}
        crumbLabel={entry.name}
        helpHref={`/integrations/help#carrier-${slug}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/integrations/carriers"
              className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Carrier integrations
            </Link>
            {perms.create_setup ? (
              <DisabledReason reason={soon ? "This carrier isn't available yet" : null}>
                <Button variant="success-outline" disabled={soon} onClick={() => setAdd(true)}>
                  <Plus className="h-4 w-4" />
                  Add New Connection
                </Button>
              </DisabledReason>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-col gap-3 px-6 pb-6">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={svgDataUri(sandbox ? entry.logoSvg : brandMarkSvg('carrier', slug, entry.logoSvg))}
            alt=""
            width={40}
            height={40}
            className="rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">{entry.name}</p>
            <p className="truncate text-xs text-secondary">{entry.description}</p>
          </div>
          <Badge tone={rows.length > 0 ? 'success' : 'neutral'}>
            {rows.length} setup{rows.length === 1 ? '' : 's'}
          </Badge>
        </div>
        {list.isPending ? (
          <SkeletonTable rows={3} columns={6} />
        ) : list.isError ? (
          <EmptyState
            title="Couldn't load carrier setups"
            description={list.error.message}
            action={<Button onClick={() => void list.refetch()}>Retry</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={`No ${entry.name} setups yet`}
            description="Add a connection to rate shop and print labels with this carrier."
            action={
              perms.create_setup && !soon ? (
                <Button variant="primary" onClick={() => setAdd(true)}>
                  <Plus className="h-4 w-4" />
                  Add New Connection
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-sunken text-2xs font-semibold text-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left">Setup name</th>
                  <th className="px-3 py-2.5 text-left">Warehouse</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Environment</th>
                  <th className="px-3 py-2.5 text-left">Connection</th>
                  <th className="px-3 py-2.5 text-left">Services</th>
                  <th className="px-3 py-2.5 text-left">Clients</th>
                  <th className="px-3 py-2.5 text-left">Errors (24h)</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-sunken/50">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => setEdit(r.id)}
                      >
                        {r.setupName}
                      </button>
                      {!r.hasCredentials && r.environment === 'Production' ? (
                        <Badge size="sm" tone="danger" className="ml-2">
                          No credentials
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{r.warehouseCode}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={r.isActive ? 'Active' : 'Inactive'} domain="active" />
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={r.environment} domain={integrationDomain(r.environment)} />
                    </td>
                    <td className="px-3 py-2.5 text-secondary">{r.connectionLabel}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {r.activeServices}/{r.serviceCount}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.allClients
                        ? 'All clients'
                        : `${r.clientCount} client${r.clientCount === 1 ? '' : 's'}`}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.errors24h > 0 ? (
                        <Link
                          className="inline-flex items-center gap-1 font-medium text-danger hover:underline"
                          href={`/integrations/carrier-errors/label-generation?f.connectionId=in:${r.id}`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {r.errors24h}
                        </Link>
                      ) : (
                        <span className="text-faint">0</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${r.setupName}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            icon={Pencil}
                            disabledReason={perms.edit_setup ? null : NO_PERMISSION}
                            onSelect={() => setEdit(r.id)}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem icon={History} onSelect={() => setLog(r)}>
                            Change log
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            icon={Trash2}
                            destructive
                            disabledReason={
                              !perms.delete_setup
                                ? NO_PERMISSION
                                : r.provider === 'kitstaks-sandbox'
                                  ? 'The sandbox carrier is always available; set it inactive instead'
                                  : null
                            }
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
      <AddCarrierDrawer
        open={add}
        onOpenChange={setAdd}
        provider={provider}
        providerName={entry.name}
        onCreated={(d) => {
          setAdd(false);
          void list.refetch();
          setEdit(d.id);
        }}
      />
      <EditCarrierDrawer
        id={edit}
        onOpenChange={(o) => !o && setEdit(null)}
        onSaved={() => void list.refetch()}
      />
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/carriers/${log.id}/change-log` : null}
        title={`Change log · ${log?.setupName ?? ''}`}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.setupName ?? ''}?`}
        description="Its services are removed from rate shopping presets. Setups with open orders or label history can't be deleted. Set them inactive instead."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={
          toDelete
            ? {
                columns: [
                  { key: 'n', label: 'Setup' },
                  { key: 'w', label: 'Warehouse' },
                  { key: 'e', label: 'Environment' },
                ],
                rows: [{ n: toDelete.setupName, w: toDelete.warehouseCode, e: toDelete.environment }],
              }
            : undefined
        }
        onConfirm={async () => {
          if (!toDelete) return;
          const res = await action.run<BulkResponse>(`/api/carriers/${toDelete.id}`, 'DELETE');
          if (res) toast.success('Success', `${toDelete.setupName} deleted.`);
          setToDelete(null);
          void list.refetch();
        }}
      />
    </div>
  );
}
