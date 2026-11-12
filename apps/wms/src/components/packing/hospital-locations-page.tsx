'use client';

/**
 * Hospital locations (`/packing-station/hospitals`). The places Report Issue sends picked stock:
 * explicitly designated locations only (Location Group "Hospital", or a HOSP* code; never the
 * Return Station restock bins). Each shows its units, SKUs and the pack-short
 * orders the stock is held for. Free stock can be moved back to a Storage / Picking location;
 * held stock links to the order so the pack short is resolved there.
 */
import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Hospital, PackageOpen } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import { apiRequest } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { useStationMemory } from './station-memory';
import { useSearchParams } from 'next/navigation';
import {
  moveBackDisabledReason,
  pickHospitalWarehouse,
  type HospitalWarehouseSummary,
} from './hospital-model';
import { errorText, useHydratedCan, useHydratedMe } from '@/components/returns/returns-client';

interface StockRow {
  readonly inventoryId: string;
  readonly sku: string;
  readonly productName: string;
  readonly clientName: string | null;
  readonly onHand: number;
  readonly allocated: number;
  readonly free: number;
  readonly lotNumber: string | null;
  readonly status: string;
  readonly damageReason: string | null;
  readonly orders: readonly {
    readonly id: string;
    readonly code: string;
    readonly packShortStatus: string | null;
  }[];
}
interface HospitalLoc {
  readonly id: string;
  readonly code: string;
  readonly areaType: string | null;
  readonly locationType: string | null;
  readonly designation?: 'group' | 'code';
  readonly isDefault: boolean;
  readonly units: number;
  readonly skus: number;
  readonly heldForOrders: number;
  readonly stock: readonly StockRow[];
}
interface Target {
  readonly id: string;
  readonly code: string;
  readonly detail: string;
  readonly areaType?: string;
}
interface Memory {
  readonly warehouseId: string | null;
  readonly stationId: string | null;
}

