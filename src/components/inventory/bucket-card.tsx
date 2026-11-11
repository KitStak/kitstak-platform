"use client";

/** Read-only summary of one bucket (drawer headers, Transfer Product, Change Attributes). */
import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { DamagePill, InventoryStatusPill, ProductThumb, formatQty } from "./inventory-shared";
import type { BucketRow } from "./by-location-types";
import { useInventoryDates } from "./inventory-dates";

export function Fact({ label, children, className }: { readonly label: string; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-2xs font-medium text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-body" title={typeof children === "string" || typeof children === "number" ? String(children) : undefined}>{children}</dd>
    </div>
  );
}

export function BucketCard({ row, compact = false, locationLabel = "Location" }: { readonly row: BucketRow; readonly compact?: boolean; readonly locationLabel?: string }) {
  const dates = useInventoryDates();
  const date = (v: string | null) => (v ? dates.calendar(v) : "-");
  return (
    <section aria-label={`${row.sku} in ${row.location}`} className="rounded-lg border border-border bg-surface-sunken/60 p-3">
      <div className="flex items-start gap-3">
        <ProductThumb src={row.imageUrl} alt={row.sku} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{row.sku}</span>
            <InventoryStatusPill status={row.status} />
            {row.damageReason ? <DamagePill reason={row.damageReason} /> : null}
            {row.countLockPlan ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-semibold leading-4 text-warning" title={`Locked by count plan ${row.countLockPlan}`}>
                <Lock className="h-3 w-3" aria-hidden />Count {row.countLockPlan}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-secondary">{row.productName} · {row.client}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums text-foreground">{formatQty(row.totalPackQty)}</div>
          <div className="text-2xs text-faint">{row.packType}{row.unitsPerPack > 1 ? ` (${formatQty(row.totalQty)} ${row.uomPackType})` : ""}</div>
        </div>
      </div>
      <dl className={cn("mt-3 grid gap-x-4 gap-y-2", compact ? "grid-cols-3" : "grid-cols-4")}>
        <Fact label={locationLabel}>{row.lpNumber ? `${row.location} / ${row.lpNumber}` : row.location}</Fact>
        <Fact label="Free qty">{formatQty(row.freePackQty)}</Fact>
        <Fact label="Allocated">{formatQty(row.allocatedPackQty)}</Fact>
        <Fact label="Lot/Batch">{row.lotNumber ?? "-"}</Fact>
        <Fact label="Expiry">{date(row.expiryDate)}</Fact>
        <Fact label="Production">{date(row.productionDate)}</Fact>
        {/* Two columns so "MLT1 - Main Fulfillment" is never cut off (Area lives in the Attributes tab). */}
        {compact ? null : <Fact label="Warehouse" className="col-span-2">{row.warehouse}</Fact>}
      </dl>
    </section>
  );
}
