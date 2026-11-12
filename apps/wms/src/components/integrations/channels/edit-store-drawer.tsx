'use client';

/**
 * Edit Store Connection drawer (spec 06 §7a): General · Warehouse (location mapping) · Advanced
 * (payment statuses, tax ID mapping, tag include/exclude) · Configuration (products, orders,
 * inventory, shipments → the 4 channel methods, with run intervals). One Save; inline errors jump
 * to the tab that holds them; 409 shows a reload prompt.
 */
import * as React from 'react';
import { z } from 'zod';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import type { ChannelSettings } from '@/lib/domain-types';
import { CHANNEL_METHODS } from '@/lib/enums';
import {
  PAYMENT_STATUSES,
  PRODUCT_UOMS,
  SHIPMENT_ORDER_TYPES,
  STORE_NAME_MAX,
  editStoreSchema,
} from '@/lib/grid-defs/integrations/channels';
import { maskSecret } from '@/lib/grid-defs/integrations/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ChipInput } from '@/components/ui/chip-input';
import { Combobox } from '@/components/ui/combobox';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { NumberInput } from '@/components/ui/number-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { UnderlineTabs } from '@/components/ui/tabs';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { SettingYesNo as YesNoToggle } from '@/components/integrations/shared/form-controls';
import { DRAWER_DETAIL_STALE_MS, useWarehouseOptions } from '@/components/integrations/shared/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { ChannelConnectionDetail } from '@/server/repositories/channels';

type Tab = 'general' | 'warehouse' | 'advanced' | 'configuration';
interface Mapping {
  channelLocationId: string;
  channelLocationName: string;
  warehouseId: string;
}
interface FormState {
  storeName: string;
  isActive: boolean;
  apiVersion: 'Rest API' | 'GraphQL';
  authMethod: 'Access Token' | 'Client ID & Secret' | 'OAuth';
  accessToken: string;
  apiClientId: string;
  apiClientSecret: string;
  mappings: Mapping[];
  settings: ChannelSettings;
  intervals: Record<string, number>;
}

const TAB_OF = (path: string): Tab =>
  path.startsWith('mappings')
    ? 'warehouse'
    : path.startsWith('settings.paymentStatuses') ||
        path.startsWith('settings.tagFilter') ||
        path.startsWith('settings.taxIdMapping')
      ? 'advanced'
      : path.startsWith('settings') || path.startsWith('intervals')
        ? 'configuration'
        : 'general';
const locList = z.array(z.object({ id: z.string(), name: z.string() }));

