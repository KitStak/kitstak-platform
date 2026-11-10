"use client";

/**
 * Live dashboard (BUILD_PLAN M13 §1). Filter selection in the URL (`?wh=&cl=`), defaults
 * to the header context; auto-refresh every 60 s plus a manual refresh with an
 * "Updated hh:mm" stamp. Every widget reacts to the filter.
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/lib/query-client";
import { useMe } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";
import type { LiveDashboard } from "@/server/repositories/dashboard-live";
import { DashboardFilterBar, type FilterOption } from "./filter-bar";
import { JobsCard, ProgressTodayCard, RankCard, StatusBreakdownCard, UnfulfilledCard } from "./widgets";

export const DASHBOARD_REFRESH_MS = 60_000;

const list = (v: string | null): readonly string[] => (v ? v.split(",").filter(Boolean) : []);

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-[300px]" /><Skeleton className="h-[300px] lg:col-span-2" /></div>
      <Skeleton className="h-[150px]" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[240px]" />)}</div>
      <Skeleton className="h-[220px]" />
    </div>
  );
}

export function DashboardView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlWh = list(params.get("wh"));
  const urlCl = list(params.get("cl"));
  const me = useMe();
  const opts = me.data?.data.contextOptions;
  const ctx = me.data?.data.context;

  const warehouses: FilterOption[] = React.useMemo(() => (opts?.warehouses ?? []).map((w) => ({ id: w.id, label: w.code && !w.name.startsWith(w.code) ? `${w.code} - ${w.name}` : w.name })), [opts]);
  const clients: FilterOption[] = React.useMemo(() => (opts?.clients ?? []).map((c) => ({ id: c.id, label: c.name })), [opts]);
  // Shown selection: URL first, then the header context.
  const shownWh = urlWh.length ? urlWh : ctx?.warehouseId ? [ctx.warehouseId] : [];
  const shownCl = urlCl.length ? urlCl : ctx?.clientId ? [ctx.clientId] : [];

  const query = new URLSearchParams();
  if (urlWh.length) query.set("wh", urlWh.join(","));
  if (urlCl.length) query.set("cl", urlCl.join(","));
  const qs = query.toString();
  const q = useApiQuery<LiveDashboard>(["dashboard", qs], "/api/dashboard", { query: qs, refetchInterval: DASHBOARD_REFRESH_MS, placeholderData: (prev) => prev });
  const data = q.data?.data;

  const onChange = (next: { warehouseIds: readonly string[]; clientIds: readonly string[] }) => {
    const p = new URLSearchParams();
    if (next.warehouseIds.length) p.set("wh", next.warehouseIds.join(","));
    if (next.clientIds.length) p.set("cl", next.clientIds.join(","));
    const s = p.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const updated = q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-10">
      <PageHeader
        title="Dashboard"
        helper="Live fulfillment picture for the warehouses and clients you pick. Click any number to open those records."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-faint tabular-nums" aria-live="polite">{updated ? `Updated ${updated}` : ""}</span>
            <Button size="icon" variant="ghost" aria-label="Refresh dashboard" title="Refresh now (auto every 60 s)" onClick={() => void q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} aria-hidden />
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center justify-end gap-2 px-6 pt-3">
        <DashboardFilterBar warehouses={warehouses} clients={clients} warehouseIds={shownWh} clientIds={shownCl} onChange={onChange} />
      </div>
      <div className={cn("space-y-4 px-6 pt-4 transition-opacity", q.isFetching && data && "opacity-80")}>
        {q.error && !data ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface py-12 text-center">
            <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
            <p className="text-[14px] font-semibold">The dashboard could not load</p>
            <p className="text-[12.5px] text-secondary">{q.error.message}</p>
            <Button onClick={() => void q.refetch()}>Retry</Button>
          </div>
        ) : !data ? <DashboardSkeleton /> : (
          <>
            <div className="grid items-stretch gap-4 lg:grid-cols-3">
              <ProgressTodayCard data={data} />
              <div className="flex lg:col-span-2 [&>*]:flex-1"><UnfulfilledCard data={data} /></div>
            </div>
            <StatusBreakdownCard data={data} />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <RankCard icon="store" title="Channels" description="Order details coming from channels" rows={data.ranks.channels} />
              <RankCard icon="users" title="Clients" description="Client order details and rank" rows={data.ranks.clients} />
              <RankCard icon="truck" title="Carriers" description="Ranking of carriers to which orders are shipped" rows={data.ranks.carriers} />
              <RankCard icon="globe" title="Order By Country" description="Rank of the regions where orders are shipped" rows={data.ranks.countries} />
            </div>
            <JobsCard data={data} />
          </>
        )}
      </div>
    </div>
  );
}
