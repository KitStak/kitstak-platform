'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ExternalLink, Gauge, Settings2 } from 'lucide-react';
import { Button, EmptyState, buttonVariants, Select, Skeleton, ToggleGroup, cn, toast } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { PageFrame } from '@/features/shell/pages/page-frame';
import { routes } from '@/features/shell/routes';
import { PIPELINE_PERIODS, type PipelineDto, type PipelinePeriod } from '@/server/services/crm-contracts';
import { usePipeline, useSavePipelineSettings, useCrmBoards } from '../api';
import { CardSkeleton, CrmCard, ErrorBlock, MetricTile } from '../components/crm-ui';
import { formatDay, formatExactMoney, formatMoney, formatPercent, noun, plural } from '../lib/format';
import { ForecastChart } from './forecast-chart';
import { PipelineFunnel } from './funnel';
import { AtRiskList, QuotaTable, VelocityStrip } from './pipeline-panels';
import { PipelineSettingsDialog, type SettingsTab } from './settings-dialog';

const PERIOD_LABELS: Readonly<Record<PipelinePeriod, string>> = {
  this_month: 'Month',
  this_quarter: 'Quarter',
  next_quarter: 'Next qtr',
  this_year: 'Year',
  all: 'All time',
};

function usePipelineParams() {
  const search = useSearchParams();
  const pathname = usePathname() ?? '';
  const rawPeriod = search?.get('period');
  const period = (PIPELINE_PERIODS as readonly string[]).includes(rawPeriod ?? '') ? (rawPeriod as PipelinePeriod) : 'this_quarter';
  const params = {
    period,
    owner: search?.get('owner') ?? undefined,
    boardId: search?.get('board') ?? undefined,
  };
  const searchString = search?.toString() ?? '';
  const set = useCallback(
    (patch: Partial<Record<'period' | 'owner' | 'board', string | null>>) => {
      const next = new URLSearchParams(searchString);
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      // Native history keeps the filter change client-only (Next syncs useSearchParams with it).
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
    },
    [searchString, pathname],
  );
  return { params, set };
}

