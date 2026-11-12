'use client';

/**
 * Client details (`/clients/[id]`, beyond Logiwa): header with status + actions, KPI tiles
 * (orders 30d, units shipped 30d, inventory units, open POs), and tabs Overview · Settings
 * (inline edit of currency + 28 switches) · Addresses (inline editor) · Users with access ·
 * Billing contracts · Activity (change log + notes). Tab state lives in the URL.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Boxes,
  CircleCheck,
  CircleOff,
  ClipboardList,
  History,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  Truck,
} from 'lucide-react';
import { useForm, FormProvider } from 'react-hook-form';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { urlParam, useUrlState } from '@/lib/use-url-state';
import {
  enabledSwitchCount,
  parseClientDetail,
  type ClientInput,
  type ClientSettingsForm,
} from '@/lib/grid-defs/organization/clients';
import { normalizeDefaults, type OrgAddressInput } from '@/lib/grid-defs/organization/common';
import { AutoBreadcrumbs } from '@/components/layout/page-header';
import { DetailHeader } from '@/components/shared/detail-header';
import { ActivityTimeline } from '@/components/shared/activity-timeline';
import { KvList } from '@/components/shared/kv-list';
import { NotesPanel } from '@/components/shared/notes-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { UnderlineTabs } from '@/components/ui/tabs';
import { TabFocusGuard } from '@/components/organization/tab-focus-guard';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import {
  EntityChangeLogDrawer,
  NO_PERMISSION,
  toastBulk,
  useAction,
  usePagePerms,
  type BulkResponse,
} from '@/components/facility/facility-shared';
import { AddressesEditor, addressLines } from '@/components/organization/addresses-editor';
import { At, Day } from '@/components/billing/billing-shared';
import type { ClientDetail } from '@/server/repositories/clients';
import { CURRENCY_OPTIONS, ClientWizardDrawer, SettingsSwitches, detailToClientForm } from './client-wizard';

const TABS = ['overview', 'settings', 'addresses', 'users', 'billing', 'activity'] as const;
const PERMS = ['view', 'edit', 'delete', 'change_log'] as const;

function Conflict({ onReload }: { readonly onReload: () => void }) {
  return (
    <Callout
      variant="attention"
      title="This record changed since you opened it"
      action={
        <Button size="sm" onClick={onReload}>
          Reload
        </Button>
      }
    >
      Someone else saved this client. Reload to see their changes.
    </Callout>
  );
}

function SettingsTab({
  client,
  canEdit,
  onSaved,
}: {
  readonly client: ClientDetail;
  readonly canEdit: boolean;
  readonly onSaved: () => void;
}) {
  const form = useForm<ClientInput>({ defaultValues: detailToClientForm(client) });
  const [busy, setBusy] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const currency = form.watch('currency');
  const dirty = form.formState.isDirty;
  const save = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      await apiRequest(`/api/clients/${client.id}/settings`, {
        method: 'PATCH',
        body: { currency: values.currency, settings: values.settings, version: client.version },
      });
      toast.success(
        'Success',
        `Settings saved · ${enabledSwitchCount(values.settings as ClientSettingsForm)} of 28 switches on.`,
      );
      onSaved();
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      toast.error("Couldn't save settings", isApiError(error) ? error.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4" noValidate>
        {conflict ? <Conflict onReload={() => window.location.reload()} /> : null}
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-surface p-4">
          <label className="flex w-72 flex-col gap-1 text-xs font-medium text-secondary">
            Currency
            <Select
              aria-label="Currency"
              options={CURRENCY_OPTIONS}
              value={currency}
              disabled={!canEdit}
              onChange={(v) =>
                v && form.setValue('currency', v as ClientInput['currency'], { shouldDirty: true })
              }
            />
          </label>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={!dirty || busy} onClick={() => form.reset()}>
              Discard
            </Button>
            <DisabledReason reason={!canEdit ? NO_PERMISSION : !dirty ? 'No changes to save' : null}>
              <Button type="submit" variant="primary" disabled={!canEdit || !dirty || busy} aria-busy={busy}>
                Save settings
              </Button>
            </DisabledReason>
          </div>
        </div>
        <SettingsSwitches disabled={!canEdit} />
      </form>
    </FormProvider>
  );
}

function AddressesTab({
  client,
  canEdit,
  onSaved,
}: {
  readonly client: ClientDetail;
  readonly canEdit: boolean;
  readonly onSaved: () => void;
}) {
  const initial = React.useMemo(() => detailToClientForm(client).addresses as OrgAddressInput[], [client]);
  const [list, setList] = React.useState<OrgAddressInput[]>(initial);
  const [busy, setBusy] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const dirty = JSON.stringify(list) !== JSON.stringify(initial);
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        ...detailToClientForm(client),
        addresses: normalizeDefaults(
          list.map((a) => ({ ...a, isDefault: Boolean(a.isDefault), isActive: a.isActive !== false })),
        ),
        version: client.version,
      };
      await apiRequest(`/api/clients/${client.id}`, { method: 'PATCH', body });
      toast.success('Success', 'Addresses saved.');
      onSaved();
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      toast.error("Couldn't save addresses", isApiError(error) ? error.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {conflict ? <Conflict onReload={() => window.location.reload()} /> : null}
      <AddressesEditor
        value={list}
        onChange={setList}
        disabled={!canEdit}
        description="Default addresses of each usage type are pre-filled on documents and returns."
      />
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" disabled={!dirty || busy} onClick={() => setList(initial)}>
          Discard
        </Button>
        <DisabledReason reason={!canEdit ? NO_PERMISSION : !dirty ? 'No changes to save' : null}>
          <Button variant="primary" disabled={!canEdit || !dirty || busy} onClick={() => void save()}>
            Save addresses
          </Button>
        </DisabledReason>
      </div>
    </div>
  );
}

function Table({
  head,
  children,
  empty,
}: {
  readonly head: readonly string[];
  readonly children: React.ReactNode;
  readonly empty?: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-sunken text-2xs font-semibold text-secondary">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

/** The client's billing comes from its 3PL billing forms: show the approved (else latest) form, not a free-text plan. */
function BillingFormValue({ client }: { readonly client: ClientDetail }) {
  const approved = client.contracts.filter((k) => k.approvalStatus === 'Approved');
  const pick = approved[0] ?? client.contracts[0];
  if (!pick) return <span className="text-faint">No billing form yet</span>;
  return (
    <span>
      <Link href={`/billing/${pick.id}`} className="font-medium text-primary hover:underline">
        {pick.name}
      </Link>
      <span className="text-faint">
        {' '}
        · {pick.approvalStatus}
        {approved.length > 1 ? ` · +${approved.length - 1} more` : ''}
      </span>
    </span>
  );
}

