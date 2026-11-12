"use client";

/** Channel / carrier logo tile and the "provider · store" cell used across logs and monitoring grids. */
import * as React from "react";
import { CARRIERS, CHANNELS, monogramSvg, svgDataUri } from "@/lib/channel-catalog";
import { cn } from "@/lib/utils";
import { brandMarkSvg } from "./brand-marks";

const SANDBOX = { name: "KitStak Sandbox", svg: monogramSvg("KS", "#2E6BE6") };

export function providerMeta(kind: "channel" | "carrier", key: string, isSandbox = false): { name: string; svg: string } {
  if (isSandbox || key === "kitstaks-sandbox") return kind === "channel" ? { name: `${(CHANNELS.find((c) => c.key === key)?.name ?? "Store")} · Sandbox`, svg: SANDBOX.svg } : SANDBOX;
  const e = (kind === "channel" ? CHANNELS : CARRIERS).find((c) => c.key === key || (key === "usps-stamps" && c.key === "stamps-com") || (key === "custom" && c.key === "custom-carrier"));
  return e ? { name: e.name, svg: brandMarkSvg(kind, e.key, e.logoSvg) } : { name: key, svg: monogramSvg(key.slice(0, 2).toUpperCase(), "#475467") };
}

export function ProviderLogo({ kind, provider, isSandbox, size = 20, className }: { readonly kind: "channel" | "carrier"; readonly provider: string; readonly isSandbox?: boolean; readonly size?: number; readonly className?: string }) {
  const meta = providerMeta(kind, provider, isSandbox);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={svgDataUri(meta.svg)} alt={meta.name} width={size} height={size} className={cn("shrink-0 rounded", className)} />;
}

export function ProviderCell({ kind, provider, isSandbox, label }: { readonly kind: "channel" | "carrier"; readonly provider: string; readonly isSandbox?: boolean; readonly label?: string }) {
  const meta = providerMeta(kind, provider, isSandbox);
  // In grid cells a sandbox channel reads "Shopify" next to the blue KS sandbox tile (full "Shopify · Sandbox" on hover) so it fits.
  const short = label ?? (kind === "channel" && isSandbox ? meta.name.replace(/ · Sandbox$/, "") : meta.name);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={meta.name}>
      <ProviderLogo kind={kind} provider={provider} isSandbox={isSandbox} />
      <span className="truncate">{short}</span>
    </span>
  );
}

export function providerOptions(kind: "channel" | "carrier"): readonly { value: string; label: string }[] {
  return (kind === "channel" ? CHANNELS : CARRIERS).map((c) => ({ value: c.key, label: c.name }));
}