export function PipelinePage() {
  const { org } = useOrg();
  const { params, set } = usePipelineParams();
  const pipeline = usePipeline(params);
  const boards = useCrmBoards();
  const save = useSavePipelineSettings(params);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const data = pipeline.data;
  const noDeals = boards.data && !boards.data.primary.deals;

  const ownerOptions = useMemo(
    () => [{ value: 'all', label: 'All owners' }, ...(data?.owners ?? []).map((owner) => ({ value: owner.id, label: owner.name }))],
    [data?.owners],
  );
  // An owner id in the URL that is not on this board (stale link, removed member) falls back to
  // "All owners" instead of rendering a blank select.
  const unknownOwner = Boolean(data && !pipeline.isPlaceholderData && params.owner && !data.owners.some((owner) => owner.id === params.owner));
  const warnedOwner = useRef<string | null>(null);
  useEffect(() => {
    if (!unknownOwner || !params.owner || warnedOwner.current === params.owner) return;
    warnedOwner.current = params.owner;
    toast.info('Owner not found', 'That owner has no deals on this board, so all owners are shown.');
    set({ owner: null });
  }, [unknownOwner, params.owner, set]);
  const ownerValue = unknownOwner ? 'all' : (params.owner ?? 'all');

  const actions = data ? (
    <>
      {data.dealBoards.length > 1 ? (
        <Select
          size="md"
          className="w-48"
          aria-label="Deals board"
          value={data.board.id}
          onValueChange={(value) => set({ board: value })}
          options={data.dealBoards.map((board) => ({ value: board.id, label: board.name }))}
        />
      ) : null}
      <Link href={routes.board(org.slug, data.board.id)} className={buttonVariants({ variant: 'secondary' })}>
        <ExternalLink aria-hidden />
        Open board
      </Link>
      {data.canEdit ? (
        <Button variant="secondary" leadingIcon={<Settings2 aria-hidden />} onClick={() => setSettingsTab('stages')} data-testid="crm-settings-open">
          Settings
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <PageFrame
      width="wide"
      title="Pipeline"
      icon={<Gauge aria-hidden />}
      description={
        data
          ? `${data.board.name} · ${plural(data.board.itemCount, noun(data.board.itemTerminology))} · forecast weighted by stage probability`
          : 'Forecast, conversion and pipeline health'
      }
      breadcrumbs={[{ label: 'Home', href: routes.home(org.slug) }, { label: 'CRM' }, { label: 'Pipeline' }]}
      actions={actions}
    >
      <div className="flex flex-col gap-6" data-testid="crm-pipeline">
        <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label="Pipeline filters">
          <ToggleGroup
            label="Close date period"
            value={params.period}
            onValueChange={(value) => set({ period: value === 'this_quarter' ? null : value })}
            options={PIPELINE_PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
          />
          <Select
            className="w-48"
            aria-label="Owner"
            value={ownerValue}
            onValueChange={(value) => set({ owner: value === 'all' ? null : value })}
            options={ownerOptions}
          />
          {data?.periodRange ? (
            <span className="text-sm text-fg-muted">
              Closing {formatDay(data.periodRange.from)} – {formatDay(data.periodRange.to)}
            </span>
          ) : null}
          {pipeline.isFetching && data ? (
            <span className="ml-auto text-xs text-fg-muted" aria-live="polite">
              Updating…
            </span>
          ) : null}
        </div>

        {noDeals ? (
          <EmptyState
            title="No deals board yet"
            description="Create a Deals board from the CRM template to see your pipeline, forecast and quota attainment here."
            actions={
              <Link href={routes.templates(org.slug)} className={buttonVariants({ variant: 'primary' })}>
                Browse CRM templates
              </Link>
            }
          />
        ) : pipeline.isError && !data ? (
          <ErrorBlock error={pipeline.error} title="Couldn’t load the pipeline" onRetry={() => void pipeline.refetch()} />
        ) : !data ? (
          <PipelineSkeleton />
        ) : (
          <PipelineBody data={data} orgSlug={org.slug} onOpenSettings={setSettingsTab} stale={pipeline.isPlaceholderData} />
        )}
      </div>
      {data ? (
        <PipelineSettingsDialog
          open={settingsTab !== null}
          onOpenChange={(open) => (open ? null : setSettingsTab(null))}
          initialTab={settingsTab ?? 'stages'}
          boardId={data.board.id}
          stages={data.funnel}
          probabilities={data.settings.stageProbabilities}
          quotas={data.settings.quotas}
          staleDays={data.settings.staleDays}
          users={data.owners}
          currency={data.currency}
          onSave={(input) => save.mutateAsync(input)}
        />
      ) : null}
    </PageFrame>
  );
}

function PipelineBody({
  data,
  orgSlug,
  onOpenSettings,
  stale,
}: {
  readonly data: PipelineDto;
  readonly orgSlug: string;
  readonly onOpenSettings: (tab: SettingsTab) => void;
  readonly stale: boolean;
}) {
  const { summary, currency } = data;
  const term = data.board.itemTerminology;
  const empty = summary.openCount + summary.wonCount + summary.lostCount === 0;
  return (
    <div className={cn('flex flex-col gap-6 transition-opacity duration-[var(--duration-fast)]', stale && 'opacity-70')} aria-busy={stale || undefined}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile
          testId="crm-metric-open"
          label="Open pipeline"
          value={formatMoney(summary.openValue, currency)}
          exact={formatExactMoney(summary.openValue, currency)}
          hint={plural(summary.openCount, `open ${noun(term)}`, `open ${noun(term, 2)}`)}
        />
        <MetricTile
          testId="crm-metric-weighted"
          label="Weighted forecast"
          tone="primary"
          value={formatMoney(summary.weighted, currency)}
          exact={formatExactMoney(summary.weighted, currency)}
          hint="Value × stage probability"
        />
        <MetricTile
          label="Won"
          tone="success"
          value={formatMoney(summary.wonValue, currency)}
          exact={formatExactMoney(summary.wonValue, currency)}
          hint={plural(summary.wonCount, `${noun(term)} won`, `${noun(term, 2)} won`)}
        />
        <MetricTile label="Win rate" value={formatPercent(summary.winRate)} hint={`${summary.wonCount} won · ${summary.lostCount} lost`} />
        <MetricTile
          label="Avg won deal"
          value={summary.avgDealSize !== null ? formatMoney(summary.avgDealSize, currency) : '—'}
          exact={summary.avgDealSize !== null ? formatExactMoney(summary.avgDealSize, currency) : undefined}
          hint="Closed won in period"
        />
        <MetricTile
          label="At risk"
          tone={data.atRisk.length > 0 ? 'danger' : 'default'}
          value={String(data.atRisk.length)}
          hint={`Stale ${data.settings.staleDays}d+ or overdue`}
        />
      </div>

      {empty ? (
        <EmptyState
          size="sm"
          illustration="search"
          title={`No ${noun(term, 2)} close in this period`}
          description="Try another period or owner. The forecast below still covers the next six months."
        />
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <CrmCard
          id="crm-funnel-card"
          className="xl:col-span-7"
          title="Stage funnel"
          description="Count, value and conversion between stages"
          aside={
            data.canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => onOpenSettings('stages')}>
                {data.settings.customized ? 'Edit probabilities' : 'Set probabilities'}
              </Button>
            ) : null
          }
        >
          <PipelineFunnel stages={data.funnel} currency={currency} term={term} />
        </CrmCard>
        <CrmCard id="crm-forecast-card" className="xl:col-span-5" title="Forecast by close month" description="Next six months, independent of the period filter">
          <ForecastChart months={data.forecast} currency={currency} />
        </CrmCard>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <CrmCard
          id="crm-quota-card"
          title="Quota attainment"
          description="Won in period vs quota"
          aside={
            data.canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => onOpenSettings('quotas')} data-testid="crm-quota-edit">
                Edit quotas
              </Button>
            ) : null
          }
        >
          <QuotaTable
            reps={data.reps}
            currency={currency}
            canEdit={data.canEdit}
            onSetQuotas={() => onOpenSettings('quotas')}
            hasPeriodQuota={data.period !== 'all'}
          />
        </CrmCard>
        <CrmCard
          id="crm-risk-card"
          title={`${term}s at risk`}
          description={`No activity in ${data.settings.staleDays}+ days or past the close date`}
          aside={
            data.canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => onOpenSettings('risk')}>
                Rule
              </Button>
            ) : null
          }
        >
          <AtRiskList
            deals={data.atRisk}
            currency={currency}
            orgSlug={orgSlug}
            boardId={data.board.id}
            staleDays={data.settings.staleDays}
            term={term}
          />
        </CrmCard>
      </div>

      <CrmCard id="crm-velocity-card" title="Stage velocity" description="How long deals sit in each stage before moving on">
        <VelocityStrip stages={data.velocity} />
      </CrmCard>
      <p className="text-xs text-fg-muted">
        Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ·{' '}
        <Link className="rounded-sm text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus" href={routes.board(orgSlug, data.board.id)}>
          View all {noun(term, 2)}
        </Link>
      </p>
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading pipeline" data-skeleton>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} height={86} rounded="lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="rounded-lg border border-border-subtle bg-panel p-5 xl:col-span-7">
          <CardSkeleton rows={5} height={36} />
        </div>
        <div className="rounded-lg border border-border-subtle bg-panel p-5 xl:col-span-5">
          <Skeleton height={220} rounded="md" />
        </div>
      </div>
    </div>
  );
}
