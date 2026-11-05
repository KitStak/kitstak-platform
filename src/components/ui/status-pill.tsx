import * as React from "react";
import { ArrowUp, FileText, ShoppingBag, Store, Truck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shipment / PO / job status → semantic pill style */
const STATUS_STYLES: Record<string, string> = {
  // amber — awaiting action
  open: "bg-warning-soft text-warning",
  "on hold": "bg-warning-soft text-warning",
  backorder: "bg-warning-soft text-warning",
  // blue — queued / ready
  "ready to pick": "bg-primary-soft text-primary",
  "ready to pack": "bg-primary-soft text-primary",
  "ready to ship": "bg-primary-soft text-primary",
  "ready to load": "bg-primary-soft text-primary",
  allocated: "bg-primary-soft text-primary",
  started: "bg-primary-soft text-primary",
  // cyan — in motion
  "picking started": "bg-info-soft text-info",
  "packing started": "bg-info-soft text-info",
  "in progress": "bg-info-soft text-info",
  receiving: "bg-info-soft text-info",
  // green — done
  shipped: "bg-success-soft text-success",
  delivered: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  received: "bg-success-soft text-success",
  active: "bg-success-soft text-success",
  // gray — inert
  pending: "bg-neutral-soft text-neutral",
  draft: "bg-neutral-soft text-neutral",
  closed: "bg-neutral-soft text-neutral",
  inactive: "bg-neutral-soft text-neutral",
  // red — problems
  cancelled: "bg-danger-soft text-danger",
  shortage: "bg-danger-soft text-danger",
  error: "bg-danger-soft text-danger",
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const style = STATUS_STYLES[status.toLowerCase()] ?? "bg-neutral-soft text-neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap",
        style,
        className
      )}
    >
      {status}
    </span>
  );
}

export function PriorityFlag({ priority }: { priority: string | null }) {
  if (!priority || priority.toLowerCase() === "none") {
    return <span className="text-faint text-[12px]">—</span>;
  }
  const isHigh = priority.toLowerCase() === "high";
  const isUrgent = priority.toLowerCase() === "urgent";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        isUrgent
          ? "bg-danger text-white"
          : isHigh
            ? "bg-danger-soft text-danger"
            : "bg-neutral-soft text-neutral"
      )}
    >
      {(isHigh || isUrgent) && <ArrowUp className="h-3 w-3" aria-hidden />}
      {priority}
    </span>
  );
}

/** Sales-channel badge with brand-flavored icon tiles */
const CHANNEL_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; tile: string; label?: string }
> = {
  shopify: { icon: ShoppingBag, tile: "bg-[#e8f5e2] text-[#5e8e3e]" },
  amazon: { icon: Store, tile: "bg-[#fff3e0] text-[#e47911]" },
  "tiktok shop": { icon: Zap, tile: "bg-[#111]/5 text-[#111]" },
  walmart: { icon: Store, tile: "bg-[#e8f0fe] text-[#0071ce]" },
  wholesale: { icon: Truck, tile: "bg-info-soft text-info" },
  manual: { icon: FileText, tile: "bg-success-soft text-success", label: "Created Manually" },
};

export function ChannelBadge({
  channel,
  store,
}: {
  channel: string;
  store?: string | null;
}) {
  const meta = CHANNEL_META[channel.toLowerCase()] ?? {
    icon: Store,
    tile: "bg-neutral-soft text-neutral",
  };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded",
          meta.tile
        )}
      >
        <Icon className="h-3 w-3" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12px] font-medium text-body">
          {meta.label ?? channel}
        </span>
        {store ? (
          <span className="truncate text-[11px] text-faint">{store}</span>
        ) : null}
      </span>
    </span>
  );
}
