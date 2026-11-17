'use client';
/**
 * Small entry dialogs the job tabs use until the money ops team's shared forms land: one other
 * cost, one revenue row (invoice, fee, adjustment, credit), one extra service entry and one
 * material usage row. Each calls the shared server action and nothing else, so swapping a
 * dialog for the shared form later is a one line change in the tab that opens it.
 */
import { useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  Textarea,
  ToggleGroup,
  toast,
} from '@/components/ui';
import {
  COST_CATEGORIES,
  COST_CATEGORY_LABELS,
  REVENUE_KINDS,
  REVENUE_KIND_LABELS,
  type CostCategory,
  type RevenueKind,
} from '@/lib/constants';
import { formatMoney } from '@/lib/format';
import { centsToDecimal, mulQuantityPrice } from '@/lib/money';
import type {
  CostEntryDTO,
  JobDetailDTO,
  LaborClassDTO,
  MaterialUsageDTO,
  RevenueEntryDTO,
  VasEntryDTO,
  VasServiceDTO,
} from '@/lib/types';
import type { ActionResult } from '@/server/actions/_action';
import {
  saveCostAction,
  saveMaterialUsageAction,
  saveRevenueAction,
  saveVasEntryAction,
} from '@/server/actions/entries';
import { readCents, readDecimal } from '../new-job-math';

type Errors = Readonly<Record<string, string>>;

const trim = (value: string | null | undefined): string =>
  value ? value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '') : '';
const dollars = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '' : centsToDecimal(Math.abs(cents));

/** Runs a save action from a dialog: field errors stay in the form, anything else is a toast. */
async function submit<T>(
  action: Promise<ActionResult<T>>,
  setErrors: (errors: Errors) => void,
): Promise<T | undefined> {
  try {
    const result = await action;
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error("Couldn't save that", result.error.message);
      return undefined;
    }
    return result.data;
  } catch {
    toast.error("Couldn't save that", 'Check your connection and try again.');
    return undefined;
  }
}

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  saving,
  submitLabel,
  testId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly onSubmit: () => void;
  readonly saving: boolean;
  readonly submitLabel: string;
  readonly testId: string;
}) {
  const formId = `${testId}-form`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid={testId}>
        <DialogHeader title={title} description={description} />
        <DialogBody>
          <form
            id={formId}
            noValidate
            className="grid gap-3 pb-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {children}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving} data-testid={`${testId}-save`}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DialogProps<Row> {
  readonly job: Pick<JobDetailDTO, 'id' | 'number' | 'unitLabel'>;
  readonly row?: Row | null;
  readonly today: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void | Promise<void>;
}

/* ------------------------------------------------------------------ other cost */

