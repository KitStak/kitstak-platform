'use client';
/**
 * Admin → Usage & billing: the "Plan and payment" row (rendered on the server from
 * `@kitstak/billing` and passed in), then content counts, automation runs and storage.
 */
import type { ReactNode } from 'react';
import { Boxes, FileStack, KeyRound, LayoutDashboard, Rows3, Zap } from 'lucide-react';
import { ProgressBar, Skeleton } from '@/components/ui';
import { ORG_ROLES } from '@/server/rbac/permissions';
import { useUsage } from '../api';
import { formatBytes, formatNumber, formatStorage, meterTone, percent, pluralize, ROLE_LABEL } from '../format';
import { ErrorPanel, SectionHeader, SettingsCard, StatTile } from '../ui';

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

export function UsageSection({ planCard = null }: { readonly planCard?: ReactNode }) {
  const usage = useUsage();
  const data = usage.data;
  return (
    <>
      <SectionHeader title="Usage & billing" />
      {planCard}
      {usage.isError ? (
        <SettingsCard>
          <ErrorPanel title="Couldn't load usage" onRetry={() => void usage.refetch()} />
        </SettingsCard>
      ) : (
        <>
          <SettingsCard title="Fair use limits" description="Meters turn amber at 80% and red at 100%." testId="usage-meters">
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
                <Meter label="Automation runs this month" used={data.automationRuns.thisMonth} limit={data.automationRuns.limit} />
                <Meter label="File storage" used={data.files.bytes} limit={data.files.limitBytes} format={formatBytes} />
              </div>
            )}
          </SettingsCard>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label="Boards" icon={<Boxes aria-hidden />} value={data ? formatNumber(data.boards) : '…'} hint={data ? `Across ${pluralize(data.workspaces, 'workspace')}` : '\u00a0'} testId="usage-boards" />
            <StatTile label="Items" icon={<Rows3 aria-hidden />} value={data ? formatNumber(data.items) : '…'} hint="On live boards, excluding trash" testId="usage-items" />
            <StatTile label="Automations" icon={<Zap aria-hidden />} value={data ? formatNumber(data.automations.total) : '…'} hint={data ? `${formatNumber(data.automations.enabled)} on · ${pluralize(data.automationRuns.failedThisMonth, 'failed run')} this month` : '\u00a0'} />
            <StatTile label="Dashboards" icon={<LayoutDashboard aria-hidden />} value={data ? formatNumber(data.dashboards) : '…'} hint={data ? `Shared views over ${pluralize(data.boards, 'board')}` : '\u00a0'} />
            <StatTile label="Files" icon={<FileStack aria-hidden />} value={data ? formatNumber(data.files.count) : '…'} hint={data ? `${formatStorage(data.files.bytes)} used` : '\u00a0'} />
            <StatTile label="Active API tokens" icon={<KeyRound aria-hidden />} value={data ? formatNumber(data.apiTokens) : '…'} hint={data ? `${pluralize(data.apiTokensRevokedThisMonth, 'token')} revoked this month` : '\u00a0'} testId="usage-tokens" />
          </div>

          <SettingsCard title="Seats by role" description="Deactivated members don’t use a seat.">
            {!data ? (
              <Skeleton height={48} rounded="md" />
            ) : (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                {ORG_ROLES.map((role) => (
                  <div key={role}>
                    <dt className="text-sm text-fg-muted">{ROLE_LABEL[role]}s</dt>
                    <dd className="text-lg font-semibold text-fg tabular-nums">{data.seats.byRole[role]}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-sm text-fg-muted">Pending invites</dt>
                  <dd className="text-lg font-semibold text-fg tabular-nums">{data.seats.pendingInvites}</dd>
                </div>
              </dl>
            )}
          </SettingsCard>
        </>
      )}
    </>
  );
}
