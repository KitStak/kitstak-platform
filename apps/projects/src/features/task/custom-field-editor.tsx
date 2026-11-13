'use client';
/**
 * Inline editor for one custom field value in the task properties panel. Values are stored raw
 * in `task.customFields[fieldId]`: text/url → string, number/currency → number, select → option
 * id, multiselect → option id[], date → YYYY-MM-DD, person → user id, checkbox → boolean.
 * Saving null removes the value.
 */
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  labelColorStyle,
  toLabelColor,
  PILL_TEXT_CLASS,
} from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { formatDue } from '@/lib/dates';
import type { CustomFieldDTO } from '@/lib/types';
import { AssigneePicker, DuePicker, LabelDot } from '@/features/views/field-pickers';
import { OptionList } from '@/features/views/option-list';
import { PROPERTY_TRIGGER } from './property-row';

function formatNumber(value: number, field: CustomFieldDTO): string {
  const precision = typeof field.config.precision === 'number' ? field.config.precision : undefined;
  if (field.type === 'currency') {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: field.config.currency ?? 'USD',
        maximumFractionDigits: precision ?? 2,
      }).format(value);
    } catch {
      return value.toFixed(precision ?? 2);
    }
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: precision ?? 4 }).format(value);
}

function OptionChip({ label, color }: { readonly label: string; readonly color: string }) {
  return (
    <span
      style={labelColorStyle(toLabelColor(color))}
      className={cn(
        'inline-flex h-6 max-w-44 items-center gap-1.5 truncate rounded-full bg-[var(--lc-subtle)] px-2 text-xs font-medium',
        PILL_TEXT_CLASS,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--lc-bg)]" />
      <span className="truncate">{label}</span>
    </span>
  );
}

const EMPTY = <span className="text-fg-muted">Empty</span>;

/** Text-like inline input that saves on Enter / blur and cancels on Esc. */
function InlineInput({
  value,
  onSave,
  disabled,
  type = 'text',
  placeholder,
  label,
  display,
}: {
  readonly value: string;
  readonly onSave: (next: string) => void;
  readonly disabled?: boolean;
  readonly type?: 'text' | 'number' | 'url';
  readonly placeholder: string;
  readonly label: string;
  readonly display?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button
        type="button"
        className={PROPERTY_TRIGGER}
        disabled={disabled}
        onClick={() => setDraft(value)}
        aria-label={`${label}: ${value || 'empty'}. Click to edit`}
      >
        {value ? (display ?? <span className="truncate">{value}</span>) : EMPTY}
      </button>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (next !== value) onSave(next);
  };
  return (
    <input
      autoFocus
      type={type === 'number' ? 'text' : type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
        }
      }}
      className="h-8 w-full min-w-0 rounded-md border border-primary bg-panel px-2 text-sm text-fg shadow-[0_0_0_3px_var(--focus-ring-soft)] outline-none placeholder:text-fg-placeholder"
    />
  );
}

export function CustomFieldEditor({
  field,
  value,
  disabled,
  onChange,
}: {
  readonly field: CustomFieldDTO;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = field.config.options ?? [];

  switch (field.type) {
    case 'checkbox':
      return (
        <div className="flex h-8 items-center px-2">
          <Checkbox
            checked={value === true}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked === true ? true : null)}
            aria-label={field.name}
          />
        </div>
      );
    case 'text':
      return (
        <InlineInput
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          label={field.name}
          placeholder="Type something…"
          onSave={(next) => onChange(next || null)}
        />
      );
    case 'url': {
      const url = typeof value === 'string' ? value : '';
      return (
        <div className="flex min-w-0 items-center gap-1">
          <InlineInput
            value={url}
            disabled={disabled}
            type="url"
            label={field.name}
            placeholder="https://"
            onSave={(next) => onChange(next ? (/^[a-z]+:/i.test(next) ? next : `https://${next}`) : null)}
            display={<span className="truncate text-fg-link">{url.replace(/^https?:\/\//, '')}</span>}
          />
          {url && /^https?:\/\//i.test(url) ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`Open ${field.name}`}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-icon hover:bg-hover hover:text-icon-strong"
            >
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      );
    }
    case 'number':
    case 'currency': {
      const number = typeof value === 'number' ? value : null;
      return (
        <InlineInput
          value={number === null ? '' : String(number)}
          type="number"
          disabled={disabled}
          label={field.name}
          placeholder={field.type === 'currency' ? '0.00' : '0'}
          display={
            number === null ? undefined : (
              <span className="truncate tabular-nums">{formatNumber(number, field)}</span>
            )
          }
          onSave={(next) => {
            if (!next) return onChange(null);
            const parsed = Number(next.replace(/[^0-9.-]/g, ''));
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
      );
    }
    case 'date': {
      const date = typeof value === 'string' ? value : null;
      return (
        <DuePicker value={date} onChange={(next) => onChange(next)} disabled={disabled} title={field.name}>
          <button type="button" className={PROPERTY_TRIGGER} disabled={disabled}>
            {date ? <span className="tabular-nums">{formatDue(date)}</span> : EMPTY}
          </button>
        </DuePicker>
      );
    }
    case 'person': {
      const userId = typeof value === 'string' ? value : null;
      return (
        <AssigneePicker value={userId} onChange={(next) => onChange(next)} disabled={disabled}>
          <button type="button" className={PROPERTY_TRIGGER} disabled={disabled}>
            {userId ? <PersonAvatar userId={userId} size="xs" showName /> : EMPTY}
          </button>
        </AssigneePicker>
      );
    }
    case 'select':
    case 'multiselect': {
      const multiple = field.type === 'multiselect';
      const selected = multiple
        ? Array.isArray(value)
          ? (value as string[])
          : []
        : typeof value === 'string'
          ? [value]
          : [];
      const chosen = options.filter((option) => selected.includes(option.id));
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild disabled={disabled}>
            <button
              type="button"
              className={cn(PROPERTY_TRIGGER, 'h-auto min-h-8 flex-wrap py-1')}
              disabled={disabled}
            >
              {chosen.length
                ? chosen.map((option) => (
                    <OptionChip key={option.id} label={option.label} color={option.color} />
                  ))
                : EMPTY}
            </button>
          </PopoverTrigger>
          <PopoverContent flush align="start" className="w-60">
            <OptionList
              multiple={multiple}
              searchable={options.length > 6}
              emptyText={
                options.length
                  ? 'Nothing matches'
                  : 'This field has no choices yet. Add them in project settings.'
              }
              options={options.map((option) => ({
                value: option.id,
                label: option.label,
                icon: <LabelDot color={option.color} />,
              }))}
              selected={selected}
              onToggle={(id) => {
                if (!multiple) {
                  setOpen(false);
                  onChange(selected[0] === id ? null : id);
                  return;
                }
                const next = selected.includes(id)
                  ? selected.filter((entry) => entry !== id)
                  : [...selected, id];
                onChange(next.length ? next : null);
              }}
            />
          </PopoverContent>
        </Popover>
      );
    }
    default:
      return null;
  }
}
