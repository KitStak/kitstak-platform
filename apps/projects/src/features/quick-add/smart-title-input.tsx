'use client';
/**
 * The quick-add title box. A transparent textarea sits on top of a mirror that paints the same
 * text, so recognised words (dates, !priority, @people, #labels, +project) light up as you type.
 * Below it, chips show what was understood; × keeps that text as plain words instead.
 */
import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AtSign, CalendarDays, Flag, FolderKanban, Hash, Plus, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/components/ui';
import { segmentQuickAdd, type QuickAddToken, type QuickAddTokenKind } from '@/lib/nl-parse';
import { activeToken, applySuggestion, suggestFor, type Suggestion } from './token-suggestions';

// Each kind gets its own label-palette hue so the words and chips are easy to tell apart.
const TOKEN_TEXT: Record<QuickAddTokenKind, string> = {
  date: 'bg-[var(--label-blue-subtle)] text-[var(--label-blue-text)]',
  priority: 'bg-[var(--label-orange-subtle)] text-[var(--label-orange-text)]',
  assignee: 'bg-[var(--label-purple-subtle)] text-[var(--label-purple-text)]',
  label: 'bg-[var(--label-green-subtle)] text-[var(--label-green-text)]',
  project: 'bg-[var(--label-teal-subtle)] text-[var(--label-teal-text)]',
};

const CHIP_ICON: Record<QuickAddTokenKind, typeof CalendarDays> = {
  date: CalendarDays,
  priority: Flag,
  assignee: AtSign,
  label: Hash,
  project: FolderKanban,
};

const CHIP_PREFIX: Record<QuickAddTokenKind, string> = {
  date: 'Due',
  priority: 'Priority',
  assignee: 'Assign to',
  label: 'Label',
  project: 'Project',
};

// Shared box metrics so the mirror and the textarea line up pixel for pixel.
const BOX = 'w-full px-3 py-2.5 text-md leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

export interface SmartTitleInputHandle {
  focus(): void;
  /** Closes the @/#/+ suggestion list if it's open; true when it was (so Escape shouldn't close the dialog). */
  dismissSuggestions(): boolean;
}

export type SuggestData = Parameters<typeof suggestFor>[1];

export const SmartTitleInput = forwardRef<
  SmartTitleInputHandle,
  {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly tokens: readonly QuickAddToken[];
    readonly onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    readonly placeholder?: string;
    readonly invalid?: boolean;
    readonly suggestData: SuggestData;
    /** The user picked "Create label …": that #name may become a new label. */
    readonly onCreateLabel?: (name: string) => void;
  }
