'use client';

/**
 * Create / Edit Rate Shopping Preset drawer (spec 06 §6): 1 General (warehouse + client locked on
 * edit) · 2 Settings (method cards; Cheapest In Time reveals Transit Time) · 3 Shipment Methods
 * (use all, search, Bulk Activate/Deactivate, per-service toggles from the client's carrier setups).
 */
import * as React from 'react';
import { z } from 'zod';
import { ChevronDown, Clock, Gauge, PiggyBank, Settings2, Truck } from 'lucide-react';
import { useController, type UseFormReturn } from 'react-hook-form';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import {
  METHOD_COPY,
  PRESET_DEFAULTS,
  presetGeneralSchema,
  presetServicesSchema,
  presetSettingsSchema,
  servedClientOptions,
  type PresetSaveInput,
} from '@/lib/grid-defs/integrations/rate-shopping';
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
import { FormGrid, FormSection } from '@/components/ui/form';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { Wizard, type WizardStep } from '@/components/ui/wizard';
import {
  CheckboxField,
  ComboField,
  NumberField,
  TextInput,
} from '@/components/integrations/shared/form-controls';
import { useClientOptions, useWarehouseOptions } from '@/components/integrations/shared/shared';
import type { PresetDetail, PresetService } from '@/server/repositories/rate-shopping';

type F = PresetSaveInput;
const servedList = z.array(z.object({ id: z.string(), serviceCount: z.number() }));

function GeneralStep({ form, isEdit }: { readonly form: UseFormReturn<F>; readonly isEdit: boolean }) {
  const warehouses = useWarehouseOptions();
  const allClients = useClientOptions();
  const warehouseId = form.watch('warehouseId');
  const clientId = form.watch('clientId');
  const servedQ = useApiQuery<unknown>(
    ['rs-clients', warehouseId],
    warehouseId && !isEdit ? '/api/rate-shopping-presets/clients' : null,
    { query: { warehouseId }, staleTime: 30_000 },
  );
  const servedParsed = servedList.safeParse(servedQ.data?.data);
  const { options: clients, hidden } = servedClientOptions(
    allClients,
    servedParsed.success ? servedParsed.data : null,
    clientId,
  );
  // Clear a client the newly chosen warehouse doesn't serve.
  React.useEffect(() => {
    if (isEdit || !servedParsed.success || !clientId) return;
    if (!servedParsed.data.some((c) => c.id === clientId))
      form.setValue('clientId', '', { shouldDirty: true });
  }, [isEdit, servedParsed.success, servedParsed.data, clientId, form]);
  const lock = isEdit ? 'Locked after the preset is created' : undefined;
  const clientDescription = isEdit
    ? undefined
    : !warehouseId
      ? 'Pick a warehouse first.'
      : servedQ.isPending
        ? 'Loading clients served by this warehouse…'
        : servedQ.isError
          ? "Couldn't check which clients this warehouse serves; the server validates on save."
          : clients.length === 0
            ? 'No client has carrier services at this warehouse. Set up a carrier in Carrier Integrations first.'
            : hidden > 0
              ? `${hidden} client${hidden === 1 ? ' is' : 's are'} hidden: no carrier services at this warehouse.`
              : undefined;
  return (
    <FormSection
      title="Preset details"
      description="Warehouse and client decide which carrier services the preset can compare."
    >
      <FormGrid>
        <TextInput<F>
          name="name"
          label="RS preset name"
          required
          maxLength={60}
          showCount
          placeholder="Enter RS preset name"
        />
        <ComboField<F>
          name="warehouseId"
          label="Warehouse"
          required
          options={warehouses.options}
          disabled={isEdit}
          info={lock}
          onValueChange={() => form.setValue('serviceIds', [])}
        />
        <TextInput<F>
          name="description"
          label="Description"
          required
          maxLength={250}
          placeholder="e.g. Cheapest ground option for D2C orders"
          className="md:col-span-2"
        />
        <ComboField<F>
          name="clientId"
          label="Client"
          required
          options={isEdit ? allClients : clients}
          disabled={isEdit || !warehouseId}
          info={lock}
          description={clientDescription}
          emptyText="No client has carrier services at this warehouse"
          onValueChange={() => form.setValue('serviceIds', [])}
        />
        <CheckboxField<F> name="isActive" label="Active" hint="Inactive presets can't be chosen on orders" />
      </FormGrid>
    </FormSection>
  );
}

