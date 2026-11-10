"use client";

/**
 * Location detail (`/locations/[id]`, beyond Logiwa which only has an edit drawer):
 * attributes, current contents (buckets), capacities, open tasks, ledger history and a
 * live label preview, with Edit / Print label / Lock / Change log / Delete actions.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Boxes, ClipboardList, History, Lock, LockOpen, Pencil, Printer, ScrollText, Trash2 } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { useFormat } from "@/lib/format";
import { splitCamel } from "@/lib/grid-defs/facility/common";
import { LOCATION_RULES } from "@/lib/grid-defs/facility/locations";
import { cn } from "@/lib/utils";
import type { LocationDetail } from "@/server/repositories/locations";
import { PageHeader } from "@/components/layout/page-header";
import { Barcode } from "@/components/ui/barcode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { UnderlineTabs } from "@/components/ui/tabs";
import { DisabledReason } from "@/components/ui/tooltip";
import { ChangeLogDrawer } from "@/components/shared/change-log-drawer";
import { KvList } from "@/components/shared/kv-list";
import { PrintOptionsModal } from "@/components/shared/print-options-modal";
import { AvailabilityPill, Muted, NO_PERMISSION, toastBulk, useAction, usePagePerms, YesNo, type BulkResponse } from "@/components/facility/facility-shared";
import { LocationWizardDrawer } from "./location-wizard";

interface Contents {
  readonly buckets: readonly { id: string; sku: string; productName: string; clientName: string | null; lotNumber: string | null; expiryDate: string | null; status: string; packType: string; onHand: number; allocated: number; damaged: number; lpNumber: string | null; receivedAt: string }[];
  readonly tasks: readonly { id: string; taskNo: number; taskType: string; status: string; jobId: string; jobCode: string; sku: string | null; plannedQty: number; direction: "Source" | "Target" }[];
  readonly ledger: readonly { id: string; type: string; sku: string; qty: number; direction: "In" | "Out" | "Within"; at: string; source: string; note: string | null }[];
}

const TABS = ["contents", "capacity", "tasks", "ledger"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: string | null): v is Tab => v !== null && (TABS as readonly string[]).includes(v);

function Table({ head, children }: { readonly head: readonly (string | { label: string; right?: boolean })[]; readonly children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-surface-sunken text-[11px] uppercase tracking-wide text-secondary">
          <tr>{head.map((h) => { const c = typeof h === "string" ? { label: h } : h; return <th key={c.label} className={cn("whitespace-nowrap px-3 py-2 font-semibold", c.right ? "text-right" : "text-left")}>{c.label}</th>; })}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone }: { readonly label: string; readonly value: React.ReactNode; readonly tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3.5 py-2.5 shadow-xs">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={cn("mt-0.5 text-[20px] font-semibold tabular-nums tracking-tight text-foreground", tone === "warn" && "text-warning")}>{value}</p>
    </div>
  );
}

export function LocationDetailPage({ id }: { readonly id: string }) {
  const router = useRouter();
  const fmt = useFormat();
  const perms = usePagePerms("settings.locations", ["edit", "delete", "change_log", "label"] as const);
  const q = useApiQuery<LocationDetail>(["location", id], `/api/locations/${id}`);
  const contents = useApiQuery<Contents>(["location-contents", id], `/api/locations/${id}/contents`);
  // Active tab lives in `?tab=` so reloads, deep links and Back restore it.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: Tab = isTab(rawTab) ? rawTab : "contents";
  const setTab = React.useCallback((next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "contents") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  const [edit, setEdit] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [print, setPrint] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const action = useAction([["location", id], ["location-contents", id], ["grid", "locations"]]);

  if (q.isPending) {
    return <div className="flex flex-col gap-4 px-6 pt-4"><Skeleton className="h-10 w-72" /><div className="grid grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div><Skeleton className="h-80 w-full" /></div>;
  }
  if (q.isError) {
    const missing = q.error.code === "NOT_FOUND";
    return (
      <div className="px-6 pt-10">
        <EmptyState title={missing ? "Location not found" : "Couldn't load this location"} description={missing ? "It may have been deleted, or it belongs to a warehouse you can't access." : q.error.message}
          action={missing ? <Link href="/locations" className="text-primary hover:underline">Back to locations</Link> : <Button onClick={() => void q.refetch()}>Retry</Button>} />
      </div>
    );
  }
  const d = q.data.data;
  const c = contents.data?.data;
  const deleteReason = !perms.delete ? NO_PERMISSION : d.storedUnits > 0 ? `Holds ${d.storedUnits} units; move the stock first` : d.openTaskCount > 0 ? `Has ${d.openTaskCount} open tasks` : null;
  const rules = LOCATION_RULES.filter((r) => d[r.key]);
  const lockToggle = async () => {
    const result = await action.run<BulkResponse>("/api/locations/bulk-lock", "POST", { ids: [id], locked: !d.isLocked });
    if (result) toastBulk(result, "location", d.isLocked ? "unlocked" : "locked");
  };

  return (
    <div className="flex flex-col pb-10">
      <PageHeader
        crumbLabel={d.code}
        title={d.code}
        helper={`${d.warehouseCode} · ${d.areaType ?? "No area"} · ${d.locationType ? splitCamel(d.locationType) : "No type"}`}
        actions={
          <>
            <DisabledReason reason={perms.change_log ? null : NO_PERMISSION}><Button variant="ghost" disabled={!perms.change_log} onClick={() => setLog(true)}><History className="h-4 w-4" />Change log</Button></DisabledReason>
            <DisabledReason reason={perms.label ? null : NO_PERMISSION}><Button disabled={!perms.label} onClick={() => setPrint(true)}><Printer className="h-4 w-4" />Print label</Button></DisabledReason>
            <DisabledReason reason={perms.edit ? null : NO_PERMISSION}><Button disabled={!perms.edit || action.pending} onClick={() => void lockToggle()}>{d.isLocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{d.isLocked ? "Unlock" : "Lock"}</Button></DisabledReason>
            <DisabledReason reason={deleteReason}><Button variant="danger" disabled={Boolean(deleteReason)} onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" />Delete</Button></DisabledReason>
            <DisabledReason reason={perms.edit ? null : NO_PERMISSION}><Button variant="primary" disabled={!perms.edit} onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit</Button></DisabledReason>
          </>
        }
      />
      <div className="mt-4 grid gap-5 px-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Inventory status" value={<AvailabilityPill status={d.inventoryStatus} />} />
            <Stat label="Stored units" value={d.storedUnits.toLocaleString("en-US")} />
            <Stat label="SKUs" value={d.skuCount} />
            <Stat label="Open tasks" value={d.openTaskCount} tone={d.openTaskCount > 0 ? "warn" : undefined} />
          </div>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <UnderlineTabs active={tab} onChange={(k) => { if (isTab(k)) setTab(k); }} ariaLabel="Location sections" tabs={[
              { key: "contents", label: "Contents", icon: Boxes, count: c?.buckets.length },
              { key: "capacity", label: "Capacity", icon: ScrollText, count: d.productCapacities.length + d.lpCapacities.length },
              { key: "tasks", label: "Open tasks", icon: ClipboardList, count: c?.tasks.length },
              { key: "ledger", label: "Ledger history", icon: History, count: c?.ledger.length },
            ]} />
            <div className="pt-4">
              {tab !== "capacity" && contents.isPending ? <Skeleton className="h-40 w-full" /> : null}
              {tab !== "capacity" && contents.isError ? <EmptyState compact title="Couldn't load contents" description={contents.error.message} action={<Button onClick={() => void contents.refetch()}>Retry</Button>} /> : null}
              {tab === "contents" && c ? (c.buckets.length === 0 ? <EmptyState compact icon={Boxes} title="This location is empty" description="Receive, put away or transfer stock here to see it." /> : (
                <Table head={["SKU", "Product", "Client", "Lot", "Expiry", "LP", "Status", { label: "On hand", right: true }, { label: "Allocated", right: true }, { label: "Damaged", right: true }]}>
                  {c.buckets.map((b) => (
                    <tr key={b.id} className="hover:bg-surface-sunken/60">
                      <td className="px-3 py-2 font-medium">{b.sku}</td><td className="max-w-[220px] truncate px-3 py-2">{b.productName}</td><td className="px-3 py-2">{b.clientName ?? <Muted />}</td>
                      <td className="px-3 py-2">{b.lotNumber ?? <Muted />}</td><td className="px-3 py-2">{b.expiryDate ? fmt.date(b.expiryDate) : <Muted />}</td><td className="px-3 py-2">{b.lpNumber ?? <Muted />}</td>
                      <td className="px-3 py-2"><Badge size="sm" tone={b.status === "Stock" ? "success" : "warning"}>{b.status}</Badge></td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.onHand}</td><td className="px-3 py-2 text-right tabular-nums">{b.allocated || <Muted>0</Muted>}</td><td className="px-3 py-2 text-right tabular-nums">{b.damaged || <Muted>0</Muted>}</td>
                    </tr>
                  ))}
                </Table>
              )) : null}
              {tab === "capacity" ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold">Product capacity</h3>
                    {d.productCapacities.length === 0 ? <p className="text-[12px] text-secondary">No product capacities. Edit the location to add min / max per SKU.</p> : (
                      <Table head={["SKU", "Product", "Client", "Pack type", { label: "Min", right: true }, { label: "Max", right: true }]}>
                        {d.productCapacities.map((p) => <tr key={p.id}><td className="px-3 py-2 font-medium">{p.sku}</td><td className="px-3 py-2">{p.productName}</td><td className="px-3 py-2">{p.clientName}</td><td className="px-3 py-2">{p.packType}</td><td className="px-3 py-2 text-right tabular-nums">{p.minQty}</td><td className="px-3 py-2 text-right tabular-nums">{p.maxQty}</td></tr>)}
                      </Table>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold">LP capacity</h3>
                    {d.lpCapacities.length === 0 ? <p className="text-[12px] text-secondary">No LP capacities.</p> : (
                      <Table head={["LP type", { label: "Min", right: true }, { label: "Max", right: true }, "Product SKU"]}>
                        {d.lpCapacities.map((p) => <tr key={p.id}><td className="px-3 py-2 font-medium">{p.lpTypeCode}</td><td className="px-3 py-2 text-right tabular-nums">{p.minQty}</td><td className="px-3 py-2 text-right tabular-nums">{p.maxQty}</td><td className="px-3 py-2">{p.sku ?? <Muted>Any</Muted>}</td></tr>)}
                      </Table>
                    )}
                  </div>
                </div>
              ) : null}
              {tab === "tasks" && c ? (c.tasks.length === 0 ? <EmptyState compact icon={ClipboardList} title="No open tasks" description="Pending and started tasks that pick from or put into this location show here." /> : (
                <Table head={["Task", "Job", "Type", "Direction", "SKU", { label: "Planned", right: true }, "Status"]}>
                  {c.tasks.map((t) => <tr key={t.id}><td className="px-3 py-2 tabular-nums">#{t.taskNo}</td><td className="px-3 py-2"><Link className="text-primary hover:underline" href={`/jobs/${t.jobId}`}>{t.jobCode}</Link></td><td className="px-3 py-2">{t.taskType}</td><td className="px-3 py-2">{t.direction === "Source" ? "Pick from" : "Put into"}</td><td className="px-3 py-2">{t.sku ?? <Muted />}</td><td className="px-3 py-2 text-right tabular-nums">{t.plannedQty}</td><td className="px-3 py-2"><StatusPill status={t.status} domain="task" size="sm" /></td></tr>)}
                </Table>
              )) : null}
              {tab === "ledger" && c ? (c.ledger.length === 0 ? <EmptyState compact icon={History} title="No stock movements yet" description="Every receipt, transfer, pick and adjustment touching this location is listed here." /> : (
                <Table head={["Date", "Type", "SKU", "Direction", { label: "Qty", right: true }, "By"]}>
                  {c.ledger.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap px-3 py-2">{fmt.dateTime(t.at)}</td><td className="px-3 py-2">{t.type}</td><td className="px-3 py-2 font-medium">{t.sku}</td>
                      <td className="px-3 py-2">{t.direction === "In" ? <span className="inline-flex items-center gap-1 text-success"><ArrowDownLeft className="h-3.5 w-3.5" />In</span> : t.direction === "Out" ? <span className="inline-flex items-center gap-1 text-danger"><ArrowUpRight className="h-3.5 w-3.5" />Out</span> : "Within"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.qty}</td><td className="px-3 py-2 text-secondary">{t.source}</td>
                    </tr>
                  ))}
                </Table>
              )) : null}
            </div>
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-3 text-[14px] font-semibold">Attributes</h2>
            <KvList columns={3} items={[
              { key: "wh", label: "Warehouse", value: `${d.warehouseCode} · ${d.warehouseName}` },
              { key: "group", label: "Location group", value: d.locationGroup },
              { key: "zone", label: "Location zone", value: d.locationZone },
              { key: "type", label: "Location type", value: d.locationType ? splitCamel(d.locationType) : null },
              { key: "area", label: "Area type", value: d.areaType },
              { key: "repl", label: "Replenishment type", value: d.replenishmentType },
              { key: "path", label: "Walking path priority", value: d.walkingPathPriority },
              { key: "cap", label: "Capacity", value: d.capacityType === "None" ? "None" : `${d.capacityType}: ${d.maxCapacityQty}` },
              { key: "maxsku", label: "Maximum SKU quantity", value: d.maxSkuQty },
              { key: "pos", label: "Mezzanine / aisle / rack", value: [d.mezzanine, d.aisle, d.rack].filter(Boolean).join(" / ") || null },
              { key: "lvl", label: "Column / level / position", value: [d.column, d.level, d.position].filter((v) => v !== null && v !== "").join(" / ") || null },
              { key: "dims", label: "H × W × L", value: `${d.height} × ${d.width} × ${d.length} ${d.dimensionUnit}` },
              { key: "vol", label: "Volume", value: `${d.volume} ${d.volumeUnit}` },
              { key: "abc", label: "ABC code", value: d.abcCode },
              { key: "client", label: "Dedicated client", value: d.dedicatedClientName ?? "All clients" },
              { key: "cart", label: "Assigned mobile cart", value: d.assignedMobileCart },
              { key: "locked", label: "Locked", value: <YesNo value={d.isLocked} /> },
              { key: "pap", label: "Print & apply on packing", value: <YesNo value={d.printApplyOnPacking} /> },
            ]} />
            <div className="mt-4 border-t border-border pt-3">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-secondary">Location rules</h3>
              {rules.length === 0 ? <p className="text-[12px] text-secondary">No rules: any SKU, lot and LP mix is allowed.</p> : (
                <div className="flex flex-wrap gap-1.5">{rules.map((r) => <Badge key={r.key} tone="primary" title={r.hint}>{r.label}</Badge>)}</div>
              )}
            </div>
          </section>
        </div>
        <aside className="flex flex-col gap-3">
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="text-[13px] font-semibold">Label preview</h2>
            <p className="text-[11px] text-faint">4 × 2 in · Code 128</p>
            <div className="mt-3 flex flex-col items-center gap-1 rounded-md border border-dashed border-border-strong bg-white px-3 py-3 text-center text-black">
              <span className="text-[18px] font-bold leading-tight">{d.code}</span>
              {d.locationType ? <span className="text-[10px] text-neutral-600">{splitCamel(d.locationType)}</span> : null}
              <Barcode value={d.barcode} height={10} scale={2} showText className="mt-1 max-w-full" aria-label={`Barcode ${d.barcode}`} />
              <span className="text-[10px] text-neutral-600">{[d.warehouseCode, d.locationZone && `Zone ${d.locationZone}`, d.aisle && `Aisle ${d.aisle}`, d.level && d.level !== "0" ? `Level ${d.level}` : null].filter(Boolean).join(" | ")}</span>
            </div>
            <Button className="mt-3 w-full" disabled={!perms.label} onClick={() => setPrint(true)}><Printer className="h-4 w-4" />Print label</Button>
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 text-[12px] text-secondary shadow-xs">
            <p>Created {fmt.dateTime(d.createdAt)}</p>
            <p className="mt-1">Last updated {fmt.dateTime(d.updatedAt)}</p>
          </section>
        </aside>
      </div>

      <LocationWizardDrawer open={edit} onOpenChange={setEdit} editId={id} onSaved={() => { void q.refetch(); void contents.refetch(); }} />
      <ChangeLogDrawer open={log} onOpenChange={setLog} entityType="location" entityId={id} entityCode={d.code} />
      <PrintOptionsModal open={print} onOpenChange={setPrint} typeKeys={["location-label"]} title="Print location label"
        records={[{ code: d.code, barcode: d.barcode, warehouseCode: d.warehouseCode, ...(d.locationZone ? { zone: d.locationZone } : {}), ...(d.aisle ? { aisle: d.aisle } : {}), ...(d.level && d.level !== "0" ? { level: d.level } : {}), ...(d.locationType ? { locationType: splitCamel(d.locationType) } : {}) }]} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} variant="danger" title={`Delete location ${d.code}?`} description="Its capacities are removed too. This can't be undone." confirmLabel="Yes, delete" cancelLabel="No"
        records={{ columns: [{ key: "code", label: "Location" }, { key: "wh", label: "Warehouse" }, { key: "area", label: "Area" }], rows: [{ code: d.code, wh: d.warehouseCode, area: d.areaType ?? "—" }] }}
        onConfirm={async () => { const r = await action.run<BulkResponse>("/api/locations/bulk-delete", "POST", { ids: [id] }); if (r) { toastBulk(r, "location", "deleted"); if (r.succeeded.length) router.push("/locations"); } }} />
    </div>
  );
}
