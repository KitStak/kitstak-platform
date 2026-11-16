'use client';

/**
 * Return Process (`/settings/data-setup/return-process`), Logiwa layout on one page:
 *   1. RMA Code Generation Preferences — prefix + next number with a live preview (the `rma` sequence)
 *   2. Return Parameters — 8 switches with descriptions (company `returnRules`, enforced by M04)
 *   One Save for both cards; then
 *   3. Return Reasons — the return_reason lookup grid embedded with Add new / Edit / Delete.
 */
import * as React from 'react';
import { History, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import { z } from 'zod';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import { lookupByType, sequencePreview } from '@/lib/grid-defs/admin/lookups';
import {
  countOn,
  RETURN_RULE_DEFS,
  RETURN_RULE_KEYS,
  returnRulesShape,
  type ReturnRuleKey,
  type ReturnRules,
} from '@/lib/grid-defs/admin/return-rules';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { EmptyState } from '@/components/ui/empty-state';
import { Form, FormField, FormGrid, SubmitBar, useZodForm } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import type { ReturnRulesState } from '@/server/repositories/company-return-rules';
import type { SequenceRow } from '@/server/repositories/company-sequences';
import { EntityChangeLogDrawer, usePagePerms } from '../admin-shared';
import { TextInput } from '../form-controls';
import { DataSetupShell } from './data-setup-shell';
import { LookupPage } from './lookup-page';

const pageSchema = z.object({
  rmaPrefix: z
    .string()
    .trim()
    .min(1, 'Prefix is required')
    .max(12, 'At most 12 characters')
    .regex(/^[A-Za-z0-9-]*$/, 'Letters, numbers or dash'),
  rmaNextValue: z
    .number({ error: 'Enter the next number' })
    .int('Whole number')
    .min(1, 'At least 1')
    .max(999_999_999),
  ...returnRulesShape,
});
type V = z.input<typeof pageSchema>;

function toValues(rma: SequenceRow, rules: ReturnRules): V {
  return { rmaPrefix: rma.prefix, rmaNextValue: rma.nextValue, ...rules };
}

function Card({
  title,
  description,
  aside,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly aside?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface shadow-xs">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-secondary">{description}</p>
        </div>
        {aside}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function RulesList({ canEdit }: { readonly canEdit: boolean }) {
  const groups = [
    { key: 'match', title: 'Match what was shipped' },
    { key: 'limits', title: 'Limits and warehouses' },
  ] as const;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="mb-1 text-2xs font-bold text-faint">{g.title}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {RETURN_RULE_DEFS.filter((d) => d.group === g.key).map((d) => (
              <li key={d.key}>
                <FormField<V> name={d.key as ReturnRuleKey}>
                  {(c) => (
                    <label
                      htmlFor={c.id}
                      className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 hover:bg-surface-sunken/60"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{d.label}</span>
                        <span className="block text-xs text-secondary">{d.description}</span>
                      </span>
                      <Switch
                        id={c.id}
                        checked={Boolean(c.value)}
                        disabled={!canEdit}
                        onCheckedChange={(on) => c.onChange(on)}
                        aria-label={d.label}
                      />
                    </label>
                  )}
                </FormField>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Editor({
  rma,
  state,
  canEdit,
  onLog,
}: {
  readonly rma: SequenceRow;
  readonly state: ReturnRulesState;
  readonly canEdit: boolean;
  readonly onLog: () => void;
}) {
  const qc = useQueryClient();
  const initial = React.useMemo(() => toValues(rma, state.rules), [rma, state.rules]);
  const form = useZodForm(pageSchema, initial);
  const w = useWatch({ control: form.control });
  const [conflict, setConflict] = React.useState(false);
  const prefix = (w.rmaPrefix ?? '').toUpperCase();
  const next = Number(w.rmaNextValue) || 1;
  const on = RETURN_RULE_KEYS.filter((k) => w[k] === true).length;
  const submit = async (values: V) => {
    const parsed = pageSchema.parse(values);
    const rmaChanged =
      parsed.rmaPrefix.toUpperCase() !== rma.prefix ||
      parsed.rmaNextValue !== rma.nextValue ||
      !rma.autoGenerate;
    const rules = Object.fromEntries(RETURN_RULE_KEYS.map((k) => [k, parsed[k]])) as ReturnRules;
    const rulesChanged = RETURN_RULE_KEYS.some((k) => rules[k] !== state.rules[k]);
    try {
      if (rmaChanged) {
        await apiRequest<SequenceRow>('/api/company/code-generation', {
          method: 'PUT',
          body: {
            key: 'rma',
            autoGenerate: true,
            prefix: parsed.rmaPrefix.toUpperCase(),
            nextValue: parsed.rmaNextValue,
            padding: rma.padding,
          },
        }).catch((error: unknown) => {
          // The sequence API names its fields prefix / nextValue; map them onto this form.
          if (isApiError(error)) {
            if (error.fieldErrors.prefix?.[0])
              form.setError('rmaPrefix', { type: 'server', message: error.fieldErrors.prefix[0] });
            if (error.fieldErrors.nextValue?.[0])
              form.setError('rmaNextValue', { type: 'server', message: error.fieldErrors.nextValue[0] });
          }
          throw error;
        });
      }
      if (rulesChanged)
        await apiRequest<ReturnRulesState>('/api/company/return-rules', {
          method: 'PUT',
          body: { ...rules, version: state.version },
        });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['code-generation'] }),
        qc.invalidateQueries({ queryKey: ['return-rules'] }),
      ]);
      toast.success(
        'Return process saved',
        `${countOn(rules)} of ${RETURN_RULE_KEYS.length} return parameters on · next RMA ${sequencePreview(parsed.rmaPrefix.toUpperCase(), parsed.rmaNextValue, rma.padding)}.`,
      );
      form.reset(values);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error(
        "Couldn't save the return process",
        isApiError(error) ? error.message : 'Something went wrong',
      );
    }
  };
  return (
    <Form form={form} onSubmit={submit} guardUnsaved className="flex flex-col gap-5">
      {conflict ? (
        <Callout
          variant="attention"
          title="These settings changed since you opened them"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Someone else saved the return process. Reload to see their changes.
        </Callout>
      ) : null}
      <Card
        title="RMA code generation preferences"
        description="Every new return order gets the next code."
        aside={
          <Button size="sm" variant="ghost" onClick={onLog}>
            <History className="h-3.5 w-3.5" aria-hidden />
            Change log
          </Button>
        }
      >
        <FormGrid columns={3}>
          <TextInput<V>
            name="rmaPrefix"
            label="Prefix"
            required
            maxLength={12}
            transform={(v) => v.toUpperCase()}
            disabled={!canEdit}
            placeholder="RMA"
          />
          <FormField<V> name="rmaNextValue" label="Next number" required info="The number the next RMA uses">
            {(c) => (
              <TextField
                id={c.id}
                name={c.name}
                ref={c.ref as React.Ref<HTMLInputElement>}
                inputMode="numeric"
                disabled={!canEdit}
                invalid={c.invalid}
                aria-invalid={c['aria-invalid']}
                aria-describedby={c['aria-describedby']}
                className="font-mono tabular-nums"
                value={c.value === null || c.value === undefined ? '' : String(c.value)}
                onBlur={c.onBlur}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 9);
                  c.onChange(digits === '' ? 0 : Number(digits));
                }}
              />
            )}
          </FormField>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-secondary">Code preview</span>
            <div className="flex h-8 items-center gap-1.5" aria-live="polite">
              {[0, 1].map((i) => (
                <code
                  key={i}
                  className="rounded-md border border-border bg-surface-sunken px-2 py-0.5 font-mono text-sm text-foreground"
                >
                  {sequencePreview(prefix || 'RMA', next + i, rma.padding)}
                </code>
              ))}
            </div>
          </div>
        </FormGrid>
        {!rma.autoGenerate ? (
          <p className="mt-3 text-xs text-attention">
            RMA codes are entered by hand today. Saving turns automatic RMA codes on.
          </p>
        ) : null}
      </Card>
      <Card
        title="Return parameters"
        description="Return receiving enforces these rules on every return order."
        aside={
          <span className="flex items-center gap-2">
            {canEdit && on < RETURN_RULE_KEYS.length ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  form.reset(
                    { ...form.getValues(), ...Object.fromEntries(RETURN_RULE_KEYS.map((k) => [k, true])) },
                    { keepDefaultValues: true },
                  )
                }
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Turn all on
              </Button>
            ) : null}
            <Badge tone={on === RETURN_RULE_KEYS.length ? 'success' : 'neutral'} size="sm" shape="pill">
              {on}/{RETURN_RULE_KEYS.length} on
            </Badge>
          </span>
        }
      >
        <RulesList canEdit={canEdit} />
      </Card>
      {/* The save bar only takes space while there is something to save (no dead band above Return reasons). */}
      {canEdit && form.formState.isDirty ? (
        <div className="sticky bottom-0 z-10 -mx-6 border-t border-border bg-surface/95 px-6 py-3 backdrop-blur">
          <SubmitBar
            submitLabel="Save"
            cancelLabel="Discard changes"
            requireDirty
            onCancel={() => form.reset(initial)}
          />
        </div>
      ) : null}
    </Form>
  );
}

