import * as React from "react";
import { MapPin, Tag } from "lucide-react";
import type { OrderDetailHeader } from "@/server/repositories/orders";
import { formatDate, formatDateTime } from "@/lib/utils";
import { PriorityFlag } from "@/components/ui/status-pill";
import { FieldGrid, ReadField, SectionCard } from "./section-card";
import { warehouseNameOf } from "./order-derive";

export interface OrderSectionProps {
  order: OrderDetailHeader;
  footer?: React.ReactNode;
}

export function OrderDetailsSection({ order, footer }: OrderSectionProps) {
  return (
    <SectionCard
      stepLabel="Step 1"
      title="Order Details"
      helper="Order identity, dates and handling priority as received from the sales channel."
      footer={footer}
    >
      <FieldGrid>
        <ReadField label="Warehouse" value={warehouseNameOf(order.warehouseId)} />
        <ReadField label="Client" value={order.clientName} />
        <ReadField label="Order Code" required value={order.code} />
        <ReadField
          label="Order Type"
          required
          value={order.orderType === "D2C" ? "D2C Order" : "B2B Order"}
        />
        <ReadField label="Order Date" required value={formatDateTime(order.orderDate)} />
        <ReadField
          label="Expected Shipment Date"
          required
          value={order.expectedShipDate ? formatDateTime(order.expectedShipDate) : "—"}
        />
        <ReadField
          label="Shipped Date"
          value={order.shippedAt ? formatDateTime(order.shippedAt) : "—"}
        />
        <ReadField
          label="Delivered Date"
          value={order.deliveredAt ? formatDateTime(order.deliveredAt) : "—"}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-body">Priority</span>
          <div className="flex h-8 items-center">
            <PriorityFlag priority={order.priority} />
          </div>
        </div>
        <ReadField label="Note" value={order.note ?? "—"} />
      </FieldGrid>
    </SectionCard>
  );
}

export function CustomerAddressSection({ order, footer }: OrderSectionProps) {
  return (
    <SectionCard
      stepLabel="Step 2"
      title="Customer & Address"
      helper="Recipient contact details and the validated ship-to address for this order."
      footer={footer}
    >
      <FieldGrid>
        <ReadField label="Customer Name" required value={order.customerName} />
        <ReadField label="Email" required value={order.customerEmail} />
      </FieldGrid>
      <div className="mt-4 rounded-lg border border-border bg-surface-sunken/60 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <MapPin className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 text-[13px] leading-5 text-body">
            <p className="font-semibold text-foreground">{order.customerName}</p>
            <p>{order.shipAddress}</p>
            <p>
              {order.shipCity}, {order.shipState} {order.shipZip}
            </p>
            <p className="text-secondary">{order.shipCountry}</p>
          </div>
          <span className="ml-auto whitespace-nowrap rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
            Validated
          </span>
        </div>
      </div>
    </SectionCard>
  );
}

export function OtherInfoSection({ order, footer }: OrderSectionProps) {
  const tags = [
    order.channel,
    order.orderType === "D2C" ? "Direct to Consumer" : "Business to Business",
    order.priority !== "None" ? `${order.priority} Priority` : null,
    order.storeName,
  ].filter((t): t is string => Boolean(t));
  return (
    <SectionCard
      stepLabel="Step 5"
      title="Other Info"
      helper="Channel tags and internal notes attached to this shipment order."
      footer={footer}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-body">Tags</span>
        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-secondary"
            >
              <Tag className="h-3 w-3 text-faint" aria-hidden />
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-body">Internal Notes</span>
        <div className="min-h-[72px] rounded-md border border-border-strong/50 bg-surface-sunken px-2.5 py-2 text-[13px] leading-5 text-body">
          {order.note ?? <span className="text-faint">No notes recorded for this order.</span>}
        </div>
        <span className="text-[11px] text-faint">
          Created {formatDate(order.createdAt)} · visible to warehouse staff only
        </span>
      </div>
    </SectionCard>
  );
}
