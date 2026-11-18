'use client';
/**
 * New job: three short steps (Basics, Price and plan, Review) with a live margin preview that
 * updates as you type. A job can start fresh, from a won CRM deal, from a warehouse work order,
 * or as a copy of a past job. Everything typed here becomes the job's quote.
 */
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  Check,
  ClipboardCopy,
  Handshake,
  Info,
  PackagePlus,
  Plus,
  Sparkles,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react';
import {
  Button,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
  ToggleGroup,
  WizardSteps,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { MarginPill, marginHealth } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { apiGet, apiPath } from '@/lib/api-client';
import {
  JOB_STATUS_LABELS,
  PRICING_MODEL_LABELS,
  type JobKindValue,
  type PricingModelValue,
} from '@/lib/constants';
import {
  formatHours,
  formatMoney,
  formatNumber,
  formatPace,
  formatPercentBp,
  formatUnitPrice,
} from '@/lib/format';
import { useStandardSuggestion } from '@/lib/hooks/use-data';
import { centsToDecimal } from '@/lib/money';
import { shortDate } from '@/lib/profit/calendar';
import type { SharedCostRule } from '@/lib/profit';
import { routes } from '@/lib/routes';
import type {
  ClientDTO,
  JobDetailDTO,
  JobTypeDTO,
  LaborClassDTO,
  OrgPerson,
  SiteDTO,
  VasServiceDTO,
} from '@/lib/types';
import { createJobAction, type CreateJobActionInput } from '@/server/actions/jobs';
import { singularUnit } from './job-math';
import { Explain } from './job-ui';
import {
  previewJob,
  readCents,
  readDecimal,
  type WizardCostLine,
  type WizardServiceLine,
} from './new-job-math';
import type { WonDealSource, WorkOrderSource } from './server/job-sources';

type LinkDraft = {
  readonly targetType: 'crm_deal' | 'wms_work_order' | 'pm_project' | 'crm_account';
  readonly targetId: string;
  readonly title: string;
};

interface FormState {
  readonly client: string;
  readonly name: string;
  readonly jobTypeId: string;
  readonly kind: JobKindValue;
  readonly units: string;
  readonly unitLabel: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly siteId: string;
  readonly ownerId: string;
  readonly pricingModel: PricingModelValue;
  readonly unitPrice: string;
  readonly fixedPrice: string;
  readonly billRate: string;
  readonly laborMode: 'hours' | 'pace';
  readonly laborHours: string;
  readonly pace: string;
  readonly setupHours: string;
  readonly laborClassId: string;
  readonly rate: string;
  readonly partsOwner: 'us' | 'client';
  readonly materialPerUnit: string;
  readonly otherCosts: readonly WizardCostLine[];
  readonly services: readonly WizardServiceLine[];
  readonly targetMargin: string;
  readonly status: 'planned' | 'active';
  readonly poNumber: string;
  readonly description: string;
  readonly kitSku: string;
  readonly kitName: string;
  readonly links: readonly LinkDraft[];
  readonly origin: 'typed' | 'crm_deal' | 'wms_contract';
  readonly originRef: string | null;
  readonly startedFrom: string | null;
}

export interface NewJobWizardProps {
  readonly clients: readonly ClientDTO[];
  readonly jobTypes: readonly JobTypeDTO[];
  readonly sites: readonly SiteDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly services: readonly VasServiceDTO[];
  readonly people: readonly OrgPerson[];
  readonly recentJobs: readonly {
    readonly id: string;
    readonly number: string;
    readonly name: string;
    readonly clientName: string;
  }[];
  readonly deals: readonly WonDealSource[];
  readonly workOrders: readonly WorkOrderSource[];
  readonly seesMoney: boolean;
  readonly defaults: {
    readonly targetMarginBp: number;
    readonly loadedRateCents: number | null;
    readonly partsOwner: 'us' | 'client';
    readonly sharedRule: SharedCostRule;
    readonly sharedPctBp: number;
    readonly shared90Cents: number | null;
    readonly labor90Cents: number | null;
    readonly today: string;
    readonly meId: string;
  };
  readonly prefill: {
    readonly clientName?: string;
    readonly name?: string;
    readonly valueCents?: number | null;
    readonly dealId?: string;
    readonly workOrderId?: string;
    readonly projectId?: string;
    readonly copyJobId?: string;
  };
}

const STEPS = [
  { id: 'basics', title: 'Basics' },
  { id: 'plan', title: 'Price and plan' },
  { id: 'review', title: 'Review' },
] as const;

const dollars = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '' : centsToDecimal(cents);
const trimZeros = (value: string | null | undefined): string =>
  value ? value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '') : '';

