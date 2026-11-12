'use client';

/**
 * Create / edit vendor drawer (stub handoff, owner M05). Used by the Vendors grids and
 * by step 3 of the purchase order wizard (client prefilled and locked).
 *
 *   Client* (locked on edit) · Display name* (100) · Vendor name* (255)
 *   "Use shipment address as billing" toggle · Shipment address · Billing address (toggle off)
 */
import * as React from 'react';
import { useWatch } from 'react-hook-form';
import { Building2 } from 'lucide-react';
import { ClientSelect } from '@/components/shared/entity-pickers';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { Form, FormField, FormGrid, FormSection, useZodForm, type ZodForm } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import {
  EMPTY_VENDOR_ADDRESS,
  VENDOR_DISPLAY_NAME_MAX,
  VENDOR_NAME_MAX,
  vendorFormSchema,
  type VendorAddressInput,
  type VendorFormInput,
} from '@/lib/grid-defs/receiving/vendors';
import { CountryF, StateF, TextF } from '@/components/receiving/fields';
import {
  errorMessage,
  useInvalidateReceiving,
  type VendorAddress,
  type VendorDetail,
} from '@/components/receiving/receiving-shared';

export interface VendorDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Edit this vendor; omit to create. */
  readonly vendorId?: string | null;
  /** Prefilled client for a new vendor. */
  readonly defaultClientId?: string | null;
  /** Lock the client (PO wizard). */
  readonly lockClient?: boolean;
  readonly onSaved?: (vendor: VendorDetail, created: boolean) => void;
}

type Schema = typeof vendorFormSchema;

const toInput = (a: VendorAddress | null): VendorAddressInput => (a ? { ...a } : { ...EMPTY_VENDOR_ADDRESS });

export function vendorDefaults(vendor: VendorDetail | null, clientId: string | null): VendorFormInput {
  if (!vendor)
    return {
      clientId: clientId ?? '',
      displayName: '',
      vendorName: '',
      useShipAsBilling: true,
      shipping: { ...EMPTY_VENDOR_ADDRESS },
      billing: { ...EMPTY_VENDOR_ADDRESS },
    };
  return {
    clientId: vendor.clientId,
    displayName: vendor.displayName,
    vendorName: vendor.vendorName,
    useShipAsBilling: vendor.useShipAsBilling,
    shipping: toInput(vendor.shipping),
    billing: toInput(vendor.useShipAsBilling ? null : vendor.billing),
    version: vendor.version,
  };
}

function AddressBlock({
  prefix,
  form,
}: {
  readonly prefix: 'shipping' | 'billing';
  readonly form: ZodForm<Schema>;
}) {
  const country = useWatch({ control: form.control, name: `${prefix}.country` }) as string | undefined;
  return (
    <FormGrid>
      <TextF
        name={`${prefix}.name`}
        label="Address name"
        maxLength={50}
        placeholder="e.g. Main warehouse"
        info="A short name for this address, shown on purchase orders."
      />
      <TextF name={`${prefix}.contactName`} label="Contact name" maxLength={100} />
      <TextF name={`${prefix}.phone`} label="Phone" maxLength={40} />
      <TextF name={`${prefix}.line1`} label="Address line 1" maxLength={256} className="md:col-span-2" />
      <TextF name={`${prefix}.line2`} label="Address line 2" maxLength={256} className="md:col-span-2" />
      <CountryF
        name={`${prefix}.country`}
        label="Country"
        required
        onCountry={() => form.setValue(`${prefix}.state`, '', { shouldDirty: true })}
      />
      <StateF
        name={`${prefix}.state`}
        label={country === 'CA' ? 'Province' : 'State'}
        required
        country={country}
      />
      <TextF name={`${prefix}.city`} label="City" maxLength={100} />
      <TextF
        name={`${prefix}.postalCode`}
        label={country === 'US' ? 'ZIP code' : 'Postal code'}
        maxLength={20}
      />
    </FormGrid>
  );
}

