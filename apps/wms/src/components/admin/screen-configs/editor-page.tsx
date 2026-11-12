'use client';

/**
 * Create / Edit Receiving screen configuration (tabs General · Conditions · Configuration).
 * Left: the form; right: a mobile preview canvas that redraws the receiving screen from the
 * live step toggles. Create is linear (Next validates each tab, Back keeps values); edit is
 * free navigation with Save on every tab and the 409 Reload prompt.
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Filter, ListChecks, Settings2 } from 'lucide-react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  conditionSentence,
  conditionsSchema,
  RECEIVING_STEPS,
  screenConfigDefaults,
  screenGeneralSchema,
  stepSchema,
  type ScreenConfigFormValues,
} from '@/lib/grid-defs/admin/screen-configs';
import type { ScreenConfigDetail } from '@/server/repositories/screen-configs';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormGrid, FormSection } from '@/components/ui/form';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { Wizard, type WizardStep } from '@/components/ui/wizard';
import { z } from 'zod';
import { SelectField, TextInput, YesNoField } from '../form-controls';
import { useScreenConfigOptions, type ScreenConfigOptions } from './list-page';
import { MobilePreview } from './mobile-preview';

type F = ScreenConfigFormValues;
const LIST = '/settings/screen-configuration/receiving';

function GeneralTab({ options }: { readonly options: ScreenConfigOptions }) {
  return (
    <FormSection
      title="Configuration details"
      description="Where this configuration applies and what it is called."
    >
      <FormGrid columns={1}>
        <SelectField<F>
          name="warehouseId"
          label="Warehouse"
          required
          options={options.warehouses.map((w) => ({ value: w.id, label: w.name }))}
        />
        <TextInput<F>
          name="name"
          label="Configuration name"
          required
          maxLength={80}
          placeholder="e.g. Lot-tracked inbound"
        />
        <YesNoField<F>
          name="isActive"
          label="Active"
          info="Inactive configurations are ignored by the receiving screen"
        />
      </FormGrid>
    </FormSection>
  );
}

function Token({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
      {children}
    </span>
  );
}

function ConditionsTab({
  form,
  options,
}: {
  readonly form: UseFormReturn<F>;
  readonly options: ScreenConfigOptions;
}) {
  const cond = useWatch({ control: form.control, name: 'conditions' });
  const name = useWatch({ control: form.control, name: 'name' });
  const join = cond?.join ?? 'And';
  const clientName = (id: string) => options.clients.find((c) => c.id === id)?.name ?? 'Unknown client';
  const vendorName = (id: string) => options.vendors.find((v) => v.id === id)?.name ?? 'Unknown vendor';
  const clientIds = cond?.clientIds ?? [];
  const vendorChoices = options.vendors.filter(
    (v) => clientIds.length === 0 || join === 'Or' || clientIds.includes(v.clientId),
  );
  const sentence = conditionSentence(
    { join },
    {
      clients: clientIds.map(clientName),
      poTypes: cond?.poTypes ?? [],
      vendors: (cond?.vendorIds ?? []).map(vendorName),
    },
  );
  const row = (label: React.ReactNode, body: React.ReactNode) => (
    <div className="grid grid-cols-[88px_1fr] items-start gap-3 py-2.5">
      <span className="pt-1.5 text-xs font-bold text-secondary">{label}</span>
      <div className="min-w-0">{body}</div>
    </div>
  );
  return (
    <FormSection
      title="Rule"
      description="Select conditions for specific scenarios; if none are selected, the configuration applies to all purchase orders."
    >
      <div className="divide-y divide-border rounded-lg border border-border bg-surface px-4">
        {row('When', <Token>Operation starting</Token>)}
        {row('If', <Token>The selected purchase order is</Token>)}
        {row(
          <SegmentedControl
            size="sm"
            ariaLabel="Join conditions with"
            value={join}
            onChange={(v) => form.setValue('conditions.join', v, { shouldDirty: true })}
            options={[
              { value: 'And', label: 'And' },
              { value: 'Or', label: 'Or' },
            ]}
          />,
          <div className="flex flex-col gap-3">
            <FormField<F> name="conditions.clientIds" label="Client">
              {(c) => (
                <Combobox
                  id={c.id}
                  multiple
                  aria-label="Client"
                  value={(c.value as string[] | undefined) ?? []}
                  onChange={(v) => c.onChange([...v])}
                  options={options.clients.map((cl) => ({
                    value: cl.id,
                    label: cl.name,
                    description: cl.code,
                  }))}
                  placeholder="Any client"
                />
              )}
            </FormField>
            <FormField<F> name="conditions.poTypes" label="PO type">
              {(c) => (
                <Combobox
                  id={c.id}
                  multiple
                  aria-label="PO type"
                  value={(c.value as string[] | undefined) ?? []}
                  onChange={(v) => c.onChange([...v])}
                  options={options.poTypes.map((t) => ({ value: t, label: t }))}
                  placeholder="Any PO type"
                />
              )}
            </FormField>
            <FormField<F> name="conditions.vendorIds" label="Vendor">
              {(c) => (
                <Combobox
                  id={c.id}
                  multiple
                  aria-label="Vendor"
                  value={(c.value as string[] | undefined) ?? []}
                  onChange={(v) => c.onChange([...v])}
                  options={vendorChoices.map((v) => ({
                    value: v.id,
                    label: v.name,
                    description: clientName(v.clientId),
                  }))}
                  placeholder="Any vendor"
                  emptyText="No vendors for the selected clients"
                />
              )}
            </FormField>
          </div>,
        )}
        {row('Use', <Token>{name?.trim() || 'This configuration'}</Token>)}
      </div>
      <p className="mt-2 rounded-md bg-surface-sunken px-3 py-2 text-xs text-body">
        <span className="font-semibold">Applies to:</span> {sentence}
      </p>
    </FormSection>
  );
}

function ConfigurationTab({ form }: { readonly form: UseFormReturn<F> }) {
  const steps = useWatch({ control: form.control, name: 'steps' }) ?? [];
  const update = (key: string, patch: Partial<{ enabled: boolean; required: boolean }>) => {
    form.setValue(
      'steps',
      steps.map((s) => {
        if (s.key !== key) return s;
        const next = { ...s, ...patch };
        return { ...next, required: next.enabled ? next.required : false };
      }),
      { shouldDirty: true, shouldValidate: true },
    );
  };
  const err = form.formState.errors.steps;
  return (
    <FormSection
      title="Receiving steps"
      description="Choose which steps the mobile receiving screen shows and which ones the operator can't skip."
    >
      {err ? (
        <Callout variant="error" title="Check the steps">
          {err.message ?? err.root?.message ?? 'Switch on at least one step'}
        </Callout>
      ) : null}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {RECEIVING_STEPS.map((def) => {
          const s = steps.find((x) => x.key === def.key) ?? { key: def.key, enabled: false, required: false };
          return (
            <li
              key={def.key}
              className={cn('flex items-center gap-3 px-3 py-2.5', !s.enabled && 'bg-surface-sunken/50')}
            >
              <span className="min-w-0 flex-1">
                <span
                  className={cn('block text-sm font-medium', s.enabled ? 'text-foreground' : 'text-faint')}
                >
                  {def.label}
                </span>
                <span className="block text-xs text-secondary">{def.description}</span>
              </span>
              {def.canBeOptional ? (
                <label
                  className={cn('flex items-center gap-1.5 text-xs', s.enabled ? 'text-body' : 'text-faint')}
                >
                  <Switch
                    aria-label={`${def.label} required`}
                    checked={s.required}
                    disabled={!s.enabled}
                    onCheckedChange={(v) => update(def.key, { required: v === true })}
                  />
                  Required
                </label>
              ) : null}
              <label className="flex items-center gap-1.5 text-xs text-body">
                <Switch
                  aria-label={`Show ${def.label}`}
                  checked={s.enabled}
                  onCheckedChange={(v) => update(def.key, { enabled: v === true })}
                />
                Show
              </label>
            </li>
          );
        })}
      </ul>
    </FormSection>
  );
}

const stepsTabSchema = z.object({
  steps: z.array(stepSchema).refine((a) => a.some((s) => s.enabled), 'Switch on at least one step'),
});

function Frame({ form, children }: { readonly form: UseFormReturn<F>; readonly children: React.ReactNode }) {
  const steps = useWatch({ control: form.control, name: 'steps' }) ?? [];
  const name = useWatch({ control: form.control, name: 'name' });
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(320px,440px)_1fr]">
      <div className="min-w-0">{children}</div>
      <MobilePreview steps={steps} title={name?.trim() || 'Receiving'} />
    </div>
  );
}

export function detailToForm(d: ScreenConfigDetail): F {
  return {
    warehouseId: d.warehouseId,
    name: d.name,
    isActive: d.isActive,
    operationType: 'Receiving',
    conditions: { ...d.conditions },
    steps: d.steps.map((s) => ({ ...s })),
    version: d.version,
  };
}

function Body({
  initial,
  detail,
  options,
}: {
  readonly initial: F;
  readonly detail: ScreenConfigDetail | null;
  readonly options: ScreenConfigOptions;
}) {
  const router = useRouter();
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const steps = React.useMemo<readonly WizardStep<F>[]>(
    () => [
      {
        key: 'general',
        label: 'General',
        icon: Settings2,
        schema: screenGeneralSchema,
        render: ({ form }) => {
          formRef.current = form;
          return (
            <Frame form={form}>
              <GeneralTab options={options} />
            </Frame>
          );
        },
      },
      {
        key: 'conditions',
        label: 'Conditions',
        icon: Filter,
        schema: z.object({ conditions: conditionsSchema }),
        render: ({ form }) => {
          formRef.current = form;
          return (
            <Frame form={form}>
              <ConditionsTab form={form} options={options} />
            </Frame>
          );
        },
      },
      {
        key: 'configuration',
        label: 'Configuration',
        icon: ListChecks,
        schema: stepsTabSchema,
        render: ({ form }) => {
          formRef.current = form;
          return (
            <Frame form={form}>
              <ConfigurationTab form={form} />
            </Frame>
          );
        },
      },
    ],
    [options],
  );
  const submit = async (values: F) => {
    try {
      const body = { ...values, version: detail?.version };
      if (detail) {
        await apiRequest(`/api/screen-configs/${detail.id}`, { method: 'PATCH', body });
        toast.success('Configuration saved', `${values.name} was updated.`);
      } else {
        const { data } = await apiRequest<{ id: string; name: string }>('/api/screen-configs', {
          method: 'POST',
          body,
        });
        toast.success('Configuration created', `${data.name} is ready for receiving.`);
      }
      router.push(LIST);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error(
        "Couldn't save the configuration",
        isApiError(error) ? error.message : 'Something went wrong',
      );
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 lg:px-6">
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
          Someone else saved this configuration. Reload to see their changes.
        </Callout>
      ) : null}
      <Wizard<F>
        steps={steps}
        variant="page"
        mode={detail ? 'free' : 'linear'}
        defaultValues={initial}
        draftScope={false}
        submitLabel={detail ? 'Save' : 'Save configuration'}
        onCancel={() => router.push(LIST)}
        onComplete={submit}
      />
    </div>
  );
}

export function ScreenConfigEditorPage({ editId }: { readonly editId: string | null }) {
  const options = useScreenConfigOptions();
  const q = useApiQuery<ScreenConfigDetail>(
    ['screen-config', editId ?? ''],
    editId ? `/api/screen-configs/${editId}` : null,
    { staleTime: 0 },
  );
  const d = q.data?.data ?? null;
  const initial = editId
    ? d
      ? detailToForm(d)
      : null
    : options.loading
      ? null
      : screenConfigDefaults(options.warehouses.length === 1 ? options.warehouses[0]!.id : null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={
          editId ? `Edit receiving configuration${d ? ` · ${d.name}` : ''}` : 'Create receiving configuration'
        }
        breadcrumbs={[
          { label: 'Settings' },
          { label: 'Screen Configuration', href: '/settings/screen-configuration' },
          { label: 'List', href: LIST },
          { label: editId ? 'Edit' : 'Create' },
        ]}
        helper="Choose the warehouse, the purchase orders and the receiving steps."
      />
      {editId && q.isError ? (
        <EmptyState
          title="Couldn't load this configuration"
          description={q.error.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : !initial || options.loading ? (
        <div className="px-6">
          <Skeleton className="h-[480px] w-full" />
        </div>
      ) : (
        <Body key={editId ?? 'new'} initial={initial} detail={d} options={options} />
      )}
    </div>
  );
}
