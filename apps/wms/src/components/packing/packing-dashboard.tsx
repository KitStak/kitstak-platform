"use client";

/**
 * Packing Station dashboard (`/packing-station`, M04 §1). Left: Warehouse* and Packing
 * Station* (Packing-area locations), remembered per user. Center: Start Packing with
 * Scan a Tote / Scan a Location / Scan a Putwall-Mobile Cart / List and Select Order.
 * Right: user card and live KPIs (orders and products packed today, orders to pack).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Boxes, ClipboardList, Grid3x3, ListChecks, MapPin, MessageSquareWarning, Package, PackageCheck, ShoppingBasket, Warehouse } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { StatTile } from "@/components/ui/stat-tile";
import { DisabledReason } from "@/components/ui/tooltip";
import { useShortcut } from "@/lib/keyboard";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { PackingHistoryCard } from "./packing-history";
import { useStationMemory } from "./station-memory";
import { defaultPick, pickStation } from "@/components/returns/return-station-model";
import { roleLabel, useHydratedMe } from "@/components/returns/returns-client";

interface Station { readonly id: string; readonly code: string; readonly warehouseId: string; readonly description: string | null; readonly countLockPlan?: string | null }
interface Kpis {
  readonly ordersPackedToday: number; readonly productsPackedToday: number; readonly ordersToPack: number;
  readonly packShortHeld?: number; readonly hospitalUnits?: number; readonly ordersWithWarnings?: number;
  readonly station?: { readonly id: string; readonly code: string; readonly ordersPackedToday: number; readonly productsPackedToday: number; readonly packers: number } | null;
}
interface Memory { readonly warehouseId: string | null; readonly stationId: string | null }

export const START_MODES = [
  { mode: "tote", key: "1", title: "Scan a tote", description: "Pack the orders picked into a tote", icon: ShoppingBasket },
  { mode: "location", key: "2", title: "Scan a location", description: "Pack orders staged at a location", icon: MapPin },
  { mode: "putwall", key: "3", title: "Scan a putwall / mobile cart", description: "Pack orders sorted into a putwall or cart", icon: Grid3x3 },
  { mode: "order", key: "4", title: "List and select order", description: "Find a ready-to-pack order and start", icon: ListChecks, list: true },
] as const;

export function PackingDashboard() {
  const router = useRouter();
  const me = { data: useHydratedMe() };
  const user = me.data?.data.user;
  const warehouses = me.data?.data.contextOptions.warehouses ?? [];
  const [mem, setMem, memReady] = useStationMemory<Memory>("packing", { warehouseId: null, stationId: null });
  const meLoading = !me.data || !memReady;
  // Remembered → header context → the user's default warehouse → the only / first one.
  const warehouseId = meLoading ? null : defaultPick(warehouses, mem.warehouseId, me.data?.data.context.warehouseId, (me.data?.data.preferences as { readonly defaultWarehouseId?: string } | undefined)?.defaultWarehouseId)?.id ?? null;
  const stations = useApiQuery<readonly Station[]>(["packing", "stations", warehouseId ?? ""], warehouseId ? "/api/packing/stations" : null, { query: warehouseId ? { warehouseId } : undefined });
  const list = stations.data?.data ?? [];
  // Remembered station, else the first packing station (Logiwa preselects one).
  // A count-locked station is skipped while an unlocked one exists (packing into it can't commit).
  const station = pickStation(list, mem.stationId);
  const kpiQuery = warehouseId ? { warehouseId, ...(station ? { stationId: station.id } : {}) } : undefined;
  const kpis = useApiQuery<Kpis>(["packing", "kpis", warehouseId ?? "", station?.id ?? ""], warehouseId ? "/api/packing/kpis" : null, { query: kpiQuery, refetchInterval: 30_000, refetchOnMount: "always", staleTime: 0 });
  const remembered = mem.stationId ? list.find((s) => s.id === mem.stationId) ?? null : null;
  const skippedLocked = remembered?.countLockPlan && station?.id !== remembered.id ? remembered : null;
  const lockReason = station?.countLockPlan ? `Station ${station.code} is locked by count plan ${station.countLockPlan}. Choose another station, or finish, update or cancel the count first.` : null;
  const reason = meLoading ? "Loading your warehouses…" : !warehouseId ? "Choose a warehouse first" : !station ? (stations.isPending ? "Loading packing stations…" : "Choose a packing station first") : lockReason;
  const k = kpis.data?.data;

  const go = (mode: string, listMode = false) => {
    if (!station) return;
    router.push(`/packing-station/${station.id}/${mode}${listMode ? "?list=1" : ""}`);
  };
  const sc = { enabled: Boolean(station), group: "Packing station" } as const;
  useShortcut("1", () => go("tote"), { ...sc, description: "Scan a tote" });
  useShortcut("2", () => go("location"), { ...sc, description: "Scan a location" });
  useShortcut("3", () => go("putwall"), { ...sc, description: "Scan a putwall / mobile cart" });
  useShortcut("4", () => go("order", true), { ...sc, description: "List and select order" });

  return (
    <div className="pb-8">
      <PageHeader title="Packing Station" breadcrumbs={[{ label: "Fulfillment" }, { label: "Outbound" }, { label: "Packing Station" }]} helper="Choose your station, then scan what you are packing from." actions={<span className="flex items-center gap-4"><Link href="/packing-station/hospitals" className="text-sm font-medium text-primary hover:underline">Hospital locations</Link><Link href="/orders?f.status=in%3AReady%20to%20Pack%2CPacking%20Started" className="text-sm font-medium text-primary hover:underline">Orders to pack</Link></span>} />
      <div className="grid gap-4 px-6 pt-4 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
        <Card className="flex flex-col gap-4 self-start p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Warehouse className="h-4 w-4 text-secondary" aria-hidden />Station setup</h2>
          <div className="flex flex-col gap-1">
            <label htmlFor="ps-warehouse" className="text-xs font-semibold text-body">Warehouse <span className="text-danger">*</span></label>
            <Select id="ps-warehouse" value={warehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.code && !w.name.startsWith(w.code) ? `${w.code} · ${w.name}` : w.name }))} onChange={(id) => setMem({ warehouseId: id, stationId: null })} placeholder={meLoading ? "Loading…" : "Choose a warehouse"} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ps-station" className="text-xs font-semibold text-body">Packing station <span className="text-danger">*</span></label>
            <Select id="ps-station" value={station?.id ?? null} disabled={!warehouseId} options={list.map((s) => ({ value: s.id, label: s.code, description: s.countLockPlan ? `Locked by ${s.countLockPlan}` : s.description && s.description !== s.code ? s.description : undefined, disabled: Boolean(s.countLockPlan) }))}
              onChange={(id) => setMem({ stationId: id })} placeholder={stations.isPending && warehouseId ? "Loading…" : "Choose a station"} />
            {warehouseId && !stations.isPending && list.length === 0 ? <p className="text-2xs text-warning">No Packing-area location in this warehouse. Add one in Locations.</p>
              : lockReason ? <p className="text-2xs font-medium text-danger" data-testid="ps-station-locked">{lockReason}</p>
              : skippedLocked ? <p className="text-2xs text-warning" data-testid="ps-station-lock-note">{skippedLocked.code} is locked by count plan {skippedLocked.countLockPlan}, so {station?.code} is used.</p>
              : <p className="text-2xs text-secondary">Remembered for your next visit.</p>}
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="text-base font-semibold">Start packing</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {START_MODES.map((m) => (
              <DisabledReason key={m.mode} reason={reason}>
                <button type="button" disabled={Boolean(reason)} title={reason ?? undefined} onClick={() => go(m.mode, "list" in m)}
                  className={cn("group relative flex min-h-[120px] w-full flex-col items-start gap-3 rounded-xl border border-border bg-surface p-5 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    reason ? "cursor-not-allowed opacity-55" : "hover:-translate-y-0.5 hover:border-primary hover:shadow-md")}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-white"><m.icon className="h-5 w-5" /></span>
                  <span>
                    <span className="block text-base font-semibold text-foreground">{m.title}</span>
                    <span className="block text-xs text-secondary">{m.description}</span>
                  </span>
                  <Kbd className="absolute right-4 top-4">{m.key}</Kbd>
                </button>
              </DisabledReason>
            ))}
          </div>
          <p className="text-xs text-secondary">Shortcuts on the pack screen: <Kbd>Enter</Kbd> submits a scan · <Kbd>F2</Kbd> closes the package · <Kbd>F9</Kbd> completes packing.</p>
          <PackingHistoryCard warehouseId={warehouseId} warehouseCode={warehouses.find((w) => w.id === warehouseId)?.code ?? ""} />
        </div>

        <div className="flex flex-col gap-3 self-start">
          <Card className="flex items-center gap-3 p-4">
            <Avatar name={user?.name ?? user?.email ?? "?"} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user?.name ?? "—"}</p>
              <p className="truncate text-xs text-secondary">{roleLabel(user?.role) ? <span className="font-medium text-body">{roleLabel(user?.role)} · </span> : null}{user?.email}</p>
              <p className="text-2xs text-secondary">{station ? `At ${station.code}` : "No station chosen"}</p>
            </div>
          </Card>
          <StatTile label="Orders packed today" value={k?.ordersPackedToday ?? "—"} icon={PackageCheck} tone="success" loading={kpis.isPending && Boolean(warehouseId)} info="Orders you completed packing today." />
          <StatTile label="Products packed today" value={k?.productsPackedToday ?? "—"} icon={Boxes} tone="primary" loading={kpis.isPending && Boolean(warehouseId)} info="Units you packed today." />
          <StatTile label="Total orders to be packed" value={k?.ordersToPack ?? "—"} icon={Package} tone="warning" loading={kpis.isPending && Boolean(warehouseId)}
            href="/orders?f.status=in%3AReady%20to%20Pack%2CPacking%20Started" info="Orders List and select would show: Ready to Pack or Packing Started, units left to pack, no open pack short." />
          <StatTile label="Pack-short orders held" value={k?.packShortHeld ?? "—"} icon={AlertTriangle} tone={k?.packShortHeld ? "danger" : "default"} loading={kpis.isPending && Boolean(warehouseId)}
            href="/packing-station/hospitals" info={`Orders with an open pack short: Report Issue moved their picked stock to a hospital location${k ? ` (${k.hospitalUnits ?? 0} unit${k.hospitalUnits === 1 ? "" : "s"} in hospitals now)` : ""}. Resolve the pack short on the order to pack it.`} />
          <StatTile label="Orders with packing warnings" value={k?.ordersWithWarnings ?? "—"} icon={MessageSquareWarning} tone={k?.ordersWithWarnings ? "warning" : "default"} loading={kpis.isPending && Boolean(warehouseId)}
            info="Orders to pack that carry a Packing Warning Type. The warning opens on the pack screen at its trigger and must be acknowledged." />
          <div data-testid="ps-station-kpis"><Card className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-body"><MapPin className="h-3.5 w-3.5 text-secondary" aria-hidden />{station ? `Station ${station.code} today` : "Station today"}</p>
            {station && k?.station ? (
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div><dt className="text-2xs text-secondary">Orders</dt><dd className="text-lg font-semibold tabular-nums">{k.station.ordersPackedToday}</dd></div>
                <div><dt className="text-2xs text-secondary">Units</dt><dd className="text-lg font-semibold tabular-nums">{k.station.productsPackedToday}</dd></div>
                <div><dt className="text-2xs text-secondary">Packers</dt><dd className="text-lg font-semibold tabular-nums">{k.station.packers}</dd></div>
              </dl>
            ) : <p className="text-xs text-secondary">{station ? (kpis.isPending ? "Loading…" : "No packing at this station yet today.") : meLoading || (stations.isPending && warehouseId) ? "Loading…" : "Choose a station to see its totals."}</p>}
            <p className="text-2xs text-secondary">Every packer at this station, since midnight.</p>
          </Card></div>
          <Link href="/shipments" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"><ClipboardList className="h-3.5 w-3.5" aria-hidden />Today&apos;s shipments</Link>
        </div>
      </div>
    </div>
  );
}
