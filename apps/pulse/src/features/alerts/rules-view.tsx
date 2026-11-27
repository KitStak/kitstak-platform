'use client';
/**
 * Alert rules. A rule is one sentence: "Tell me when a job's margin is heading under 15%."
 * The builder picks what to watch, the line, which jobs it covers, who gets told, how loud it
 * is and quiet hours, and shows what the rule would have said over the last 30 days before you
 * save it. Rules that come with Pulse can be changed and turned off, not deleted.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BellRing, ListChecks, MoonStar, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Checkbox, Drawer, DrawerContent, Field, IconButton, Input, Select, Skeleton, Switch, ToggleGroup, UserPicker, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { BarChart } from '@/components/charts/cartesian';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { keepOpenForToasts } from '@/features/calculator/toast-safe';
import { apiGet, apiPath } from '@/lib/api-client';
import { ALERT_KINDS, type AlertKind, type AlertSeverity } from '@/lib/constants';
import { useAlertRules, usePeople } from '@/lib/hooks/use-data';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { shortDate } from '@/lib/profit/calendar';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { AlertRuleDTO } from '@/lib/types';
import { deleteAlertRuleAction } from '@/server/actions/alerts';
import { saveAlertRuleFullAction, type SaveAlertRuleFullActionInput } from '@/server/actions/money-ops';
import type { RulePreviewDTO } from '@/server/domain/alert-ops';
import { clockLabel, quietOf, quietSentence, type QuietHours } from './quiet-hours';
import { RULE_GROUPS, RULE_KINDS, readThreshold, ruleSentence, storedRuleName, tellSentence, thresholdText, tidyThreshold, type RuleFacts } from './rule-kinds';

interface Named {
  readonly id: string;
  readonly name: string;
}
export interface RuleOptions {
  readonly clients: readonly Named[];
  readonly jobTypes: readonly Named[];
  readonly sites: readonly Named[];
}

type ScopeKind = 'all' | 'client' | 'jobType' | 'site';
const SCOPE_KEY = { client: 'clientId', jobType: 'jobTypeId', site: 'siteId' } as const;
const SCOPE_WORD = { client: 'client', jobType: 'job type', site: 'site' } as const;
const ROLES = [
  { id: 'owner', label: 'Owners' },
  { id: 'admin', label: 'Admins' },
  { id: 'manager', label: 'Managers' },
  { id: 'supervisor', label: 'Supervisors' },
] as const;
const SEVERITY_LABEL: Readonly<Record<AlertSeverity, string>> = { info: 'Good to know', warning: 'Heads up', critical: 'Urgent' };
const SEVERITY_TONE: Readonly<Record<AlertSeverity, 'neutral' | 'warning' | 'danger'>> = { info: 'neutral', warning: 'warning', critical: 'danger' };

interface Draft {
  readonly id: string | null;
  readonly isSystem: boolean;
  readonly kind: AlertKind;
  readonly typed: string;
  readonly scopeKind: ScopeKind;
  readonly scopeId: string | null;
  readonly severity: AlertSeverity;
  readonly roles: readonly string[];
  readonly userIds: readonly string[];
  readonly enabled: boolean;
  readonly quietOn: boolean;
  readonly quietFrom: string;
  readonly quietTo: string;
  readonly weekends: boolean;
}

const NEW_DRAFT: Draft = { id: null, isSystem: false, kind: 'margin_below', typed: '15', scopeKind: 'all', scopeId: null, severity: 'warning', roles: ['owner', 'admin', 'manager'], userIds: [], enabled: true, quietOn: false, quietFrom: '18:00', quietTo: '06:00', weekends: false };

function scopeOf(rule: AlertRuleDTO): { kind: ScopeKind; id: string | null } {
  const scope = rule.scope as Record<string, unknown>;
  for (const kind of ['client', 'jobType', 'site'] as const) {
    const id = scope[SCOPE_KEY[kind]];
    if (typeof id === 'string' && id) return { kind, id };
  }
  return { kind: 'all', id: null };
}

function toDraft(rule: AlertRuleDTO): Draft {
  const quiet = quietOf(rule.scope);
  const scope = scopeOf(rule);
  const window = quiet && quiet.from !== quiet.to;
  return {
    id: rule.id,
    isSystem: rule.isSystem,
    kind: rule.kind,
    typed: tidyThreshold(rule.threshold),
    scopeKind: scope.kind,
    scopeId: scope.id,
    severity: rule.severity,
    roles: rule.notifyRoles,
    userIds: rule.notifyUserIds,
    enabled: rule.enabled,
    quietOn: Boolean(quiet),
    quietFrom: window ? quiet.from : '18:00',
    quietTo: window ? quiet.to : '06:00',
    weekends: Boolean(quiet?.weekends),
  };
}

/** The stored line of a draft, or an error to show under the box. */
function draftThreshold(draft: Draft): { stored: string | null; error: string | null } {
  const spec = RULE_KINDS[draft.kind].threshold;
  if (!spec) return { stored: null, error: null };
  if (draft.typed.trim() === '') return spec.required ? { stored: null, error: spec.unit === 'percent' ? 'Type a percent, like 15.' : 'Type an amount, like 2000.' } : { stored: null, error: null };
  const stored = readThreshold(spec.unit, draft.typed);
  return stored === null ? { stored: null, error: spec.unit === 'percent' ? 'Type a percent from 1 to 99, like 15.' : 'Type an amount in dollars, like 2000.' } : { stored, error: null };
}

