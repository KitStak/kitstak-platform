'use client';
/**
 * Step 4 Schedule and Step 5 Links and review (docs/programs/SPEC.md 5.4).
 */
import { Activity, FolderKanban, Handshake, Pencil, UserPlus, X } from 'lucide-react';
import { formatCents, formatUnitPrice, shortDate } from '@kitstak/programs-engine';
import { Badge, Button, Checkbox, Combobox, IconButton, Select, Tooltip, UserPicker, cn } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { PROJECT_ROLES, PROJECT_ROLE_LABELS, type ProjectRole } from '@/lib/constants';
import { usePeople, useProjects } from '@/lib/hooks/use-data';
import { useShell } from '@/features/shell/shell-context';
import { RecordPicker } from '@/features/projects/record-picker';
import { ScheduleEditor, scheduleRuleText, toCardLines } from '@/features/programs/editors';
import { runUnitsText, unitOf, variantRates, wizardCalendar, wizardVariants, type StepId, type WizardEnv } from './wizard-model';
import type { StepProps } from './wizard-types';

export function StepSchedule({ state, set, problems, showErrors, env }: StepProps & { readonly env: WizardEnv }) {
  const people = usePeople();
  const variants = wizardVariants(state);
  return (
    <div className="flex flex-col gap-4" data-testid="wizard-schedule">
      <ScheduleEditor
        value={state.schedule}
        onChange={(value) => set((s) => ({ ...s, schedule: value }))}
        variants={variants.map((variant) => ({ key: variant.key, name: variant.name, color: variant.color, defaultQty: variant.defaultQty }))}
        calendar={wizardCalendar(state, env)}
        holidays={env.holidays}
        today={env.today}
        unit={unitOf(state.basics)}
        people={(people.data ?? []).map((person) => ({ id: person.id, name: person.name, email: person.email, image: person.image ?? null }))}
        showErrors={showErrors}
      />
      {showErrors && Object.keys(problems).length ? <p role="alert" className="text-sm font-medium text-danger-text">{Object.values(problems)[0]}</p> : null}
    </div>
  );
}