export function ReturnProcessPage() {
  const perms = usePagePerms('settings.data_setup', ['view'] as const);
  const seq = useApiQuery<readonly SequenceRow[]>(['code-generation'], '/api/company/code-generation', {
    staleTime: 0,
  });
  const rules = useApiQuery<ReturnRulesState>(['return-rules'], '/api/company/return-rules', {
    staleTime: 0,
  });
  const [log, setLog] = React.useState(false);
  const rma = seq.data?.data.find((r) => r.key === 'rma');
  const state = rules.data?.data;
  const reasonDef = lookupByType('return_reason');
  const failed = seq.isError || rules.isError;
  return (
    <DataSetupShell>
      <PageHeader title="Return Process" crumbLabel="Return Process" />
      <div className="flex flex-col gap-5 px-6 pb-6 pt-4">
        {failed ? (
          <EmptyState
            title="Couldn't load the return process"
            description={(seq.error ?? rules.error)?.message}
            action={
              <Button
                onClick={() => {
                  void seq.refetch();
                  void rules.refetch();
                }}
              >
                Retry
              </Button>
            }
          />
        ) : !rma || !state ? (
          <>
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </>
        ) : (
          <Editor
            key={`${state.version}-${rma.prefix}-${rma.nextValue}`}
            rma={rma}
            state={state}
            canEdit={perms.view}
            onLog={() => setLog(true)}
          />
        )}
        {reasonDef ? (
          <LookupPage
            def={reasonDef}
            variant="section"
            sectionTitle="Return reasons"
            sectionDescription="Customer and actual reasons offered when an RMA is created and when returns are received."
          />
        ) : null}
      </div>
      <EntityChangeLogDrawer
        open={log}
        onOpenChange={setLog}
        path={log ? '/api/company/change-log' : null}
        title="Return process change log"
      />
    </DataSetupShell>
  );
}
