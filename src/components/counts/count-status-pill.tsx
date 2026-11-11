/**
 * Count status pill (M07): the shared StatusPill with two count-specific tone overrides.
 * Tones are shared label-palette tokens, so no dark-theme classes are needed here any more.
 */
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone, TONES, type StatusDomain, type StatusTone, type ToneName } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

/**
 * Count lifecycle tones (critic r5): the shared COUNT map paints Count Completed, Inventory Updated
 * and Recount Created all green, so a superseded line looked posted. Counts override two of them
 * until the foundation map changes (docs/requests/counts.md REQ-28): Count Completed is teal
 * (counted, waiting for Update Inv.), Inventory Updated stays green (posted), Recount Created is
 * purple (superseded).
 */
export const COUNT_TONE_OVERRIDES: Readonly<Record<string, StatusTone & { readonly tone: ToneName }>> = {
  "count completed": { ...TONES.teal, tone: "teal" },
  "recount created": { ...TONES.purple, tone: "purple" },
};
/** Static class strings (so Tailwind generates them). `!` beats the pill's inline style. */
const OVERRIDE_CLASS: Readonly<Record<string, string>> = {
  "count completed": "!bg-[var(--label-teal-subtle)] !text-[var(--label-teal-text)] [&>span:first-child]:!bg-[var(--label-teal)]",
  "recount created": "!bg-[var(--label-purple-subtle)] !text-[var(--label-purple-text)] [&>span:first-child]:!bg-[var(--label-purple)]",
};

/** Count tone for a status: the override when there is one, else the shared map. */
export function countToneOf(status: string, domain: StatusDomain = "count"): StatusTone {
  const o = domain === "count" ? COUNT_TONE_OVERRIDES[status.toLowerCase()] : undefined;
  return o ?? statusTone(status, domain);
}

/** Extra classes for a count pill: only the two overrides need any (name kept for callers). */
export function countPillDarkClass(status: string, domain: StatusDomain = "count"): string {
  return domain === "count" ? (OVERRIDE_CLASS[status.toLowerCase()] ?? "") : "";
}

export function CountStatusPill({ status, domain = "count", size, className }: { readonly status: string; readonly domain?: StatusDomain; readonly size?: "sm" | "md"; readonly className?: string }) {
  return <StatusPill status={status} domain={domain} size={size} className={cn(countPillDarkClass(status, domain), className)} />;
}