function Section({ title, text, children, aside }: { readonly title: string; readonly text?: string; readonly children: React.ReactNode; readonly aside?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          {text ? <p className="text-sm text-fg-muted">{text}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, children, onEdit }: { readonly label: string; readonly children: React.ReactNode; readonly onEdit: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-border-subtle py-2.5 last:border-0">
      <dt className="w-28 shrink-0 text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-fg">{children}</dd>
      <Button variant="ghost" size="sm" leadingIcon={<Pencil aria-hidden />} onClick={onEdit} aria-label={`Edit ${label.toLowerCase()}`}>
        Edit
      </Button>
    </div>
  );
}

export interface StepReviewProps extends StepProps {
  readonly env: WizardEnv;
  readonly goTo: (step: StepId) => void;
}

export function StepReview({ state, set, data, problems, showErrors, env, goTo }: StepReviewProps) {
  const { user } = useShell();
  const people = usePeople();
  const projects = useProjects();
  const links = state.links;
  const ownerId = state.basics.ownerId;
  const patch = (change: Partial<typeof links>) => set((s) => ({ ...s, links: { ...s.links, ...change } }));
  const memberIds = links.members.map((member) => member.userId);
  const byId = new Map((people.data ?? []).map((person) => [person.id, person]));
  const unit = unitOf(state.basics);
  const variants = wizardVariants(state);
  const rates = variantRates(state);
  const cardLines = toCardLines({ ...state.price.lines, variantRates: {} });
  const rules = state.variants.generator.rules;
  const b = state.basics;
  const jobs = data.pulseJobs ?? [];
  const pulsePossible = data.pulseOn && data.pulseJobs !== null;
  const openPlanner = links.openPlanner ?? !(state.schedule.enabled && state.schedule.lines.some((line) => line.include));

  const lineText = cardLines.map((line) => {
    if (line.kind === 'per_unit') return `${formatUnitPrice(line.unitPrice ?? '0')} per ${unit.singular}`;
    if (line.kind === 'per_order') return `${formatCents(line.amountCents ?? '0', { cents: true })} per batch`;
    if (line.kind === 'per_hour') return `${formatCents(line.rateCents ?? 0, { cents: true })} per hour`;
    if (line.kind === 'flat_monthly') return `${formatCents(line.amountCents ?? '0', { cents: true })} monthly fee`;
    return `${formatCents(line.amountCents ?? '0', { cents: true })} monthly minimum`;
  });

  return (
    <div className="flex flex-col gap-4" data-testid="wizard-review">
      <Section
        title="People"
        text="Only members at Editor or above see money. Change this in Settings."
        aside={
          <UserPicker
            multiple
            people={(people.data ?? []).filter((person) => person.id !== ownerId)}
            meId={user.id}
            value={memberIds}
            onChange={(ids) => patch({ members: ids.map((id) => links.members.find((member) => member.userId === id) ?? { userId: id, role: 'editor' as ProjectRole }) })}
            trigger={<Button variant="secondary" leadingIcon={<UserPlus aria-hidden />}>Add people</Button>}
          />
        }
      >
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          <li className="flex items-center gap-3 px-3 py-2">
            <PersonAvatar userId={ownerId} showName className="min-w-0 flex-1" />
            <span className="text-xs text-fg-muted">Owner</span>
          </li>
          {links.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-3 py-2">
              <PersonAvatar userId={member.userId} showName className="min-w-0 flex-1" />
              <Select size="sm" aria-label={`Role for ${byId.get(member.userId)?.name ?? 'teammate'}`} value={member.role} onValueChange={(role) => patch({ members: links.members.map((entry) => (entry.userId === member.userId ? { ...entry, role: role as ProjectRole } : entry)) })} options={PROJECT_ROLES.map((role) => ({ value: role, label: PROJECT_ROLE_LABELS[role] }))} className="w-32" />
              <IconButton label={`Remove ${byId.get(member.userId)?.name ?? 'teammate'}`} icon={<X aria-hidden />} size="sm" onClick={() => patch({ members: links.members.filter((entry) => entry.userId !== member.userId) })} />
            </li>
          ))}
        </ul>
      </Section>

      {data.crmOn ? (
        <Section title="CRM" text="Link the deal and the account so CRM shows this program and its revenue.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Deal</span>
              <RecordPicker type="crm_item" value={links.crmDealId ? { type: 'crm_item', id: links.crmDealId, title: links.crmDealTitle ?? state.start.crmItemTitle ?? 'Deal', status: null, url: null } : null} onChange={(record) => patch({ crmDealId: record?.id ?? null, crmDealTitle: record?.title ?? null })} placeholder="Pick a deal" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-secondary">Account</span>
              {b.customer?.kind === 'crm_account' ? (
                <p className="flex h-8 items-center gap-2 rounded-md border border-border-subtle bg-sunken px-3 text-sm text-fg"><Handshake aria-hidden className="size-4 text-icon" />{b.customer.name}<span className="text-xs text-fg-muted">· the customer</span></p>
              ) : (
                <RecordPicker type="crm_account" value={links.crmAccountId ? { type: 'crm_account', id: links.crmAccountId, title: links.crmAccountTitle ?? 'Account', status: null, url: null } : null} onChange={(record) => patch({ crmAccountId: record?.id ?? null, crmAccountTitle: record?.title ?? null })} placeholder="Pick an account" />
              )}
            </div>
          </div>
        </Section>
      ) : null}

      {pulsePossible ? (
        <Section title="Pulse" text="Build output and fees go to this job, so Pulse can show cost and margin.">
          <div role="radiogroup" aria-label="Pulse job" className="flex flex-col gap-2" data-field="pulse">
            {([
              { value: 'none', label: 'Do not link a job', text: 'You can link one later from the program.' },
              { value: 'link', label: 'Link an ongoing job', text: 'Pick an ongoing per unit job for this customer.' },
              { value: 'new', label: 'Make a new Pulse job', text: 'The program saves first, then Pulse opens with it filled in.' },
            ] as const).map((option) => (
              <label key={option.value} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5', links.pulse === option.value ? 'border-primary bg-primary-subtle/30' : 'border-border-subtle hover:bg-hover')}>
                <input type="radio" name="pulse" value={option.value} checked={links.pulse === option.value} onChange={() => patch({ pulse: option.value })} className="mt-1 accent-[var(--primary)]" />
                <span>
                  <span className="block text-sm font-medium text-fg">{option.label}</span>
                  <span className="block text-xs text-fg-muted">{option.text}</span>
                </span>
              </label>
            ))}
          </div>
          {links.pulse === 'link' ? (
            <div className="flex flex-col gap-1.5">
              <Combobox
                aria-label="Pulse job"
                options={jobs.map((job) => ({ value: job.id, label: `${job.number} · ${job.name}`, description: job.refusal ?? [job.clientName, job.unitLabel].filter(Boolean).join(' · '), disabled: Boolean(job.refusal) }))}
                value={links.pulseJobId}
                onValueChange={(value) => patch({ pulseJobId: value })}
                placeholder="Pick a job"
                searchPlaceholder="Search jobs"
                emptyMessage="No open jobs"
                invalid={showErrors && Boolean(problems.pulse)}
              />
              {showErrors && problems.pulse ? <span role="alert" className="text-2xs font-medium text-danger-text">{problems.pulse}</span> : <span className="text-2xs text-fg-muted">Jobs that cannot take a program say why.</span>}
            </div>
          ) : null}
        </Section>
      ) : !data.pulseOn ? (
        <section className="flex items-center gap-3 rounded-xl border border-dashed border-border-default bg-sunken/60 px-4 py-3 text-sm text-fg-secondary">
          <Activity aria-hidden className="size-4 shrink-0 text-icon" />
          Add Pulse to see labor, cost and margin for this program.
        </section>
      ) : null}

      <Section title="Projects" text="Optional. Related projects show this program on their Linked panel.">
        <Combobox
          multiple
          aria-label="Related projects"
          options={(projects.data ?? []).map((project) => ({ value: project.id, label: project.name, description: project.key, icon: <FolderKanban aria-hidden /> }))}
          value={[...links.projectIds]}
          onValueChange={(ids) => patch({ projectIds: ids })}
          placeholder="No related projects"
          searchPlaceholder="Search projects"
        />
      </Section>

      <section className="flex flex-col rounded-xl border border-border-subtle bg-sunken/60 p-4" aria-label="Review" data-testid="wizard-summary">
        <h3 className="mb-1 text-base font-semibold text-fg">Review</h3>
        <dl>
          <SummaryRow label="Basics" onEdit={() => goTo('basics')}>
            <span className="font-medium">{b.name || 'Untitled program'}</span> <span className="font-key text-fg-muted">{b.key}</span>
            <span className="block text-xs text-fg-secondary">{[b.customer?.name ?? 'No customer', `Counts ${unit.plural}`, `Starts ${shortDate(b.startDate)}`, b.endDate ? `Ends ${shortDate(b.endDate)}` : 'Ongoing'].join(' · ')}</span>
          </SummaryRow>
          <SummaryRow label="Variants" onEdit={() => goTo('variants')}>
            {variants.length} {variants.length === 1 ? 'variant' : 'variants'}
            <span className="mt-1 flex flex-wrap gap-1">
              {variants.slice(0, 10).map((variant) => (
                <Tooltip key={variant.key} content={variant.sku ?? variant.key}>
                  <span tabIndex={0} className="rounded-sm bg-panel px-1.5 py-0.5 text-2xs text-fg-secondary outline-none ring-1 ring-border-subtle focus-visible:outline-2 focus-visible:outline-focus">{variant.name}</span>
                </Tooltip>
              ))}
              {variants.length > 10 ? <span className="px-1 text-2xs text-fg-muted">and {variants.length - 10} more</span> : null}
            </span>
          </SummaryRow>
          <SummaryRow label="Price card" onEdit={() => goTo('price')}>
            {state.price.later ? (
              <Badge tone="neutral">Prices later</Badge>
            ) : (
              <>
                {lineText.join(' · ') || 'No lines'}
                {rules.length ? <span className="block text-xs text-fg-secondary">{rules.length} rate {rules.length === 1 ? 'rule' : 'rules'} · {[...rates.values()].filter((rate) => rate.source === 'rule').length} variants priced by rules</span> : null}
                {state.price.oneTime.length ? <span className="block text-xs text-fg-secondary">{state.price.oneTime.length} setup {state.price.oneTime.length === 1 ? 'fee' : 'fees'}</span> : null}
              </>
            )}
          </SummaryRow>
          <SummaryRow label="Schedule" onEdit={() => goTo('schedule')}>
            {state.schedule.enabled && state.schedule.lines.some((line) => line.include) ? (
              <>
                {state.schedule.name || `${b.name} run`} · {scheduleRuleText(state.schedule, wizardCalendar(state, env))}
                <span className="block text-xs text-fg-secondary">{runUnitsText(state)} each run · builds made {state.schedule.leadDays} days ahead</span>
              </>
            ) : (
              'No schedule. Plan builds by hand.'
            )}
          </SummaryRow>
          <SummaryRow label="Links" onEdit={() => goTo('review')}>
            {[links.crmDealTitle ? `Deal ${links.crmDealTitle}` : null, links.crmAccountTitle ? `Account ${links.crmAccountTitle}` : null, links.pulse === 'link' && links.pulseJobId ? `Pulse ${jobs.find((job) => job.id === links.pulseJobId)?.number ?? 'job'}` : links.pulse === 'new' ? 'A new Pulse job' : null, links.projectIds.length ? `${links.projectIds.length} related ${links.projectIds.length === 1 ? 'project' : 'projects'}` : null, `${links.members.length + 1} ${links.members.length === 0 ? 'person' : 'people'}`].filter(Boolean).join(' · ')}
          </SummaryRow>
        </dl>
        <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-fg">
            <Checkbox checked={openPlanner} onCheckedChange={(checked) => patch({ openPlanner: checked === true })} />
            Open the build planner after I create it
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-fg">
            <Checkbox checked={links.importPast} onCheckedChange={(checked) => patch({ importPast: checked === true })} />
            Bring in past output after I create it
          </label>
        </div>
      </section>
    </div>
  );
}
