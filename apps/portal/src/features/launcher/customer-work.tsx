/**
 * "Work by customer" on the launcher: KitStak Projects open tasks and at-risk projects per shared
 * customer. Every number links straight into Projects, filtered to that customer (and to the
 * at-risk projects for the risk count), so a glance here turns into action in one click.
 */
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/components/ui';
import type { CustomerWork } from '@/server/product-stats';
import { AppMark } from './app-mark';

function CountLink({
  href,
  value,
  label,
  tone = 'default',
  testId,
}: {
  readonly href: string;
  readonly value: number;
  readonly label: string;
  readonly tone?: 'default' | 'warning' | 'danger';
  readonly testId?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      data-testid={testId}
      className={cn(
        'flex min-w-[88px] flex-col rounded-md px-2.5 py-1.5 text-right hover:bg-hover',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
      )}
    >
      <span
        className={cn(
          'text-md font-semibold tabular-nums',
          tone === 'danger' ? 'text-danger-text' : tone === 'warning' ? 'text-warning-text' : 'text-fg',
        )}
      >
        {value}
      </span>
      <span className="text-xs text-fg-muted">{label}</span>
    </a>
  );
}

export function CustomerWorkPanel({ rows, projectsUrl }: { readonly rows: readonly CustomerWork[]; readonly projectsUrl: string }) {
  if (rows.length === 0) return null;
  const base = projectsUrl.replace(/\/+$/, '');
  const filtered = (customerId: string, health?: string) =>
    `${base}/projects?customer=${encodeURIComponent(customerId)}${health ? `&health=${health}` : ''}`;
  return (
    <section aria-labelledby="customer-work-title" data-testid="customer-work">
      <h2 id="customer-work-title" className="flex items-center gap-2 text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
        <AppMark module="projects" className="size-6 rounded-md [&_svg]:h-3.5 [&_svg]:w-4" />
        Work by customer
      </h2>
      <ul className="mt-3 divide-y divide-border-subtle rounded-xl border border-border-default bg-panel shadow-xs">
        {rows.map((row) => {
          const risky = row.atRisk + row.offTrack;
          return (
            <li key={row.customerId} className="flex items-center gap-3 px-4 py-2.5" data-testid="customer-work-row">
              <a
                href={filtered(row.customerId)}
                target="_blank"
                rel="noopener"
                className="group flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-sm font-medium text-fg hover:underline"
              >
                <span className="truncate">{row.name}</span>
                <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.08em] text-fg-secondary">{row.code}</span>
                <span className="shrink-0 text-xs font-normal text-fg-muted">
                  {row.projects} {row.projects === 1 ? 'project' : 'projects'}
                </span>
                <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-icon opacity-0 group-hover:opacity-100" />
              </a>
              <CountLink href={filtered(row.customerId)} value={row.openTasks} label="Open tasks" testId="customer-work-open" />
              <CountLink
                href={filtered(row.customerId, row.offTrack > 0 && row.atRisk === 0 ? 'off_track' : 'at_risk')}
                value={risky}
                label={row.offTrack > 0 ? 'At risk or off track' : 'At risk'}
                tone={row.offTrack > 0 ? 'danger' : risky > 0 ? 'warning' : 'default'}
                testId="customer-work-risk"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
