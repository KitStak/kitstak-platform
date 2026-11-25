'use client';
/**
 * Quick setup (`/programs/new?mode=quick`, docs/programs/SPEC.md 5.4): one page with the name
 * and key, the customer, what builds count, "Paste your kits" (or add them one by one), one price
 * per unit with "Set prices later", and "Make builds every work day" with how many of each.
 * Everything else takes its default. "Use the full setup" keeps what was typed.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Building2, ClipboardPaste, Handshake, ListPlus, Plus, Trash2, Zap } from 'lucide-react';
import { Button, Combobox, Field, IconButton, Input, Switch, ToggleGroup, cn } from '@/components/ui';
import { suggestProjectKey } from '@/lib/task-key';
import { PasteList, buildRows, localId } from '@/features/programs/editors';
import { ProjectedMonth } from './preview-rail';
import { takenMessages } from './step-basics';
import { UNIT_CHOICES, applyQuickQty, basicsProblems, unitOf, wizardVariants, type UnitChoice, type WizardEnv } from './wizard-model';
import type { SetState, WizardData } from './wizard-types';
import type { WizardState } from './wizard-model';

export interface QuickSetupProps {
  readonly state: WizardState;
  readonly set: SetState;
  readonly data: WizardData;
  readonly env: WizardEnv;
  readonly creating: boolean;
  readonly onCreate: (state: WizardState) => void;
  readonly onFullSetup: () => void;
}

export function QuickSetup({ state, set, data, env, creating, onCreate, onFullSetup }: QuickSetupProps) {
  const [tried, setTried] = useState(false);
  const [kitsMode, setKitsMode] = useState<'paste' | 'one'>(state.variants.mode === 'list' ? 'one' : 'paste');
  const [qty, setQty] = useState('100');
  const b = state.basics;
  const unit = unitOf(b);
  const takenSet = useMemo(() => new Set(data.taken.map((row) => row.key)), [data.taken]);
  const taken = useMemo(() => takenMessages(data.taken, b.name), [data.taken, b.name]);
  const problems = basicsProblems(state, taken);
  const variants = wizardVariants(state);
  const rateProblem = !state.price.later && state.price.lines.perUnit.price.trim() === '' ? `Add a price per ${unit.singular}, or choose Set prices later.` : null;
  const kitsProblem = variants.length === 0 ? `Add at least one ${unit.singular}.` : null;
  const qtyProblem = state.schedule.enabled && !/^\d{1,8}(\.\d{1,3})?$/.test(qty.trim()) ? 'Use a number like 100.' : null;
  const err = (message: string | null | undefined) => (tried ? (message ?? null) : null);
  const customerOptions = data.customers.map((customer) => ({ value: `${customer.kind}:${customer.id}`, label: customer.name, description: customer.kind === 'core' ? 'Customer' : 'CRM account', icon: customer.kind === 'core' ? <Building2 aria-hidden /> : <Handshake aria-hidden /> }));

  const submit = () => {
    setTried(true);
    if (Object.keys(problems).length || rateProblem || kitsProblem || qtyProblem) return;
    onCreate(applyQuickQty({ ...state, schedule: { ...state.schedule, pattern: 'weekdays', name: state.schedule.name || `${state.basics.name.trim()} run`, startsOn: state.basics.startDate } }, qty.trim()));
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="quick-setup">
      <div className="flex max-w-[760px] min-w-0 flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
          <Field label="Program name" required hint="For example Glove kitting" error={err(problems.name)}>
            {({ inputId, invalid }) => (
              <Input id={inputId} size="lg" value={b.name} invalid={invalid} autoFocus maxLength={80} data-testid="program-name" onChange={(event) => { const name = event.target.value; set((s) => ({ ...s, basics: { ...s.basics, name, key: s.basics.keyEdited ? s.basics.key : suggestProjectKey(name, takenSet) } })); }} />
            )}
          </Field>
          <Field label="Key" required hint={b.key ? `Build ids: ${b.key}-1` : 'Short code for build ids'} error={err(problems.key) ?? (takenSet.has(b.key) ? taken.get(b.key) : null)}>
            {({ inputId, invalid }) => <Input id={inputId} size="lg" value={b.key} invalid={invalid} className="font-key uppercase" data-testid="program-key" onChange={(event) => set((s) => ({ ...s, basics: { ...s.basics, key: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6), keyEdited: true } }))} />}
          </Field>
        </div>
        <div className="grid gap-4">
          <Field label="Customer" hint="Optional">
            {({ inputId }) => (
              <Combobox id={inputId} className="h-10" options={[{ value: 'none', label: 'No customer' }, ...customerOptions]} value={b.customer ? `${b.customer.kind}:${b.customer.id}` : 'none'} searchPlaceholder="Search customers and accounts" onValueChange={(value) => {
                const found = data.customers.find((entry) => `${entry.kind}:${entry.id}` === value);
                set((s) => ({ ...s, basics: { ...s.basics, customer: found ? { ...found } : null } }));
              }} />
            )}
          </Field>
          <Field label="What do builds count?" error={err(problems.unit)}>
            {() => (
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  label="What do builds count?"
                  value={b.unitChoice}
                  onValueChange={(value: UnitChoice) => set((s) => ({ ...s, basics: { ...s.basics, unitChoice: value } }))}
                  options={UNIT_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
                  className="max-w-full shrink-0 overflow-x-auto whitespace-nowrap"
                />
                {b.unitChoice === 'custom' ? (
                  <div className="grid min-w-[240px] flex-1 grid-cols-2 gap-2">
                    <Input aria-label="One" leadingIcon={<span className="text-xs text-fg-muted">One</span>} value={b.customOne} invalid={Boolean(err(problems.unit)) && !b.customOne.trim()} onChange={(event) => set((s) => ({ ...s, basics: { ...s.basics, customOne: event.target.value.slice(0, 24) } }))} placeholder="case" data-testid="quick-unit-one" />
                    <Input aria-label="Many" leadingIcon={<span className="text-xs text-fg-muted">Many</span>} value={b.customMany} invalid={Boolean(err(problems.unit)) && !b.customMany.trim()} onChange={(event) => set((s) => ({ ...s, basics: { ...s.basics, customMany: event.target.value.slice(0, 24) } }))} placeholder="cases" data-testid="quick-unit-many" />
                  </div>
                ) : null}
              </div>
            )}
          </Field>
        </div>

        <section className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-fg">Your {unit.plural}</h3>
            <ToggleGroup size="sm" label="How to add" value={kitsMode} onValueChange={(mode) => { setKitsMode(mode); set((s) => ({ ...s, variants: { ...s.variants, mode: mode === 'one' ? 'list' : 'matrix' } })); }} options={[{ value: 'paste', label: `Paste your ${unit.plural}`, icon: <ClipboardPaste aria-hidden /> }, { value: 'one', label: 'Add one by one', icon: <ListPlus aria-hidden /> }]} />
          </div>
          {kitsMode === 'paste' ? (
            <>
              <PasteList unit={unit} previous={state.variants.generator} onUse={(value) => set((s) => ({ ...s, variants: { ...s.variants, mode: 'matrix', generator: value } }))} />
              {state.variants.mode === 'matrix' && variants.length > 0 ? (
                <div className="flex flex-wrap gap-1.5" data-testid="quick-kits">
                  {buildRows(state.variants.generator, b.key).rows.filter((row) => row.include).map((row) => (
                    <span key={row.comboKey} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-sunken px-2 text-xs text-fg">{row.name}{row.sku ? <span className="font-key text-2xs text-fg-muted">{row.sku}</span> : null}</span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {state.variants.manual.map((row, index) => (
                <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_140px_32px] items-center gap-2">
                  <Input aria-label={`Name of ${unit.singular} ${index + 1}`} value={row.name} onChange={(event) => set((s) => ({ ...s, variants: { ...s.variants, manual: s.variants.manual.map((entry) => (entry.id === row.id ? { ...entry, name: event.target.value, key: event.target.value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) } : entry)) } }))} />
                  <Input aria-label={`SKU of ${unit.singular} ${index + 1}`} value={row.sku} className="font-key" onChange={(event) => set((s) => ({ ...s, variants: { ...s.variants, manual: s.variants.manual.map((entry) => (entry.id === row.id ? { ...entry, sku: event.target.value } : entry)) } }))} />
                  <IconButton size="sm" label={`Remove ${row.name || `${unit.singular} ${index + 1}`}`} icon={<Trash2 aria-hidden />} onClick={() => set((s) => ({ ...s, variants: { ...s.variants, manual: s.variants.manual.filter((entry) => entry.id !== row.id) } }))} />
                </div>
              ))}
              <Button variant="secondary" size="sm" leadingIcon={<Plus aria-hidden />} className="self-start" onClick={() => set((s) => ({ ...s, variants: { ...s.variants, mode: 'list', manual: [...s.variants.manual, { id: localId('v'), name: '', key: '', sku: '', defaultQty: '', unitPrice: '' }] } }))}>Add a {unit.singular}</Button>
            </div>
          )}
          {err(kitsProblem) ? <p role="alert" className="text-sm font-medium text-danger-text">{kitsProblem}</p> : null}
        </section>

        <section className="grid gap-4 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Field label={`Price per ${unit.singular}`} error={err(rateProblem)}>
              {({ inputId, invalid }) => <Input id={inputId} value={state.price.lines.perUnit.price} invalid={invalid} disabled={state.price.later} inputMode="decimal" leadingIcon={<span className="text-sm text-fg-muted">$</span>} onChange={(event) => set((s) => ({ ...s, price: { ...s.price, lines: { ...s.price.lines, perUnit: { ...s.price.lines.perUnit, on: true, price: event.target.value } } } }))} containerClassName="w-40" data-testid="quick-price" />}
            </Field>
            <button type="button" onClick={() => set((s) => ({ ...s, price: { ...s.price, later: !s.price.later } }))} className="self-start rounded-sm text-xs font-medium text-fg-secondary underline-offset-2 outline-none hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus">
              {state.price.later ? 'Add a price now' : 'Set prices later'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-fg">
              Make builds every work day
              <Switch checked={state.schedule.enabled} onCheckedChange={(enabled) => set((s) => ({ ...s, schedule: { ...s.schedule, enabled, pattern: 'weekdays' } }))} aria-label="Make builds every work day" />
            </label>
            {state.schedule.enabled ? (
              <Field label="How many of each" error={err(qtyProblem)}>
                {({ inputId, invalid }) => <Input id={inputId} value={qty} invalid={invalid} inputMode="decimal" onChange={(event) => setQty(event.target.value)} containerClassName="w-32" trailing={<span className="text-xs text-fg-muted">{unit.plural}</span>} />}
              </Field>
            ) : <p className="text-xs text-fg-muted">Plan builds by hand from the program.</p>}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-5">
          <button type="button" onClick={onFullSetup} className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-fg-secondary underline-offset-2 outline-none hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus" data-testid="full-setup">
            Use the full setup
            <ArrowRight aria-hidden className="size-4" />
          </button>
          <Button size="lg" leadingIcon={<Zap aria-hidden />} loading={creating} onClick={submit} data-testid="create-program">{creating ? 'Creating program' : 'Create program'}</Button>
        </div>
      </div>
      <div className={cn('lg:sticky lg:top-4')}>
        <ProjectedMonth state={applyQuickQty({ ...state, schedule: { ...state.schedule, startsOn: b.startDate } }, /^\d{1,8}(\.\d{1,3})?$/.test(qty.trim()) ? qty.trim() : '0')} env={env} />
        <p className="mt-2 px-1 text-xs text-fg-muted">Uses the workspace calendar, starts {b.startDate === env.today ? 'today' : b.startDate}, with no fees or links. Change any of it later.</p>
      </div>
    </div>
  );
}
