'use client';
/**
 * The quote calculator and what if (SPEC section 6, `/calculator`).
 *
 * Left: what a person types (job, labor, materials, extras, target). Right: the answer, live:
 * price per unit, total, margin, break even, the lowest price worth taking, the cost split, a
 * "slower or faster crew" grid and chart, and what happened last time on jobs like this one.
 * Scenarios can be saved, opened, compared side by side and turned into a job whose quote is
 * exactly what the calculator showed. All math comes from `runCalc` (which calls `@/lib/profit`).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Calculator, CircleAlert, Copy, FolderOpen, GitCompareArrows, PackagePlus, Plus, RotateCcw, Save, Trash2, TriangleAlert, X } from 'lucide-react';
import { Badge, Button, Combobox, Field, IconButton, Input, Select, Skeleton, ToggleGroup, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { LineChart } from '@/components/charts/cartesian';
import { MarginPill, marginHealth } from '@/components/charts/stats';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { formatHours, formatMoney, formatMoneyPerHour, formatNumber, formatPercentBp, formatUnitPrice, formatUnits } from '@/lib/format';
import { useJobs } from '@/lib/hooks/use-data';
import { shortDate } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import { centsToDecimal } from '@/lib/money';
import type { CalculatorSetupDTO, QuoteFromJobDTO, QuoteScenarioDTO } from '@/server/domain/quotes';
import { saveQuoteScenarioAction } from '@/server/actions/money-ops';
import { EMPTY_CALC, blendedRateCents, bpToPercent, runCalc, singularUnit, trimDecimal, type CalcInputs, type CalcRun, type CalcSummary } from './calc-model';
import { CompareDialog, JobFromScenarioDialog, ScenarioDrawer } from './calculator-dialogs';
import { fetchQuoteFromJob, quoteKeys, useCalculatorSetup, useQuoteScenarios, useSimilarJobs } from './hooks';
import { How, type HowLine } from './how';

const price = (value: string | null | undefined) => formatUnitPrice(value ?? null, { empty: 'No answer yet' });

/** A fresh form with the workspace defaults filled in. */
function startForm(setup: CalculatorSetupDTO): CalcInputs {
  const first = setup.laborClasses.find((item) => item.isDefault) ?? setup.laborClasses[0];
  return {
    ...EMPTY_CALC,
    crew: [{ laborClassId: first?.id ?? null, label: first?.name ?? 'Crew', headcount: '4', rate: first?.rateCents === null || first?.rateCents === undefined ? '' : centsToDecimal(first.rateCents) }],
    shiftHours: setup.defaults.shiftHours,
    partsOwner: setup.defaults.partsOwner,
    sharedPct: bpToPercent(setup.defaults.sharedPctBp) || '0',
    targetMarginPct: bpToPercent(setup.defaults.targetMarginBp) || '30',
  };
}

function NumField({
  label,
  value,
  onChange,
  error,
  hint,
  prefix,
  suffix,
  placeholder,
  testId,
  className,
  required,
  onBlur,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | null;
  readonly hint?: ReactNode;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly placeholder?: string;
  readonly testId?: string;
  readonly className?: string;
  readonly required?: boolean;
  readonly onBlur?: () => void;
}) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <Input
          id={inputId}
          aria-describedby={describedBy}
          invalid={invalid}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          data-testid={testId}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          leadingIcon={prefix ? <span className="text-sm text-fg-muted">{prefix}</span> : undefined}
          trailing={suffix ? <span className="text-xs whitespace-nowrap text-fg-muted">{suffix}</span> : undefined}
          className="tabular-nums"
        />
      )}
    </Field>
  );
}

