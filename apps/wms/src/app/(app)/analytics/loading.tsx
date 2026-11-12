import { AnalyticsSkeleton } from '@/components/analytics/analytics-skeleton';

/** Analytics dashboards are KPI tiles + chart cards, not a grid: mirror that while the route loads. */
export default function AnalyticsLoading() {
  return <AnalyticsSkeleton />;
}
