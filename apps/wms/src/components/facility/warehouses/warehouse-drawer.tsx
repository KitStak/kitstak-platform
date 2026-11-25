'use client';

/**
 * Create / Edit Warehouse drawer: 1. Information (code, prefix, address, contact, day shift
 * with AM/PM, timezone) · 2. Settings (units, volumetric putaway, default receiving / ship /
 * return locations filtered by area type, mandatory reasons, mobile auto-logout).
 */
import * as React from 'react';
import { Building2, SlidersHorizontal } from 'lucide-react';
import { useFormContext, type UseFormReturn } from 'react-hook-form';
import { COUNTRIES, subdivisionsFor } from '@/lib/countries';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import { DIMENSION_UNITS, WAREHOUSE_TYPES, WEIGHT_UNITS } from '@/lib/enums';
import {
  DAY_ZONES,
  STARTER_LOCATION_SUFFIXES as STARTER_SUFFIXES,
  TIMEZONES,
  WAREHOUSE_DEFAULTS,
  WAREHOUSE_INFO_KEYS,
  countryCodeOf,
  normalizeState,
  storedAddressIssues,
  warehouseInfoSchema,
  warehouseSettingsSchema,
  type WarehouseInput,
} from '@/lib/grid-defs/facility/warehouses';
import { ERROR_TOAST_MS } from '@/lib/grid-defs/facility/common';
import { useAvailabilityCheck, useWizardGuard, type WizardGuard } from '@/components/facility/wizard-guard';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { FormGrid, FormSection } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { apiErrorMessage, planLimitAction } from '@/components/facility/facility-shared';
import { Wizard, type WizardStep } from '@/components/ui/wizard';
import {
  CheckboxField,
  ComboField,
  enumSelectOptions,
  NumberField,
  SelectField,
  TextInput,
  YesNoField,
} from '@/components/facility/form-controls';
import { useWarehouseLocationOptions } from '@/components/facility/pickers';
import type { WarehouseDetail } from '@/server/repositories/warehouses';

type F = WarehouseInput;

const TZ_OPTIONS = TIMEZONES.map((t) => ({ value: t, label: t.replace('_', ' ').replace('/', ' / ') }));
const ZONE_OPTIONS = DAY_ZONES.map((z) => ({ value: z, label: z }));

/** United States and Canada first, then A-Z (stored as the ISO country name). */
const COUNTRY_OPTIONS = [
  ...['US', 'CA'].flatMap((code) => COUNTRIES.filter((c) => c.code === code)),
  ...[...COUNTRIES]
    .filter((c) => c.code !== 'US' && c.code !== 'CA')
    .sort((a, b) => a.name.localeCompare(b.name)),
].map((c) => ({ value: c.name, label: c.name }));

function postalPlaceholder(country: string | null | undefined): string {
  const code = countryCodeOf(country);
  return code === 'US' ? '12345 or 12345-6789' : code === 'CA' ? 'A1A 1A1' : 'Postal code';
}

/** State / province: a validated picker for US and CA, free text elsewhere. */
function StateField({ form }: { readonly form: UseFormReturn<F> }) {
  const country = form.watch('country');
  const code = countryCodeOf(country);
  const list = subdivisionsFor(code);
  const state = form.watch('state');
  // Legacy free text ("California") snaps to its canonical code once the list is known.
  React.useEffect(() => {
    if (list.length && state) {
      const canon = normalizeState(country, state);
      if (canon && canon !== state) form.setValue('state', canon, { shouldDirty: false });
    }
  }, [country, state, list.length, form]);
  if (!list.length) return <TextInput<F> name="state" label="State / region" required maxLength={60} />;
  const options = list.map((d) => ({ value: d.code, label: `${d.name} (${d.code})` }));
  return (
    <ComboField<F>
      name="state"
      label={code === 'CA' ? 'Province' : 'State'}
      required
      options={options}
      placeholder={code === 'CA' ? 'Select a province' : 'Select a state'}
    />
  );
}

