'use client';

/**
 * Auto Code Generation Preferences: one card per sequence (SO, PO, WO, RMA, SP, CNT) with
 * "Auto generate as" / "Keep adding manually", prefix, start number and length, and a live
 * preview of the next three codes. Saves with PUT /api/company/code-generation.
 */
import * as React from 'react';
import { History, Wand2, Keyboard } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import { sequencePreview, sequenceSchema, type SequenceValues } from '@/lib/grid-defs/admin/lookups';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Form, FormField, FormGrid, SubmitBar, useZodForm } from '@/components/ui/form';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import type { SequenceRow } from '@/server/repositories/company-sequences';
import { EntityChangeLogDrawer, usePagePerms } from '../admin-shared';
import { NumberField, TextInput } from '../form-controls';
import { DataSetupShell } from './data-setup-shell';

function SequenceCard({
  row,
  canEdit,
  onLog,
}: {
  readonly row: SequenceRow;
  readonly canEdit: boolean;
  readonly onLog: () => void;
}) {
  const qc = useQueryClient();
  const initial: SequenceValues = {
    key: row.key,
    autoGenerate: row.autoGenerate,
    prefix: row.prefix,
    nextValue: row.nextValue,
    padding: row.padding,
  };
  const form = useZodForm(sequenceSchema, initial);
  const w = useWatch({ control: form.control });
  const auto = w.autoGenerate ?? true;
  const prefix = (w.prefix ?? '').toUpperCase();
  const next = Number(w.nextValue) || 1;
  const pad = Number(w.padding) || 0;
  const submit = async (values: SequenceValues) => {
    try {
      const { data } = await apiRequest<SequenceRow>('/api/company/code-generation', {
        method: 'PUT',
        body: values,
      });
      toast.success(
        'Code preferences saved',
        data.autoGenerate
          ? `The next ${data.entity} will be ${data.nextCode}.`
          : `${data.label}: codes are entered by hand.`,
      );
      await qc.invalidateQueries({ queryKey: ['code-generation'] });
      form.reset({
        key: data.key,
        autoGenerate: data.autoGenerate,
        prefix: data.prefix,
        nextValue: data.nextValue,
        padding: data.padding,
      });
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save", isApiError(error) ? error.message : 'Something went wrong');
    }
  };
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">{row.label}</h2>
          <p className="text-xs text-secondary">
            Next code today:{' '}
            <code className="font-mono text-foreground">
              {row.autoGenerate ? row.nextCode : 'entered manually'}
            </code>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onLog}>
          <History className="h-3.5 w-3.5" aria-hidden />
          Change log
        </Button>
      </div>
      <Form form={form} onSubmit={submit} className="flex flex-col gap-4" guardUnsaved>
        <FormField<SequenceValues> name="autoGenerate" label="Code mode">
          {(c) => (
            <RadioCards<'auto' | 'manual'>
              ariaLabel={`${row.label} code mode`}
              columns={2}
              value={c.value ? 'auto' : 'manual'}
              onChange={(v) => canEdit && c.onChange(v === 'auto')}
              options={[
                {
                  value: 'auto',
                  title: `Auto generate codes as ${sequencePreview(prefix || row.prefix, next, pad)}`,
                  description: 'Every new record gets the next code automatically.',
                  icon: Wand2,
                  disabled: !canEdit,
                },
                {
                  value: 'manual',
                  title: 'Keep adding codes manually',
                  description: 'Users type a unique code each time.',
                  icon: Keyboard,
                  disabled: !canEdit,
                },
              ]}
            />
          )}
        </FormField>
        {auto ? (
          <FormGrid columns={3}>
            <TextInput<SequenceValues>
              name="prefix"
              label="Prefix"
              required
              maxLength={12}
              transform={(v) => v.toUpperCase()}
              disabled={!canEdit}
            />
            <FormField<SequenceValues>
              name="nextValue"
              label="Start number"
              required
              info="The number the next code uses"
            >
              {(c) => (
                <TextField
                  id={c.id}
                  name={c.name}
                  ref={c.ref as React.Ref<HTMLInputElement>}
                  inputMode="numeric"
                  disabled={!canEdit || c.disabled}
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
            <NumberField<SequenceValues>
              name="padding"
              label="Number length"
              required
              min={0}
              max={12}
              disabled={!canEdit}
              info="Zero-padded digits after the prefix"
            />
          </FormGrid>
        ) : null}
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-sunken px-3 py-2"
          aria-live="polite"
        >
          <span className="text-2xs font-bold text-faint">Preview</span>
          {auto ? (
            [0, 1, 2].map((i) => (
              <code
                key={i}
                className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-sm text-foreground"
              >
                {sequencePreview(prefix, next + i, pad)}
              </code>
            ))
          ) : (
            <span className="text-xs text-secondary">
              The {row.entity} form asks for a code, and duplicates are rejected.
            </span>
          )}
        </div>
        {canEdit ? (
          <SubmitBar
            submitLabel="Save"
            cancelLabel="Reset"
            requireDirty
            onCancel={() => form.reset(initial)}
          />
        ) : null}
      </Form>
    </section>
  );
}

export function CodeGenerationPage() {
  const perms = usePagePerms('settings.data_setup', ['view'] as const);
  const q = useApiQuery<readonly SequenceRow[]>(['code-generation'], '/api/company/code-generation', {
    staleTime: 0,
  });
  const [log, setLog] = React.useState<SequenceRow | null>(null);
  return (
    <DataSetupShell>
      <PageHeader
        title="Auto Code Generation Preferences"
        crumbLabel="Auto code generation"
        helper="Automate record codes for traceability, or keep entering them by hand."
      />
      <div className="grid gap-4 px-6 py-5 xl:grid-cols-2">
        {q.isPending ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-60 w-full rounded-xl" />)
        ) : q.isError ? (
          <div className="xl:col-span-2">
            <EmptyState
              title="Couldn't load code preferences"
              description={q.error.message}
              action={<Button onClick={() => void q.refetch()}>Retry</Button>}
            />
          </div>
        ) : (
          (q.data?.data ?? []).map((row) => (
            <SequenceCard
              key={`${row.key}-${row.nextValue}-${row.prefix}-${row.autoGenerate}`}
              row={row}
              canEdit={perms.view}
              onLog={() => setLog(row)}
            />
          ))
        )}
      </div>
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/company/code-generation/${log.key}/change-log` : null}
        title={`Code preferences · ${log?.label ?? ''}`}
      />
    </DataSetupShell>
  );
}
