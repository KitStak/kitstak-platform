'use client';
/**
 * Respondent-facing form renderer, shared by the builder preview and the public page
 * (/forms/[token]). Focus ring in the accent color, inline errors with aria-describedby,
 * scroll to the first error, locked-width loading submit, success checkmark, closed state,
 * honeypot + time trap for bots.
 */
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleCheck, Lock, Star } from 'lucide-react';
import { Button, Checkbox, DatePicker, Input, Select, Textarea, cn, labelColorStyle } from '@/components/ui';
import { apiRequest, ApiClientError } from '@/lib/api';
import { isBlank, isQuestionVisible, type PublicFormDto, type PublicFormQuestionDto } from '@/server/services/board-views-form-model';

type Answers = Record<string, unknown>;

/** "2026-11-06" ↔ local Date (date-only answers never shift across time zones). */
function isoToLocalDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function localDateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientError(question: PublicFormQuestionDto, value: unknown): string | null {
  if (isBlank(value) || (question.type === 'checkbox' && value !== true)) {
    if (!question.required) return null;
    return question.type === 'checkbox' ? 'Please confirm to continue' : 'This field is required';
  }
  if (question.type === 'email' && !EMAIL_RE.test(String(value))) return 'Enter a valid email address';
  if ((question.type === 'number' || question.type === 'currency') && !Number.isFinite(Number(value))) return 'Enter a number';
  if (question.type === 'timeline') {
    const range = value as { from?: string; to?: string };
    if (!range.from || !range.to) return 'Choose a start and an end date';
    if (range.from > range.to) return 'The end date must be after the start';
  }
  return null;
}

