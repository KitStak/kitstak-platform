/**
 * "Jobs that need you" on the launcher: the KitStak Pulse jobs that are losing money or at risk,
 * worst first. Each row opens the job in Pulse. Hidden when Pulse has nothing to flag, is not
 * installed, or the person has no Pulse role. Money shows only to people who may see it.
 */
import { ArrowUpRight, CircleAlert, TriangleAlert } from 'lucide-react';
import { formatCents, formatMarginBp } from '@kitstak/pulse-bridge/format';
import { cn } from '@/components/ui';
import type { PulseAttention } from '@/server/product-stats';
import { AppMark } from './app-mark';

export function PulseAttentionPanel({ attention, pulseUrl }: { readonly attention: PulseAttention; readonly pulseUrl: string }) {
  if (attention.jobs.length === 0) return null;
  const base = pulseUrl.replace(/\/+$/, '');
  const more = attention.total - attention.jobs.length;
  return (
    <section aria-labelledby="pulse-attention-title" data-testid="pulse-attention">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pulse-attention-title" className="flex items-center gap-2 text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
          <AppMark module="pulse" className="size-6 rounded-md [&_svg]:h-3.5 [&_svg]:w-4" />
          Jobs that need you
        </h2>
        <a
          href={`${base}/jobs?tab=open&risk=losing,at_risk`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-fg-secondary hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {more > 0 ? `See all ${attention.total}` : 'Open in Pulse'}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </div>
      <ul className="mt-3 divide-y divide-border-subtle rounded-xl border border-border-default bg-panel shadow-xs">
        {attention.jobs.map((job) => {
          const losing = job.risk === 'losing';
          const Icon = losing ? CircleAlert : TriangleAlert;
          return (
            <li key={job.id} data-testid="pulse-attention-row">
              <a
                href={`${base}${job.path}`}
                target="_blank"
                rel="noopener"
                className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <span className="flex min-w-0 flex-1 basis-56 items-center gap-2">
                  <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.04em] text-fg-secondary tabular-nums">
                    {job.number}
                  </span>
                  <span className="truncate text-sm font-medium text-fg group-hover:underline">{job.name}</span>
                  {job.clientName ? <span className="hidden shrink-0 truncate text-xs text-fg-muted sm:inline">{job.clientName}</span> : null}
                </span>
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
                    losing ? 'bg-danger-subtle text-danger-text' : 'bg-warning-subtle text-warning-text',
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {job.riskLabel}
                </span>
                {attention.moneyHidden ? null : (
                  <span className="flex shrink-0 items-baseline gap-3 text-right tabular-nums">
                    <span className="text-xs text-fg-muted">
                      Margin <span className="font-semibold text-fg">{formatMarginBp(job.marginBp, { empty: 'none yet' })}</span>
                    </span>
                    <span className="text-xs text-fg-muted">
                      Profit{' '}
                      <span className={cn('font-semibold', (job.profitCents ?? 0) < 0 ? 'text-danger-text' : 'text-fg')}>
                        {formatCents(job.profitCents, { empty: 'none yet' })}
                      </span>
                    </span>
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
