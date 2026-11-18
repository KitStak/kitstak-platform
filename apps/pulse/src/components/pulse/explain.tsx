'use client';
/**
 * "How we got this" for any number (SPEC 4.15). A small info button that opens a popover with the
 * rule in plain words, the same rule with the real figures, the rows behind it, and a warning
 * line whenever the number is partial. The figures come from `GET /api/v1/explain`, which reads
 * the same rollups as the screen, so the popover can never disagree with the number.
 *
 *   <ExplainNumber metric="profit" scope={{ from, to, clientId }} />
 *
 * Any team can mount it by path: `@/components/pulse/explain`.
 */
import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/components/ui/cn';
import type { ExplainMetric } from '@/lib/constants';
import { formatHours, formatMoney, formatMoneyPerHour, formatNumber, formatPace, formatPercentBp } from '@/lib/format';
import { useExplain, type ProfitParams } from '@/lib/hooks/use-data';
import type { ExplainLineDTO } from '@/lib/types';

const OP_WORD: Readonly<Record<ExplainLineDTO['op'], string>> = { start: '', plus: 'plus', minus: 'less', times: 'times', divide: 'divided by', total: 'equals', note: '' };

/** One explanation value as text. Hidden values read "Hidden". */
export function explainValue(line: Pick<ExplainLineDTO, 'value' | 'unit' | 'text'>): string {
  if (line.unit === 'text') return line.text ?? '';
  if (line.value === null) return 'Hidden';
  switch (line.unit) {
    case 'money':
      return formatMoney(line.value);
    case 'money_per_hour':
      return formatMoneyPerHour(line.value);
    case 'money_per_unit':
      return `${formatMoney(line.value)} each`;
    case 'percent':
      return formatPercentBp(line.value);
    case 'hours':
      return formatHours(line.value, { style: 'unit' });
    case 'pace':
      return formatPace(line.value);
    default:
      return formatNumber(line.value, { maxDigits: 1 });
  }
}

export function ExplainNumber({ metric, scope, label, className, align = 'end' }: { readonly metric: ExplainMetric; readonly scope: ProfitParams; readonly label?: string; readonly className?: string; readonly align?: 'start' | 'center' | 'end' }) {
  const [open, setOpen] = useState(false);
  const query = useExplain(metric, scope, { enabled: open });
  const data = query.data;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? 'How we got this number'}
          data-testid={`explain-${metric}`}
          onClick={(event) => event.stopPropagation()}
          className={cn('inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus print:hidden', className)}
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[340px] max-w-[calc(100vw-32px)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-2.5 p-1" data-testid="explain-body">
          <div>
            <p className="text-xs font-medium text-fg-muted">How we got this</p>
            {data ? (
              <>
                <p className="mt-0.5 text-sm font-semibold text-fg">{data.title}</p>
                <p className="text-xs text-fg-muted">{data.scope}</p>
              </>
            ) : null}
          </div>
          {query.isError ? (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-sm text-danger-text">We could not load the numbers behind this. {query.error instanceof Error ? query.error.message : ''}</p>
              <button type="button" onClick={() => void query.refetch()} className="rounded-md text-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                Try again
              </button>
            </div>
          ) : !data ? (
            <div role="status" aria-busy="true" className="flex flex-col gap-2">
              <span className="sr-only">Loading the numbers behind this</span>
              <span aria-hidden className="ks-skeleton block h-3 w-full rounded-full" />
              <span aria-hidden className="ks-skeleton block h-3 w-4/5 rounded-full" />
              <span aria-hidden className="ks-skeleton block h-20 w-full rounded-lg" />
            </div>
          ) : (
            <>
              <p className="text-sm text-fg-secondary">{data.formula}</p>
              {data.lines.length > 0 ? (
                <dl className="flex flex-col rounded-lg border border-border-subtle bg-sunken text-sm tabular-nums">
                  {data.lines.map((line, index) => (
                    <div
                      key={`${line.label}-${index}`}
                      className={cn('flex items-baseline justify-between gap-3 px-3 py-1.5', line.op === 'total' && 'border-t border-border-default font-semibold text-fg', line.op === 'note' && 'text-xs text-fg-muted')}
                    >
                      <dt className="min-w-0 text-fg-secondary">
                        {OP_WORD[line.op] ? <span className="text-fg-muted">{OP_WORD[line.op]} </span> : null}
                        {line.label}
                      </dt>
                      <dd className={cn('shrink-0', line.value === null && line.unit !== 'text' ? 'text-fg-muted' : 'text-fg')}>{explainValue(line)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {data.moneyHidden ? <p className="text-xs text-fg-muted">Money is hidden for your role. Ask an admin if you need it.</p> : null}
              {data.quality.length > 0 ? (
                <ul className="flex flex-col gap-1.5" aria-label="Things that make this number partial">
                  {data.quality.map((text) => (
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
              {data.links.map((link) => (
                <Link key={link.href} href={link.href} className="inline-flex items-center gap-1.5 self-start rounded-md text-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                  {link.label}
                  <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
