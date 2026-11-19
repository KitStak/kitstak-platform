'use client';
/**
 * The calculator's side pieces: the saved scenarios drawer (open, mark sent, won or lost, delete
 * with undo, make a job), the side by side compare of two scenarios, and the dialog that turns a
 * scenario into a job.
 */
import { ScrollX } from '@/components/ui/scroll-x';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen, PackagePlus, Trash2 } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Drawer, DrawerContent, Field, IconButton, Input, IsoDatePicker, Select, Skeleton, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Teach } from '@/components/pulse/teach';
import { formatDecimalPlain, formatHours, formatMoney, formatMoneyDelta, formatNumber, formatPercentBp, formatPointsDelta, formatUnitPrice } from '@/lib/format';
import { formatRelative } from '@/lib/dates';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { CalculatorSetupDTO, QuoteScenarioDTO, QuoteStatus } from '@/server/domain/quotes';
import { createJobFromScenarioAction, deleteQuoteScenarioAction, restoreQuoteScenarioAction, setQuoteScenarioStatusAction } from '@/server/actions/money-ops';
import { crewHeadcount, runCalc, type CalcInputs, type CalcSummary } from './calc-model';
import { ClientCombo, NO_CLIENT, type ClientChoice } from '@/features/jobs/client-combo';
import { clientBoxProblem, matchClientName } from '@/lib/client-names';
import { quoteKeys } from './hooks';
import { keepOpenForToasts } from './toast-safe';

const STATUS_LABELS: Readonly<Record<QuoteStatus, string>> = { draft: 'Draft', sent: 'Sent to the client', won: 'Won', lost: 'Lost' };
const STATUS_TONE: Readonly<Record<QuoteStatus, 'neutral' | 'info' | 'success' | 'danger'>> = { draft: 'neutral', sent: 'info', won: 'success', lost: 'danger' };

/* ------------------------------------------------------------------ saved scenarios */

