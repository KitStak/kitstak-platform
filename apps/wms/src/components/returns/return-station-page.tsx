'use client';

/**
 * Return Station (`/return-station`, M04 §3). Left: Receiving Warehouse, Return Station
 * (Returns-area locations, scannable) and Return Target (Location or LP). Center: Return
 * With RMA / Return Manually, disabled with a reason until a station is chosen. Right:
 * user card and today's KPIs. Choices are remembered per user. `?rma=` jumps straight
 * into receiving that RMA.
 */
import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ClipboardList,
  Hand,
  ListChecks,
  MapPin,
  PackageCheck,
  ScanLine,
  Undo2,
  Warehouse,
} from 'lucide-react';
import { useStationMemory } from '@/components/packing/station-memory';
import { PageHeader } from '@/components/layout/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StickyFooterToastOffset } from '@/components/packing/toast-offset';
import { Select } from '@/components/ui/select';
import { StatTile } from '@/components/ui/stat-tile';
import { DisabledReason } from '@/components/ui/tooltip';
import { apiRequest } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import {
  clearInflightReceive,
  readInflightReceive,
  ReturnManually,
  ReturnWithRma,
  type InflightReceive,
  type StationContext,
} from './return-receive-flow';
import { roleLabel, useHydratedCan, useHydratedMe } from './returns-client';
import { defaultPick, pickStation, stationStartReason } from './return-station-model';
import { ReturnRulesCard } from './return-rules-card';
import { ExpectedReturns } from './expected-returns';

interface Option {
  readonly id: string;
  readonly code: string;
  readonly kind: 'location' | 'lp';
  readonly detail: string | null;
  readonly countLockPlan?: string | null;
  readonly lockReason?: string | null;
}
interface Kpis {
  readonly returnedOrdersToday: number;
  readonly returnedProductsToday: number;
  readonly openReturns: number;
}

interface Memory {
  readonly warehouseId: string | null;
  readonly stationId: string | null;
  readonly targetKind: 'location' | 'lp';
  readonly targetId: string | null;
  readonly targetCode: string | null;
}

const START: Memory = {
  warehouseId: null,
  stationId: null,
  targetKind: 'location',
  targetId: null,
  targetCode: null,
};

