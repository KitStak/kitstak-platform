'use client';
/**
 * Admin → Usage & billing: the "Plan and payment" row (rendered on the server from
 * `@kitstak/billing` and passed in), then fair use meters, content counts and seats.
 * Count tiles are the shared `StatTile`s: each one links to the list it counts.
 */
import type { ReactNode } from 'react';
import { Meter, StatRow, StatTile } from '@kitstak/ui/dashboard';
import { Skeleton } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { useActiveWorkspaceId } from '@/features/shell/sidebar/sidebar';
import { ORG_ROLES } from '@/server/rbac/permissions';
import { useUsage } from '../api';
import { formatBytes, formatNumber, formatStorage, meterTone, percent, pluralize, ROLE_LABEL } from '../format';
import { ErrorPanel, SectionHeader, SettingsCard } from '../ui';

function UsageMeter({ label, used, limit, format = formatNumber }: { readonly label: string; readonly used: number; readonly limit: number; readonly format?: (value: number) => string }) {
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
      <Meter value={pct / 100} label={`${label}: ${pct}% used`} tone={tone} size="thick" />
      {tone !== 'data' ? (
        <span className={tone === 'critical' ? 'text-sm text-danger-text' : 'text-sm text-warning-text'}>
          {tone === 'critical' ? 'Limit reached' : `${pct}% used, approaching the limit`}
        </span>
      ) : null}
    </div>
  );
}

export function UsageSection({ planCard = null }: { readonly planCard?: ReactNode }) {
  const usage = useUsage();
  const { org } = useOrg();
  const workspace = useActiveWorkspaceId();
  const data = usage.data;
  // Boards and items have no org wide list: they live in workspaces, so the tiles open the active one.
  const boardsHref = workspace.id ? routes.workspace(org.slug, workspace.id) : routes.home(org.slug);
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
                <UsageMeter label="Automation runs this month" used={data.automationRuns.thisMonth} limit={data.automationRuns.limit} />
                <UsageMeter label="File storage" used={data.files.bytes} limit={data.files.limitBytes} format={formatBytes} />
              </div>
            )}
          </SettingsCard>

          <StatRow label="Content">
            <StatTile data-testid="usage-boards" label="Boards" href={boardsHref} value={data ? formatNumber(data.boards) : '…'} caption={data ? `Across ${pluralize(data.workspaces, 'workspace')}` : '\u00a0'} />
            <StatTile data-testid="usage-items" label="Items" href={boardsHref} value={data ? formatNumber(data.items) : '…'} caption="On live boards, excluding trash" />
            <StatTile label="Automations" href={routes.automations(org.slug)} value={data ? formatNumber(data.automations.total) : '…'} caption={data ? `${formatNumber(data.automations.enabled)} on · ${pluralize(data.automationRuns.failedThisMonth, 'failed run')} this month` : '\u00a0'} />
            <StatTile label="Dashboards" href={routes.dashboards(org.slug)} value={data ? formatNumber(data.dashboards) : '…'} caption={data ? `Shared views over ${pluralize(data.boards, 'board')}` : '\u00a0'} />
            {/* Files are listed per board (each board's Files view); there is no org wide list to open. */}
            <StatTile label="Files" href={null} value={data ? formatNumber(data.files.count) : '…'} caption={data ? `${formatStorage(data.files.bytes)} used` : '\u00a0'} />
            <StatTile data-testid="usage-tokens" label="Active API tokens" href={routes.apiTokens(org.slug)} value={data ? formatNumber(data.apiTokens) : '…'} caption={data ? `${pluralize(data.apiTokensRevokedThisMonth, 'token')} revoked this month` : '\u00a0'} />
          </StatRow>

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
