'use client';
/**
 * Dialogs that change the job itself: its details, its plan (quote or budget) and its price
 * from a chosen day.
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
  IsoDatePicker,
  Select,
  Textarea,
  ToggleGroup,
  toast,
} from '@/components/ui';
import { formatMoney, formatPercentBp } from '@/lib/format';
import { centsToDecimal, toCents } from '@/lib/money';
import { planFigures } from '@/lib/profit';
import type { JobDetailDTO, JobPlanDTO, JobTypeDTO, OrgPerson } from '@/lib/types';
import type { ActionResult } from '@/server/actions/_action';
import { savePlanAction, setJobPriceAction, updateJobAction } from '@/server/actions/jobs';
import { singularUnit } from '../job-math';
import { readCents, readDecimal } from '../new-job-math';

type Errors = Readonly<Record<string, string>>;
const trim = (value: string | null | undefined): string =>
  value ? value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '') : '';
const dollars = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '' : centsToDecimal(cents);

async function run<T>(
  action: Promise<ActionResult<T>>,
  setErrors: (errors: Errors) => void,
  title: string,
): Promise<T | undefined> {
  try {
    const result = await action;
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error(title, result.error.message);
      return undefined;
    }
    return result.data;
  } catch {
    toast.error(title, 'Check your connection and try again.');
    return undefined;
  }
}

function Shell({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  saving,
  submitLabel,
  testId,
  size = 'md',
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
  readonly size?: 'md' | 'lg';
}) {
  const formId = `${testId}-form`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size} data-testid={testId}>
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

/* ------------------------------------------------------------------ job details */

