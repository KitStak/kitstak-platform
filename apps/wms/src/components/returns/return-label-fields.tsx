'use client';

/**
 * Return label inputs (carrier → service cascade, package dims and weight) shared by
 * Create RMA and the RMA detail "Create return label" dialog, plus the dialog itself.
 */
import * as React from 'react';
import { Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { apiRequest } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { errorText, openFileId } from './returns-client';
import type { CarrierOption } from './return-types';

export {
  EMPTY_LABEL,
  labelPayload,
  validateLabel,
  type LabelErrors,
  type ReturnLabelValue,
} from './return-label-fields-model';
import {
  EMPTY_LABEL,
  labelPayload,
  validateLabel,
  type LabelErrors,
  type ReturnLabelValue,
} from './return-label-fields-model';

function Field({
  label,
  error,
  children,
  required,
  id,
}: {
  readonly label: string;
  readonly error?: string;
  readonly children: React.ReactNode;
  readonly required?: boolean;
  readonly id: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-body">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-2xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReturnLabelFields({
  warehouseId,
  clientId,
  value,
  onChange,
  errors = {},
  idPrefix = 'rl',
}: {
  readonly warehouseId: string;
  readonly clientId: string;
  readonly value: ReturnLabelValue;
  readonly onChange: (v: ReturnLabelValue) => void;
  readonly errors?: LabelErrors;
  readonly idPrefix?: string;
}) {
  const carriers = useApiQuery<readonly CarrierOption[]>(
    ['returns', 'carriers', warehouseId, clientId],
    '/api/returns/carriers',
    { query: { warehouseId, clientId } },
  );
  const list = carriers.data?.data ?? [];
  const carrier = list.find((c) => c.key === value.carrierKey);
  if (carriers.isPending)
    return (
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  if (carriers.error)
    return (
      <Callout
        variant="error"
        title="Could not load carriers"
        action={
          <Button size="sm" onClick={() => void carriers.refetch()}>
            Retry
          </Button>
        }
      >
        {carriers.error.message}
      </Callout>
    );
  if (list.length === 0)
    return (
      <Callout variant="attention" title="No carrier set up">
        This warehouse has no active carrier connection that can buy labels. Add one in Carrier Integrations.
      </Callout>
    );
  const num = (key: 'weightLb' | 'length' | 'width' | 'height', label: string, decimals = 0) => (
    <Field label={label} required error={errors[key]} id={`${idPrefix}-${key}`}>
      <NumberInput
        id={`${idPrefix}-${key}`}
        value={value[key]}
        decimals={decimals}
        min={0}
        onChange={(n) => onChange({ ...value, [key]: n })}
        invalid={Boolean(errors[key])}
      />
    </Field>
  );
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Return carrier" required error={errors.carrierKey} id={`${idPrefix}-carrier`}>
          <Select
            id={`${idPrefix}-carrier`}
            value={value.carrierKey}
            invalid={Boolean(errors.carrierKey)}
            options={list.map((c) => ({
              value: c.key,
              label: `${c.carrierCode} · ${c.connectionName}`,
              textValue: `${c.carrierCode} · ${c.connectionName}`,
            }))}
            onChange={(k) =>
              onChange({
                ...value,
                carrierKey: k,
                carrierServiceId: list.find((c) => c.key === k)?.services[0]?.id ?? null,
              })
            }
            placeholder="Choose a carrier"
          />
        </Field>
        <Field label="Return service" required error={errors.carrierServiceId} id={`${idPrefix}-service`}>
          <Select
            id={`${idPrefix}-service`}
            value={value.carrierServiceId}
            disabled={!carrier}
            invalid={Boolean(errors.carrierServiceId)}
            options={(carrier?.services ?? []).map((s) => ({
              value: s.id,
              label: s.name,
              description: s.transitDays
                ? `${s.transitDays} day${s.transitDays === 1 ? '' : 's'} in transit`
                : undefined,
            }))}
            onChange={(id) => onChange({ ...value, carrierServiceId: id })}
            placeholder={carrier ? 'Choose a service' : 'Choose a carrier first'}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {num('weightLb', 'Weight (lb)', 2)}
        {num('length', 'Length (in)', 1)}
        {num('width', 'Width (in)', 1)}
        {num('height', 'Height (in)', 1)}
      </div>
    </div>
  );
}

/** "Create / re-buy return label" dialog for an existing RMA. */
export function ReturnLabelDialog({
  open,
  onOpenChange,
  returnId,
  rmaCode,
  warehouseId,
  clientId,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly returnId: string;
  readonly rmaCode: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly onDone: () => void;
}) {
  const [value, setValue] = React.useState<ReturnLabelValue>(EMPTY_LABEL);
  const [errors, setErrors] = React.useState<LabelErrors>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setValue(EMPTY_LABEL);
      setErrors({});
      setError(null);
    }
  }, [open]);
  const submit = async () => {
    const e = validateLabel(value);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiRequest<{ trackingNumber: string; labelFileId: string | null }>(
        `/api/returns/${returnId}/label`,
        { method: 'POST', body: labelPayload(value) },
      );
      toast.success('Return label created', `Tracking ${data.trackingNumber} for ${rmaCode}.`);
      openFileId(data.labelFileId);
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(errorText(err, 'The return label could not be created.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Create return label"
          description={`A prepaid label the customer uses to send ${rmaCode} back.`}
        />
        <DialogBody className="space-y-3">
          <ReturnLabelFields
            warehouseId={warehouseId}
            clientId={clientId}
            value={value}
            onChange={setValue}
            errors={errors}
            idPrefix="dlg"
          />
          {error ? (
            <Callout variant="error" title="Label not created">
              {error}
            </Callout>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <Spinner className="h-3.5 w-3.5" label="Creating" />
            ) : (
              <Truck className="h-3.5 w-3.5" aria-hidden />
            )}
            Create label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
