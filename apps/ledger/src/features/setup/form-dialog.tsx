'use client';
/**
 * One form in a dialog for the setup screens (customers, vendors, items, tax rates, terms,
 * accounts). Fields are described as data; the submit calls a server action and shows its field
 * messages in place. When the server asks for a second yes (a kind another app added, a temp
 * agency Crew uses), the dialog shows the reason with a checkbox and the next save sends it.
 */
import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, Select, Switch, Textarea, toast, type ButtonVariant } from '@/components/ui';

export type FormValue = string | boolean | readonly string[];
export type FormValues = Readonly<Record<string, FormValue>>;

export interface FormOption {
  readonly value: string;
  readonly label: string;
}

export type FormField =
  | { readonly kind: 'text'; readonly name: string; readonly label: string; readonly required?: boolean; readonly hint?: string; readonly placeholder?: string; readonly inputMode?: 'text' | 'decimal' | 'numeric' | 'email' | 'tel'; readonly disabled?: boolean }
  | { readonly kind: 'textarea'; readonly name: string; readonly label: string; readonly hint?: string }
  | { readonly kind: 'select'; readonly name: string; readonly label: string; readonly options: readonly FormOption[]; readonly required?: boolean; readonly hint?: string; readonly emptyLabel?: string }
  | { readonly kind: 'switch'; readonly name: string; readonly label: string; readonly hint?: string }
  | { readonly kind: 'checks'; readonly name: string; readonly label: string; readonly options: readonly (FormOption & { readonly note?: string })[]; readonly hint?: string }
  | { readonly kind: 'heading'; readonly name: string; readonly label: string };

export type FormOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly fields?: Readonly<Record<string, string>> }
  /** The server needs a second yes: show `message` with a checkbox, then save again with `confirmed`. */
  | { readonly ok: false; readonly confirm: string };

const EMPTY = '__none__';

export interface FormDialogProps {
  readonly title: string;
  readonly description?: string;
  readonly triggerLabel: string;
  readonly triggerVariant?: ButtonVariant;
  readonly triggerIcon?: ReactNode;
  readonly submitLabel: string;
  readonly fields: readonly FormField[];
  readonly initial: FormValues;
  readonly onSubmit: (values: FormValues, options: { readonly confirmed: boolean }) => Promise<FormOutcome>;
  readonly successMessage: string;
  readonly testId?: string;
}

