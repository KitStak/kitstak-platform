"use client";

/**
 * Return Station (`/return-station`, M04 §3). Left: Receiving Warehouse, Return Station
 * (Returns-area locations, scannable) and Return Target (Location or LP). Center: Return
 * With RMA / Return Manually, disabled with a reason until a station is chosen. Right:
 * user card and today's KPIs. Choices are remembered per user. `?rma=` jumps straight
 * into receiving that RMA.
 */
import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ClipboardList, Hand, MapPin, PackageCheck, ScanLine, Undo2, Warehouse } from "lucide-react";
import { useStationMemory } from "@/components/packing/station-memory";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { StatTile } from "@/components/ui/stat-tile";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { ReturnManually, ReturnWithRma, type StationContext } from "./return-receive-flow";
import { useHydratedCan, useHydratedMe } from "./returns-client";

interface Option { readonly id: string; readonly code: string; readonly kind: "location" | "lp"; readonly detail: string | null }
interface Kpis { readonly returnedOrdersToday: number; readonly returnedProductsToday: number; readonly openReturns: number }

interface Memory {
  readonly warehouseId: string | null;
  readonly stationId: string | null;
  readonly targetKind: "location" | "lp";
  readonly targetId: string | null;
  readonly targetCode: string | null;
}

const START: Memory = { warehouseId: null, stationId: null, targetKind: "location", targetId: null, targetCode: null };