export function NewJobWizard(props: NewJobWizardProps) {
  const {
    clients,
    jobTypes,
    sites,
    laborClasses,
    services,
    people,
    recentJobs,
    deals,
    workOrders,
    defaults,
    prefill,
    seesMoney,
  } = props;
  const router = useRouter();
  const formId = useId();
  const clientListId = useId();
  const general = jobTypes.find((type) => type.code === 'GENERAL') ?? jobTypes[0];
  const defaultSite = sites.find((site) => site.isDefault) ?? sites[0];
  const classFor = (type: JobTypeDTO | undefined) =>
    laborClasses.find((item) => item.id === type?.defaultLaborClassId) ??
    laborClasses.find((item) => item.isDefault) ??
    laborClasses[0];
  const rateFor = (laborClass: LaborClassDTO | undefined) =>
    dollars(laborClass?.currentLoadedRateCents ?? defaults.loadedRateCents);

  const blank = (): FormState => {
    const laborClass = classFor(general);
    return {
      client: prefill.clientName ?? '',
      name: prefill.name ?? '',
      jobTypeId: general?.id ?? '',
      kind: 'one_time',
      units: '',
      unitLabel: general?.unitLabel ?? 'units',
      startDate: defaults.today,
      dueDate: '',
      siteId: defaultSite?.id ?? '',
      ownerId: defaults.meId,
      pricingModel: prefill.valueCents ? 'fixed' : (general?.defaultPricingModel ?? 'per_unit'),
      unitPrice: '',
      fixedPrice: dollars(prefill.valueCents),
      billRate: '',
      laborMode: general?.defaultStandardUph ? 'pace' : 'hours',
      laborHours: '',
      pace: trimZeros(general?.defaultStandardUph),
      setupHours: '',
      laborClassId: laborClass?.id ?? '',
      rate: rateFor(laborClass),
      partsOwner: defaults.partsOwner,
      materialPerUnit: '',
      otherCosts: [],
      services: [],
      targetMargin: trimZeros(String((general?.targetMarginBp ?? defaults.targetMarginBp) / 100)),
      status: 'planned',
      poNumber: '',
      description: '',
      kitSku: '',
      kitName: '',
      links: prefill.projectId
        ? [{ targetType: 'pm_project', targetId: prefill.projectId, title: 'Project' }]
        : [],
      origin: 'typed',
      originRef: null,
      startedFrom: null,
    };
  };

  const fromDeal = (deal: WonDealSource, base: FormState): FormState => ({
    ...base,
    name: deal.name,
    client:
      clients.find(
        (item) =>
          (deal.accountItemId && item.crmAccountItemId === deal.accountItemId) ||
          (deal.coreCustomerId && item.coreCustomerId === deal.coreCustomerId),
      )?.name ??
      deal.accountName ??
      base.client,
    pricingModel: deal.valueCents ? 'fixed' : base.pricingModel,
    fixedPrice: dollars(deal.valueCents),
    startDate: deal.closeDate && deal.closeDate >= defaults.today ? deal.closeDate : base.startDate,
    links: [
      ...base.links.filter((link) => link.targetType !== 'crm_deal'),
      { targetType: 'crm_deal', targetId: deal.id, title: deal.name },
    ],
    origin: 'crm_deal',
    originRef: deal.id,
    startedFrom: `the won deal "${deal.name}"`,
  });

  const fromWorkOrder = (order: WorkOrderSource, base: FormState): FormState => ({
    ...base,
    name: order.kitName ? `${order.kitName} (${order.code})` : `Work order ${order.code}`,
    client:
      clients.find((item) => order.coreCustomerId && item.coreCustomerId === order.coreCustomerId)?.name ??
      order.clientName ??
      base.client,
    units: String(order.requestedQty || ''),
    unitLabel: 'kits',
    dueDate: order.plannedFinish ?? base.dueDate,
    // A work order that is already late keeps its real due date; the start moves back to it so the
    // filled in form is valid the moment it opens.
    startDate: order.plannedFinish && base.startDate && order.plannedFinish < base.startDate ? order.plannedFinish : base.startDate,
    siteId: sites.find((site) => site.wmsWarehouseId === order.warehouseId)?.id ?? base.siteId,
    partsOwner: 'client',
    kitSku: order.kitSku ?? '',
    kitName: order.kitName ?? '',
    status: order.status === 'Open' ? 'planned' : 'active',
    links: [
      ...base.links.filter((link) => link.targetType !== 'wms_work_order'),
      { targetType: 'wms_work_order', targetId: order.id, title: order.code },
    ],
    startedFrom: `work order ${order.code}`,
  });

  const [form, setForm] = useState<FormState>(() => {
    let state = blank();
    const deal = prefill.dealId ? deals.find((item) => item.id === prefill.dealId) : undefined;
    const order = prefill.workOrderId
      ? workOrders.find((item) => item.id === prefill.workOrderId)
      : undefined;
    if (deal) state = fromDeal(deal, state);
    else if (prefill.dealId)
      state = {
        ...state,
        links: [...state.links, { targetType: 'crm_deal', targetId: prefill.dealId, title: 'CRM deal' }],
        origin: 'crm_deal',
        originRef: prefill.dealId,
      };
    if (order) state = fromWorkOrder(order, state);
    else if (prefill.workOrderId)
      state = {
        ...state,
        links: [
          ...state.links,
          { targetType: 'wms_work_order', targetId: prefill.workOrderId, title: 'Work order' },
        ],
      };
    return state;
  });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: '' } : current));
  };

  const jobType = jobTypes.find((type) => type.id === form.jobTypeId);
  const unit = singularUnit(form.unitLabel);
  const targetMarginBp = Math.round(
    Number(readDecimal(form.targetMargin, 2) ?? defaults.targetMarginBp / 100) * 100,
  );
  const matchedClient = clients.find((item) => item.name.toLowerCase() === form.client.trim().toLowerCase());
  const suggestion = useStandardSuggestion(
    {
      jobTypeId: form.jobTypeId || null,
      clientId: matchedClient?.id ?? null,
      laborClassId: form.laborClassId || null,
    },
    { enabled: step === 1 && Boolean(form.jobTypeId) },
  );

  const preview = useMemo(
    () =>
      previewJob({
        pricingModel: form.pricingModel,
        units: form.units,
        unitPrice: form.unitPrice,
        fixedPrice: form.fixedPrice,
        billRate: form.billRate,
        laborMode: form.laborMode,
        laborHours: form.laborHours,
        pace: form.pace,
        setupHours: form.setupHours,
        rate: form.rate,
        laborClassId: form.laborClassId || null,
        materialPerUnit: form.materialPerUnit,
        partsOwner: form.partsOwner,
        otherCosts: form.otherCosts,
        services: form.services,
        targetMarginBp,
        sharedRule: defaults.sharedRule,
        sharedPctBp: defaults.sharedPctBp,
        shared90Cents: defaults.shared90Cents,
        labor90Cents: defaults.labor90Cents,
      }),
    [form, targetMarginBp, defaults],
  );

  const pickJobType = (id: string) => {
    const type = jobTypes.find((item) => item.id === id);
    const laborClass = classFor(type);
    setForm((current) => ({
      ...current,
      jobTypeId: id,
      unitLabel: type?.unitLabel ?? current.unitLabel,
      pricingModel:
        current.origin === 'crm_deal'
          ? current.pricingModel
          : (type?.defaultPricingModel ?? current.pricingModel),
      laborClassId: laborClass?.id ?? current.laborClassId,
      rate: rateFor(laborClass) || current.rate,
      pace: type?.defaultStandardUph ? trimZeros(type.defaultStandardUph) : current.pace,
      laborMode: type?.defaultStandardUph && !current.laborHours ? 'pace' : current.laborMode,
      targetMargin:
        type?.targetMarginBp !== null && type?.targetMarginBp !== undefined
          ? trimZeros(String(type.targetMarginBp / 100))
          : current.targetMargin,
    }));
  };

  const copyFrom = async (jobId: string) => {
    if (!jobId) return;
    setCopying(true);
    try {
      const job = await apiGet<JobDetailDTO>(apiPath(`jobs/${encodeURIComponent(jobId)}`));
      const plan = job.budget ?? job.quote;
      setForm((current) => ({
        ...current,
        client: job.clientName,
        name: current.name || job.name,
        jobTypeId: job.jobTypeId,
        kind: job.kind,
        units: trimZeros(job.plannedUnits),
        unitLabel: job.unitLabel,
        siteId: job.siteId,
        pricingModel: job.pricingModel,
        unitPrice: trimZeros(job.unitPrice),
        fixedPrice: dollars(job.fixedPriceCents),
        billRate: dollars(job.billRateCents),
        laborMode:
          plan && Number(plan.laborHours) > 0 ? 'hours' : job.standardUph ? 'pace' : current.laborMode,
        laborHours: plan ? trimZeros(plan.laborHours) : '',
        setupHours: plan && Number(plan.setupHours) > 0 ? trimZeros(plan.setupHours) : '',
        pace: trimZeros(job.standardUph) || current.pace,
        laborClassId: job.defaultLaborClassId ?? current.laborClassId,
        rate: rateFor(laborClasses.find((item) => item.id === job.defaultLaborClassId)) || current.rate,
        partsOwner: job.partsOwner ?? current.partsOwner,
        materialPerUnit: trimZeros(job.materialCostPerUnit),
        otherCosts:
          plan && plan.otherCents
            ? [{ label: `Other costs, as on ${job.number}`, amount: dollars(plan.otherCents) }]
            : [],
        targetMargin:
          job.targetMarginBp !== null ? trimZeros(String(job.targetMarginBp / 100)) : current.targetMargin,
        kitSku: job.kitSku ?? '',
        kitName: job.kitName ?? '',
        startedFrom: `a copy of ${job.number}`,
      }));
      toast.success(`Filled in from ${job.number}`, 'Check the units, the price and the dates, then save.');
    } catch (error) {
      toast.error("Couldn't read that job", error instanceof Error ? error.message : 'Try again.');
    } finally {
      setCopying(false);
    }
  };

  const validate = (upTo: number): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!form.client.trim()) next.client = 'Pick a client or type a new name.';
    if (!form.name.trim()) next.name = 'Give the job a name.';
    if (form.units.trim() && readDecimal(form.units, 3) === null) next.units = 'Type a number, like 5000.';
    if (form.kind === 'one_time' && form.pricingModel === 'per_unit' && !form.units.trim())
      next.units = 'How many will you make?';
    if (form.startDate && form.dueDate && form.dueDate < form.startDate)
      next.dueDate = 'The due date is before the start date.';
    if (upTo >= 1) {
      const money = (key: keyof FormState, scale: number, message: string) => {
        const text = String(form[key] ?? '').trim();
        if (text && readDecimal(text, scale) === null) next[key] = message;
      };
      money('unitPrice', 4, 'Type a price, like 1.25.');
      money('fixedPrice', 2, 'Type an amount, like 12500.');
      money('billRate', 2, 'Type a rate, like 38.');
      money('laborHours', 2, 'Type hours, like 120.');
      money('pace', 3, 'Type a pace, like 40.');
      money('setupHours', 2, 'Type hours, like 2.');
      money('rate', 2, 'Type a cost, like 22.50.');
      money('materialPerUnit', 4, 'Type a cost, like 0.45.');
      money('targetMargin', 2, 'Type a percent, like 30.');
      if (form.laborMode === 'pace' && form.pace.trim() && Number(readDecimal(form.pace, 3)) === 0)
        next.pace = 'The pace has to be above zero.';
      if (
        form.laborMode === 'hours' &&
        readDecimal(form.setupHours, 2) &&
        Number(readDecimal(form.setupHours, 2)) > Number(readDecimal(form.laborHours, 2) ?? 0)
      )
        next.setupHours = 'Setup hours are part of the labor hours, so they cannot be more.';
      form.otherCosts.forEach((cost, index) => {
        if (cost.amount.trim() && readCents(cost.amount) === null)
          next[`other.${index}`] = 'Type an amount, like 250.';
      });
      form.services.forEach((service, index) => {
        if (
          (service.quantity.trim() && readDecimal(service.quantity, 3) === null) ||
          (service.price.trim() && readDecimal(service.price, 4) === null) ||
          (service.cost.trim() && readDecimal(service.cost, 4) === null)
        )
          next[`service.${index}`] = 'Use plain numbers for the quantity, price and cost.';
      });
    }
    return next;
  };

  const goTo = (target: number) => {
    if (target > step) {
      const found = validate(step);
      setErrors(found);
      if (Object.keys(found).length > 0) {
        toast.error('Something needs a second look', Object.values(found)[0]);
        return;
      }
    }
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    const found = validate(2);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const firstKey = Object.keys(found)[0] ?? '';
      setStep(['client', 'name', 'units', 'dueDate'].includes(firstKey) ? 0 : 1);
      toast.error('Something needs a second look', Object.values(found)[0]);
      return;
    }
    const units = readDecimal(form.units, 3) ?? '0';
    const hasQuote = preview.ready;
    const input: CreateJobActionInput = {
      name: form.name.trim(),
      clientId: matchedClient?.id ?? null,
      clientName: matchedClient ? null : form.client.trim(),
      jobTypeId: form.jobTypeId || null,
      siteId: form.siteId || null,
      kind: form.kind,
      status: form.status,
      pricingModel: form.pricingModel,
      unitLabel: form.unitLabel.trim() || null,
      plannedUnits: units,
      unitPrice: form.pricingModel === 'per_unit' ? readDecimal(form.unitPrice, 4) : null,
      fixedPriceCents: form.pricingModel === 'fixed' ? readCents(form.fixedPrice) : null,
      billRateCents: form.pricingModel === 'hourly' ? readCents(form.billRate) : null,
      materialMethod: 'standard',
      materialCostPerUnit: form.partsOwner === 'client' ? '0' : (readDecimal(form.materialPerUnit, 4) ?? '0'),
      partsOwner: form.partsOwner,
      defaultLaborClassId: form.laborClassId || null,
      standardUph:
        form.laborMode === 'pace' && readDecimal(form.pace, 3) && Number(readDecimal(form.pace, 3)) > 0
          ? readDecimal(form.pace, 3)
          : null,
      targetMarginBp:
        jobType?.targetMarginBp === targetMarginBp ||
        (jobType?.targetMarginBp === null && targetMarginBp === defaults.targetMarginBp)
          ? null
          : targetMarginBp,
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      poNumber: form.poNumber.trim() || null,
      ownerId: form.ownerId || null,
      description: form.description.trim() || null,
      kitSku: form.kitSku.trim() || null,
      kitName: form.kitName.trim() || null,
      quote: hasQuote
        ? {
            lines: preview.lines.map((line) => ({ ...line })),
            sharedCents: null,
            origin: form.origin,
            originRef: form.originRef,
          }
        : null,
      links: form.links.map((link) => ({
        targetType: link.targetType,
        targetId: link.targetId,
        title: link.title,
      })),
    };
    setSaving(true);
    const result = await createJobAction(input).catch(() => null);
    setSaving(false);
    if (!result) {
      toast.error("Couldn't save the job", 'Check your connection and try again.');
      return;
    }
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      toast.error("Couldn't save the job", result.error.message);
      return;
    }
    toast.success(
      `Created ${result.data.number}`,
      form.status === 'active'
        ? 'It is active. Log the first day of work when it happens.'
        : 'It is planned. Start it when the work begins.',
    );
    router.push(routes.job(result.data.number));
  };

  const priceLabel =
    form.pricingModel === 'per_unit'
      ? `Price for one ${unit}`
      : form.pricingModel === 'fixed'
        ? 'Price for the whole job'
        : 'What you bill for one hour';
  const health =
    preview.figures.marginBp === null ? 'none' : marginHealth(preview.figures.marginBp, targetMarginBp);

  const previewCard = (
    <aside
      aria-label="Margin preview"
      data-testid="wizard-preview"
      className="rounded-xl border border-border-subtle bg-panel shadow-xs lg:sticky lg:top-4"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <h2 className="text-base font-semibold text-fg">What this job should earn</h2>
        {seesMoney && preview.ready ? (
          <Explain
            title="Planned profit"
            rule="Profit is revenue less every cost: labor, material, other costs and this job's share of time not on a job. Margin is profit as a share of revenue."
            rows={[
              { label: 'Revenue', value: formatMoney(preview.figures.revenueCents) },
              { label: 'Labor', value: formatMoney(preview.laborCents), kind: 'minus' },
              { label: 'Material', value: formatMoney(preview.materialCents), kind: 'minus' },
              { label: 'Other costs', value: formatMoney(preview.otherCents), kind: 'minus' },
              { label: 'Time not on a job', value: formatMoney(preview.sharedCents), kind: 'minus' },
              { label: 'Profit', value: formatMoney(preview.figures.profitCents), kind: 'total' },
            ]}
            footnote="Time not on a job is your workspace's usual share of meetings, cleanup and waiting, worked out from the last 90 days."
          />
        ) : null}
      </header>
      {!seesMoney ? (
        <p className="px-4 py-6 text-sm text-fg-secondary">
          Your role does not show money, so the preview is hidden. The plan is still saved with the job.
        </p>
      ) : !preview.ready ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-xl bg-primary-subtle text-primary-text"
          >
            <BadgeDollarSign className="size-5" />
          </span>
          <p className="text-sm text-fg-secondary">
            Type the units, a price and the labor plan. The margin shows up here as you go.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-fg-muted">Margin after all costs</p>
              <p
                className={cn(
                  'text-xl font-semibold tracking-tight tabular-nums',
                  (preview.figures.marginBp ?? 0) < 0 ? 'text-danger-text' : 'text-fg',
                )}
                data-testid="preview-margin"
              >
                {formatPercentBp(preview.figures.marginBp, { empty: 'No revenue yet' })}
              </p>
            </div>
            <MarginPill health={health} />
          </div>
          <p className="text-xs text-fg-secondary" data-testid="preview-verdict">
            {preview.figures.marginBp === null
              ? 'Add a price to see the margin.'
              : preview.marginGapBp !== null && preview.marginGapBp >= 0
                ? `That is at or above your ${formatPercentBp(targetMarginBp, { digits: 0 })} target.`
                : `That is under your ${formatPercentBp(targetMarginBp, { digits: 0 })} target.${preview.targetPrice ? ` A price of ${formatUnitPrice(preview.targetPrice)} a ${unit} would reach it.` : ''}`}
          </p>
          <dl className="flex flex-col text-sm tabular-nums">
            <PreviewRow label="Revenue" value={formatMoney(preview.figures.revenueCents)} strong />
            {preview.serviceRevenueCents > BigInt(0) ? (
              <PreviewRow
                label="of that, extra services"
                value={formatMoney(preview.serviceRevenueCents)}
                muted
              />
            ) : null}
            <PreviewRow
              label={`Labor, ${formatHours(preview.totalHours, { style: 'unit' })}`}
              value={formatMoney(preview.laborCents)}
            />
            <PreviewRow
              label="Material"
              value={form.partsOwner === 'client' ? 'Client supplies' : formatMoney(preview.materialCents)}
            />
            <PreviewRow label="Other costs" value={formatMoney(preview.otherCents)} />
            <PreviewRow label="Time not on a job" value={formatMoney(preview.sharedCents)} />
            <PreviewRow label="Total cost" value={formatMoney(preview.figures.costCents)} strong divider />
            <PreviewRow
              label="Profit"
              value={formatMoney(preview.figures.profitCents)}
              strong
              tone={preview.figures.profitCents < BigInt(0) ? 'bad' : 'good'}
              testId="preview-profit"
            />
            <PreviewRow
              label="Margin before time not on a job"
              value={formatPercentBp(preview.marginBeforeSharedBp, { empty: 'None yet' })}
              muted
            />
          </dl>
          {form.pricingModel === 'per_unit' && preview.breakevenPrice ? (
            <div
              className="rounded-lg border border-border-subtle bg-sunken px-3 py-2.5 text-sm"
              data-testid="preview-breakeven"
            >
              <p className="font-medium text-fg">Breakeven</p>
              <p className="mt-0.5 text-fg-secondary">
                You stop losing money at{' '}
                <span className="font-medium text-fg tabular-nums">
                  {formatUnitPrice(preview.breakevenPrice)}
                </span>{' '}
                a {unit}.
                {preview.breakevenUnits !== null && preview.breakevenUnits > 0 ? (
                  <>
                    {' '}
                    At your price, the first{' '}
                    <span className="font-medium text-fg tabular-nums">
                      {formatNumber(preview.breakevenUnits)}
                    </span>{' '}
                    {form.unitLabel || 'units'} pay back the setup and other fixed costs.
                  </>
                ) : null}
                {readDecimal(form.unitPrice, 4) && preview.breakevenUnits === null
                  ? ' At your price each one costs more to make than it sells for.'
                  : null}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="new-job-wizard">
      <div className="flex min-w-0 flex-col gap-4">
        <WizardSteps steps={STEPS.map((item) => ({ id: item.id, title: item.title }))} current={step} />

        {step === 0 ? (
          <>
            {deals.length > 0 || workOrders.length > 0 || recentJobs.length > 0 ? (
              <Panel title="Start faster">
                <div className="flex flex-col gap-3">
                  {form.startedFrom ? (
                    <p
                      className="flex items-start gap-2 rounded-lg bg-success-subtle px-3 py-2 text-sm text-success-text"
                      data-testid="wizard-started-from"
                    >
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        Filled in from {form.startedFrom}. Check each box before you save.
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
                        onClick={() => setForm(blank())}
                      >
                        Start over
                      </button>
                    </p>
                  ) : (
                    <p className="text-sm text-fg-secondary">
                      Start from something you already have, or skip this and type the job in below.
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {deals.length > 0 ? (
                      <SourcePicker
                        icon={<Handshake aria-hidden />}
                        label="A won deal"
                        hint="From your CRM. Brings the name, the client and the deal value."
                        testId="source-deal"
                        options={deals.map((deal) => ({
                          value: deal.id,
                          label: deal.name,
                          description: [
                            deal.accountName,
                            deal.valueCents !== null ? formatMoney(deal.valueCents, { cents: false }) : null,
                            deal.closeDate ? `won ${shortDate(deal.closeDate)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                        }))}
                        onPick={(id) => {
                          const deal = deals.find((item) => item.id === id);
                          if (deal) setForm((current) => fromDeal(deal, current));
                        }}
                      />
                    ) : null}
                    {workOrders.length > 0 ? (
                      <SourcePicker
                        icon={<Warehouse aria-hidden />}
                        label="A warehouse work order"
                        hint="From your WMS. Brings the kit, the client and the units to build."
                        testId="source-work-order"
                        options={workOrders.map((order) => ({
                          value: order.id,
                          label: `${order.code}${order.kitName ? `: ${order.kitName}` : ''}`,
                          description: [
                            order.clientName,
                            `${formatNumber(order.requestedQty)} to build`,
                            order.status,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                        }))}
                        onPick={(id) => {
                          const order = workOrders.find((item) => item.id === id);
                          if (order) setForm((current) => fromWorkOrder(order, current));
                        }}
                      />
                    ) : null}
                    {recentJobs.length > 0 ? (
                      <SourcePicker
                        icon={<ClipboardCopy aria-hidden />}
                        label="A past job"
                        hint="Copies the client, the price and the plan. No entries come along."
                        testId="source-job"
                        loading={copying}
                        options={recentJobs.map((job) => ({
                          value: job.id,
                          label: `${job.number}: ${job.name}`,
                          description: job.clientName,
                        }))}
                        onPick={(id) => void copyFrom(id)}
                      />
                    ) : null}
                  </div>
                </div>
              </Panel>
            ) : null}

            <Panel title="Basics">
              <form
                id={`${formId}-0`}
                className="grid gap-4 sm:grid-cols-2"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  goTo(1);
                }}
              >
                <Field
                  label="Client"
                  required
                  error={errors.client || errors.clientId}
                  hint={
                    form.client.trim() && !matchedClient
                      ? `"${form.client.trim()}" is new. Pulse adds it as a client when you save.`
                      : 'Who the work is for.'
                  }
                >
                  {({ inputId, describedBy, invalid }) => (
                    <>
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        list={clientListId}
                        value={form.client}
                        onChange={(event) => set('client', event.target.value)}
                        placeholder="Pick or type a client"
                        autoComplete="off"
                        size="lg"
                        data-testid="wizard-client"
                      />
                      <datalist id={clientListId}>
                        {clients.map((item) => (
                          <option key={item.id} value={item.name} />
                        ))}
                      </datalist>
                    </>
                  )}
                </Field>
                <Field
                  label="Job name"
                  required
                  error={errors.name}
                  hint="What you would call it on the floor."
                >
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form.name}
                      onChange={(event) => set('name', event.target.value)}
                      placeholder="Holiday gift kits"
                      maxLength={200}
                      size="lg"
                      data-testid="wizard-name"
                    />
                  )}
                </Field>
                <Field label="Kind of work" hint="Sets the unit word, the usual pace and the target margin.">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      aria-label="Kind of work"
                      size="lg"
                      value={form.jobTypeId}
                      onValueChange={pickJobType}
                      options={jobTypes.map((type) => ({ value: type.id, label: type.name }))}
                    />
                  )}
                </Field>
                <Field label="How long does it run?">
                  {() => (
                    <ToggleGroup
                      label="How long does it run?"
                      value={form.kind}
                      onValueChange={(value) => set('kind', value)}
                      options={[
                        { value: 'one_time', label: 'One time, with an end' },
                        { value: 'ongoing', label: 'Ongoing, month after month' },
                      ]}
                    />
                  )}
                </Field>
                <Field
                  label={form.kind === 'ongoing' ? 'Units in a usual month' : 'Units to make'}
                  required={form.kind === 'one_time' && form.pricingModel === 'per_unit'}
                  error={errors.units || errors.plannedUnits}
                  hint={
                    form.kind === 'ongoing'
                      ? 'A good guess is fine. Leave it blank if it changes a lot.'
                      : 'The whole job, start to finish.'
                  }
                >
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form.units}
                      onChange={(event) => set('units', event.target.value)}
                      placeholder="5000"
                      inputMode="decimal"
                      size="lg"
                      data-testid="wizard-units"
                    />
                  )}
                </Field>
                <Field
                  label="What do you call one?"
                  hint="Kits, boxes, pallets, cases. Shows up next to every count."
                >
                  {({ inputId }) => (
                    <Input
                      id={inputId}
                      value={form.unitLabel}
                      onChange={(event) => set('unitLabel', event.target.value)}
                      placeholder="kits"
                      maxLength={30}
                      size="lg"
                    />
                  )}
                </Field>
                <Field label="Start date">
                  {({ inputId }) => (
                    <Input
                      id={inputId}
                      type="date"
                      value={form.startDate}
                      onChange={(event) => set('startDate', event.target.value)}
                      size="lg"
                    />
                  )}
                </Field>
                <Field
                  label="Due date"
                  error={errors.dueDate}
                  hint="Pulse warns you when the pace will miss it."
                >
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="date"
                      value={form.dueDate}
                      onChange={(event) => set('dueDate', event.target.value)}
                      size="lg"
                      data-testid="wizard-due"
                    />
                  )}
                </Field>
                {sites.length > 1 ? (
                  <Field label="Site">
                    {({ inputId }) => (
                      <Select
                        id={inputId}
                        aria-label="Site"
                        size="lg"
                        value={form.siteId}
                        onValueChange={(value) => set('siteId', value)}
                        options={sites.map((site) => ({ value: site.id, label: site.name }))}
                      />
                    )}
                  </Field>
                ) : null}
                <Field label="Owner" hint="Who gets the alerts for this job.">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      aria-label="Owner"
                      size="lg"
                      value={form.ownerId || 'none'}
                      onValueChange={(value) => set('ownerId', value === 'none' ? '' : value)}
                      options={[
                        { value: 'none', label: 'No owner' },
                        ...people.map((person) => ({ value: person.id, label: person.name })),
                      ]}
                    />
                  )}
                </Field>
              </form>
            </Panel>
          </>
        ) : null}

        {step === 1 ? (
          <form
            id={`${formId}-1`}
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              goTo(2);
            }}
          >
            <Panel title="Price">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="How do you charge?" className="sm:col-span-2">
                  {() => (
                    <ToggleGroup
                      label="How do you charge?"
                      value={form.pricingModel}
                      onValueChange={(value) => set('pricingModel', value)}
                      options={[
                        { value: 'per_unit', label: PRICING_MODEL_LABELS.per_unit },
                        { value: 'fixed', label: PRICING_MODEL_LABELS.fixed },
                        { value: 'hourly', label: PRICING_MODEL_LABELS.hourly },
                      ]}
                    />
                  )}
                </Field>
                {form.pricingModel === 'per_unit' ? (
                  <Field
                    label={priceLabel}
                    error={errors.unitPrice}
                    hint={
                      preview.targetPrice && seesMoney
                        ? `${formatUnitPrice(preview.targetPrice)} reaches your target margin.`
                        : 'Up to 4 decimal places.'
                    }
                  >
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={form.unitPrice}
                        onChange={(event) => set('unitPrice', event.target.value)}
                        placeholder="1.25"
                        inputMode="decimal"
                        size="lg"
                        leadingIcon={<span className="text-fg-muted">$</span>}
                        data-testid="wizard-price"
                      />
                    )}
                  </Field>
                ) : null}
                {form.pricingModel === 'fixed' ? (
                  <Field
                    label={priceLabel}
                    error={errors.fixedPrice || errors.fixedPriceCents}
                    hint={
                      form.origin === 'crm_deal'
                        ? 'This is the deal value from your CRM.'
                        : 'One amount for all the work.'
                    }
                  >
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={form.fixedPrice}
                        onChange={(event) => set('fixedPrice', event.target.value)}
                        placeholder="12500"
                        inputMode="decimal"
                        size="lg"
                        leadingIcon={<span className="text-fg-muted">$</span>}
                        data-testid="wizard-fixed"
                      />
                    )}
                  </Field>
                ) : null}
                {form.pricingModel === 'hourly' ? (
                  <Field
                    label={priceLabel}
                    error={errors.billRate || errors.billRateCents}
                    hint="Revenue is the hours worked times this rate."
                  >
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={form.billRate}
                        onChange={(event) => set('billRate', event.target.value)}
                        placeholder="38"
                        inputMode="decimal"
                        size="lg"
                        leadingIcon={<span className="text-fg-muted">$</span>}
                        data-testid="wizard-bill-rate"
                      />
                    )}
                  </Field>
                ) : null}
                <Field
                  label="Target margin"
                  error={errors.targetMargin}
                  hint="The margin you want after all costs."
                >
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form.targetMargin}
                      onChange={(event) => set('targetMargin', event.target.value)}
                      inputMode="decimal"
                      size="lg"
                      trailing={<span className="text-fg-muted">%</span>}
                      data-testid="wizard-target"
                    />
                  )}
                </Field>
              </div>
            </Panel>

            <Panel title="Labor plan">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="What do you know?" className="sm:col-span-2">
                  {() => (
                    <ToggleGroup
                      label="What do you know about the labor?"
                      value={form.laborMode}
                      onValueChange={(value) => set('laborMode', value)}
                      options={[
                        { value: 'hours', label: 'The hours it will take' },
                        { value: 'pace', label: 'How fast one person works' },
                      ]}
                    />
                  )}
                </Field>
                {form.laborMode === 'hours' ? (
                  <Field
                    label="Labor hours for the whole job"
                    error={errors.laborHours}
                    hint="People times hours. 4 people for 30 hours is 120."
                  >
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={form.laborHours}
                        onChange={(event) => set('laborHours', event.target.value)}
                        placeholder="120"
                        inputMode="decimal"
                        size="lg"
                        data-testid="wizard-hours"
                      />
                    )}
                  </Field>
                ) : (
                  <Field
                    label={`${form.unitLabel ? form.unitLabel.charAt(0).toUpperCase() + form.unitLabel.slice(1) : 'Units'} one person finishes in an hour`}
                    error={errors.pace || errors.standardUph}
                    hint={
                      suggestion.data?.median
                        ? `Past jobs like this ran at ${formatPace(suggestion.data.median)} (from ${formatPace(suggestion.data.low)} to ${formatPace(suggestion.data.high)}).`
                        : preview.runHours > 0
                          ? `That makes ${formatHours(preview.runHours, { style: 'unit' })} of work.`
                          : 'This becomes the target pace for the job.'
                    }
                    labelAside={
                      suggestion.data?.median ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-sm text-2xs font-medium text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                          onClick={() => set('pace', trimZeros(suggestion.data?.median ?? ''))}
                        >
                          <Sparkles aria-hidden className="size-3" />
                          Use {formatPace(suggestion.data.median)}
                        </button>
                      ) : undefined
                    }
                  >
                    {({ inputId, describedBy, invalid }) => (
                      <Input
                        id={inputId}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        value={form.pace}
                        onChange={(event) => set('pace', event.target.value)}
                        placeholder="40"
                        inputMode="decimal"
                        size="lg"
                        data-testid="wizard-pace"
                      />
                    )}
                  </Field>
                )}
                <Field
                  label="Setup hours"
                  error={errors.setupHours}
                  hint={
                    form.laborMode === 'hours'
                      ? 'Part of the hours above. Time that makes no units.'
                      : 'Added on top. Time that makes no units.'
                  }
                >
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form.setupHours}
                      onChange={(event) => set('setupHours', event.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                      size="lg"
                      data-testid="wizard-setup"
                    />
                  )}
                </Field>
                {laborClasses.length > 0 ? (
                  <Field label="Who does the work?" hint="Sets the real cost of an hour.">
                    {({ inputId }) => (
                      <Select
                        id={inputId}
                        aria-label="Who does the work?"
                        size="lg"
                        value={form.laborClassId || undefined}
                        placeholder="Pick a labor class"
                        onValueChange={(value) => {
                          const laborClass = laborClasses.find((item) => item.id === value);
                          setForm((current) => ({
                            ...current,
                            laborClassId: value,
                            rate: rateFor(laborClass) || current.rate,
                          }));
                        }}
                        options={laborClasses.map((item) => ({ value: item.id, label: item.name }))}
                      />
                    )}
                  </Field>
                ) : null}
                <Field
                  label="Real cost of an hour"
                  error={errors.rate}
                  hint="Wage plus taxes, benefits and overhead. Used for this plan only."
                >
                  {({ inputId, describedBy, invalid }) => (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form.rate}
                      onChange={(event) => set('rate', event.target.value)}
                      placeholder="22.50"
                      inputMode="decimal"
                      size="lg"
                      leadingIcon={<span className="text-fg-muted">$</span>}
                      data-testid="wizard-rate"
                    />
                  )}
                </Field>
              </div>
            </Panel>

            <Panel title="Material and other costs">
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Who buys the parts?">
                    {() => (
                      <ToggleGroup
                        label="Who buys the parts?"
                        value={form.partsOwner}
                        onValueChange={(value) => set('partsOwner', value)}
                        options={[
                          { value: 'us', label: 'We do' },
                          { value: 'client', label: 'The client does' },
                        ]}
                      />
                    )}
                  </Field>
                  {form.partsOwner === 'us' ? (
                    <Field
                      label={`Material cost for one ${unit}`}
                      error={errors.materialPerUnit || errors.materialCostPerUnit}
                      hint="Boxes, inserts, labels: what you buy for each one."
                    >
                      {({ inputId, describedBy, invalid }) => (
                        <Input
                          id={inputId}
                          aria-describedby={describedBy}
                          invalid={invalid}
                          value={form.materialPerUnit}
                          onChange={(event) => set('materialPerUnit', event.target.value)}
                          placeholder="0.45"
                          inputMode="decimal"
                          size="lg"
                          leadingIcon={<span className="text-fg-muted">$</span>}
                          data-testid="wizard-material"
                        />
                      )}
                    </Field>
                  ) : (
                    <p className="flex items-start gap-2 self-end rounded-lg bg-sunken px-3 py-2.5 text-sm text-fg-secondary">
                      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                      The client supplies the parts, so material costs you nothing on this job.
                    </p>
                  )}
                </div>

                <fieldset className="flex flex-col gap-2">
                  <legend className="text-xs font-medium text-fg-secondary">
                    Other costs for the whole job
                  </legend>
                  {form.otherCosts.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      Freight, pallets, outside help, tooling. Add one line for each.
                    </p>
                  ) : null}
                  {form.otherCosts.map((cost, index) => (
                    <div key={index} className="flex flex-col gap-1">
                      <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2">
                        <Input
                          aria-label={`Other cost ${index + 1}, what it is`}
                          value={cost.label}
                          onChange={(event) =>
                            set(
                              'otherCosts',
                              form.otherCosts.map((item, at) =>
                                at === index ? { ...item, label: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Freight in"
                          maxLength={120}
                          data-testid={`wizard-other-label-${index}`}
                        />
                        <Input
                          aria-label={`Other cost ${index + 1}, amount`}
                          value={cost.amount}
                          invalid={Boolean(errors[`other.${index}`])}
                          onChange={(event) =>
                            set(
                              'otherCosts',
                              form.otherCosts.map((item, at) =>
                                at === index ? { ...item, amount: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="250"
                          inputMode="decimal"
                          leadingIcon={<span className="text-fg-muted">$</span>}
                          data-testid={`wizard-other-amount-${index}`}
                        />
                        <IconButton
                          label={`Remove other cost ${index + 1}`}
                          icon={<Trash2 aria-hidden />}
                          size="sm"
                          onClick={() =>
                            set(
                              'otherCosts',
                              form.otherCosts.filter((_, at) => at !== index),
                            )
                          }
                        />
                      </div>
                      {errors[`other.${index}`] ? (
                        <p role="alert" className="text-2xs font-medium text-danger-text">
                          {errors[`other.${index}`]}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    leadingIcon={<Plus aria-hidden />}
                    onClick={() => set('otherCosts', [...form.otherCosts, { label: '', amount: '' }])}
                    data-testid="wizard-add-other"
                  >
                    Add a cost
                  </Button>
                </fieldset>

                <fieldset className="flex flex-col gap-2">
                  <legend className="text-xs font-medium text-fg-secondary">
                    Extra services sold with the job
                  </legend>
                  {form.services.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      Labeling, gift wrap, inserts, rework. Each one adds revenue and its own cost.
                    </p>
                  ) : null}
                  {form.services.map((service, index) => (
                    <div
                      key={index}
                      className="flex flex-col gap-1 rounded-lg border border-border-subtle p-2"
                    >
                      <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1.4fr)_90px_110px_110px_auto]">
                        {services.length > 0 ? (
                          <div className="col-span-2 sm:col-span-1">
                            <Select
                              aria-label={`Extra service ${index + 1}`}
                              value={service.serviceId ?? undefined}
                              placeholder="Pick a service"
                              onValueChange={(value) => {
                                const picked = services.find((item) => item.id === value);
                                set(
                                  'services',
                                  form.services.map((item, at) =>
                                    at === index
                                      ? {
                                          ...item,
                                          serviceId: value,
                                          label: picked?.name ?? item.label,
                                          price: trimZeros(picked?.defaultPrice) || item.price,
                                          cost: trimZeros(picked?.defaultCostPerUnit) || item.cost,
                                        }
                                      : item,
                                  ),
                                );
                              }}
                              options={services.map((item) => ({ value: item.id, label: item.name }))}
                            />
                          </div>
                        ) : (
                          <div className="col-span-2 sm:col-span-1">
                            <Input
                              aria-label={`Extra service ${index + 1}, name`}
                              value={service.label}
                              onChange={(event) =>
                                set(
                                  'services',
                                  form.services.map((item, at) =>
                                    at === index ? { ...item, label: event.target.value } : item,
                                  ),
                                )
                              }
                              placeholder="Gift wrap"
                              maxLength={120}
                            />
                          </div>
                        )}
                        <Input
                          aria-label={`Extra service ${index + 1}, how many`}
                          value={service.quantity}
                          onChange={(event) =>
                            set(
                              'services',
                              form.services.map((item, at) =>
                                at === index ? { ...item, quantity: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="How many"
                          inputMode="decimal"
                          data-testid={`wizard-service-qty-${index}`}
                        />
                        <Input
                          aria-label={`Extra service ${index + 1}, price for one`}
                          value={service.price}
                          onChange={(event) =>
                            set(
                              'services',
                              form.services.map((item, at) =>
                                at === index ? { ...item, price: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Price each"
                          inputMode="decimal"
                          leadingIcon={<span className="text-fg-muted">$</span>}
                          data-testid={`wizard-service-price-${index}`}
                        />
                        <Input
                          aria-label={`Extra service ${index + 1}, your cost for one`}
                          value={service.cost}
                          onChange={(event) =>
                            set(
                              'services',
                              form.services.map((item, at) =>
                                at === index ? { ...item, cost: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Cost each"
                          inputMode="decimal"
                          leadingIcon={<span className="text-fg-muted">$</span>}
                        />
                        <IconButton
                          label={`Remove extra service ${index + 1}`}
                          icon={<Trash2 aria-hidden />}
                          size="sm"
                          onClick={() =>
                            set(
                              'services',
                              form.services.filter((_, at) => at !== index),
                            )
                          }
                        />
                      </div>
                      {errors[`service.${index}`] ? (
                        <p role="alert" className="text-2xs font-medium text-danger-text">
                          {errors[`service.${index}`]}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    leadingIcon={<Plus aria-hidden />}
                    onClick={() =>
                      set('services', [
                        ...form.services,
                        {
                          serviceId: null,
                          label: '',
                          quantity: readDecimal(form.units, 3) ? form.units.trim() : '',
                          price: '',
                          cost: '',
                        },
                      ])
                    }
                    data-testid="wizard-add-service"
                  >
                    Add an extra service
                  </Button>
                </fieldset>
              </div>
            </Panel>
          </form>
        ) : null}

        {step === 2 ? (
          <>
            <Panel title="Check it over">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="wizard-review">
                <ReviewItem
                  label="Client"
                  value={`${form.client.trim()}${matchedClient ? '' : ' (new client)'}`}
                />
                <ReviewItem label="Job" value={form.name.trim()} />
                <ReviewItem
                  label="Kind of work"
                  value={`${jobType?.name ?? 'General'}, ${form.kind === 'ongoing' ? 'ongoing' : 'one time'}`}
                />
                <ReviewItem
                  label="Units"
                  value={
                    readDecimal(form.units, 3)
                      ? `${formatNumber(readDecimal(form.units, 3))} ${form.unitLabel}`
                      : 'Not set'
                  }
                />
                <ReviewItem
                  label="Dates"
                  value={`${form.startDate ? `Starts ${shortDate(form.startDate)}` : 'No start date'}${form.dueDate ? `, due ${shortDate(form.dueDate)}` : ', no due date'}`}
                />
                <ReviewItem
                  label="Price"
                  value={
                    form.pricingModel === 'per_unit'
                      ? readDecimal(form.unitPrice, 4)
                        ? `${formatUnitPrice(readDecimal(form.unitPrice, 4))} a ${unit}`
                        : 'No price yet'
                      : form.pricingModel === 'fixed'
                        ? readCents(form.fixedPrice) !== null
                          ? `${formatMoney(readCents(form.fixedPrice))} for the whole job`
                          : 'No price yet'
                        : readCents(form.billRate) !== null
                          ? `${formatMoney(readCents(form.billRate))} an hour`
                          : 'No rate yet'
                  }
                />
                <ReviewItem
                  label="Labor plan"
                  value={
                    preview.totalHours > 0
                      ? `${formatHours(preview.totalHours, { style: 'unit' })}${form.laborMode === 'pace' && readDecimal(form.pace, 3) ? ` at ${formatPace(readDecimal(form.pace, 3))} a person an hour` : ''}`
                      : 'No labor plan yet'
                  }
                />
                <ReviewItem
                  label="Parts"
                  value={
                    form.partsOwner === 'client'
                      ? 'The client buys them'
                      : readDecimal(form.materialPerUnit, 4)
                        ? `We buy them, ${formatUnitPrice(readDecimal(form.materialPerUnit, 4))} a ${unit}`
                        : 'We buy them'
                  }
                />
              </dl>
              {!preview.ready ? (
                <p className="mt-4 flex items-start gap-2 rounded-lg bg-[var(--label-yellow-subtle)] px-3 py-2.5 text-sm text-[var(--label-yellow-text)]">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                  No price or plan yet. You can save the job now and add them on its Plan tab, but Pulse
                  cannot tell you if it is on track until you do.
                </p>
              ) : null}
            </Panel>

            <Panel title="Last details">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Start it now?"
                  className="sm:col-span-2"
                  hint={
                    form.status === 'active'
                      ? 'Active jobs show on the Log work page today.'
                      : 'Planned jobs wait until you start them.'
                  }
                >
                  {() => (
                    <ToggleGroup
                      label="Start it now?"
                      value={form.status}
                      onValueChange={(value) => set('status', value)}
                      options={[
                        { value: 'planned', label: `${JOB_STATUS_LABELS.planned}, not started` },
                        { value: 'active', label: `${JOB_STATUS_LABELS.active}, work is under way` },
                      ]}
                    />
                  )}
                </Field>
                <Field label="Client PO number" hint="Shows on exports and searches.">
                  {({ inputId }) => (
                    <Input
                      id={inputId}
                      value={form.poNumber}
                      onChange={(event) => set('poNumber', event.target.value)}
                      maxLength={80}
                      placeholder="PO 48213"
                    />
                  )}
                </Field>
                <Field label="Notes for the team" className="sm:col-span-2">
                  {({ inputId }) => (
                    <Textarea
                      id={inputId}
                      value={form.description}
                      onChange={(event) => set('description', event.target.value)}
                      rows={3}
                      maxLength={5000}
                      placeholder="Anything the floor should know."
                    />
                  )}
                </Field>
                {form.links.length > 0 ? (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium text-fg-secondary">Linked records</p>
                    <ul className="mt-1.5 flex flex-wrap gap-2">
                      {form.links.map((link) => (
                        <li
                          key={`${link.targetType}:${link.targetId}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-sunken py-1 pr-1 pl-3 text-sm text-fg"
                        >
                          {link.targetType === 'crm_deal' ? (
                            <Handshake aria-hidden className="size-3.5 text-fg-muted" />
                          ) : link.targetType === 'wms_work_order' ? (
                            <Warehouse aria-hidden className="size-3.5 text-fg-muted" />
                          ) : null}
                          <span className="max-w-[260px] truncate">{link.title}</span>
                          <IconButton
                            label={`Remove the link to ${link.title}`}
                            icon={<X aria-hidden />}
                            size="xs"
                            hideTooltip
                            onClick={() =>
                              set(
                                'links',
                                form.links.filter((item) => item !== link),
                              )
                            }
                          />
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-2xs text-fg-muted">
                      The job stays tied to these, so its numbers can be found from the other app.
                    </p>
                  </div>
                ) : null}
              </div>
            </Panel>
          </>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          {step === 0 ? (
            <Button variant="ghost" onClick={() => router.push(routes.jobs())}>
              Cancel
            </Button>
          ) : (
            <Button
              variant="secondary"
              leadingIcon={<ArrowLeft aria-hidden />}
              onClick={() => goTo(step - 1)}
              data-testid="wizard-back"
            >
              Back
            </Button>
          )}
          <div className="flex items-center gap-2">
            {step < 2 ? (
              <>
                {step === 1 ? (
                  <Button variant="ghost" onClick={() => goTo(2)}>
                    Skip the plan for now
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  form={`${formId}-${step}`}
                  trailingIcon={<ArrowRight aria-hidden />}
                  data-testid="wizard-next"
                >
                  {step === 0 ? 'Next: price and plan' : 'Next: review'}
                </Button>
              </>
            ) : (
              <Button
                loading={saving}
                leadingIcon={<PackagePlus aria-hidden />}
                onClick={() => void save()}
                data-testid="wizard-save"
              >
                Create the job
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="min-w-0">{previewCard}</div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  strong,
  muted,
  divider,
  tone,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
  readonly muted?: boolean;
  readonly divider?: boolean;
  readonly tone?: 'good' | 'bad';
  readonly testId?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1',
        divider && 'mt-1 border-t border-border-subtle pt-2',
        muted && 'text-xs',
      )}
    >
      <dt className={cn(muted ? 'pl-3 text-fg-muted' : 'text-fg-secondary', strong && 'font-medium text-fg')}>
        {label}
      </dt>
      <dd
        data-testid={testId}
        className={cn(
          'shrink-0',
          strong ? 'font-semibold' : '',
          tone === 'bad'
            ? 'text-danger-text'
            : tone === 'good'
              ? 'text-success-text'
              : muted
                ? 'text-fg-muted'
                : 'text-fg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ReviewItem({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 font-medium break-words text-fg">{value}</dd>
    </div>
  );
}

function SourcePicker({
  icon,
  label,
  hint,
  options,
  onPick,
  loading,
  testId,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly hint: string;
  readonly options: readonly { value: string; label: string; description?: string }[];
  readonly onPick: (value: string) => void;
  readonly loading?: boolean;
  readonly testId: string;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-subtle p-3"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-lg bg-primary-subtle text-primary-text [&_svg]:size-4"
        >
          {icon}
        </span>
        {label}
      </div>
      <p className="text-xs text-fg-secondary">{hint}</p>
      <Select
        aria-label={label}
        value={undefined}
        placeholder={loading ? 'Reading the job' : `Pick one of ${options.length}`}
        disabled={loading}
        onValueChange={onPick}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        }))}
      />
    </div>
  );
}
