"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import type { OrderDetailHeader } from "@/server/repositories/orders";
import { Button } from "@/components/ui/button";
import { formatWeightOz } from "./order-derive";
import { FieldGrid, ReadField, SectionCard } from "./section-card";

const COPIED_RESET_MS = 1600;

function TrackingNumber({ value }: { value: string | null }) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const copy = React.useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — leave state as-is.
    }
  }, [value]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-body">Tracking Number</span>
      <div className="flex items-center gap-1.5">
        <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-border-strong/50 bg-surface-sunken px-2.5">
          {value ? (
            <span className="truncate font-mono text-[12px] tracking-tight text-body">
              {value}
            </span>
          ) : (
            <span className="text-[13px] text-faint">Not yet assigned</span>
          )}
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={copy}
          disabled={!value}
          aria-label={copied ? "Tracking number copied" : "Copy tracking number"}
          title="Copy tracking number"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}

export interface ShippingSectionProps {
  order: OrderDetailHeader;
  footer?: React.ReactNode;
}

export function ShippingSection({ order, footer }: ShippingSectionProps) {
  return (
    <SectionCard
      stepLabel="Step 4"
      title="Shipping"
      helper="Carrier assignment, service level and package details for this shipment."
      footer={footer}
    >
      <FieldGrid>
        <ReadField label="Carrier" required value={order.carrier ?? "—"} />
        <ReadField label="Shipping Service" value={order.shippingService ?? "—"} />
        <TrackingNumber value={order.trackingNumber} />
        <ReadField label="Total Weight" value={formatWeightOz(order.totalWeightOz)} />
      </FieldGrid>
      {!order.carrier ? (
        <p className="mt-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] leading-4 text-warning">
          No carrier assigned yet — rate shopping will pick the cheapest eligible service
          when this order reaches packing.
        </p>
      ) : null}
    </SectionCard>
  );
}
