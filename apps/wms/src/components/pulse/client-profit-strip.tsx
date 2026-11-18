'use client';

/**
 * KitStak Pulse profit for a WMS client: one line with the last 30 days of revenue, cost and
 * margin, how many of the client's jobs are at risk, and a link to the client in Pulse. A WMS
 * client is the shared core customer, which is how Pulse finds it. Hidden when Pulse is not
 * available, this person has no Pulse role, or Pulse has no jobs for the client.
 */
import * as React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { formatCents, formatMarginBp } from '@kitstak/pulse-bridge/format';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import type { ClientPulseDto } from '@/server/pulse/bridge';
import { PulseMark, PulseStatusPill } from './pulse-shared';

function Figure({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: 'danger' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-sm">
      <span className="text-secondary">{label}</span>
      <span className={cn('font-semibold tabular-nums', tone === 'danger' ? 'text-danger' : 'text-foreground')}>{value}</span>
    </span>
  );
}

export function ClientProfitStrip({ clientId }: { readonly clientId: string }) {
  const query = useApiQuery<ClientPulseDto>(['client-pulse', clientId], `/api/clients/${encodeURIComponent(clientId)}/pulse`, {
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const data = query.data?.data;
  if (!data?.available || !data.client || !data.period) return null;
  const risky = data.atRisk + data.losing;
  const period = data.period;
  return (
    <section
      aria-label="Client profit from KitStak Pulse"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs"
      data-testid="client-profit"
    >
      <a href={data.client.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:underline">
        <PulseMark />
        Client profit
        <span className="font-normal text-faint">last 30 days</span>
      </a>
      {data.moneyHidden ? (
        <span className="text-sm text-secondary">Your Pulse role does not include money.</span>
      ) : (
        <>
          <Figure label="Revenue" value={formatCents(period.revenueCents)} />
          <Figure label="Cost" value={formatCents(period.costCents)} />
          <Figure label="Margin" value={formatMarginBp(period.marginBp, { empty: 'None yet' })} tone={period.marginBp !== null && period.marginBp < 0 ? 'danger' : undefined} />
        </>
      )}
      <span className={cn('text-sm', data.losing > 0 ? 'font-medium text-danger' : risky > 0 ? 'font-medium text-warning' : 'text-secondary')} data-testid="client-profit-risk">
        {data.openJobs === 0 ? 'No open jobs' : risky === 0 ? `${data.openJobs} open ${data.openJobs === 1 ? 'job' : 'jobs'}, none at risk` : `${risky} of ${data.openJobs} open jobs at risk`}
      </span>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {data.jobs.slice(0, 2).map((job) => (
          <li key={job.id}>
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex max-w-[280px] items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-0.5 text-xs text-body hover:border-border-strong"
              title={`${job.number} ${job.name}`}
            >
              <PulseStatusPill risk={job.risk} fallback={job.statusLabel} />
              <span className="truncate">{job.number}</span>
              <ArrowUpRight aria-hidden className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />
            </a>
          </li>
        ))}
        <li>
          <a href={data.client.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-secondary hover:text-foreground hover:underline">
            Open in Pulse
            <ArrowUpRight aria-hidden className="size-3" />
          </a>
        </li>
      </ul>
    </section>
  );
}