export function CostDialog({ job, row, today, open, onOpenChange, onSaved }: DialogProps<CostEntryDTO>) {
  const [date, setDate] = useState(row?.costDate ?? today);
  const [category, setCategory] = useState<CostCategory>(row?.category ?? 'freight');
  const [amount, setAmount] = useState(dollars(row?.amountCents));
  const [vendor, setVendor] = useState(row?.vendor ?? '');
  const [reference, setReference] = useState(row?.reference ?? '');
  const [note, setNote] = useState(row?.note ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const cents = readCents(amount);
    const next: Record<string, string> = {};
    if (!date) next.costDate = 'Pick the day.';
    if (cents === null || cents === 0) next.amountCents = 'Type an amount above zero, like 250.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    const saved = await submit(
      saveCostAction({
        id: row?.id ?? null,
        jobId: job.id,
        costDate: date,
        category,
        amountCents: cents as number,
        vendor: vendor.trim() || null,
        reference: reference.trim() || null,
        note: note.trim() || null,
        version: row?.version,
      }),
      setErrors,
    );
    setSaving(false);
    if (!saved) return;
    onOpenChange(false);
    await onSaved();
    toast.success(
      row
        ? 'Cost updated'
        : `Added ${formatMoney(saved.amountCents ?? cents)} of ${COST_CATEGORY_LABELS[category].toLowerCase()} cost`,
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={row ? 'Edit this cost' : 'Add a cost'}
      description={`Something ${job.number} cost you that is not labor or parts: freight, pallets, outside help.`}
      onSubmit={() => void save()}
      saving={saving}
      submitLabel={row ? 'Save changes' : 'Add the cost'}
      testId="cost-dialog"
    >
      <Field label="Day" required error={errors.costDate}>
        {({ inputId, invalid }) => (
          <Input
            id={inputId}
            type="date"
            invalid={invalid}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            data-testid="cost-date"
          />
        )}
      </Field>
      <Field label="Amount" required error={errors.amountCents}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="250"
            leadingIcon={<span className="text-fg-muted">$</span>}
            autoFocus
            data-testid="cost-amount"
          />
        )}
      </Field>
      <Field label="What kind of cost?" className="sm:col-span-2">
        {({ inputId }) => (
          <Select
            id={inputId}
            aria-label="What kind of cost?"
            value={category}
            onValueChange={(value) => setCategory(value as CostCategory)}
            options={COST_CATEGORIES.map((value) => ({ value, label: COST_CATEGORY_LABELS[value] }))}
          />
        )}
      </Field>
      <Field label="Who you paid" error={errors.vendor}>
        {({ inputId }) => (
          <Input
            id={inputId}
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            maxLength={200}
            placeholder="Midwest Freight"
          />
        )}
      </Field>
      <Field label="Bill or reference number" error={errors.reference}>
        {({ inputId }) => (
          <Input
            id={inputId}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={120}
            placeholder="INV 2291"
          />
        )}
      </Field>
      <Field label="Note" className="sm:col-span-2">
        {({ inputId }) => (
          <Textarea
            id={inputId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={1000}
          />
        )}
      </Field>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ revenue row */

const REVENUE_HINT: Readonly<Record<RevenueKind, string>> = {
  invoice: 'What you billed. It counts as Billed, never as profit: profit comes from the work earned.',
  fee: 'Extra money earned on this job: a rush fee, a setup fee. It adds to revenue.',
  adjustment: 'A correction to revenue, up or down.',
  credit: 'Money given back to the client. It takes away from revenue.',
};

export function RevenueDialog({
  job,
  row,
  today,
  open,
  onOpenChange,
  onSaved,
  initialKind,
}: DialogProps<RevenueEntryDTO> & { readonly initialKind?: RevenueKind }) {
  const [kind, setKind] = useState<RevenueKind>(
    row && row.kind !== 'fixed_true_up' ? row.kind : (initialKind ?? 'invoice'),
  );
  const [date, setDate] = useState(row?.revenueDate ?? today);
  const [amount, setAmount] = useState(dollars(row?.amountCents));
  const [lowers, setLowers] = useState<'up' | 'down'>(row && (row.amountCents ?? 0) < 0 ? 'down' : 'up');
  const [invoiceNumber, setInvoiceNumber] = useState(row?.invoiceNumber ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const cents = readCents(amount);
    const next: Record<string, string> = {};
    if (!date) next.revenueDate = 'Pick the day.';
    if (cents === null || cents === 0) next.amountCents = 'Type an amount above zero, like 1200.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const signed = kind === 'adjustment' && lowers === 'down' ? -(cents as number) : (cents as number);
    setSaving(true);
    const saved = await submit(
      saveRevenueAction({
        id: row?.id ?? null,
        jobId: job.id,
        revenueDate: date,
        kind,
        amountCents: signed,
        invoiceNumber: invoiceNumber.trim() || null,
        description: description.trim() || null,
        version: row?.version,
      }),
      setErrors,
    );
    setSaving(false);
    if (!saved) return;
    onOpenChange(false);
    await onSaved();
    toast.success(
      row ? `${REVENUE_KIND_LABELS[kind]} updated` : `Added the ${REVENUE_KIND_LABELS[kind].toLowerCase()}`,
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={row ? 'Edit this row' : 'Add money in'}
      description={`An invoice, a fee, a correction or a credit for ${job.number}.`}
      onSubmit={() => void save()}
      saving={saving}
      submitLabel={row ? 'Save changes' : 'Add it'}
      testId="revenue-dialog"
    >
      <Field label="What is it?" className="sm:col-span-2" hint={REVENUE_HINT[kind]}>
        {() => (
          <ToggleGroup
            label="What is it?"
            value={kind}
            onValueChange={setKind}
            options={REVENUE_KINDS.map((value) => ({ value, label: REVENUE_KIND_LABELS[value] }))}
          />
        )}
      </Field>
      <Field label="Day" required error={errors.revenueDate}>
        {({ inputId, invalid }) => (
          <Input
            id={inputId}
            type="date"
            invalid={invalid}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </Field>
      <Field label="Amount" required error={errors.amountCents}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="1200"
            leadingIcon={<span className="text-fg-muted">$</span>}
            autoFocus
            data-testid="revenue-amount"
          />
        )}
      </Field>
      {kind === 'adjustment' ? (
        <Field label="Which way?" className="sm:col-span-2">
          {() => (
            <ToggleGroup
              label="Which way?"
              value={lowers}
              onValueChange={setLowers}
              options={[
                { value: 'up', label: 'Adds to revenue' },
                { value: 'down', label: 'Takes away from revenue' },
              ]}
            />
          )}
        </Field>
      ) : null}
      {kind === 'invoice' ? (
        <Field label="Invoice number" error={errors.invoiceNumber}>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
              maxLength={80}
              placeholder="INV 1042"
              data-testid="revenue-invoice"
            />
          )}
        </Field>
      ) : null}
      <Field label="What it is for" className={kind === 'invoice' ? '' : 'sm:col-span-2'}>
        {({ inputId }) => (
          <Input
            id={inputId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            placeholder={
              kind === 'fee' ? 'Rush fee' : kind === 'credit' ? 'Damaged cartons' : 'First half of the job'
            }
          />
        )}
      </Field>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ extra service entry */

export function ServiceDialog({
  job,
  row,
  today,
  open,
  onOpenChange,
  onSaved,
  services,
  laborClasses,
}: DialogProps<VasEntryDTO> & {
  readonly services: readonly VasServiceDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
}) {
  const [serviceId, setServiceId] = useState(row?.vasServiceId ?? services[0]?.id ?? '');
  const [date, setDate] = useState(row?.workDate ?? today);
  const [quantity, setQuantity] = useState(trim(row?.quantity));
  const [price, setPrice] = useState(trim(row?.unitPrice ?? (row ? null : services[0]?.defaultPrice)));
  const [hours, setHours] = useState(row && Number(row.hours) > 0 ? trim(row.hours) : '');
  const [laborClassId, setLaborClassId] = useState(row?.laborClassId ?? '');
  const [material, setMaterial] = useState(
    row && (row.materialCents ?? 0) > 0 ? dollars(row.materialCents) : '',
  );
  const [note, setNote] = useState(row?.note ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const service = services.find((item) => item.id === serviceId);
  const quantityText = readDecimal(quantity, 3);
  const priceText = readDecimal(price, 4);
  const preview =
    quantityText && priceText && service?.billing === 'per_unit'
      ? mulQuantityPrice(quantityText, priceText)
      : null;

  const save = async () => {
    const next: Record<string, string> = {};
    if (!serviceId) next.vasServiceId = 'Pick the service.';
    if (!date) next.workDate = 'Pick the day.';
    if (!quantityText) next.quantity = 'Type how many, like 500.';
    if (price.trim() && !priceText) next.unitPrice = 'Type a price, like 0.35.';
    if (hours.trim() && !readDecimal(hours, 2)) next.hours = 'Type hours, like 3.5.';
    if (material.trim() && readCents(material) === null) next.materialCents = 'Type an amount, like 40.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    const saved = await submit(
      saveVasEntryAction({
        id: row?.id ?? null,
        vasServiceId: serviceId,
        jobId: job.id,
        workDate: date,
        quantity: quantityText as string,
        unitPrice: priceText,
        laborClassId: laborClassId || null,
        hours: readDecimal(hours, 2) ?? '0',
        materialCents: material.trim() ? readCents(material) : null,
        note: note.trim() || null,
        version: row?.version,
      }),
      setErrors,
    );
    setSaving(false);
    if (!saved) return;
    onOpenChange(false);
    await onSaved();
    toast.success(row ? 'Service entry updated' : `Added ${service?.name ?? 'the service'}`);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={row ? 'Edit this service entry' : 'Add an extra service'}
      description="Work sold on top of the job, with its own revenue and its own cost."
      onSubmit={() => void save()}
      saving={saving}
      submitLabel={row ? 'Save changes' : 'Add the service'}
      testId="service-dialog"
    >
      <Field label="Service" required error={errors.vasServiceId} className="sm:col-span-2">
        {({ inputId }) => (
          <Select
            id={inputId}
            aria-label="Service"
            value={serviceId || undefined}
            placeholder="Pick a service"
            onValueChange={(value) => {
              setServiceId(value);
              const picked = services.find((item) => item.id === value);
              if (picked?.defaultPrice && !price.trim()) setPrice(trim(picked.defaultPrice));
            }}
            options={services.map((item) => ({ value: item.id, label: item.name }))}
          />
        )}
      </Field>
      <Field label="Day" required error={errors.workDate}>
        {({ inputId, invalid }) => (
          <Input
            id={inputId}
            type="date"
            invalid={invalid}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </Field>
      <Field label={`How many ${service?.unitLabel ?? 'units'}`} required error={errors.quantity}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            placeholder="500"
            autoFocus
            data-testid="service-quantity"
          />
        )}
      </Field>
      <Field
        label={
          service?.billing === 'per_hour'
            ? 'Price for one hour'
            : service?.billing === 'flat'
              ? 'Flat price'
              : 'Price for one'
        }
        error={errors.unitPrice}
        hint={
          preview !== null
            ? `That is ${formatMoney(preview)} of revenue.`
            : 'Leave it blank and Pulse marks it "No price set yet".'
        }
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="0.35"
            leadingIcon={<span className="text-fg-muted">$</span>}
            data-testid="service-price"
          />
        )}
      </Field>
      <Field
        label="Labor hours it took"
        error={errors.hours}
        hint="People times hours. Costed at the real cost of an hour."
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
        )}
      </Field>
      {laborClasses.length > 0 ? (
        <Field label="Who did it?">
          {({ inputId }) => (
            <Select
              id={inputId}
              aria-label="Who did it?"
              value={laborClassId || 'default'}
              onValueChange={(value) => setLaborClassId(value === 'default' ? '' : value)}
              options={[
                { value: 'default', label: 'The usual crew for this service' },
                ...laborClasses.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          )}
        </Field>
      ) : null}
      <Field
        label="Material cost for all of it"
        error={errors.materialCents}
        hint="Labels, wrap, inserts you bought for this."
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            leadingIcon={<span className="text-fg-muted">$</span>}
          />
        )}
      </Field>
      <Field label="Note" className="sm:col-span-2">
        {({ inputId }) => (
          <Textarea
            id={inputId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={1000}
          />
        )}
      </Field>
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ material usage row */

export function UsageDialog({ job, row, today, open, onOpenChange, onSaved }: DialogProps<MaterialUsageDTO>) {
  const [date, setDate] = useState(row?.usageDate ?? today);
  const [sku, setSku] = useState(row?.itemSku ?? '');
  const [name, setName] = useState(row?.itemName ?? '');
  const [used, setUsed] = useState(trim(row?.quantityUsed));
  const [scrapped, setScrapped] = useState(
    row && Number(row.quantityScrapped) > 0 ? trim(row.quantityScrapped) : '',
  );
  const [planned, setPlanned] = useState(trim(row?.quantityPlanned));
  const [unitCost, setUnitCost] = useState(trim(row?.unitCost));
  const [suppliedBy, setSuppliedBy] = useState<'job' | 'us' | 'client'>(row?.suppliedBy ?? 'job');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const usedText = readDecimal(used, 3);
  const costText = readDecimal(unitCost, 4);

  const save = async () => {
    const next: Record<string, string> = {};
    if (!date) next.usageDate = 'Pick the day.';
    if (!name.trim() && !sku.trim()) next.itemName = 'Say what was used.';
    if (!usedText) next.quantityUsed = 'Type how many were used, like 500.';
    if (scrapped.trim() && !readDecimal(scrapped, 3)) next.quantityScrapped = 'Type a number, like 12.';
    if (planned.trim() && !readDecimal(planned, 3)) next.quantityPlanned = 'Type a number, like 5000.';
    if (unitCost.trim() && !costText) next.unitCost = 'Type a cost, like 0.45.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    const saved = await submit(
      saveMaterialUsageAction({
        id: row?.id ?? null,
        jobId: job.id,
        usageDate: date,
        itemSku: sku.trim() || null,
        itemName: name.trim() || null,
        quantityUsed: usedText as string,
        quantityScrapped: readDecimal(scrapped, 3) ?? '0',
        quantityPlanned: readDecimal(planned, 3),
        unitCost: costText,
        suppliedBy: suppliedBy === 'job' ? null : suppliedBy,
        version: row?.version,
      }),
      setErrors,
    );
    setSaving(false);
    if (!saved) return;
    onOpenChange(false);
    await onSaved();
    toast.success(row ? 'Usage updated' : `Added ${name.trim() || sku.trim()}`);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={row ? 'Edit this usage' : 'Add material used'}
      description={`A part or a supply that went into ${job.number}.`}
      onSubmit={() => void save()}
      saving={saving}
      submitLabel={row ? 'Save changes' : 'Add the usage'}
      testId="usage-dialog"
    >
      <Field label="What was used" required error={errors.itemName}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            placeholder="Gift box, large"
            autoFocus
            data-testid="usage-name"
          />
        )}
      </Field>
      <Field label="Item number" hint="Optional. Your SKU for it.">
        {({ inputId }) => (
          <Input
            id={inputId}
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            maxLength={80}
            placeholder="BOX-L"
          />
        )}
      </Field>
      <Field label="Day" required error={errors.usageDate}>
        {({ inputId, invalid }) => (
          <Input
            id={inputId}
            type="date"
            invalid={invalid}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </Field>
      <Field label="How many were used" required error={errors.quantityUsed}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={used}
            onChange={(event) => setUsed(event.target.value)}
            inputMode="decimal"
            placeholder="500"
            data-testid="usage-used"
          />
        )}
      </Field>
      <Field label="How many were scrapped" error={errors.quantityScrapped} hint="Damaged or thrown away.">
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={scrapped}
            onChange={(event) => setScrapped(event.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
        )}
      </Field>
      <Field
        label="Planned for the whole job"
        error={errors.quantityPlanned}
        hint="Lets Pulse work out what is still to buy."
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={planned}
            onChange={(event) => setPlanned(event.target.value)}
            inputMode="decimal"
            placeholder="5000"
          />
        )}
      </Field>
      <Field
        label="Cost for one"
        error={errors.unitCost}
        hint={
          usedText && costText
            ? `Used parts cost ${formatMoney(mulQuantityPrice(usedText, costText))}.`
            : 'What you paid for each.'
        }
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            inputMode="decimal"
            placeholder="0.45"
            leadingIcon={<span className="text-fg-muted">$</span>}
            data-testid="usage-cost"
          />
        )}
      </Field>
      <Field label="Who bought it?" hint="Parts the client supplies cost you nothing.">
        {({ inputId }) => (
          <Select
            id={inputId}
            aria-label="Who bought it?"
            value={suppliedBy}
            onValueChange={(value) => setSuppliedBy(value as 'job' | 'us' | 'client')}
            options={[
              { value: 'job', label: 'Same as the job' },
              { value: 'us', label: 'We did' },
              { value: 'client', label: 'The client did' },
            ]}
          />
        )}
      </Field>
    </FormDialog>
  );
}