function Overview({
  client,
  canEdit,
  onAddAddress,
}: {
  readonly client: ClientDetail;
  readonly canEdit: boolean;
  readonly onAddAddress: () => void;
}) {
  const def = (usage: string) =>
    client.addresses.find((a) => a.usageType === usage && a.isDefault) ??
    client.addresses.find((a) => a.usageType === usage);
  const on = enabledSwitchCount(client.settings);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:col-span-2">
        <h3 className="text-xs font-semibold text-secondary">Information</h3>
        <KvList
          columns={2}
          items={[
            { key: 'name', label: 'Display name', value: client.name },
            { key: 'official', label: 'Official name', value: client.officialName },
            { key: 'code', label: 'Client code', value: <code className="font-mono">{client.code}</code> },
            { key: 'tax', label: 'Tax ID', value: client.taxId },
            { key: 'currency', label: 'Currency', value: client.currency },
            { key: 'plan', label: 'Billing form', value: <BillingFormValue client={client} /> },
            {
              key: 'sscc',
              label: 'SSCC-18',
              value: client.sscc?.gs1CompanyPrefix ? (
                <span className="font-mono tabular-nums">
                  ext {client.sscc.extensionDigit} · prefix {client.sscc.gs1CompanyPrefix} · serial from{' '}
                  {client.sscc.serialNumber}
                </span>
              ) : null,
            },
            {
              key: 'contact',
              label: 'Contact',
              value: [client.contactName, client.contactEmail, client.phone].filter(Boolean).join(' · '),
            },
            {
              key: 'created',
              label: 'Created',
              value: (
                <span>
                  <Day value={client.createdAt.slice(0, 10)} />
                  {client.createdByName ? ` by ${client.createdByName}` : ''}
                </span>
              ),
            },
          ]}
        />
      </section>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="text-xs font-semibold text-secondary">Default addresses</h3>
        {(['Shipping', 'Billing', 'Return'] as const).map((u) => {
          const a = def(u);
          return (
            <div key={u} className="flex flex-col gap-0.5">
              <span className="text-2xs font-semibold text-faint">{u}</span>
              {a ? (
                <span className="text-sm leading-5 text-body">
                  {a.name ? <strong className="font-semibold">{a.name}: </strong> : null}
                  {addressLines(a).join(', ')}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-sm text-faint">
                  Not set
                  {canEdit ? (
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={onAddAddress}
                    >
                      Add {u.toLowerCase()} address
                    </button>
                  ) : null}
                </span>
              )}
            </div>
          );
        })}
        <h3 className="mt-2 text-xs font-semibold text-secondary">Settings</h3>
        <p className="text-sm text-body">{on} of 28 switches on</p>
      </section>
    </div>
  );
}