function BigAction({ icon: Icon, title, description, disabledReason, onClick }: { readonly icon: React.ComponentType<{ className?: string }>; readonly title: string; readonly description: string; readonly disabledReason: string | null; readonly onClick: () => void }) {
  return (
    <DisabledReason reason={disabledReason}>
      <button type="button" disabled={Boolean(disabledReason)} onClick={onClick}
        className={cn("group flex w-full items-center gap-4 rounded-xl border border-border bg-surface p-5 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          disabledReason ? "cursor-not-allowed opacity-55" : "hover:-translate-y-0.5 hover:border-primary hover:shadow-md")}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-white"><Icon className="h-6 w-6" /></span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-foreground">{title}</span>
          <span className="block text-[12px] text-secondary">{description}</span>
        </span>
      </button>
    </DisabledReason>
  );
}

export function ReturnStationPage() {
  const me = { data: useHydratedMe() };
  const params = useSearchParams();
  const rmaParam = params.get("rma");
  const user = me.data?.data.user;
  const warehouses = me.data?.data.contextOptions.warehouses ?? [];
  const [mem, setMem, ready] = useStationMemory<Memory>("returns", START);
  const [mode, setMode] = React.useState<"home" | "rma" | "manual">("home");

  const warehouseId = mem.warehouseId && warehouses.some((w) => w.id === mem.warehouseId) ? mem.warehouseId : warehouses.length === 1 ? warehouses[0]?.id ?? null : me.data?.data.context.warehouseId ?? null;
  const stations = useApiQuery<readonly Option[]>(["returns", "stations", warehouseId ?? ""], warehouseId ? "/api/returns/stations" : null, { query: warehouseId ? { warehouseId } : undefined });
  const kpis = useApiQuery<Kpis>(["returns", "kpis", warehouseId ?? ""], warehouseId ? "/api/returns/kpis" : null, { query: warehouseId ? { warehouseId } : undefined, refetchInterval: 60_000 });
  const stationList = stations.data?.data ?? [];
  const station = stationList.find((s) => s.id === mem.stationId) ?? null;

  const autoRma = React.useRef(false);
  React.useEffect(() => {
    if (rmaParam && station && !autoRma.current) { autoRma.current = true; setMode("rma"); }
  }, [rmaParam, station]);

  const targetKind = mem.targetKind;
  const loadTargets = async (q: string, signal: AbortSignal) => {
    if (!warehouseId) return [];
    const { data } = await apiRequest<readonly Option[]>("/api/returns/targets", { query: { warehouseId, kind: targetKind, q }, signal });
    return data.map((o) => ({ value: o.id, label: o.code, description: o.detail ?? undefined }));
  };

  const canReceive = useHydratedCan("fulfillment.task_details.execute_task").allowed;
  const noStation = !canReceive ? "You need the Execute Task permission to receive returns" : !warehouseId ? "Choose the receiving warehouse first" : !station ? "Choose a return station first" : null;
  const ctx: StationContext | null = warehouseId && station ? {
    warehouseId, stationId: station.id, stationCode: station.code,
    targetLocationId: mem.targetKind === "location" ? mem.targetId : null, targetLpId: mem.targetKind === "lp" ? mem.targetId : null,
    targetCode: mem.targetId ? mem.targetCode : null,
  } : null;

  const k = kpis.data?.data;
  const exit = () => { setMode("home"); void kpis.refetch(); };

  return (
    <div className="pb-8">
      <PageHeader title="Return Station" helper="Receive customer returns against an RMA, or manually when there is none." actions={<Link href="/orders/returns" className="text-[13px] font-medium text-primary hover:underline">Return orders</Link>} />
      <div className="grid gap-4 px-6 pt-4 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
        <Card className="flex flex-col gap-4 self-start p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold"><Warehouse className="h-4 w-4 text-secondary" aria-hidden />Station setup</h2>
          <div className="flex flex-col gap-1">
            <label htmlFor="rs-warehouse" className="text-[12px] font-semibold text-body">Receiving warehouse <span className="text-danger">*</span></label>
            <Select id="rs-warehouse" value={warehouseId} disabled={mode !== "home"} options={warehouses.map((w) => ({ value: w.id, label: w.code && !w.name.startsWith(w.code) ? `${w.code} · ${w.name}` : w.name }))}
              onChange={(id) => setMem({ warehouseId: id, stationId: null, targetId: null, targetCode: null })} placeholder="Choose a warehouse" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="rs-station" className="flex items-center justify-between text-[12px] font-semibold text-body">
              <span>Return station <span className="text-danger">*</span></span>
              <ScanLine className="h-3.5 w-3.5 text-faint" aria-label="Scannable" />
            </label>
            <Combobox id="rs-station" value={mem.stationId} disabled={!warehouseId || mode !== "home"}
              options={stationList.map((s) => ({ value: s.id, label: s.code, description: s.detail ?? undefined }))}
              onChange={(id) => setMem({ stationId: id })} placeholder={stations.isPending && warehouseId ? "Loading…" : "Scan or choose a station"} emptyText="No Returns-area location in this warehouse" />
            {warehouseId && !stations.isPending && stationList.length === 0 ? <p className="text-[11px] text-warning">This warehouse has no Returns-area location. Add one in Locations.</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-body">Return target</span>
            <SegmentedControl size="sm" ariaLabel="Return target type" value={mem.targetKind} disabled={mode !== "home"} onChange={(v) => setMem({ targetKind: v, targetId: null, targetCode: null })}
              options={[{ value: "location", label: "Location" }, { value: "lp", label: "LP" }]} />
            <Combobox key={`${warehouseId}-${mem.targetKind}`} value={mem.targetId} disabled={!warehouseId || mode !== "home"} loadOptions={loadTargets} minChars={0} clearable
              selectedOptions={mem.targetId && mem.targetCode ? [{ value: mem.targetId, label: mem.targetCode }] : []}
              onChange={(id, opt) => setMem({ targetId: id, targetCode: opt?.label ?? null })} aria-label="Return target"
              placeholder={mem.targetKind === "lp" ? "Scan or search an LP" : "Scan or search a location"} />
            <p className="text-[11px] text-secondary">Restocked and damaged units go here. Empty = the station itself.</p>
          </div>
        </Card>

        <div className="min-w-0">
          {mode === "home" || !ctx ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-[15px] font-semibold">Start returning</h2>
              <BigAction icon={ClipboardList} title="Return with RMA" description="Scan the RMA, order code or return tracking number and receive its lines." disabledReason={noStation} onClick={() => setMode("rma")} />
              <BigAction icon={Hand} title="Return manually" description="No RMA in the box? Pick the client, scan the products and a Manual RMA is created." disabledReason={noStation} onClick={() => setMode("manual")} />
              {ctx ? (
                <p className="flex items-center gap-1.5 text-[12px] text-secondary"><MapPin className="h-3.5 w-3.5" aria-hidden />Receiving at <strong>{ctx.stationCode}</strong>{ctx.targetCode ? <> into <strong>{ctx.targetCode}</strong></> : " (station location)"}</p>
              ) : null}
            </div>
          ) : mode === "rma" ? (
            <ReturnWithRma station={ctx} initialCode={rmaParam} onExit={exit} />
          ) : (
            <ReturnManually station={ctx} onExit={exit} />
          )}
        </div>

        <div className="flex flex-col gap-3 self-start">
          <Card className="flex items-center gap-3 p-4">
            <Avatar name={user?.name ?? user?.email ?? "?"} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user?.name ?? "—"}</p>
              <p className="truncate text-[12px] text-secondary">{user?.email}</p>
              <p className="text-[11px] text-secondary">{station ? `At ${station.code}` : "No station chosen"}</p>
            </div>
          </Card>
          <StatTile label="Returned orders today" value={k?.returnedOrdersToday ?? "—"} icon={Undo2} loading={kpis.isPending && Boolean(warehouseId) && ready} tone="primary" info="RMAs you received at least one unit of today." />
          <StatTile label="Returned products today" value={k?.returnedProductsToday ?? "—"} icon={PackageCheck} loading={kpis.isPending && Boolean(warehouseId) && ready} tone="success" info="Units you received today." />
          <StatTile label="Open returns" value={k?.openReturns ?? "—"} icon={ClipboardList} loading={kpis.isPending && Boolean(warehouseId) && ready} tone="warning"
            href="/orders/returns?f.status=in%3APending%2CIn%20Transit%2CStarted" info="Pending, in transit or started RMAs in this warehouse." />
        </div>
      </div>
    </div>
  );
}
