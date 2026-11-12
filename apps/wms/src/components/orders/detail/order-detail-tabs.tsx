"use client";

/**
 * Read-only order detail tabs (beats Logiwa's edit-only form): Lines (fulfilment
 * progress per line), Shipments (packages, tracking, label state), Jobs and the
 * Activity feed. The Edit tab (wizard) is rendered by the page itself.
 */
import * as React from "react";
import Link from "next/link";
import { EMPTY_VALUE, useFormat } from "@/lib/format";
import { countryName } from "@/lib/countries";
import { effectiveRank, priorityFromRank } from "@/lib/grid-defs/orders/priority";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import type { OrderDetail } from "../orders-client";

export type OrderDetailTab = "overview" | "edit" | "shipments" | "activity" | "notes";

export interface LineProgress {
  readonly ordered: number;
  readonly allocated: number;
  readonly picked: number;
  readonly packed: number;
  readonly shipped: number;
  readonly cancelled: number;
  /** Open quantity still to allocate (ordered − cancelled − allocated − shipped, floored at 0). */
  readonly toAllocate: number;
}

/** Totals across lines; allocation is counted net of what already shipped. */
export function lineProgress(lines: readonly Pick<OrderDetail["lines"][number], "quantity" | "allocatedQuantity" | "pickedQuantity" | "packedQuantity" | "shippedQuantity" | "cancelledQuantity">[]): LineProgress {
  const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + (Number(f(l)) || 0), 0);
  const ordered = sum((l) => l.quantity);
  const allocated = sum((l) => l.allocatedQuantity);
  const shipped = sum((l) => l.shippedQuantity);
  const cancelled = sum((l) => l.cancelledQuantity);
  return {
    ordered,
    allocated,
    picked: sum((l) => l.pickedQuantity),
    packed: sum((l) => l.packedQuantity),
    shipped,
    cancelled,
    toAllocate: Math.max(0, ordered - cancelled - allocated - shipped),
  };
}

/** Plain-language next step that agrees with status, jobs and printouts. */
export function nextStepHint(detail: Pick<OrderDetail, "jobs" | "hasPickTask" | "shipments"> & { readonly order: { readonly status: string } }): string | null {
  const s = detail.order.status;
  if (s === "Open") return "Stock isn't allocated yet. Allocate it or add the order to a picking job.";
  if (s === "Shortage") return "Some lines are short on stock. Resolve the shortage or create a backorder.";
  if (s === "Ready to Pick" && detail.jobs.length === 0) return "Stock is allocated. Create a picking job to start picking and print the picking list.";
  if (s === "Ready to Pick" && !detail.hasPickTask) return "The picking job is pending. Release it to create pick tasks and print the picking list.";
  const labeled = detail.shipments.some((x) => x.labelStatus === "Active" && !x.actualShipmentAt);
  if (["Picking Started", "Ready to Pack", "Ready to Sort", "Sorting Started"].includes(s)) return "Picking is in progress on the assigned job. Pack the order at a packing station when it is picked.";
  if (s === "Packing Started") return labeled ? "Packing is in progress and a label exists. Finish packing, then ship the order." : "Packing is in progress. Create the shipping label at the packing station, then ship the order.";
  if (s === "Ready to Ship" || s === "Ready to Load" || s === "Loading Started") return labeled ? "Labeled. Ship the order to close it out." : "Packed. Create a shipping label, then ship the order.";
  if (s === "Partially Shipped") return "Part of the order has shipped. Ship or cancel the remaining quantity.";
  if (s === "On Hold") return "The order is on hold. Release the hold to continue fulfilment.";
  return null;
}

/** Footnote under the lines table; terminal statuses say what happened instead of allocation progress. */
export function linesFootnote(status: string, totals: Pick<LineProgress, "toAllocate" | "cancelled" | "shipped">): string {
  if (status === "Cancelled") return `Order cancelled · ${totals.cancelled} ${totals.cancelled === 1 ? "unit" : "units"} cancelled`;
  if (status === "Shipped" || status === "Delivered") return `${totals.shipped} ${totals.shipped === 1 ? "unit" : "units"} shipped`;
  if (totals.toAllocate > 0) return `${totals.toAllocate} still to allocate`;
  return "Fully allocated or shipped";
}

/** Statuses after which the order can't get a job, labels or printouts any more. */
export const TERMINAL_ORDER_STATUSES: ReadonlySet<string> = new Set(["Shipped", "Delivered", "Cancelled"]);


/**
 * Horizontal scroll container with edge scrims: when a table is wider than its card (768 px
 * tablets), a fade on the clipped side shows there is more to scroll to.
 */
