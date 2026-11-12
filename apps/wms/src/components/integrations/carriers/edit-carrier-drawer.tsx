'use client';

/**
 * Edit carrier connection drawer (spec 06 §7b): General · Clients (all or picklist + per-client
 * markups) · Services (bulk activate/deactivate, toggles) · Packages · Advanced (ship-from address
 * or retailer address, third-party accounts, general markup, label format/size/messages with
 * tokens, international settings, return label).
 */
import * as React from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import type { CarrierSettings } from '@/lib/domain-types';
import { LABEL_FORMATS, MARKUP_TYPES } from '@/lib/enums';
import { LABEL_TOKENS, REFERENCE_TOKENS, editCarrierSchema } from '@/lib/grid-defs/integrations/carriers';
import { maskSecret } from '@/lib/grid-defs/integrations/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer } from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { NumberInput } from '@/components/ui/number-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { UnderlineTabs } from '@/components/ui/tabs';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { SettingYesNo as YesNoToggle } from '@/components/integrations/shared/form-controls';
import { DRAWER_DETAIL_STALE_MS } from '@/components/integrations/shared/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { CarrierConnectionDetail } from '@/server/repositories/carriers';

type Tab = 'general' | 'clients' | 'services' | 'packages' | 'advanced';
type Toggle = { id: string; isActive: boolean };
interface Form {
  setupName: string;
  isActive: boolean;
  environment: 'Test' | 'Production';
  payorAccountNumber: string;
  credentials: Record<string, string>;
  allClients: boolean;
  clients: CarrierConnectionDetail['clients'][number][];
  allServices: boolean;
  services: Toggle[];
  allPackages: boolean;
  packages: Toggle[];
  thirdParty: { accountNumber: string; billingCountry: string; billingZip: string }[];
  settings: CarrierSettings;
}

const toForm = (d: CarrierConnectionDetail): Form => ({
  setupName: d.setupName,
  isActive: d.isActive,
  environment: d.environment,
  payorAccountNumber: d.payorAccountNumber ?? '',
  credentials: {},
  allClients: d.allClients,
  clients: [...d.clients],
  allServices: d.allServices,
  services: d.services.map((x) => ({ id: x.id, isActive: x.isActive })),
  allPackages: d.allPackages,
  packages: d.packages.map((x) => ({ id: x.id, isActive: x.isActive })),
  thirdParty: d.thirdParty.map(({ accountNumber, billingCountry, billingZip }) => ({
    accountNumber,
    billingCountry,
    billingZip,
  })),
  settings: d.settings,
});
const TAB_OF = (k: string): Tab =>
  k.startsWith('clients')
    ? 'clients'
    : k.startsWith('services')
      ? 'services'
      : k.startsWith('packages')
        ? 'packages'
        : k.startsWith('settings') || k.startsWith('thirdParty')
          ? 'advanced'
          : 'general';

function L({
  htmlFor,
  children,
  required,
}: {
  readonly htmlFor?: string;
  readonly children: React.ReactNode;
  readonly required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-body">
      {children}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
  );
}

