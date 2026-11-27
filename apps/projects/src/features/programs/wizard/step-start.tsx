'use client';
/**
 * Step 0 Start (docs/programs/SPEC.md 5.4): four large radio cards (scratch, won CRM deal,
 * template, copy) with the pick each needs inline, a Quick setup link and Resume a draft.
 */
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, FileStack, Handshake, LayoutTemplate, Search, Sparkles, Zap } from 'lucide-react';
import { formatCents } from '@kitstak/programs-engine';
import { Badge, Checkbox, Input, Tooltip, cn } from '@/components/ui';
import { routes } from '@/lib/routes';
import { ProgramIcon } from '@/features/programs/kit';
import { draftStep } from '@/features/programs/directory/drafts-strip';
import { shortDate } from '@kitstak/programs-engine';
import type { CopyInclude, StartMode } from './wizard-model';
import type { StepProps } from './wizard-types';

function StartCard({ mode, current, icon, title, text, disabled, tip, onPick }: { readonly mode: StartMode; readonly current: StartMode | null; readonly icon: ReactNode; readonly title: string; readonly text: string; readonly disabled?: boolean; readonly tip?: string; readonly onPick: (mode: StartMode) => void }) {
  const selected = current === mode;
  const card = (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onPick(mode)}
      data-testid={`start-${mode}`}
      className={cn(
        'relative flex h-24 w-full items-center gap-4 rounded-xl border bg-panel px-4 text-left shadow-xs outline-none',
        'transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        selected ? 'border-primary shadow-[0_0_0_3px_var(--focus-ring-soft)]' : 'border-border-subtle hover:-translate-y-px hover:border-border-default hover:shadow-sm motion-reduce:hover:translate-y-0',
        disabled && 'cursor-not-allowed opacity-60 hover:translate-y-0 hover:border-border-subtle hover:shadow-xs',
      )}
    >
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5', selected ? 'bg-primary-subtle text-primary-text' : 'bg-sunken text-icon')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-sm text-fg-secondary">{text}</span>
      </span>
      <span aria-hidden className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-primary bg-primary text-primary-fg' : 'border-border-default')}>
        {selected ? <Check className="size-3" /> : null}
      </span>
    </button>
  );
  if (disabled && tip) {
    return (
      <Tooltip content={tip}>
        <span tabIndex={0} className="block rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-focus">{card}</span>
      </Tooltip>
    );
  }
  return card;
}