export function ScenarioDrawer({
  open,
  onOpenChange,
  scenarios,
  loading,
  error,
  onRetry,
  currentId,
  canManage,
  canCreateJob,
  onOpen,
  onMakeJob,
  onDeleted,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly scenarios: readonly QuoteScenarioDTO[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly currentId: string | null;
  readonly canManage: boolean;
  readonly canCreateJob: boolean;
  readonly onOpen: (scenario: QuoteScenarioDTO) => void;
  readonly onMakeJob: (scenario: QuoteScenarioDTO) => void;
  readonly onDeleted: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: quoteKeys.list() });

  const setStatus = async (scenario: QuoteScenarioDTO, status: QuoteStatus) => {
    if (status === scenario.status) return;
    const previous = queryClient.getQueryData<QuoteScenarioDTO[]>(quoteKeys.list());
    queryClient.setQueryData<QuoteScenarioDTO[]>(quoteKeys.list(), (list) => (list ?? []).map((item) => (item.id === scenario.id ? { ...item, status } : item)));
    const result = await setQuoteScenarioStatusAction({ id: scenario.id, status });
    if (!result.ok) {
      queryClient.setQueryData(quoteKeys.list(), previous);
      toast.error("Couldn't change the status", result.error.message);
      return;
    }
    toast.undo(`${scenario.name} marked ${STATUS_LABELS[status].toLowerCase()}`, {
      onUndo: async () => {
        await setQuoteScenarioStatusAction({ id: scenario.id, status: scenario.status });
        await refresh();
      },
    });
    await refresh();
  };

  const remove = async (scenario: QuoteScenarioDTO) => {
    setBusy(scenario.id);
    const previous = queryClient.getQueryData<QuoteScenarioDTO[]>(quoteKeys.list());
    queryClient.setQueryData<QuoteScenarioDTO[]>(quoteKeys.list(), (list) => (list ?? []).filter((item) => item.id !== scenario.id));
    // Tell the page first: if this scenario is the open one, its address must not point at a deleted scenario when the page refreshes.
    onDeleted(scenario.id);
    const result = await deleteQuoteScenarioAction({ id: scenario.id });
    setBusy(null);
    if (!result.ok) {
      queryClient.setQueryData(quoteKeys.list(), previous);
      toast.error("Couldn't delete the scenario", result.error.message);
      return;
    }
    toast.undo(`${scenario.name} deleted`, {
      onUndo: async () => {
        const restored = await restoreQuoteScenarioAction({ id: scenario.id });
        if (!restored.ok) throw new Error(restored.error.message);
        await refresh();
      },
    });
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Saved scenarios" description="Open one to keep working on it, or turn it into a job." width={520} data-testid="scenario-drawer" onInteractOutside={keepOpenForToasts}>
        <div className="flex flex-col gap-3 p-4">
          {loading ? (
            <div role="status" aria-busy="true" className="flex flex-col gap-3">
              <span className="sr-only">Loading scenarios</span>
              <Skeleton height={92} rounded="lg" />
              <Skeleton height={92} rounded="lg" />
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger-text">
              {error}
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          ) : scenarios.length === 0 ? (
            <Teach
              size="sm"
              icon={FolderOpen}
              title="No saved scenarios yet"
              why="A scenario is one set of numbers you tried: the units, the pace, the crew and the price. Save one to come back to it, to compare two prices side by side, or to turn it into a job when the client says yes."
              actions={
                <Button variant="secondary" onClick={() => onOpenChange(false)}>
                  Back to the calculator
                </Button>
              }
              testId="scenario-empty"
            />
          ) : (
            scenarios.map((scenario) => (
              <article key={scenario.id} className={cn('flex flex-col gap-2 rounded-xl border bg-panel p-3.5', scenario.id === currentId ? 'border-primary' : 'border-border-subtle')} data-testid={`scenario-${scenario.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-fg">{scenario.name}</h3>
                    <p className="truncate text-xs text-fg-muted">
                      {[scenario.clientName, scenario.jobTypeName, scenario.jobNumber ? `Job ${scenario.jobNumber}` : null].filter(Boolean).join(' · ') || 'No client or job type picked'}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[scenario.status]}>{STATUS_LABELS[scenario.status]}</Badge>
                </div>
                {scenario.result?.chosen ? (
                  <dl className="grid grid-cols-3 gap-2 text-xs tabular-nums">
                    <div>
                      <dt className="text-fg-muted">Price</dt>
                      <dd className="font-semibold text-fg">{formatUnitPrice(scenario.result.chosen.pricePerUnit)}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Total</dt>
                      <dd className="font-semibold text-fg">{formatMoney(scenario.result.chosen.revenueCents, { cents: false })}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Margin</dt>
                      <dd className={cn('font-semibold', scenario.result.chosen.profitCents < 0 ? 'text-danger-text' : 'text-fg')}>{formatPercentBp(scenario.result.chosen.marginBp, { empty: 'Unknown' })}</dd>
                    </div>
                  </dl>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-fg-muted">Saved {formatRelative(scenario.updatedAt)}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canManage ? (
                      <Select size="sm" aria-label={`Status of ${scenario.name}`} className="w-[150px]" value={scenario.status} onValueChange={(value) => void setStatus(scenario, value as QuoteStatus)} options={(Object.keys(STATUS_LABELS) as QuoteStatus[]).map((value) => ({ value, label: STATUS_LABELS[value] }))} />
                    ) : null}
                    {canCreateJob ? (
                      <Button size="sm" variant="secondary" leadingIcon={<PackagePlus aria-hidden />} onClick={() => onMakeJob(scenario)} data-testid={`scenario-${scenario.id}-job`}>
                        Make a job
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => onOpen(scenario)} data-testid={`scenario-${scenario.id}-open`}>
                      Open
                    </Button>
                    {canManage ? <IconButton label={`Delete ${scenario.name}`} icon={<Trash2 aria-hidden />} variant="ghost" size="sm" loading={busy === scenario.id} onClick={() => void remove(scenario)} data-testid={`scenario-${scenario.id}-delete`} /> : null}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ compare two */

interface Side {
  readonly name: string;
  readonly inputs: CalcInputs;
  readonly summary: CalcSummary | null;
}

type Kind = 'text' | 'money' | 'percent' | 'number' | 'price' | 'hours';

interface CompareRow {
  readonly label: string;
  readonly kind: Kind;
  readonly a: number | string | null;
  readonly b: number | string | null;
  /** Which way is good, for the color of the difference. Left out for inputs. */
  readonly goodWhen?: 'up' | 'down';
  readonly strong?: boolean;
}

function show(kind: Kind, value: number | string | null): string {
  if (value === null || value === '') return 'None';
  switch (kind) {
    case 'money':
      return formatMoney(Number(value));
    case 'percent':
      return formatPercentBp(Number(value));
    case 'price':
      return formatUnitPrice(String(value));
    case 'hours':
      return formatHours(Number(value), { style: 'unit' });
    case 'number':
      return formatNumber(Number(value), { maxDigits: 2 });
    default:
      return String(value);
  }
}

function difference(row: CompareRow): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (row.kind === 'text' || row.a === null || row.b === null || row.a === '' || row.b === '') return { text: '', tone: 'neutral' };
  const a = Number(row.a);
  const b = Number(row.b);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return { text: 'Same', tone: 'neutral' };
  const delta = b - a;
  const text = row.kind === 'money' ? formatMoneyDelta(delta) : row.kind === 'percent' ? formatPointsDelta(delta) : row.kind === 'price' ? `${delta > 0 ? '+' : '-'}$${formatDecimalPlain(Math.abs(delta), 4).replace(/0{1,2}$/, '')}` : `${delta > 0 ? '+' : '-'}${formatNumber(Math.abs(delta), { maxDigits: 2 })}`;
  const tone = !row.goodWhen ? 'neutral' : (delta > 0) === (row.goodWhen === 'up') ? 'good' : 'bad';
  return { text, tone };
}

function compareRows(a: Side, b: Side): CompareRow[] {
  const input = (side: Side, pick: (inputs: CalcInputs) => string): string | null => pick(side.inputs).replace(/[$,%\s]/g, '') || null;
  const rate = (side: Side): number | null => side.summary?.blendedRateCents ?? null;
  const out = (pick: (summary: CalcSummary) => number | string | null) => ({ a: a.summary ? pick(a.summary) : null, b: b.summary ? pick(b.summary) : null });
  return [
    { label: 'Units', kind: 'number', a: input(a, (i) => i.units), b: input(b, (i) => i.units) },
    { label: 'Target pace', kind: 'number', a: input(a, (i) => i.standardUph), b: input(b, (i) => i.standardUph) },
    { label: 'People', kind: 'number', a: crewHeadcount(a.inputs.crew), b: crewHeadcount(b.inputs.crew) },
    { label: 'Real cost of an hour', kind: 'money', a: rate(a), b: rate(b), goodWhen: 'down' },
    { label: 'Material per unit', kind: 'price', a: a.inputs.partsOwner === 'client' ? '0' : input(a, (i) => i.materialPerUnit), b: b.inputs.partsOwner === 'client' ? '0' : input(b, (i) => i.materialPerUnit), goodWhen: 'down' },
    { label: 'Target margin', kind: 'percent', ...out((s) => s.targetMarginBp) },
    { label: 'Labor hours', kind: 'hours', ...out((s) => s.laborHours), goodWhen: 'down' },
    { label: 'Labor cost', kind: 'money', ...out((s) => s.laborCents), goodWhen: 'down' },
    { label: 'Material cost', kind: 'money', ...out((s) => s.materialCents), goodWhen: 'down' },
    { label: 'Other costs', kind: 'money', ...out((s) => s.otherCents + s.serviceCostCents), goodWhen: 'down' },
    { label: 'Time not on a job', kind: 'money', ...out((s) => s.sharedCents), goodWhen: 'down' },
    { label: 'All cost', kind: 'money', ...out((s) => s.costCents), goodWhen: 'down', strong: true },
    { label: 'Price per unit', kind: 'price', ...out((s) => s.chosen?.pricePerUnit ?? null), strong: true },
    { label: 'Total', kind: 'money', ...out((s) => s.chosen?.revenueCents ?? null), goodWhen: 'up', strong: true },
    { label: 'Profit', kind: 'money', ...out((s) => s.chosen?.profitCents ?? null), goodWhen: 'up', strong: true },
    { label: 'Margin', kind: 'percent', ...out((s) => s.chosen?.marginBp ?? null), goodWhen: 'up', strong: true },
    { label: 'Break even price', kind: 'price', ...out((s) => s.breakeven?.pricePerUnit ?? null), goodWhen: 'down' },
    { label: 'Lowest price worth taking', kind: 'price', ...out((s) => s.lowest?.pricePerUnit ?? null), goodWhen: 'down' },
  ];
}

const CURRENT = 'current';

export function CompareDialog({ open, onOpenChange, scenarios, current, workingDays }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly scenarios: readonly QuoteScenarioDTO[]; readonly current: { readonly name: string; readonly inputs: CalcInputs }; readonly workingDays: readonly number[] }) {
  const [left, setLeft] = useState<string>(CURRENT);
  const [right, setRight] = useState<string | null>(null);
  const options = useMemo(() => [{ value: CURRENT, label: 'What is on the screen now' }, ...scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))], [scenarios]);
  const side = (id: string | null): Side | null => {
    if (!id) return null;
    const base = id === CURRENT ? current : scenarios.find((scenario) => scenario.id === id);
    if (!base) return null;
    return { name: id === CURRENT ? current.name : base.name, inputs: base.inputs, summary: runCalc(base.inputs, { workingDays }).summary };
  };
  const a = side(left);
  const b = side(right ?? scenarios.find((scenario) => scenario.id !== left)?.id ?? null);
  const rightValue = right ?? scenarios.find((scenario) => scenario.id !== left)?.id ?? null;
  const rows = a && b ? compareRows(a, b) : [];
  const verdict = (() => {
    if (!a?.summary?.chosen || !b?.summary?.chosen) return null;
    const delta = b.summary.chosen.profitCents - a.summary.chosen.profitCents;
    if (delta === 0) return 'Both make the same profit.';
    return `${delta > 0 ? b.name : a.name} makes ${formatMoney(Math.abs(delta))} more profit.`;
  })();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="compare-dialog">
        <DialogHeader title="Compare two scenarios" description="Pick two and see every number side by side. The last column is the second one less the first." />
        <DialogBody className="flex flex-col gap-4 pb-4">
          {scenarios.length === 0 ? (
            <p className="rounded-lg bg-sunken px-3 py-3 text-sm text-fg-secondary" data-testid="compare-empty">
              Save at least one scenario first. Then you can compare it with what is on the screen, for example the same job at two prices or with two crews.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First">{({ inputId }) => <Select id={inputId} aria-label="First scenario" value={left} onValueChange={setLeft} options={options} />}</Field>
                <Field label="Second">{({ inputId }) => <Select id={inputId} aria-label="Second scenario" value={rightValue ?? undefined} onValueChange={setRight} options={options} placeholder="Pick a scenario" />}</Field>
              </div>
              {a && b ? (
                <>
                  {!a.summary || !b.summary ? <p className="text-sm text-warning-text">One of these is missing numbers, so some rows are empty.</p> : null}
                  <ScrollX label="Two scenarios side by side" className="-mx-6" scrollerClassName="px-6">
                    <table className="w-full min-w-[520px] border-collapse text-sm tabular-nums" data-testid="compare-table">
                      <thead>
                        <tr className="border-b border-border-default text-xs text-fg-muted">
                          <th scope="col" className="py-2 pr-3 text-left font-medium">
                            Number
                          </th>
                          <th scope="col" className="max-w-[160px] truncate px-3 py-2 text-right font-medium">
                            {a.name}
                          </th>
                          <th scope="col" className="max-w-[160px] truncate px-3 py-2 text-right font-medium">
                            {b.name}
                          </th>
                          <th scope="col" className="py-2 pl-3 text-right font-medium">
                            Difference
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const diff = difference(row);
                          return (
                            <tr key={row.label} className={cn('border-b border-border-subtle last:border-b-0', row.strong && 'font-semibold')}>
                              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg-secondary">
                                {row.label}
                              </th>
                              <td className="px-3 py-1.5 text-right text-fg">{show(row.kind, row.a)}</td>
                              <td className="px-3 py-1.5 text-right text-fg">{show(row.kind, row.b)}</td>
                              <td className={cn('py-1.5 pl-3 text-right', diff.tone === 'good' ? 'text-success-text' : diff.tone === 'bad' ? 'text-danger-text' : 'text-fg-muted')}>{diff.text}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollX>
                  {verdict ? (
                    <p className="rounded-lg bg-sunken px-3 py-2 text-sm font-medium text-fg" data-testid="compare-verdict">
                      {verdict}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-fg-secondary">Pick a second scenario to compare.</p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ scenario to job */

export function JobFromScenarioDialog({ scenario, setup, onClose }: { readonly scenario: QuoteScenarioDTO; readonly setup: CalculatorSetupDTO; readonly onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(scenario.name);
  const [client, setClient] = useState<ClientChoice>(() => {
    const found = setup.clients.find((item) => item.id === scenario.clientId);
    return found ? { text: found.name, clientId: found.id, createNew: false } : NO_CLIENT;
  });
  const [clientOpen, setClientOpen] = useState(false);
  const clientRef = useRef<HTMLInputElement>(null);
  const [startDate, setStartDate] = useState<string | null>(setup.defaults.today);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const chosen = scenario.result?.chosen ?? null;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the job a name.';
    // The same client box and the same words as quick add and the new job wizard.
    const clientId = client.clientId ?? matchClientName(client.text.trim(), setup.clients).exact?.id ?? null;
    const clientProblem = clientBoxProblem(client, setup.clients);
    if (clientProblem) next.clientId = clientProblem;
    if (startDate && dueDate && dueDate < startDate) next.dueDate = 'The due date is before the start date.';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (next.clientId) clientRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const result = await createJobFromScenarioAction({ scenarioId: scenario.id, name: name.trim(), clientId, clientName: clientId ? null : client.text.trim(), createClient: clientId === null && client.createNew, startDate, dueDate });
      if (!result.ok) {
        setErrors(result.error.fields ?? {});
        if (result.error.fields?.clientId) clientRef.current?.focus();
        else toast.error("Couldn't create the job", result.error.message);
        return;
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: quoteKeys.list() }), queryClient.invalidateQueries({ queryKey: qk.jobsRoot() })]);
      toast.success(`Job ${result.data.jobNumber} created`, 'The scenario is its quote. It is planned until you start it.');
      onClose();
      router.push(routes.jobTab(result.data.jobNumber, 'plan'));
    } catch {
      toast.error("Couldn't create the job", 'Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" data-testid="job-from-scenario">
        <DialogHeader title="Create a job from this scenario" description="The price, the pace, the crew and the costs of the scenario become the job and its quote, so plan vs actual starts from what you quoted." />
        <DialogBody>
          <form
            id="job-from-scenario-form"
            noValidate
            className="grid gap-3 pb-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label="Job name" required error={errors.name} className="sm:col-span-2">
              {({ inputId, describedBy, invalid }) => <Input id={inputId} aria-describedby={describedBy} invalid={invalid} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} data-testid="job-from-scenario-name" autoFocus />}
            </Field>
            <Field label="Client" required className="sm:col-span-2">
              {({ inputId }) => (
                <ClientCombo
                  id={inputId}
                  inputRef={clientRef}
                  clients={setup.clients}
                  value={client}
                  onChange={(next) => {
                    setClient(next);
                    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'clientId' && key !== 'clientName' && key !== 'clientLookAlike')));
                  }}
                  error={errors.clientId ?? errors.clientName ?? null}
                  hint={client.createNew ? `"${client.text.trim()}" is new. Pulse adds it as a client when you create the job.` : 'Pick one from the list. To add a new client, type the name and choose Create.'}
                  open={clientOpen}
                  onOpenChange={setClientOpen}
                  testId="job-from-scenario-client"
                />
              )}
            </Field>
            <Field label="Start date">{({ inputId }) => <IsoDatePicker id={inputId} aria-label="Start date" value={startDate} onChange={setStartDate} clearable />}</Field>
            <Field label="Due date" error={errors.dueDate}>
              {({ inputId }) => <IsoDatePicker id={inputId} aria-label="Due date" value={dueDate} onChange={setDueDate} clearable />}
            </Field>
          </form>
          {chosen ? (
            <dl className="mb-3 grid grid-cols-3 gap-3 rounded-lg bg-sunken px-3 py-2.5 text-xs tabular-nums">
              <div>
                <dt className="text-fg-muted">Price per unit</dt>
                <dd className="text-sm font-semibold text-fg">{formatUnitPrice(chosen.pricePerUnit)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Quote total</dt>
                <dd className="text-sm font-semibold text-fg">{formatMoney(chosen.revenueCents)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Planned margin</dt>
                <dd className="text-sm font-semibold text-fg">{formatPercentBp(chosen.marginBp, { empty: 'Unknown' })}</dd>
              </div>
            </dl>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="job-from-scenario-form" loading={saving} data-testid="job-from-scenario-save">
            Create the job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