function ToggleTable({
  title,
  allLabel,
  all,
  onAll,
  rows,
  toggles,
  onChange,
  error,
}: {
  readonly title: string;
  readonly allLabel: string;
  readonly all: boolean;
  readonly onAll: (v: boolean) => void;
  readonly rows: readonly { id: string; carrier: string; name: string; meta?: React.ReactNode }[];
  readonly toggles: readonly Toggle[];
  readonly onChange: (t: Toggle[]) => void;
  readonly error?: string;
}) {
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set());
  const on = new Map(toggles.map((t) => [t.id, t.isActive]));
  const set = (ids: readonly string[], v: boolean) =>
    onChange(toggles.map((t) => (ids.includes(t.id) ? { ...t, isActive: v } : t)));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Checkbox checked={all} onCheckedChange={(v) => onAll(v === true)} label={allLabel} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={all || checked.size === 0}
              title={
                all
                  ? 'Turn off the all option to choose'
                  : checked.size === 0
                    ? 'Tick at least one row'
                    : undefined
              }
            >
              Bulk Actions
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => set([...checked], true)}>Activate selected</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => set([...checked], false)}>Deactivate selected</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-sunken text-2xs text-secondary">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  aria-label={`Select all ${title}`}
                  disabled={all}
                  checked={rows.length > 0 && rows.every((r) => checked.has(r.id))}
                  onCheckedChange={(v) => setChecked(v === true ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="px-3 py-2 text-left">Carrier</th>
              <th className="px-3 py-2 text-left">{title}</th>
              <th className="w-24 px-3 py-2 text-left">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-1.5">
                  <Checkbox
                    aria-label={`Select ${r.name}`}
                    disabled={all}
                    checked={checked.has(r.id)}
                    onCheckedChange={(v) =>
                      setChecked((c) => {
                        const n = new Set(c);
                        if (v === true) n.add(r.id);
                        else n.delete(r.id);
                        return n;
                      })
                    }
                  />
                </td>
                <td className="px-3 py-1.5 text-secondary">{r.carrier}</td>
                <td className="px-3 py-1.5">
                  {r.name}
                  {r.meta}
                </td>
                <td className="px-3 py-1.5">
                  <Switch
                    size="sm"
                    aria-label={`${r.name} active`}
                    disabled={all}
                    checked={all || (on.get(r.id) ?? false)}
                    onCheckedChange={(v) => set([r.id], v === true)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TokenPicker({
  tokens,
  onPick,
}: {
  readonly tokens: readonly string[];
  readonly onPick: (t: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Insert token">
          <Plus className="h-3.5 w-3.5" />
          Token
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-auto">
        {tokens.map((t) => (
          <DropdownMenuItem key={t} onSelect={() => onPick(`{${t}}`)}>
            {t}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DETAIL_KEY = 'carrier-connection';

export function EditCarrierDrawer({
  id,
  onOpenChange,
  onSaved,
}: {
  readonly id: string | null;
  readonly onOpenChange: (o: boolean) => void;
  readonly onSaved: () => void;
}) {
  const qc = useQueryClient();
  const q = useApiQuery<CarrierConnectionDetail>([DETAIL_KEY, id ?? ''], id ? `/api/carriers/${id}` : null, {
    staleTime: DRAWER_DETAIL_STALE_MS,
  });
  const d = q.data?.data;
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
      title={d ? `Edit ${d.setupName}` : 'Edit carrier connection'}
      description={d ? `${d.connectionLabel} · ${d.warehouseCode}` : undefined}
    >
      {q.isPending ? (
        <Skeleton className="h-72 w-full" />
      ) : !d ? (
        <EmptyState
          title="Couldn't load this carrier setup"
          description={q.error?.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : (
        <Body
          key={`${d.id}-${q.dataUpdatedAt}`}
          detail={d}
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
  onDirtyChange,
  onCancel,
  onSaved,
}: {
  readonly detail: CarrierConnectionDetail;
  readonly onDirtyChange: (d: boolean) => void;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}) {
  const [tab, setTab] = React.useState<Tab>('general');
  const [form, setForm] = React.useState<Form>(() => toForm(detail));
  const [baseline] = React.useState(() => JSON.stringify(toForm(detail)));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [newAcct, setNewAcct] = React.useState({ accountNumber: '', billingCountry: 'US', billingZip: '' });
  const dirty = JSON.stringify(form) !== baseline;
  React.useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const st = form.settings;
  const setSt = (fn: (s: CarrierSettings) => CarrierSettings) =>
    setForm((f) => ({ ...f, settings: fn(f.settings) }));
  const sandbox = detail.provider === 'kitstaks-sandbox';
  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-danger">
        {errors[k]}
      </p>
    ) : null;
  const addr = st.shipFrom.address;

  const save = async () => {
    const body = { ...form, version: detail.version };
    const parsed = editCarrierSchema.safeParse(body);
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
      await apiRequest(`/api/carriers/${detail.id}`, { method: 'PATCH', body });
      toast.success('Success', `${form.setupName} saved.`);
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
      toast.error(
        "Couldn't save the carrier setup",
        isApiError(error) ? error.message : 'Something went wrong',
      );
    } finally {
      setSaving(false);
    }
  };
  const count = (t: Tab) =>
    Object.keys(errors).filter((k) => errors[k] && TAB_OF(k) === t).length || undefined;

  return (
    <div className="flex flex-col gap-4">
      {conflict ? (
        <Callout
          variant="attention"
          title="This record changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Reload to see the latest settings.
        </Callout>
      ) : null}
      <UnderlineTabs
        ariaLabel="Carrier setup sections"
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={(['general', 'clients', 'services', 'packages', 'advanced'] as const).map((k) => ({
          key: k,
          label: k[0]?.toUpperCase() + k.slice(1),
          count: count(k),
        }))}
      />
      {tab === 'general' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <L htmlFor="ec-setupName" required>
              Setup name
            </L>
            <TextField
              id="ec-setupName"
              value={form.setupName}
              maxLength={60}
              invalid={Boolean(errors.setupName)}
              onChange={(e) => setForm((f) => ({ ...f, setupName: e.target.value }))}
            />
            {err('setupName')}
          </div>
          <div className="flex flex-col gap-1">
            <L>Warehouse</L>
            <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-secondary">
              {detail.warehouseCode} · locked
            </p>
          </div>
          {detail.credentialFields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <L htmlFor={`ec-cred-${f.key}`}>{f.label}</L>
              <TextField
                id={`ec-cred-${f.key}`}
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={
                  detail.credentialHints[f.key]
                    ? `${maskSecret(detail.credentialHints[f.key])} · leave blank to keep`
                    : 'Not set'
                }
                value={form.credentials[f.key] ?? ''}
                invalid={Boolean(errors[`credentials.${f.key}`])}
                onChange={(e) =>
                  setForm((x) => ({ ...x, credentials: { ...x.credentials, [f.key]: e.target.value } }))
                }
              />
              {err(`credentials.${f.key}`)}
            </div>
          ))}
          {!sandbox ? (
            <div className="flex flex-col gap-1">
              <L htmlFor="ec-payor">Payor account number</L>
              <TextField
                id="ec-payor"
                value={form.payorAccountNumber}
                maxLength={40}
                onChange={(e) => setForm((f) => ({ ...f, payorAccountNumber: e.target.value }))}
              />
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <L>Active</L>
            <YesNoToggle
              value={form.isActive}
              onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              ariaLabel="Active"
            />
          </div>
          {!sandbox ? (
            <div className="flex flex-col gap-1">
              <L>Environment</L>
              <SegmentedControl
                className="w-full [&>button]:flex-1"
                ariaLabel="Environment"
                value={form.environment}
                onChange={(v) => setForm((f) => ({ ...f, environment: v }))}
                options={[
                  { value: 'Test', label: 'Test' },
                  { value: 'Production', label: 'Production' },
                ]}
              />
              <p className="text-2xs text-faint">
                {form.environment === 'Test'
                  ? 'Requests are validated like the carrier; labels and rates are sandbox.'
                  : 'Live carrier API. Credentials are checked when you save.'}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {tab === 'clients' ? (
        <div className="flex flex-col gap-3">
          <Checkbox
            checked={form.allClients}
            onCheckedChange={(v) => setForm((f) => ({ ...f, allClients: v === true }))}
            label="Give access to all existing and future clients."
          />
          {err('clients')}
          <p className="text-xs text-secondary">
            Client markups apply on top of carrier rates and take priority over the general markup (Advanced).
          </p>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-sunken text-2xs text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="w-24 px-3 py-2 text-left">Access</th>
                  <th className="w-40 px-3 py-2 text-left">Markup type</th>
                  <th className="w-36 px-3 py-2 text-left">Markup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {form.clients.map((c, i) => (
                  <tr key={c.clientId}>
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{c.code}</span>{' '}
                      <span className="text-secondary">{c.name}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <Switch
                        size="sm"
                        aria-label={`${c.name} access`}
                        disabled={form.allClients}
                        checked={form.allClients || c.hasAccess}
                        onCheckedChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            clients: f.clients.map((x, j) => (j === i ? { ...x, hasAccess: v === true } : x)),
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Select
                        size="sm"
                        value={c.markupType}
                        clearable
                        placeholder="No markup"
                        options={MARKUP_TYPES.map((m) => ({ value: m, label: m }))}
                        onChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            clients: f.clients.map((x, j) =>
                              j === i
                                ? { ...x, markupType: v, markupAmount: v ? (x.markupAmount ?? 0) : null }
                                : x,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <NumberInput
                        size="sm"
                        aria-label={`${c.name} markup`}
                        value={c.markupAmount}
                        disabled={!c.markupType}
                        decimals={2}
                        suffix={c.markupType === 'Percentage' ? '%' : c.markupType ? 'USD' : undefined}
                        invalid={Boolean(errors[`clients.${i}.markupAmount`])}
                        onChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            clients: f.clients.map((x, j) => (j === i ? { ...x, markupAmount: v } : x)),
                          }))
                        }
                      />
                      {err(`clients.${i}.markupAmount`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {tab === 'services' ? (
        <ToggleTable
          title="Shipping service"
          allLabel="Give access to all existing and future services"
          all={form.allServices}
          onAll={(v) => setForm((f) => ({ ...f, allServices: v }))}
          error={errors.services}
          rows={detail.services.map((x) => ({
            id: x.id,
            carrier: x.carrierCode,
            name: x.name,
            meta: (
              <span className="ml-2 text-2xs text-faint">
                {x.transitDays}d{x.isInternational ? ' · Intl' : ''}
                {x.presetCount > 0 ? ` · in ${x.presetCount} preset(s)` : ''}
              </span>
            ),
          }))}
          toggles={form.services}
          onChange={(services) => setForm((f) => ({ ...f, services }))}
        />
      ) : null}
      {tab === 'packages' ? (
        <ToggleTable
          title="Package"
          allLabel="Give access to all existing and future packages"
          all={form.allPackages}
          onAll={(v) => setForm((f) => ({ ...f, allPackages: v }))}
          rows={detail.packages.map((x) => ({
            id: x.id,
            carrier: detail.provider === 'kitstaks-sandbox' ? 'KS' : detail.provider,
            name: x.name,
          }))}
          toggles={form.packages}
          onChange={(packages) => setForm((f) => ({ ...f, packages }))}
        />
      ) : null}
      {tab === 'advanced' ? (
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Ship from address</h3>
            <Checkbox
              className="mt-2"
              checked={st.shipFrom.useRetailerAddress}
              onCheckedChange={(v) =>
                setSt((s) => ({ ...s, shipFrom: { ...s.shipFrom, useRetailerAddress: v === true } }))
              }
              label="Use the order's retailer address as the ship from address"
            />
            {!st.shipFrom.useRetailerAddress ? (
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {(
                  [
                    ['companyName', 'Company'],
                    ['line1', 'Address line 1'],
                    ['line2', 'Address line 2'],
                    ['city', 'City'],
                    ['state', 'State'],
                    ['postalCode', 'Zip'],
                    ['country', 'Country'],
                    ['firstName', 'Contact name'],
                    ['phone', 'Phone'],
                  ] as const
                ).map(([k, label]) => (
                  <div key={k} className="flex flex-col gap-1">
                    <L
                      htmlFor={`ec-from-${k}`}
                      required={
                        Boolean(addr) &&
                        (k === 'line1' || k === 'city' || k === 'postalCode' || k === 'country')
                      }
                    >
                      {label}
                    </L>
                    <TextField
                      id={`ec-from-${k}`}
                      size="sm"
                      value={(addr?.[k] as string | undefined) ?? ''}
                      invalid={Boolean(errors[`settings.shipFrom.address.${k}`])}
                      onChange={(e) =>
                        setSt((s) => ({
                          ...s,
                          shipFrom: {
                            ...s.shipFrom,
                            address: {
                              line1: '',
                              city: '',
                              postalCode: '',
                              country: 'United States',
                              ...(s.shipFrom.address ?? {}),
                              [k]: e.target.value,
                            },
                          },
                        }))
                      }
                    />
                    {err(`settings.shipFrom.address.${k}`)}
                  </div>
                ))}
                <p className="text-2xs text-faint md:col-span-3">
                  Leave empty to use the warehouse address; once you enter one, address line 1, city, zip and
                  country are required. Carriers such as UPS reject phone numbers under 10 digits.
                </p>
              </div>
            ) : null}
          </section>
          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Third party accounts</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <TextField
                size="sm"
                aria-label="Account number"
                placeholder="Account number"
                value={newAcct.accountNumber}
                onChange={(e) => setNewAcct((a) => ({ ...a, accountNumber: e.target.value }))}
              />
              <TextField
                size="sm"
                aria-label="Billing country"
                placeholder="Country"
                value={newAcct.billingCountry}
                onChange={(e) => setNewAcct((a) => ({ ...a, billingCountry: e.target.value }))}
                wrapperClassName="w-24"
              />
              <TextField
                size="sm"
                aria-label="Billing zip"
                placeholder="Zip"
                value={newAcct.billingZip}
                onChange={(e) => setNewAcct((a) => ({ ...a, billingZip: e.target.value }))}
                wrapperClassName="w-28"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!newAcct.accountNumber.trim() || !newAcct.billingZip.trim()}
                title="Enter the account number and billing zip"
                onClick={() => {
                  setForm((f) => ({ ...f, thirdParty: [...f.thirdParty, { ...newAcct }] }));
                  setNewAcct({ accountNumber: '', billingCountry: 'US', billingZip: '' });
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add account
              </Button>
            </div>
            {form.thirdParty.length > 0 ? (
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {form.thirdParty.map((a, i) => (
                  <li key={`${a.accountNumber}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <span className="flex-1 font-medium">{a.accountNumber}</span>
                    <span className="text-secondary">
                      {a.billingCountry} · {a.billingZip}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${a.accountNumber}`}
                      onClick={() =>
                        setForm((f) => ({ ...f, thirdParty: f.thirdParty.filter((_, j) => j !== i) }))
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-faint">No third party accounts.</p>
            )}
          </section>
          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Markup rate</h3>
            <p className="text-xs text-secondary">
              Set a general markup, or client-based markups on the Clients tab — those take priority.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                size="sm"
                value={st.generalMarkup?.type ?? null}
                clearable
                placeholder="No general markup"
                options={MARKUP_TYPES.map((m) => ({ value: m, label: m }))}
                className="w-48"
                onChange={(v) =>
                  setSt((s) => ({
                    ...s,
                    generalMarkup: v ? { type: v, amount: s.generalMarkup?.amount ?? 0 } : null,
                  }))
                }
              />
              <NumberInput
                size="sm"
                aria-label="Markup amount"
                disabled={!st.generalMarkup}
                value={st.generalMarkup?.amount ?? null}
                decimals={2}
                className="w-36"
                onChange={(v) =>
                  setSt((s) => ({
                    ...s,
                    generalMarkup: s.generalMarkup ? { ...s.generalMarkup, amount: v ?? 0 } : null,
                  }))
                }
              />
            </div>
          </section>
          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Label settings</h3>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <SegmentedControl
                className="w-full [&>button]:flex-1"
                ariaLabel="Label format"
                value={st.label.format}
                onChange={(v) => setSt((s) => ({ ...s, label: { ...s.label, format: v } }))}
                options={LABEL_FORMATS.map((f) => ({ value: f, label: f }))}
              />
              <Select
                size="sm"
                value={st.label.size}
                onChange={(v) => v && setSt((s) => ({ ...s, label: { ...s.label, size: v } }))}
                options={[
                  { value: '4x6', label: '4 × 6 in' },
                  { value: '4x8', label: '4 × 8 in' },
                  { value: '6x4', label: '6 × 4 in' },
                ]}
                className="w-36"
              />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <TextField
                    size="sm"
                    aria-label={`Label message ${i + 1}`}
                    placeholder={`Label message ${i + 1}`}
                    value={st.label.messages[i] ?? ''}
                    maxLength={60}
                    wrapperClassName="flex-1"
                    onChange={(e) =>
                      setSt((s) => {
                        const m = [...s.label.messages];
                        m[i] = e.target.value;
                        return { ...s, label: { ...s.label, messages: m.map((x) => x ?? '').slice(0, 3) } };
                      })
                    }
                  />
                  <TokenPicker
                    tokens={LABEL_TOKENS}
                    onPick={(t) =>
                      setSt((s) => {
                        const m = [...s.label.messages];
                        m[i] = `${m[i] ?? ''}${t}`;
                        return { ...s, label: { ...s.label, messages: m.map((x) => x ?? '').slice(0, 3) } };
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">International settings</h3>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <L>Tax type</L>
                <SegmentedControl
                  className="w-full [&>button]:flex-1"
                  ariaLabel="Tax type"
                  value={st.international.taxType ?? 'EIN'}
                  onChange={(v) =>
                    setSt((s) => ({ ...s, international: { ...s.international, taxType: v } }))
                  }
                  options={[
                    { value: 'EIN', label: 'EIN' },
                    { value: 'DNS', label: 'DNS' },
                    { value: 'FGN', label: 'FGN' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <L htmlFor="ec-taxid">Tax ID</L>
                <TextField
                  id="ec-taxid"
                  size="sm"
                  value={st.international.taxId ?? ''}
                  onChange={(e) =>
                    setSt((s) => ({
                      ...s,
                      international: { ...s.international, taxId: e.target.value || null },
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <L>Use components on commercial invoice</L>
                <YesNoToggle
                  value={st.international.useComponentsOnCommercialInvoice}
                  onChange={(v) =>
                    setSt((s) => ({
                      ...s,
                      international: { ...s.international, useComponentsOnCommercialInvoice: v },
                    }))
                  }
                  ariaLabel="Use components on commercial invoice"
                />
              </div>
              <div className="flex flex-col gap-1">
                <L>Customer reference (invoice number)</L>
                <Select
                  size="sm"
                  value={st.international.customerReferenceInvoice}
                  clearable
                  placeholder="None"
                  options={REFERENCE_TOKENS.map((t) => ({ value: t, label: t }))}
                  onChange={(v) =>
                    setSt((s) => ({
                      ...s,
                      international: { ...s.international, customerReferenceInvoice: v },
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <L>Customer reference (PO number)</L>
                <Select
                  size="sm"
                  value={st.international.customerReferencePo}
                  clearable
                  placeholder="None"
                  options={REFERENCE_TOKENS.map((t) => ({ value: t, label: t }))}
                  onChange={(v) =>
                    setSt((s) => ({ ...s, international: { ...s.international, customerReferencePo: v } }))
                  }
                />
              </div>
            </div>
          </section>
          <section className="rounded-lg border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              Return label settings{' '}
              <Badge size="sm" tone="info">
                NEW
              </Badge>
            </h3>
            <Checkbox
              className="mt-2"
              checked={st.returnLabel.generateWithShippingLabel}
              onCheckedChange={(v) =>
                setSt((s) => ({ ...s, returnLabel: { generateWithShippingLabel: v === true } }))
              }
              label="Generate return label with shipping label"
            />
          </section>
        </div>
      ) : null}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface pt-3">
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