export function ScrollRegion({ label, children, className }: { readonly label: string; readonly children: React.ReactNode; readonly className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);
  return (
    <div className={`relative w-full min-w-0 overflow-hidden rounded-lg border border-border ${className ?? ""}`} data-scroll-left={edges.left || undefined} data-scroll-right={edges.right || undefined}>
      <div ref={ref} className="ks-scroll w-full min-w-0 overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
      {edges.left ? <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent" /> : null}
      {edges.right ? <div aria-hidden data-testid="scroll-scrim-right" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface via-surface/70 to-transparent" /> : null}
    </div>
  );
}

function Num({ v, tone }: { readonly v: number; readonly tone?: "muted" | "success" | "danger" }) {
  const cls = v === 0 ? "text-faint" : tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return <td className={`px-2 py-2 text-right tabular-nums ${cls}`}>{v}</td>;
}

function StackNum({ label, v, tone }: { readonly label: string; readonly v: number; readonly tone?: "success" | "danger" }) {
  const cls = v === 0 ? "text-faint" : tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="flex flex-col">
      <dt className="text-2xs font-semibold text-faint">{label}</dt>
      <dd className={`tabular-nums font-semibold ${cls}`}>{v}</dd>
    </div>
  );
}

export function OrderLinesTab({ detail }: { readonly detail: OrderDetail }) {
  const fmt = useFormat();
  const totals = lineProgress(detail.lines);
  const hint = nextStepHint(detail);
  // The lot / pinned column only appears when a line uses it, so the table fits the card without scrolling.
  const hasLot = detail.lines.some((l) => l.lotNumber || l.pinnedLocationCode);
  if (detail.lines.length === 0) return <EmptyState title="No lines on this order" description="Open the Edit tab to add products." compact />;
  return (
    <div className="@container flex w-full min-w-0 max-w-full flex-col gap-3">
      {hint ? <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-secondary" data-testid="order-next-step">{hint}</p> : null}
      {/* Narrow cards (tablet): one stacked card per line, so no quantity column hides behind a scroll. */}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border @[760px]:hidden" aria-label="Order lines" data-testid="order-lines-stacked">
        {detail.lines.map((l) => (
          <li key={l.id} className="flex flex-col gap-2 px-3 py-2.5">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <Link href={`/products/${encodeURIComponent(l.productId)}`} className="shrink-0 font-mono text-xs text-primary hover:underline">{l.sku}</Link>
              <span className="truncate text-xs text-secondary" title={l.productName}>{l.productName}</span>
            </div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs @[480px]:grid-cols-6">
              <StackNum label="Ordered" v={l.quantity} />
              <StackNum label="Allocated" v={l.allocatedQuantity} />
              <StackNum label="Picked" v={l.pickedQuantity} />
              <StackNum label="Packed" v={l.packedQuantity} />
              <StackNum label="Shipped" v={l.shippedQuantity} tone="success" />
              <StackNum label="Cancelled" v={l.cancelledQuantity} tone="danger" />
            </dl>
            <p className="text-xs text-secondary">
              {l.uom} · {fmt.money(l.unitPrice)}{l.lotNumber || l.pinnedLocationCode ? ` · ${[l.lotNumber, l.pinnedLocationCode].filter(Boolean).join(" · ")}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <ScrollRegion label="Order lines" className="hidden @[760px]:block">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Order lines and fulfilment progress</caption>
          <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
            <tr>
              <th scope="col" className="whitespace-nowrap px-2 py-2">SKU</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2">Product</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2">UoM</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Ordered</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Allocated</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Picked</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Packed</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Shipped</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Cancelled</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Unit price</th>
              {hasLot ? <th scope="col" className="whitespace-nowrap px-2 py-2">Lot / pin</th> : null}
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="whitespace-nowrap px-2 py-2 font-mono text-xs" title={l.sku}>
                  <Link href={`/products/${encodeURIComponent(l.productId)}`} className="text-primary hover:underline">{l.sku}</Link>
                </td>
                <td className="max-w-[220px] truncate px-2 py-2" title={l.productName}>{l.productName}</td>
                <td className="whitespace-nowrap px-2 py-2 text-secondary">{l.uom}</td>
                <Num v={l.quantity} />
                <Num v={l.allocatedQuantity} />
                <Num v={l.pickedQuantity} />
                <Num v={l.packedQuantity} />
                <Num v={l.shippedQuantity} tone="success" />
                <Num v={l.cancelledQuantity} tone="danger" />
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmt.money(l.unitPrice)}</td>
                {hasLot ? <td className="whitespace-nowrap px-2 py-2 text-xs text-secondary">{[l.lotNumber, l.pinnedLocationCode].filter(Boolean).join(" · ") || "—"}</td> : null}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border-strong bg-surface-sunken font-semibold">
            <tr>
              <th scope="row" colSpan={3} className="px-2 py-2 text-left">Total</th>
              <Num v={totals.ordered} />
              <Num v={totals.allocated} />
              <Num v={totals.picked} />
              <Num v={totals.packed} />
              <Num v={totals.shipped} tone="success" />
              <Num v={totals.cancelled} tone="danger" />
              <td colSpan={hasLot ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </ScrollRegion>
      <p className="text-right text-xs text-secondary" data-testid="order-lines-footnote">{linesFootnote(detail.order.status, totals)}</p>
    </div>
  );
}

export function OrderShipmentsTab({ detail }: { readonly detail: OrderDetail }) {
  const fmt = useFormat();
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="order-jobs-h" className="flex flex-col gap-2">
        <h3 id="order-jobs-h" className="text-sm font-semibold text-foreground">Jobs</h3>
        {detail.jobs.length === 0 ? (
          <p className="text-sm text-secondary">No picking job yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {detail.jobs.map((j) => (
              <li key={j.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                <Link href={`/jobs/${encodeURIComponent(j.id)}`} className="text-sm font-semibold text-primary hover:underline">{j.code}</Link>
                <span className="text-xs text-secondary">{j.jobType}</span>
                <StatusPill status={j.status} domain="job" size="sm" />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="order-ship-h" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 id="order-ship-h" className="text-sm font-semibold text-foreground">Packages & labels</h3>
          <Link href="/shipments/history" className="text-xs font-medium text-primary hover:underline">Shipment history</Link>
        </div>
        {detail.shipments.length === 0 ? (
          <EmptyState title="No packages yet" description="Packages and tracking numbers appear once the order is packed and labeled." compact />
        ) : (
          <ScrollRegion label="Packages and labels">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">Packages and labels</caption>
              <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-2 py-2">Pkg</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2">Tracking</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2">Carrier / service</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2">Label</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Weight</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2 text-right">Cost</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2">Labeled</th>
                  <th scope="col" className="whitespace-nowrap px-2 py-2">Shipped</th>
                </tr>
              </thead>
              <tbody>
                {detail.shipments.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-2 tabular-nums">{s.packageSeq}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.trackingNumber}</td>
                    <td className="px-3 py-2">{s.carrierCode} · {s.serviceName}</td>
                    <td className="px-3 py-2"><StatusPill status={s.labelStatus} size="sm" /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.measure(s.weight, "lb", 2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.money(s.shippingCost)}</td>
                    <td className="px-3 py-2 text-xs text-secondary">{fmt.dateTime(s.labelCreatedAt)}</td>
                    <td className="px-3 py-2 text-xs text-secondary">{s.actualShipmentAt ? fmt.dateTime(s.actualShipmentAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ overview cards */

function Field({ label, children, mono, className }: { readonly label: string; readonly children: React.ReactNode; readonly mono?: boolean; readonly className?: string }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${className ?? ""}`}>
      <dt className="text-2xs font-semibold text-faint">{label}</dt>
      {/* The empty glyph never uses the mono face (its em dash renders like an en dash there). */}
      <dd className={`min-w-0 break-words text-sm ${empty ? "text-faint" : "text-foreground"} ${mono && !empty ? "font-mono text-xs" : ""}`}>{empty ? EMPTY_VALUE : children}</dd>
    </div>
  );
}

function OverviewCard({ title, children, testId, className }: { readonly title: string; readonly children: React.ReactNode; readonly testId?: string; readonly className?: string }) {
  return (
    <section aria-label={title} data-testid={testId} className={`flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs ${className ?? ""}`}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Address-verification pill (theme tokens, so it works in dark mode). */
const VERIFICATION_CLASS: Readonly<Record<string, string>> = {
  Verified: "bg-success-soft text-success", Corrected: "bg-success-soft text-success", Invalid: "bg-danger-soft text-danger",
  Unverified: "bg-warning-soft text-warning", Skipped: "bg-surface-sunken text-secondary",
};

function VerificationPill({ status }: { readonly status: string }) {
  return <span className={`inline-flex rounded-full px-1.5 py-px text-2xs font-semibold leading-4 ${VERIFICATION_CLASS[status] ?? VERIFICATION_CLASS.Unverified}`}>{status === "Corrected" ? "Verified (corrected)" : status}</span>;
}

/** Postal address as display lines; empty parts are skipped. */
export function addressLines(a: {
  readonly company?: string | null; readonly line1?: string | null; readonly line2?: string | null; readonly city?: string | null;
  readonly state?: string | null; readonly zip?: string | null; readonly country?: string | null;
}): string[] {
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.company, a.line1, a.line2, cityLine, a.country ? countryName(a.country) || a.country : null].filter((x): x is string => Boolean(x && String(x).trim()));
}

/** Overview: who and where the order ships to, how, and when (Logiwa shows these on one form). */
export function OrderOverviewCards({ detail }: { readonly detail: OrderDetail }) {
  const fmt = useFormat();
  const o = detail.order;
  const name = [o.customerFirstName, o.customerLastName].filter(Boolean).join(" ") || o.customerName;
  const ship = addressLines({ company: o.companyName, line1: o.shipAddress, line2: o.shipAddress2, city: o.shipCity, state: o.shipState, zip: o.shipZip, country: o.shipCountry });
  const b = (o.billingAddress ?? null) as Readonly<Record<string, string | null | undefined>> | null;
  const billing = o.useShipAsBilling || !b ? null : addressLines({ company: b.companyName, line1: b.line1, line2: b.line2, city: b.city, state: b.state, zip: b.postalCode, country: b.country });
  const verification = o.skipAddressVerification ? "Skipped" : (o.addressVerificationStatus || "Unverified");
  const active = detail.shipments.filter((s) => s.labelStatus === "Active");
  const tracking = [...new Set([o.trackingNumber, ...active.map((s) => s.trackingNumber)].filter((t): t is string => Boolean(t)))];
  const shippingCost = active.length ? active.reduce((sum, s) => sum + (Number(s.shippingCost) || 0), 0) : o.totalShippingCost;
  const date = (v: string | null | undefined) => (v ? fmt.dateTime(v) : null);
  const rank = effectiveRank(o.priority, o.priorityRank);
  const lines = (list: readonly string[]) => list.map((l, i) => <span key={i} className="block">{l}</span>);
  return (
    <div className="grid min-w-0 gap-5 md:grid-cols-2 2xl:grid-cols-3" data-testid="order-overview-cards">
      <OverviewCard title="Customer & ship-to" testId="order-card-customer">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Customer">{name}</Field>
          <Field label="Email">{o.customerEmail ? <a className="text-primary hover:underline" href={`mailto:${o.customerEmail}`}>{o.customerEmail}</a> : null}</Field>
          <Field label="Phone">{o.customerPhone}</Field>
          <Field label="Address type">{o.addressType}</Field>
          <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
            <dt className="flex flex-wrap items-center gap-2 text-2xs font-semibold text-faint">
              <span>Ship-to address</span>
              <span className="normal-case tracking-normal" data-testid="order-address-verification">
                <VerificationPill status={verification} />
              </span>
            </dt>
            <dd className="text-sm text-foreground">{ship.length ? lines(ship) : <span className="text-faint">—</span>}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
            <dt className="text-2xs font-semibold text-faint">Billing address</dt>
            <dd className="text-sm text-foreground">
              {billing === null ? <span className="text-secondary">Same as ship-to</span> : billing.length ? lines(billing) : <span className="text-faint">—</span>}
            </dd>
          </div>
        </dl>
      </OverviewCard>
      <OverviewCard title="Shipping" testId="order-card-shipping">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Carrier">{detail.carrierSetupName ?? o.carrier}</Field>
          <Field label="Service">{detail.carrierServiceName ?? o.shippingService}</Field>
          <Field label="Package">{detail.shipmentPackageName}</Field>
          <Field label="Requested option">{o.requestedShippingOption}</Field>
          <Field label={tracking.length > 1 ? "Tracking numbers" : "Tracking"} mono className="sm:col-span-2">{tracking.length ? tracking.join(", ") : null}</Field>
          <Field label="Shipping cost">{shippingCost === null || shippingCost === undefined ? null : fmt.money(shippingCost, "USD", "summary")}</Field>
          <Field label="Packages">{detail.shipments.length ? String(detail.shipments.length) : null}</Field>
        </dl>
      </OverviewCard>
      <OverviewCard title="Dates & type" testId="order-card-dates" className="md:col-span-2 2xl:col-span-1">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-2">
          <Field label="Order type">{detail.orderTypeName}</Field>
          <Field label="Priority">{`${rank} · ${priorityFromRank(rank)}`}</Field>
          <Field label="Order date">{date(o.orderDate)}</Field>
          <Field label="Expected ship">{date(o.expectedShipDate)}</Field>
          <Field label="Expected delivery">{date(o.expectedDeliveryDate)}</Field>
          <Field label="Carrier expected delivery">{date(o.carrierExpectedDeliveryDate)}</Field>
          {o.scheduledPickupDate ? <Field label="Scheduled pickup">{date(o.scheduledPickupDate)}</Field> : null}
          {o.scheduledShipmentDate ? <Field label="Scheduled shipment">{date(o.scheduledShipmentDate)}</Field> : null}
          {o.shippedAt ? <Field label="Shipped">{date(o.shippedAt)}</Field> : null}
          {o.deliveredAt ? <Field label="Delivered">{date(o.deliveredAt)}</Field> : null}
          {o.cancelledAt ? <Field label="Cancelled">{date(o.cancelledAt)}</Field> : null}
          {o.cancelledAt ? <Field label="Cancel reason">{detail.cancelReasonName}</Field> : null}
        </dl>
      </OverviewCard>
    </div>
  );
}
