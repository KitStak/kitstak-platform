"use client";

/**
 * `/receiving/[id]` — purchase order detail / edit. The wizard in free mode opens on Confirm
 * (steps clickable, client locked). Right rail: Save, Other actions ▾ (Receive items,
 * Receive PO, Delete order, Cancel order — gated by status and permission), Summary with the
 * status pencil and change log, Billing charges download and Printouts. Receipts are listed
 * under the wizard with Cancel.
 */
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Ban, ChevronDown, Download, Eye, FileQuestion, FileText, PackageCheck, PackageOpen, Pencil, Plus, Printer, ShieldAlert, Trash2 } from "lucide-react";
import { HomeLink, StatusScreen } from "@/components/layout/status-screen";
import { PageHeader } from "@/components/layout/page-header";
import { ChangeLogDrawer, DocumentsViewer, DocumentUploadModal } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { cancelReason, deleteReason, receiveReason } from "./po-list-page";
import { PoStatusModal } from "./po-status-modal";
import type { ReceiptRow } from "./receipt-columns";
import { ReceiptDrawer } from "./receipt-drawer";
import { ReceiveItemsDrawer } from "./receive-items-drawer";
import { errorMessage, openFile, PO_KEYS, useInvalidateReceiving, type PoDetail, useCan } from "./receiving-shared";
import { useCancelReceipt } from "./receiving-history-page";
import { DiffPill } from "./wizard/step-confirm";
import { PoWizard } from "./wizard/po-wizard";

const P = "inventory.purchase_orders.";

function RailCard({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{title}</p>
      {children}
    </div>
  );
}