function MoveBackDialog({
  row,
  from,
  warehouseId,
  onClose,
  onDone,
}: {
  readonly row: StockRow;
  readonly from: string;
  readonly warehouseId: string;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [qty, setQty] = React.useState<number | null>(row.free);
  const [to, setTo] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const damaged = Boolean(row.damageReason);
  const targets = useApiQuery<readonly Target[]>(
    ['packing', 'hospital-targets', warehouseId],
    '/api/packing/hospitals/targets',
    { query: { warehouseId } },
  );
  const submit = async () => {
    if (!to || !qty) {
      setError(!to ? 'Choose a location' : 'Enter a quantity');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiRequest<{ moved: number; toCode: string }>(
        '/api/packing/hospitals/move-back',
        {
          method: 'POST',
          body: {
            inventoryId: row.inventoryId,
            qty,
            toLocationId: to,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        },
      );
      toast.success('Moved back', `${data.moved} × ${row.sku} from ${from} to ${data.toCode}`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader
          title={`Move ${row.sku} back`}
          description={`From hospital ${from}. ${row.free} of ${row.onHand} units are free to move.`}
        />
        <DialogBody className="grid gap-3">
          <label className="grid gap-1 text-xs font-medium text-body">
            Quantity
            <NumberInput
              value={qty}
              min={1}
              max={row.free}
              decimals={0}
              onChange={setQty}
              aria-label="Quantity to move"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-body" htmlFor="hosp-target">
            Move to
            <Select
              id="hosp-target"
              value={to}
              onChange={setTo}
              placeholder={targets.isPending ? 'Loading locations…' : 'Choose a storage or picking location'}
              options={(targets.data?.data ?? []).map((t) => {
                const pickBlocked = damaged && t.areaType === 'Picking';
                return {
                  value: t.id,
                  label: t.code,
                  description: pickBlocked ? `${t.detail} · not for damaged stock` : t.detail,
                  textValue: `${t.code} ${t.detail}`,
                  disabled: pickBlocked,
                };
              })}
            />
          </label>
          {damaged ? (
            <Callout variant="attention" title="Damaged stock">
              Marked damaged ({row.damageReason}). It can go to a Storage location for review, not straight to
              a Picking location.
            </Callout>
          ) : null}
          {targets.isError ? (
            <Callout
              variant="error"
              title="Could not load locations"
              action={
                <Button size="sm" onClick={() => void targets.refetch()}>
                  Retry
                </Button>
              }
            >
              {targets.error.message}
            </Callout>
          ) : null}
          <label className="grid gap-1 text-xs font-medium text-body">
            Note <span className="font-normal text-secondary">(optional, saved on the movement)</span>
            <Input
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Pack short resolved, item OK"
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            Move back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HospitalLocationsPage() {
  const me = useHydratedMe();
  const warehouses = me?.data.contextOptions.warehouses ?? [];
  const params = useSearchParams();
  const [mem, , memReady] = useStationMemory<Memory>('packing', { warehouseId: null, stationId: null });
  const [rmem, , rmemReady] = useStationMemory<Memory>('returns', { warehouseId: null, stationId: null });
  const [picked, setPicked] = React.useState<string | null>(null);
  const summary = useApiQuery<readonly HospitalWarehouseSummary[]>(
    ['packing', 'hospitals', 'warehouses'],
    me ? '/api/packing/hospitals/warehouses' : null,
    { staleTime: 30_000 },
  );
  const ready = Boolean(me) && memReady && rmemReady && !summary.isPending;
  const pref = (me?.data.preferences as { readonly defaultWarehouseId?: string } | undefined)
    ?.defaultWarehouseId;
  // Same order as the station dashboards; a warehouse with hospitals wins over one without.
  const warehouseId =
    picked ??
    (ready
      ? pickHospitalWarehouse(
          warehouses,
          [params.get('warehouseId'), mem.warehouseId, rmem.warehouseId, me?.data.context.warehouseId, pref],
          summary.data?.data ?? null,
        )
      : null);
  const elsewhere = (summary.data?.data ?? []).filter(
    (s) => s.warehouseId !== warehouseId && s.hospitals > 0,
  );
  const whLabel = (id: string) => {
    const w = warehouses.find((x) => x.id === id);
    return w?.code ?? w?.name ?? id;
  };
  const canMove = useHydratedCan('fulfillment.task_details.execute_task').allowed;
  const qc = useQueryClient();
  const q = useApiQuery<readonly HospitalLoc[]>(
    ['packing', 'hospitals', 'stock', warehouseId ?? ''],
    warehouseId ? '/api/packing/hospitals/stock' : null,
    { query: warehouseId ? { warehouseId } : undefined },
  );
  const [moving, setMoving] = React.useState<{ row: StockRow; from: string } | null>(null);
  const list = q.data?.data ?? [];
  const units = list.reduce((s, h) => s + h.units, 0);
  const held = new Set(list.flatMap((h) => h.stock.flatMap((s) => s.orders.map((o) => o.id)))).size;
  return (
    <div className="pb-8">
      <PageHeader
        title="Hospital locations"
        breadcrumbs={[
          { label: 'Fulfillment' },
          { label: 'Outbound' },
          { label: 'Packing Station', href: '/packing-station' },
          { label: 'Hospital locations' },
        ]}
        helper="Where Report Issue puts picked stock. Resolve pack shorts in Orders, or move free stock back to storage."
        actions={
          <div className="w-[260px]">
            <Select
              aria-label="Warehouse"
              value={warehouseId}
              onChange={setPicked}
              placeholder="Choose a warehouse"
              options={warehouses.map((w) => ({ value: w.id, label: w.code ?? w.name }))}
            />
          </div>
        }
      />
      <div className="grid gap-4 px-6 pt-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Hospital locations" value={!warehouseId || q.isPending ? '…' : list.length} />
          <StatTile label="Units in hospitals" value={!warehouseId || q.isPending ? '…' : units} />
          <StatTile label="Pack-short orders held" value={!warehouseId || q.isPending ? '…' : held} />
        </div>
        {q.isError ? (
          <Callout
            variant="error"
            title="Could not load hospital locations"
            action={
              <Button size="sm" onClick={() => void q.refetch()}>
                Retry
              </Button>
            }
          >
            {q.error.message}
          </Callout>
        ) : null}
        {q.isPending && warehouseId ? <Skeleton className="h-40 w-full" /> : null}
        {!q.isPending && list.length === 0 && !q.isError && elsewhere.length > 0 ? (
          <EmptyState
            icon={Hospital}
            title={`No hospital location in ${warehouseId ? whLabel(warehouseId) : 'this warehouse'}`}
            description={`Hospital locations exist in ${elsewhere.map((s) => `${whLabel(s.warehouseId)} (${s.hospitals}, ${s.units} units)`).join(', ')}. Switch warehouse to see them, or add one here in Facility › Locations.`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {elsewhere.slice(0, 3).map((s) => (
                  <Button
                    key={s.warehouseId}
                    size="sm"
                    variant="secondary"
                    onClick={() => setPicked(s.warehouseId)}
                  >
                    Show {whLabel(s.warehouseId)}
                  </Button>
                ))}
              </div>
            }
          />
        ) : null}
        {!q.isPending && list.length === 0 && !q.isError && elsewhere.length === 0 ? (
          <EmptyState
            icon={Hospital}
            title="No hospital location configured"
            description={
              'Report Issue needs a dedicated hospital location. In Facility › Locations, put a location in the "Hospital" location group, or code it HOSP… (e.g. HOSP-01). Return Station bins are never used as hospitals.'
            }
            action={
              <Link href="/locations" className="text-sm font-medium text-primary hover:underline">
                Go to Locations
              </Link>
            }
          />
        ) : null}
        {list.map((h) => (
          <Card key={h.id} className="overflow-hidden p-0" data-testid={`hospital-${h.code}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-strong">
                <Hospital className="h-4 w-4 text-secondary" aria-hidden />
                {h.code}
                {h.isDefault ? (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-semibold text-primary">
                    Default for Report Issue
                  </span>
                ) : null}
              </h2>
              <span className="text-xs text-secondary">
                {h.designation === 'group' ? 'Hospital group' : 'HOSP code'} ·{' '}
                {[h.areaType, h.locationType].filter(Boolean).join(' · ')} · {h.units} units · {h.skus} SKUs
                {h.heldForOrders
                  ? ` · ${h.heldForOrders} pack-short order${h.heldForOrders === 1 ? '' : 's'}`
                  : ''}
              </span>
            </div>
            {h.stock.length === 0 ? (
              <p className="flex items-center gap-2 px-4 py-3 text-sm text-secondary">
                <PackageOpen className="h-4 w-4" aria-hidden />
                Empty
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-border bg-surface-sunken/60 text-left text-xs text-secondary">
                    <tr>
                      <th className="px-4 py-2 font-medium">SKU</th>
                      <th className="px-2 py-2 font-medium">Client</th>
                      <th className="px-2 py-2 text-right font-medium">On hand</th>
                      <th className="px-2 py-2 text-right font-medium">Held</th>
                      <th className="px-2 py-2 text-right font-medium">Free</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Held for</th>
                      <th className="px-4 py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.stock.map((s) => (
                      <tr key={s.inventoryId} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">
                          <span className="font-medium text-strong">{s.sku}</span>
                          <span className="block truncate text-xs text-secondary" title={s.productName}>
                            {s.productName}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-secondary">{s.clientName ?? '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{s.onHand}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{s.allocated}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{s.free}</td>
                        <td className="px-2 py-2 text-secondary">
                          {s.damageReason ? `Damaged: ${s.damageReason}` : s.status}
                          {s.lotNumber ? ` · Lot ${s.lotNumber}` : ''}
                        </td>
                        <td className="px-2 py-2">
                          {s.orders.length ? (
                            s.orders.map((o) => (
                              <Link
                                key={o.id}
                                href={`/orders/${o.id}`}
                                className="mr-2 font-medium text-primary hover:underline"
                              >
                                {o.code}
                                {o.packShortStatus === 'Open' ? ' · Pack short' : ''}
                              </Link>
                            ))
                          ) : (
                            <span className="text-secondary">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {(() => {
                            const why = moveBackDisabledReason(s, canMove);
                            const held = s.free <= 0 && s.orders[0] ? s.orders[0] : null;
                            return (
                              <div className="flex flex-col items-end gap-1">
                                <DisabledReason reason={why}>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={Boolean(why)}
                                    aria-label={
                                      why ? `Move back ${s.sku} (unavailable: ${why})` : `Move back ${s.sku}`
                                    }
                                    onClick={() => setMoving({ row: s, from: h.code })}
                                  >
                                    <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                                    Move back
                                  </Button>
                                </DisabledReason>
                                {why && canMove ? (
                                  <span
                                    className="max-w-[220px] text-right text-2xs text-secondary"
                                    data-testid="move-back-reason"
                                  >
                                    {held ? (
                                      <>
                                        Held for{' '}
                                        <Link
                                          href={`/orders/${held.id}`}
                                          className="font-medium text-primary hover:underline"
                                        >
                                          {held.code}
                                        </Link>
                                        {held.packShortStatus === 'Open' ? ' (pack short)' : ''}. Resolve it
                                        first.
                                      </>
                                    ) : (
                                      why
                                    )}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>
      {moving && warehouseId ? (
        <MoveBackDialog
          row={moving.row}
          from={moving.from}
          warehouseId={warehouseId}
          onClose={() => setMoving(null)}
          onDone={() => void qc.invalidateQueries({ queryKey: ['packing', 'hospitals'] })}
        />
      ) : null}
    </div>
  );
}
