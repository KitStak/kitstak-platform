"use client";

/**
 * Channel Monitoring › Health Overview (channel radio cards, Filter by Client, grid with header
 * tooltips, setup-name link) and › Setup Details (setup dropdown + empty state, then 6 cards:
 * order volume chart, success donut and four "Show all" tables). Spec 06 §12–§13.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { AlertTriangle, Info, Settings2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { DataGrid, GridToolbar, useGrid, type GridColumnDef } from "@/components/grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { HEALTH_FIELDS, HEALTH_GRID_KEY, LOW_PERFORMING_PCT } from "@/lib/grid-defs/integrations/monitoring";
import type { HealthCard, HealthRow, SetupDetails } from "@/server/repositories/monitoring";
import { Muted, toFilterFields, useClientOptions } from "@/components/integrations/shared/shared";
import { ProviderCell, ProviderLogo, providerMeta, providerOptions } from "@/components/integrations/shared/logos";
import { MonitoringHeader } from "./monitoring-review-pages";

const TIPS = {
  status: "Whether the Download Orders method is Active or Passive for this setup.",
  rate: "Orders imported successfully vs. orders that hit an error in the last 24 hours. With no orders in 24 hours the rate shows 0%.",
  orders: "Orders downloaded through this setup in the last 24 hours.",
  lines: "Order lines downloaded through this setup in the last 24 hours.",
  last: "When Download Orders last ran successfully.",
};

function Head({ label, tip }: { readonly label: string; readonly tip: string }) {
  // Header cells live inside the sort button, so no nested interactive tooltip trigger here.
  return <span className="inline-flex items-center gap-1" title={tip}>{label}<Info className="h-3 w-3 opacity-60" aria-hidden /></span>;
}

function RateCell({ value }: { readonly value: number }) {
  const low = value < LOW_PERFORMING_PCT;
  return <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", low ? "text-danger" : "text-success")}>{low ? <AlertTriangle className="h-3.5 w-3.5" aria-label="Low performing" /> : null}{value}%</span>;
}

export function HealthOverviewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const fmt = useFormat();
  const clients = useClientOptions();
  const [clientId, setClientId] = React.useState<string | null>(null);
  const cards = useApiQuery<HealthCard[]>(["health-cards", clientId ?? ""], "/api/monitoring/health/cards", { query: { clientId: clientId ?? undefined } });
  const fields = React.useMemo(() => toFilterFields(HEALTH_FIELDS, { provider: providerOptions("channel"), clientId: clients }), [clients]);
  const g = useGrid<HealthRow>({ gridKey: HEALTH_GRID_KEY, path: "/api/monitoring/health", fields });
  const providerFilter = g.grid.query.filters.find((f) => f.field === "provider");
  const selected = providerFilter && "values" in providerFilter ? providerFilter.values[0] : undefined;
  void params;
  const pick = (provider: string | null) => {
    const rest = g.grid.query.filters.filter((f) => f.field !== "provider" && f.field !== "clientId");
    const next = [...rest, ...(provider ? [{ field: "provider", op: "in" as const, values: [provider] }] : []), ...(clientId ? [{ field: "clientId", op: "in" as const, values: [clientId] }] : [])];
    g.grid.setQuery({ ...g.grid.query, filters: next as typeof g.grid.query.filters, page: 1 });
  };
  React.useEffect(() => { pick(selected ?? null); /* sync client filter */ }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const COLUMNS: GridColumnDef<HealthRow>[] = [
    { id: "provider", header: "Channel", size: 170, cell: ({ row }) => <ProviderCell kind="channel" provider={row.original.provider} isSandbox={row.original.isSandbox} /> },
    { id: "storeName", header: "Setup name", size: 210, meta: { alwaysVisible: true }, cell: ({ row }) => <Link className="font-medium text-primary hover:underline" href={`/integrations/monitoring/setup?id=${row.original.id}`}>{row.original.storeName}</Link> },
    { id: "clientName", header: "Client", size: 180, cell: ({ row }) => row.original.clientName },
    { id: "downloadStatus", header: () => <Head label="Download order status" tip={TIPS.status} />, size: 190, cell: ({ row }) => <StatusPill status={row.original.downloadStatus} domain="active" /> },
    { id: "successRate", header: () => <Head label="Success rate" tip={TIPS.rate} />, size: 140, cell: ({ row }) => <span title={`${row.original.successes24h} ok · ${row.original.errors24h} failed`}><RateCell value={row.original.successRate} /></span> },
    { id: "orders24h", header: () => <Head label="Num. of orders" tip={TIPS.orders} />, size: 140, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.orders24h}</div> },
    { id: "lines24h", header: () => <Head label="Num. of lines" tip={TIPS.lines} />, size: 130, meta: { align: "right" }, cell: ({ row }) => <div className="text-right tabular-nums">{row.original.lines24h}</div> },
    { id: "lastSuccessAt", header: () => <Head label="Last successful call date" tip={TIPS.last} />, size: 210, cell: ({ row }) => (row.original.lastSuccessAt ? fmt.dateTime(row.original.lastSuccessAt) : <Muted>Never</Muted>) },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonitoringHeader />
      <div className="flex flex-col gap-3 px-6">
        <div className="flex items-center gap-3">
          <p className="flex items-center gap-1 text-[13px] text-secondary">Selected channel: <span className="font-semibold text-foreground">{selected ? providerMeta("channel", selected).name : "All channels"}</span><InfoTip content="Pick a channel card to filter the grid. Low-performing setups are below 80% success in 24 hours." /></p>
          <div className="ml-auto w-64"><Combobox aria-label="Filter by client" options={clients} value={clientId} onChange={setClientId} placeholder="Filter by client" clearable /></div>
        </div>
        <div role="radiogroup" aria-label="Channels" className="flex gap-3 overflow-x-auto pb-1">
          {cards.isPending ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 w-56 shrink-0 rounded-xl" />) : (cards.data?.data ?? []).map((c) => {
            const active = (selected ?? null) === c.provider;
            return (
              <button key={c.provider ?? "all"} type="button" role="radio" aria-checked={active} onClick={() => pick(c.provider)}
                className={cn("flex w-60 shrink-0 flex-col gap-2 rounded-xl border-2 bg-surface px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", active ? "border-primary shadow-sm" : "border-border hover:border-border-strong")}>
                <span className="flex items-center gap-2 text-[13px] font-semibold">{c.provider ? <ProviderLogo kind="channel" provider={c.provider} /> : null}{c.provider ? providerMeta("channel", c.provider).name : "All channels"}<span className="ml-auto text-[11px] font-normal text-faint">{c.setups} setup{c.setups === 1 ? "" : "s"}</span></span>
                <span className="grid grid-cols-2 gap-2">
                  <span><span className="block text-[10px] uppercase tracking-wide text-faint">Avg. success rate</span><span className={cn("text-[18px] font-semibold tabular-nums", c.avgSuccess >= LOW_PERFORMING_PCT ? "text-success" : "text-danger")}>{c.avgSuccess}%</span></span>
                  <span><span className="block text-[10px] uppercase tracking-wide text-faint">Low-performing</span><span className={cn("text-[18px] font-semibold tabular-nums", c.lowPerforming > 0 ? "text-danger" : "text-success")}>{c.lowPerforming}</span></span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
        <GridToolbar {...g.toolbarProps} searchPlaceholder="Search setup or client" />
        <DataGrid<HealthRow> {...g.gridProps} columns={COLUMNS} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/integrations/monitoring/setup?id=${r.id}`)}
          emptyTitle="No channel setups" emptyDescription="Connect a store in Channel Integrations to monitor it here." />
      </div>
    </div>
  );
}

const optionsSchema = z.array(z.object({ id: z.string(), storeName: z.string(), provider: z.string(), clientName: z.string() }));

function CardShell({ title, tip, href, count, children }: { readonly title: string; readonly tip: string; readonly href?: string; readonly count?: number; readonly children: React.ReactNode }) {
  return (
    <section className="flex min-h-[220px] flex-col rounded-xl border border-border bg-surface p-4">
      <header className="mb-2 flex items-center gap-1.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">{title}</h3><InfoTip content={tip} />
        {count !== undefined ? <Badge size="sm" tone={count > 0 ? "danger" : "neutral"} className="ml-1">{count}</Badge> : null}
        {href ? <Link href={href} className="ml-auto text-[12px] font-medium text-primary hover:underline">Show all</Link> : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function MiniTable({ heads, rows }: { readonly heads: readonly string[]; readonly rows: readonly (readonly React.ReactNode[])[] }) {
  if (rows.length === 0) return <p className="py-8 text-center text-[12px] text-faint">No records to display</p>;
  return (
    <table className="w-full text-[12px]">
      <thead className="text-[10px] uppercase text-faint"><tr>{heads.map((h) => <th key={h} className="px-1.5 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="max-w-[180px] truncate px-1.5 py-1.5">{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

export function SetupDetailsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const fmt = useFormat();
  const id = params.get("id");
  const opts = useApiQuery<unknown>(["channel-options"], "/api/channels/options", { staleTime: 60_000 });
  const parsed = optionsSchema.safeParse(opts.data?.data);
  const options = parsed.success ? parsed.data : [];
  const q = useApiQuery<SetupDetails>(["setup-details", id ?? ""], id ? `/api/monitoring/setup/${id}` : null, { staleTime: 10_000 });
  const d = q.data?.data;
  const donut = d ? [{ name: "Successful", value: d.successes24h }, { name: "Errors", value: d.errors24h }] : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonitoringHeader />
      <div className="flex flex-col gap-4 px-6 pb-6">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="w-72">
            <label htmlFor="setup-select" className="mb-1 flex items-center gap-1 text-[11px] font-medium text-secondary">Setup name<InfoTip content="Select a setup from your store integrations" /></label>
            <Combobox id="setup-select" aria-label="Setup name" value={id} options={options.map((o) => ({ value: o.id, label: o.storeName, description: o.clientName }))} placeholder="Select a setup" emptyText={opts.isPending ? "Loading setups…" : "No store connections yet"} onChange={(v) => router.replace(v ? `/integrations/monitoring/setup?id=${v}` : "/integrations/monitoring/setup")} />
          </div>
          {d ? <>
            <div><p className="text-[11px] text-faint">Channel</p><ProviderCell kind="channel" provider={d.provider} isSandbox={d.isSandbox} /></div>
            <div><p className="text-[11px] text-faint">Client</p><p className="text-[16px] font-semibold">{d.clientName}</p></div>
            <div><p className="text-[11px] text-faint">Warehouses</p><p className="text-[13px] font-medium">{d.warehouses.join(", ") || "Not linked"}</p></div>
          </> : null}
        </div>
        {!id ? <EmptyState icon={Settings2} title="No content has been loaded" description="Search and select a setup name to view its data." />
          : q.isPending ? <div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
          : !d ? <EmptyState title="Couldn't load this setup" description={q.error?.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} /> : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <CardShell title="Shipment order volumes" tip="Orders seen on the channel vs. orders created in KitStaks per day (14 days). A gap means orders are failing — check Missing Shipment Orders.">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={d.volume.map((v) => ({ ...v, label: v.day.slice(5) }))} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <ChartTooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="channel" name="Channel orders created" stroke="#7F56D9" fill="#7F56D9" fillOpacity={0.12} strokeWidth={2} />
                      <Area type="monotone" dataKey="kitstaks" name="KitStaks orders created" stroke="#17874D" fill="#17874D" fillOpacity={0.15} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardShell>
            </div>
            <CardShell title="Success rate" tip="Successful vs. failed order downloads in the last 24 hours.">
              <div className="relative h-48">
                {d.successes24h + d.errors24h === 0 ? <p className="absolute inset-0 flex items-center justify-center text-center text-[12px] text-faint">No downloads in the last 24 hours</p> : null}
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={d.successes24h + d.errors24h === 0 ? [{ name: "None", value: 1 }] : donut} dataKey="value" innerRadius={52} outerRadius={72} paddingAngle={2} stroke="none">
                      {(d.successes24h + d.errors24h === 0 ? [{ name: "None" }] : donut).map((x) => <Cell key={x.name} fill={x.name === "Successful" ? "#17874D" : x.name === "Errors" ? "#B20B1C" : "#E4E7EC"} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <span className={cn("pointer-events-none absolute inset-0 flex items-center justify-center text-[24px] font-semibold tabular-nums", d.successRate >= LOW_PERFORMING_PCT ? "text-success" : "text-danger")}>{d.successRate}%</span>
              </div>
            </CardShell>
            <CardShell title="Missing shipment orders" tip="Store orders that failed to download." count={d.counts.missing} href={`/integrations/monitoring/missing-orders?f.connectionId=in:${d.id}`}>
              <MiniTable heads={["Order code", "Order date", "Last error code"]} rows={d.missing.map((m) => [m.orderCode, fmt.date(m.orderDate), <span key="e" className="text-danger" title={m.lastErrorCode}>{m.lastErrorCode}</span>])} />
            </CardShell>
            <CardShell title="Workflow blocked shipment orders" tip="Orders stopped by an automation rule." count={d.counts.blocked} href={`/integrations/monitoring/workflow-blocked?f.storeName=eq:${encodeURIComponent(d.storeName)}`}>
              <MiniTable heads={["Order code", "Block", "Workflow"]} rows={d.blocked.map((b) => [b.orderCode, b.blockType, b.workflowName ?? "—"])} />
            </CardShell>
            <CardShell title="Product listing exceptions" tip="SKU mismatches and multi-listings that can cause sync errors and overselling." count={d.counts.listingExceptions} href="/integrations/monitoring/listing-exceptions">
              <MiniTable heads={["KitStaks SKU", "Seller SKU", "Issue"]} rows={d.listingExceptions.map((e) => [e.sku, e.sellerSkus, e.issueType])} />
            </CardShell>
            <div className="lg:col-span-3">
              <CardShell title="Recent errors" tip="Order download errors in the past two weeks, grouped by error type." count={d.counts.recentErrors} href={`/integrations/monitoring/recent-errors?f.connectionId=in:${d.id}`}>
                <MiniTable heads={["Error reason", "Occurrence qty", "Affected order qty", "Last occurrence"]} rows={d.recentErrors.map((e) => [e.errorReason, e.occurrences, e.affectedOrders, fmt.dateTime(e.lastOccurrence)])} />
              </CardShell>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