function SettingsStep({ form }: { readonly form: UseFormReturn<F> }) {
  const method = form.watch('method');
  const { field, fieldState } = useController({ control: form.control, name: 'method' });
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Rate calculation method" description="Select rate calculation method *">
        <RadioCards<NonNullable<F['method']>>
          ariaLabel="Rate calculation method"
          columns={3}
          value={field.value ?? null}
          aria-invalid={Boolean(fieldState.error)}
          onChange={(v) => {
            field.onChange(v);
            if (v !== 'Cheapest In Time') form.setValue('transitDays', null);
          }}
          options={[
            { value: 'Cheapest', title: 'Cheapest', description: METHOD_COPY.Cheapest, icon: PiggyBank },
            { value: 'Fastest', title: 'Fastest', description: METHOD_COPY.Fastest, icon: Gauge },
            {
              value: 'Cheapest In Time',
              title: 'Cheapest In Time',
              description: METHOD_COPY['Cheapest In Time'],
              icon: Clock,
            },
          ]}
        />
        {fieldState.error?.message ? (
          <p role="alert" className="text-xs text-danger">
            {fieldState.error.message}
          </p>
        ) : null}
        {method === 'Cheapest In Time' ? (
          <div className="max-w-xs">
            <NumberField<F>
              name="transitDays"
              label="Transit time (days)"
              required
              min={1}
              max={30}
              nullable
              suffix="days"
            />
          </div>
        ) : null}
      </FormSection>
      <FormSection
        title="Error messages"
        description="Enable to receive error notifications for failed shipments."
      >
        <CheckboxField<F>
          name="showErrors"
          label="Show error message if any shipment method returns an error."
        />
      </FormSection>
    </div>
  );
}

const serviceList = z.array(
  z.object({
    id: z.string(),
    setupName: z.string(),
    connectionId: z.string(),
    provider: z.string(),
    carrierCode: z.string(),
    name: z.string(),
    transitDays: z.number(),
    isInternational: z.boolean(),
    selected: z.boolean(),
  }),
);

