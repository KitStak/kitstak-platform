"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarClock,
  FileSpreadsheet,
  History,
  Layers,
  ScanBarcode,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReportTileDef {
  name: string;
  description: string;
  icon: LucideIcon;
  /** Soft icon-tile color classes. */
  tile: string;
  /** Present → report is live and the tile links to it. Absent → "Soon". */
  href?: string;
}

interface ReportSectionDef {
  label: string;
  tiles: ReportTileDef[];
}

const SECTIONS: ReportSectionDef[] = [
  {
    label: "Inventory",
    tiles: [
      {
        name: "Inventory Snapshot",
        description: "Point-in-time on hand, allocated and damaged quantities for every SKU.",
        icon: Boxes,
        tile: "bg-primary-soft text-primary",
        href: "/reports/inventory-snapshot",
      },
      {
        name: "Kit Inventory",
        description: "Component availability and buildable quantity for kit SKUs.",
        icon: Layers,
        tile: "bg-info-soft text-info",
      },
      {
        name: "Serial Numbers",
        description: "Serial-tracked units with receipt and shipment lineage.",
        icon: ScanBarcode,
        tile: "bg-neutral-soft text-neutral",
      },
    ],
  },
  {
    label: "Fulfillment",
    tiles: [
      {
        name: "Shortage Report",
        description: "Order lines blocked by insufficient pickable inventory.",
        icon: TriangleAlert,
        tile: "bg-danger-soft text-danger",
      },
      {
        name: "Channel Sales",
        description: "Shipped units and revenue by sales channel and store.",
        icon: BarChart3,
        tile: "bg-success-soft text-success",
      },
      {
        name: "User Performance",
        description: "Picks, packs and counts completed per operator, per shift.",
        icon: UserRound,
        tile: "bg-warning-soft text-warning",
      },
    ],
  },
  {
    label: "Compliance",
    tiles: [
      {
        name: "Transaction History",
        description: "Every inbound receipt and outbound shipment with operator attribution.",
        icon: History,
        tile: "bg-info-soft text-info",
        href: "/reports/transaction-history",
      },
      {
        name: "Billing Export",
        description: "3PL billable activity rollup, ready for client invoicing.",
        icon: FileSpreadsheet,
        tile: "bg-neutral-soft text-neutral",
      },
    ],
  },
];

function ReportTileCard({ tile }: { tile: ReportTileDef }) {
  const Icon = tile.icon;
  const body = (
    <>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          tile.tile
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-foreground">
            {tile.name}
          </span>
          {!tile.href ? (
            <span className="rounded-full bg-neutral-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-faint">
              Soon
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-[12px] leading-4 text-faint">
          {tile.description}
        </span>
        {tile.href ? (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-primary opacity-80 transition-opacity group-hover:opacity-100">
            Run
            <ArrowRight
              className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        ) : (
          <span className="mt-1.5 text-[12px] font-medium text-faint">Coming soon</span>
        )}
      </span>
    </>
  );

  if (!tile.href) {
    return (
      <div
        aria-disabled="true"
        className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 opacity-80 shadow-xs"
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      href={tile.href}
      className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {body}
    </Link>
  );
}

export function ReportsHubPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Reports" }]}
        title="Reports"
        helper="Operational, inventory and compliance reporting for MLT1 – Main Fulfillment"
        actions={
          <>
            <Button variant="secondary">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Scheduled Exports
            </Button>
            <Button variant="primary">Create Custom Report</Button>
          </>
        }
      />
      <div className="ks-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-5">
        <div className="flex flex-col gap-7">
          {SECTIONS.map((section) => (
            <section key={section.label} aria-label={section.label}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                  {section.label}
                </h2>
                <div className="h-px flex-1 bg-border" aria-hidden />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {section.tiles.map((tile) => (
                  <ReportTileCard key={tile.name} tile={tile} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
