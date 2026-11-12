'use client';

/** Job type "Show details": read-only summary of every wizard step and where it is used. */
import * as React from 'react';
import { Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { YesNoPill } from '@/components/ui/status-pill';
import { useApiQuery } from '@/lib/query-client';
import type { FilterCondition, JobTypeSettings } from '@/lib/domain-types';
import {
  COUNT_METHOD_OPTIONS,
  GROUPING_OPTIONS,
  PICKING_FLAG_DEFS,
  PICKING_METHOD_OPTIONS,
} from '@/lib/grid-defs/jobs/conditions';
import { retailerOf } from '@/lib/grid-defs/jobs/forms';
import type { getJobTypeDetail } from '@/server/repositories/job-types';
import type { GridRow } from '@/components/jobs/jobs-client';

type Detail = Awaited<ReturnType<typeof getJobTypeDetail>>;

function Row({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 border-b border-border py-2 last:border-b-0">
      <dt className="text-xs font-semibold text-secondary">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Chips({ list }: { readonly list: readonly FilterCondition[] | null | undefined }) {
  if (!list || list.length === 0) return <span className="text-secondary">Applies to all</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((c) => (
        <span key={c.field} className="rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">
          {c.label}
        </span>
      ))}
    </span>
  );
}

const label = (opts: readonly { value: string; label: string }[], v: string) =>
  opts.find((o) => o.value === v)?.label ?? v;

export function JobTypeDetailDrawer({
  row,
  onClose,
  onEdit,
}: {
  readonly row: GridRow | null;
  readonly onClose: () => void;
  readonly onEdit?: (id: string) => void;
}) {
  const id = row?.id ?? null;
  const q = useApiQuery<Detail>(['job-type', id ?? ''], id ? `/api/job-types/${id}` : null, { staleTime: 0 });
  const d = q.data?.data;
  const s = d?.settings as JobTypeSettings | undefined;
  return (
    <Drawer
      open={row !== null}
      onOpenChange={(o) => (o ? undefined : onClose())}
      width={45}
      title={row ? String(row.code) : 'Job type'}
      description={d ? `${d.operationType} · ${String(row?.warehouse ?? '')}` : undefined}
      footer={
        onEdit && id ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => onEdit(id)}>
              <Edit3 className="h-3.5 w-3.5" aria-hidden />
              Edit
            </Button>
          </div>
        ) : undefined
      }
    >
      {q.isError ? (
        <EmptyState
          title="Couldn't load this job type"
          description={q.error.message}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : !d || !s ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {d.deleteBlocker ? (
            <Callout variant="info" title="In use">
              {d.deleteBlocker}
            </Callout>
          ) : null}
          <dl>
            <Row label="Description">{d.description}</Row>
            {d.operationType === 'Picking' || d.operationType === 'Work Order' ? (
              <Row label="Allocation algorithm">{d.algorithmName ?? '—'}</Row>
            ) : null}
            {d.operationType === 'Picking' ? (
              <>
                <Row label="Template">{d.template ?? 'Custom'}</Row>
                <Row label="Order scope">{s.orderScope}</Row>
                {(() => {
                  const r = retailerOf(s);
                  return (
                    <Row label="Retailer flow">
                      {r.flowType === 'None'
                        ? 'None'
                        : `${r.flowType} · scan ${r.uccLabelScanningType} · print ${r.defaultLabelPrintOption}`}
                    </Row>
                  );
                })()}
                <Row label="Flags">
                  <span className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {PICKING_FLAG_DEFS.map((f) => (
                      <span key={f.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-secondary">{f.label}</span>
                        <YesNoPill value={s.picking[f.key]} />
                      </span>
                    ))}
                  </span>
                </Row>
                <Row label="Batch size">
                  {s.batch.method === 'Nof Order' ? 'Orders' : 'Items'} {s.batch.min} – {s.batch.max}
                </Row>
                <Row label="Mobile screens">
                  {[
                    s.mobileScreens.pickAndSort && 'Pick and sort',
                    s.mobileScreens.pickToLocation && 'Pick to location',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'Default'}
                </Row>
                <Row label="Conditions">
                  <Chips list={d.conditions} />
                </Row>
                <Row label="Order by picking method">
                  {d.orderBy.map((o) => `${label(PICKING_METHOD_OPTIONS, o.field)} (${o.dir})`).join(' → ') ||
                    'Walking path'}
                </Row>
                <Row label="Group by">
                  {(d.groupBy ?? []).map((g) => label(GROUPING_OPTIONS, g)).join(' → ') || 'None'}
                </Row>
              </>
            ) : null}
            {d.operationType === 'Count' ? (
              <>
                <Row label="Settings">
                  {Object.entries(s.count)
                    .filter(([, v]) => v)
                    .map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase())
                    .join(', ') || 'Defaults'}
                </Row>
                <Row label="Location conditions">
                  <Chips list={d.locationConditions} />
                </Row>
                <Row label="Order by count method">
                  {d.orderBy.map((o) => `${label(COUNT_METHOD_OPTIONS, o.field)} (${o.dir})`).join(' → ') ||
                    'Walking path'}
                </Row>
                <Row label="SKU conditions">
                  <Chips list={d.skuConditions} />
                </Row>
              </>
            ) : null}
            {d.operationType === 'Replenishment' ? (
              <>
                <Row label="Method · flow · type">
                  {s.replenishment.algorithmMethod} · {s.replenishment.flow} · {s.replenishment.type}
                </Row>
                <Row label="Destination locations">
                  <Chips list={d.destinationLocationConditions} />
                </Row>
                <Row label="Source locations">
                  <Chips list={d.sourceLocationConditions} />
                </Row>
                <Row label="LP conditions">
                  <Chips list={d.lpConditions} />
                </Row>
                <Row label="Product conditions">
                  <Chips list={d.productConditions} />
                </Row>
              </>
            ) : null}
            {d.operationType === 'Work Order' ? (
              <>
                <Row label="Picking & kitting">
                  <YesNoPill value={s.workOrder.pickingAndKitting} />
                </Row>
                <Row label="Batch size">
                  {s.batch.min} – {s.batch.max}
                </Row>
                <Row label="Conditions">
                  <Chips list={d.productConditions} />
                </Row>
              </>
            ) : null}
          </dl>
        </div>
      )}
    </Drawer>
  );
}
