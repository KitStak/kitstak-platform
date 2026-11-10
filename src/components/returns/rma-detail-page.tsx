"use client";

/**
 * RMA detail (`/orders/returns/[id]`, M04 §8). Header with status and actions (Change
 * Status, Cancel, Reprint / Create Return Label, Receive at station, Tag, Change log),
 * summary, lines (requested / returned), receipts, label & tracking and the timeline.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRightLeft, Ban, Box, ChevronDown, ExternalLink, FileText, History, PackageCheck, Printer, ScanLine, Tag as TagIcon, Truck } from "lucide-react";
import { ActivityTimeline, ChangeLogDrawer, DetailHeader, KvList, TagPopover } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { ChangeStatusModal } from "./change-status-modal";
import { ReturnLabelDialog } from "./return-label-fields";
import { bulkMessage, type BulkOutcome, type ReturnDetail } from "./return-types";
import { errorText, openFileId, RETURN_KEYS, useInvalidateReturns, useHydratedCan } from "./returns-client";

const dash = <span className="text-secondary">—</span>;

function Section({ title, icon: Icon, action, children }: { readonly title: string; readonly icon: React.ComponentType<{ className?: string }>; readonly action?: React.ReactNode; readonly children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold text-foreground"><Icon className="h-4 w-4 text-secondary" aria-hidden />{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function Th({ children, right }: { readonly children: React.ReactNode; readonly right?: boolean }) {
  return <th scope="col" className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-secondary ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function RmaDetailPage({ id }: { readonly id: string }) {
  const fmt = useFormat();
  const invalidate = useInvalidateReturns();
  const q = useApiQuery<ReturnDetail>(RETURN_KEYS.detail(id), `/api/returns/${id}`, { staleTime: 0 });
  const can = {
    status: useHydratedCan("inventory.return_orders.change_status").allowed,
    tag: useHydratedCan("inventory.return_orders.tag").allowed,
    label: useHydratedCan("fulfillment.shipment_orders.create_return_label").allowed,
    station: useHydratedCan("inventory.return_station.view").allowed,
  };
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [labelOpen, setLabelOpen] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);

  if (q.isPending) {
    return (
      <div className="space-y-4 px-6 py-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      </div>
    );
  }
  if (q.error) {
    if (isApiError(q.error) && q.error.code === "NOT_FOUND") {
      return <EmptyState title="Return order not found" description="It may have been removed, or it belongs to a warehouse or client you can't access." action={<Link href="/orders/returns" className={buttonVariants({ variant: "primary" })}>Back to return orders</Link>} />;
    }
    return <div className="p-6"><Callout variant="error" title="Could not load the return" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>}>{q.error.message}</Callout></div>;
  }
  const r = q.data.data;
  const open = r.status === "Pending" || r.status === "In Transit" || r.status === "Started";
  const cancelOption = r.transitions.find((t) => t.status === "Cancelled");
  const cancelReason = cancelOption?.ok ? null : cancelOption?.reason ?? "This return can't be cancelled.";
  const anyTransition = r.transitions.some((t) => t.ok);
  const labelReason = !r.order ? "Manual returns have no shipment order to label." : !open ? `A ${r.status.toLowerCase()} return can't get a new label.` : null;
  const pct = r.requestedQty > 0 ? Math.round((r.receivedQty / r.requestedQty) * 100) : 0;

  const cancel = async () => {
    try {
      const { data } = await apiRequest<BulkOutcome>("/api/returns/status", { method: "POST", body: { ids: [r.id], status: "Cancelled", version: r.version } });
      if (data.failed.length) toast.error("Not cancelled", data.failed[0]?.message ?? bulkMessage(data, "cancelled"));
      else toast.success("Return cancelled", `${r.rmaCode} is cancelled and can't be received.`);
    } catch (e) {
      toast.error("Error", errorText(e));
    } finally {
      await invalidate();
    }
  };

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {can.station && open ? (
        <Link href={`/return-station?rma=${encodeURIComponent(r.rmaCode)}`} className={buttonVariants({ variant: "secondary" })}>
          <ScanLine className="h-3.5 w-3.5" aria-hidden />Receive at station
        </Link>
      ) : null}
      {can.tag ? (
        <TagPopover entityType="return_order" scope="return_order" ids={[r.id]} appliedTagIds={r.tagIds} onApplied={() => void invalidate()}
          trigger={<Button variant="secondary"><TagIcon className="h-3.5 w-3.5" aria-hidden />Tag</Button>} />
      ) : null}
      {can.label ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary"><Printer className="h-3.5 w-3.5" aria-hidden />Return label<ChevronDown className="h-3.5 w-3.5" aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[240px]">
            <DropdownMenuItem icon={Printer} disabledReason={r.label?.labelFileId ? null : "No return label yet"} description={r.label ? `Tracking ${r.label.trackingNumber}` : undefined} onSelect={() => openFileId(r.label?.labelFileId)}>
              Reprint return label
            </DropdownMenuItem>
            <DropdownMenuItem icon={Truck} disabledReason={labelReason} description={r.label ? "Buys a new label and replaces the tracking number" : "Prepaid label for the customer"} onSelect={() => setLabelOpen(true)}>
              {r.label ? "Create new return label" : "Create return label"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Button variant="secondary" onClick={() => setLogOpen(true)}><History className="h-3.5 w-3.5" aria-hidden />Change log</Button>
      {can.status ? (
        <>
          <DisabledReason reason={cancelReason}>
            <Button variant="secondary" disabled={Boolean(cancelReason)} onClick={() => setCancelOpen(true)}><Ban className="h-3.5 w-3.5" aria-hidden />Cancel</Button>
          </DisabledReason>
          <DisabledReason reason={anyTransition ? null : `${r.status} returns can't be changed.`}>
            <Button variant="primary" disabled={!anyTransition} onClick={() => setStatusOpen(true)}><ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />Change status</Button>
          </DisabledReason>
        </>
      ) : null}
    </div>
  );

  return (
    <div className="pb-8">
      <DetailHeader
        title={`RMA ${r.rmaCode}`}
        backHref="/orders/returns"
        backLabel="Return orders"
        status={r.status}
        statusDomain="return"
        badges={<span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-semibold text-secondary">{r.source === "Manual" ? "Manual return" : r.source}</span>}
        meta={<span>{r.clientName} · {r.warehouseCode} · Created {fmt.dateTime(r.createdAt)} by {r.createdByName}</span>}
        actions={actions}
      />
      {r.status === "Cancelled" ? <div className="px-6 pb-3"><Callout variant="attention" title="This return is cancelled">Cancelled returns can&apos;t be received at the return station.</Callout></div> : null}
      <div className="grid gap-4 px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={`Lines (${r.lines.length})`} icon={Box} action={<span className="flex items-center gap-2 text-[12px] text-secondary"><span className="tabular-nums">{r.receivedQty} of {r.requestedQty} received</span><ProgressBar value={pct} className="w-24" /></span>}>
            <div className="-m-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="border-b border-border bg-surface-sunken/60"><tr><Th>SKU</Th><Th>Pack type</Th><Th right>Shipped</Th><Th right>Requested</Th><Th right>Returned</Th><Th>Line status</Th><Th>Disposition</Th><Th>Customer reason</Th><Th>Actual reason</Th></tr></thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2"><Link href={`/products/${l.productId}`} className="font-medium text-primary hover:underline">{l.sku}</Link><div className="max-w-[220px] truncate text-[11px] text-secondary">{l.name}</div></td>
                      <td className="px-3 py-2">{l.packType}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.shippedQty ?? dash}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.requestedQty}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${l.returnedQty >= l.requestedQty ? "text-success" : l.returnedQty > 0 ? "text-warning" : ""}`}>{l.returnedQty}</td>
                      <td className="px-3 py-2"><StatusPill status={l.lineStatus} domain="return" size="sm" /></td>
                      <td className="px-3 py-2">{l.disposition ?? dash}</td>
                      <td className="px-3 py-2">{l.customerReturnReason ?? dash}</td>
                      <td className="px-3 py-2">{l.actualReturnReason ?? dash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={`Receipts (${r.receipts.length})`} icon={PackageCheck} action={r.receipts.length ? <Link href={`/receiving/history?f.rmaNumber=eq:${encodeURIComponent(r.rmaCode)}`} className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">Receiving history<ExternalLink className="h-3 w-3" aria-hidden /></Link> : null}>
            {r.receipts.length === 0 ? (
              <p className="text-[13px] text-secondary">Nothing received yet. {open ? "Scan this RMA at the return station to receive it." : ""}</p>
            ) : (
              <div className="-m-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead className="border-b border-border bg-surface-sunken/60"><tr><Th>Receipt</Th><Th>SKU</Th><Th right>Qty</Th><Th>Location</Th><Th>LP</Th><Th>Damage reason</Th><Th>Actual reason</Th><Th>Received</Th></tr></thead>
                  <tbody>
                    {r.receipts.map((x) => (
                      <tr key={x.id} className={`border-b border-border last:border-0 ${x.cancelledAt ? "text-secondary line-through" : ""}`}>
                        <td className="px-3 py-2 tabular-nums">#{x.receiptNo}</td>
                        <td className="px-3 py-2 font-medium">{x.sku}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{x.quantity}</td>
                        <td className="px-3 py-2">{x.locationCode}</td>
                        <td className="px-3 py-2">{x.lpNumber ?? dash}</td>
                        <td className="px-3 py-2">{x.damageReason ?? dash}</td>
                        <td className="px-3 py-2">{x.actualReturnReason ?? dash}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmt.dateTime(x.receivedAt)}<div className="text-[11px] text-secondary">{x.receivedBy}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title="Timeline" icon={History}>
            <ActivityTimeline entityType="return_order" entityId={r.id} />
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Summary" icon={FileText}>
            <KvList columns={1} layout="inline" items={[
              { key: "order", label: "Shipment order", value: r.order ? <Link href={`/orders/${r.order.id}`} className="font-medium text-primary hover:underline">{r.order.code}</Link> : "Manual return" },
              { key: "store", label: "Store order #", value: r.order?.storeOrderNumber ?? dash },
              { key: "channel", label: "Store", value: r.order?.channel ?? dash },
              { key: "customer", label: "Customer", value: r.customerName ?? dash },
              { key: "country", label: "From country", value: r.fromCountry ?? dash },
              { key: "shipped", label: "Shipped", value: r.order?.shippedAt ? fmt.dateTime(r.order.shippedAt) : dash },
              { key: "delivered", label: "Delivered", value: r.order?.deliveredAt ? fmt.dateTime(r.order.deliveredAt) : dash },
              { key: "expected", label: "Expected return", value: r.expectedReturnDate ? fmt.date(r.expectedReturnDate) : dash },
              { key: "actual", label: "Actual return", value: r.actualReturnDate ? fmt.dateTime(r.actualReturnDate) : dash },
              { key: "updated", label: "Last updated", value: fmt.dateTime(r.updatedAt) },
            ]} />
            {r.note ? <p className="mt-3 whitespace-pre-line rounded-md bg-surface-sunken px-3 py-2 text-[12px] text-body">{r.note}</p> : null}
          </Section>
          <Section title="Return label" icon={Truck}>
            {r.label ? (
              <div className="space-y-3">
                <KvList columns={1} layout="inline" items={[
                  { key: "tracking", label: "Tracking", value: <span className="font-mono text-[12px]">{r.label.trackingNumber}</span> },
                  { key: "carrier", label: "Carrier", value: r.label.carrierCode ?? r.carrierCode ?? dash },
                  { key: "service", label: "Service", value: r.label.serviceName ?? r.carrierServiceName ?? dash },
                  { key: "cost", label: "Cost", value: fmt.money(r.label.shippingCost, "USD", "summary") },
                  { key: "status", label: "Label status", value: r.label.labelStatus },
                  { key: "created", label: "Created", value: r.label.createdAt ? fmt.dateTime(r.label.createdAt) : dash },
                ]} />
                <Button variant="secondary" className="w-full" disabled={!r.label.labelFileId} onClick={() => openFileId(r.label?.labelFileId)}><Printer className="h-3.5 w-3.5" aria-hidden />Reprint return label</Button>
              </div>
            ) : (
              <div className="space-y-3 text-[13px] text-secondary">
                <p>{r.trackingNumber ? `Tracking ${r.trackingNumber} (no label file).` : "No return label yet."}</p>
                {can.label ? (
                  <DisabledReason reason={labelReason}>
                    <Button variant="secondary" className="w-full" disabled={Boolean(labelReason)} onClick={() => setLabelOpen(true)}><Truck className="h-3.5 w-3.5" aria-hidden />Create return label</Button>
                  </DisabledReason>
                ) : null}
              </div>
            )}
          </Section>
        </div>
      </div>
      <ChangeStatusModal open={statusOpen} onOpenChange={setStatusOpen} selection={{ ids: [r.id] }} version={r.version} onDone={() => void invalidate()} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} variant="danger" icon={Ban} title={`Cancel return ${r.rmaCode}?`}
        description="A cancelled return can't be received at the return station or reopened."
        records={{ columns: [{ key: "rma", label: "RMA" }, { key: "status", label: "Status" }, { key: "qty", label: "Requested" }], rows: [{ rma: r.rmaCode, status: <StatusPill status={r.status} domain="return" size="sm" />, qty: r.requestedQty }] }}
        confirmLabel="Yes" cancelLabel="No" onConfirm={cancel} />
      {labelOpen ? <ReturnLabelDialog open onOpenChange={setLabelOpen} returnId={r.id} rmaCode={r.rmaCode} warehouseId={r.warehouseId} clientId={r.clientId} onDone={() => void invalidate()} /> : null}
      {logOpen ? <ChangeLogDrawer open onOpenChange={setLogOpen} entityType="return_order" entityId={r.id} entityCode={r.rmaCode} /> : null}
    </div>
  );
}
