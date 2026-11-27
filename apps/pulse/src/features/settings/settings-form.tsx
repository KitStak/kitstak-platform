'use client';
/**
 * One settings card: a list of fields that read from the workspace settings, a Save button that
 * only sends what changed, and an Undo toast that puts the old values back. Percents are typed
 * as percents and money as dollars and cents; the server stores basis points and whole cents.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, Select, Switch, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { centsToDecimal, decimalToCents, fromScaled, toScaled } from '@/lib/money';
import { qk } from '@/lib/query-keys';
import type { SettingsDTO } from '@/lib/types';
import { updateSettingsAction, type UpdateSettingsActionInput } from '@/server/actions/settings';

type Key = keyof UpdateSettingsActionInput & keyof SettingsDTO;

interface Base {
  readonly key: Key;
  readonly label: string;
  readonly hint?: ReactNode;
  /** Shown only when this returns true for the current draft. */
  readonly when?: (draft: Readonly<Record<string, string>>) => boolean;
}

export type SettingsField =
  | (Base & { readonly kind: 'percent'; readonly max?: number })
  | (Base & { readonly kind: 'money'; readonly nullable?: boolean; readonly suffix?: string })
  | (Base & { readonly kind: 'decimal'; readonly min: number; readonly max: number; readonly suffix?: string })
  | (Base & { readonly kind: 'whole'; readonly min: number; readonly max: number; readonly suffix?: string })
  | (Base & { readonly kind: 'text'; readonly maxLength: number; readonly placeholder?: string })
  | (Base & { readonly kind: 'select'; readonly options: readonly { value: string; label: string; description?: string }[]; readonly numeric?: boolean })
  | (Base & { readonly kind: 'days' })
  | (Base & { readonly kind: 'switch' });

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const trim = (text: string): string => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);

/** A stored value as the text a person edits. */
function toText(field: SettingsField, value: unknown): string {
  if (value === null || value === undefined) return '';
  switch (field.kind) {
    case 'percent':
      return trim(fromScaled(BigInt(Number(value)), 2));
    case 'money':
      return centsToDecimal(BigInt(Number(value)));
    case 'decimal':
      return trim(String(value));
    case 'days':
      return (value as number[]).join(',');
    case 'switch':
      return value ? '1' : '0';
    default:
      return String(value);
  }
}

/** The text back as the value the server takes, or a plain problem. */
function fromText(field: SettingsField, text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const clean = text.trim();
  const number = (): number | null => (/^-?\d+(\.\d+)?$/.test(clean) ? Number(clean) : null);
  switch (field.kind) {
    case 'percent': {
      const value = number();
      if (value === null) return { ok: false, message: 'Type a percent, like 30.' };
      if (value < 0 || value > (field.max ?? 100)) return { ok: false, message: `Type a percent from 0 to ${field.max ?? 100}.` };
      return { ok: true, value: Number(toScaled(clean, 2)) };
    }
    case 'money': {
      if (clean === '' && field.nullable) return { ok: true, value: null };
      const value = number();
      if (value === null || value < 0) return { ok: false, message: 'Type an amount, like 21.76.' };
      return { ok: true, value: Number(decimalToCents(clean)) };
    }
    case 'decimal': {
      const value = number();
      if (value === null || value < field.min || value > field.max) return { ok: false, message: `Type a number from ${field.min} to ${field.max}.` };
      return { ok: true, value: clean };
    }
    case 'whole': {
      const value = number();
      if (value === null || !Number.isInteger(value) || value < field.min || value > field.max) return { ok: false, message: `Type a whole number from ${field.min} to ${field.max}.` };
      return { ok: true, value };
    }
    case 'text':
      return { ok: true, value: clean };
    case 'select':
      return { ok: true, value: field.numeric ? Number(clean) : clean };
    case 'days': {
      const days = clean === '' ? [] : clean.split(',').map(Number);
      if (days.length === 0) return { ok: false, message: 'Pick at least one working day.' };
      return { ok: true, value: days };
    }
    case 'switch':
      return { ok: true, value: clean === '1' };
  }
}

