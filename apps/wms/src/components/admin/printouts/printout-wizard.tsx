'use client';

/**
 * Create / Edit printout (5 steps: Info · Select template · Designer · Type options · Client
 * access). Create is linear (each step validates on Next and can go back); Edit is free
 * navigation with Save on every step and the 409 Reload prompt.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Info, LayoutTemplate, Palette, SlidersHorizontal, Users2 } from 'lucide-react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, isApiError } from '@/lib/api-client';
import { PRINT_MODES, PRINT_RECORDS_PER_PAGE, PRINTER_TYPES } from '@/lib/enums';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  familyOf,
  printoutClientsStepSchema,
  printoutDefaults,
  printoutDesignStepSchema,
  printoutInfoSchema,
  printoutOptionsSchema,
  PRINTOUTS_GRID_KEY,
  printoutTemplateStepSchema,
  templatesFor,
  typeTitle,
  type PrintoutFormValues,
} from '@/lib/grid-defs/admin/printouts';
import type { PrintoutDetail } from '@/server/repositories/printouts';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormGrid, FormSection } from '@/components/ui/form';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { Wizard, type WizardStep } from '@/components/ui/wizard';
import { AccessGrid } from '../access-grid';
import { useAdminOptions } from '../admin-shared';
import { CheckboxField, NumberField, SelectField, TextInput, YesNoField } from '../form-controls';
import { DesignerStep } from './designer';
import { LayoutThumbnail } from './layout-thumbnail';

type F = PrintoutFormValues;
const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

function InfoStep({ typeKey, isDefault }: { readonly typeKey: string; readonly isDefault: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-sm text-secondary">
        Type{' '}
        <Badge tone="primary" shape="pill">
          {typeTitle(typeKey)}
        </Badge>
        {isDefault ? <Badge tone="warning">Default template</Badge> : null}
      </div>
      <FormSection title="Printout information">
        <FormGrid>
          <TextInput<F>
            name="name"
            label="Name"
            required
            maxLength={80}
            placeholder={`e.g. ${typeTitle(typeKey)} - Retail`}
          />
          <TextInput<F>
            name="description"
            label="Description"
            required
            maxLength={250}
            placeholder="What this template is for"
          />
          <SelectField<F>
            name="recordsPerPage"
            label="Records per page"
            required
            options={opts(PRINT_RECORDS_PER_PAGE)}
            info="Single record prints one record per page; multiple records share pages"
          />
          <SelectField<F>
            name="printMode"
            label="Print mode"
            required
            options={opts(PRINT_MODES)}
            info="Direct print sends to the default printer without a preview"
          />
          <SelectField<F> name="printerType" label="Printer type" required options={opts(PRINTER_TYPES)} />
          <YesNoField<F>
            name="isActive"
            label="Active"
            disabled={isDefault}
            info={
              isDefault
                ? 'The default template must stay active'
                : 'Only active templates appear in print dialogs'
            }
          />
        </FormGrid>
      </FormSection>
    </div>
  );
}

function TemplateStep({ form, typeKey }: { readonly form: UseFormReturn<F>; readonly typeKey: string }) {
  const current = useWatch({ control: form.control, name: 'baseTemplate' });
  const templates = templatesFor(typeKey);
  const choose = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    form.setValue('baseTemplate', key, { shouldDirty: true, shouldValidate: true });
    form.setValue('layout', t.layout(typeKey), { shouldDirty: true });
  };
  return (
    <FormSection title="Select a template" description="Picking another template resets the design.">
      <FormField<F> name="baseTemplate">
        {(c) => (
          <div
            role="radiogroup"
            aria-label="Base template"
            aria-invalid={c.invalid}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {templates.map((t, i) => {
              const firstRetailer =
                t.key.startsWith('retailer-') && !templates[i - 1]?.key.startsWith('retailer-');
              const selected = current === t.key;
              return (
                <React.Fragment key={t.key}>
                  {i === 0 && templates.some((x) => x.key.startsWith('retailer-')) ? (
                    <p className="col-span-full text-2xs font-bold text-faint">Base layouts</p>
                  ) : null}
                  {firstRetailer ? (
                    <p className="col-span-full mt-2 text-2xs font-bold text-faint">
                      Retailer compliant · drop-ship packing lists without prices, with the retailer&apos;s PO
                      barcode and return copy
                    </p>
                  ) : null}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choose(t.key)}
                    className={cn(
                      'flex flex-col gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      selected
                        ? 'border-primary bg-primary-soft/40 ring-1 ring-primary'
                        : 'border-border bg-surface hover:border-border-strong',
                    )}
                  >
                    <span className="flex justify-center rounded-md bg-surface-sunken py-3">
                      <LayoutThumbnail layout={t.layout(typeKey)} />
                    </span>
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <span
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded-full border',
                            selected ? 'border-primary' : 'border-border-strong',
                          )}
                        >
                          {selected ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                        </span>
                        {t.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-secondary">{t.description}</span>
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </FormField>
    </FormSection>
  );
}

function OptionsStep({ typeKey }: { readonly typeKey: string }) {
  const isLabel = familyOf(typeKey) === 'label';
  const isPacking = typeKey === 'packing-list' || typeKey === 'packing-slip';
  const isPicking = typeKey.includes('picking');
  return (
    <FormSection title={`${typeTitle(typeKey)} options`}>
      <FormGrid>
        {isPacking ? (
          <CheckboxField<F>
            name="options.useRetailerPackingList"
            label="Use retailer / store-based packing list"
            hint="For retailer orders, print the retailer's packing list layout grouped by store."
          />
        ) : null}
        {isPicking || !isLabel ? (
          <SelectField<F>
            name="options.groupBy"
            label="Group lines by"
            options={[
              { value: 'none', label: 'No grouping' },
              { value: 'location', label: 'Location' },
              { value: 'sku', label: 'SKU' },
              { value: 'zone', label: 'Location zone' },
            ]}
            info="Groups the lines table into blocks with a subtotal"
          />
        ) : null}
        {isLabel ? (
          <NumberField<F>
            name="options.labelCopies"
            label="Copies per label"
            min={1}
            max={20}
            info="How many copies print for each record"
          />
        ) : null}
      </FormGrid>
    </FormSection>
  );
}

function ClientsStep({ form, isDefault }: { readonly form: UseFormReturn<F>; readonly isDefault: boolean }) {
  const options = useAdminOptions();
  const allClients = useWatch({ control: form.control, name: 'allClients' });
  return (
    <div className="flex flex-col gap-4">
      {isDefault ? (
        <Callout variant="info" title="Default template">
          The default template is always available to every client.
        </Callout>
      ) : null}
      <FormField<F> name="allClients" label="Client access" required>
        {(c) => (
          <RadioCards<'all' | 'manual'>
            ariaLabel="Client access"
            columns={2}
            value={c.value ? 'all' : 'manual'}
            onChange={(v) => !isDefault && c.onChange(v === 'all')}
            options={[
              {
                value: 'all',
                title: 'All clients',
                description: 'Every existing and future client can print with this template.',
                icon: Building2,
              },
              {
                value: 'manual',
                title: 'Select manually',
                description: 'Only the clients you assign can use it.',
                icon: Users2,
                disabled: isDefault,
              },
            ]}
          />
        )}
      </FormField>
      {allClients ? null : (
        <FormField<F> name="clientIds">
          {(c) => (
            <AccessGrid
              items={options.clients.map((cl) => ({ id: cl.id, label: cl.name, description: cl.code }))}
              value={(c.value as string[] | null) ?? []}
              onChange={(ids) => c.onChange(ids)}
              noun="client"
              columnLabel="Client"
              invalid={c.invalid}
              describedBy={c['aria-describedby']}
              loading={options.loading}
              toggles
            />
          )}
        </FormField>
      )}
    </div>
  );
}

export function detailToForm(d: PrintoutDetail): F {
  return {
    typeKey: d.typeKey,
    name: d.name,
    description: d.description,
    recordsPerPage: d.recordsPerPage as F['recordsPerPage'],
    printMode: d.printMode as F['printMode'],
    printerType: d.printerType as F['printerType'],
    isActive: d.isActive,
    baseTemplate: d.baseTemplate,
    layout: d.layout,
    options: { ...d.options },
    allClients: d.allClients,
    clientIds: [...d.clientIds],
    version: d.version,
  };
}

function Body({
  typeKey,
  initial,
  detail,
}: {
  readonly typeKey: string;
  readonly initial: F;
  readonly detail: PrintoutDetail | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = React.useRef<UseFormReturn<F> | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const isDefault = detail?.isDefault ?? false;
  const listHref = `/settings/printouts/${typeKey}`;
  const steps = React.useMemo<readonly WizardStep<F>[]>(
    () => [
      {
        key: 'info',
        label: 'Info',
        icon: Info,
        schema: printoutInfoSchema,
        render: ({ form }) => {
          formRef.current = form;
          return <InfoStep typeKey={typeKey} isDefault={isDefault} />;
        },
      },
      {
        key: 'template',
        label: 'Select template',
        icon: LayoutTemplate,
        schema: printoutTemplateStepSchema,
        render: ({ form }) => {
          formRef.current = form;
          return <TemplateStep form={form} typeKey={typeKey} />;
        },
      },
      {
        key: 'design',
        label: 'Designer',
        icon: Palette,
        schema: printoutDesignStepSchema,
        canProceed: (v) =>
          (v.layout?.sections ?? []).some((s) => s.enabled) || 'Switch on at least one section',
        render: ({ form }) => {
          formRef.current = form;
          return <DesignerStep form={form} typeKey={typeKey} />;
        },
      },
      {
        key: 'options',
        label: 'Type options',
        icon: SlidersHorizontal,
        schema: printoutOptionsSchema.partial(),
        render: ({ form }) => {
          formRef.current = form;
          return <OptionsStep typeKey={typeKey} />;
        },
      },
      {
        key: 'clients',
        label: 'Client access',
        icon: Users2,
        schema: printoutClientsStepSchema,
        render: ({ form }) => {
          formRef.current = form;
          return <ClientsStep form={form} isDefault={isDefault} />;
        },
      },
    ],
    [typeKey, isDefault],
  );

  const submit = async (values: F) => {
    try {
      const body = {
        ...values,
        typeKey,
        clientIds: values.allClients ? [] : values.clientIds,
        version: detail?.version,
      };
      let savedId: string;
      if (detail) {
        await apiRequest(`/api/printouts/${detail.id}`, { method: 'PATCH', body });
        savedId = detail.id;
        toast.success('Printout saved', `${values.name} was updated.`);
      } else {
        const { data } = await apiRequest<{ id: string; name: string }>('/api/printouts', {
          method: 'POST',
          body,
        });
        savedId = data.id;
        toast.success('Printout created', `${data.name} is ready to print.`);
      }
      // The list and the type counts must show the saved template on arrival, not after a reload.
      queryClient.removeQueries({ queryKey: ['printout', savedId] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['grid', PRINTOUTS_GRID_KEY] }),
        queryClient.invalidateQueries({ queryKey: ['printout-types'] }),
      ]);
      router.push(`${listHref}?saved=${encodeURIComponent(savedId)}`);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      if (formRef.current) applyServerFieldErrors(formRef.current, error);
      toast.error("Couldn't save the printout", isApiError(error) ? error.message : 'Something went wrong');
      throw error;
    }
  };
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 lg:px-6">
      {conflict ? (
        <Callout
          variant="attention"
          title="This printout changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Someone else saved this printout. Reload to see their changes.
        </Callout>
      ) : null}
      <Wizard<F>
        steps={steps}
        variant="page"
        mode={detail ? 'free' : 'linear'}
        defaultValues={initial}
        draftScope={false}
        submitLabel={detail ? 'Save' : 'Create printout'}
        onCancel={() => router.push(listHref)}
        onComplete={submit}
      />
    </div>
  );
}

export function PrintoutWizardPage({
  typeKey,
  editId,
}: {
  readonly typeKey: string;
  readonly editId: string | null;
}) {
  const q = useApiQuery<PrintoutDetail>(
    ['printout', editId ?? ''],
    editId ? `/api/printouts/${editId}` : null,
    { staleTime: 0 },
  );
  const title = typeTitle(typeKey);
  const d = q.data?.data ?? null;
  const initial = editId ? (d ? detailToForm(d) : null) : printoutDefaults(typeKey);
  const mismatch = d && d.typeKey !== typeKey;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={editId ? `Edit ${title}${d ? ` · ${d.name}` : ''}` : `Create ${title}`}
        breadcrumbs={[
          { label: 'Settings' },
          { label: 'Printouts & Labels', href: '/settings/printouts' },
          { label: title, href: `/settings/printouts/${typeKey}` },
          { label: editId ? 'Edit' : 'Create' },
        ]}
      />
      {editId && q.isError ? (
        <EmptyState
          title="Couldn't load this printout"
          description={q.error.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : mismatch ? (
        <EmptyState
          title="This printout belongs to another type"
          description={`It is a ${d.typeName} template.`}
          action={
            <Link href={`/settings/printouts/${d.typeKey}/${d.id}`} className="text-primary hover:underline">
              Open it there
            </Link>
          }
        />
      ) : !initial ? (
        <div className="px-6">
          <Skeleton className="h-[520px] w-full" />
        </div>
      ) : (
        <Body key={editId ?? 'new'} typeKey={typeKey} initial={initial} detail={d} />
      )}
    </div>
  );
}