function QuestionInput({
  question,
  value,
  onChange,
  invalid,
  describedBy,
  inputId,
  disabled,
}: {
  readonly question: PublicFormQuestionDto;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly invalid: boolean;
  readonly describedBy: string | undefined;
  readonly inputId: string;
  readonly disabled?: boolean;
}) {
  const common = { id: inputId, 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy, 'aria-required': question.required || undefined, disabled };
  const text = typeof value === 'string' ? value : '';
  switch (question.type) {
    case 'long_text':
      return <Textarea {...common} rows={4} value={text} placeholder={question.placeholder ?? ''} invalid={invalid} onChange={(event) => onChange(event.target.value)} />;
    case 'number':
    case 'currency':
      return (
        <Input
          {...common}
          size="lg"
          type="number"
          inputMode="decimal"
          step="any"
          value={text}
          invalid={invalid}
          placeholder={question.placeholder ?? (question.currency ? '0' : '')}
          leadingIcon={
            question.currency ? (
              <span className="text-sm font-semibold text-fg-muted">{question.currency}</span>
            ) : question.unit?.position === 'prefix' ? (
              <span className="text-sm font-semibold text-fg-muted">{question.unit.text}</span>
            ) : undefined
          }
          trailing={question.unit?.position === 'suffix' ? <span className="text-sm font-semibold text-fg-muted">{question.unit.text}</span> : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'date':
      return (
        <div
          role="group"
          aria-describedby={describedBy}
          data-invalid={invalid ? 'true' : undefined}
          className={cn('rounded-md [&_button]:h-10', invalid && 'shadow-[0_0_0_2px_var(--danger)]')}
        >
          <DatePicker id={inputId} aria-label={question.label} value={isoToLocalDate(text)} onChange={(date) => onChange(date ? localDateToIso(date) : '')} disabled={disabled} placeholder={question.placeholder ?? 'Pick a date'} />
        </div>
      );
    case 'timeline': {
      const range = (value ?? {}) as { from?: string; to?: string };
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Input {...common} size="lg" type="date" containerClassName="w-44" aria-label={`${question.label} start`} value={range.from ?? ''} invalid={invalid} onChange={(event) => onChange({ ...range, from: event.target.value })} />
          <span className="text-fg-muted">to</span>
          <Input size="lg" type="date" containerClassName="w-44" aria-label={`${question.label} end`} value={range.to ?? ''} invalid={invalid} disabled={disabled} onChange={(event) => onChange({ ...range, to: event.target.value })} />
        </div>
      );
    }
    case 'status':
      if (question.options.length > 6) {
        return <Select id={inputId} aria-describedby={describedBy} invalid={invalid} size="lg" value={text || undefined} onValueChange={onChange} options={question.options.map((option) => ({ value: option.id, label: option.name }))} placeholder="Choose one" disabled={disabled} />;
      }
      return (
        <div role="radiogroup" aria-labelledby={`${inputId}-label`} aria-describedby={describedBy} className="flex flex-wrap gap-2">
          {question.options.map((option) => {
            const checked = text === option.id;
            return (
              <label
                key={option.id}
                style={labelColorStyle(option.color)}
                className={cn(
                  'flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-[background-color,border-color,box-shadow] duration-[var(--duration-fast)]',
                  'has-[:focus-visible]:shadow-[0_0_0_3px_var(--form-ring)]',
                  checked ? 'border-[var(--lc-bg)] bg-[var(--lc-subtle)] text-fg' : 'border-border-input bg-panel text-fg hover:border-border-input-hover hover:bg-muted',
                )}
              >
                <input type="radio" name={inputId} value={option.id} checked={checked} onChange={() => onChange(option.id)} disabled={disabled} className="sr-only" />
                {/* Filled dot + light outline: label colors stay ≥3:1 on dark surfaces too. */}
                <span aria-hidden className={cn('size-3 rounded-full bg-[var(--lc-bg)] ring-1 ring-[color-mix(in_srgb,var(--text-primary)_45%,transparent)]', checked && 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--lc-subtle)]')} />
                {option.name}
              </label>
            );
          })}
        </div>
      );
    case 'dropdown': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-labelledby={`${inputId}-label`} aria-describedby={describedBy} className="flex flex-col gap-2">
          {question.options.map((option) => (
            <Checkbox
              key={option.id}
              label={option.name}
              disabled={disabled}
              checked={selected.includes(option.id)}
              onCheckedChange={(checked) => onChange(checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))}
            />
          ))}
        </div>
      );
    }
    case 'checkbox':
      return <Checkbox id={inputId} aria-describedby={describedBy} disabled={disabled} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} label={question.placeholder || 'Yes'} />;
    case 'rating': {
      const rating = Number(value) || 0;
      return (
        <div role="radiogroup" aria-labelledby={`${inputId}-label`} aria-describedby={describedBy} className="flex gap-1">
          {Array.from({ length: question.max ?? 5 }, (_, index) => index + 1).map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${star} of ${question.max ?? 5}`}
              disabled={disabled}
              onClick={() => onChange(rating === star ? null : star)}
              className="rounded-sm p-1 text-[var(--label-yellow)] transition-transform duration-[var(--duration-fast)] ease-[var(--ease-emphasized)] hover:scale-110 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Star aria-hidden className={cn('size-7', star <= rating ? 'fill-current' : 'fill-none text-border-strong')} />
            </button>
          ))}
        </div>
      );
    }
    default:
      return (
        <Input
          {...common}
          size="lg"
          type={question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel' : question.type === 'link' ? 'url' : 'text'}
          autoComplete={question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel' : question.type === 'name' ? 'name' : 'off'}
          value={text}
          invalid={invalid}
          placeholder={question.placeholder ?? (question.type === 'tags' ? 'Separate with commas' : '')}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

export interface PublicFormProps {
  readonly form: PublicFormDto;
  /** Public token; omitted in builder preview (submissions are simulated). */
  readonly token?: string;
  readonly preview?: boolean;
  /** Builder hook: render extra chrome around each question (selection outline). */
  readonly decorate?: (question: PublicFormQuestionDto, node: ReactNode) => ReactNode;
  readonly header?: ReactNode;
}

export function PublicForm({ form, token, preview, decorate, header }: PublicFormProps) {
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState('');
  const root = useRef<HTMLFormElement>(null);

  const visible = useMemo(() => form.questions.filter((question) => isQuestionVisible({ columnKey: question.key, hidden: false, required: question.required, condition: question.condition }, answers)), [form.questions, answers]);
  const accent = labelColorStyle(form.accent);

  const focusFirstError = (keys: string[]) => {
    requestAnimationFrame(() => {
      const first = root.current?.querySelector<HTMLElement>(`[data-question="${keys[0]}"]`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.querySelector<HTMLElement>('input,textarea,button')?.focus({ preventScroll: true });
    });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const nextErrors: Record<string, string> = {};
    for (const question of visible) {
      const message = clientError(question, answers[question.key]);
      if (message) nextErrors[question.key] = message;
    }
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) return focusFirstError(Object.keys(nextErrors));
    if (preview || !token) {
      setDone(true);
      return;
    }
    setSubmitting(true);
    try {
      const payload: Answers = {};
      for (const question of visible) if (answers[question.key] !== undefined) payload[question.key] = answers[question.key];
      await apiRequest(`/public-forms/${token}`, { method: 'POST', body: { answers: payload, website: honeypot, renderToken: form.renderToken } });
      if (form.redirectUrl) {
        window.location.assign(form.redirectUrl);
        return;
      }
      setDone(true);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'VALIDATION_FAILED') {
        const issues = (error.details as { issues?: { path: string; message: string }[] } | undefined)?.issues ?? [];
        const mapped = Object.fromEntries(issues.map((issue) => [issue.path, issue.message]));
        setErrors(mapped);
        if (issues.length) focusFirstError(Object.keys(mapped));
        else setFormError(error.message);
      } else if (error instanceof ApiClientError && error.status === 429) {
        setFormError('Too many submissions from this network. Wait a minute and try again.');
      } else {
        setFormError(error instanceof ApiClientError ? error.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: ReactNode) => (
    <div style={{ ...accent, '--form-ring': 'color-mix(in srgb, var(--lc-bg) 35%, transparent)' } as React.CSSProperties} className="w-full">
      <div className="h-2 rounded-t-xl bg-[var(--lc-bg)]" aria-hidden />
      <div className="rounded-b-xl border border-t-0 border-border-subtle bg-panel px-8 py-8 shadow-sm max-[480px]:px-5 max-[480px]:py-6">{children}</div>
      {form.hideBranding ? null : (
        <p className="mt-4 text-center text-xs text-fg-muted">
          Powered by <span className="font-semibold text-fg-secondary">KitStak</span>
        </p>
      )}
    </div>
  );

  if (form.closedReason && !preview) {
    return shell(
      <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="form-closed">
        <Lock aria-hidden className="size-8 text-icon" />
        <h1 className="text-xl font-semibold text-fg">This form is no longer accepting responses</h1>
        <p className="text-fg-secondary">Reach out to the team that shared it if you still need to get in touch.</p>
      </div>,
    );
  }

  if (done) {
    return shell(
      <div className="flex flex-col items-center gap-3 py-8 text-center" data-testid="form-success" role="status">
        <CircleCheck aria-hidden className="size-14 text-[var(--lc-bg)] animate-[ks-pop-in_400ms_var(--ease-emphasized)] motion-reduce:animate-none" strokeWidth={1.75} />
        <h1 className="text-xl font-semibold text-fg">{form.thankYouTitle}</h1>
        <p className="max-w-md whitespace-pre-line text-fg-secondary">{form.thankYouMessage}</p>
        {preview ? <p className="text-xs text-fg-muted">Preview: no response was recorded.</p> : null}
        {form.allowAnother ? (
          <Button
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setAnswers({});
              setErrors({});
              setDone(false);
            }}
          >
            Submit another response
          </Button>
        ) : null}
      </div>,
    );
  }

  return shell(
    <form ref={root} noValidate onSubmit={onSubmit} aria-label={form.title} data-testid="public-form" className={cn('flex flex-col gap-6', form.align === 'center' && 'text-center')}>
      {header ?? (
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-balance text-fg">{form.title}</h1>
          {form.description ? <p className="whitespace-pre-line text-md text-fg-secondary">{form.description}</p> : null}
        </header>
      )}
      {visible.map((question) => {
        const inputId = `q-${question.key}`;
        const error = errors[question.key];
        const describedBy = [question.description ? `${inputId}-desc` : null, error ? `${inputId}-error` : null].filter(Boolean).join(' ') || undefined;
        const node = (
          <div key={question.key} data-question={question.key} className={cn('flex flex-col gap-1.5 text-left', '[&_[data-invalid=true]]:border-danger')}>
            <label id={`${inputId}-label`} htmlFor={inputId} className="text-base font-semibold text-fg">
              {question.label}
              {question.required ? (
                <span className="ml-0.5 text-danger-text" aria-hidden>
                  *
                </span>
              ) : null}
              {question.required ? <span className="sr-only"> (required)</span> : null}
            </label>
            {question.description ? (
              <p id={`${inputId}-desc`} className="text-sm text-fg-muted">
                {question.description}
              </p>
            ) : null}
            {/* One ring only: accent on the valid field surface; invalid fields keep their danger ring. */}
            <div className="[&>*:not([data-invalid=true]):not([aria-invalid=true]):focus-within]:shadow-[0_0_0_3px_var(--form-ring)] [&_input]:outline-none [&_textarea]:outline-none">
              <QuestionInput
                question={question}
                value={answers[question.key]}
                invalid={Boolean(error)}
                describedBy={describedBy}
                inputId={inputId}
                disabled={submitting}
                onChange={(value) => {
                  setAnswers((current) => ({ ...current, [question.key]: value }));
                  if (error) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== question.key)));
                }}
              />
            </div>
            {error ? (
              <p id={`${inputId}-error`} role="alert" className="text-sm font-medium text-danger-text">
                {error}
              </p>
            ) : null}
          </div>
        );
        return decorate ? <div key={question.key}>{decorate(question, node)}</div> : node;
      })}
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" name="website" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
        </label>
      </div>
      {formError ? (
        <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-sm font-medium text-danger-text">
          {formError}
        </p>
      ) : null}
      <div className={cn('flex', form.align === 'center' ? 'justify-center' : 'justify-start')}>
        <Button
          type="submit"
          size="lg"
          loading={submitting}
          data-testid="form-submit"
          className="min-w-32 bg-[var(--lc-bg)] text-[var(--lc-fg)] hover:bg-[var(--lc-hover)] active:bg-[var(--lc-hover)]"
        >
          {form.submitLabel}
        </Button>
      </div>
    </form>,
  );
}
