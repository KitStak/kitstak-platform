/**
 * Count status pill (M07): the shared StatusPill plus dark-theme tones. The shared pill paints
 * light-theme fills inline, which glare on the navy surface; under `[data-theme=dark]` these
 * classes switch each tone to its hue at ~16% alpha with a light foreground (DESIGN_SPEC dark
 * parity). Tracked for every module as REQ-6; this keeps the count pages correct meanwhile.
 */
import { StatusPill } from "@/components/ui/status-pill";
import { statusTone, statusToneName, type StatusDomain, type ToneName } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

/** Full class strings (static, so Tailwind generates them). `!` beats the pill's inline style. */
const DARK: Partial<Record<ToneName, string>> = {
  green: "[[data-theme=dark]_&]:!bg-[rgba(34,197,94,0.16)] [[data-theme=dark]_&]:!text-[#4ADE80]",
  exportDone: "[[data-theme=dark]_&]:!bg-[rgba(34,197,94,0.16)] [[data-theme=dark]_&]:!text-[#4ADE80]",
  blue: "[[data-theme=dark]_&]:!bg-[rgba(59,130,246,0.18)] [[data-theme=dark]_&]:!text-[#93C5FD]",
  readyBlue: "[[data-theme=dark]_&]:!bg-[rgba(59,130,246,0.18)] [[data-theme=dark]_&]:!text-[#93C5FD]",
  indigo: "[[data-theme=dark]_&]:!bg-[rgba(129,140,248,0.18)] [[data-theme=dark]_&]:!text-[#A5B4FC]",
  purple: "[[data-theme=dark]_&]:!bg-[rgba(168,85,247,0.18)] [[data-theme=dark]_&]:!text-[#D8B4FE]",
  shortage: "[[data-theme=dark]_&]:!bg-[rgba(249,115,22,0.16)] [[data-theme=dark]_&]:!text-[#FDBA74]",
  negativeDiff: "[[data-theme=dark]_&]:!bg-[rgba(249,115,22,0.16)] [[data-theme=dark]_&]:!text-[#FDBA74]",
  hold: "[[data-theme=dark]_&]:!bg-[rgba(148,163,184,0.18)] [[data-theme=dark]_&]:!text-[#CBD5E1]",
  red: "[[data-theme=dark]_&]:!bg-[rgba(239,68,68,0.18)] [[data-theme=dark]_&]:!text-[#FCA5A5]",
  priorityHigh: "[[data-theme=dark]_&]:!bg-[rgba(239,68,68,0.18)] [[data-theme=dark]_&]:!text-[#FCA5A5]",
  grey: "[[data-theme=dark]_&]:!bg-[rgba(148,163,184,0.14)] [[data-theme=dark]_&]:!text-[#CBD5E1]",
  amber: "[[data-theme=dark]_&]:!bg-[rgba(245,158,11,0.16)] [[data-theme=dark]_&]:!text-[#FCD34D]",
  teal: "[[data-theme=dark]_&]:!bg-[rgba(20,184,166,0.16)] [[data-theme=dark]_&]:!text-[#5EEAD4]",
};

/**
 * Count lifecycle tones (critic r5): the shared COUNT map paints Count Completed, Inventory Updated
 * and Recount Created all green, so a superseded line looked posted. Counts override two of them
 * until the foundation map changes (docs/requests/counts.md REQ-28): Count Completed is teal
 * (counted, waiting for Update Inv.), Inventory Updated stays green (posted), Recount Created is
 * purple (superseded).
 */
export const COUNT_TONE_OVERRIDES: Readonly<Record<string, { readonly bg: string; readonly fg: string; readonly tone: ToneName }>> = {
  "count completed": { bg: "#D0F3EE", fg: "#0F8C7A", tone: "teal" },
  "recount created": { bg: "#DFCEF5", fg: "#621DB8", tone: "purple" },
};
const LIGHT_OVERRIDE: Readonly<Record<string, string>> = {
  "count completed": "!bg-[#D0F3EE] !text-[#0F8C7A]",
  "recount created": "!bg-[#DFCEF5] !text-[#621DB8]",
};

/** Count tone for a status: the override when there is one, else the shared map. */
export function countToneOf(status: string, domain: StatusDomain = "count"): { readonly bg: string; readonly fg: string } {
  const o = domain === "count" ? COUNT_TONE_OVERRIDES[status.toLowerCase()] : undefined;
  return o ?? statusTone(status, domain);
}

export function countPillDarkClass(status: string, domain: StatusDomain = "count"): string {
  const o = domain === "count" ? COUNT_TONE_OVERRIDES[status.toLowerCase()] : undefined;
  if (o) return cn(LIGHT_OVERRIDE[status.toLowerCase()], DARK[o.tone]);
  return DARK[statusToneName(status, domain)] ?? DARK.grey ?? "";
}

export function CountStatusPill({ status, domain = "count", size, className }: { readonly status: string; readonly domain?: StatusDomain; readonly size?: "sm" | "md"; readonly className?: string }) {
  return <StatusPill status={status} domain={domain} size={size} className={cn(countPillDarkClass(status, domain), className)} />;
}