export function EditJobDialog({
  job,
  jobTypes,
  people,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly job: JobDetailDTO;
  readonly jobTypes: readonly JobTypeDTO[];
  readonly people: readonly OrgPerson[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: (job: JobDetailDTO) => void | Promise<void>;
}) {
  const [name, setName] = useState(job.name);
  const [jobTypeId, setJobTypeId] = useState(job.jobTypeId);
  const [kind, setKind] = useState(job.kind);
  const [units, setUnits] = useState(trim(job.plannedUnits));
  const [unitLabel, setUnitLabel] = useState(job.unitLabel);
  const [startDate, setStartDate] = useState(job.startDate ?? '');
  const [dueDate, setDueDate] = useState(job.dueDate ?? '');
  const [ownerId, setOwnerId] = useState(job.ownerId ?? '');
  const [pace, setPace] = useState(trim(job.standardUph));
  const [target, setTarget] = useState(
    job.targetMarginBp === null ? '' : trim(String(job.targetMarginBp / 100)),
  );
  const [poNumber, setPoNumber] = useState(job.poNumber ?? '');
  const [pinnedNote, setPinnedNote] = useState(job.pinnedNote ?? '');
  const [description, setDescription] = useState(job.description ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the job a name.';
    if (units.trim() && !readDecimal(units, 3)) next.plannedUnits = 'Type a number, like 5000.';
    if (pace.trim() && (!readDecimal(pace, 3) || Number(readDecimal(pace, 3)) === 0))
      next.standardUph = 'Type a pace above zero, like 40.';
    if (target.trim() && !readDecimal(target, 2)) next.targetMarginBp = 'Type a percent, like 30.';
    if (startDate && dueDate && dueDate < startDate) next.dueDate = 'The due date is before the start date.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    const saved = await run(
      updateJobAction({
        jobId: job.id,
        version: job.version,
        patch: {
          name: name.trim(),
          jobTypeId,
          kind,
          plannedUnits: readDecimal(units, 3) ?? '0',
          unitLabel: unitLabel.trim() || null,
          startDate: startDate || null,
          dueDate: dueDate || null,
          ownerId: ownerId || null,
          standardUph: readDecimal(pace, 3),
          targetMarginBp: readDecimal(target, 2) ? Math.round(Number(readDecimal(target, 2)) * 100) : null,
          poNumber: poNumber.trim() || null,
          pinnedNote: pinnedNote.trim() || null,
          description: description.trim() || null,
        },
      }),
      setErrors,
      "Couldn't save the job",
    );
    setSaving(false);
    if (!saved) return;
    onOpenChange(false);
    await onSaved(saved);
    toast.success('Job saved');
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${job.number}`}
      description="Names, dates, units and targets. The price and the plan have their own tabs."
      onSubmit={() => void save()}
      saving={saving}
      submitLabel="Save the job"
      testId="edit-job"
      size="lg"
    >
      <Field label="Job name" required error={errors.name} className="sm:col-span-2">
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
            data-testid="edit-job-name"
          />
        )}
      </Field>
      <Field label="Kind of work">
        {({ inputId }) => (
          <Select
            id={inputId}
            aria-label="Kind of work"
            value={jobTypeId}
            onValueChange={setJobTypeId}
            options={jobTypes.map((type) => ({ value: type.id, label: type.name }))}
          />
        )}
      </Field>
      <Field label="How long does it run?">
        {() => (
          <ToggleGroup
            label="How long does it run?"
            value={kind}
            onValueChange={setKind}
            options={[
              { value: 'one_time', label: 'One time' },
              { value: 'ongoing', label: 'Ongoing' },
            ]}
          />
        )}
      </Field>
      <Field
        label={kind === 'ongoing' ? 'Units in a usual month' : 'Units to make'}
        error={errors.plannedUnits}
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={units}
            onChange={(event) => setUnits(event.target.value)}
            inputMode="decimal"
            data-testid="edit-job-units"
          />
        )}
      </Field>
      <Field label="What do you call one?">
        {({ inputId }) => (
          <Input
            id={inputId}
            value={unitLabel}
            onChange={(event) => setUnitLabel(event.target.value)}
            maxLength={30}
          />
        )}
      </Field>
      <Field label="Start date">
        {({ inputId }) => (
          <IsoDatePicker
            id={inputId}
            aria-label="Start date"
            value={startDate || null}
            onChange={(value) => setStartDate(value ?? '')}
          />
        )}
      </Field>
      <Field label="Due date" error={errors.dueDate}>
        {({ inputId, describedBy, invalid }) => (
          <IsoDatePicker
            id={inputId}
            aria-label="Due date"
            aria-describedby={describedBy}
            invalid={invalid}
            value={dueDate || null}
            onChange={(value) => setDueDate(value ?? '')}
            data-testid="edit-job-due"
          />
        )}
      </Field>
      <Field label="Owner">
        {({ inputId }) => (
          <Select
            id={inputId}
            aria-label="Owner"
            value={ownerId || 'none'}
            onValueChange={(value) => setOwnerId(value === 'none' ? '' : value)}
            options={[
              { value: 'none', label: 'No owner' },
              ...people.map((person) => ({ value: person.id, label: person.name })),
            ]}
          />
        )}
      </Field>
      <Field label="Client PO number">
        {({ inputId }) => (
          <Input
            id={inputId}
            value={poNumber}
            onChange={(event) => setPoNumber(event.target.value)}
            maxLength={80}
          />
        )}
      </Field>
      <Field
        label="Target pace"
        error={errors.standardUph}
        hint={`${unitLabel || 'Units'} one person finishes in an hour. Blank uses the pace for this kind of work.`}
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={pace}
            onChange={(event) => setPace(event.target.value)}
            inputMode="decimal"
            placeholder="Use the usual pace"
          />
        )}
      </Field>
      <Field
        label="Target margin"
        error={errors.targetMarginBp}
        hint="Blank uses the target for this kind of work or client."
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            inputMode="decimal"
            placeholder="Use the usual target"
            trailing={<span className="text-fg-muted">%</span>}
          />
        )}
      </Field>
      <Field label="Pinned note" className="sm:col-span-2" hint="Shows at the top of the job for everyone.">
        {({ inputId }) => (
          <Input
            id={inputId}
            value={pinnedNote}
            onChange={(event) => setPinnedNote(event.target.value)}
            maxLength={1000}
          />
        )}
      </Field>
      <Field label="Notes for the team" className="sm:col-span-2">
        {({ inputId }) => (
          <Textarea
            id={inputId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={5000}
          />
        )}
      </Field>
    </Shell>
  );
}

/* ------------------------------------------------------------------ plan (quote or budget) */

export function PlanDialog({
  job,
  plan,
  kind,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly job: JobDetailDTO;
  readonly plan: JobPlanDTO | null;
  readonly kind: 'quote' | 'budget';
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void | Promise<void>;
}) {
  const unit = singularUnit(job.unitLabel);
  const [units, setUnits] = useState(trim(plan?.units ?? job.plannedUnits));
  const [revenue, setRevenue] = useState(dollars(plan?.revenueCents));
  const [laborHours, setLaborHours] = useState(trim(plan?.laborHours));
  const [labor, setLabor] = useState(dollars(plan?.laborCents));
  const [setupHours, setSetupHours] = useState(
    plan && Number(plan.setupHours) > 0 ? trim(plan.setupHours) : '',
  );
  const [setup, setSetup] = useState(plan && (plan.setupCents ?? 0) > 0 ? dollars(plan.setupCents) : '');
  const [material, setMaterial] = useState(dollars(plan?.materialCents));
  const [other, setOther] = useState(dollars(plan?.otherCents));
  const [sharedMode, setSharedMode] = useState<'auto' | 'typed'>(plan && !plan.sharedAuto ? 'typed' : 'auto');
  const [shared, setShared] = useState(plan && !plan.sharedAuto ? dollars(plan.sharedCents) : '');
  const [note, setNote] = useState(plan?.note ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const hasLines = (plan?.lines.length ?? 0) > 0;

  const cents = (text: string): number => readCents(text) ?? 0;
  const figures = planFigures({
    units: readDecimal(units, 3) ?? '0',
    revenueCents: toCents(cents(revenue)),
    laborHours: readDecimal(laborHours, 2) ?? '0',
    laborCents: toCents(cents(labor)),
    materialCents: toCents(cents(material)),
    otherCents: toCents(cents(other)),
    sharedCents: toCents(
      sharedMode === 'typed' ? cents(shared) : plan?.sharedAuto ? (plan.sharedCents ?? 0) : 0,
    ),
  });

  const save = async () => {
    const next: Record<string, string> = {};
    const check = (key: string, text: string, scale: number, message: string) => {
      if (text.trim() && readDecimal(text, scale) === null) next[key] = message;
    };
    check('units', units, 3, 'Type a number, like 5000.');
    check('revenueCents', revenue, 2, 'Type an amount, like 12500.');
    check('laborHours', laborHours, 2, 'Type hours, like 120.');
    check('laborCents', labor, 2, 'Type an amount, like 2700.');
    check('setupHours', setupHours, 2, 'Type hours, like 2.');
    check('setupCents', setup, 2, 'Type an amount, like 45.');
    check('materialCents', material, 2, 'Type an amount, like 2250.');
    check('otherCents', other, 2, 'Type an amount, like 400.');
    if (sharedMode === 'typed') check('sharedCents', shared, 2, 'Type an amount, like 300.');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    const saved = await run(
      savePlanAction({
        jobId: job.id,
        plan: kind,
        input: {
          units: readDecimal(units, 3) ?? '0',
          revenueCents: cents(revenue),
          laborHours: readDecimal(laborHours, 2) ?? '0',
          laborCents: cents(labor),
          setupHours: readDecimal(setupHours, 2) ?? '0',
          setupCents: cents(setup),
          materialCents: cents(material),
          otherCents: cents(other),
          sharedCents: sharedMode === 'typed' ? cents(shared) : null,
          note: note.trim() || null,
          origin: plan?.origin ?? 'typed',
          version: plan?.version,
        },
      }),
      setErrors,
      "Couldn't save the plan",
    );
    setSaving(false);
    if (!saved) return;
    onOpenChange(false);
    await onSaved();
    toast.success(kind === 'quote' ? 'Quote saved' : 'Budget saved');
  };

  const word = kind === 'quote' ? 'quote' : 'budget';
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={plan ? `Edit the ${word}` : `Add a ${word}`}
      description={
        kind === 'quote'
          ? 'What you told the client: the revenue and the costs you expected for the whole job.'
          : 'Your own plan for the whole job, when it differs from what you quoted.'
      }
      onSubmit={() => void save()}
      saving={saving}
      submitLabel={`Save the ${word}`}
      testId="plan-dialog"
      size="lg"
    >
      {hasLines ? (
        <p className="rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-text sm:col-span-2">
          This {word} was built from lines. Saving totals here keeps the lines for the line by line table, and
          the totals below become the plan.
        </p>
      ) : null}
      <Field label={`Units (${job.unitLabel})`} error={errors.units}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={units}
            onChange={(event) => setUnits(event.target.value)}
            inputMode="decimal"
            data-testid="plan-units"
          />
        )}
      </Field>
      <Field label="Revenue" error={errors.revenueCents} hint="Everything the client pays for the job.">
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={revenue}
            onChange={(event) => setRevenue(event.target.value)}
            inputMode="decimal"
            leadingIcon={<span className="text-fg-muted">$</span>}
            data-testid="plan-revenue"
          />
        )}
      </Field>
      <Field label="Labor hours" error={errors.laborHours} hint="People times hours, setup included.">
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={laborHours}
            onChange={(event) => setLaborHours(event.target.value)}
            inputMode="decimal"
            data-testid="plan-labor-hours"
          />
        )}
      </Field>
      <Field label="Labor cost" error={errors.laborCents} hint="Those hours at the real cost of an hour.">
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={labor}
            onChange={(event) => setLabor(event.target.value)}
            inputMode="decimal"
            leadingIcon={<span className="text-fg-muted">$</span>}
            data-testid="plan-labor"
          />
        )}
      </Field>
      <Field
        label="Setup hours"
        error={errors.setupHours}
        hint="Part of the labor hours. They make no units."
      >
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={setupHours}
            onChange={(event) => setSetupHours(event.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
        )}
      </Field>
      <Field label="Setup cost" error={errors.setupCents} hint="Part of the labor cost.">
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={setup}
            onChange={(event) => setSetup(event.target.value)}
            inputMode="decimal"
            placeholder="0"
            leadingIcon={<span className="text-fg-muted">$</span>}
          />
        )}
      </Field>
      <Field label="Material cost" error={errors.materialCents}>
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
            inputMode="decimal"
            leadingIcon={<span className="text-fg-muted">$</span>}
            data-testid="plan-material"
          />
        )}
      </Field>
      <Field label="Other cost" error={errors.otherCents} hint="Freight, pallets, outside help.">
        {({ inputId, describedBy, invalid }) => (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={other}
            onChange={(event) => setOther(event.target.value)}
            inputMode="decimal"
            leadingIcon={<span className="text-fg-muted">$</span>}
            data-testid="plan-other"
          />
        )}
      </Field>
      <Field
        label="Time not on a job"
        className="sm:col-span-2"
        hint={
          sharedMode === 'auto'
            ? 'Pulse fills this in from your workspace: the usual share of meetings, cleanup and waiting.'
            : undefined
        }
      >
        {() => (
          <ToggleGroup
            label="Time not on a job"
            value={sharedMode}
            onValueChange={setSharedMode}
            options={[
              { value: 'auto', label: 'Let Pulse fill it in' },
              { value: 'typed', label: 'I will type it' },
            ]}
          />
        )}
      </Field>
      {sharedMode === 'typed' ? (
        <Field label="Time not on a job, amount" error={errors.sharedCents}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={shared}
              onChange={(event) => setShared(event.target.value)}
              inputMode="decimal"
              leadingIcon={<span className="text-fg-muted">$</span>}
            />
          )}
        </Field>
      ) : null}
      <Field label="Note" className="sm:col-span-2">
        {({ inputId }) => (
          <Input
            id={inputId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            placeholder="Why this plan changed"
          />
        )}
      </Field>
      <p
        className="rounded-lg bg-sunken px-3 py-2 text-sm text-fg-secondary sm:col-span-2"
        aria-live="polite"
        data-testid="plan-preview"
      >
        This plan earns{' '}
        <span className="font-medium text-fg tabular-nums">{formatMoney(figures.profitCents)}</span> on{' '}
        <span className="tabular-nums">{formatMoney(figures.revenueCents)}</span> of revenue, a{' '}
        <span className="font-medium text-fg tabular-nums">
          {formatPercentBp(figures.marginBp, { empty: 'margin not known yet' })}
        </span>{' '}
        margin{sharedMode === 'auto' && !plan?.sharedAuto ? ', before time not on a job is added' : ''}. Per{' '}
        {unit}, that is the price and cost you are holding the job to.
      </p>
    </Shell>
  );
}

/* ------------------------------------------------------------------ price from a day */

type ContractInfo = NonNullable<JobDetailDTO['links'][number]['contract']>;

/** What a typed price does to a job whose price comes from the warehouse contract (wms-services.ts). */
export function contractPriceNote(contract: ContractInfo): string {
  if (contract.billedBy) {
    const why = contract.billedBy === 'tiers' ? 'its rate changes with volume' : 'its rate is for some products only';
    return `The warehouse contract ${contract.contractName} prices this job on its own bill, because ${why}. Pulse does not set this price from the contract, so the price you type here is the one Pulse uses.`;
  }
  if (contract.inEffect) {
    return `This price came from the warehouse contract ${contract.contractName}. A price you type here is used from the day you pick, and the job stops following the contract. Pulse puts the contract rate back only when the contract's rates change in the warehouse.`;
  }
  return `This job does not follow the warehouse contract ${contract.contractName} right now, because a price was typed in Pulse. Pulse puts the contract rate back when the contract's rates change in the warehouse.`;
}

