"use client";

/**
 * Work order detail (`/work-orders/[id]`, beyond Logiwa): header with every action and a
 * build-progress strip, then tabs: Components (live availability), Job & tasks, Receipts,
 * Transactions, Exceptions, Documents, Activity. Tabs are URL state (`?tab=`).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Ban, Boxes, CheckCircle2, ChevronDown, FileSearch, FileStack, History, ListChecks, Lock, MoreHorizontal, PackageOpen, Pencil, Printer, Trash2, Undo2 } from "lucide-react";
import { DateCell, LinkCell } from "@/components/grid/cells";
import { HomeLink, StatusScreen } from "@/components/layout/status-screen";
import { ActivityTimeline, ChangeLogDrawer, DetailHeader, DocumentsViewer, KvList, PrintOptionsModal } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { UnderlineTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useCan } from "@/lib/permissions-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { cancelPickingReason, cancelReason, createKitReason, deleteReason, disassembleReason, editReason, pickingReason, printReason, remainingQty } from "@/lib/grid-defs/work-orders/work-order-model";
import { CreateKitDialog } from "./create-kit-dialog";
import { DisassembleDialog } from "./disassemble-dialog";
import { PickingDialog } from "./picking-dialog";
import { bulkToast, errorMessage, postBulk, useInvalidateWorkOrders, WO_ENTITY, WO_P, type WorkOrderDetail } from "./wo-client";
import { WorkOrderWizard } from "./wizard/work-order-wizard";

const TABS = ["components", "job", "receipts", "transactions", "exceptions", "documents", "activity"] as const;
type Tab = (typeof TABS)[number];

export function WorkOrderDetailPage({ id }: { readonly id: string }) {
  const detail = useApiQuery<WorkOrderDetail>(["work-order", id], `/api/work-orders/${encodeURIComponent(id)}`);
  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-4 px-6 pt-5">
        <Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (detail.error) {
    if (detail.error.code === "NOT_FOUND") {
      return <StatusScreen code="404" icon={FileSearch} title="Work order not found" description={<>No work order <strong>{id}</strong> exists in the warehouses and clients you can access.</>} actions={<><Link href="/work-orders" className="font-semibold text-primary hover:underline">Back to work orders</Link><HomeLink /></>} />;
    }
    if (detail.error.code === "FORBIDDEN") {
      return <StatusScreen code="403" tone="danger" icon={Lock} title="You can't view work orders" description="Ask an administrator for the Work Orders permission." actions={<HomeLink />} />;
    }
    return <div className="p-6"><Callout variant="error" title="The work order could not be loaded" action={<Button size="sm" variant="secondary" onClick={() => void detail.refetch()}>Retry</Button>}>{detail.error.message}</Callout></div>;
  }
  return <Loaded data={detail.data.data} />;
}

type Confirm = "delete" | "cancel" | "cancelPicking" | null;

function Loaded({ data }: { readonly data: WorkOrderDetail }) {
  const { workOrder: wo, kit, components, job, tasks, receipts, transactions, exceptions } = data;
  const router = useRouter();
  const search = useSearchParams();
  const fmt = useFormat();
  const invalidate = useInvalidateWorkOrders();
  const tabParam = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "components";
  const setTab = (t: string) => {
    const params = new URLSearchParams(search.toString());
    if (t === "components") params.delete("tab"); else params.set("tab", t);
    router.replace(`?${params.toString()}`, { scroll: false });
  };
  const can = {
    edit: useCan(WO_P.edit).allowed, del: useCan(WO_P.del).allowed, createKit: useCan(WO_P.createKit).allowed, disassemble: useCan(WO_P.disassemble).allowed,
    picking: useCan(WO_P.picking).allowed, cancelPicking: useCan(WO_P.cancelPicking).allowed,
  };
  const [edit, setEdit] = React.useState(false);
  const [kitOpen, setKitOpen] = React.useState(false);
  const [disOpen, setDisOpen] = React.useState(false);
  const [pickOpen, setPickOpen] = React.useState(false);
  const [log, setLog] = React.useState(false);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [print, setPrint] = React.useState<{ records: readonly unknown[]; consolidated: boolean } | null>(null);

  const rKit = createKitReason(wo);
  const rDis = disassembleReason(wo) ?? (wo.processedQty - data.disassembledQty <= 0 ? "Every kit built by this work order was already disassembled" : null);
  const rPick = pickingReason(wo);
  const rCancelPick = cancelPickingReason(wo) ?? (wo.status === "In Process" && !data.canReopenInProcess ? "Reopening In Process work orders is waiting on a status-flow update (REQ-1)" : null);
  const remaining = remainingQty(wo);
  const pct = wo.requestedQty > 0 ? Math.round((wo.processedQty / wo.requestedQty) * 100) : 0;
  const short = components.filter((c) => c.shortQty > 0);
  const buildable = components.length ? Math.min(...components.map((c) => (c.componentQty > 0 ? Math.floor((c.freeQty + (wo.type === "Work Order with Picking" ? c.allocatedQty : 0)) / c.componentQty) : 0))) : 0;

  const runConfirm = async () => {
    try {
      if (confirm === "delete") {
        await apiFetch(`/api/work-orders/${encodeURIComponent(wo.id)}`, { method: "DELETE" });
        toast.success("Success", `Work order ${wo.code} deleted.`);
        await invalidate();
        router.push("/work-orders");
        return;
      }
      const path = confirm === "cancel" ? "/api/work-orders/cancel" : "/api/work-orders/cancel-picking";
      const res = await postBulk(path, [wo.id]);
      bulkToast(res, () => wo.code, { done: confirm === "cancel" ? "cancelled" : "reset to Open; picking cancelled" });
    } catch (error) {
      toast.error("Error", errorMessage(error));
    } finally {
      await invalidate();
    }
  };

  const printList = async (consolidated: boolean) => {
    try {
      const records = await apiFetch<readonly unknown[]>("/api/work-orders/pick-list", { method: "POST", body: { ids: [wo.id], consolidated } });
      if (records.length === 0) { toast.info("Nothing to print", `${wo.code} has nothing left to pick.`); return; }
      setPrint({ records, consolidated });
    } catch (error) {
      toast.error("Error", errorMessage(error));
    }
  };

  const meta = (
    <>
      <span><span className="text-faint">Kit</span> <Link href={`/products/${kit.id}`} className="font-semibold text-foreground hover:text-primary hover:underline">{kit.sku}</Link> · {kit.name}</span>
      <span><span className="text-faint">Warehouse</span> <strong className="text-foreground">{wo.warehouseCode}</strong></span>
      <span><span className="text-faint">Client</span> <strong className="text-foreground">{wo.clientName}</strong></span>
      <span>{wo.type}</span>
      {wo.shipmentOrderId ? <span><span className="text-faint">Build for</span> <Link href={`/orders/${wo.shipmentOrderId}`} className="font-semibold text-primary hover:underline">{wo.shipmentOrderCode}</Link></span> : <span><span className="text-faint">Build for</span> Stock</span>}
    </>
  );

  const actions = (
    <>
      {can.createKit ? (
        <DisabledReason reason={rKit}><Button variant="primary" disabled={Boolean(rKit)} onClick={() => setKitOpen(true)}><Boxes className="h-3.5 w-3.5" aria-hidden />Create kit</Button></DisabledReason>
      ) : null}
      {can.picking && wo.type === "Work Order with Picking" ? (
        <DisabledReason reason={rPick}><Button variant="secondary" disabled={Boolean(rPick)} onClick={() => setPickOpen(true)}><ListChecks className="h-3.5 w-3.5" aria-hidden />Picking/job operations</Button></DisabledReason>
      ) : null}
      {can.edit ? (
        <DisabledReason reason={editReason(wo)}><Button variant="secondary" disabled={Boolean(editReason(wo))} onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button></DisabledReason>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label="More actions"><MoreHorizontal className="h-3.5 w-3.5" aria-hidden />More<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuItem icon={PackageOpen} disabledReason={can.disassemble ? rDis : "You don't have permission to disassemble kits"} onSelect={() => setDisOpen(true)}>Disassemble kit</DropdownMenuItem>
          <DropdownMenuItem icon={Printer} disabledReason={printReason(wo)} onSelect={() => void printList(false)}>Print picking list</DropdownMenuItem>
          <DropdownMenuItem icon={FileStack} disabledReason={printReason(wo)} onSelect={() => void printList(true)}>Batch picking list</DropdownMenuItem>
          <DropdownMenuItem icon={History} onSelect={() => setLog(true)}>Change log</DropdownMenuItem>
          <DropdownMenuItem icon={Undo2} destructive disabledReason={can.cancelPicking ? rCancelPick : "You don't have permission to cancel picking"} onSelect={() => setConfirm("cancelPicking")}>Cancel picking</DropdownMenuItem>
          <DropdownMenuItem icon={Ban} destructive disabledReason={can.edit ? cancelReason(wo) : "You don't have permission to edit work orders"} onSelect={() => setConfirm("cancel")}>Cancel work order</DropdownMenuItem>
          <DropdownMenuItem icon={Trash2} destructive disabledReason={can.del ? deleteReason(wo) : "You don't have permission to delete work orders"} onSelect={() => setConfirm("delete")}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const tabs = [
    { key: "components", label: "Components", count: components.length },
    { key: "job", label: "Job & tasks", count: tasks.length },
    { key: "receipts", label: "Receipts", count: receipts.length },
    { key: "transactions", label: "Transactions", count: transactions.length },
    { key: "exceptions", label: "Exceptions", count: exceptions.length },
    { key: "documents", label: "Documents" },
    { key: "activity", label: "Activity" },
  ];

  return (
    <div className="flex flex-col pb-8">
      <DetailHeader title={wo.code} backHref="/work-orders" backLabel="Work orders" status={wo.status} statusDomain="workOrder" meta={meta} actions={actions} />

      <div className="grid grid-cols-1 gap-3 px-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col justify-between gap-2 rounded-lg border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] font-semibold text-secondary">Kits built</span>
            <span className="text-[12px] tabular-nums text-secondary">{pct}%</span>
          </div>
          <p className="text-[22px] font-semibold tabular-nums text-foreground">{wo.processedQty}<span className="text-[14px] font-normal text-secondary"> / {wo.requestedQty}</span></p>
          <ProgressBar value={wo.processedQty} max={Math.max(1, wo.requestedQty)} tone={pct >= 100 ? "success" : "primary"} label="Kits built" />
          {data.disassembledQty > 0 ? <p className="text-[11px] text-secondary">{data.disassembledQty} disassembled since</p> : null}
        </div>
        <StatTile label="Left to build" value={remaining.toLocaleString()} sublabel={wo.status === "Completed" ? "All requested kits are built" : `Free stock covers ${buildable.toLocaleString()} kit${buildable === 1 ? "" : "s"}`} tone={remaining > 0 && buildable < remaining ? "warning" : "default"} />
        <StatTile label="Components" value={components.length.toLocaleString()} sublabel={short.length ? `${short.length} short: ${short.slice(0, 2).map((c) => c.sku).join(", ")}${short.length > 2 ? "…" : ""}` : "Every component is covered"} tone={short.length ? "danger" : "success"} />
        <StatTile label="Job" value={job ? <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">{job.code}</Link> : "—"}
          sublabel={job ? `${job.completedTaskCount} of ${job.taskCount} tasks done · ${job.assigneeName ?? "Unassigned"}` : wo.type === "Work Order with Picking" ? "Run Picking/job operations to create one" : "Built without picking"} />
      </div>

      {wo.status === "Shortage" ? (
        <div className="px-6 pt-3">
          <Callout variant="attention" title="Components are short" action={can.picking ? <Button size="sm" variant="secondary" onClick={() => setPickOpen(true)}>Retry allocation</Button> : undefined}>
            Allocation could not reserve every component. Receive or move stock, then run Picking/job operations again. See the Exceptions tab for details.
          </Callout>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 px-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 rounded-lg border border-border bg-surface shadow-xs">
          <UnderlineTabs tabs={tabs} active={tab} onChange={setTab} className="px-4" ariaLabel="Work order sections" />
          <div className="p-4">
            {tab === "components" ? <ComponentsTab data={data} /> : null}
            {tab === "job" ? <JobTab data={data} /> : null}
            {tab === "receipts" ? (
              <SimpleTable empty="No receipts yet. Create kit and Disassemble kit post Kitting and DisassembleKit receipts here."
                head={["Receipt", "Type", "SKU", "Qty", "Location", "Lot", "Received", "By"]}
                rows={receipts.map((r) => [
                  <span key="m" className="font-semibold text-foreground">#{r.masterId}</span>, <StatusPill key="t" status={r.type} size="sm" />, r.sku,
                  <span key="q" className="tabular-nums">{r.quantity}</span>, r.locationCode, r.lotNumber ?? "–", <DateCell key="d" value={r.receivedAt} />, r.receivedBy,
                ])} />
            ) : null}
            {tab === "transactions" ? (
              <SimpleTable empty="No inventory transactions yet."
                head={["#", "Type", "SKU", "Qty", "From", "To", "At", "Source"]}
                rows={transactions.map((t) => [
                  t.seq, t.type, t.sku, <span key="q" className={cn("font-semibold tabular-nums", t.qty < 0 ? "text-danger" : "text-success")}>{t.qty > 0 ? `+${t.qty}` : t.qty}</span>,
                  t.fromLocationCode ?? "–", t.toLocationCode ?? "–", <DateCell key="d" value={t.createdAt} />, t.source,
                ])} />
            ) : null}
            {tab === "exceptions" ? (
              <SimpleTable empty="No allocation exceptions. Shortages found by Picking/job operations are listed here."
                head={["SKU", "Explanation", "Free stock", "Required", "Run at", "Run by"]}
                rows={exceptions.map((e) => [
                  <span key="s" className="font-semibold text-foreground">{e.sku ?? "–"}</span>, <span key="x" className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="h-3 w-3" aria-hidden />{e.explanation}</span>,
                  e.inventoryQty ?? "–", e.requiredQty ?? "–", <DateCell key="d" value={e.runAt} />, e.runBy,
                ])} />
            ) : null}
            {tab === "documents" ? <DocumentsViewer entityType={WO_ENTITY} entityId={wo.id} canEdit={can.edit} /> : null}
            {tab === "activity" ? <ActivityTimeline entityType={WO_ENTITY} entityId={wo.id} /> : null}
          </div>
        </div>
        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-3 text-[13px] font-semibold text-foreground">Details</h2>
            <KvList columns={1} layout="inline" items={[
              { key: "op", label: "Operation", value: wo.operationType },
              { key: "out", label: "Output location", value: data.outputLocationCode ?? "Kitting area" },
              { key: "lot", label: "Output lot", value: wo.outputLot ?? "–" },
              { key: "created", label: "Created", value: fmt.dateTime(wo.createdAt) },
              { key: "ps", label: "Planned start", value: wo.plannedStartAt ? fmt.dateTime(wo.plannedStartAt) : "–" },
              { key: "pf", label: "Planned finish", value: wo.plannedFinishAt ? fmt.dateTime(wo.plannedFinishAt) : "–" },
              { key: "as", label: "Actual start", value: wo.actualStartAt ? fmt.dateTime(wo.actualStartAt) : "–" },
              { key: "af", label: "Actual finish", value: wo.actualFinishAt ? fmt.dateTime(wo.actualFinishAt) : "–" },
              ...(wo.cancelledAt ? [{ key: "c", label: "Cancelled", value: fmt.dateTime(wo.cancelledAt) }] : []),
              { key: "tags", label: "Tags", value: wo.tags.length ? wo.tags.map((t) => t.name).join(", ") : "–" },
            ]} />
          </section>
          <section className="rounded-lg border border-border bg-surface p-4 shadow-xs">
            <h2 className="mb-2 text-[13px] font-semibold text-foreground">Notes</h2>
            <p className="whitespace-pre-wrap text-[12px] text-secondary">{wo.extraNote || "No extra note."}</p>
            <h2 className="mb-2 mt-4 text-[13px] font-semibold text-foreground">Kitting instructions</h2>
            <p className="whitespace-pre-wrap text-[12px] text-secondary">{wo.kittingInstructions || "No kitting instructions."}</p>
          </section>
        </aside>
      </div>

      <WorkOrderWizard open={edit} onOpenChange={setEdit} mode="edit" workOrderId={wo.id} />
      <CreateKitDialog open={kitOpen} onOpenChange={setKitOpen} workOrderId={kitOpen ? wo.id : null} />
      <DisassembleDialog open={disOpen} onOpenChange={setDisOpen} workOrderId={disOpen ? wo.id : null} />
      <PickingDialog open={pickOpen} onOpenChange={setPickOpen} ids={[wo.id]} />
      <PrintOptionsModal open={print !== null} onOpenChange={(o) => { if (!o) setPrint(null); }} typeKeys={[print?.consolidated ? "work-order-consolidated-picking-list" : "work-order-picking-list"]} records={print?.records ?? []} clientId={wo.clientId} title="Print picking list" />
      {log ? <ChangeLogDrawer open onOpenChange={setLog} entityType={WO_ENTITY} entityId={wo.id} entityCode={wo.code} /> : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        variant="danger"
        icon={confirm === "delete" ? Trash2 : confirm === "cancel" ? Ban : Undo2}
        title={confirm === "delete" ? `Delete ${wo.code}?` : confirm === "cancel" ? `Cancel ${wo.code}?` : `Cancel picking for ${wo.code}?`}
        description={confirm === "delete" ? "This action cannot be undone." : confirm === "cancel" ? "Allocated components go back to free stock, and open picking tasks and the job are cancelled. Cancelled work orders can't be reopened." : "Component allocations are released, pending picking tasks and the job are cancelled, and the work order returns to Open."}
        records={{ columns: [{ key: "code", label: "Work order" }, { key: "status", label: "Status" }, { key: "kit", label: "Kit SKU" }, { key: "qty", label: "Built / requested" }], rows: [{ code: wo.code, status: <StatusPill status={wo.status} domain="workOrder" size="sm" />, kit: kit.sku, qty: `${wo.processedQty} / ${wo.requestedQty}` }] }}
        confirmLabel="Yes" cancelLabel="No" onConfirm={runConfirm}
      />
    </div>
  );
}

function SimpleTable({ head, rows, empty }: { readonly head: readonly string[]; readonly rows: readonly (readonly React.ReactNode[])[]; readonly empty: string }) {
  if (rows.length === 0) return <p className="py-10 text-center text-[13px] text-secondary">{empty}</p>;
  return (
    <div className="ks-scroll overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          <tr>{head.map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5 text-body">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function ComponentsTab({ data }: { readonly data: WorkOrderDetail }) {
  const { workOrder: wo, components } = data;
  const withPicking = wo.type === "Work Order with Picking";
  if (components.length === 0) return <p className="py-10 text-center text-[13px] text-secondary">This work order has no components.</p>;
  return (
    <div className="ks-scroll overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[12px]">
        <caption className="sr-only">Component availability</caption>
        <thead className="bg-surface-sunken text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          <tr>
            {["Component", "Pack type", "Per kit", "Total", "Allocated", "Picked", "Consumed", "Free now", "Status", "Source"].map((h) => <th key={h} scope="col" className={cn("whitespace-nowrap px-3 py-2", !["Component", "Pack type", "Status", "Source"].includes(h) && "text-right")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {components.map((c) => {
            const open = Math.max(0, c.totalQty - c.consumedQty);
            const ok = c.shortQty === 0;
            return (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2"><LinkCell href={`/products/${c.componentProductId}`}>{c.sku}</LinkCell><span className="block text-[11px] text-secondary">{c.name}</span></td>
                <td className="px-3 py-2 text-secondary">{c.packType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.componentQty}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{c.totalQty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{withPicking ? c.allocatedQty : "–"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{withPicking ? c.pickedQty : "–"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.consumedQty}</td>
                <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", ok ? "text-foreground" : "text-danger")}>{c.freeQty}</td>
                <td className="px-3 py-2">
                  {open === 0 ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Consumed</span>
                    : ok ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Covered</span>
                      : <span className="inline-flex items-center gap-1 font-semibold text-danger"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Short {c.shortQty}</span>}
                </td>
                <td className="px-3 py-2 text-secondary">{[c.locationCode, c.lpNumber ? `LP ${c.lpNumber}` : null, c.lotNumber ? `lot ${c.lotNumber}` : null].filter(Boolean).join(" · ") || (withPicking ? "Allocated FEFO" : "–")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JobTab({ data }: { readonly data: WorkOrderDetail }) {
  const { job, tasks, workOrder: wo } = data;
  if (!job && tasks.length === 0) {
    return <p className="py-10 text-center text-[13px] text-secondary">{wo.type === "Work Order with Picking" ? "No picking job yet. Run Picking/job operations to allocate the components and create one." : "Work orders without picking build kits directly from the chosen sources, so they have no job."}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {job ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-sunken/50 px-3 py-2 text-[12px]">
          <Link href={`/jobs/${job.id}`} className="font-semibold text-primary hover:underline">{job.code}</Link>
          <StatusPill status={job.status} domain="job" size="sm" />
          <span className="text-secondary">{job.jobType}</span>
          <span className="text-secondary">{job.assigneeName ?? "Unassigned"}</span>
          <span className="ml-auto w-40"><ProgressBar value={job.completedTaskCount} max={Math.max(1, job.taskCount)} size="sm" label="Tasks done" showValue={`${job.completedTaskCount}/${job.taskCount}`} /></span>
        </div>
      ) : null}
      <SimpleTable empty="No tasks."
        head={["Task", "Type", "Status", "SKU", "Planned", "Done", "From", "To"]}
        rows={tasks.map((t) => [t.taskNo, t.taskType, <StatusPill key="s" status={t.status} domain="job" size="sm" />, t.sku ?? "–", t.plannedQty, t.actualQty, t.sourceLocationCode ?? "–", t.targetLocationCode ?? "–"])} />
    </div>
  );
}
