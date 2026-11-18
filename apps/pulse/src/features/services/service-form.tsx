'use client';
/**
 * Add or edit an extra service: name, code, what one unit is called, how it is billed, the list
 * price, what the parts for one unit cost, and the target pace. The live readout under the form
 * shows what one unit should cost and the margin at this price, from the same rules as the list.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { VAS_BILLING_VALUES, type VasBilling } from '@/lib/constants';
import { formatPercentBp, formatUnitPrice } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { qk } from '@/lib/query-keys';
import type { VasServiceDTO } from '@/lib/types';
import { createVasServiceAction, updateVasServiceAction } from '@/server/actions/catalog';
import { BILLING_LABELS, serviceLine, unitWord } from './services-model';

interface FormState {
  name: string;
  code: string;
  unitLabel: string;
  billing: VasBilling;
  price: string;
  cost: string;
  pace: string;
  active: boolean;
}

const blank: FormState = { name: '', code: '', unitLabel: 'units', billing: 'per_unit', price: '', cost: '', pace: '', active: true };

const fromService = (service: VasServiceDTO): FormState => ({ name: service.name, code: service.code, unitLabel: service.unitLabel, billing: service.billing, price: trim(service.defaultPrice), cost: trim(service.defaultCostPerUnit), pace: trim(service.standardUph), active: service.active });

function trim(value: string | null): string {
  if (value === null) return '';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

const DECIMAL = /^\d+(\.\d{1,4})?$/;

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.name.trim().length === 0) errors.name = 'Give the service a name.';
  if (form.code.trim() !== '' && /[\s,;]/.test(form.code.trim())) errors.code = 'A code cannot hold spaces or commas.';
  if (form.unitLabel.trim().length === 0) errors.unitLabel = 'Say what one unit is called, like labels or pallets.';
  if (form.price.trim() !== '' && !DECIMAL.test(form.price.trim())) errors.defaultPrice = 'Type a price like 0.12 or 14.';
  if (form.cost.trim() !== '' && !DECIMAL.test(form.cost.trim())) errors.defaultCostPerUnit = 'Type a cost like 0.015 or 3.2.';
  if (form.pace.trim() !== '' && (!/^\d+(\.\d{1,3})?$/.test(form.pace.trim()) || Number(form.pace) <= 0)) errors.standardUph = 'Type a pace above zero, like 420.';
  return errors;
}

interface ServiceFormProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly service: VasServiceDTO | null;
  readonly rateCents: number | null;
  readonly targetMarginBp: number;
  readonly onSaved?: (service: VasServiceDTO) => void;
}

/** The dialog shell. The form inside is mounted fresh each time it opens, so it always starts from the service as it is now. */
export function ServiceFormDialog(props: ServiceFormProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="md" data-testid="service-form">
        {props.open ? <ServiceForm key={props.service?.id ?? 'new'} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ServiceForm({ onOpenChange, service, rateCents, targetMarginBp, onSaved }: ServiceFormProps) {
  const [form, setForm] = useState<FormState>(() => (service ? fromService(service) : blank));
  const [touched, setTouched] = useState(false);
  const invalidate = [qk.services(), ['services'], qk.profitRoot()] as const;
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useServerAction(createVasServiceAction, { invalidate, silentError: true, onError: (failure) => setServerError(failure.message) });
  const update = useServerAction(updateVasServiceAction, { invalidate, silentError: true, onError: (failure) => setServerError(failure.message) });

  const errors = useMemo(() => validate(form), [form]);
  const serverFields = service ? update.fieldErrors : create.fieldErrors;
  const error = (key: string): string | null => (touched ? (errors[key] ?? serverFields[key] ?? null) : null);
  const pending = create.pending || update.pending;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const preview = useMemo(() => {
    if (Object.keys(validate(form)).length > 0) return null;
    return serviceLine({ id: 'preview', code: form.code, name: form.name, unitLabel: form.unitLabel, billing: form.billing, defaultPrice: form.price.trim() || null, defaultCostPerUnit: form.cost.trim() || null, standardUph: form.pace.trim() || null, defaultLaborClassId: service?.defaultLaborClassId ?? null, wmsVasTypeId: null, color: null, active: form.active, version: 1, moneyHidden: false }, undefined, rateCents, targetMarginBp);
  }, [form, rateCents, targetMarginBp, service]);

  const submit = async () => {
    setTouched(true);
    setServerError(null);
    if (Object.keys(errors).length > 0) return;
    const patch = { name: form.name.trim(), code: form.code.trim() || null, unitLabel: form.unitLabel.trim(), billing: form.billing, defaultPrice: form.price.trim() || null, defaultCostPerUnit: form.cost.trim() || null, standardUph: form.pace.trim() || null, active: form.active };
    const saved = service ? await update.run({ serviceId: service.id, patch: { ...patch, code: patch.code ?? service.code }, version: service.version }) : await create.run(patch);
    if (!saved) return;
    toast.success(service ? `Saved ${saved.name}` : `Added ${saved.name}`);
    onSaved?.(saved);
    onOpenChange(false);
  };

  const unit = unitWord(form.unitLabel);
  return (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader title={service ? `Edit ${service.name}` : 'Add an extra service'} description="An extra service is something you bill on top of a job, like labeling or gift wrap." />
          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Field label="Name" required error={error('name')}>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Labeling" maxLength={200} autoFocus data-testid="service-name" />}
              </Field>
              <Field label="Code" hint={service ? undefined : 'Leave blank and Pulse makes one.'} error={error('code')}>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.code} onChange={(event) => set('code', event.target.value.toUpperCase())} placeholder="LABEL" maxLength={40} data-testid="service-code" />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="One unit is called" required hint="The plural word: labels, pallets, hours." error={error('unitLabel')}>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={form.unitLabel} onChange={(event) => set('unitLabel', event.target.value)} placeholder="labels" maxLength={30} data-testid="service-unit" />}
              </Field>
              <Field label="How it is billed">
                {({ inputId }) => <Select id={inputId} value={form.billing} onValueChange={(value) => set('billing', value as VasBilling)} options={VAS_BILLING_VALUES.map((value) => ({ value, label: BILLING_LABELS[value] ?? value }))} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={`Price for one ${unit}`} error={error('defaultPrice')}>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} inputMode="decimal" value={form.price} onChange={(event) => set('price', event.target.value)} placeholder="0.12" leadingIcon={<span className="text-sm text-fg-muted">$</span>} data-testid="service-price" />}
              </Field>
              <Field label={`Parts cost for one ${unit}`} hint="Labels, bags, wrap. Not labor." error={error('defaultCostPerUnit')}>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} inputMode="decimal" value={form.cost} onChange={(event) => set('cost', event.target.value)} placeholder="0.015" leadingIcon={<span className="text-sm text-fg-muted">$</span>} data-testid="service-cost" />}
              </Field>
              <Field label="Target pace" hint={`${form.unitLabel.trim() || 'Units'} per person per hour.`} error={error('standardUph')}>
                {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} inputMode="decimal" value={form.pace} onChange={(event) => set('pace', event.target.value)} placeholder="420" data-testid="service-pace" />}
              </Field>
            </div>
            <Switch checked={form.active} onCheckedChange={(value) => set('active', value)} label="Active" description="Turn it off to keep its history and hide it from new entries." />
            <div className="rounded-lg border border-border-subtle bg-sunken px-3 py-2.5 text-sm text-fg-secondary" data-testid="service-preview" aria-live="polite">
              {!preview || preview.price === null ? (
                'Type a price, the parts cost and a target pace to see what one unit should cost and the margin at this price.'
              ) : preview.standardCost === null ? (
                `At ${formatUnitPrice(preview.price)} a ${unit}. Add the parts cost or a target pace to see the margin.`
              ) : (
                <>
                  One {unit} should cost <strong className="font-semibold text-fg tabular-nums">{formatUnitPrice(preview.standardCost)}</strong>
                  {preview.standardLabor !== null ? <> ({formatUnitPrice(preview.standardLabor)} of that is labor at the target pace)</> : rateCents === null ? ' (labor is left out: no labor rate is set yet)' : ''}. At {formatUnitPrice(preview.price)} the margin is{' '}
                  <strong className={`font-semibold tabular-nums ${(preview.standardMarginBp ?? 0) < targetMarginBp ? 'text-danger-text' : 'text-fg'}`}>{formatPercentBp(preview.standardMarginBp)}</strong>
                  {(preview.standardMarginBp ?? 0) < targetMarginBp && preview.priceForTarget ? <>. A price of {formatUnitPrice(preview.priceForTarget)} would reach your {formatPercentBp(targetMarginBp)} target</> : null}.
                </>
              )}
            </div>
            {serverError ? (
              <p role="alert" className="text-sm text-danger-text" data-testid="service-form-error">
                {serverError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} data-testid="service-save">
              {service ? 'Save changes' : 'Add service'}
            </Button>
          </DialogFooter>
        </form>
  );
}