export function ClientDetailPage({ id }: { readonly id: string }) {
  const router = useRouter();
  const perms = usePagePerms('settings.clients', PERMS);
  const billingPerms = usePagePerms('settings.billing', ['view', 'create'] as const);
  const [url, setUrl] = useUrlState({ tab: urlParam.enum(TABS, 'overview') });
  const q = useApiQuery<ClientDetail>(['client', id], `/api/clients/${id}`, { staleTime: 0 });
  const [edit, setEdit] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'delete' | 'Active' | 'Inactive' | null>(null);
  const action = useAction([['client', id], ['me']]);
  // Parsed with defaults: a missing optional block (sscc, kpis, addresses…) never takes the page down.
  const c = React.useMemo(
    () => (q.data ? parseClientDetail<ClientDetail>(q.data.data) : undefined) ?? undefined,
    [q.data],
  );

  if (q.isPending)
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (q.isError || !c) {
    const missing = isApiError(q.error) && q.error.code === 'NOT_FOUND';
    return (
      <div className="p-6">
        <EmptyState
          title={missing ? 'Client not found' : "Couldn't load this client"}
          description={
            missing ? "It may have been deleted, or it isn't in your client scope." : q.error?.message
          }
          action={
            missing ? (
              <Button onClick={() => router.push('/clients')}>Back to clients</Button>
            ) : (
              <Button onClick={() => void q.refetch()}>Retry</Button>
            )
          }
        />
      </div>
    );
  }
  const refetch = () => void q.refetch();
  const approvedContracts = c.contracts.filter((b) => b.approvalStatus === 'Approved').length;
  const deleteReason = !perms.delete
    ? NO_PERMISSION
    : c.kpis.products > 0 || c.totalOrders > 0 || c.contracts.length > 0
      ? "Clients with products, orders or billing forms can't be deleted; deactivate instead"
      : null;
  const statusTarget = c.status === 'Active' ? 'Inactive' : 'Active';
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'settings', label: 'Settings' },
    { key: 'addresses', label: 'Addresses', count: c.addresses.length },
    { key: 'users', label: 'Users with access', count: c.users.length },
    { key: 'billing', label: 'Billing contracts', count: c.contracts.length },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* One title block: breadcrumb → client name + status pill + actions (no separate "Client details" H1 or back link). */}
      <div className="flex flex-col gap-4 px-6 pb-8 pt-3">
        <div className="flex flex-col">
          <AutoBreadcrumbs currentLabel={c.name} />
          <DetailHeader
            className="px-0 pt-1.5 pb-0"
            title={c.name}
            status={c.status}
            statusDomain="active"
            meta={
              <span>
                {c.officialName ?? c.name} · <code className="font-mono">{c.code}</code> · {c.currency}
              </span>
            }
            badges={c.taxId ? <Badge tone="outline">Tax ID {c.taxId}</Badge> : undefined}
            actions={
              <div className="flex items-center gap-2">
                <DisabledReason reason={perms.edit ? null : NO_PERMISSION}>
                  <Button variant="primary" disabled={!perms.edit} onClick={() => setEdit(true)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </Button>
                </DisabledReason>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" aria-label="More actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem icon={History} onSelect={() => setLog(true)}>
                      Change log
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={ReceiptText}
                      href={`/billing/new?clientId=${c.id}`}
                      disabledReason={
                        billingPerms.create
                          ? c.status === 'Active'
                            ? null
                            : 'Activate the client first'
                          : NO_PERMISSION
                      }
                    >
                      Create billing form
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={statusTarget === 'Active' ? CircleCheck : CircleOff}
                      onSelect={() => setConfirm(statusTarget)}
                      disabledReason={
                        !perms.edit
                          ? NO_PERMISSION
                          : statusTarget === 'Inactive' && c.kpis.openOrders > 0
                            ? `${c.kpis.openOrders} open orders`
                            : null
                      }
                    >
                      {statusTarget === 'Active' ? 'Activate' : 'Deactivate'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      icon={Trash2}
                      destructive
                      onSelect={() => setConfirm('delete')}
                      disabledReason={deleteReason}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Orders · 30 days"
            value={c.kpis.orders30d.toLocaleString('en-US')}
            icon={ClipboardList}
            tone="primary"
            sublabel={`${c.kpis.openOrders} open now`}
            href={`/orders?f.clientId=in:${c.id}`}
          />
          <StatTile
            label="Units shipped · 30 days"
            value={c.kpis.unitsShipped30d.toLocaleString('en-US')}
            icon={Truck}
            tone="success"
            href={`/orders/shipped?f.clientId=in:${c.id}`}
          />
          <StatTile
            label="Inventory units"
            value={c.kpis.inventoryUnits.toLocaleString('en-US')}
            icon={Boxes}
            sublabel={`${c.kpis.skusInStock} SKUs in stock · ${c.kpis.products} products`}
            href={`/inventory?f.clientId=in:${c.id}`}
          />
          <StatTile
            label="Open POs"
            value={c.kpis.openPos.toLocaleString('en-US')}
            icon={PackageCheck}
            tone={c.kpis.openPos > 0 ? 'warning' : 'default'}
            href={`/purchase-orders?f.clientId=in:${c.id}`}
          />
        </div>
        <TabFocusGuard>
          <UnderlineTabs
            tabs={tabs}
            active={url.tab}
            onChange={(k) => setUrl({ tab: k as (typeof TABS)[number] })}
            className="px-0"
            ariaLabel="Client sections"
          />
        </TabFocusGuard>
        {url.tab === 'overview' ? (
          <Overview client={c} canEdit={perms.edit} onAddAddress={() => setUrl({ tab: 'addresses' })} />
        ) : null}
        {url.tab === 'settings' ? (
          <SettingsTab key={`s-${c.version}`} client={c} canEdit={perms.edit} onSaved={refetch} />
        ) : null}
        {url.tab === 'addresses' ? (
          <AddressesTab key={`a-${c.version}`} client={c} canEdit={perms.edit} onSaved={refetch} />
        ) : null}
        {url.tab === 'users' ? (
          <Table
            head={['User', 'Email', 'Role', 'Access', 'Status']}
            empty={
              c.users.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No users can see this client"
                    description="Assign users to the client from Settings › Users."
                  />
                </div>
              ) : null
            }
          >
            {c.users.map((u) => (
              <tr key={u.id} className="hover:bg-surface-sunken/50">
                <td className="px-3 py-2 font-medium text-foreground">{u.name}</td>
                <td className="px-3 py-2 text-secondary">{u.email}</td>
                <td className="px-3 py-2 capitalize">{u.role}</td>
                <td className="px-3 py-2">
                  <Badge tone={u.access === 'Assigned' ? 'primary' : 'neutral'} shape="pill">
                    {u.access}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={u.isActive ? 'Active' : 'Inactive'} domain="active" size="sm" />
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
        {url.tab === 'billing' ? (
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <DisabledReason
                reason={
                  !billingPerms.create
                    ? NO_PERMISSION
                    : c.status !== 'Active'
                      ? 'Activate the client first'
                      : null
                }
              >
                <Button
                  variant="secondary"
                  disabled={!billingPerms.create || c.status !== 'Active'}
                  onClick={() => router.push(`/billing/new?clientId=${c.id}`)}
                >
                  <Plus className="h-4 w-4" />
                  Create billing form
                </Button>
              </DisabledReason>
            </div>
            <Table
              head={[
                'Billing form',
                'Warehouse',
                'Period',
                'Start date',
                'Fees',
                'Bills',
                'Last calculation',
                'Approval',
              ]}
              empty={
                c.contracts.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      icon={ReceiptText}
                      title="No billing forms yet"
                      description="Create a 3PL billing form to start invoicing this client."
                    />
                  </div>
                ) : null
              }
            >
              {c.contracts.map((b) => (
                <tr key={b.id} className="hover:bg-surface-sunken/50">
                  <td className="px-3 py-2">
                    <Link className="font-medium text-primary hover:underline" href={`/billing/${b.id}`}>
                      {b.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{b.warehouseCode}</td>
                  <td className="px-3 py-2">{b.frequency}</td>
                  <td className="px-3 py-2">
                    <Day value={b.calcStartDate} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{b.feeCount}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {b.reportCount > 0 ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/billing/reports?f.contractName=eq:${encodeURIComponent(b.name)}`}
                      >
                        {b.reportCount}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <At value={b.lastCalculatedAt} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={b.approvalStatus === 'Approved' ? 'success' : 'neutral'} shape="pill">
                      {b.approvalStatus}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        ) : null}
        {url.tab === 'activity' ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <section className="rounded-lg border border-border bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold text-secondary">Change history</h3>
              <ActivityTimeline entityType="client" entityId={c.id} />
            </section>
            <section className="rounded-lg border border-border bg-surface p-4">
              <NotesPanel entityType="client" entityId={c.id} canEdit={perms.edit} />
            </section>
          </div>
        ) : null}
      </div>
      <ClientWizardDrawer open={edit} editId={c.id} onOpenChange={setEdit} onSaved={refetch} />
      <EntityChangeLogDrawer
        open={log}
        onOpenChange={setLog}
        path={log ? `/api/clients/${c.id}/change-log` : null}
        title={`Change log · ${c.name}`}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant={confirm === 'delete' ? 'danger' : confirm === 'Inactive' ? 'attention' : 'info'}
        title={
          confirm === 'delete'
            ? `Delete client ${c.name}?`
            : `${confirm === 'Active' ? 'Activate' : 'Deactivate'} ${c.name}?`
        }
        description={
          confirm === 'delete'
            ? "The client, its addresses and customers are removed. This can't be undone."
            : confirm === 'Inactive'
              ? `The client disappears from order, PO and billing client selects.${approvedContracts > 0 ? ` Automatic billing pauses for its ${approvedContracts} approved billing ${approvedContracts === 1 ? 'form' : 'forms'}; you can still calculate a final bill manually.` : ''}`
              : 'The client becomes selectable on new orders, POs and billing forms.'
        }
        confirmLabel={confirm === 'delete' ? 'Yes, delete' : 'Yes'}
        cancelLabel="No"
        onConfirm={async () => {
          if (confirm === 'delete') {
            const r = await action.run<BulkResponse>('/api/clients/bulk-delete', 'POST', { ids: [c.id] });
            if (r) {
              toastBulk(r, 'client', 'deleted');
              if (r.succeeded.length) router.push('/clients');
            }
          } else if (confirm) {
            const r = await action.run<BulkResponse>('/api/clients/bulk-status', 'POST', {
              ids: [c.id],
              status: confirm,
            });
            if (r) toastBulk(r, 'client', confirm === 'Active' ? 'activated' : 'deactivated');
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
