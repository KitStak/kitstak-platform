"use client";

/** Round colored app icon used by the Apps cards, details and settings panels. */
import * as React from "react";
import { BarChart3, Bot, Boxes, Code2, KeyRound, Palette, Plug, Scale, Sparkles, Truck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppDef, AppTone } from "@/lib/grid-defs/admin/apps";

const ICONS: Readonly<Record<string, React.ComponentType<{ className?: string }>>> = {
  sparkles: Sparkles, palette: Palette, users: Users, chart: BarChart3, scale: Scale, key: KeyRound, boxes: Boxes, code: Code2, truck: Truck, plug: Plug, robot: Bot,
};

const TONES: Readonly<Record<AppTone, string>> = {
  violet: "bg-[#EFE7FB] text-[#621DB8]", blue: "bg-[#D5E5F2] text-[#0D36A3]", teal: "bg-[#D0F3EE] text-[#0E8C7A]", amber: "bg-[#FDF1D3] text-[#9A6B00]",
  rose: "bg-[#FBDBDE] text-danger", slate: "bg-[#E3E6E8] text-[#394357]", green: "bg-[#D3F0E3] text-success", indigo: "bg-[#E2E5FB] text-[#3B3FB6]",
};

export function AppIcon({ def, size = "md" }: { readonly def: AppDef | null; readonly size?: "md" | "lg" }) {
  const Icon = ICONS[def?.icon ?? "plug"] ?? Plug;
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full", TONES[def?.tone ?? "slate"], size === "lg" ? "h-14 w-14" : "h-11 w-11")}>
      <Icon className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} aria-hidden />
    </span>
  );
}

