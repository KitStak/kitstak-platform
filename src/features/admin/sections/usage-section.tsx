'use client';
/** Admin → Usage & billing: seats, content counts, automation runs, storage and the (demo) plan. */
import { Boxes, FileStack, KeyRound, LayoutDashboard, Lock, Rows3, Sparkles, Zap } from 'lucide-react';
import { ProgressBar, Skeleton } from '@/components/ui';
import { ORG_ROLES } from '@/server/rbac/permissions';
import { useUsage } from '../api';
import { formatBytes, formatDate, formatNumber, formatStorage, meterTone, percent, pluralize, ROLE_LABEL } from '../format';
import { DemoBadge, ErrorPanel, SectionHeader, SettingsCard, StatTile } from '../ui';

function Meter({ label, used, limit, format = formatNumber }: { readonly label: string; readonly used: number; readonly limit: number; readonly format?: (value: number) => string }) {
  const pct = percent(used, limit);
  const tone = meterTone(pct);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-medium text-fg">{label}</span>
        <span className="text-sm text-fg-secondary tabular-nums">
          {format(used)} <span className="text-fg-muted">of {format(limit)}</span>
        </span>
      </div>
      <ProgressBar value={pct} label={`${label}: ${pct}% used`} tone={tone} />
      {tone !== 'primary' ? (
        <span className={tone === 'danger' ? 'text-sm text-danger-text' : 'text-sm text-warning-text'}>
          {tone === 'danger' ? 'Limit reached' : `${pct}% used, approaching the limit`}
        </span>
      ) : null}
    </div>
  );
}

export function UsageSection() {
  const usage = useUsage();
  const data = usage.data;
  return (
    <>
      <SectionHeader title="Usage & billing" description="What your organization is using this month, against your plan." />
      {usage.isError ? (
        <SettingsCard>
          <ErrorPanel title="Couldn't load usage" onRetry={() => void usage.refetch()} />
        </SettingsCard>
      ) : (
        <>
          <section
            aria-label="Plan"
            data-testid="plan-card"
            className="relative overflow-hidden rounded-lg border border-border-subtle bg-panel p-5 shadow-xs"
          >
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-fg">
                  <Sparkles aria-hidden className="size-5" />
                </span>
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-heading text-lg font-semibold text-fg">
                    {data ? data.plan.name : <Skeleton width={160} height={18} rounded="full" />}
                    <DemoBadge>Demo plan · not billed</DemoBadge>
                  </p>
                  <p className="mt-1 max-w-xl text-sm text-fg-secondary">
                    This workspace runs on a demonstration plan. Nothing is charged and no payment details are stored.
                    {data?.plan.renewsAt ? ` Usage counters reset ${formatDate(data.plan.renewsAt)}.` : ''}
                  </p>
                </div>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-fg-muted">
                <Lock aria-hidden className="size-3.5 text-icon" />
                Only owners can change the plan
              </p>
            </div>
          </section>

          <SettingsCard title="Plan limits" description="Meters turn amber at 80% and red at 100%." testId="usage-meters">
            {!data ? (
              <div data-skeleton aria-busy="true" className="flex flex-col gap-5">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex flex-col gap-2">
                    <Skeleton width="30%" height={12} rounded="full" />
                    <Skeleton height={6} rounded="full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <Meter label="Seats" used={data.seats.active} limit={data.seats.limit} />
                <Meter label="Automation runs this month" used={data.automationRuns.thisMonth} limit={data.automationRuns.limit} />
                <Meter label="File storage" used={data.files.bytes} limit={data.files.limitBytes} format={formatBytes} />
              </div>
            )}
          </SettingsCard>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label="Boards" icon={<Boxes aria-hidden />} value={data ? formatNumber(data.boards) : '–'} hint={data ? `Across ${pluralize(data.workspaces, 'workspace')}` : '\u00a0'} testId="usage-boards" />
            <StatTile label="Items" icon={<Rows3 aria-hidden />} value={data ? formatNumber(data.items) : '–'} hint="On live boards, excluding trash" testId="usage-items" />
            <StatTile label="Automations" icon={<Zap aria-hidden />} value={data ? formatNumber(data.automations.total) : '–'} hint={data ? `${formatNumber(data.automations.enabled)} on · ${pluralize(data.automationRuns.failedThisMonth, 'failed run')} this month` : '\u00a0'} />
            <StatTile label="Dashboards" icon={<LayoutDashboard aria-hidden />} value={data ? formatNumber(data.dashboards) : '–'} hint={data ? `Shared views over ${pluralize(data.boards, 'board')}` : '\u00a0'} />
            <StatTile label="Files" icon={<FileStack aria-hidden />} value={data ? formatNumber(data.files.count) : '–'} hint={data ? `${formatStorage(data.files.bytes)} used` : '\u00a0'} />
            <StatTile label="Active API tokens" icon={<KeyRound aria-hidden />} value={data ? formatNumber(data.apiTokens) : '–'} hint={data ? `${pluralize(data.apiTokensRevokedThisMonth, 'token')} revoked this month` : '\u00a0'} testId="usage-tokens" />
          </div>

          <SettingsCard title="Seats by role" description="Deactivated members don’t use a seat.">
            {!data ? (
              <Skeleton height={48} rounded="md" />
            ) : (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                {ORG_ROLES.map((role) => (
                  <div key={role}>
                    <dt className="text-sm text-fg-muted">{ROLE_LABEL[role]}s</dt>
                    <dd className="font-heading text-lg font-semibold text-fg tabular-nums">{data.seats.byRole[role]}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-sm text-fg-muted">Pending invites</dt>
                  <dd className="font-heading text-lg font-semibold text-fg tabular-nums">{data.seats.pendingInvites}</dd>
                </div>
              </dl>
            )}
          </SettingsCard>
        </>
      )}
    </>
  );
}