export function FormDialog({ title, description, triggerLabel, triggerVariant = 'primary', triggerIcon, submitLabel, fields, initial, onSubmit, successMessage, testId }: FormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = (next: boolean) => {
    setOpen(next);
    if (next) {
      setValues(initial);
      setErrors({});
      setProblem(null);
      setConfirm(null);
      setConfirmed(false);
    }
  };
  const set = (name: string, value: FormValue) => setValues((current) => ({ ...current, [name]: value }));

  const submit = () => {
    startTransition(async () => {
      const outcome = await onSubmit(values, { confirmed });
      if (outcome.ok) {
        toast.success(successMessage);
        setOpen(false);
        router.refresh();
        return;
      }
      if ('confirm' in outcome) {
        setConfirm(outcome.confirm);
        setConfirmed(false);
        setProblem(null);
        return;
      }
      setErrors(outcome.fields ?? {});
      setProblem(outcome.message);
    });
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <Button variant={triggerVariant} leadingIcon={triggerIcon} onClick={() => reset(true)} data-testid={testId ? `${testId}-open` : undefined}>
        {triggerLabel}
      </Button>
      <DialogContent size="lg" data-testid={testId}>
        <DialogHeader title={title} description={description} />
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <FieldControl key={field.name} field={field} value={values[field.name]} error={errors[field.name] ?? null} onChange={(value) => set(field.name, value)} />
            ))}
            {problem ? (
              <p role="alert" className="rounded-md border border-danger bg-danger-subtle px-3 py-2 text-sm text-danger-text sm:col-span-2">
                {problem}
              </p>
            ) : null}
            {confirm ? (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning bg-warning-subtle px-3 py-2 sm:col-span-2">
                <p className="text-sm text-fg">{confirm}</p>
                <Checkbox checked={confirmed} onCheckedChange={(next) => setConfirmed(next === true)} label="Yes, do it anyway" data-testid="form-confirm" />
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={Boolean(confirm) && !confirmed} data-testid={testId ? `${testId}-save` : undefined}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldControl({ field, value, error, onChange }: { readonly field: FormField; readonly value: FormValue | undefined; readonly error: string | null; readonly onChange: (value: FormValue) => void }) {
  if (field.kind === 'heading') return <h3 className="pt-2 text-sm font-semibold text-fg sm:col-span-2">{field.label}</h3>;
  if (field.kind === 'switch') {
    return (
      <div className="sm:col-span-2">
        <Switch checked={value === true} onCheckedChange={(next) => onChange(next)} label={field.label} description={field.hint} name={field.name} />
      </div>
    );
  }
  if (field.kind === 'checks') {
    const selected = Array.isArray(value) ? (value as readonly string[]) : [];
    return (
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-xs font-medium text-fg-secondary">{field.label}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {field.options.map((option) => (
            <Checkbox
              key={option.value}
              checked={selected.includes(option.value)}
              onCheckedChange={(next) => onChange(next === true ? [...selected, option.value] : selected.filter((item) => item !== option.value))}
              label={option.label}
              description={option.note}
              data-testid={`check-${field.name}-${option.value}`}
            />
          ))}
        </div>
        {field.hint ? <p className="text-2xs text-fg-muted">{field.hint}</p> : null}
        {error ? (
          <p role="alert" className="text-2xs font-medium text-danger-text">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }
  const text = typeof value === 'string' ? value : '';
  return (
    <Field label={field.label} required={'required' in field ? field.required : false} hint={field.hint} error={error} className={field.kind === 'textarea' ? 'sm:col-span-2' : undefined}>
      {({ inputId, describedBy, invalid }) => {
        if (field.kind === 'textarea') {
          return <Textarea id={inputId} aria-describedby={describedBy} invalid={invalid} value={text} name={field.name} onChange={(event) => onChange(event.target.value)} />;
        }
        if (field.kind === 'select') {
          const options = field.required ? field.options : [{ value: EMPTY, label: field.emptyLabel ?? 'None' }, ...field.options];
          return (
            <Select
              id={inputId}
              aria-describedby={describedBy}
              invalid={invalid}
              value={text === '' ? (field.required ? undefined : EMPTY) : text}
              onValueChange={(next) => onChange(next === EMPTY ? '' : next)}
              options={options}
              placeholder="Pick one"
              data-testid={`select-${field.name}`}
            />
          );
        }
        return (
          <Input
            id={inputId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={text}
            name={field.name}
            inputMode={field.inputMode}
            placeholder={field.placeholder}
            disabled={field.disabled}
            onChange={(event) => onChange(event.target.value)}
            data-testid={`input-${field.name}`}
          />
        );
      }}
    </Field>
  );
}

/** Turns an action result into a form outcome; a CONFLICT whose fields name `confirmField` asks for a second yes. */
export function outcomeOf(result: { readonly ok: true } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly fields?: Readonly<Record<string, string>> } }, confirmField?: string): FormOutcome {
  if (result.ok) return { ok: true };
  if (confirmField && result.error.code === 'CONFLICT' && result.error.fields?.[confirmField]) return { ok: false, confirm: result.error.message };
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(result.error.fields ?? {})) fields[key.split('.')[0] ?? key] ??= message;
  return { ok: false, message: result.error.message, fields };
}

export const str = (values: FormValues, name: string): string => {
  const value = values[name];
  return typeof value === 'string' ? value.trim() : '';
};
export const bool = (values: FormValues, name: string): boolean => values[name] === true;
export const list = (values: FormValues, name: string): string[] => {
  const value = values[name];
  return Array.isArray(value) ? [...(value as readonly string[])] : [];
};
export const idOrNull = (values: FormValues, name: string): string | null => str(values, name) || null;
