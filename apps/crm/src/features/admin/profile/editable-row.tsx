'use client';
/** Click-to-edit profile row: pencil on hover, Enter / blur saves, Esc cancels. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Pencil } from 'lucide-react';
import { cn, Input, Spinner } from '@/components/ui';

export interface EditableRowProps {
  readonly label: string;
  readonly value: string | null;
  readonly placeholder: string;
  readonly icon?: ReactNode;
  readonly readOnly?: boolean;
  readonly readOnlyHint?: string;
  readonly maxLength?: number;
  readonly type?: 'text' | 'tel';
  readonly validate?: (value: string) => string | null;
  readonly onSave?: (value: string) => Promise<unknown>;
  readonly testId?: string;
}

export function EditableRow({
  label,
  value,
  placeholder,
  icon,
  readOnly,
  readOnlyHint,
  maxLength = 80,
  type = 'text',
  validate,
  onSave,
  testId,
}: EditableRowProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const skipBlur = useRef(false);

  const [seed, setSeed] = useState(value);
  if (value !== seed && !editing) {
    setSeed(value);
    setDraft(value ?? '');
  }
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const cancel = () => {
    skipBlur.current = true;
    setDraft(value ?? '');
    setError(null);
    setEditing(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const commit = async () => {
    const next = draft.trim();
    if (next === (value ?? '')) {
      setEditing(false);
      setError(null);
      return;
    }
    const problem = validate?.(next) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onSave?.(next);
      setEditing(false);
      setError(null);
      setSaved(true);
      window.requestAnimationFrame(() => buttonRef.current?.focus());
    } catch {
      /* the mutation already toasted and rolled back; stay in edit mode */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="grid gap-1 border-b border-border-subtle py-3 last:border-b-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-6"
      data-testid={testId}
    >
      <span id={`${id}-label`} className="flex items-center gap-2 text-sm font-medium text-fg-secondary [&_svg]:size-4 [&_svg]:text-icon">
        {icon}
        {label}
      </span>
      {editing ? (
        <div className="flex flex-col gap-1">
          <Input
            autoFocus
            type={type}
            aria-labelledby={`${id}-label`}
            aria-describedby={error ? `${id}-error` : undefined}
            invalid={Boolean(error)}
            value={draft}
            maxLength={maxLength}
            loading={saving}
            placeholder={placeholder}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onBlur={() => {
              if (skipBlur.current) {
                skipBlur.current = false;
                return;
              }
              void commit();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
          />
          {error ? (
            <p id={`${id}-error`} role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : (
            <p className="text-xs text-fg-muted">Enter to save · Esc to cancel</p>
          )}
        </div>
      ) : readOnly ? (
        <span className="flex min-h-8 items-center gap-2 px-2 text-base text-fg">
          {value ?? <span className="text-fg-muted">{placeholder}</span>}
          {readOnlyHint ? <span className="text-sm text-fg-muted">· {readOnlyHint}</span> : null}
        </span>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-value`}
          onClick={() => setEditing(true)}
          className={cn(
            'group flex min-h-8 w-full items-center justify-between gap-2 rounded-sm border border-transparent px-2 text-left text-base',
            'transition-[border-color,background-color] duration-[var(--duration-fast)] ease-out',
            'hover:border-border-input hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-pressed',
          )}
        >
          <span id={`${id}-value`} className={cn('truncate', value ? 'text-fg' : 'text-fg-placeholder')}>
            {value || placeholder}
          </span>
          {saving ? (
            <Spinner size="xs" label={null} />
          ) : saved ? (
            <Check aria-label="Saved" className="size-4 shrink-0 text-success-text" />
          ) : (
            <Pencil aria-hidden className="size-3.5 shrink-0 text-icon opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          )}
        </button>
      )}
    </div>
  );
}