function Section({ title, hint, children, action }: { readonly title: string; readonly hint?: string; readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-fg-muted">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function CalculatorView({
  initialSetup,
  initialScenarios,
  initialFromJob,
  initialScenario,
}: {
  readonly initialSetup: CalculatorSetupDTO;
  readonly initialScenarios: QuoteScenarioDTO[];
  readonly initialFromJob: QuoteFromJobDTO | null;
  readonly initialScenario: QuoteScenarioDTO | null;
}) {
  const queryClient = useQueryClient();
  const setup = useCalculatorSetup({ initialData: initialSetup }).data ?? initialSetup;
  const scenariosQuery = useQuoteScenarios({ initialData: initialScenarios });
  const scenarios = scenariosQuery.data ?? initialScenarios;
  const jobsQuery = useJobs({ tab: 'all', limit: 300 });

  const [form, setForm] = useState<CalcInputs>(() => initialScenario?.inputs ?? initialFromJob?.inputs ?? startForm(initialSetup));
  const [source, setSource] = useState<QuoteFromJobDTO | null>(initialFromJob);
  const [scenario, setScenario] = useState<{ id: string; name: string } | null>(initialScenario ? { id: initialScenario.id, name: initialScenario.name } : null);
  const [name, setName] = useState(initialScenario?.name ?? (initialFromJob ? `What if on ${initialFromJob.jobNumber}` : ''));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(Boolean(initialScenario || initialFromJob));
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [compare, setCompare] = useState(false);
  const [makeJob, setMakeJob] = useState<QuoteScenarioDTO | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
  const [dirty, setDirty] = useState(false);

  const run = useMemo(() => runCalc(form, { workingDays: setup.defaults.workingDays }), [form, setup.defaults.workingDays]);
  const summary = run.summary;
  const errorFor = (key: string): string | null => (showAll || touched.has(key) ? (run.errors[key] ?? null) : null);
  const touch = (key: string) => setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
  const patch = (change: Partial<CalcInputs>) => {
    setForm((current) => ({ ...current, ...change }));
    setDirty(true);
  };

  const similar = useSimilarJobs({ jobTypeId: form.jobTypeId, clientId: form.clientId, excludeJobId: null });
  const unit = form.unitLabel || 'units';
  const single = singularUnit(form.unitLabel);

  const pickJobType = (id: string | null) => {
    const type = setup.jobTypes.find((item) => item.id === id);
    const clientPace = setup.clientPaces.find((item) => item.jobTypeId === id && item.clientId === form.clientId)?.pace;
    const client = setup.clients.find((item) => item.id === form.clientId);
    const margin = type?.targetMarginBp ?? client?.targetMarginBp ?? null;
    const crewClass = type?.defaultLaborClassId ? setup.laborClasses.find((item) => item.id === type.defaultLaborClassId) : undefined;
    patch({
      jobTypeId: id,
      unitLabel: type?.unitLabel || form.unitLabel,
      standardUph: form.standardUph || trimDecimal(clientPace ?? type?.targetPace ?? ''),
      targetMarginPct: margin !== null ? bpToPercent(margin) : form.targetMarginPct,
      crew:
        crewClass && form.crew.length === 1 && !dirty
          ? [{ laborClassId: crewClass.id, label: crewClass.name, headcount: form.crew[0]?.headcount ?? '4', rate: crewClass.rateCents === null ? '' : centsToDecimal(crewClass.rateCents) }]
          : form.crew,
    });
  };
  const pickClient = (id: string | null) => {
    const client = setup.clients.find((item) => item.id === id);
    const type = setup.jobTypes.find((item) => item.id === form.jobTypeId);
    const clientPace = setup.clientPaces.find((item) => item.jobTypeId === form.jobTypeId && item.clientId === id)?.pace;
    patch({
      clientId: id,
      partsOwner: client?.partsOwner ?? form.partsOwner,
      targetMarginPct: type?.targetMarginBp === null || type?.targetMarginBp === undefined ? (client?.targetMarginBp !== null && client?.targetMarginBp !== undefined ? bpToPercent(client.targetMarginBp) : form.targetMarginPct) : form.targetMarginPct,
      standardUph: clientPace && !dirty ? trimDecimal(clientPace) : form.standardUph,
    });
  };

  const startFromJob = async (ref: string | null) => {
    if (!ref) return;
    setLoadingJob(true);
    try {
      const filled = await queryClient.fetchQuery({ queryKey: quoteKeys.fromJob(ref), queryFn: () => fetchQuoteFromJob(ref), staleTime: 0 });
      setForm(filled.inputs);
      setSource(filled);
      setScenario(null);
      setName(`What if on ${filled.jobNumber}`);
      setShowAll(true);
      setDirty(false);
      window.history.replaceState(null, '', routes.calculator({ job: filled.jobNumber }));
      toast.success(`Filled in from ${filled.jobNumber}`, 'Change any number to see what it would do.');
    } catch (error) {
      toast.error("Couldn't read that job", error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoadingJob(false);
    }
  };

  const reset = () => {
    const before = { form, source, scenario, name };
    setForm(startForm(setup));
    setSource(null);
    setScenario(null);
    setName('');
    setTouched(new Set());
    setShowAll(false);
    setDirty(false);
    window.history.replaceState(null, '', routes.calculator());
    toast.undo('Calculator cleared', {
      onUndo: () => {
        setForm(before.form);
        setSource(before.source);
        setScenario(before.scenario);
        setName(before.name);
        setShowAll(true);
      },
    });
  };

  const openScenario = (item: QuoteScenarioDTO) => {
    setForm(item.inputs);
    setScenario({ id: item.id, name: item.name });
    setName(item.name);
    setSource(null);
    setShowAll(true);
    setDirty(false);
    setDrawer(false);
    window.history.replaceState(null, '', routes.calculator({ scenario: item.id }));
  };

  const save = async (asNew: boolean): Promise<QuoteScenarioDTO | null> => {
    setShowAll(true);
    if (!summary) {
      toast.error('Not ready to save yet', 'Fill in the fields marked in red first.');
      return null;
    }
    if (!name.trim()) {
      setNameError('Give the scenario a name, like "Holiday kit at 40 an hour".');
      return null;
    }
    setNameError(null);
    setSaving(true);
    try {
      const result = await saveQuoteScenarioAction({ id: asNew ? null : (scenario?.id ?? null), name: name.trim(), inputs: form });
      if (!result.ok) {
        if (result.error.fields?.name) setNameError(result.error.fields.name);
        toast.error("Couldn't save the scenario", result.error.message);
        return null;
      }
      setScenario({ id: result.data.id, name: result.data.name });
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: quoteKeys.list() });
      window.history.replaceState(null, '', routes.calculator({ scenario: result.data.id }));
      toast.success(asNew || !scenario ? 'Scenario saved' : 'Scenario updated', result.data.name);
      return result.data;
    } catch {
      toast.error("Couldn't save the scenario", 'Check your connection and try again.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const createJob = async () => {
    const saved = dirty || !scenario ? await save(false) : (scenarios.find((item) => item.id === scenario.id) ?? (await save(false)));
    if (saved) setMakeJob(saved);
  };

  // Warn before a reload throws typed numbers away.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!setup.hasRate) {
    return (
      <Panel>
        <Teach
          icon={Calculator}
          title="The calculator needs a labor rate first"
          why="To price a job, Pulse has to know what an hour of work really costs you. Set one labor rate, then come back: type the units, the pace and the crew, and you get the price for the margin you want."
          points={['The price per unit that hits your target margin', 'The lowest price worth taking, and the break even price', 'What happened last time on jobs like this one']}
          actions={setup.canManageRates ? <ButtonLink href={routes.labor('rates')}>Set a labor rate</ButtonLink> : null}
          footnote={setup.canManageRates ? undefined : 'Ask an admin to set the first labor rate.'}
        />
      </Panel>
    );
  }

  const jobOptions = (jobsQuery.data ?? []).map((job) => ({ value: job.number, label: `${job.number} ${job.name}`, description: job.clientName, keywords: [job.clientName] }));
  const blended = blendedRateCents(form.crew);

  return (
    <div className="flex flex-col gap-4" data-testid="calculator">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Scenario name" error={nameError} className="min-w-[220px] flex-1 sm:max-w-sm">
          {({ inputId, describedBy, invalid }) => (
            <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={name} maxLength={120} placeholder="For example: Holiday kit at 40 an hour" data-testid="calc-name" onChange={(event) => { setName(event.target.value); setNameError(null); }} />
          )}
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          {setup.canSave ? (
            <Button onClick={() => void save(false)} loading={saving} leadingIcon={<Save aria-hidden />} data-testid="calc-save">
              {scenario ? 'Save changes' : 'Save scenario'}
            </Button>
          ) : null}
          {setup.canSave && scenario ? (
            <Button variant="secondary" onClick={() => void save(true)} disabled={saving} leadingIcon={<Copy aria-hidden />} data-testid="calc-save-copy">
              Save as new
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setDrawer(true)} leadingIcon={<FolderOpen aria-hidden />} data-testid="calc-open-scenarios">
            Scenarios{scenarios.length > 0 ? ` (${scenarios.length})` : ''}
          </Button>
          <Button variant="secondary" onClick={() => setCompare(true)} leadingIcon={<GitCompareArrows aria-hidden />} data-testid="calc-compare">
            Compare
          </Button>
          {setup.canCreateJob ? (
            <Button variant="secondary" onClick={() => void createJob()} disabled={saving} leadingIcon={<PackagePlus aria-hidden />} data-testid="calc-create-job">
              Create a job from this
            </Button>
          ) : null}
          <Button variant="ghost" onClick={reset} leadingIcon={<RotateCcw aria-hidden />} data-testid="calc-reset">
            Start over
          </Button>
        </div>
      </div>

      {source ? (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-info-subtle px-4 py-3 text-sm text-fg" data-testid="calc-source">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              Started from the real numbers of{' '}
              <Link href={routes.job(source.jobNumber)} className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                {source.jobNumber} {source.jobName}
              </Link>
            </p>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-secondary tabular-nums">
              <span>{formatUnits(source.actual.unitsGood, single)} done</span>
              <span>{formatHours(source.actual.hours, { style: 'unit' })}</span>
              <span>Margin so far {formatPercentBp(source.actual.marginBp, { empty: 'not known yet' })}</span>
            </span>
          </div>
          <ul className="flex flex-col gap-0.5 text-xs text-fg-secondary">
            {source.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Panel title="What you know about the job" bodyClassName="flex flex-col gap-4">
          <Section title="Job" hint="Pick a job type and Pulse fills in its target pace and margin.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Start from a past job" hint="Fills the form with what that job really did." className="sm:col-span-2">
                {({ inputId }) => (
                  <Combobox id={inputId} aria-label="Start from a past job" options={jobOptions} value={source?.jobNumber ?? null} onValueChange={(value) => void startFromJob(value)} placeholder={loadingJob ? 'Reading the job' : jobsQuery.isLoading ? 'Loading jobs' : 'Pick a job to re-quote'} searchPlaceholder="Find a job by number, name or client" emptyMessage="No job matches" disabled={loadingJob} />
                )}
              </Field>
              <Field label="Client">
                {({ inputId }) => <Combobox id={inputId} aria-label="Client" options={setup.clients.map((item) => ({ value: item.id, label: item.name }))} value={form.clientId} onValueChange={pickClient} placeholder="Any client" searchPlaceholder="Find a client" emptyMessage="No client matches" />}
              </Field>
              <Field label="Job type">
                {({ inputId }) => <Combobox id={inputId} aria-label="Job type" options={setup.jobTypes.map((item) => ({ value: item.id, label: item.name, description: item.targetPace ? `Target pace ${trimDecimal(item.targetPace)}` : undefined }))} value={form.jobTypeId} onValueChange={pickJobType} placeholder="Pick a job type" searchPlaceholder="Find a job type" emptyMessage="No job type matches" />}
              </Field>
              <NumField label="Units" required value={form.units} onChange={(value) => patch({ units: value })} onBlur={() => touch('units')} error={errorFor('units')} suffix={unit} placeholder="5000" testId="calc-units" />
              <Field label="What one unit is called" hint="Kits, sets, cases.">
                {({ inputId, describedBy }) => <Input id={inputId} aria-describedby={describedBy} value={form.unitLabel} maxLength={40} onChange={(event) => patch({ unitLabel: event.target.value })} />}
              </Field>
            </div>
          </Section>

          <Section title="Labor" hint="Units divided by the pace gives hours. Hours times the real cost of an hour gives labor cost.">
            <div className="grid gap-3 sm:grid-cols-3">
              <NumField label="Target pace" required value={form.standardUph} onChange={(value) => patch({ standardUph: value })} onBlur={() => touch('standardUph')} error={errorFor('standardUph')} suffix="per person per hour" placeholder="40" testId="calc-pace" className="sm:col-span-2" />
              <NumField label="Setup hours" value={form.setupHours} onChange={(value) => patch({ setupHours: value })} onBlur={() => touch('setupHours')} error={errorFor('setupHours')} suffix="hours" placeholder="0" testId="calc-setup" />
            </div>
            <div className="flex flex-col gap-2" role="group" aria-label="Crew">
              {form.crew.map((line, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.7fr)_minmax(0,1fr)_auto]" data-testid={`calc-crew-${index}`}>
                  <Field label={index === 0 ? 'Labor class' : 'Another labor class'} className="col-span-2 sm:col-span-1">
                    {({ inputId }) => (
                      <Select
                        id={inputId}
                        aria-label="Labor class"
                        value={line.laborClassId ?? undefined}
                        placeholder="Pick a labor class"
                        options={setup.laborClasses.map((item) => ({ value: item.id, label: item.name, description: item.rateCents === null ? 'No rate yet' : formatMoneyPerHour(item.rateCents) }))}
                        onValueChange={(id) => {
                          const item = setup.laborClasses.find((entry) => entry.id === id);
                          patch({ crew: form.crew.map((entry, at) => (at === index ? { ...entry, laborClassId: id, label: item?.name ?? entry.label, rate: item?.rateCents === null || item?.rateCents === undefined ? entry.rate : centsToDecimal(item.rateCents) } : entry)) });
                        }}
                      />
                    )}
                  </Field>
                  <NumField label="People" value={line.headcount} onChange={(value) => patch({ crew: form.crew.map((entry, at) => (at === index ? { ...entry, headcount: value } : entry)) })} onBlur={() => touch(`crew.${index}.headcount`)} error={errorFor(`crew.${index}.headcount`)} testId={`calc-crew-${index}-people`} />
                  <NumField label="Real cost of an hour" value={line.rate} onChange={(value) => patch({ crew: form.crew.map((entry, at) => (at === index ? { ...entry, rate: value } : entry)) })} onBlur={() => touch(`crew.${index}.rate`)} error={errorFor(`crew.${index}.rate`)} prefix="$" testId={`calc-crew-${index}-rate`} />
                  <div className="flex h-full items-start pt-[22px]">
                    <IconButton label="Remove this crew line" icon={<Trash2 aria-hidden />} variant="ghost" size="md" disabled={form.crew.length === 1} onClick={() => patch({ crew: form.crew.filter((_, at) => at !== index) })} />
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => patch({ crew: [...form.crew, { laborClassId: null, label: 'Crew', headcount: '1', rate: '' }] })} data-testid="calc-add-crew">
                  Add a labor class
                </Button>
                {blended !== null && form.crew.length > 1 ? <p className="text-xs text-fg-muted tabular-nums">Blended cost of an hour: {formatMoneyPerHour(Number(blended))}</p> : null}
              </div>
              {errorFor('crew') ? <p className="text-2xs font-medium text-danger-text">{errorFor('crew')}</p> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField label="Hours in a shift" value={form.shiftHours} onChange={(value) => patch({ shiftHours: value })} error={errorFor('shiftHours')} suffix="hours" hint="Only used to say how many days the job takes." />
              <NumField
                label="Time not on a job"
                value={form.sharedPct}
                onChange={(value) => patch({ sharedPct: value })}
                error={errorFor('sharedPct')}
                suffix="% of labor"
                hint={setup.defaults.sharedRule === 'none' ? 'Your workspace does not spread this cost. Leave it at 0.' : 'Meetings, cleanup and waiting, spread over jobs. Filled from your last 90 days.'}
                testId="calc-shared"
              />
            </div>
          </Section>

          <Section title="Materials" hint="Only parts you pay for count as a cost.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Who buys the parts">
                {() => (
                  <ToggleGroup
                    label="Who buys the parts"
                    value={form.partsOwner}
                    onValueChange={(value) => patch({ partsOwner: value })}
                    options={[
                      { value: 'us', label: 'We do' },
                      { value: 'client', label: 'The client does' },
                    ]}
                  />
                )}
              </Field>
              {form.partsOwner === 'us' ? (
                <NumField label="Material per unit" value={form.materialPerUnit} onChange={(value) => patch({ materialPerUnit: value })} onBlur={() => touch('materialPerUnit')} error={errorFor('materialPerUnit')} prefix="$" suffix={`a ${single}`} placeholder="0.45" testId="calc-material" />
              ) : (
                <p className="self-end pb-1.5 text-xs text-fg-muted">The client supplies the parts, so material cost is $0.00 on this quote.</p>
              )}
            </div>
          </Section>

          <Section
            title="Extra services"
            hint="Things sold on top, like labeling or inserts. Each has its own price and its own cost."
            action={
              <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => patch({ services: [...form.services, { vasServiceId: null, label: 'Extra service', quantity: cleanUnits(form.units), unitPrice: '', costPerUnit: '' }] })} data-testid="calc-add-service">
                Add a service
              </Button>
            }
          >
            {form.services.length === 0 ? <p className="text-xs text-fg-muted">No extra services on this quote.</p> : null}
            {form.services.map((line, index) => (
              <div key={index} className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_auto]" data-testid={`calc-service-${index}`}>
                <Field label="Service" className="col-span-2 sm:col-span-1">
                  {({ inputId }) =>
                    setup.services.length > 0 ? (
                      <Select
                        id={inputId}
                        aria-label="Extra service"
                        value={line.vasServiceId ?? undefined}
                        placeholder="Pick a service"
                        options={setup.services.map((item) => ({ value: item.id, label: item.name }))}
                        onValueChange={(id) => {
                          const item = setup.services.find((entry) => entry.id === id);
                          patch({ services: form.services.map((entry, at) => (at === index ? { ...entry, vasServiceId: id, label: item?.name ?? entry.label, unitPrice: trimDecimal(item?.defaultPrice) || entry.unitPrice, costPerUnit: trimDecimal(item?.defaultCostPerUnit) || entry.costPerUnit } : entry)) });
                        }}
                      />
                    ) : (
                      <Input id={inputId} value={line.label} maxLength={80} onChange={(event) => patch({ services: form.services.map((entry, at) => (at === index ? { ...entry, label: event.target.value } : entry)) })} />
                    )
                  }
                </Field>
                <NumField label="How many" value={line.quantity} onChange={(value) => patch({ services: form.services.map((entry, at) => (at === index ? { ...entry, quantity: value } : entry)) })} error={errorFor(`services.${index}.quantity`)} />
                <NumField label="Price each" value={line.unitPrice} onChange={(value) => patch({ services: form.services.map((entry, at) => (at === index ? { ...entry, unitPrice: value } : entry)) })} error={errorFor(`services.${index}.unitPrice`)} prefix="$" testId={`calc-service-${index}-price`} />
                <NumField label="Cost each" value={line.costPerUnit} onChange={(value) => patch({ services: form.services.map((entry, at) => (at === index ? { ...entry, costPerUnit: value } : entry)) })} error={errorFor(`services.${index}.costPerUnit`)} prefix="$" />
                <div className="flex items-start pt-[22px]">
                  <IconButton label="Remove this service" icon={<Trash2 aria-hidden />} variant="ghost" size="md" onClick={() => patch({ services: form.services.filter((_, at) => at !== index) })} />
                </div>
              </div>
            ))}
          </Section>

          <Section
            title="Other costs"
            hint="Costs for the whole job: freight, pallets, outside help."
            action={
              <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => patch({ otherCosts: [...form.otherCosts, { label: 'Freight', amount: '' }] })} data-testid="calc-add-other">
                Add a cost
              </Button>
            }
          >
            {form.otherCosts.length === 0 ? <p className="text-xs text-fg-muted">No other costs on this quote.</p> : null}
            {form.otherCosts.map((line, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] items-start gap-2" data-testid={`calc-other-${index}`}>
                <Field label="What it is">
                  {({ inputId }) => <Input id={inputId} value={line.label} maxLength={80} onChange={(event) => patch({ otherCosts: form.otherCosts.map((entry, at) => (at === index ? { ...entry, label: event.target.value } : entry)) })} />}
                </Field>
                <NumField label="Amount" value={line.amount} onChange={(value) => patch({ otherCosts: form.otherCosts.map((entry, at) => (at === index ? { ...entry, amount: value } : entry)) })} error={errorFor(`otherCosts.${index}.amount`)} prefix="$" testId={`calc-other-${index}-amount`} />
                <div className="flex items-start pt-[22px]">
                  <IconButton label="Remove this cost" icon={<Trash2 aria-hidden />} variant="ghost" size="md" onClick={() => patch({ otherCosts: form.otherCosts.filter((_, at) => at !== index) })} />
                </div>
              </div>
            ))}
          </Section>

          <Section title="Price" hint="Leave the price empty to get the price for your target margin. Type one to test it.">
            <div className="grid gap-3 sm:grid-cols-2">
              <NumField label="Target margin" required value={form.targetMarginPct} onChange={(value) => patch({ targetMarginPct: value })} onBlur={() => touch('targetMarginPct')} error={errorFor('targetMarginPct')} suffix="%" placeholder="30" testId="calc-margin" />
              <NumField
                label="Price to test"
                value={form.pricePerUnit}
                onChange={(value) => patch({ pricePerUnit: value })}
                onBlur={() => touch('pricePerUnit')}
                error={errorFor('pricePerUnit')}
                prefix="$"
                suffix={`a ${single}`}
                placeholder={summary?.target ? trimDecimal(summary.target.pricePerUnit) : '2.75'}
                testId="calc-price"
                hint={form.pricePerUnit ? <button type="button" className="rounded-sm text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => patch({ pricePerUnit: '' })}>Use the target price instead</button> : undefined}
              />
            </div>
          </Section>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
          <Answer run={run} form={form} unit={unit} showErrors={showAll} onShowErrors={() => setShowAll(true)} />
          {summary && run.grid && run.input ? <Sensitivity run={run} unit={unit} /> : null}
          <LastTime query={similar} hasType={Boolean(form.jobTypeId)} summary={summary} onUse={(ref) => void startFromJob(ref)} />
        </div>
      </div>

      <ScenarioDrawer open={drawer} onOpenChange={setDrawer} scenarios={scenarios} loading={scenariosQuery.isLoading} error={scenariosQuery.isError ? 'We could not load your scenarios.' : null} onRetry={() => void scenariosQuery.refetch()} currentId={scenario?.id ?? null} canManage={setup.canSave} canCreateJob={setup.canCreateJob} onOpen={openScenario} onMakeJob={(item) => { setDrawer(false); setMakeJob(item); }} onDeleted={(id) => { if (scenario?.id === id) { setScenario(null); window.history.replaceState(null, '', routes.calculator()); } }} />
      <CompareDialog open={compare} onOpenChange={setCompare} scenarios={scenarios} current={{ name: name.trim() || 'What is on the screen', inputs: form }} workingDays={setup.defaults.workingDays} />
      {makeJob ? <JobFromScenarioDialog scenario={makeJob} setup={setup} onClose={() => setMakeJob(null)} /> : null}
    </div>
  );
}

const cleanUnits = (value: string): string => value.replace(/[,\s]/g, '');

/* ------------------------------------------------------------------ the answer */

function Tile({ label, value, sub, how, tone, testId }: { readonly label: string; readonly value: string; readonly sub?: ReactNode; readonly how?: ReactNode; readonly tone?: 'bad' | 'good'; readonly testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border-subtle bg-panel p-3.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-1">
        <p className="truncate text-xs font-medium text-fg-muted">{label}</p>
        {how}
      </div>
      <p className={cn('truncate text-2xl font-semibold tracking-[-0.02em] tabular-nums', tone === 'bad' ? 'text-danger-text' : 'text-fg')}>{value}</p>
      {sub ? <div className="text-xs text-fg-secondary tabular-nums">{sub}</div> : null}
    </div>
  );
}

function costLines(summary: CalcSummary): HowLine[] {
  const lines: HowLine[] = [{ label: `Labor: ${formatHours(summary.laborHours, { style: 'unit' })} at ${formatMoneyPerHour(summary.blendedRateCents)}`, value: formatMoney(summary.laborCents), op: 'start' }];
  if (summary.materialCents !== 0) lines.push({ label: 'Material', value: formatMoney(summary.materialCents) });
  if (summary.otherCents !== 0) lines.push({ label: 'Other costs', value: formatMoney(summary.otherCents) });
  if (summary.serviceCostCents !== 0) lines.push({ label: 'Cost of extra services', value: formatMoney(summary.serviceCostCents) });
  if (summary.sharedCents !== 0) lines.push({ label: 'Time not on a job', value: formatMoney(summary.sharedCents) });
  lines.push({ label: 'All cost', value: formatMoney(summary.costCents), op: 'total' });
  return lines;
}

function Answer({ run, form, unit, showErrors, onShowErrors }: { readonly run: CalcRun; readonly form: CalcInputs; readonly unit: string; readonly showErrors: boolean; readonly onShowErrors: () => void }) {
  const summary = run.summary;
  const chosen = summary?.chosen ?? null;
  if (!summary || !chosen) {
    const missing = Object.values(run.errors);
    return (
      <Panel title="The answer">
        <div className="flex flex-col items-start gap-3 py-2" data-testid="calc-waiting" role="status">
          <span aria-hidden className="flex size-11 items-center justify-center rounded-xl bg-primary-subtle text-primary-text">
            <Calculator className="size-5" />
          </span>
          <p className="text-base font-semibold text-fg">{run.incomplete ? 'Type the units, the pace and the crew' : 'One of the numbers needs another look'}</p>
          <p className="text-sm text-fg-secondary">The price, the margin and the break even show up here as soon as the form has what it needs. Nothing is saved until you press Save.</p>
          {showErrors && missing.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-danger-text" aria-label="What is missing">
              {missing.slice(0, 5).map((message) => (
                <li key={message} className="flex items-start gap-1.5">
                  <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  {message}
                </li>
              ))}
            </ul>
          ) : (
            <Button variant="secondary" size="sm" onClick={onShowErrors}>
              Show me what is missing
            </Button>
          )}
        </div>
      </Panel>
    );
  }
  const typed = Boolean(summary.atPrice);
  const single = singularUnit(unit);
  const health = marginHealth(chosen.marginBp, summary.targetMarginBp);
  const parts = [
    { id: 'labor', label: 'Labor', cents: summary.laborCents },
    { id: 'material', label: 'Material', cents: summary.materialCents },
    { id: 'other', label: 'Other', cents: summary.otherCents + summary.serviceCostCents },
    { id: 'shared', label: 'Time not on a job', cents: summary.sharedCents },
  ].filter((part) => part.cents > 0);
  const serviceLine: HowLine[] = summary.serviceRevenueCents !== 0 ? [{ label: 'Extra services revenue', value: formatMoney(summary.serviceRevenueCents), op: 'minus' }] : [];
  return (
    <Panel
      title="The answer"
      action={<MarginPill health={health} marginBp={chosen.marginBp} size="sm" />}
      bodyClassName="flex flex-col gap-4"
    >
      <p className="text-sm text-fg-secondary" data-testid="calc-sentence">
        {typed ? (
          <>
            At <strong className="font-semibold text-fg">{price(chosen.pricePerUnit)}</strong> a {single}, this job makes <strong className={cn('font-semibold', chosen.profitCents < 0 ? 'text-danger-text' : 'text-fg')}>{formatMoney(chosen.profitCents)}</strong> at a{' '}
            {formatPercentBp(chosen.marginBp, { empty: 'unknown' })} margin. {chosen.meetsTarget ? 'That meets your target.' : `Your target is ${formatPercentBp(summary.targetMarginBp)}, which needs ${price(summary.target?.pricePerUnit)}.`}
          </>
        ) : (
          <>
            Charge <strong className="font-semibold text-fg">{price(chosen.pricePerUnit)}</strong> a {single} to make a {formatPercentBp(summary.targetMarginBp)} margin. That is <strong className="font-semibold text-fg">{formatMoney(chosen.profitCents)}</strong> of profit on {formatMoney(chosen.revenueCents)} of revenue.
          </>
        )}
      </p>
      {summary.belowLowest ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-text" data-testid="calc-below-lowest">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          This price is under the lowest price worth taking ({price(summary.lowest?.pricePerUnit)}). The job would not even cover its own labor, material and other costs.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Tile
          testId="calc-tile-price"
          label={typed ? 'Price you typed' : 'Price per unit'}
          value={price(chosen.pricePerUnit)}
          sub={typed ? `Target price ${price(summary.target?.pricePerUnit)}` : `For a ${formatPercentBp(summary.targetMarginBp)} margin`}
          how={
            <How
              title="Price per unit for your target margin"
              formula="All cost divided by one minus the margin you want gives the revenue you need. Take off what the extra services bring in, then divide by the units. The price is rounded up so the target is always met."
              lines={[
                { label: 'All cost', value: formatMoney(summary.costCents), op: 'start' },
                { label: `one minus ${formatPercentBp(summary.targetMarginBp)}`, value: formatPercentBp(10000 - summary.targetMarginBp), op: 'divide' },
                { label: 'Revenue needed', value: formatMoney(summary.target?.revenueCents ?? null), op: 'total' },
                ...serviceLine,
                { label: 'Units', value: formatUnits(summary.units, single), op: 'divide' },
                { label: 'Price per unit', value: price(summary.target?.pricePerUnit), op: 'total' },
              ]}
            />
          }
        />
        <Tile
          testId="calc-tile-total"
          label="Total"
          value={formatMoney(chosen.revenueCents)}
          sub={summary.serviceRevenueCents !== 0 ? `Includes ${formatMoney(summary.serviceRevenueCents)} of extra services` : `${formatUnits(summary.units, single)}`}
          how={
            <How
              title="Total for the job"
              formula="Units times the price per unit, plus what the extra services bring in."
              lines={[
                { label: 'Units', value: formatUnits(summary.units, single), op: 'start' },
                { label: 'Price per unit', value: price(chosen.pricePerUnit), op: 'times' },
                ...(summary.serviceRevenueCents !== 0 ? [{ label: 'Extra services', value: formatMoney(summary.serviceRevenueCents), op: 'plus' as const }] : []),
                { label: 'Total', value: formatMoney(chosen.revenueCents), op: 'total' },
              ]}
            />
          }
        />
        <Tile
          testId="calc-tile-margin"
          label="Job margin"
          tone={chosen.profitCents < 0 ? 'bad' : undefined}
          value={formatPercentBp(chosen.marginBp, { empty: 'Unknown' })}
          sub={`Target ${formatPercentBp(summary.targetMarginBp)}`}
          how={
            <How
              title="Job margin"
              formula="Profit divided by revenue. Profit is revenue less every cost of the job, time not on a job included. The last line leaves that time out, to show what the work earns on its own."
              lines={[
                { label: 'Revenue', value: formatMoney(chosen.revenueCents), op: 'start' },
                { label: 'All cost', value: formatMoney(summary.costCents), op: 'minus' },
                { label: 'Profit', value: formatMoney(chosen.profitCents), op: 'total' },
                { label: 'Revenue', value: formatMoney(chosen.revenueCents), op: 'divide' },
                { label: 'Job margin', value: formatPercentBp(chosen.marginBp, { empty: 'Unknown' }), op: 'total' },
                { label: 'Before time not on a job', value: formatPercentBp(chosen.marginBeforeSharedBp, { empty: 'Unknown' }), op: 'note' },
              ]}
            />
          }
        />
        <Tile
          testId="calc-tile-profit"
          label="Profit"
          tone={chosen.profitCents < 0 ? 'bad' : undefined}
          value={formatMoney(chosen.profitCents)}
          sub={chosen.profitPerUnitCents === null ? undefined : `${formatMoney(chosen.profitPerUnitCents)} a ${single}`}
          how={<How title="All cost of the job" formula="Labor, material, other costs, the cost of extra services and time not on a job, added up." lines={costLines(summary)} />}
        />
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row
          testId="calc-breakeven-price"
          label="Break even price"
          value={price(summary.breakeven?.pricePerUnit)}
          note="Profit is zero at this price."
          how={<How title="Break even price" formula="The price where revenue just covers all cost: all cost, less extra services revenue, divided by the units." lines={[{ label: 'All cost', value: formatMoney(summary.costCents), op: 'start' }, ...serviceLine, { label: 'Units', value: formatUnits(summary.units, single), op: 'divide' }, { label: 'Break even price', value: price(summary.breakeven?.pricePerUnit), op: 'total' }]} />}
        />
        <Row
          testId="calc-breakeven-units"
          label="Break even units"
          value={chosen.breakevenUnits === null ? 'Never at this price' : chosen.breakevenUnits === 0 ? 'From the first unit' : formatUnits(chosen.breakevenUnits, single)}
          note={chosen.breakevenUnits === null ? 'One more unit costs more than it sells for.' : 'Units needed to win back setup and other fixed costs.'}
          how={
            <How
              title="Break even units"
              formula="Costs that do not change with units (setup and other costs), divided by what one unit leaves after its own labor and material."
              lines={[
                { label: 'Fixed costs', value: formatMoney(summary.fixedCostCents), op: 'start' },
                { label: 'Price per unit', value: price(chosen.pricePerUnit), op: 'note' },
                { label: 'Cost one more unit adds', value: price(summary.variableCostPerUnit), op: 'note' },
                { label: 'Break even units', value: chosen.breakevenUnits === null ? 'Never' : formatNumber(chosen.breakevenUnits), op: 'total' },
              ]}
            />
          }
        />
        <Row
          testId="calc-lowest"
          label="Lowest price worth taking"
          value={price(summary.lowest?.pricePerUnit)}
          note="Covers labor, material and other costs. Under this, say no."
          how={<How title="Lowest price worth taking" formula="The price that covers every cost of the job itself, before time not on a job. At this price the job adds nothing, but it does not cost you." lines={[{ label: 'Cost before time not on a job', value: formatMoney(summary.costBeforeSharedCents), op: 'start' }, ...serviceLine, { label: 'Units', value: formatUnits(summary.units, single), op: 'divide' }, { label: 'Lowest price', value: price(summary.lowest?.pricePerUnit), op: 'total' }]} />}
        />
        <Row
          label="Cost per unit"
          value={price(summary.costPerUnit)}
          note={`${formatHours(summary.laborHours, { style: 'unit' })} of labor${summary.workDays !== null ? `, about ${summary.workDays} work ${summary.workDays === 1 ? 'day' : 'days'} for this crew` : ''}.`}
          how={<How title="Cost per unit" formula="All cost divided by the units." lines={[...costLines(summary), { label: 'Units', value: formatUnits(summary.units, single), op: 'divide' }, { label: 'Cost per unit', value: price(summary.costPerUnit), op: 'total' }]} />}
        />
      </dl>

      <div className="flex flex-col gap-2" data-testid="calc-split">
        <p className="text-xs font-medium text-fg-muted">Where the cost goes</p>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-sunken" role="img" aria-label={parts.map((part) => `${part.label} ${formatMoney(part.cents)}`).join(', ')}>
          {parts.map((part, index) => (
            <span key={part.id} style={{ width: `${(part.cents / Math.max(summary.costCents, 1)) * 100}%`, background: `var(--pulse-series-${index + 1})` }} className="h-full border-r border-panel last:border-r-0" />
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary tabular-nums">
          {parts.map((part, index) => (
            <li key={part.id} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-xs" style={{ background: `var(--pulse-series-${index + 1})` }} />
              {part.label} {formatMoney(part.cents)}
            </li>
          ))}
        </ul>
      </div>
      {form.partsOwner === 'client' ? <p className="text-xs text-fg-muted">The client buys the parts, so no material cost is counted.</p> : null}
    </Panel>
  );
}

function Row({ label, value, note, how, testId }: { readonly label: string; readonly value: string; readonly note?: string; readonly how?: ReactNode; readonly testId?: string }) {
  return (
    <div className="flex flex-col border-b border-border-subtle pb-2" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <dt className="flex items-center gap-1 text-fg-secondary">
          {label}
          {how}
        </dt>
        <dd className="font-semibold text-fg tabular-nums">{value}</dd>
      </div>
      {note ? <p className="text-xs text-fg-muted">{note}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ slower or faster, cheaper or dearer */

function Sensitivity({ run, unit }: { readonly run: CalcRun; readonly unit: string }) {
  const [show, setShow] = useState<'margin' | 'profit'>('margin');
  const grid = run.grid;
  const summary = run.summary;
  if (!grid || !summary) return null;
  const target = summary.targetMarginBp;
  const tone = (marginBp: number | null, profitCents: number): string => (profitCents < 0 ? 'bg-danger-subtle text-danger-text' : marginBp !== null && marginBp >= target ? 'bg-success-subtle text-success-text' : 'bg-warning-subtle text-warning-text');
  const word = (marginBp: number | null, profitCents: number): string => (profitCents < 0 ? 'loses money' : marginBp !== null && marginBp >= target ? 'meets the target' : 'under the target');
  const single = singularUnit(unit);
  const series = [0, grid.baseColumn, grid.prices.length - 1].map((column) => ({ id: `p${column}`, label: `${formatUnitPrice(grid.prices[column] ?? null)} a ${single}`, values: grid.rows.map((row) => row.cells[column]?.profitCents ?? null) }));
  return (
    <Panel
      title="If the crew is slower or faster"
      action={
        <ToggleGroup
          size="sm"
          label="Show margin or profit"
          value={show}
          onValueChange={setShow}
          options={[
            { value: 'margin', label: 'Margin' },
            { value: 'profit', label: 'Profit' },
          ]}
        />
      }
      bodyClassName="flex flex-col gap-4"
    >
      <p className="text-sm text-fg-secondary">Each row is a pace, from 20% under the target pace to 20% over. Each column is a price. The middle cell is the answer above.</p>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[460px] border-separate border-spacing-1 text-sm tabular-nums" data-testid="calc-grid">
          <caption className="sr-only">{show === 'margin' ? 'Margin' : 'Profit'} by pace and price</caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left text-xs font-medium text-fg-muted">
                Pace
              </th>
              {grid.prices.map((value, column) => (
                <th key={value} scope="col" className={cn('px-2 py-1 text-right text-xs font-medium', column === grid.baseColumn ? 'text-fg' : 'text-fg-muted')}>
                  {formatUnitPrice(value)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.paceBp}>
                <th scope="row" className={cn('px-2 py-1.5 text-left text-xs font-medium whitespace-nowrap', row.paceBp === 10000 ? 'text-fg' : 'text-fg-muted')}>
                  {formatNumber(row.uph, { maxDigits: 1 })} <span className="font-normal">({row.paceBp === 10000 ? 'target' : `${row.paceBp > 10000 ? '+' : ''}${(row.paceBp - 10000) / 100}%`})</span>
                </th>
                {row.cells.map((cell, column) => (
                  <td key={column} className={cn('rounded-md px-2 py-1.5 text-right font-medium', tone(cell.marginBp, cell.profitCents), row.paceBp === 10000 && column === grid.baseColumn && 'ring-2 ring-[color:var(--border-strong)]')}>
                    {show === 'margin' ? formatPercentBp(cell.marginBp, { empty: 'None' }) : formatMoney(cell.profitCents, { cents: false })}
                    <span className="sr-only">, {word(cell.marginBp, cell.profitCents)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-xs bg-success-subtle ring-1 ring-success/40" />Meets your {formatPercentBp(target)} target</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-xs bg-warning-subtle ring-1 ring-warning/40" />Makes money, under target</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-xs bg-danger-subtle ring-1 ring-danger/40" />Loses money</li>
      </ul>
      <div className="min-w-0">
        <LineChart title="Profit by pace at three prices" description="Profit for the whole job as the crew runs slower or faster than the target pace, at the lowest, the middle and the highest price of the grid." showTitle height={220} format="money" tableToggle labels={grid.rows.map((row) => `${formatNumber(row.uph, { maxDigits: 0 })} an hour`)} series={series} target={{ value: 0, label: 'Break even' }} />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ what happened last time */

function LastTime({ query, hasType, summary, onUse }: { readonly query: ReturnType<typeof useSimilarJobs>; readonly hasType: boolean; readonly summary: CalcSummary | null; readonly onUse: (ref: string) => void }) {
  return (
    <Panel title="What happened last time" bodyClassName="flex flex-col gap-3">
      {!hasType ? (
        <p className="text-sm text-fg-secondary" data-testid="calc-last-empty">
          Pick a job type and Pulse shows the real pace and margin of jobs like this one, so the quote starts from what your floor really does.
        </p>
      ) : query.isLoading ? (
        <div className="flex flex-col gap-2" role="status" aria-busy="true">
          <span className="sr-only">Loading past jobs</span>
          <Skeleton height={44} rounded="md" />
          <Skeleton height={44} rounded="md" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger-text">
          We could not load past jobs.
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (query.data ?? []).length === 0 ? (
        <p className="text-sm text-fg-secondary" data-testid="calc-last-empty">
          No job of this type has logged work yet. After the first one runs, its real pace and margin show up here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle" data-testid="calc-last-list">
          {(query.data ?? []).map((job) => (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link href={routes.job(job.number)} className="text-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                  {job.number} {job.name}
                </Link>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                  {job.clientName}
                  {job.sameClient ? <Badge tone="primary" size="sm">Same client</Badge> : null}
                  {job.laborMissing ? <Badge tone="warning" size="sm">Hours missing</Badge> : null}
                  {job.lastEntryDate ? <span>Last worked {shortDate(job.lastEntryDate)}</span> : null}
                </p>
              </div>
              <div className="flex items-center gap-4 text-right text-xs tabular-nums">
                <span>
                  <span className="block font-semibold text-fg">{job.uph ? formatNumber(job.uph, { maxDigits: 1 }) : 'No pace'}</span>
                  <span className="text-fg-muted">per person per hour</span>
                </span>
                <span>
                  <span className={cn('block font-semibold', job.marginBp !== null && job.marginBp < 0 ? 'text-danger-text' : 'text-fg')}>{formatPercentBp(job.marginBp, { empty: 'No margin' })}</span>
                  <span className="text-fg-muted">margin</span>
                </span>
                <span className="hidden sm:block">
                  <span className="block font-semibold text-fg">{formatMoney(job.revenuePerUnitCents, { empty: 'None' })}</span>
                  <span className="text-fg-muted">earned a unit</span>
                </span>
                <Button variant="ghost" size="xs" trailingIcon={<ArrowRight aria-hidden />} onClick={() => onUse(job.number)} aria-label={`Start from ${job.number}`}>
                  Use
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {summary && (query.data ?? []).length > 0 ? <p className="text-xs text-fg-muted">Compare the pace you typed with what these jobs really did before you send the price.</p> : null}
    </Panel>
  );
}

export function CalculatorLoadError({ message }: { readonly message: string }) {
  return (
    <Panel>
      <div role="alert" className="flex flex-col items-start gap-3 py-4">
        <span aria-hidden className="flex size-11 items-center justify-center rounded-xl bg-danger-subtle text-danger-text">
          <X className="size-5" />
        </span>
        <p className="text-base font-semibold text-fg">We could not open that</p>
        <p className="text-sm text-fg-secondary">{message}</p>
        <ButtonLink href={routes.calculator()}>Open an empty calculator</ButtonLink>
      </div>
    </Panel>
  );
}
