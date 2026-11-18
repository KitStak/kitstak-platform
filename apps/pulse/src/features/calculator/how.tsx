'use client';
/**
 * "How we got this" for numbers that are worked out on the screen (the calculator, goals, the
 * close checklist, the wall). Same look as `ExplainNumber`, but fed with lines built from the
 * very inputs the number came from, so it can never disagree with it.
 *
 *   <How title="Price per unit" formula="Cost divided by one minus your margin." lines={[...]} />
 */
import { useState, type ReactNode } from 'react';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/components/ui/cn';

export interface HowLine {
  readonly label: string;
  readonly value: string;
  /** How the line joins the one above. `total` is the answer, `note` is extra detail. */
  readonly op?: 'start' | 'plus' | 'minus' | 'times' | 'divide' | 'total' | 'note';
}

const OP_WORD: Readonly<Record<NonNullable<HowLine['op']>, string>> = { start: '', plus: 'plus', minus: 'less', times: 'times', divide: 'divided by', total: 'equals', note: '' };

export function How({
  title,
  formula,
  lines,
  warnings = [],
  footer,
  label,
  align = 'end',
  className,
  testId,
}: {
  readonly title: string;
  readonly formula: string;
  readonly lines: readonly HowLine[];
  /** Things that make the number partial. Empty means the number is complete. */
  readonly warnings?: readonly string[];
  readonly footer?: ReactNode;
  readonly label?: string;
  readonly align?: 'start' | 'center' | 'end';
  readonly className?: string;
  readonly testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? `How we got ${title.toLowerCase()}`}
          data-testid={testId ?? 'how'}
          onClick={(event) => event.stopPropagation()}
          className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus print:hidden', className)}
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[340px] max-w-[calc(100vw-32px)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-2.5 p-1" data-testid="how-body">
          <div>
            <p className="text-xs font-medium text-fg-muted">How we got this</p>
            <p className="mt-0.5 text-sm font-semibold text-fg">{title}</p>
          </div>
          <p className="text-sm text-fg-secondary">{formula}</p>
          {lines.length > 0 ? (
            <dl className="flex flex-col rounded-lg border border-border-subtle bg-sunken text-sm tabular-nums">
              {lines.map((line, index) => {
                const op = line.op ?? (index === 0 ? 'start' : 'plus');
                return (
                  <div key={`${line.label}-${index}`} className={cn('flex items-baseline justify-between gap-3 px-3 py-1.5', op === 'total' && 'border-t border-border-default font-semibold text-fg', op === 'note' && 'text-xs text-fg-muted')}>
                    <dt className="min-w-0 text-fg-secondary">
                      {OP_WORD[op] ? <span className="text-fg-muted">{OP_WORD[op]} </span> : null}
                      {line.label}
                    </dt>
                    <dd className="shrink-0 text-fg">{line.value}</dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
          {warnings.length > 0 ? (
            <ul className="flex flex-col gap-1.5" aria-label="Things that make this number partial">
              {warnings.map((text) => (
                <li key={text} className="flex items-start gap-2 text-xs text-[var(--label-orange-text)]">
                  <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-fg-muted">
              <CircleCheck aria-hidden className="size-3.5 text-success" />
              Nothing is missing behind this number.
            </p>
          )}
          {footer}
        </div>
      </PopoverContent>
    </Popover>
  );
}
