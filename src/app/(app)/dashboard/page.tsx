import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import {
  ProgressTodayCard,
  RankCard,
  StatusBreakdownCard,
  UnfulfilledCard,
} from "@/components/dashboard/widgets";
import { JobsCard } from "@/components/dashboard/jobs-card";
import { DashboardFilterBar } from "@/components/dashboard/filter-bar";
import {
  buildJobRows,
  buildProgressMetrics,
  buildStatusEntries,
  buildUnfulfilled,
  computeShiftPercent,
  formatShiftDate,
  NOW_LABEL,
  SHIFT_END_LABEL,
  SHIFT_START_LABEL,
} from "@/components/dashboard/derive";
import { getDashboardData, type RankEntry } from "@/server/repositories/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

const RANK_ROW_LIMIT = 4;

/**
 * Explicit reporting window for the four ranking cards. Each card resolves to
 * a different implied total (all orders vs. carrier-shipped orders), so the
 * shared period caption anchors them to one reporting window instead of
 * letting readers reconcile them against the live status counts above.
 */
const RANK_PERIOD_LABEL = "Last 30 days";

function toRankRows(entries: RankEntry[]): { name: string; percent: number; count: number }[] {
  return entries
    .slice(0, RANK_ROW_LIMIT)
    .map((e) => ({ name: e.name, percent: e.pct, count: e.count }));
}

export default function DashboardPage() {
  const data = getDashboardData();

  const metrics = buildProgressMetrics(data);
  const unfulfilled = buildUnfulfilled(data);
  const statusEntries = buildStatusEntries(data);
  const jobRows = buildJobRows(data);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The shared PageHeader floats `helper` centered between the H1 and the
          actions; the subtitle belongs directly under "Dashboard" instead, so it
          is rendered locally here (left-aligned, 12px, 4px below the H1 row)
          while the FILTER BY group stays right-aligned on the H1 baseline. */}
      <PageHeader
        breadcrumbs={[{ label: "Dashboard" }]}
        title="Dashboard"
        actions={<DashboardFilterBar />}
      />
      <p className="px-6 pt-1 text-[12px] text-secondary">
        Live fulfillment picture across your warehouses
      </p>
      <div className="flex-1 space-y-4 px-6 pb-8 pt-4">
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <ProgressTodayCard
            shiftDate={formatShiftDate(data.asOf)}
            nowLabel={NOW_LABEL}
            shiftStart={SHIFT_START_LABEL}
            shiftEnd={SHIFT_END_LABEL}
            shiftPercent={computeShiftPercent()}
            metrics={metrics}
          />
          <div className="flex lg:col-span-2 [&>*]:flex-1">
            <UnfulfilledCard
              total={unfulfilled.total}
              rows={unfulfilled.rows}
              open={unfulfilled.open}
              inProgress={unfulfilled.inProgress}
            />
          </div>
        </div>
        <StatusBreakdownCard entries={statusEntries} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <RankCard
            icon="store"
            title="Channels"
            description="Order details coming from channels"
            periodLabel={RANK_PERIOD_LABEL}
            rows={toRankRows(data.channelRank)}
            totalEntries={data.channelRank.length}
          />
          <RankCard
            icon="users"
            title="Clients"
            description="Client order details and rank"
            periodLabel={RANK_PERIOD_LABEL}
            rows={toRankRows(data.clientRank)}
            totalEntries={data.clientRank.length}
          />
          {/* Carrier percentages are computed against carrier-shipped orders
              (Shipped + Delivered), not the all-orders base the sibling cards
              use, so the sublabel names that base explicitly. */}
          <RankCard
            icon="truck"
            title="Carriers"
            description="Ranking of carriers to which orders are shipped"
            periodLabel={RANK_PERIOD_LABEL}
            percentLabel="of carrier-shipped orders"
            rows={toRankRows(data.carrierRank)}
            totalEntries={data.carrierRank.length}
          />
          <RankCard
            icon="globe"
            title="Order By Country"
            description="Rank of the regions where orders are shipped"
            periodLabel={RANK_PERIOD_LABEL}
            rows={toRankRows(data.countryRank)}
            totalEntries={data.countryRank.length}
          />
        </div>
        <JobsCard
          summary={{
            total: data.jobsSummary.total,
            pending: data.jobsSummary.pending,
            inProgress: data.jobsSummary.inProgress,
            completedToday: data.jobsSummary.completedToday,
          }}
          rows={jobRows}
        />
      </div>
    </div>
  );
}
