"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { formatDate, formatMoney, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { ChannelBadge, PriorityFlag } from "@/components/ui/status-pill";
import type { OrderListRow } from "@/server/repositories/orders";
import type { ListEnvelope } from "./jobs-shared";

const HEADERS = [
  "Order Code",
  "Client",
  "Channel",
  "Customer",
  "Ship To",
  "Priority",
  "Qty",
  "Value",
  "Order Date",
  "Age",
] as const;

function ageInDays(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-danger/50 pl-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
        {label}
      </span>
      <span className="text-[18px] font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

export function ShortageReportTab() {
  const [rows, setRows] = React.useState<OrderListRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/orders?status=Shortage&page=1&pageSize=100", {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json()) as ListEnvelope<OrderListRow>;
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        setRows(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load shortage report");
        setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const unitsAffected = rows.reduce((sum, row) => sum + row.totalQuantity, 0);
  const valueAtRisk = rows.reduce((sum, row) => sum + row.salesPrice, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6 pt-4 ks-scroll">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Shortage report</h2>
          <p className="mt-0.5 text-[12px] text-faint">
            Shipment orders flagged Shortage during allocation — fulfill from incoming
            stock or split-ship available units.
          </p>
        </div>
        <Button variant="ghost" size="md" onClick={refresh} aria-label="Refresh report">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </Button>
      </div>

      {!loading && !error && rows.length > 0 ? (
        <div className="mb-3 flex items-center gap-8 rounded-lg border border-border bg-surface px-5 py-3 shadow-xs">
          <StatTile label="Shortage Orders" value={formatNumber(total)} />
          <StatTile label="Units Affected" value={formatNumber(unitsAffected)} />
          <StatTile label="Value at Risk" value={formatMoney(valueAtRisk)} />
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft">
              <AlertTriangle className="h-5 w-5 text-danger" aria-hidden />
            </span>
            <p className="text-[14px] font-semibold text-foreground">
              Could not load shortage report
            </p>
            <p className="max-w-sm text-[12px] text-faint">{error}</p>
            <Button variant="secondary" size="sm" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
            </span>
            <p className="text-[14px] font-semibold text-foreground">No shortages</p>
            <p className="max-w-sm text-[12px] leading-5 text-faint">
              No open orders are short on inventory. Orders move here automatically when
              allocation cannot reserve the full requested quantity.
            </p>
          </div>
        ) : (
          <div className="ks-scroll overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-[13px]">
              <thead className="bg-surface shadow-[inset_0_-1px_0_var(--border)]">
                <tr>
                  {HEADERS.map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr
                    key={order.id}
                    className="h-10 border-t border-border transition-colors hover:bg-surface-sunken"
                  >
                    <td className="whitespace-nowrap px-4">
                      <span className="font-medium text-primary">{order.code}</span>
                    </td>
                    <td className="max-w-[160px] truncate whitespace-nowrap px-4 text-body">
                      {order.clientName}
                    </td>
                    <td className="whitespace-nowrap px-4">
                      <ChannelBadge channel={order.channel} store={order.storeName} />
                    </td>
                    <td className="max-w-[160px] truncate whitespace-nowrap px-4 text-body">
                      {order.customerName}
                    </td>
                    <td className="whitespace-nowrap px-4 text-[12px] text-secondary">
                      {order.shipCity}, {order.shipState}
                    </td>
                    <td className="whitespace-nowrap px-4">
                      <PriorityFlag priority={order.priority} />
                    </td>
                    <td className="whitespace-nowrap px-4 text-right tabular-nums text-body">
                      {formatNumber(order.totalQuantity)}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right tabular-nums text-body">
                      {formatMoney(order.salesPrice)}
                    </td>
                    <td className="whitespace-nowrap px-4 text-[12px] tabular-nums text-secondary">
                      {formatDate(order.orderDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 text-right text-[12px] tabular-nums text-secondary">
                      {ageInDays(order.orderDate)}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loading && !error && rows.length > 0 ? (
        <p className="mt-2.5 text-[11px] text-faint">
          Showing {rows.length} of {formatNumber(total)} shortage orders · newest first
        </p>
      ) : null}
    </div>
  );
}