export function PriceDialog({
  job,
  today,
  open,
  onOpenChange,
  onSaved,
  mode = 'price',
}: {
  readonly job: JobDetailDTO;
  readonly today: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void | Promise<void>;
  readonly mode?: 'price' | 'material';
}) {
  const unit = singularUnit(job.unitLabel);
  const [from, setFrom] = useState(today);
  const [whole, setWhole] = useState<'day' | 'all'>('day');
  const [unitPrice, setUnitPrice] = useState(trim(job.unitPrice));
  const [billRate, setBillRate] = useState(dollars(job.billRateCents));
  const [material, setMaterial] = useState(trim(job.materialCostPerUnit));
  const [fixed, setFixed] = useState(dollars(job.fixedPriceCents));
  const [note, setNote] = useState('');
  const isFixed = mode === 'price' && job.pricingModel === 'fixed';
  // A job linked to a warehouse work order may take its price from the contract: say what a typed price does.
  const contract = mode === 'price' ? (job.links.find((link) => link.contract)?.contract ?? null) : null;
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next: Record<string, string> = {};
    if (mode === 'price' && job.pricingModel === 'per_unit' && !readDecimal(unitPrice, 4))
      next.unitPrice = 'Type a price, like 1.25.';
    if (mode === 'price' && job.pricingModel === 'hourly' && readCents(billRate) === null)
      next.billRateCents = 'Type a rate, like 38.';
    if (mode === 'material' && !readDecimal(material, 4))
      next.materialCostPerUnit = 'Type a cost, like 0.45.';
    if (isFixed && readCents(fixed) === null) next.fixedPriceCents = 'Type an amount, like 12500.';
    if (!isFixed && whole === 'day' && !from) next.effectiveFrom = 'Pick the day it starts.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    if (isFixed) {
      const changed = await run(
        updateJobAction({
          jobId: job.id,
          version: job.version,
          patch: { fixedPriceCents: readCents(fixed) },
        }),
        setErrors,
        "Couldn't save the price",
      );
      setSaving(false);
      if (!changed) return;
      onOpenChange(false);
      await onSaved();
      toast.success('Price saved', 'Revenue earned so far was worked out again from the new price.');
      return;
    }
    const saved = await run(
      setJobPriceAction({
        jobId: job.id,
        effectiveFrom: whole === 'all' ? '0001-01-01' : from,
        unitPrice:
          mode === 'price' && job.pricingModel === 'per_unit' ? readDecimal(unitPrice, 4) : undefined,
        billRateCents: mode === 'price' && job.pricingModel === 'hourly' ? readCents(billRate) : undefined,
        materialCostPerUnit: mode === 'material' ? (readDecimal(material, 4) as string) : undefined,
        note: note.trim() || null,
      }),
      setErrors,
      "Couldn't save the change",
    );
    setSaving(false);
    if (!saved) return;
    onOpenChange(false);
    await onSaved();
    toast.success(
      mode === 'price' ? 'Price saved' : 'Material cost saved',
      'Entries in open months from that day were worked out again.',
    );
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'price' ? 'Change the price' : `Change the material cost per ${unit}`}
      description={
        isFixed
          ? 'One price for the whole job. Pulse earns it as the units get done.'
          : 'Pick the day the new number starts. Entries from that day on are worked out again. Earlier days keep the old number.'
      }
      onSubmit={() => void save()}
      saving={saving}
      submitLabel="Save"
      testId="price-dialog"
    >
      {contract ? (
        <p
          role="note"
          className="rounded-lg border border-border-subtle bg-sunken p-3 text-sm text-fg-secondary sm:col-span-2"
          data-testid="price-contract-note"
        >
          {contractPriceNote(contract)}
        </p>
      ) : null}
      {mode === 'price' && job.pricingModel === 'per_unit' ? (
        <Field label={`New price for one ${unit}`} required error={errors.unitPrice}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
              inputMode="decimal"
              leadingIcon={<span className="text-fg-muted">$</span>}
              autoFocus
              data-testid="price-unit"
            />
          )}
        </Field>
      ) : null}
      {mode === 'price' && job.pricingModel === 'hourly' ? (
        <Field label="New price for one labor hour" required error={errors.billRateCents}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={billRate}
              onChange={(event) => setBillRate(event.target.value)}
              inputMode="decimal"
              leadingIcon={<span className="text-fg-muted">$</span>}
              autoFocus
              data-testid="price-bill"
            />
          )}
        </Field>
      ) : null}
      {mode === 'material' ? (
        <Field label={`New material cost for one ${unit}`} required error={errors.materialCostPerUnit}>
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={material}
              onChange={(event) => setMaterial(event.target.value)}
              inputMode="decimal"
              leadingIcon={<span className="text-fg-muted">$</span>}
              autoFocus
              data-testid="price-material"
            />
          )}
        </Field>
      ) : null}
      {isFixed ? (
        <Field
          label="New price for the whole job"
          required
          error={errors.fixedPriceCents}
          className="sm:col-span-2"
        >
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={fixed}
              onChange={(event) => setFixed(event.target.value)}
              inputMode="decimal"
              leadingIcon={<span className="text-fg-muted">$</span>}
              autoFocus
              data-testid="price-fixed"
            />
          )}
        </Field>
      ) : null}
      {isFixed ? null : (
        <Field label="From which day?" className="sm:col-span-2">
          {() => (
            <ToggleGroup
              label="From which day?"
              value={whole}
              onValueChange={setWhole}
              options={[
                { value: 'day', label: 'From a day I pick' },
                { value: 'all', label: 'The whole job, from the start' },
              ]}
            />
          )}
        </Field>
      )}
      {!isFixed && whole === 'day' ? (
        <Field label="Starts on" error={errors.effectiveFrom}>
          {({ inputId, describedBy, invalid }) => (
            <IsoDatePicker
              id={inputId}
              aria-label="Starts on"
              aria-describedby={describedBy}
              invalid={invalid}
              clearable={false}
              value={from || null}
              onChange={(value) => setFrom(value ?? '')}
              data-testid="price-from"
            />
          )}
        </Field>
      ) : null}
      {isFixed ? null : (
        <Field label="Why it changed" className={whole === 'day' ? '' : 'sm:col-span-2'}>
          {({ inputId }) => (
            <Input
              id={inputId}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder="New contract rate"
            />
          )}
        </Field>
      )}
    </Shell>
  );
}
