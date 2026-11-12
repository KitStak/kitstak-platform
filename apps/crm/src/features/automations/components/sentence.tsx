'use client';
/**
 * Sentence rendering. `SentenceText` is read-only (bold tokens) for lists and cards;
 * `EditableClause` renders a clause with token chips that open pickers.
 */
import { forwardRef, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger, cn } from '@/components/ui';
import { clauseDef } from '../model/clauses';
import { clauseParts, type ClauseDraft, type SentencePart, type TokenResolver } from '../model/draft';
import type { BuilderContext } from '../model/resolver';
import { humanizeTemplate, templateSegments, templateVarLabel, type TemplateVar } from '../model/template';
import type { TokenValue } from '../model/tokens';
import { TokenPicker } from './token-pickers';

/**
 * Non-editable "Item name" / "Board name" chip for a `{name}` / `{board}` template variable.
 * Inline (not inline-block) so the surrounding token's underline runs continuously beneath it,
 * baseline-aligned, and neutral-toned so it never reads as an editable token.
 */
export function VarChip({ name, term }: { readonly name: TemplateVar; readonly term?: string }) {
  return (
    <span
      data-testid="template-var"
      data-var={name}
      className="inline rounded-xs bg-muted px-1 align-baseline box-decoration-clone text-[0.9em] font-medium text-fg"
    >
      {templateVarLabel(name, term)}
    </span>
  );
}

/** Splits `“text”` into its quote marks and body so the marks render outside the underline. */
export function splitQuoted(text: string): { open: string; inner: string; close: string } {
  if (text.length >= 2 && text.startsWith('“') && text.endsWith('”')) {
    return { open: '“', inner: text.slice(1, -1).trim(), close: '”' };
  }
  return { open: '', inner: text, close: '' };
}

/** Closing quote glued to the token with a word joiner so it never wraps onto its own line. */
function CloseQuote({ mark }: { readonly mark: string }) {
  return mark ? <span>{`⁠${mark}`}</span> : null;
}

/** Text with `{name}` / `{board}` rendered as chips (never as raw braces). */
export function TemplateText({ text, term }: { readonly text: string; readonly term?: string }) {
  const segments = templateSegments(text);
  if (segments.length === 1 && segments[0]?.kind === 'text') return <>{text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <VarChip key={index} name={segment.name} term={term} />
        ),
      )}
    </>
  );
}

export function SentenceText({
  parts,
  className,
  tokenClassName,
  term,
}: {
  readonly parts: readonly SentencePart[];
  readonly className?: string;
  readonly tokenClassName?: string;
  /** Board item term, used for the "<Term> name" variable chip. */
  readonly term?: string;
}) {
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <QuotedToken key={index} text={part.text}>
            {(inner) => (
              <strong
                className={cn(
                  'font-semibold underline decoration-2 underline-offset-4',
                  part.set ? 'text-fg decoration-primary/40' : 'text-fg-secondary decoration-border-strong',
                  tokenClassName,
                )}
              >
                <TemplateText text={inner} term={term} />
              </strong>
            )}
          </QuotedToken>
        ),
      )}
    </span>
  );
}

function QuotedToken({
  text,
  children,
}: {
  readonly text: string;
  readonly children: (inner: string) => ReactNode;
}) {
  const { open, inner, close } = splitQuoted(text);
  return (
    <>
      {open ? <span>{open}</span> : null}
      {children(inner)}
      <CloseQuote mark={close} />
    </>
  );
}

export interface TokenChipProps {
  readonly text: string;
  readonly set: boolean;
  readonly invalid?: boolean;
  /** The next unset token in the wizard chain: soft highlight + one pulse so users see where they are. */
  readonly isNext?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
  readonly label: string;
  readonly term?: string;
  readonly onCloseAutoFocus?: (event: Event) => void;
}