function VendorForm({
  vendor,
  defaultClientId,
  lockClient,
  formId,
  onSaved,
  onDirty,
  onBusy,
}: {
  readonly vendor: VendorDetail | null;
  readonly defaultClientId: string | null;
  readonly lockClient: boolean;
  readonly formId: string;
  readonly onSaved: (vendor: VendorDetail) => void;
  readonly onDirty: (dirty: boolean) => void;
  readonly onBusy: (busy: boolean) => void;
}) {
  const form = useZodForm(vendorFormSchema, vendorDefaults(vendor, defaultClientId));
  const useShip = useWatch({ control: form.control, name: 'useShipAsBilling' });
  const dirty = form.formState.isDirty;
  React.useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const save = async (values: VendorFormInput) => {
    onBusy(true);
    try {
      // A locked (disabled) Client field is left out of the submitted values, so restore it.
      const clientId = values.clientId || vendor?.clientId || defaultClientId || '';
      const body = { ...values, clientId, billing: values.useShipAsBilling ? undefined : values.billing };
      const { data } = vendor
        ? await apiRequest<VendorDetail>(`/api/vendors/${vendor.id}`, { method: 'PATCH', body })
        : await apiRequest<VendorDetail>('/api/vendors', { method: 'POST', body });
      form.reset(vendorDefaults(data, data.clientId));
      onSaved(data);
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error('Error', errorMessage(error));
      throw error;
    } finally {
      onBusy(false);
    }
  };

  return (
    <Form form={form} onSubmit={save} id={formId} className="gap-6">
      <FormSection title="Vendor">
        <FormGrid>
          <FormField
            name="clientId"
            label="Client"
            required={!vendor}
            disabled={Boolean(vendor) || lockClient}
            info={vendor ? "The client of a vendor can't change." : undefined}
            className="md:col-span-2"
          >
            {(c) => (
              <ClientSelect
                id={c.id}
                value={(c.value as string) || null}
                onChange={(v) => c.onChange(v ?? '')}
                onBlur={c.onBlur}
                invalid={c.invalid}
                disabled={c.disabled}
              />
            )}
          </FormField>
          <TextF
            name="displayName"
            label="Display name"
            required
            maxLength={VENDOR_DISPLAY_NAME_MAX}
            placeholder="e.g. Acme Supply"
            info="Shown on purchase orders and in the vendor picker."
          />
          <TextF
            name="vendorName"
            label="Vendor name"
            required
            maxLength={VENDOR_NAME_MAX}
            placeholder="Legal company name"
          />
        </FormGrid>
      </FormSection>
      <FormSection title="Shipment address" description="Where the vendor ships from.">
        <AddressBlock prefix="shipping" form={form} />
      </FormSection>
      <FormField name="useShipAsBilling" label="Use shipment address as billing" inline>
        {(c) => <Switch id={c.id} checked={Boolean(c.value)} onCheckedChange={(v) => c.onChange(v)} />}
      </FormField>
      {useShip ? null : (
        <FormSection title="Billing address">
          <AddressBlock prefix="billing" form={form} />
        </FormSection>
      )}
    </Form>
  );
}

export function VendorDrawer({
  open,
  onOpenChange,
  vendorId,
  defaultClientId = null,
  lockClient = false,
  onSaved,
}: VendorDrawerProps) {
  const formId = React.useId();
  const invalidate = useInvalidateReceiving();
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const detail = useApiQuery<VendorDetail>(
    ['vendor', vendorId ?? ''],
    open && vendorId ? `/api/vendors/${vendorId}` : null,
    { retry: false },
  );
  const editing = Boolean(vendorId);
  const vendor = editing ? (detail.data?.data ?? null) : null;

  const saved = async (v: VendorDetail) => {
    toast.success(
      'Success',
      editing ? `Vendor ${v.displayName} updated.` : `Vendor ${v.displayName} created.`,
    );
    setDirty(false);
    await invalidate();
    onSaved?.(v, !editing);
    onOpenChange(false);
  };

  let body: React.ReactNode;
  if (editing && detail.isPending) {
    body = (
      <div className="flex flex-col gap-3" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  } else if (editing && detail.error) {
    body = (
      <Callout
        variant="error"
        title={
          isApiError(detail.error) && detail.error.status === 404
            ? 'Vendor not found'
            : "Couldn't load the vendor"
        }
        action={
          <Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        }
      >
        {errorMessage(detail.error)}
      </Callout>
    );
  } else {
    body = (
      <VendorForm
        key={vendor ? `${vendor.id}:${vendor.version}` : `new:${defaultClientId ?? ''}`}
        vendor={vendor}
        defaultClientId={defaultClientId}
        lockClient={lockClient}
        formId={formId}
        onSaved={(v) => void saved(v)}
        onDirty={setDirty}
        onBusy={setBusy}
      />
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      width={45}
      title={
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" aria-hidden />
          {editing ? 'Edit vendor' : 'Create vendor'}
        </span>
      }
      description={editing ? vendor?.displayName : 'Vendors supply the products on your purchase orders.'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={busy || (editing && !vendor)}
            aria-busy={busy}
          >
            {busy ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
            {editing ? 'Save' : 'Create vendor'}
          </Button>
        </>
      }
    >
      {body}
    </Drawer>
  );
}
