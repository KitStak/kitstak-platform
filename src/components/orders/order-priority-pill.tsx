import type { ComponentType } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Unified priority treatment for the Shipment Orders grid.
 *
 * The shared `PriorityFlag` (src/components/ui/status-pill.tsx, read-only)
 * renders High as a red pill with an up arrow but Medium/Low as plain gray
 * pills with no icon, so the column mixed two visual languages. This local
 * pill applies one pattern — direction arrow + tinted pill — to every level:
 *
 * - Urgent: solid danger pill, up arrow
 * - High:   danger-soft bg / danger text, up arrow   (red-50 / red-700 scale)
 * - Medium: warning-soft bg / warning text, right arrow (amber-50 / amber-700)
 * - Low:    neutral-soft bg / neutral text, down arrow  (slate scale)
 *
 * Tokens come from the design-spec palette so dark mode tracks automatically.
 */
interface PriorityStyle {
  pill: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const FALLBACK_STYLE: PriorityStyle = {
  pill: "bg-warning-soft text-warning",
  icon: ArrowRight,
};

const PRIORITY_STYLES: Record<string, PriorityStyle> = {
  urgent: { pill: "bg-danger text-white", icon: ArrowUp },
  high: { pill: "bg-danger-soft text-danger", icon: ArrowUp },
  medium: FALLBACK_STYLE,
  low: { pill: "bg-neutral-soft text-neutral", icon: ArrowDown },
};

export interface OrderPriorityPillProps {
  priority: string | null;
}

export function OrderPriorityPill({ priority }: OrderPriorityPillProps) {
  const normalized = priority?.toLowerCase() ?? "";
  if (!normalized || normalized === "none") {
    return <span className="text-faint text-[12px]">—</span>;
  }
  const style = PRIORITY_STYLES[normalized] ?? FALLBACK_STYLE;
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        style.pill
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {priority}
    </span>
  );
}