function Row({
  label,
  children,
  hint,
}: {
  readonly label: React.ReactNode;
  readonly children: React.ReactNode;
  readonly hint?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint ? <p className="text-2xs text-secondary">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({
  title,
  children,
  required,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly required?: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface px-4 py-2">
      <h3 className="pb-1 pt-2 text-xs font-semibold text-secondary">
        {title}
        {required ? <span className="text-danger"> *</span> : null}
      </h3>
      {children}
    </section>
  );
}

function toForm(d: ChannelConnectionDetail): FormState {
  return {
    storeName: d.storeName,
    isActive: d.isActive,
    apiVersion: d.apiVersion,
    authMethod: d.authMethod,
    accessToken: '',
    apiClientId: '',
    apiClientSecret: '',
    mappings: d.mappings.map((m) => ({
      channelLocationId: m.channelLocationId,
      channelLocationName: m.channelLocationName,
      warehouseId: m.warehouseId,
    })),
    settings: d.settings,
    intervals: Object.fromEntries(d.methods.map((m) => [m.method, m.intervalMinutes])),
  };
}

const DETAIL_KEY = 'channel-connection';

export function EditStoreDrawer({
  id,
  initialTab,
  onOpenChange,
  onSaved,
}: {
  readonly id: string | null;
  readonly initialTab?: Tab;
  readonly onOpenChange: (o: boolean) => void;
  readonly onSaved: () => void;
}) {
  const qc = useQueryClient();
  const detail = useApiQuery<ChannelConnectionDetail>(
    [DETAIL_KEY, id ?? ''],
    id ? `/api/channels/${id}` : null,
    { staleTime: DRAWER_DETAIL_STALE_MS },
  );
  const d = detail.data?.data;
  const [dirty, setDirty] = React.useState(false);
  return (
    <Drawer
      open={id !== null}
      onOpenChange={(o) => {
        if (!o) setDirty(false);
        onOpenChange(o);
      }}
      dirty={dirty}
      width={60}
      title={d ? `Edit store connection · ${d.storeName}` : 'Edit store connection'}
      description="General, warehouse mapping, advanced filters and the configuration that drives the channel methods."
    >
      {detail.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : detail.isError || !d ? (
        <EmptyState
          title="Couldn't load this connection"
          description={detail.error?.message}
          action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
        />
      ) : (
        <Body
          key={`${d.id}-${detail.dataUpdatedAt}`}
          detail={d}
          initialTab={initialTab ?? 'general'}
          onDirtyChange={setDirty}
          onCancel={() => onOpenChange(false)}
          onSaved={() => {
            setDirty(false);
            void qc.invalidateQueries({ queryKey: [DETAIL_KEY, d.id] });
            onSaved();
            onOpenChange(false);
          }}
        />
      )}
    </Drawer>
  );
}

function Body({
  detail,
  initialTab,
  onDirtyChange,
  onCancel,
  onSaved,
}: {
  readonly detail: ChannelConnectionDetail;
  readonly initialTab: Tab;
  readonly onDirtyChange: (d: boolean) => void;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}) {
  const warehouses = useWarehouseOptions();
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const [form, setForm] = React.useState<FormState>(() => toForm(detail));
  const [baseline] = React.useState(() => JSON.stringify(toForm(detail)));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [newLoc, setNewLoc] = React.useState<string | null>(null);
  const [newWh, setNewWh] = React.useState<string | null>(null);
  const [rotate, setRotate] = React.useState(false);
  // A paused live store (no/invalid credentials) can't list locations; skip the call instead of logging a 409.
  const locationsBlocked = !detail.isSandbox && detail.pauseReason !== null;
  const locations = useApiQuery<unknown>(
    ['channel-locations', detail.id],
    locationsBlocked ? null : `/api/channels/${detail.id}/locations`,
    { staleTime: 60_000, retry: false },
  );
  const locs = locList.safeParse(locations.data?.data);
  const locOptions = (locs.success ? locs.data : []).map((l) => ({ value: l.id, label: l.name }));
  const dirty = JSON.stringify(form) !== baseline;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const st = form.settings;
  const setSettings = (patch: (s: ChannelSettings) => ChannelSettings) => {
    setForm((f) => ({ ...f, settings: patch(f.settings) }));
    setErrors({});
  };
  const wh = (wid: string) => warehouses.short.find((w) => w.value === wid)?.label ?? '—';

  const save = async () => {
    const body = {
      ...form,
      version: detail.version,
      accessToken: rotate ? form.accessToken : undefined,
      apiClientId: rotate ? form.apiClientId : undefined,
      apiClientSecret: rotate ? form.apiClientSecret : undefined,
      authMethod: rotate ? form.authMethod : undefined,
    };
    const parsed = editStoreSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
      setErrors(next);
      const first = Object.keys(next)[0];
      if (first) {
        setTab(TAB_OF(first));
        toast.error('Check the highlighted fields', next[first] ?? '');
      }
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/channels/${detail.id}`, { method: 'PATCH', body });
      toast.success(
        'Success',
        `${form.storeName} saved. Active methods: ${CHANNEL_METHODS.filter((m) => (m === 'Download Orders' ? st.orders.download : m === 'Download Products' ? st.products.download : m === 'Sync Inventory' ? st.inventory.sync : st.shipments.sendShipmentInfo)).join(', ') || 'none'}.`,
      );
      onSaved();
    } catch (error) {
      if (isApiError(error)) {
        if (error.code === 'CONFLICT') setConflict(true);
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(error.fieldErrors)) if (v[0]) next[k] = v[0];
        setErrors(next);
        const first = Object.keys(next)[0];
        if (first) setTab(TAB_OF(first));
      }
      toast.error("Couldn't save the connection", isApiError(error) ? error.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="mt-1 text-xs text-danger">
        {errors[k]}
      </p>
    ) : null;
  const tabErrors = (t: Tab) => Object.keys(errors).filter((k) => errors[k] && TAB_OF(k) === t).length;
  return (
    <div className="flex flex-col gap-4">
      {conflict ? (
        <Callout
          variant="attention"
          title="This store changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Someone else saved this connection. Reload to see their changes.
        </Callout>
      ) : null}
      <UnderlineTabs
        ariaLabel="Connection sections"
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={(['general', 'warehouse', 'advanced', 'configuration'] as const).map((k) => ({
          key: k,
          label: k[0]?.toUpperCase() + k.slice(1),
          count: tabErrors(k) || undefined,
        }))}
      />
      {tab === 'general' ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="es-storeName" className="text-xs font-medium text-body">
                Connection store name <span className="text-danger">*</span>
              </label>
              <TextField
                id="es-storeName"
                value={form.storeName}
                maxLength={STORE_NAME_MAX}
                showCount
                invalid={Boolean(errors.storeName)}
                onChange={(e) => setForm((f) => ({ ...f, storeName: e.target.value }))}
              />
              {err('storeName')}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-body">Client</span>
              <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-secondary">
                {detail.clientName} <span className="text-2xs">· locked</span>
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-body">Active</span>
              <YesNoToggle
                value={form.isActive}
                onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                ariaLabel="Connection active"
              />
              <p className="text-2xs text-faint">Inactive connections pause every channel method.</p>
            </div>
            {!detail.isSandbox ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-body">API version</span>
                <SegmentedControl
                  className="w-full [&>button]:flex-1"
                  ariaLabel="API version"
                  value={form.apiVersion}
                  onChange={(v) => setForm((f) => ({ ...f, apiVersion: v }))}
                  options={[
                    { value: 'Rest API', label: 'Rest API' },
                    { value: 'GraphQL', label: 'GraphQL' },
                  ]}
                />
              </div>
            ) : null}
          </div>
          {detail.isSandbox ? (
            <Callout variant="info" title="KitStak Sandbox">
              No credentials needed. Each Download Orders run creates 2–6 realistic orders from this client’s
              SKUs. Scheduled runs never fail on purpose; to practise Missing Orders and Retry Download, use
              Simulate error (flask icon) on the Download Orders row in Channel Methods.
            </Callout>
          ) : (
            <section className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-secondary" />
                <p className="flex-1 text-sm font-medium">Authorization · {detail.authMethod}</p>
                {Object.entries(detail.credentialHints).map(([k, v]) => (
                  <Badge key={k} size="sm" tone="neutral">
                    {k} {maskSecret(v)}
                  </Badge>
                ))}
                {Object.keys(detail.credentialHints).length === 0 ? (
                  <Badge size="sm" tone="danger">
                    No credentials stored
                  </Badge>
                ) : null}
              </div>
              {!rotate ? (
                <Button className="mt-3" size="sm" variant="secondary" onClick={() => setRotate(true)}>
                  Customize authorization method
                </Button>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  <SegmentedControl
                    className="w-full [&>button]:flex-1"
                    ariaLabel="Authorization method"
                    value={form.authMethod === 'OAuth' ? 'Access Token' : form.authMethod}
                    onChange={(v) => setForm((f) => ({ ...f, authMethod: v }))}
                    options={[
                      { value: 'Access Token', label: 'Access Token' },
                      { value: 'Client ID & Secret', label: 'Client ID & Secret' },
                    ]}
                  />
                  {form.authMethod === 'Client ID & Secret' ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <TextField
                        aria-label="Client ID"
                        placeholder="New client ID"
                        autoComplete="off"
                        value={form.apiClientId}
                        onChange={(e) => setForm((f) => ({ ...f, apiClientId: e.target.value }))}
                      />
                      <TextField
                        aria-label="Client secret"
                        type="password"
                        placeholder="New client secret"
                        autoComplete="off"
                        value={form.apiClientSecret}
                        onChange={(e) => setForm((f) => ({ ...f, apiClientSecret: e.target.value }))}
                      />
                    </div>
                  ) : (
                    <TextField
                      aria-label="Access token"
                      type="password"
                      placeholder="New access token"
                      autoComplete="off"
                      value={form.accessToken}
                      invalid={Boolean(errors.accessToken)}
                      onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
                    />
                  )}
                  {err('accessToken')}
                  {err('apiClientId')}
                  <p className="text-2xs text-faint">
                    New credentials are validated with the store when you save. Leave blank to keep the
                    current ones.
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      ) : null}

      {tab === 'warehouse' ? (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Link store fulfillment locations with KitStak
            </h3>
            <p className="text-xs text-secondary">
              KitStak downloads orders, syncs inventory and sends fulfillments by location. Match each store
              location to a warehouse.
            </p>
          </div>
          {locationsBlocked ? (
            <Callout
              variant="attention"
              title={
                detail.isActive
                  ? "Connect credentials to load the store's locations"
                  : 'Store locations unavailable'
              }
            >
              {detail.pauseReason}.{' '}
              {detail.isActive
                ? 'Rotate the credentials on the General tab and save; existing mappings stay as they are.'
                : 'Turn the connection on and save to load locations.'}
            </Callout>
          ) : null}
          {locations.isError ? (
            <Callout variant="error" title="Couldn't load the store's locations">
              {locations.error.message}
            </Callout>
          ) : null}
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-sunken/60 p-3">
            <div className="flex min-w-56 flex-1 flex-col gap-1">
              <label htmlFor="es-loc" className="text-2xs font-medium text-secondary">
                Store location
              </label>
              <Select
                id="es-loc"
                value={newLoc}
                onChange={setNewLoc}
                placeholder={
                  locationsBlocked
                    ? 'Connect credentials first'
                    : locations.isPending
                      ? 'Loading locations…'
                      : 'Select store location'
                }
                options={locOptions.map((o) => ({
                  ...o,
                  disabled: form.mappings.some((m) => m.channelLocationId === o.value),
                }))}
              />
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <label htmlFor="es-wh" className="text-2xs font-medium text-secondary">
                Warehouse
              </label>
              <Select
                id="es-wh"
                value={newWh}
                onChange={setNewWh}
                placeholder="Select warehouse"
                options={warehouses.options}
              />
            </div>
            <Button
              variant="primary"
              disabled={!newLoc || !newWh}
              title={!newLoc || !newWh ? 'Choose a location and a warehouse' : undefined}
              onClick={() => {
                const loc = locOptions.find((o) => o.value === newLoc);
                if (!loc || !newWh) return;
                setForm((f) => ({
                  ...f,
                  mappings: [
                    ...f.mappings,
                    {
                      channelLocationId: loc.value,
                      channelLocationName: String(loc.label),
                      warehouseId: newWh,
                    },
                  ],
                }));
                setNewLoc(null);
                setNewWh(null);
                setErrors({});
              }}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
          {err('mappings')}
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-2xs text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Store location</th>
                  <th className="px-3 py-2 text-left">Warehouse</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {form.mappings.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-faint">
                      No locations linked yet.
                    </td>
                  </tr>
                ) : (
                  form.mappings.map((m) => (
                    <tr key={m.channelLocationId}>
                      <td className="px-3 py-2">{m.channelLocationName}</td>
                      <td className="px-3 py-2 font-medium">{wh(m.warehouseId)}</td>
                      <td className="px-2 py-1 text-right">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${m.channelLocationName}`}
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              mappings: f.mappings.filter((x) => x.channelLocationId !== m.channelLocationId),
                            }))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'advanced' ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="es-pay" className="text-xs font-medium text-body">
                Payment status ({st.paymentStatuses.length}) <span className="text-danger">*</span>
              </label>
              <Combobox
                id="es-pay"
                multiple
                aria-label="Payment statuses"
                options={PAYMENT_STATUSES.map((p) => ({ value: p, label: p.replace(/_/g, ' ') }))}
                value={st.paymentStatuses}
                onChange={(v) => setSettings((s) => ({ ...s, paymentStatuses: [...v] }))}
                invalid={Boolean(errors['settings.paymentStatuses'])}
              />
              <p className="text-2xs text-faint">Only orders with these payment statuses are downloaded.</p>
              {err('settings.paymentStatuses')}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="es-tax" className="text-xs font-medium text-body">
                Tax ID mapping
              </label>
              <Select
                id="es-tax"
                value={st.taxIdMapping}
                clearable
                onChange={(v) => setSettings((s) => ({ ...s, taxIdMapping: v }))}
                placeholder="Don't map"
                options={[
                  { value: 'note_attribute:tax_id', label: 'Order note attribute · tax_id' },
                  { value: 'customer_tax_exemption', label: 'Customer tax exemption' },
                  { value: 'billing_company', label: 'Billing company' },
                ]}
              />
            </div>
          </div>
          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Filter orders by order tag</h3>
            <p className="text-xs text-secondary">
              KitStak can download only orders with (or without) these tags. Filtered orders appear in Missing
              Orders as “Order is Blocked by Tag Filter”.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium text-secondary">Filter method</span>
                <SegmentedControl
                  className="w-full [&>button]:flex-1"
                  ariaLabel="Filter method"
                  value={st.tagFilter.method}
                  onChange={(v) => setSettings((s) => ({ ...s, tagFilter: { ...s.tagFilter, method: v } }))}
                  options={[
                    { value: 'Included', label: 'Included order tags' },
                    { value: 'Excluded', label: 'Excluded order tags' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="es-cond" className="text-2xs font-medium text-secondary">
                  Filter condition
                </label>
                <Select
                  id="es-cond"
                  value={st.tagFilter.condition}
                  onChange={(v) =>
                    v && setSettings((s) => ({ ...s, tagFilter: { ...s.tagFilter, condition: v } }))
                  }
                  options={[
                    { value: 'All Following Tags', label: 'All following tags' },
                    { value: 'Any Following Tags', label: 'Any following tags' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <label htmlFor="es-tags" className="text-2xs font-medium text-secondary">
                  Order tags
                </label>
                <ChipInput
                  id="es-tags"
                  value={st.tagFilter.tags}
                  maxItems={50}
                  maxLength={60}
                  caseInsensitive
                  placeholder="Type a tag and press Enter"
                  onChange={(v) =>
                    setSettings((s) => ({ ...s, tagFilter: { ...s.tagFilter, tags: [...v] } }))
                  }
                />
                {st.tagFilter.tags.length === 0 ? (
                  <p className="text-2xs text-faint">No order tag has been added yet, so every tag passes.</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'configuration' ? (
        <div className="flex flex-col gap-4">
          {(st.orders.download || st.inventory.sync || st.shipments.sendShipmentInfo) &&
          form.mappings.length === 0 ? (
            <Callout variant="attention" title="Link a location first">
              Orders, inventory and shipments need at least one store location linked to a warehouse
              (Warehouse tab).
            </Callout>
          ) : null}
          {err('mappings')}
          <Section title="Products" required>
            <Row label="Download products" hint="Creates missing SKUs and links listings.">
              <YesNoToggle
                value={st.products.download}
                onChange={(v) => setSettings((s) => ({ ...s, products: { ...s.products, download: v } }))}
                ariaLabel="Download products"
              />
            </Row>
            <Row label="Product UOM">
              <Select
                value={st.products.uom}
                onChange={(v) => v && setSettings((s) => ({ ...s, products: { ...s.products, uom: v } }))}
                options={PRODUCT_UOMS.map((u) => ({ value: u, label: u }))}
                className="w-40"
              />
            </Row>
            <IntervalRow method="Download Products" form={form} setForm={setForm} />
          </Section>
          <Section title="Orders" required>
            <Row label="Download orders">
              <YesNoToggle
                value={st.orders.download}
                onChange={(v) => setSettings((s) => ({ ...s, orders: { ...s.orders, download: v } }))}
                ariaLabel="Download orders"
              />
            </Row>
            <Row label="Shipment order type">
              <Select
                value={st.orders.shipmentOrderType}
                onChange={(v) =>
                  v && setSettings((s) => ({ ...s, orders: { ...s.orders, shipmentOrderType: v } }))
                }
                options={SHIPMENT_ORDER_TYPES.map((u) => ({ value: u, label: u }))}
                className="w-40"
              />
            </Row>
            <Row
              label="Download open orders from"
              hint={
                st.orders.downloadFrom
                  ? 'Orders updated after this date'
                  : 'Let KitStak decide (since the last successful run)'
              }
            >
              <div className="flex items-center gap-2">
                <SegmentedControl
                  size="sm"
                  ariaLabel="Download from"
                  value={st.orders.downloadFrom ? 'date' : 'auto'}
                  onChange={(v) =>
                    setSettings((s) => ({
                      ...s,
                      orders: {
                        ...s.orders,
                        downloadFrom:
                          v === 'date'
                            ? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
                            : null,
                      },
                    }))
                  }
                  options={[
                    { value: 'auto', label: 'Let KitStak decide' },
                    { value: 'date', label: 'Specific date' },
                  ]}
                />
                {st.orders.downloadFrom ? (
                  <TextField
                    type="date"
                    aria-label="Download from date"
                    value={st.orders.downloadFrom.slice(0, 10)}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        orders: { ...s.orders, downloadFrom: e.target.value || null },
                      }))
                    }
                  />
                ) : null}
              </div>
            </Row>
            <Row
              label="Partial orders"
              hint="Create the order with the SKUs that exist when others are missing."
            >
              <YesNoToggle
                value={st.orders.partialOrders}
                onChange={(v) => setSettings((s) => ({ ...s, orders: { ...s.orders, partialOrders: v } }))}
                ariaLabel="Partial orders"
              />
            </Row>
            <Row label="Create nonexistent products when orders are downloaded">
              <YesNoToggle
                value={st.orders.createNonexistentProducts}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, orders: { ...s.orders, createNonexistentProducts: v } }))
                }
                ariaLabel="Create nonexistent products"
              />
            </Row>
            <Row label="Skip address verification">
              <YesNoToggle
                value={st.orders.skipAddressVerification}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, orders: { ...s.orders, skipAddressVerification: v } }))
                }
                ariaLabel="Skip address verification"
              />
            </Row>
            <IntervalRow method="Download Orders" form={form} setForm={setForm} />
          </Section>
          <Section title="Inventory">
            <Row label="Sync inventory">
              <YesNoToggle
                value={st.inventory.sync}
                onChange={(v) => setSettings((s) => ({ ...s, inventory: { ...s.inventory, sync: v } }))}
                ariaLabel="Sync inventory"
              />
            </Row>
            <Row
              label="Inventory sync method"
              hint="Locations with Prevent inventory sync and Never sync listings are skipped."
            >
              <SegmentedControl
                size="sm"
                ariaLabel="Inventory sync method"
                value={st.inventory.method}
                onChange={(v) => setSettings((s) => ({ ...s, inventory: { ...s.inventory, method: v } }))}
                options={[
                  { value: 'On Hand', label: 'On Hand' },
                  { value: 'Available', label: 'Available' },
                ]}
              />
            </Row>
            <IntervalRow method="Sync Inventory" form={form} setForm={setForm} />
          </Section>
          <Section title="Shipments">
            <Row label="Send shipment info to my store" hint="Pushes tracking numbers for shipped orders.">
              <YesNoToggle
                value={st.shipments.sendShipmentInfo}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, shipments: { ...s.shipments, sendShipmentInfo: v } }))
                }
                ariaLabel="Send shipment info"
              />
            </Row>
            <IntervalRow method="Send Shipment Info" form={form} setForm={setForm} />
          </Section>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-border bg-surface px-1 pt-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={!dirty || saving}
          title={!dirty ? 'No changes to save' : undefined}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function IntervalRow({
  method,
  form,
  setForm,
}: {
  readonly method: (typeof CHANNEL_METHODS)[number];
  readonly form: FormState;
  readonly setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <Row label="Run every" hint={`How often ${method.toLowerCase()} runs while active`}>
      <NumberInput
        aria-label={`${method} interval`}
        value={form.intervals[method] ?? null}
        min={5}
        max={10_080}
        suffix="min"
        className="w-32"
        onChange={(v) => setForm((f) => ({ ...f, intervals: { ...f.intervals, [method]: v ?? 15 } }))}
      />
    </Row>
  );
}