function draftQuiet(draft: Draft): QuietHours | null {
  if (!draft.quietOn) return null;
  return { from: draft.quietFrom, to: draft.quietTo, weekends: draft.weekends };
}

function toInput(draft: Draft, stored: string | null): SaveAlertRuleFullActionInput {
  const info = RULE_KINDS[draft.kind];
  const scope = info.scoped && draft.scopeKind !== 'all' && draft.scopeId ? { [SCOPE_KEY[draft.scopeKind]]: draft.scopeId } : {};
  return {
    id: draft.id,
    // The stored name never holds the line (no dollars, no percent): readers without money see it too.
    name: storedRuleName(draft.kind),
    kind: draft.kind,
    threshold: stored,
    scope,
    severity: draft.severity,
    notifyRoles: draft.roles.filter((role): role is (typeof ROLES)[number]['id'] => ROLES.some((item) => item.id === role)),
    notifyUserIds: [...draft.userIds],
    enabled: draft.enabled,
    quiet: draftQuiet(draft),
  };
}

/** The rule as this reader may see it: the full sentence, or the one with the line left out. */
const sentenceWith = (rule: AlertRuleDTO, facts: RuleFacts): string => ((ALERT_KINDS as readonly string[]).includes(rule.kind) ? ruleSentence(rule.kind, rule.threshold, { moneyHidden: rule.moneyHidden, facts }) : rule.name);

