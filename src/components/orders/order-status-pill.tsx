/**
 * Shipment-order status pill with the Logiwa iO palette (measured on the MLT1 sandbox):
 * Open green, every in-process status one blue, Ready to Ship purple, Shortage rust.
 * Dark-mode variants keep the same hue at AA contrast on the dark surface.
 *
 * Module-local until the shared `status-colors` map adopts these tones
 * (docs/requests/orders-outbound.md REQ-R2-1); the shape and sizes match `<StatusPill>`.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { isPartialStatus, statusLabel } from "@/lib/status-colors";

export interface OrderTone {
  readonly light: { readonly bg: string; readonly fg: string };
  readonly dark: { readonly bg: string; readonly fg: string };
}

const GREEN: OrderTone = { light: { bg: "rgb(211,240,227)", fg: "rgb(23,135,77)" }, dark: { bg: "rgba(23,135,77,0.24)", fg: "rgb(110,214,160)" } };
const BLUE: OrderTone = { light: { bg: "rgb(213,229,242)", fg: "rgb(13,54,163)" }, dark: { bg: "rgba(59,110,230,0.24)", fg: "rgb(150,185,255)" } };
const PURPLE: OrderTone = { light: { bg: "rgb(223,206,245)", fg: "rgb(98,29,184)" }, dark: { bg: "rgba(140,82,220,0.26)", fg: "rgb(205,175,250)" } };
const RUST: OrderTone = { light: { bg: "rgb(247,233,228)", fg: "rgb(161,52,6)" }, dark: { bg: "rgba(200,80,30,0.24)", fg: "rgb(245,160,120)" } };
const HOLD: OrderTone = { light: { bg: "rgb(215,217,221)", fg: "rgb(57,67,87)" }, dark: { bg: "rgba(150,160,180,0.22)", fg: "rgb(200,207,220)" } };
const RED: OrderTone = { light: { bg: "rgb(251,219,222)", fg: "rgb(178,11,28)" }, dark: { bg: "rgba(220,50,60,0.24)", fg: "rgb(255,150,158)" } };
const GREY: OrderTone = { light: { bg: "rgb(227,230,232)", fg: "rgb(80,87,92)" }, dark: { bg: "rgba(150,160,170,0.2)", fg: "rgb(200,205,210)" } };

const ORDER_TONES: Readonly<Record<string, OrderTone>> = {
  open: GREEN,
  "ready to pick": BLUE,
  "picking started": BLUE,
  picked: BLUE,
  "ready to pack": BLUE,
  "packing started": BLUE,
  "ready to sort": BLUE,
  "sorting started": BLUE,
  "ready to load": BLUE,
  "loading started": BLUE,
  "ready to ship": PURPLE,
  shipped: GREEN,
  "partially shipped": GREEN,
  delivered: GREEN,
  shortage: RUST,
  "on hold": HOLD,
  cancelled: RED,
};

export function orderStatusTone(status: string | null | undefined): OrderTone {
  return ORDER_TONES[(status ?? "").trim().toLowerCase()] ?? GREY;
}

export function OrderStatusPill({ status, size = "md", className }: { readonly status: string; readonly size?: "sm" | "md"; readonly className?: string }) {
  const tone = orderStatusTone(status);
  const style = {
    "--pill-bg": tone.light.bg, "--pill-fg": tone.light.fg, "--pill-bg-dark": tone.dark.bg, "--pill-fg-dark": tone.dark.fg,
  } as React.CSSProperties;
  return (
    <span
      data-status={status}
      style={style}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold",
        "bg-(--pill-bg) text-(--pill-fg) in-data-[theme=dark]:bg-(--pill-bg-dark) in-data-[theme=dark]:text-(--pill-fg-dark)",
        size === "sm" ? "px-1.5 py-px text-[10px] leading-4" : "px-2 py-0.5 text-[11px] leading-4",
        className,
      )}
    >
      {statusLabel(status)}
      {isPartialStatus(status) ? (
        <span role="img" aria-label="Partial" title="Partial" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]" />
      ) : null}
    </span>
  );
}