function InformationStep({ editId, guard }: { readonly editId: string | null; readonly guard: WizardGuard }) {
  const isEdit = Boolean(editId);
  const form = useFormContext<F>();
  useAvailabilityCheck<F>(guard, form, {
    url: '/api/warehouses/availability',
    paths: ['code'],
    params: (v) => (v.code?.trim() ? { code: v.code.trim(), excludeId: editId ?? undefined } : null),
  });
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Identity">
        <FormGrid>
          <TextInput<F>
            name="code"
            label="Code"
            required
            maxLength={20}
            transform={(v) => v.toUpperCase()}
            placeholder="e.g. MLT2"
            info={isEdit ? 'Changing the code updates every label and report that shows it' : undefined}
          />
          <TextInput<F>
            name="name"
            label="Name"
            required
            maxLength={120}
            placeholder="e.g. Memphis Fulfillment"
          />
          <TextInput<F>
            name="prefix"
            label="Prefix"
            required
            maxLength={8}
            transform={(v) => v.toUpperCase()}
            info="Short tag added to codes generated in this warehouse"
          />
          <SelectField<F> name="type" label="Type" required options={enumSelectOptions(WAREHOUSE_TYPES)} />
        </FormGrid>
      </FormSection>
      <FormSection title="Address">
        <FormGrid>
          <TextInput<F>
            name="addressLine"
            label="Address line 1"
            required
            maxLength={250}
            className="md:col-span-2"
          />
          <TextInput<F>
            name="addressLine2"
            label="Address line 2"
            maxLength={250}
            className="md:col-span-2"
          />
          <TextInput<F> name="city" label="City" required maxLength={100} />
          <StateField form={form} />
          <TextInput<F>
            name="postalCode"
            label="Postal code"
            required
            maxLength={20}
            placeholder={postalPlaceholder(form.watch('country'))}
            transform={(v) => v.toUpperCase()}
          />
          <ComboField<F>
            name="country"
            label="Country"
            required
            options={COUNTRY_OPTIONS}
            placeholder="Select a country"
            info="Ship-from address for carrier rating and labels"
            onValueChange={() => form.setValue('state', '', { shouldDirty: true })}
          />
        </FormGrid>
      </FormSection>
      <FormSection title="Contact">
        <FormGrid>
          <TextInput<F> name="contactName" label="Contact name" required maxLength={120} />
          <TextInput<F>
            name="contactPhone"
            label="Contact phone number"
            required
            maxLength={40}
            placeholder="+1 555 123 4567"
            info="E.164 (+15551234567) or national format; 7-15 digits"
          />
          <TextInput<F> name="email" label="Email" maxLength={200} className="md:col-span-2" />
        </FormGrid>
      </FormSection>
      <FormSection title="Day shift" description="Used by the dashboard and end-of-day cut-offs.">
        <div className="grid gap-4 md:grid-cols-[1fr_96px_1fr_96px]">
          <TextInput<F> name="shiftStart" label="Start time" required maxLength={5} placeholder="08:00" />
          <SelectField<F> name="shiftStartZone" label="AM / PM" required options={ZONE_OPTIONS} />
          <TextInput<F> name="shiftEnd" label="End time" required maxLength={5} placeholder="05:00" />
          <SelectField<F> name="shiftEndZone" label="AM / PM" required options={ZONE_OPTIONS} />
        </div>
        <FormGrid className="mt-4">
          <SelectField<F> name="timezone" label="Timezone" required options={TZ_OPTIONS} />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function SettingsStep({
  form,
  warehouseId,
}: {
  readonly form: UseFormReturn<F>;
  readonly warehouseId: string | null;
}) {
  const receiving = useWarehouseLocationOptions(warehouseId, ['Receiving']);
  const ship = useWarehouseLocationOptions(warehouseId, ['Shipment', 'Loading', 'Packing']);
  const returns = useWarehouseLocationOptions(warehouseId, ['Returns', 'Receiving']);
  const autoLogout = form.watch('mobileAutoLogout');
  const createStarter = form.watch('createStarterLocations');
  const prefix = (form.watch('prefix') ?? '').trim().toUpperCase();
  const starter = prefix ? STARTER_SUFFIXES.map((s) => `${prefix}-${s}`) : [];
  const locPlaceholder = (o: { options: readonly unknown[]; loading: boolean }, what: string) =>
    !warehouseId
      ? 'Available after the warehouse is created'
      : o.loading
        ? 'Loading…'
        : o.options.length
          ? 'Select location'
          : `No ${what} locations yet`;
  return (
    <div className="flex flex-col gap-5">
      <FormSection title="Units">
        <FormGrid>
          <SelectField<F>
            name="defaultDimensionUnit"
            label="Default dimension unit"
            required
            options={enumSelectOptions(DIMENSION_UNITS)}
          />
          <SelectField<F>
            name="defaultWeightUnit"
            label="Default weight unit"
            required
            options={enumSelectOptions(WEIGHT_UNITS)}
          />
          <YesNoField<F>
            name="useLpDimsForPutaway"
            label="Use LP dimensions for volumetric putaway"
            info="Putaway suggestions check the LP's volume against the location's free volume"
          />
        </FormGrid>
      </FormSection>
      <FormSection
        title="Default locations"
        description="Pre-filled when receiving, shipping and processing returns. Only locations of the matching area type are listed."
      >
        {!warehouseId ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-3">
            <CheckboxField<F>
              name="createStarterLocations"
              label="Create starter locations and use them as defaults"
              hint={
                starter.length
                  ? `Adds ${starter.join(', ')} (receiving, packing, shipment and returns stations).`
                  : 'Enter a prefix on the Information step to see the codes.'
              }
            />
            {!createStarter ? (
              <p className="text-xs text-secondary">
                A new warehouse has no locations yet: add them after it’s created, then pick the defaults
                below from Edit warehouse.
              </p>
            ) : null}
          </div>
        ) : null}
        {/* Logiwa always shows the three pickers; in create mode without starter locations they are visible but disabled. */}
        {warehouseId || !createStarter ? (
          <FormGrid>
            <SelectField<F>
              name="defaultReceivingLocationId"
              label="Default receiving location"
              options={receiving.options}
              clearable
              disabled={!warehouseId}
              placeholder={locPlaceholder(receiving, 'Receiving')}
            />
            <SelectField<F>
              name="defaultShipLocationId"
              label="Default ship location"
              options={ship.options}
              clearable
              disabled={!warehouseId}
              placeholder={locPlaceholder(ship, 'Shipment')}
            />
            <SelectField<F>
              name="defaultReturnLocationId"
              label="Default return location"
              options={returns.options}
              clearable
              disabled={!warehouseId}
              placeholder={locPlaceholder(returns, 'Returns')}
            />
          </FormGrid>
        ) : starter.length ? (
          <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            {[
              ['Default receiving location', `${prefix}-RECV`],
              ['Default ship location', `${prefix}-SHIP`],
              ['Default return location', `${prefix}-RET`],
            ].map(([label, code]) => (
              <div key={label} className="rounded-md border border-border bg-surface px-3 py-2">
                <dt className="text-faint">{label}</dt>
                <dd className="mt-0.5 font-mono text-foreground">{code ?? 'None'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </FormSection>
      <FormSection title="Mandatory reasons">
        <FormGrid>
          <YesNoField<F>
            name="mandatoryAdjustmentReason"
            label="Adjustment reason required"
            info="Inventory adjustments must pick a reason"
          />
          <YesNoField<F>
            name="mandatoryCountReason"
            label="Count difference reason required"
            info="Count updates with a difference must pick a reason"
          />
        </FormGrid>
      </FormSection>
      <FormSection title="Mobile">
        <FormGrid>
          <YesNoField<F> name="mobileAutoLogout" label="Auto logout inactive mobile users" />
          <NumberField<F>
            name="mobileAutoLogoutMinutes"
            label="Inactivity timeout (minutes)"
            min={1}
            max={720}
            nullable
            disabled={!autoLogout}
            required={Boolean(autoLogout)}
          />
        </FormGrid>
      </FormSection>
    </div>
  );
}

export function detailToWarehouseForm(d: WarehouseDetail): F {
  return {
    code: d.code,
    name: d.name,
    prefix: d.prefix,
    type: d.type,
    addressLine: d.addressLine,
    addressLine2: d.addressLine2 ?? '',
    postalCode: d.postalCode ?? '',
    city: d.city,
    state: d.state,
    country: COUNTRIES.find((c) => c.code === countryCodeOf(d.country))?.name ?? d.country,
    contactName: d.contactName ?? '',
    contactPhone: d.contactPhone ?? '',
    email: d.email ?? '',
    shiftStart: d.shiftStart,
    shiftStartZone: d.shiftStartZone,
    shiftEnd: d.shiftEnd,
    shiftEndZone: d.shiftEndZone,
    timezone: (TIMEZONES as readonly string[]).includes(d.timezone)
      ? (d.timezone as F['timezone'])
      : 'America/Chicago',
    defaultDimensionUnit: d.defaultDimensionUnit as F['defaultDimensionUnit'],
    defaultWeightUnit: d.defaultWeightUnit as F['defaultWeightUnit'],
    useLpDimsForPutaway: d.useLpDimsForPutaway,
    defaultReceivingLocationId: d.defaultReceivingLocationId,
    defaultShipLocationId: d.defaultShipLocationId,
    defaultReturnLocationId: d.defaultReturnLocationId,
    mandatoryAdjustmentReason: d.mandatoryAdjustmentReason,
    mandatoryCountReason: d.mandatoryCountReason,
    mobileAutoLogout: d.mobileAutoLogout,
    mobileAutoLogoutMinutes: d.mobileAutoLogoutMinutes ?? 30,
  };
}

function Body({
  initial,
  editId,
  version,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  readonly initial: F;
  readonly editId: string | null;
  readonly version?: number;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onDirtyChange: (d: boolean) => void;
}) {
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [planLimit, setPlanLimit] = React.useState<{ message: string; href: string | null } | null>(null);
  const guard = useWizardGuard();
  const steps = React.useMemo<readonly WizardStep<F>[]>(
    () => [
      {
        key: 'information',
        label: 'Information',
        icon: Building2,
        schema: guard.guard(warehouseInfoSchema, (p) => WAREHOUSE_INFO_KEYS.has(p.split('.')[0] ?? p)),
        render: ({ form }) => {
          formRef.current = form;
          return <InformationStep editId={editId} guard={guard} />;
        },
      },
      {
        key: 'settings',
        label: 'Settings',
        icon: SlidersHorizontal,
        schema: guard.guard(warehouseSettingsSchema, (p) => !WAREHOUSE_INFO_KEYS.has(p.split('.')[0] ?? p)),
        render: ({ form }) => {
          formRef.current = form;
          return <SettingsStep form={form} warehouseId={editId} />;
        },
      },
      // `guard` is stable for the life of the body.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [editId],
  );
  const submit = async (values: F) => {
    guard.dismissBanner();
    try {
      const { data } = await apiRequest<{ code: string; starterLocations?: string[] }>(
        editId ? `/api/warehouses/${editId}` : '/api/warehouses',
        { method: editId ? 'PATCH' : 'POST', body: { ...values, version } },
      );
      const starter = data.starterLocations ?? [];
      toast.success(
        'Success',
        editId
          ? `Warehouse ${data.code} updated.`
          : starter.length
            ? `Warehouse ${data.code} created with ${starter.join(', ')} as its receiving, packing, ship and return locations.`
            : `Warehouse ${data.code} created. Add its locations next.`,
      );
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      // One more warehouse than the plan covers: keep the sentence and the next step on screen.
      setPlanLimit(
        isApiError(error) && error.code === 'PLAN_WAREHOUSE_LIMIT'
          ? { message: error.message, href: error.planUrl ?? null }
          : null,
      );
      const routed = guard.handleServerError(error, values);
      if (!routed && formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the warehouse", apiErrorMessage(error), {
        duration: ERROR_TOAST_MS,
        action: planLimitAction(error),
      });
      throw error;
    }
  };
  return (
    <div ref={guard.rootRef} className="flex flex-col gap-3">
      {conflict ? (
        <Callout
          variant="attention"
          title="This warehouse changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Someone else saved this warehouse. Reload to see their changes.
        </Callout>
      ) : null}
      {planLimit ? (
        <Callout
          variant="attention"
          title="This warehouse is not in your plan yet"
          action={
            planLimit.href ? (
              <Button size="sm" data-testid="plan-warehouse-add" onClick={() => window.location.assign(planLimit.href ?? '/')}>
                Add to my plan
              </Button>
            ) : undefined
          }
        >
          {planLimit.message}
        </Callout>
      ) : null}
      {guard.banner && !conflict && !planLimit ? (
        <Callout variant="error" title="Couldn't save the warehouse" onDismiss={guard.dismissBanner}>
          {guard.banner}
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
        submitLabel={editId ? 'Save' : 'Create warehouse'}
        onCancel={onCancel}
        onComplete={submit}
      />
    </div>
  );
}

export function WarehouseDrawer({
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
  const [dirty, setDirty] = React.useState(false);
  const detail = useApiQuery<WarehouseDetail>(
    ['warehouse', editId ?? ''],
    open && editId ? `/api/warehouses/${editId}` : null,
    { staleTime: 0 },
  );
  const close = () => {
    setDirty(false);
    onOpenChange(false);
  };
  const initial = editId
    ? detail.data
      ? detailToWarehouseForm(detail.data.data)
      : null
    : WAREHOUSE_DEFAULTS;
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(o) : close())}
      dirty={dirty}
      width={60}
      bodyClassName="pb-0"
      title={editId ? `Edit warehouse ${detail.data?.data.code ?? ''}`.trim() : 'Create warehouse'}
    >
      {editId && detail.isError ? (
        <EmptyState
          title="Couldn't load this warehouse"
          description={detail.error.message}
          action={<Button onClick={() => void detail.refetch()}>Retry</Button>}
        />
      ) : !initial ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {editId && detail.data && storedAddressIssues(detail.data.data).length ? (
            <Callout variant="attention" title="Fix this warehouse's stored address before saving">
              <ul className="list-disc pl-4">
                {storedAddressIssues(detail.data.data).map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Callout>
          ) : null}
          <Body
            key={`${editId ?? 'new'}-${detail.dataUpdatedAt}`}
            initial={initial}
            editId={editId}
            version={detail.data?.data.version}
            onDirtyChange={setDirty}
            onCancel={close}
            onDone={() => {
              setDirty(false);
              onSaved();
              onOpenChange(false);
            }}
          />
        </>
      )}
    </Drawer>
  );
}
