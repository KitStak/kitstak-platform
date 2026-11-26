'use client';
/**
 * "Programs this month" at the top of the Alerts page (PULSE_PROGRAMS_SPEC 6): each program alert
 * with its sentence and its one action, laid out like a job alert. These are worked out from the
 * program's numbers each time, so there is nothing to snooze or mark done: fix the cause and they
 * go away.
 */
import Link from 'next/link';
import { ArrowRight, CircleAlert, ExternalLink, Info, Repeat2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { useShell } from '@/features/shell/shell-context';
import { programAlertCount, programAlertHref, programAlertSeverity, type ProgramAlertsDTO } from './program-alerts';

const SEVERITY = {
  critical: { label: 'Urgent', icon: CircleAlert, chip: 'bg-danger-subtle text-danger-text', tone: 'danger' },
  warning: { label: 'Heads up', icon: TriangleAlert, chip: 'bg-warning-subtle text-warning-text', tone: 'warning' },
  info: { label: 'Good to know', icon: Info, chip: 'bg-muted text-icon-strong', tone: 'neutral' },
} as const;

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const monthWord = (month: string): string => MONTH.format(new Date(`${month}-01T00:00:00Z`));

export function ProgramAlertsView({ data }: { readonly data: ProgramAlertsDTO }) {
  const shell = useShell();
  if (data.groups.length === 0) return null;
  const projectsOrigin = shell.modules.projects ? shell.appUrls.projects : null;
  return (
    <section aria-labelledby="program-alerts-title" className="mb-4 overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs" data-testid="program-alerts">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-3">
        <h2 id="program-alerts-title" className="flex items-center gap-2 text-base font-semibold text-fg">
          <Repeat2 aria-hidden className="size-4 text-fg-muted" />
          Programs this month
        </h2>
        <p className="text-sm text-fg-secondary">
          {programAlertCount(data.groups)} for {monthWord(data.month)}. They clear on their own once the numbers change.
        </p>
      </header>
      <ul className="divide-y divide-border-subtle" data-testid="program-alerts-list">
        {data.groups.flatMap((group) =>
          group.alerts.map((alert) => {
            const severity = SEVERITY[programAlertSeverity(alert.rule, group.health)];
            const Icon = severity.icon;
            const action = programAlertHref(alert.action, group, data.month, projectsOrigin);
            return (
              <li key={`${group.key}:${alert.rule}:${alert.variantId ?? ''}`} className="flex gap-3 px-4 py-3.5" data-testid="program-alert-row" data-rule={alert.rule} data-program={group.key}>
                <span aria-hidden className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', severity.chip)}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-sm font-semibold text-fg">
                      <Link href={group.path} className="rounded-sm hover:text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="program-alert-program">
                        {group.key} · {group.name}
                      </Link>
                    </h3>
                    <Badge tone={severity.tone} size="sm">
                      {severity.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-fg-secondary" data-testid="program-alert-why">
                    {alert.sentence}
                  </p>
                  <div className="mt-2">
                    {action.external ? (
                      <a href={action.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="program-alert-action">
                        {alert.actionLabel}
                        <ExternalLink aria-hidden className="size-3.5" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={action.href} className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="program-alert-action">
                        {alert.actionLabel}
                        <ArrowRight aria-hidden className="size-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          }),
        )}
      </ul>
    </section>
  );
}
