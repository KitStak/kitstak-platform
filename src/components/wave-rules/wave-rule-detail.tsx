"use client";

/**
 * Wave rule "Show details" drawer: a read-only summary of every step plus the last five
 * waves (KitStaks addition; Logiwa opens the edit form instead).
 */
import * as React from "react";
import Link from "next/link";
import { Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PriorityFlag, StatusPill } from "@/components/ui/status-pill";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { WAVE_ORDER_BY_OPTIONS } from "@/lib/grid-defs/jobs/conditions";
import type { getWaveRuleDetail } from "@/server/repositories/wave-rules";
import type { WaveRuleOptions } from "@/server/repositories/wave-rules-options";
import { jobsOfWaveHref } from "@/components/jobs/report-pages";
import type { GridRow } from "@/components/jobs/jobs-client";

type Detail = ReturnType<typeof getWaveRuleDetail>;

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="text-[12px] font-semibold text-secondary">{label}</dt>
      <dd className="min-w-0 text-[13px] text-foreground">{children}</dd>
    </div>
  );
}

const none = <span className="text-faint">None</span>;

export function WaveRuleDetailDrawer({ rule, onClose, onEdit }: { readonly rule: GridRow | null; readonly onClose: () => void; readonly onEdit?: (id: string) => void }) {
  const fmt = useFormat();
  const id = rule?.id ?? null;
  const detail = useApiQuery<Detail>(["wave-rule", id ?? ""], id ? `/api/wave-rules/${id}` : null, { staleTime: 0 });
  const d = detail.data?.data;
  const options = useApiQuery<WaveRuleOptions>(["wave-rule-options", d?.warehouseId ?? ""], d ? "/api/wave-rules/options" : null, { query: { warehouseId: d?.warehouseId }, staleTime: 30_000 });
  const typeName = new Map((options.data?.data.jobTypes ?? []).map((t) => [t.id, t.code]));
  const roleName = new Map((options.data?.data.roles ?? []).map((t) => [t.id, t.name]));
  const userName = new Map((options.data?.data.users ?? []).map((t) => [t.id, t.name]));
  const mergeName = new Map((options.data?.data.mergeRules ?? []).map((t) => [t.value, t.label]));
  const orderLabel = (f: string) => WAVE_ORDER_BY_OPTIONS.find((o) => o.value === f)?.label ?? f;
  return (
    <Drawer
      open={rule !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      width={45}
      title={rule ? String(rule.name) : "Wave rule"}
      description={d ? `${d.operationType} · ${d.warehouseName}` : undefined}
      footer={onEdit && id ? <div className="flex justify-end"><Button variant="primary" onClick={() => onEdit(id)}><Edit3 className="h-3.5 w-3.5" aria-hidden />Edit</Button></div> : undefined}
    >
      {detail.isError ? (
        <EmptyState title="Couldn't load this wave rule" description={detail.error.message} action={<Button onClick={() => void detail.refetch()}>Retry</Button>} />
      ) : !d ? (
        <div className="flex flex-col gap-2"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-48 w-full" /></div>
      ) : (
        <div className="flex flex-col gap-5">
          <dl>
            <Row label="Priority">{d.priority === "None" ? none : <PriorityFlag priority={d.priority} />}</Row>
            {d.operationType === "Order Merge" ? (
              <Row label="Order merge rules">{(d.mergeRuleIds ?? []).length ? <ol className="list-decimal pl-4">{(d.mergeRuleIds ?? []).map((x) => <li key={x}>{mergeName.get(x) ?? "Merge rule"}</li>)}</ol> : none}</Row>
            ) : (
              <Row label="Job types">{d.jobTypeIds.length ? <ol className="list-decimal pl-4">{d.jobTypeIds.map((x) => <li key={x}>{typeName.get(x) ?? "Job type"}</li>)}</ol> : none}</Row>
            )}
            {d.operationType === "Cycle Count" ? <Row label="Count type">{d.countType ?? "Location"} · Lock locations {d.lockLocations ? "Yes" : "No"}</Row> : null}
            {d.operationType === "Replenishment" ? <Row label="Soft allocation">{d.softAllocation ? "Yes" : "No"}</Row> : null}
            <Row label="Delete if not started">{d.deleteIfNotStarted ? `${d.deleteMethod}${d.deleteTime ? ` · ${d.deleteMethod === "After Hours" ? `${d.deleteTime} h` : d.deleteTime}` : ""}` : "No"}</Row>
            <Row label="Filters">{d.filters.length ? <span className="flex flex-wrap gap-1">{d.filters.map((f) => <span key={f.field} className="rounded-full bg-primary-soft px-2 py-0.5 text-[12px] text-primary">{f.label}</span>)}</span> : <span className="text-secondary">Every open order of the warehouse</span>}</Row>
            <Row label="Order by">{d.orderBy.length ? d.orderBy.map((o) => `${orderLabel(o.field)} (${o.dir === "asc" ? "ascending" : "descending"})`).join(" → ") : none}</Row>
            <Row label="Schedule">{d.scheduleDays.length ? `${d.scheduleDays.join(", ")} at ${d.scheduleTimes.join(", ")} (${d.timezone})` : "Not scheduled"}</Row>
            <Row label="Next run">{d.nextRunAt ? fmt.gridDateTime(d.nextRunAt) : "—"}</Row>
            {d.operationType !== "Order Merge" ? (
              <Row label="Assignment">{d.assignMode === "Pool" ? "Job pool" : d.assignMode === "Roles" ? `Roles: ${(d.assigneeRoleIds ?? []).map((x) => roleName.get(x) ?? "Role").join(", ")}` : `Users: ${(d.assigneeUserIds ?? []).map((x) => userName.get(x) ?? "User").join(", ")}`}</Row>
            ) : null}
            <Row label="Runs">{d.runCount} · last by {d.lastRunBy === "Integration" ? "Auto Run" : d.lastRunBy ?? "—"}</Row>
          </dl>
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-foreground">Recent waves</h3>
            {d.recentWaves.length === 0 ? (
              <p className="text-[12px] text-faint">This rule hasn&apos;t run yet.</p>
            ) : (
              <table className="w-full border-collapse text-left text-[12px]">
                <thead><tr className="text-[11px] uppercase tracking-[0.04em] text-faint">{["Wave", "Status", "Met", "Allocated", "Short", "Jobs", "Run"].map((h) => <th key={h} className="border-b border-border px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {d.recentWaves.map((w) => (
                    <tr key={w.id} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-1.5"><Link className="font-medium text-primary hover:underline" href={jobsOfWaveHref(w.waveNo)}>{w.waveNo}</Link></td>
                      <td className="px-2 py-1.5"><StatusPill status={w.status} domain="wave" size="sm" /></td>
                      <td className="px-2 py-1.5 tabular-nums">{w.ordersMet}</td>
                      <td className="px-2 py-1.5 tabular-nums">{w.allocatedOrders}</td>
                      <td className="px-2 py-1.5 tabular-nums">{w.shortageOrders}</td>
                      <td className="px-2 py-1.5 tabular-nums">{w.jobsCreated}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-secondary">{fmt.gridDateTime(w.runAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