function ReceiptsPanel({ po, canCancel, onOpen, onCancel }: { readonly po: PoDetail; readonly canCancel: boolean; readonly onOpen: (id: string) => void; readonly onCancel: (r: ReceiptRow) => void }) {
  const fmt = useFormat();
  const q = useApiQuery<ReceiptRow[]>(PO_KEYS.receipts(po.id), `/api/purchase-orders/${po.id}/receipts`);
  const rows = q.data?.data ?? [];
  if (q.isPending) return <Skeleton className="h-24 w-full" />;
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-xs" aria-labelledby="po-receipts">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="po-receipts" className="text-[15px] font-semibold text-foreground">Receipts <span className="text-[12px] font-normal text-faint">({rows.length})</span></h2>
        <Link href={`/receiving/history?q=${encodeURIComponent(po.code)}&qm=eq`} className="text-[12px] font-medium text-primary hover:underline">Open in receiving history</Link>
      </div>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-5 text-[12px] text-secondary"><PackageOpen className="h-4 w-4 text-faint" aria-hidden />Nothing received yet. Use Other actions › Receive items to receive part or all of this order.</p>
      ) : (
        <div className="overflow-x-auto ks-scroll">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
                {["Master ID", "SKU", "Quantity", "Location", "LPN", "Lot", "Expiry", "Damage", "Received", "By", ""].map((h) => <th key={h} className="border-b border-border px-2.5 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.cancelledAt ? "text-faint line-through decoration-faint/60" : ""}>
                  <td className="border-b border-border px-2.5 py-2"><button type="button" className="font-medium text-primary hover:underline" onClick={() => onOpen(r.id)}>{r.masterId}</button></td>
                  <td className="border-b border-border px-2.5 py-2 font-semibold">{r.sku}</td>
                  <td className="border-b border-border px-2.5 py-2 tabular-nums">{r.quantity.toLocaleString()} {r.packType}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.locationCode}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.lpNumber ?? "—"}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.lotNumber ?? "—"}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.expiryDate ? fmt.date(r.expiryDate) : "—"}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.damageReason ?? "—"}</td>
                  <td className="border-b border-border px-2.5 py-2">{fmt.dateTime(r.receivedAt)}</td>
                  <td className="border-b border-border px-2.5 py-2">{r.receivedBy}</td>
                  <td className="border-b border-border px-2.5 py-2 text-right">
                    {canCancel ? (
                      <DisabledReason reason={r.cancelBlockedReason}>
                        <Button variant="ghost" size="sm" disabled={Boolean(r.cancelBlockedReason)} onClick={() => onCancel(r)}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel</Button>
                      </DisabledReason>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Confirm = "receiveAll" | "cancel" | "delete" | null;

function DetailView({ po, initialStep, refresh }: { readonly po: PoDetail; readonly initialStep: string; readonly refresh: () => Promise<void> }) {
  const router = useRouter();
  const fmt = useFormat();
  const invalidate = useInvalidateReceiving();
  const can = {
    receive: useCan(`${P}receive_po`).allowed, cancel: useCan(`${P}cancel_order`).allowed, del: useCan(`${P}delete`).allowed, status: useCan(`${P}change_status`).allowed,
    log: useCan(`${P}change_log`).allowed, billing: useCan(`${P}download_billing_charges`).allowed, upload: useCan(`${P}upload_documents`).allowed,
    poLabel: useCan(`${P}purchase_order_label`).allowed, cancelReceipt: useCan("inventory.receiving_history.cancel").allowed,
  };
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [docsOpen, setDocsOpen] = React.useState(false);
  const [receiptId, setReceiptId] = React.useState<string | null>(null);
  const cancelReceipt = useCancelReceipt(() => void refresh());

  const rReceive = receiveReason([po]) ?? (po.lines.length === 0 ? "This purchase order has no lines." : null);
  const rCancel = cancelReason([po]);
  const rDelete = deleteReason([po]);
  const remaining = po.lines.reduce((s, l) => s + Math.max(0, l.orderedQuantity - l.receivedQuantity), 0);

  const run = async (kind: Exclude<Confirm, null>) => {
    try {
      if (kind === "receiveAll") {
        await apiRequest(`/api/purchase-orders/${po.id}/receive`, { method: "POST", body: { all: true } });
        toast.success("Success", "You have successfully received orders.");
      } else if (kind === "cancel") {
        await apiRequest(`/api/purchase-orders/${po.id}/cancel`, { method: "POST", body: { version: po.version } });
        toast.success("Success", "You have successfully cancelled an order.");
      } else {
        await apiRequest(`/api/purchase-orders/${po.id}`, { method: "DELETE", query: { version: po.version } });
        toast.success("Success", `Purchase order ${po.code} deleted.`);
        await invalidate();
        router.push("/receiving");
        return;
      }
      await refresh();
    } catch (error) {
      toast.error("Error", errorMessage(error));
      await refresh();
    }
  };

  const otherActions = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="w-full justify-between">
          Other actions
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuItem icon={PackageCheck} description="Partial receive with location, LP, lot and serials" disabledReason={can.receive ? rReceive : "You don't have permission to receive purchase orders"} onSelect={() => setReceiveOpen(true)}>Receive items</DropdownMenuItem>
        <DropdownMenuItem icon={PackageCheck} description={`All ${remaining.toLocaleString()} open units into ${po.defaultReceivingLocation?.code ?? "the default receiving location"}`} disabledReason={can.receive ? rReceive ?? (remaining === 0 ? "Every line is fully received." : null) : "You don't have permission to receive purchase orders"} onSelect={() => setConfirm("receiveAll")}>Receive PO</DropdownMenuItem>
        <DropdownMenuItem icon={Printer} disabledReason={can.poLabel ? null : "You don't have permission to print purchase orders"} onSelect={() => openFile(`/api/purchase-orders/documents?ids=${po.id}`)}>Print purchase order</DropdownMenuItem>
        <DropdownMenuItem icon={Ban} disabledReason={can.cancel ? rCancel : "You don't have permission to cancel orders"} onSelect={() => setConfirm("cancel")}>Cancel order</DropdownMenuItem>
        <DropdownMenuItem icon={Trash2} destructive disabledReason={can.del ? rDelete : "You don't have permission to delete purchase orders"} onSelect={() => setConfirm("delete")}>Delete order</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const railExtra = (
    <>
      <div className="pt-1">{otherActions}</div>
      <RailCard title="Summary">
        <p className="text-[18px] font-bold leading-6 text-foreground">{po.code}</p>
        <div className="flex items-center justify-between gap-2 text-[12px]"><span className="text-faint">{po.poType}</span><span className="truncate font-medium text-body">{po.vendorName}</span></div>
        <div className="flex items-center justify-between gap-2 text-[12px]"><span className="text-faint">PO date</span><span>{po.poDate ? fmt.date(po.poDate) : "—"}</span></div>
        <div className="flex items-center gap-1.5">
          <StatusPill status={po.status} domain="purchaseOrder" />
          {can.status ? (
            <DisabledReason reason={po.allowedStatuses.length ? null : `A ${po.status.toLowerCase()} purchase order can't change status.`}>
              <Button variant="ghost" size="icon-sm" aria-label="Change status" disabled={po.allowedStatuses.length === 0} onClick={() => setStatusOpen(true)}><Pencil className="h-3.5 w-3.5" aria-hidden /></Button>
            </DisabledReason>
          ) : null}
          <span className="flex-1" />
          {can.log ? <button type="button" className="text-[12px] font-medium text-primary hover:underline" onClick={() => setLogOpen(true)}>Show change log</button> : null}
        </div>
        <div className="flex items-center justify-between gap-2 text-[12px]"><span className="text-faint">Received</span><span className="flex items-center gap-1.5 tabular-nums">{po.receivedQuantity.toLocaleString()} / {po.totalQuantity.toLocaleString()} <DiffPill value={po.receivedQuantity - po.totalQuantity} /></span></div>
        <div className="flex items-center justify-between gap-2 text-[13px] font-semibold"><span>Total</span><span className="tabular-nums">{fmt.money(po.purchasePrice)}</span></div>
      </RailCard>
      <RailCard title="Billing charges">
        <DisabledReason reason={can.billing ? null : "You don't have permission to download billing charges"}>
          <Button variant="secondary" size="sm" disabled={!can.billing} onClick={() => openFile(`/api/purchase-orders/${po.id}/billing-charges`)}><Download className="h-3.5 w-3.5" aria-hidden />Download billing charges</Button>
        </DisabledReason>
        <p className="text-[11px] text-faint">Click to download the latest billing charges.</p>
      </RailCard>
      <RailCard title="Printouts">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-faint" aria-hidden />
          <span className={`flex-1 text-[12px] ${po.attachmentCount ? "text-body" : "text-danger"}`}>{po.attachmentCount ? `Documents · ${po.attachmentCount}` : "Documents — Not available"}</span>
          <DisabledReason reason={can.upload ? null : "You don't have permission to upload documents"}>
            <Button variant="ghost" size="icon-sm" aria-label="Upload document" disabled={!can.upload} onClick={() => setUploadOpen(true)}><Plus className="h-3.5 w-3.5" aria-hidden /></Button>
          </DisabledReason>
          <DisabledReason reason={po.attachmentCount ? null : "No documents uploaded yet"}>
            <Button variant="ghost" size="icon-sm" aria-label="View documents" disabled={!po.attachmentCount} onClick={() => setDocsOpen(true)}><Eye className="h-3.5 w-3.5" aria-hidden /></Button>
          </DisabledReason>
        </div>
      </RailCard>
    </>
  );

  const records = { columns: [{ key: "code", label: "PO number" }, { key: "status", label: "Status" }, { key: "qty", label: "Open qty" }], rows: [{ code: po.code, status: <StatusPill status={po.status} domain="purchaseOrder" size="sm" />, qty: remaining.toLocaleString() }] };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title="Edit purchase order"
        crumbLabel={po.code}
        helper={`${po.clientName} · ${po.warehouseName} · created ${fmt.date(po.createdAt)}`}
        actions={
          <>
            <Link href="/receiving" className={buttonVariants({ variant: "ghost" })}>Purchase orders</Link>
            {can.receive ? (
              <DisabledReason reason={rReceive}>
                <Button variant="primary" disabled={Boolean(rReceive)} onClick={() => setReceiveOpen(true)}><PackageCheck className="h-3.5 w-3.5" aria-hidden />Receive items</Button>
              </DisabledReason>
            ) : null}
          </>
        }
      />
      <PoWizard key={`${po.id}:${po.version}`} po={po} initialStep={initialStep} railExtra={railExtra} onSaved={() => void refresh()} />
      <ReceiptsPanel po={po} canCancel={can.cancelReceipt} onOpen={setReceiptId} onCancel={(r) => cancelReceipt.ask(r)} />

      <ReceiveItemsDrawer po={po} open={receiveOpen} onOpenChange={(open) => { setReceiveOpen(open); if (!open) void refresh(); }} />
      <ConfirmDialog open={confirm === "receiveAll"} onOpenChange={(o) => !o && setConfirm(null)} variant="info" icon={PackageCheck} title={`Receive ${po.code} in full?`} description={`Every open line is received into ${po.defaultReceivingLocation?.code ?? "the default receiving location"}. Lot, expiry and serial-tracked lines need Receive items instead.`} records={records} confirmLabel="Receive" cancelLabel="No" onConfirm={() => run("receiveAll")} />
      <ConfirmDialog open={confirm === "cancel"} onOpenChange={(o) => !o && setConfirm(null)} variant="danger" icon={Ban} title="Are you sure you want to cancel selected order(s)?" description="Cancelled purchase orders can't be received or changed." records={records} confirmLabel="Yes" cancelLabel="No" onConfirm={() => run("cancel")} />
      <ConfirmDialog open={confirm === "delete"} onOpenChange={(o) => !o && setConfirm(null)} variant="danger" title={`Delete ${po.code}?`} description="This action cannot be undone." records={records} confirmLabel="Yes" cancelLabel="No" onConfirm={() => run("delete")} />
      {statusOpen ? <PoStatusModal po={po} open onOpenChange={setStatusOpen} onChanged={() => void refresh()} /> : null}
      {logOpen ? <ChangeLogDrawer open onOpenChange={setLogOpen} entityType="purchase_order" entityId={po.id} entityCode={po.code} /> : null}
      <DocumentUploadModal open={uploadOpen} onOpenChange={setUploadOpen} entityType="purchase_order" entityId={po.id} onUploaded={() => void refresh()} />
      <Drawer open={docsOpen} onOpenChange={(o) => { setDocsOpen(o); if (!o) void refresh(); }} title={`Documents · ${po.code}`} width={45}>
        <DocumentsViewer entityType="purchase_order" entityId={po.id} canEdit={can.upload} />
      </Drawer>
      <ReceiptDrawer receiptId={receiptId} onOpenChange={(o) => !o && setReceiptId(null)} canCancel={can.cancelReceipt} onCancel={(r) => cancelReceipt.ask(r)} onOpenReceipt={setReceiptId} />
      {cancelReceipt.dialog}
    </div>
  );
}

export function PoDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const q = useApiQuery<PoDetail>(PO_KEYS.detail(id), `/api/purchase-orders/${id}`, { retry: false });
  const refresh = React.useCallback(async () => {
    await q.refetch();
  }, [q]);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-12 w-full" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]"><Skeleton className="h-[420px]" /><Skeleton className="h-[420px]" /></div>
      </div>
    );
  }
  if (q.error || !q.data) {
    const status = isApiError(q.error) ? q.error.status : 0;
    if (status === 404) return <StatusScreen code="404" icon={FileQuestion} title="Purchase order not found" description="It may have been deleted, or it belongs to a warehouse or client you can't access." actions={<><Link href="/receiving" className={buttonVariants({ variant: "secondary", size: "lg" })}>Purchase orders</Link><HomeLink /></>} />;
    if (status === 403) return <StatusScreen code="403" icon={ShieldAlert} tone="warning" title="You don't have access" description="Ask an administrator for the Purchase Orders view permission." actions={<HomeLink />} />;
    return <StatusScreen icon={ShieldAlert} tone="danger" title="Couldn't load the purchase order" description={errorMessage(q.error)} actions={<Button variant="secondary" size="lg" onClick={() => void q.refetch()}>Retry</Button>} />;
  }
  return <DetailView po={q.data.data} initialStep={search.get("step") ?? "confirm"} refresh={refresh} />;
}
