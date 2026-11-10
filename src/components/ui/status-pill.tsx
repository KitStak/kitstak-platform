import * as React from "react";
import { ArrowUp, ChevronsUp, FileText, ShoppingBag, Store, Truck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { differenceTone, isPartialStatus, pillStyle, statusLabel, statusTone, type StatusDomain } from "@/lib/status-colors";

/**
 * Status pill (BUILD_PLAN 0.5). Colours come from `@/lib/status-colors`; pass `domain`
 * for entity-specific semantics (e.g. "Open" is green for orders, teal for shipment
 * plans). Without a domain the generic map is used, so existing call sites keep working.
 */
export function StatusPill({
  status,
  domain = "generic",
  partial,
  size = "md",
  className,
}: {
  status: string;
  domain?: StatusDomain;
  /** Force/disable the half-filled "partial" dot; defaults to statuses starting with "Partially". */
  partial?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const tone = statusTone(status, domain);
  const showPartial = partial ?? isPartialStatus(status);
  return (
    <span
      data-status={status}
      style={pillStyle(tone)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap",
        size === "sm" ? "px-1.5 py-px text-[10px] leading-4" : "px-2 py-0.5 text-[11px] leading-4",
        className
      )}
    >
      {statusLabel(status)}
      {showPartial ? (
        // 6px half-filled dot: reads as "partial" without a stray letter glyph.
        <span
          role="img"
          aria-label="Partial"
          title="Partial"
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border"
          style={{ borderColor: tone.fg, background: `linear-gradient(90deg, ${tone.fg} 50%, transparent 50%)` }}
        />
      ) : null}
    </span>
  );
}

/** One soft treatment for every priority; High gets an up arrow, Urgent a double arrow. */
export function PriorityFlag({ priority }: { priority: string | null }) {
  if (!priority || priority.toLowerCase() === "none") {
    return <span className="text-faint text-[12px]">—</span>;
  }
  const key = priority.toLowerCase();
  const tone = statusTone(priority, "priority");
  const Icon = key === "urgent" ? ChevronsUp : key === "high" ? ArrowUp : null;
  return (
    <span
      data-priority={key}
      style={pillStyle(tone)}
      className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
    >
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {statusLabel(priority)}
    </span>
  );
}

/** Canonical name for the shared priority pill; every grid uses this one map. */
export const PriorityPill = PriorityFlag;

/** Receiving difference pill: "-3" red-orange, "+2" green, "0" grey. */
export function DifferencePill({ value, className }: { value: number; className?: string }) {
  const tone = differenceTone(value);
  return (
    <span style={pillStyle(tone)} className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", className)}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

/** Green Yes / grey No pill. */
export function YesNoPill({ value }: { value: boolean }) {
  return <StatusPill status={value ? "Yes" : "No"} domain="yesNo" />;
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