function ServicesStep({ form }: { readonly form: UseFormReturn<F> }) {
  const warehouseId = form.watch('warehouseId');
  const clientId = form.watch('clientId');
  const useAll = form.watch('useAllServices');
  const { field, fieldState } = useController({ control: form.control, name: 'serviceIds' });
  const q = useApiQuery<unknown>(
    ['rs-services', warehouseId, clientId],
    warehouseId && clientId ? '/api/rate-shopping-presets/services' : null,
    { query: { warehouseId, clientId }, staleTime: 30_000 },
  );
  const parsed = serviceList.safeParse(q.data?.data);
  const rows: readonly PresetService[] = parsed.success ? parsed.data : [];
  const [search, setSearch] = React.useState('');
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set());
  const on = new Set((field.value ?? []) as string[]);
  const shown = rows.filter((r) =>
    `${r.setupName} ${r.carrierCode} ${r.name}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const set = (ids: readonly string[], value: boolean) => {
    const next = new Set(on);
    for (const id of ids)
      if (value) next.add(id);
      else next.delete(id);
    field.onChange([...next]);
    void form.trigger('serviceIds');
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CheckboxField<F>
          name="useAllServices"
          label="Use all available services."
          hint="New services added to the client's carrier setups are included automatically."
        />
      </div>
      {fieldState.error?.message && !useAll ? (
        <p role="alert" className="text-xs text-danger">
          {fieldState.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <TextField
          aria-label="Search by shipping option"
          placeholder="Search by shipping option"
          size="sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          wrapperClassName="w-64"
        />
        <span className="text-xs text-secondary" aria-live="polite">
          {useAll
            ? q.isPending && warehouseId && clientId
              ? 'All available services'
              : `All ${rows.length} service${rows.length === 1 ? '' : 's'}`
            : q.isPending && warehouseId && clientId
              ? 'Loading services…'
              : `${on.size} of ${rows.length} selected`}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={useAll || checked.size === 0}
              title={
                useAll
                  ? 'Turn off Use all available services to pick options'
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
      {q.isError ? (
        <Callout
          variant="attention"
          title="Couldn't load shipping options"
          action={
            <Button size="sm" onClick={() => void q.refetch()}>
              Retry
            </Button>
          }
        >
          {useAll
            ? 'You can still save: with Use all available services on, the preset compares every service the client has.'
            : 'Retry, or turn on Use all available services to save without a list.'}
        </Callout>
      ) : q.isPending && warehouseId && clientId ? (
        useAll ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-secondary">
            Every active service from the client&apos;s carrier setups at this warehouse is compared. You can
            save now; the list below is only needed to pick services one by one.
          </p>
        ) : (
          <SkeletonTable rows={6} columns={4} />
        )
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={Truck}
          title="No shipping options for this client"
          description="Give the client access to a carrier setup in Carrier Integrations, then come back."
        />
      ) : (
        <div className="max-h-[48vh] overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-surface-sunken text-2xs text-secondary">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    aria-label="Select all shown"
                    disabled={useAll}
                    checked={shown.length > 0 && shown.every((r) => checked.has(r.id))}
                    onCheckedChange={(v) =>
                      setChecked(v === true ? new Set(shown.map((r) => r.id)) : new Set())
                    }
                  />
                </th>
                <th className="px-3 py-2 text-left">Setup name</th>
                <th className="px-3 py-2 text-left">Carrier</th>
                <th className="px-3 py-2 text-left">Shipping option</th>
                <th className="px-3 py-2 text-right">Transit</th>
                <th className="w-20 px-3 py-2 text-left">Select</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-faint">
                    No shipping options match “{search}”
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className={checked.has(r.id) ? 'bg-primary-soft/30' : undefined}>
                    <td className="px-3 py-1.5">
                      <Checkbox
                        aria-label={`Select ${r.name}`}
                        disabled={useAll}
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
                    <td className="px-3 py-1.5 font-medium text-primary">{r.setupName}</td>
                    <td className="px-3 py-1.5 ">{r.carrierCode}</td>
                    <td className="px-3 py-1.5">
                      {r.name}
                      {r.isInternational ? (
                        <Badge size="sm" tone="info" className="ml-1.5">
                          Intl
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-secondary">{r.transitDays}d</td>
                    <td className="px-3 py-1.5">
                      <Switch
                        size="sm"
                        aria-label={`Use ${r.name}`}
                        disabled={useAll}
                        checked={useAll || on.has(r.id)}
                        onCheckedChange={(v) => set([r.id], v === true)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function toForm(d: PresetDetail): F {
  return {
    name: d.name,
    description: d.description,
    warehouseId: d.warehouseId,
    clientId: d.clientId,
    isActive: d.isActive,
    method: d.method,
    transitDays: d.transitDays,
    showErrors: d.showErrors,
    useAllServices: d.useAllServices,
    serviceIds: d.services.filter((s) => s.selected).map((s) => s.id),
  };
}

function Body({
  initial,
  detail,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  readonly initial: F;
  readonly detail: PresetDetail | null;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onDirtyChange: (d: boolean) => void;
}) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const editId = detail?.id ?? null;
  const steps = React.useMemo<readonly WizardStep<F>[]>(
    () => [
      {
        key: 'general',
        label: 'General',
        icon: Settings2,
        schema: presetGeneralSchema,
        render: ({ form }) => {
          formRef.current = form;
          return <GeneralStep form={form} isEdit={Boolean(editId)} />;
        },
      },
      {
        key: 'settings',
        label: 'Settings',
        icon: Gauge,
        schema: presetSettingsSchema,
        render: ({ form }) => {
          formRef.current = form;
          return <SettingsStep form={form} />;
        },
      },
      {
        key: 'methods',
        label: 'Shipment methods',
        icon: Truck,
        schema: presetServicesSchema,
        render: ({ form }) => {
          formRef.current = form;
          return <ServicesStep form={form} />;
        },
      },
    ],
    [editId],
  );
  const submit = async (values: F) => {
    try {
      const { data } = await apiRequest<{ name: string }>(
        editId ? `/api/rate-shopping-presets/${editId}` : '/api/rate-shopping-presets',
        { method: editId ? 'PATCH' : 'POST', body: { ...values, version: detail?.version } },
      );
      toast.success(
        'Success',
        editId ? `Preset ${data.name} saved.` : `Rate shopping preset ${data.name} created.`,
      );
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the preset", isApiError(error) ? error.message : 'Something went wrong');
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {conflict ? (
        <Callout
          variant="attention"
          title="This preset changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Someone else saved this preset. Reload to see their changes.
        </Callout>
      ) : null}
      {detail && detail.openOrders > 0 ? (
        <Callout variant="info">
          {detail.openOrders} open order{detail.openOrders === 1 ? ' uses' : 's use'} this preset; changes
          apply at their next label.
        </Callout>
      ) : null}
      <Wizard<F>
        steps={steps}
        variant="drawer"
        mode={editId ? 'free' : 'linear'}
        defaultValues={initial}
        draftScope={false}
        guardUnsaved={false}
        onDirtyChange={onDirtyChange}
        submitLabel={editId ? 'Save' : 'Save'}
        onCancel={onCancel}
        onComplete={submit}
      />
    </div>
  );
}

export function PresetDrawer({
  open,
  onOpenChange,
  editId,
  onSaved,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly editId: string | null;
  readonly onSaved: () => void;
}) {
  const warehouses = useWarehouseOptions();
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<PresetDetail>(
    ['rs-preset', editId ?? ''],
    open && editId ? `/api/rate-shopping-presets/${editId}` : null,
    { staleTime: 0 },
  );
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };
  const initial = editId
    ? detail.data
      ? toForm(detail.data.data)
      : null
    : { ...PRESET_DEFAULTS, warehouseId: warehouses.defaultId ?? '' };
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(o) : close())}
      dirty={dirty}
      width={60}
      title={
        editId
          ? `Edit rate shopping preset ${detail.data?.data.name ?? ''}`.trim()
          : 'Create rate shopping preset'
      }
      description={
        editId
          ? 'Every step is editable; Save applies all of them.'
          : 'General, settings, then the shipment methods to compare.'
      }
    >
      {editId && detail.isError ? (
        <EmptyState
          title="Couldn't load this preset"
          description={detail.error.message}
          action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
        />
      ) : !initial ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <Body
          key={`${editId ?? 'new'}-${detail.dataUpdatedAt}`}
          initial={initial}
          detail={editId ? (detail.data?.data ?? null) : null}
          onDirtyChange={setDirty}
          onCancel={close}
          onDone={() => {
            setDirty(false);
            onSaved();
            onOpenChange(false);
          }}
        />
      )}
    </Drawer>
  );
}