function BigAction({
  icon: Icon,
  title,
  description,
  disabledReason,
  onClick,
}: {
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly title: string;
  readonly description: string;
  readonly disabledReason: string | null;
  readonly onClick: () => void;
}) {
  const reasonId = React.useId();
  return (
    <DisabledReason reason={disabledReason}>
      <button
        type="button"
        disabled={Boolean(disabledReason)}
        onClick={onClick}
        title={disabledReason ?? undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        className={cn(
          'group flex w-full items-center gap-4 rounded-xl border border-border bg-surface p-5 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          disabledReason
            ? 'cursor-not-allowed opacity-55'
            : 'hover:-translate-y-0.5 hover:border-primary hover:shadow-md',
        )}
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-white">
          <Icon className="h-6 w-6" />
        </span>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-foreground">{title}</span>
          <span className="block text-xs text-secondary">{description}</span>
          {disabledReason ? (
            <span id={reasonId} className="mt-1 block text-2xs font-medium text-warning">
              {disabledReason}
            </span>
          ) : null}
        </span>
      </button>
    </DisabledReason>
  );
}

export function ReturnStationPage() {
  const me = { data: useHydratedMe() };
  const params = useSearchParams();
  const rmaParam = params.get('rma');
  const user = me.data?.data.user;
  const warehouses = me.data?.data.contextOptions.warehouses ?? [];
  const [mem, setMem, ready] = useStationMemory<Memory>('returns', START);
  const [mode, setMode] = React.useState<'home' | 'rma' | 'manual'>('home');
  /** A code found in another warehouse: re-run after switching warehouse (and its station). */
  const [pendingCode, setPendingCode] = React.useState<string | null>(null);

  // "Receive at station" on an RMA passes its warehouse so the lookup runs in the right one.
  // Applied once (after the remembered choice loads); the user can still switch afterwards.
  const whParam = params.get('warehouseId');
  const whApplied = React.useRef(false);
  React.useEffect(() => {
    if (whApplied.current || !ready || !whParam || !warehouses.some((w) => w.id === whParam)) return;
    whApplied.current = true;
    if (mem.warehouseId !== whParam)
      setMem({ warehouseId: whParam, stationId: null, targetId: null, targetCode: null });
  }, [ready, whParam, warehouses, mem.warehouseId, setMem]);
  const meLoading = !me.data || !ready;
  // Remembered → header context → the user's default warehouse → the only / first one.
  const warehouseId = meLoading
    ? null
    : (defaultPick(
        warehouses,
        mem.warehouseId,
        me.data?.data.context.warehouseId,
        (me.data?.data.preferences as { readonly defaultWarehouseId?: string } | undefined)
          ?.defaultWarehouseId,
      )?.id ?? null);
  const stations = useApiQuery<readonly Option[]>(
    ['returns', 'stations', warehouseId ?? ''],
    warehouseId ? '/api/returns/stations' : null,
    { query: warehouseId ? { warehouseId } : undefined },
  );
  const kpis = useApiQuery<Kpis>(
    ['returns', 'kpis', warehouseId ?? ''],
    warehouseId ? '/api/returns/kpis' : null,
    { query: warehouseId ? { warehouseId } : undefined, refetchInterval: 60_000 },
  );
  const stationList = stations.data?.data ?? [];
  // Remembered station, else the first Returns-area station (Logiwa preselects one). A count-locked
  // station is never picked while an unlocked one exists: its receive could not commit.
  const remembered = mem.stationId ? (stationList.find((s) => s.id === mem.stationId) ?? null) : null;
  const station = pickStation(stationList, mem.stationId);
  const skippedLocked = remembered?.countLockPlan && station?.id !== remembered.id ? remembered : null;

  const autoRma = React.useRef(false);
  React.useEffect(() => {
    if (rmaParam && station && !autoRma.current) {
      autoRma.current = true;
      setMode('rma');
    }
  }, [rmaParam, station]);

  const targetKind = mem.targetKind;
  const loadTargets = async (q: string, signal: AbortSignal) => {
    if (!warehouseId) return [];
    const { data } = await apiRequest<readonly Option[]>('/api/returns/targets', {
      query: { warehouseId, kind: targetKind, q },
      signal,
    });
    return data.map((o) => ({
      value: o.id,
      label: o.code,
      description: o.countLockPlan
        ? `Locked by ${o.countLockPlan}${o.detail ? ` · ${o.detail}` : ''}`
        : (o.detail ?? undefined),
      disabled: Boolean(o.countLockPlan),
    }));
  };

  const receivePerm = useHydratedCan('inventory.return_station.receive_return');
  const noStation = meLoading
    ? 'Loading your station setup…'
    : stationStartReason({
        permLoading: receivePerm.isLoading,
        canReceive: receivePerm.allowed,
        warehouseId,
        stationId: station?.id ?? null,
        stationsLoading: stations.isPending && Boolean(warehouseId),
        lockReason: station?.lockReason ?? null,
      });
  const ctx: StationContext | null =
    warehouseId && station
      ? {
          warehouseId,
          stationId: station.id,
          stationCode: station.code,
          targetLocationId: mem.targetKind === 'location' ? mem.targetId : null,
          targetLpId: mem.targetKind === 'lp' ? mem.targetId : null,
          targetCode: mem.targetId ? mem.targetCode : null,
        }
      : null;

  const k = kpis.data?.data;
  // A receive interrupted by a reload / closed tab: ask the operator to check that RMA.
  const [inflight, setInflight] = React.useState<InflightReceive | null>(null);
  React.useEffect(() => {
    setInflight(readInflightReceive());
  }, []);
  const exit = () => {
    setMode('home');
    void kpis.refetch();
  };

  return (
    <div className="pb-8">
      {mode !== 'home' ? <StickyFooterToastOffset /> : null}
      <PageHeader
        title="Return Station"
        breadcrumbs={[{ label: 'Fulfillment' }, { label: 'Outbound' }, { label: 'Return Station' }]}
        actions={
          <Link href="/orders/returns" className={buttonVariants({ variant: 'secondary' })}>
            <ListChecks className="h-3.5 w-3.5" aria-hidden />
            Return orders
          </Link>
        }
      />
      <div className="grid gap-4 px-6 pt-4 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
        <Card className="flex flex-col gap-4 self-start p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Warehouse className="h-4 w-4 text-secondary" aria-hidden />
            Station setup
          </h2>
          <div className="flex flex-col gap-1">
            <label htmlFor="rs-warehouse" className="text-xs font-semibold text-body">
              Receiving warehouse <span className="text-danger">*</span>
            </label>
            <Select
              id="rs-warehouse"
              value={warehouseId}
              disabled={mode !== 'home'}
              options={warehouses.map((w) => ({
                value: w.id,
                label: w.code && !w.name.startsWith(w.code) ? `${w.code} · ${w.name}` : w.name,
              }))}
              onChange={(id) =>
                setMem({ warehouseId: id, stationId: null, targetId: null, targetCode: null })
              }
              placeholder={meLoading ? 'Loading…' : 'Choose a warehouse'}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="rs-station"
              className="flex items-center justify-between text-xs font-semibold text-body"
            >
              <span>
                Return station <span className="text-danger">*</span>
              </span>
              <ScanLine className="h-3.5 w-3.5 text-faint" aria-label="Scannable" />
            </label>
            <Combobox
              id="rs-station"
              value={station?.id ?? null}
              disabled={!warehouseId || mode !== 'home'}
              options={stationList.map((s) => ({
                value: s.id,
                label: s.code,
                description: s.countLockPlan
                  ? `Locked by ${s.countLockPlan}${s.detail ? ` · ${s.detail}` : ''}`
                  : (s.detail ?? undefined),
                disabled: Boolean(s.countLockPlan),
              }))}
              onChange={(id) => setMem({ stationId: id })}
              placeholder={stations.isPending && warehouseId ? 'Loading…' : 'Scan or choose a station'}
              emptyText="No Returns-area location in this warehouse"
            />
            {warehouseId && !stations.isPending && stationList.length === 0 ? (
              <p className="text-2xs text-warning">
                This warehouse has no Returns-area location. Add one in Locations.
              </p>
            ) : null}
            {skippedLocked ? (
              <p className="text-2xs text-warning" data-testid="rs-station-lock-note">
                {skippedLocked.code} is locked by count plan {skippedLocked.countLockPlan}, so {station?.code}{' '}
                is used.
              </p>
            ) : null}
            {station?.lockReason ? (
              <p className="text-2xs font-medium text-danger" data-testid="rs-station-locked">
                {station.lockReason}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-body">Return target</span>
            <SegmentedControl
              size="sm"
              ariaLabel="Return target type"
              className="flex w-full [&>*]:flex-1"
              value={mem.targetKind}
              onChange={(v) => setMem({ targetKind: v, targetId: null, targetCode: null })}
              options={[
                { value: 'location', label: 'Location' },
                { value: 'lp', label: 'LP' },
              ]}
            />
            <Combobox
              key={`${warehouseId}-${mem.targetKind}`}
              value={mem.targetId}
              disabled={!warehouseId}
              loadOptions={loadTargets}
              minChars={0}
              clearable
              selectedOptions={
                mem.targetId && mem.targetCode ? [{ value: mem.targetId, label: mem.targetCode }] : []
              }
              onChange={(id, opt) => setMem({ targetId: id, targetCode: opt?.label ?? null })}
              aria-label="Return target"
              placeholder={mem.targetKind === 'lp' ? 'Scan or search an LP' : 'Scan or search a location'}
            />
            <p className="text-2xs text-secondary">
              Restocked and damaged units go here. Empty = the station itself.
            </p>
          </div>
        </Card>

        <div className="min-w-0">
          {mode === 'home' || !ctx ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Start returning</h2>
              {inflight ? (
                <Callout
                  variant="attention"
                  title={`Receiving ${inflight.rmaCode} was interrupted`}
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        clearInflightReceive();
                        setInflight(null);
                      }}
                    >
                      Dismiss
                    </Button>
                  }
                >
                  The page closed before the server confirmed it.{' '}
                  <Link
                    href={`/orders/returns/${inflight.returnOrderId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    Open the RMA
                  </Link>{' '}
                  to check what was received, then scan it again for anything missing.
                </Callout>
              ) : null}
              <BigAction
                icon={ClipboardList}
                title="Return with RMA"
                description="Scan the RMA, order code or return tracking number and receive its lines."
                disabledReason={noStation}
                onClick={() => setMode('rma')}
              />
              <BigAction
                icon={Hand}
                title="Return manually"
                description="No RMA in the box? Pick the client, scan the products and a Manual RMA is created."
                disabledReason={noStation}
                onClick={() => setMode('manual')}
              />
              {ctx ? (
                <p className="flex items-center gap-1.5 text-xs text-secondary">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  Receiving at <strong>{ctx.stationCode}</strong>
                  {ctx.targetCode ? (
                    <>
                      {' '}
                      into <strong>{ctx.targetCode}</strong>
                    </>
                  ) : (
                    ' (station location)'
                  )}
                </p>
              ) : null}
              {warehouseId ? (
                <ExpectedReturns
                  warehouseId={warehouseId}
                  disabledReason={noStation}
                  onReceive={(code) => {
                    setPendingCode(code);
                    setMode('rma');
                  }}
                />
              ) : null}
            </div>
          ) : mode === 'rma' ? (
            <ReturnWithRma
              key={ctx.warehouseId}
              station={ctx}
              initialCode={pendingCode ?? rmaParam}
              onExit={() => {
                setPendingCode(null);
                exit();
              }}
              onSwitchWarehouse={(wid, code) => {
                setPendingCode(code);
                setMem({ warehouseId: wid, stationId: null, targetId: null, targetCode: null });
              }}
            />
          ) : (
            <ReturnManually station={ctx} onExit={exit} />
          )}
        </div>

        <div className="flex flex-col gap-3 self-start">
          <Card
            className="flex items-center gap-3 p-4"
            aria-busy={meLoading || undefined}
            data-testid="return-station-user"
          >
            {meLoading || !user ? (
              <>
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </>
            ) : (
              <>
                <Avatar name={user.name ?? user.email ?? 'User'} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{user.name ?? user.email}</p>
                  <p className="truncate text-xs text-secondary">
                    {roleLabel(user.role) ? (
                      <span className="font-medium text-body">{roleLabel(user.role)} · </span>
                    ) : null}
                    {user.email}
                  </p>
                  <p className="text-2xs text-secondary">
                    {station
                      ? `At ${station.code}`
                      : stations.isPending && warehouseId
                        ? 'Loading stations…'
                        : 'No station chosen'}
                  </p>
                </div>
              </>
            )}
          </Card>
          <StatTile
            label="Returned orders today"
            value={k?.returnedOrdersToday ?? 'None'}
            icon={Undo2}
            loading={meLoading || (kpis.isPending && Boolean(warehouseId))}
            tone="primary"
            info="RMAs you received at least one unit of today."
          />
          <StatTile
            label="Returned products today"
            value={k?.returnedProductsToday ?? 'None'}
            icon={PackageCheck}
            loading={meLoading || (kpis.isPending && Boolean(warehouseId))}
            tone="success"
            info="Units you received today."
          />
          <StatTile
            label="Open RMAs"
            value={k?.openReturns ?? 'None'}
            icon={ClipboardList}
            loading={meLoading || (kpis.isPending && Boolean(warehouseId))}
            tone="warning"
            href="/orders/returns?f.status=in%3APending%2CIn%20Transit%2CStarted"
            info="Counts RMAs (not lines): pending, in transit or started in this warehouse. The Return Orders status pills count lines."
          />
          <ReturnRulesCard stationCode={station?.code ?? null} targetCode={mem.targetCode ?? null} />
        </div>
      </div>
    </div>
  );
}