function PickList({ label, children, search, onSearch }: { readonly label: string; readonly children: ReactNode; readonly search: string; readonly onSearch: (value: string) => void }) {
  return (
    <section className="flex animate-step-in flex-col gap-2 rounded-xl border border-border-subtle bg-panel p-3 shadow-xs" aria-label={label}>
      <Input value={search} onChange={(event) => onSearch(event.target.value)} aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}`} leadingIcon={<Search aria-hidden />} />
      <div role="listbox" aria-label={label} className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {children}
      </div>
    </section>
  );
}

function Option({ selected, onPick, children, testId }: { readonly selected: boolean; readonly onPick: () => void; readonly children: ReactNode; readonly testId?: string }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      data-testid={testId}
      className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-focus', selected ? 'border-primary bg-primary-subtle/40' : 'border-transparent hover:bg-hover')}
    >
      {children}
      {selected ? <Check aria-hidden className="size-4 shrink-0 text-primary-text" /> : null}
    </button>
  );
}

export interface StepStartProps extends StepProps {
  readonly onPickDeal: (id: string, title: string) => void;
  readonly onPickTemplate: (id: string, name: string) => void;
  readonly onPickCopy: (key: string) => void;
}

const COPY_PARTS: readonly { readonly key: keyof CopyInclude; readonly label: string; readonly hint: string }[] = [
  { key: 'variants', label: 'Variants', hint: 'Every kit with its SKU and default qty' },
  { key: 'priceCard', label: 'Price card', hint: 'The lines and rules in force today' },
  { key: 'schedules', label: 'Schedules', hint: 'Copied as paused until you turn them on' },
  { key: 'members', label: 'Members', hint: 'The same people and roles' },
  { key: 'links', label: 'Links', hint: 'CRM records and related projects' },
];

export function StepStart({ state, set, data, onPickDeal, onPickTemplate, onPickCopy }: StepStartProps) {
  const [search, setSearch] = useState('');
  const mode = state.start.mode;
  const pick = (next: StartMode) => {
    setSearch('');
    set((s) => ({ ...s, start: { ...s.start, mode: next } }));
  };
  const term = search.trim().toLowerCase();
  const deals = useMemo(() => data.wonDeals.filter((deal) => !term || [deal.name, deal.accountName ?? ''].some((text) => text.toLowerCase().includes(term))), [data.wonDeals, term]);
  const templates = useMemo(() => data.templates.filter((template) => !term || template.name.toLowerCase().includes(term)), [data.templates, term]);
  const programs = useMemo(() => data.programs.filter((program) => !term || [program.name, program.key, program.customer ?? ''].some((text) => text.toLowerCase().includes(term))), [data.programs, term]);

  return (
    <div className="flex flex-col gap-4" data-testid="wizard-start">
      <div role="radiogroup" aria-label="How to start" className="grid gap-3 sm:grid-cols-2">
        <StartCard mode="scratch" current={mode} onPick={pick} icon={<Sparkles aria-hidden />} title="Start from scratch" text="Set up variants, rates and a schedule yourself." />
        {data.crmOn ? (
          <StartCard mode="deal" current={mode} onPick={pick} icon={<Handshake aria-hidden />} title="From a won CRM deal" text="Use the deal's customer, value and rates." disabled={data.wonDeals.length === 0} tip="No won deals yet" />
        ) : null}
        <StartCard mode="template" current={mode} onPick={pick} icon={<LayoutTemplate aria-hidden />} title="From a template" text="Start from a saved program template." />
        <StartCard mode="copy" current={mode} onPick={pick} icon={<Copy aria-hidden />} title="Copy a program" text="Copy variants, rates and schedules from another program." disabled={data.programs.length === 0} tip="No programs to copy yet" />
      </div>

      {mode === 'deal' ? (
        <PickList label="Won deals" search={search} onSearch={setSearch}>
          {deals.length === 0 ? <p className="px-2 py-3 text-sm text-fg-muted">No won deals match.</p> : null}
          {deals.map((deal) => (
            <Option key={deal.id} selected={state.start.crmItemId === deal.id} onPick={() => onPickDeal(deal.id, deal.name)} testId="deal-option">
              <Handshake aria-hidden className="size-4 shrink-0 text-icon" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{deal.name}</span>
                <span className="block truncate text-xs text-fg-muted">
                  {[deal.accountName, deal.valueCents !== null ? `${formatCents(deal.valueCents)}${deal.currency && deal.currency.toUpperCase() !== 'USD' ? ` ${deal.currency.toUpperCase()}` : ''}` : null, deal.closeDate ? `Won ${shortDate(deal.closeDate)}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {deal.programKey ? (
                <Tooltip content={`This deal already has a program: ${deal.programKey}`}>
                  <span tabIndex={0} className="rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-focus"><Badge tone="info">Has a program</Badge></span>
                </Tooltip>
              ) : null}
            </Option>
          ))}
        </PickList>
      ) : null}

      {mode === 'template' ? (
        data.templates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-default bg-sunken/60 px-4 py-6 text-center text-sm text-fg-secondary">No program templates yet. Save a program as a template from its menu.</p>
        ) : (
          <div className="grid animate-step-in gap-3 sm:grid-cols-2" role="listbox" aria-label="Program templates">
            {templates.map((template) => {
              const selected = state.start.templateId === template.id;
              const payload = template.payload;
              return (
                <button
                  key={template.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onPickTemplate(template.id, template.name)}
                  className={cn('flex flex-col gap-2 rounded-xl border bg-panel p-3 text-left shadow-xs outline-none focus-visible:outline-2 focus-visible:outline-focus', selected ? 'border-primary shadow-[0_0_0_3px_var(--focus-ring-soft)]' : 'border-border-subtle hover:border-border-default')}
                  data-testid="template-option"
                >
                  <span className="flex items-center gap-2">
                    <ProgramIcon size={24} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-fg">{template.name}</span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {payload.variants.slice(0, 5).map((variant) => (
                      <span key={variant.key} className="rounded-sm bg-sunken px-1.5 py-0.5 text-2xs text-fg-secondary">{variant.name}</span>
                    ))}
                    {payload.variants.length > 5 ? <span className="px-1 text-2xs text-fg-muted">and {payload.variants.length - 5} more</span> : null}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {payload.variants.length} {payload.variants.length === 1 ? 'variant' : 'variants'} · {payload.card ? `${payload.card.lines.length} price ${payload.card.lines.length === 1 ? 'line' : 'lines'}` : 'No price card'} · {payload.schedules.length ? 'Has a schedule' : 'No schedule'}
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : null}

      {mode === 'copy' ? (
        <div className="grid animate-step-in gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
          <PickList label="Programs" search={search} onSearch={setSearch}>
            {programs.length === 0 ? <p className="px-2 py-3 text-sm text-fg-muted">No programs match.</p> : null}
            {programs.map((program) => (
              <Option key={program.key} selected={state.start.copyKey === program.key} onPick={() => onPickCopy(program.key)} testId="copy-option">
                <ProgramIcon icon={program.icon} color={program.color} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{program.name} <span className="font-key text-xs text-fg-muted">{program.key}</span></span>
                  <span className="block truncate text-xs text-fg-muted">{[program.customer, `${program.variantsCount} variants`, program.scheduleText].filter(Boolean).join(' · ')}</span>
                </span>
              </Option>
            ))}
          </PickList>
          <fieldset className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-panel p-3 shadow-xs">
            <legend className="px-1 text-xs font-medium text-fg-secondary">What to copy</legend>
            {COPY_PARTS.map((part) => (
              <label key={part.key} className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 hover:bg-hover">
                <Checkbox checked={state.start.copyInclude[part.key]} onCheckedChange={(checked) => set((s) => ({ ...s, start: { ...s.start, copyInclude: { ...s.start.copyInclude, [part.key]: checked === true } } }))} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium text-fg">{part.label}</span>
                  <span className="block text-xs text-fg-muted">{part.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="flex flex-wrap items-center gap-x-1.5">
          <Link href={routes.newProgram({ mode: 'quick' })} className="inline-flex items-center gap-1.5 rounded-sm font-medium text-fg underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus" data-testid="quick-setup-link">
            <Zap aria-hidden className="size-4 text-icon" />
            Quick setup
          </Link>
          <span className="text-fg-muted">Name, kits and one rate on one page</span>
        </span>
        {data.drafts.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-1.5">
          <Link href={routes.newProgram({ draft: data.drafts[0]!.id })} className="inline-flex items-center gap-1.5 rounded-sm font-medium text-fg underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            <FileStack aria-hidden className="size-4 text-icon" />
            Resume a draft
          </Link>
          <span className="text-fg-muted">{data.drafts[0]!.title || 'Untitled program'}, {draftStep(data.drafts[0]!).toLowerCase()}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