export function RulesView({ initialRules, canManage, options, facts = {} }: { readonly initialRules: readonly AlertRuleDTO[]; readonly canManage: boolean; readonly options: RuleOptions; readonly facts?: RuleFacts }) {
  const queryClient = useQueryClient();
  const sentenceOf = (rule: AlertRuleDTO): string => sentenceWith(rule, facts);
  const rulesQuery = useAlertRules({ initialData: [...initialRules] });
  const rules = rulesQuery.data ?? [];
  const people = usePeople();
  const peopleById = useMemo(() => new Map((people.data ?? []).map((person) => [person.id, person.name])), [people.data]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.alertRules() });

  const scopeText = (rule: AlertRuleDTO): string | null => {
    if (!RULE_KINDS[rule.kind]?.scoped) return null;
    const scope = scopeOf(rule);
    if (scope.kind === 'all') return 'All jobs';
    const list = scope.kind === 'client' ? options.clients : scope.kind === 'jobType' ? options.jobTypes : options.sites;
    return `Only ${SCOPE_WORD[scope.kind]}: ${list.find((item) => item.id === scope.id)?.name ?? 'one that was removed'}`;
  };

  const setEnabled = async (rule: AlertRuleDTO, enabled: boolean, quiet = false) => {
    const previous = queryClient.getQueryData<AlertRuleDTO[]>(qk.alertRules());
    queryClient.setQueryData<AlertRuleDTO[]>(qk.alertRules(), (list) => (list ?? []).map((item) => (item.id === rule.id ? { ...item, enabled } : item)));
    const result = await saveAlertRuleFullAction({ ...toInput(toDraft(rule), rule.threshold === null ? null : tidyThreshold(rule.threshold)), name: rule.name, enabled });
    if (!result.ok) {
      queryClient.setQueryData(qk.alertRules(), previous);
      toast.error("Couldn't change the rule", result.error.message);
      return;
    }
    await refresh();
    if (!quiet) toast.undo(enabled ? 'Rule turned on' : 'Rule turned off', { description: sentenceOf(rule), onUndo: () => setEnabled(rule, !enabled, true) });
  };

  const remove = async (rule: AlertRuleDTO) => {
    const previous = queryClient.getQueryData<AlertRuleDTO[]>(qk.alertRules());
    queryClient.setQueryData<AlertRuleDTO[]>(qk.alertRules(), (list) => (list ?? []).filter((item) => item.id !== rule.id));
    const result = await deleteAlertRuleAction({ ruleId: rule.id });
    if (!result.ok) {
      queryClient.setQueryData(qk.alertRules(), previous);
      toast.error("Couldn't delete the rule", result.error.message);
      return;
    }
    toast.undo('Rule deleted', {
      description: sentenceOf(rule),
      onUndo: async () => {
        const back = await saveAlertRuleFullAction({ ...toInput(toDraft(rule), rule.threshold === null ? null : tidyThreshold(rule.threshold)), id: null, name: rule.name });
        if (!back.ok) throw new Error(back.error.message);
        await refresh();
      },
    });
    await refresh();
  };

  const mine = rules.filter((rule) => !rule.isSystem);
  const stock = rules.filter((rule) => rule.isSystem);

  const row = (rule: AlertRuleDTO) => {
    const quiet = quietOf(rule.scope);
    const names = rule.notifyUserIds.map((id) => peopleById.get(id)).filter((name): name is string => Boolean(name));
    const scope = scopeText(rule);
    const known = (ALERT_KINDS as readonly string[]).includes(rule.kind);
    return (
      <li key={rule.id} className="flex flex-wrap items-start gap-3 px-4 py-3.5" data-testid="rule-row" data-kind={rule.kind} data-enabled={rule.enabled}>
        {canManage ? <Switch size="sm" className="mt-0.5" checked={rule.enabled} onCheckedChange={(value) => void setEnabled(rule, value)} aria-label={`${rule.enabled ? 'Turn off' : 'Turn on'}: ${sentenceOf(rule)}`} data-testid="rule-toggle" /> : null}
        <div className={cn('min-w-0 flex-1 basis-[240px]', !rule.enabled && 'opacity-60')}>
          <p className="text-sm font-semibold text-fg" data-testid="rule-sentence">
            {sentenceOf(rule)}
          </p>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {[scope, tellSentence(rule.notifyRoles, names)].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={SEVERITY_TONE[rule.severity]}>
              {SEVERITY_LABEL[rule.severity]}
            </Badge>
            {quiet ? (
              <Badge tone="neutral" icon={<MoonStar aria-hidden />}>
                {quietSentence(quiet)}
              </Badge>
            ) : null}
            <span data-testid="rule-state">
              <Badge tone={rule.enabled ? 'success' : 'neutral'}>
                {rule.enabled ? 'On' : 'Off'}
              </Badge>
            </span>
          </div>
        </div>
        {canManage && known ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" leadingIcon={<Pencil aria-hidden />} onClick={() => setDraft(toDraft(rule))} data-testid="rule-edit">
              Change
            </Button>
            {!rule.isSystem ? <IconButton label={`Delete the rule: ${sentenceOf(rule)}`} icon={<Trash2 aria-hidden />} variant="ghost" size="sm" onClick={() => void remove(rule)} data-testid="rule-delete" /> : null}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-5" data-testid="rules">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-fg-secondary" data-testid="rules-intro">
          {canManage
            ? 'A rule is one plain sentence. When it comes true, an alert lands in the inbox and the people you picked get a message.'
            : 'These are the rules that watch the work. When one comes true, an alert lands in the inbox and the people it names get a message. You can read them here. A manager or an admin can change them.'}
        </p>
        {canManage ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDraft(NEW_DRAFT)} data-testid="rule-add">
            New rule
          </Button>
        ) : null}
      </div>

      {rulesQuery.isError ? <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-text">We could not refresh the rules. You are looking at the last list we loaded.</p> : null}

      <section aria-labelledby="rules-mine" className="rounded-xl border border-border-subtle bg-panel shadow-xs">
        <header className="border-b border-border-subtle px-4 py-3">
          <h2 id="rules-mine" className="text-base font-semibold text-fg">
            Your rules
          </h2>
        </header>
        {mine.length === 0 ? (
          <Teach
            size="sm"
            icon={ListChecks}
            title="No rules of your own yet"
            why="The rules that come with Pulse watch for the usual trouble. Add your own when you have a line that matters to you, like: tell me when a job's margin is heading under 15 percent."
            points={['Pick the number and which jobs it covers', 'Pick who gets told, and when to stay quiet', 'See what it would have said in the last 30 days before you save']}
            actions={
              canManage ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDraft(NEW_DRAFT)} data-testid="rule-add-empty">
                  Write your first rule
                </Button>
              ) : (
                <ButtonLink href={routes.alerts()} variant="secondary">
                  Back to the inbox
                </ButtonLink>
              )
            }
            footnote={canManage ? undefined : 'A manager sets the rules. You get told when one of them fires for you.'}
            testId="rules-empty"
          />
        ) : (
          <ul className="divide-y divide-border-subtle" data-testid="rules-mine-list">
            {mine.map(row)}
          </ul>
        )}
      </section>

      {stock.length > 0 ? (
        <section aria-labelledby="rules-stock" className="rounded-xl border border-border-subtle bg-panel shadow-xs">
          <header className="border-b border-border-subtle px-4 py-3">
            <h2 id="rules-stock" className="text-base font-semibold text-fg">
              Rules that come with Pulse
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted" data-testid="rules-stock-note">
              {canManage ? 'You can change who gets told and turn one off. They cannot be deleted.' : 'Each one shows if it is on or off and who it tells. A manager or an admin can change that.'}
            </p>
          </header>
          <ul className="divide-y divide-border-subtle" data-testid="rules-stock-list">
            {stock.map(row)}
          </ul>
        </section>
      ) : null}

      {draft ? (
        <RuleBuilder
          key={draft.id ?? 'new'}
          start={draft}
          options={options}
          facts={facts}
          people={people.data ?? []}
          onClose={() => setDraft(null)}
          onSaved={async (saved, before) => {
            setDraft(null);
            await refresh();
            if (!before) {
              toast.undo('Rule added', {
                description: sentenceOf(saved),
                onUndo: async () => {
                  const undone = await deleteAlertRuleAction({ ruleId: saved.id });
                  if (!undone.ok) throw new Error(undone.error.message);
                  await refresh();
                },
              });
              return;
            }
            const old = rules.find((rule) => rule.id === before.id);
            toast.undo('Rule changed', {
              description: sentenceOf(saved),
              onUndo: async () => {
                if (!old) return;
                const undone = await saveAlertRuleFullAction({ ...toInput(toDraft(old), old.threshold === null ? null : tidyThreshold(old.threshold)), name: old.name });
                if (!undone.ok) throw new Error(undone.error.message);
                await refresh();
              },
            });
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ builder */

function RuleBuilder({
  start,
  options,
  facts,
  people,
  onClose,
  onSaved,
}: {
  readonly start: Draft;
  readonly options: RuleOptions;
  readonly facts: RuleFacts;
  readonly people: readonly { readonly id: string; readonly name: string; readonly email: string; readonly image?: string | null }[];
  readonly onClose: () => void;
  readonly onSaved: (saved: AlertRuleDTO, before: Draft | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(start);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const info = RULE_KINDS[draft.kind];
  const line = draftThreshold(draft);
  const set = (patch: Partial<Draft>) => (setDraft((current) => ({ ...current, ...patch })), setFormError(null));

  const scopeLists = { client: options.clients, jobType: options.jobTypes, site: options.sites } as const;
  const scopeError = info.scoped && draft.scopeKind !== 'all' && !draft.scopeId ? `Pick a ${SCOPE_WORD[draft.scopeKind]}.` : null;
  const quietError = draft.quietOn && draft.quietFrom === draft.quietTo && !draft.weekends ? 'Pick two different times, or tick weekends.' : null;
  const sentence = ruleSentence(draft.kind, line.stored, { facts });
  const scopeName = draft.scopeKind === 'all' ? null : (scopeLists[draft.scopeKind].find((item) => item.id === draft.scopeId)?.name ?? null);

  const kindOptions = useMemo(
    () => RULE_GROUPS.flatMap((group) => ALERT_KINDS.filter((kind) => RULE_KINDS[kind].group === group).map((kind) => ({ value: kind, label: RULE_KINDS[kind].label, description: group }))),
    [],
  );

  const save = async () => {
    setTried(true);
    if (line.error || scopeError || quietError) return;
    setSaving(true);
    try {
      const result = await saveAlertRuleFullAction(toInput(draft, line.stored));
      if (!result.ok) {
        setFormError(result.error.message);
        return;
      }
      await onSaved(result.data, start.id ? start : null);
    } catch {
      setFormError('Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DrawerContent title={start.id ? 'Change this rule' : 'New rule'} description="Build the sentence. The preview at the bottom shows what it would have told you." width={600} data-testid="rule-builder" onInteractOutside={keepOpenForToasts}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
            <p className="rounded-lg border border-border-subtle bg-sunken px-3 py-2.5 text-md font-semibold text-fg" aria-live="polite" data-testid="rule-preview-sentence">
              {sentence}
              {scopeName ? <span className="font-normal text-fg-secondary"> Only for {scopeName}.</span> : null}
            </p>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-semibold text-fg">1. Tell me when</legend>
              <Field label="What to watch" hint={info.help}>
                {({ inputId, describedBy }) => (
                  <Select
                    id={inputId}
                    aria-describedby={describedBy}
                    value={draft.kind}
                    disabled={start.isSystem}
                    options={kindOptions}
                    onValueChange={(value) => {
                      const next = RULE_KINDS[value as AlertKind];
                      set({ kind: value as AlertKind, typed: next.threshold?.fallback ?? '', severity: next.severity, scopeKind: next.scoped ? draft.scopeKind : 'all', scopeId: next.scoped ? draft.scopeId : null });
                    }}
                  />
                )}
              </Field>
              {info.threshold ? (
                <Field label={info.threshold.label} hint={info.threshold.hint} error={tried ? line.error : null} required={info.threshold.required}>
                  {({ inputId, describedBy, invalid }) => (
                    <div className="flex items-center gap-2">
                      <Input id={inputId} aria-describedby={describedBy} invalid={invalid} inputMode="decimal" value={draft.typed} onChange={(event) => set({ typed: event.target.value })} className="w-32" data-testid="rule-threshold" />
                      <span className="text-sm text-fg-secondary">{info.threshold?.unit === 'percent' ? 'percent' : 'dollars'}</span>
                    </div>
                  )}
                </Field>
              ) : null}
              {info.scoped ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Which jobs">
                    {({ inputId }) => (
                      <Select
                        id={inputId}
                        value={draft.scopeKind}
                        onValueChange={(value) => set({ scopeKind: value as ScopeKind, scopeId: null })}
                        options={[
                          { value: 'all', label: 'All jobs' },
                          ...(options.clients.length > 0 ? [{ value: 'client', label: 'Jobs of one client' }] : []),
                          ...(options.jobTypes.length > 0 ? [{ value: 'jobType', label: 'Jobs of one type' }] : []),
                          ...(options.sites.length > 1 ? [{ value: 'site', label: 'Jobs at one site' }] : []),
                        ]}
                      />
                    )}
                  </Field>
                  {draft.scopeKind !== 'all' ? (
                    <Field label={`Which ${SCOPE_WORD[draft.scopeKind]}`} error={tried ? scopeError : null}>
                      {({ inputId, invalid }) => <Select id={inputId} invalid={invalid} value={draft.scopeId ?? undefined} placeholder="Pick one" onValueChange={(value) => set({ scopeId: value })} options={scopeLists[draft.scopeKind as Exclude<ScopeKind, 'all'>].map((item) => ({ value: item.id, label: item.name }))} />}
                    </Field>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-semibold text-fg">2. Who gets told</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Roles that get told">
                {ROLES.map((role) => (
                  <Checkbox key={role.id} size="sm" label={role.label} checked={draft.roles.includes(role.id)} onCheckedChange={(value) => set({ roles: value === true ? [...draft.roles, role.id] : draft.roles.filter((item) => item !== role.id) })} data-testid={`rule-role-${role.id}`} />
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">And these people</span>
                <UserPicker multiple people={people} value={draft.userIds} onChange={(userIds) => set({ userIds })} placeholder="Add people" aria-label="People that get told" />
              </div>
              <p className="text-xs text-fg-muted">{tellSentence(draft.roles, draft.userIds.map((id) => people.find((person) => person.id === id)?.name).filter((name): name is string => Boolean(name)))}</p>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-fg">How loud</span>
                <ToggleGroup
                  label="How loud the alert is"
                  value={draft.severity}
                  onValueChange={(value) => set({ severity: value })}
                  options={[
                    { value: 'info', label: SEVERITY_LABEL.info },
                    { value: 'warning', label: SEVERITY_LABEL.warning },
                    { value: 'critical', label: SEVERITY_LABEL.critical },
                  ]}
                />
                <span className="text-xs text-fg-muted">Urgent alerts sort to the top of the inbox.</span>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-semibold text-fg">3. Quiet hours</legend>
              <Switch size="sm" checked={draft.quietOn} onCheckedChange={(value) => set({ quietOn: value })} label="Stay quiet at set times" description="Nothing is lost. Whatever happens in quiet hours shows up at the next check after they end." data-testid="rule-quiet" />
              {draft.quietOn ? (
                <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <TimeField label="Quiet from" value={draft.quietFrom} onChange={(value) => set({ quietFrom: value })} testId="rule-quiet-from" />
                    <TimeField label="Until" value={draft.quietTo} onChange={(value) => set({ quietTo: value })} testId="rule-quiet-to" />
                  </div>
                  <Checkbox size="sm" label="Also quiet all day on Saturday and Sunday" checked={draft.weekends} onCheckedChange={(value) => set({ weekends: value === true })} data-testid="rule-quiet-weekends" />
                  {tried && quietError ? (
                    <p role="alert" className="text-sm text-danger-text">
                      {quietError}
                    </p>
                  ) : (
                    <p className="text-xs text-fg-muted">
                      {quietSentence(draftQuiet(draft)) || `Quiet from ${clockLabel(draft.quietFrom)} to ${clockLabel(draft.quietTo)}`}, in your workspace time zone.
                    </p>
                  )}
                </div>
              ) : null}
            </fieldset>

            <RulePreview draft={draft} stored={line.stored} blocked={Boolean(line.error || scopeError)} />
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
            <span role="alert" className="min-w-0 text-sm text-danger-text">
              {formError}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} data-testid="rule-save">
                {start.id ? 'Save the rule' : 'Add the rule'}
              </Button>
            </div>
          </footer>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function TimeField({ label, value, onChange, testId }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly testId: string }) {
  return (
    <Field label={label}>
      {({ inputId }) => (
        <input
          id={inputId}
          type="time"
          step={900}
          value={value}
          onChange={(event) => onChange(event.target.value || value)}
          className="h-8 w-32 rounded-md border border-border-input bg-panel px-2 text-sm text-fg outline-none focus:border-focus focus:shadow-[0_0_0_3px_var(--focus-ring-soft)]"
          data-testid={testId}
        />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ preview */

function RulePreview({ draft, stored, blocked }: { readonly draft: Draft; readonly stored: string | null; readonly blocked: boolean }) {
  const info = RULE_KINDS[draft.kind];
  const params = useDebouncedValue(
    useMemo(
      () => ({
        kind: draft.kind,
        threshold: stored,
        client: info.scoped && draft.scopeKind === 'client' ? draft.scopeId : null,
        jobType: info.scoped && draft.scopeKind === 'jobType' ? draft.scopeId : null,
        site: info.scoped && draft.scopeKind === 'site' ? draft.scopeId : null,
        rule: draft.id,
      }),
      [draft.kind, stored, draft.scopeKind, draft.scopeId, draft.id, info.scoped],
    ),
    350,
  );
  const query = useQuery({
    queryKey: ['alert-rules', 'preview', params],
    queryFn: () => apiGet<RulePreviewDTO>(apiPath('alert-rules/preview', params)),
    enabled: !blocked,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
  const preview = query.data;
  const number = info.threshold ? thresholdText(info.threshold.unit, stored) : null;

  return (
    <section aria-labelledby="rule-preview-title" className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-sunken p-3.5" data-testid="rule-preview">
      <h3 id="rule-preview-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <BellRing aria-hidden className="size-4 text-icon" />
        What it would have told you, last 30 days
      </h3>
      {blocked ? (
        <p className="text-sm text-fg-secondary">Finish the sentence above to see the preview.</p>
      ) : query.isLoading ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Working out the preview</span>
          <Skeleton height={20} width={260} />
          <Skeleton height={96} rounded="lg" />
        </div>
      ) : query.isError || !preview ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger-text">
          We could not work out the preview. {query.error instanceof Error ? query.error.message : ''}
          <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className={cn('flex flex-col gap-3', query.isFetching && 'opacity-60')}>
          <p className="text-sm text-fg" data-testid="rule-preview-total" data-total={preview.total}>
            {preview.total === 0 ? (
              <>This rule would not have said anything{number ? ` at ${number}` : ''}. That can be good news, or the line may be too easy.</>
            ) : (
              <>
                It would have told you <strong className="font-semibold tabular-nums">{preview.total} {preview.total === 1 ? 'time' : 'times'}</strong>.{' '}
                {preview.activeToday > 0 ? `${preview.activeToday} would still be open today.` : 'None would still be open today.'}
              </>
            )}
          </p>
          {preview.total > 0 ? (
            <div className="rounded-lg border border-border-subtle bg-panel p-2">
              <BarChart
                title="Alerts per day, last 30 days"
                description="How many times the rule would have spoken on each day."
                height={130}
                hideLegend
                dates={Array.from({ length: preview.perDay.length }, (_, index) => addDay(preview.from, index))}
                bucket="day"
                series={[{ id: 'alerts', label: 'Alerts', values: preview.perDay }]}
                format={{ axis: (value) => String(Math.round(value)), value: (value) => `${Math.round(value)} ${Math.round(value) === 1 ? 'alert' : 'alerts'}` }}
              />
            </div>
          ) : null}
          {preview.hits.length > 0 ? (
            <ul className="flex max-h-64 flex-col divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border-subtle bg-panel" data-testid="rule-preview-hits" tabIndex={0} aria-label="What it would have said">
              {preview.hits.map((hit, index) => (
                <li key={`${hit.date}-${hit.label}-${index}`} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium text-fg">{hit.label}</span>
                    <span className="shrink-0 text-xs text-fg-muted tabular-nums">{hit.sinceBefore ? `Since before ${shortDate(hit.date)}` : shortDate(hit.date)}</span>
                  </span>
                  <span className="text-fg-secondary">{hit.detail}</span>
                  {hit.url ? (
                    <Link href={hit.url} target="_blank" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                      Open in a new tab
                      <ArrowRight aria-hidden className="size-3" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-fg-muted">{preview.note}</p>
        </div>
      )}
    </section>
  );
}

function addDay(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
