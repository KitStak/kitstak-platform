"use client";

import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const PALETTE = ["#2E5CE6", "#621DB8", "#17874D", "#A13406", "#026AA2", "#B20B1C", "#0F8C7A", "#394357"] as const;

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** Stable colour per name so the same user always gets the same tile. */
export function avatarColor(name: string | null | undefined): string {
  let hash = 0;
  for (const ch of name ?? "") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0];
}

const SIZES = { xs: "h-5 w-5 text-2xs", sm: "h-6 w-6 text-2xs", md: "h-8 w-8 text-xs", lg: "h-10 w-10 text-base" } as const;

/** Both tones render neutral initials now; `brand` is kept for the top bar call sites. */
export type AvatarTone = "auto" | "brand";

export interface AvatarProps {
  readonly name: string | null | undefined;
  readonly src?: string | null;
  readonly size?: keyof typeof SIZES;
  readonly tone?: AvatarTone;
  readonly className?: string;
}

export function Avatar({ name, src, size = "md", tone = "auto", className }: AvatarProps) {
  const rootClass = cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full align-middle", SIZES[size], className);
  // Neutral initials in both tones: people are told apart by initials, not by a colour.
  const fallbackClass = cn("flex h-full w-full items-center justify-center bg-pressed font-medium", tone === "brand" ? "text-fg" : "text-fg-secondary");
  const fallbackStyle = undefined;
  // Initials-only avatars render as plain markup so they are present in the server HTML
  // (Radix's Fallback only mounts after hydration, leaving an empty slot at first paint).
  if (!src) {
    return (
      <span className={rootClass} title={name ?? undefined}>
        <span className={fallbackClass} style={fallbackStyle}>{initialsOf(name)}</span>
      </span>
    );
  }
  return (
    <AvatarPrimitive.Root className={rootClass} title={name ?? undefined}>
      <AvatarPrimitive.Image src={src} alt={name ?? ""} className="h-full w-full object-cover" />
      <AvatarPrimitive.Fallback delayMs={300} className={fallbackClass} style={fallbackStyle}>
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