export function SettingsForm({
  title,
  intro,
  fields,
  settings,
  canEdit,
  children,
  footnote,
  testId,
}: {
  readonly title: string;
  readonly intro?: ReactNode;
  readonly fields: readonly SettingsField[];
  readonly settings: SettingsDTO;
  readonly canEdit: boolean;
  /** Extra content under the fields. It gets the live draft, for readouts that follow typing. */
  readonly children?: (draft: Readonly<Record<string, string>>) => ReactNode;
  readonly footnote?: ReactNode;
  readonly testId: string;
}) {
  const queryClient = useQueryClient();
  const stored = useMemo(() => Object.fromEntries(fields.map((field) => [field.key, toText(field, settings[field.key])])) as Record<string, string>, [fields, settings]);
  const [draft, setDraft] = useState(stored);
  const [base, setBase] = useState(stored);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // When the saved settings change (a save, an undo, another tab), the form starts over from them.
  if (base !== stored) {
    setBase(stored);
    setDraft(stored);
  }
  const dirty = fields.filter((field) => draft[field.key] !== stored[field.key]);

  const send = async (values: Record<string, string>): Promise<boolean> => {
    const patch: Record<string, unknown> = {};
    const problems: Record<string, string> = {};
    for (const field of fields) {
      if (values[field.key] === stored[field.key] && values === draft) continue;
      const parsed = fromText(field, values[field.key] ?? '');
      if (parsed.ok) patch[field.key] = parsed.value;
      else problems[field.key] = parsed.message;
    }
    setErrors(problems);
    if (Object.keys(problems).length > 0) return false;
    if (Object.keys(patch).length === 0) return true;
    const result = await updateSettingsAction(patch as UpdateSettingsActionInput);
    if (!result.ok) {
      setErrors({ ...(result.error.fields ?? {}) });
      toast.error('Could not save the settings', result.error.message);
      return false;
    }
    queryClient.setQueryData(qk.settings(), result.data);
    for (const key of [qk.settings(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot(), qk.badges()]) void queryClient.invalidateQueries({ queryKey: key });
    return true;
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    const before = { ...stored };
    const changed = dirty.map((field) => field.key);
    const ok = await send(draft);
    setSaving(false);
    if (!ok || changed.length === 0) return;
    toast.undo('Settings saved', {
      description: changed.length === 1 ? 'One setting changed.' : `${changed.length} settings changed.`,
      onUndo: async () => {
        const back: Record<string, string> = { ...draft };
        for (const key of changed) back[key] = before[key] ?? '';
        // Send only the fields that changed, with their old values.
        const patch: Record<string, unknown> = {};
        for (const field of fields) {
          if (!changed.includes(field.key)) continue;
          const parsed = fromText(field, back[field.key] ?? '');
          if (parsed.ok) patch[field.key] = parsed.value;
        }
        const result = await updateSettingsAction(patch as UpdateSettingsActionInput);
        if (!result.ok) throw new Error(result.error.message);
        queryClient.setQueryData(qk.settings(), result.data);
        for (const key of [qk.settings(), qk.jobsRoot(), qk.profitRoot(), qk.summaryRoot()]) void queryClient.invalidateQueries({ queryKey: key });
        toast.success('Settings put back');
      },
    });
  };

  const set = (key: string, value: string): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: '' } : current));
  };

  return (
    <Panel title={title}>
      <form
        data-testid={testId}
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canEdit && dirty.length > 0) void save();
        }}
      >
        {intro ? <p className="text-sm text-fg-secondary">{intro}</p> : null}
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          {fields.map((field) => {
            if (field.when && !field.when(draft)) return null;
            const value = draft[field.key] ?? '';
            const error = errors[field.key] || null;
            if (field.kind === 'days') {
              const chosen = new Set(value === '' ? [] : value.split(',').map(Number));
              return (
                <div key={field.key} className="sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-fg">{field.label}</span>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={field.label}>
                    {DAY_NAMES.map((name, day) => (
                      <button
                        key={name}
                        type="button"
                        disabled={!canEdit}
                        aria-pressed={chosen.has(day)}
                        data-testid={`${testId}-day-${day}`}
                        onClick={() => {
                          const next = new Set(chosen);
                          if (next.has(day)) next.delete(day);
                          else next.add(day);
                          set(field.key, [...next].sort((a, b) => a - b).join(','));
                        }}
                        className={cn(
                          'inline-flex h-8 min-w-12 items-center justify-center rounded-md border px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60',
                          chosen.has(day) ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-input bg-panel text-fg-secondary hover:bg-hover',
                        )}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {error ? <p className="mt-1 text-xs text-danger-text">{error}</p> : field.hint ? <p className="mt-1 text-xs text-fg-muted">{field.hint}</p> : null}
                </div>
              );
            }
            if (field.kind === 'switch') {
              return (
                <div key={field.key} className="sm:col-span-2">
                  <Switch checked={value === '1'} disabled={!canEdit} onCheckedChange={(checked) => set(field.key, checked ? '1' : '0')} label={field.label} description={field.hint} data-testid={`${testId}-${field.key}`} />
                </div>
              );
            }
            return (
              <Field key={field.key} label={field.label} hint={field.hint} error={error}>
                {({ inputId, describedBy, invalid }) =>
                  field.kind === 'select' ? (
                    <Select id={inputId} aria-describedby={describedBy} invalid={invalid} disabled={!canEdit} value={value} onValueChange={(next) => set(field.key, next)} options={field.options} />
                  ) : (
                    <Input
                      id={inputId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      disabled={!canEdit}
                      value={value}
                      inputMode={field.kind === 'text' ? undefined : 'decimal'}
                      maxLength={field.kind === 'text' ? field.maxLength : 14}
                      placeholder={field.kind === 'text' ? field.placeholder : field.kind === 'money' && field.nullable ? 'Not set' : undefined}
                      onChange={(event) => set(field.key, event.target.value)}
                      leadingIcon={field.kind === 'money' ? <span className="text-sm text-fg-muted">$</span> : undefined}
                      trailing={field.kind === 'percent' ? <span className="text-sm text-fg-muted">%</span> : 'suffix' in field && field.suffix ? <span className="text-sm whitespace-nowrap text-fg-muted">{field.suffix}</span> : undefined}
                      data-testid={`${testId}-${field.key}`}
                    />
                  )
                }
              </Field>
            );
          })}
        </div>
        {children ? children(draft) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <p className="text-xs text-fg-muted">{canEdit ? footnote : 'Only an admin can change these settings.'}</p>
          {canEdit ? (
            <div className="flex items-center gap-2">
              {dirty.length > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(stored);
                    setErrors({});
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" loading={saving} disabled={dirty.length === 0} data-testid={`${testId}-save`}>
                Save changes
              </Button>
            </div>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}
