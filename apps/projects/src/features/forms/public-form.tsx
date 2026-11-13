'use client';
/** Public intake form at /forms/<token>: anyone with the link fills it in and a task is created. */
import { cn } from '@/components/ui/cn';
import { useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Checkbox, Field, Input, IsoDatePicker, Textarea } from '@/components/ui';
import type { FormField } from '@/lib/form-types';
import type { PublicFormDTO } from '@/lib/types';
import { submitFormAction } from '@/server/actions/forms';
import { ProjectsMark } from '@/features/shell/logo';

/** One answer input for a form question (also used by the builder's live preview). */
export function FormFieldControl({
  field,
  value,
  onChange,
  invalid,
  id,
  describedBy,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid: boolean;
  id: string;
  describedBy?: string;
}) {
  switch (field.type) {
    case 'long_text':
      return (
        <Textarea
          id={id}
          rows={4}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        />
      );
    case 'checkbox':
      return (
        <Checkbox
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
          label={field.helpText ?? 'Yes'}
        />
      );
    case 'select':
      return (
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.options?.map((option) => {
            const checked = value === option.id;
            return (
              <label
                key={option.id}
                className={cn(
                  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm text-fg transition-colors duration-[var(--duration-fast)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
                  checked ? 'border-primary bg-primary-subtle' : 'border-border-default bg-panel hover:border-border-strong hover:bg-hover',
                )}
              >
                <input type="radio" name={field.id} checked={checked} onChange={() => onChange(option.id)} className="sr-only" />
                <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-panel', checked ? 'border-primary' : 'border-border-strong')}>
                  {checked ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                {option.label}
              </label>
            );
          })}
        </div>
      );
    case 'multiselect': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1.5">
          {field.options?.map((option) => (
            <Checkbox
              key={option.id}
              label={option.label}
              checked={list.includes(option.id)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...list, option.id] : list.filter((v) => v !== option.id))
              }
            />
          ))}
        </div>
      );
    }
    case 'date':
      // Same picker as the app (Today / Tomorrow / Next week, themed), not the browser's mm/dd/yyyy box.
      return (
        <IsoDatePicker
          id={id}
          value={typeof value === 'string' && value ? value : null}
          onChange={(next) => onChange(next ?? '')}
          placeholder={field.placeholder || 'Pick a date'}
          aria-label={field.label}
          clearable
          className={invalid ? '[&>button:first-child]:h-10 [&>button:first-child]:text-base [&>button:first-child]:ring-2 [&>button:first-child]:ring-danger/40' : '[&>button:first-child]:h-10 [&>button:first-child]:text-base'}
        />
      );
    default:
      return (
        <Input
          id={id}
          size="lg"
          type={
            field.type === 'email'
              ? 'email'
              : field.type === 'number'
                ? 'number'
                : field.type === 'url'
                    ? 'url'
                    : field.type === 'phone'
                      ? 'tel'
                      : 'text'
          }
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-describedby={describedBy}
          invalid={invalid}
        />
      );
  }
}

export function PublicForm({ form }: { readonly form: PublicFormDTO }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [website, setWebsite] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const result = await submitFormAction({
      token: form.token,
      answers,
      submitterName: name || null,
      submitterEmail: email || null,
      ...(website ? { website } : {}),
    });
    setPending(false);
    if (!result.ok) {
      setErrors(result.error.fields ?? {});
      setMessage(result.error.message);
      return;
    }
    setDone(result.data.confirmation);
  };

  return (
    <div className="min-h-dvh bg-app px-4 py-10">
      <div className="mx-auto w-full max-w-[620px]">
        <div className="mb-6 flex items-center gap-2 text-sm text-fg-muted">
          <ProjectsMark size={20} /> {form.orgName}
        </div>
        <div className="rounded-2xl border border-border-subtle bg-panel p-6 shadow-sm sm:p-8">
          {done ? (
            <div className="flex flex-col items-center py-8 text-center" role="status">
              <CheckCircle2 aria-hidden className="size-12 animate-check-pop text-success" />
              <h1 className="mt-4 text-xl font-semibold text-fg">Sent!</h1>
              <p className="mt-2 text-base text-fg-secondary">{done}</p>
              <Button
                variant="secondary"
                className="mt-6"
                onClick={() => {
                  setDone(null);
                  setAnswers({});
                }}
              >
                Send another
              </Button>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => void submit(event)}
              className="relative flex flex-col gap-5"
            >
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{form.name}</h1>
                {form.description ? (
                  <p className="mt-2 text-base whitespace-pre-wrap text-fg-secondary">{form.description}</p>
                ) : null}
              </div>
              {message ? (
                <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-text">
                  {message}
                </p>
              ) : null}
              {form.fields.map((field) => (
                <Field
                  key={field.id}
                  label={field.label}
                  required={field.required}
                  hint={field.type === 'checkbox' ? undefined : field.helpText}
                  error={errors[field.id]}
                >
                  {({ inputId, describedBy, invalid }) => (
                    <FormFieldControl
                      field={field}
                      id={inputId}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={answers[field.id]}
                      onChange={(value) => {
                        setAnswers((current) => ({ ...current, [field.id]: value }));
                        // A fixed answer drops its error right away (no need to send again to see it go).
                        if (errors[field.id]) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== field.id)));
                      }}
                    />
                  )}
                </Field>
              ))}
              {form.collectContact ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your name">
                    {({ inputId }) => (
                      <Input
                        id={inputId}
                        size="lg"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                      />
                    )}
                  </Field>
                  <Field label="Your email" error={errors.submitterEmail}>
                    {({ inputId, invalid }) => (
                      <Input
                        id={inputId}
                        size="lg"
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (errors.submitterEmail) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'submitterEmail')));
                        }}
                        autoComplete="email"
                        invalid={invalid}
                      />
                    )}
                  </Field>
                </div>
              ) : null}
              {/* Honeypot: hidden from people, bots fill it in and get rejected. */}
              <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
                <label>
                  Website
                  <input
                    type="text"
                    name="website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </label>
              </div>
              <Button type="submit" size="lg" loading={pending}>
                Send
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-fg-muted">Powered by KitStak Projects</p>
      </div>
    </div>
  );
}