/** Underlined, bold token button with `aria-haspopup` that opens its picker. */
export const TokenChip = forwardRef<HTMLSpanElement, TokenChipProps>(function TokenChip(
  { text, set, invalid, isNext, open, onOpenChange, children, label, term, onCloseAutoFocus },
  ref,
) {
  const quoted = splitQuoted(text);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {quoted.open ? <span className="ml-0.5">{quoted.open}</span> : null}
      <PopoverTrigger asChild>
        {/* A span (not <button>) so long tokens wrap inline with the sentence like text. */}
        <span
          ref={ref}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
          aria-haspopup="dialog"
          aria-label={`${humanizeTemplate(label, term)}: ${set ? humanizeTemplate(text, term) : 'not set'}`}
          data-testid="automation-token"
          data-set={set || undefined}
          data-invalid={invalid || undefined}
          data-next={isNext || undefined}
          className={cn(
            quoted.open ? 'mr-0.5' : 'mx-0.5',
            'inline cursor-pointer rounded-xs px-0.5 font-semibold underline box-decoration-clone decoration-2 underline-offset-[6px] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
            'outline-none hover:bg-primary-subtle focus-visible:bg-primary-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus active:bg-primary-selected',
            'data-[state=open]:bg-primary-selected',
            'data-[next]:bg-primary-subtle motion-safe:data-[next]:animate-[pulse_480ms_var(--ease-out)_1]',
            set
              ? 'text-primary-text decoration-primary'
              : 'text-fg-secondary decoration-dashed decoration-fg-muted',
            invalid && !set && 'text-danger-text decoration-danger',
          )}
        >
          <TemplateText text={quoted.inner} term={term} />
        </span>
      </PopoverTrigger>
      <CloseQuote mark={quoted.close} />
      <PopoverContent
        flush
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
});

export interface EditableClauseProps {
  readonly clause: ClauseDraft;
  readonly resolver: TokenResolver;
  readonly context: BuilderContext;
  readonly definite?: boolean;
  /** Drop the leading "When" (inside the WHEN step card). */
  readonly omitLead?: boolean;
  readonly openToken: string | null;
  readonly nextToken?: string | null;
  readonly showInvalid: boolean;
  readonly onOpenToken: (tokenKey: string | null) => void;
  readonly onCommit: (clauseKey: string, token: string, value: TokenValue, close: boolean) => void;
  readonly registerChip: (tokenKey: string, element: HTMLElement | null) => void;
  /** Lets the builder keep focus where auto-advance put it when a picker closes. */
  readonly onCloseAutoFocus?: (event: Event) => void;
}

export function tokenKeyOf(clauseKey: string, token: string): string {
  return `${clauseKey}:${token}`;
}

export function EditableClause({
  clause,
  resolver,
  context,
  definite,
  omitLead,
  openToken,
  nextToken,
  showInvalid,
  onOpenToken,
  onCommit,
  registerChip,
  onCloseAutoFocus,
}: EditableClauseProps) {
  const def = clauseDef(clause.role, clause.type);
  const parts = clauseParts(clause, resolver, { definite, omitLead });
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'text') return <span key={index}>{part.text}</span>;
        const spec = def?.tokens[part.token];
        if (!def || !spec) return <strong key={index}>{part.text}</strong>;
        const key = tokenKeyOf(clause.key, part.token);
        return (
          <TokenChip
            key={key}
            ref={(element) => registerChip(key, element)}
            text={part.text}
            set={part.set}
            invalid={showInvalid && !spec.optional}
            isNext={nextToken === key}
            label={spec.placeholder}
            term={resolver.term}
            onCloseAutoFocus={onCloseAutoFocus}
            open={openToken === key}
            onOpenChange={(open) => onOpenToken(open ? key : null)}
          >
            <TokenPicker
              def={def}
              clause={clause}
              token={part.token}
              spec={spec}
              value={clause.values[part.token]}
              context={context}
              onCommit={(value, close = true) => onCommit(clause.key, part.token, value, close)}
            />
          </TokenChip>
        );
      })}
    </>
  );
}