>(function SmartTitleInput({ value, onChange, tokens, onKeyDown, placeholder, invalid, suggestData, onCreateLabel }, ref) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const token = caret === null ? null : activeToken(value, caret);
  const suggestions: Suggestion[] = useMemo(() => (token ? suggestFor(token, suggestData) : []), [token?.sigil, token?.partial, suggestData]); // eslint-disable-line react-hooks/exhaustive-deps
  // Already complete ("+OPS", "@me")? Then Enter should save, not re-pick the same thing.
  const word = token ? value.slice(token.start, token.end).toLowerCase() : '';
  // A "Create label" row is never complete on its own: the new name still needs that explicit choice.
  const complete = suggestions.some((suggestion) => !suggestion.id.startsWith('new:') && suggestion.insert.toLowerCase() === word);
  const open = Boolean(token) && !complete && dismissedAt !== token?.start && (suggestions.length > 0 || Boolean(token?.partial));
  const empty = open && suggestions.length === 0;
  const active = open ? Math.min(highlight, suggestions.length - 1) : -1;

  const choose = (suggestion: Suggestion) => {
    if (!token) return;
    if (suggestion.id.startsWith('new:')) onCreateLabel?.(suggestion.id.slice(4).replace(/[-_]+/g, ' '));
    const next = applySuggestion(value, token, suggestion);
    pendingCaret.current = next.caret;
    onChange(next.text);
    setCaret(next.caret);
    setHighlight(0);
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    },
    dismissSuggestions: () => {
      if (!open || !token) return false;
      setDismissedAt(token.start);
      return true;
    },
  }));

  // Put the caret right after an inserted suggestion.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (empty) {
        onKeyDown?.(event);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setHighlight((active + delta + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
        event.preventDefault();
        const pick = suggestions[active];
        if (pick) choose(pick);
        return;
      }
    }
    onKeyDown?.(event);
  };
  const syncCaret = () => setCaret(textRef.current?.selectionStart ?? null);

  // Grow with the text (up to ~5 lines), then scroll; keep the mirror scrolled the same.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 24 * 5 + 22)}px`;
    if (mirrorRef.current) mirrorRef.current.scrollTop = el.scrollTop;
  }, [value]);

  const segments = segmentQuickAdd(value, tokens);
  return (
    <div
      className={cn(
        'relative rounded-lg border bg-panel transition-colors',
        invalid ? 'border-danger' : 'border-border-input hover:border-border-input-hover',
        'focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/30',
      )}
    >
      <div ref={mirrorRef} aria-hidden className={cn(BOX, 'pointer-events-none absolute inset-0 overflow-hidden text-fg')}>
        {segments.map((segment, index) =>
          segment.token ? (
            <mark
              key={index}
              className={cn('rounded-[3px] px-0 [box-decoration-break:clone]', segment.token.unresolved ? cn('bg-transparent text-fg underline decoration-wavy underline-offset-4', segment.token.kind === 'label' ? 'decoration-warning' : 'decoration-danger') : TOKEN_TEXT[segment.token.kind])}
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
        {/* keeps a trailing newline/space measurable */}
        <span>{'​'}</span>
      </div>
      <textarea
        ref={textRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value.replace(/\r?\n/g, ' '));
          setCaret(event.target.selectionStart);
          setHighlight(0);
        }}
        onSelect={syncCaret}
        onClick={syncCaret}
        onBlur={() => window.setTimeout(() => setCaret(null), 120)}
        onScroll={(event) => {
          if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        rows={1}
        maxLength={500}
        aria-label="Task name"
        aria-invalid={invalid || undefined}
        aria-describedby="quick-add-understood"
        data-testid="quick-add-title"
        placeholder={placeholder}
        spellCheck
        className={cn(
          BOX,
          'relative block min-h-[46px] resize-none bg-transparent text-transparent caret-[var(--color-fg)] outline-none',
          'selection:bg-[color-mix(in_oklab,var(--color-focus)_28%,transparent)] selection:text-transparent placeholder:text-fg-placeholder',
        )}
      />
      {open && token ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={token.sigil === '@' ? 'People' : token.sigil === '#' ? 'Labels' : 'Projects'}
          data-testid="quick-add-suggestions"
          className="absolute top-full left-0 z-10 mt-1 w-72 max-w-full overflow-hidden rounded-lg border border-border-subtle bg-raised p-1 shadow-modal"
        >
          <li role="presentation" className="px-2 pt-1 pb-1.5 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
            {token.sigil === '@' ? 'Assign to' : token.sigil === '#' ? 'Add a label' : 'Put it in'}
          </li>
          {empty ? (
            <li role="presentation" className="px-2 py-1.5 text-sm text-fg-secondary" data-testid="quick-add-no-match">
              {token.sigil === '@'
                ? `No one in this workspace matches “${token.partial}”. The task will be unassigned and “@${token.partial}” stays in its name.`
                : `No project matches “${token.partial}”. It stays in the task name as typed.`}
            </li>
          ) : null}
          {suggestions.map((suggestion, index) => {
            const Icon = suggestion.id.startsWith('new:') ? Plus : token.sigil === '@' ? AtSign : token.sigil === '#' ? Hash : FolderKanban;
            return (
              <li
                key={suggestion.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(suggestion);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', index === active ? 'bg-hover text-fg' : 'text-fg-secondary')}
              >
                <Icon aria-hidden className="size-3.5 shrink-0 text-icon" />
                <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
                {suggestion.detail ? <span className="shrink-0 truncate text-xs text-fg-muted">{suggestion.detail}</span> : null}
              </li>
            );
          })}
          {empty ? null : (
            <li role="presentation" className="border-t border-border-subtle px-2 pt-1.5 pb-0.5 text-2xs text-fg-muted">
              ↑↓ to choose · Enter or Tab to pick · Esc to close
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
});

export function UnderstoodChips({
  tokens,
  onDismiss,
  onCreateLabel,
}: {
  readonly tokens: readonly QuickAddToken[];
  readonly onDismiss: (token: QuickAddToken) => void;
  /** Shown on an unknown #label chip when the user may create labels. */
  readonly onCreateLabel?: (name: string) => void;
}) {
  return (
    <div id="quick-add-understood" aria-live="polite" className="flex min-h-7 flex-wrap items-center gap-1.5" data-testid="quick-add-chips">
      {tokens.length === 0 ? (
        <p className="text-xs text-fg-muted">
          Tip: type <Example>tomorrow</Example>, <Example>next fri</Example>, <Example>!high</Example>, <Example>@name</Example>,{' '}
          <Example>#label</Example> or <Example>+project</Example> and we’ll fill in the details.
        </p>
      ) : (
        <>
          <span className="text-xs font-medium text-fg-muted">We understood:</span>
          {tokens.map((token) => {
            const Icon = token.unresolved ? TriangleAlert : CHIP_ICON[token.kind];
            return (
              <span
                key={`${token.id}-${token.start}`}
                data-testid="quick-add-chip"
                data-kind={token.kind}
                className={cn(
                  'inline-flex h-7 max-w-full items-center gap-1 rounded-full pr-1 pl-2.5 text-xs font-medium',
                  token.unresolved
                    ? token.kind === 'label'
                      ? 'bg-warning-subtle text-warning-text'
                      : 'bg-danger-subtle text-danger-text ring-1 ring-danger/40 ring-inset'
                    : TOKEN_TEXT[token.kind],
                )}
                data-unresolved={token.unresolved ? '' : undefined}
                title={token.unresolved && token.kind === 'assignee' ? `“${token.raw}” matched nobody, so the task stays unassigned and the name leaves it out. Fix the spelling, pick from the list, or press × to keep it as text.` : token.unresolved && token.kind !== 'label' ? `“${token.raw}” matched nothing, so it stays in the task name. Fix the spelling or pick from the list.` : undefined}
              >
                <Icon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">
                  {token.unresolved && token.kind !== 'label' ? (
                    <>
                      <span className="opacity-75">{CHIP_PREFIX[token.kind]}:</span> {token.display.charAt(0).toLowerCase() + token.display.slice(1)}
                    </>
                  ) : token.unresolved ? token.display : (
                    <>
                      <span className="opacity-75">{CHIP_PREFIX[token.kind]}:</span> {token.display}
                    </>
                  )}
                </span>
                {token.unresolved && token.kind === 'label' && token.name && onCreateLabel ? (
                  <button
                    type="button"
                    onClick={() => onCreateLabel(token.name ?? '')}
                    data-testid="quick-add-create-label"
                    className="ml-1 inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-[color-mix(in_oklab,currentColor_12%,transparent)] px-2 text-2xs font-semibold hover:bg-[color-mix(in_oklab,currentColor_20%,transparent)] focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Plus aria-hidden className="size-3" />
                    Create label
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDismiss(token)}
                  aria-label={`Keep “${token.raw}” as plain text`}
                  title="Keep as plain text"
                  className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_oklab,currentColor_14%,transparent)] focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}

function Example({ children }: { readonly children: string }) {
  return <code className="rounded-sm bg-sunken px-1 py-px font-mono text-[11px] text-fg-secondary">{children}</code>;
}
