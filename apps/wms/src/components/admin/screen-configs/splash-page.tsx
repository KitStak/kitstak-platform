"use client";

/** Screen Configuration splash (`/settings/screen-configuration`): choose the operation type. */
import Link from "next/link";
import { ChevronRight, PackageOpen, Smartphone } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { PageHeader } from "@/components/layout/page-header";

export function ScreenConfigSplashPage() {
  const q = useApiQuery<unknown[]>(["screen-configs-count"], "/api/screen-configs", { query: { ps: 1 }, staleTime: 30_000 });
  const total = q.data?.meta?.total;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Screen Configuration" helper="Build the mobile screens your operators follow, per warehouse and per purchase order." />
      <div className="mx-4 mb-6 mt-5 grid max-w-[1100px] grid-cols-1 items-center gap-8 rounded-xl border border-border bg-surface px-6 py-10 shadow-xs lg:mx-6 lg:grid-cols-[1fr_minmax(260px,380px)] lg:px-12">
        <div className="flex max-w-md flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Select operation type</h2>
            <p className="mt-1 text-sm text-secondary">Select a type to build your own configuration. Each configuration decides which steps the mobile screen shows and which ones are required.</p>
          </div>
          <Link href="/settings/screen-configuration/receiving"
            className="group flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-success-soft text-success"><PackageOpen className="h-5 w-5" aria-hidden /></span>
            <span className="flex-1">
              <span className="block text-base font-semibold text-foreground">Receiving</span>
              <span className="block text-xs text-secondary">Scan LP, lot, expiry, photo, dimensions and label steps{typeof total === "number" ? ` · ${total} ${total === 1 ? "configuration" : "configurations"}` : ""}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
          </Link>
          <p className="text-xs text-faint">More operation types (picking, packing, counting) are configured on their job types.</p>
        </div>
        <div aria-hidden className="relative mx-auto hidden h-72 w-full max-w-[320px] lg:block">
          <div className="absolute left-6 top-4 h-64 w-36 rounded-[22px] border-4 border-foreground/80 bg-surface-sunken p-2 shadow-md">
            <div className="mb-2 h-2 w-12 rounded-full bg-foreground/20" />
            {[0, 1, 2, 3].map((i) => <div key={i} className="mb-1.5 h-7 rounded-md bg-surface shadow-xs" />)}
            <div className="mt-3 h-7 rounded-md bg-success/80" />
          </div>
          <div className="absolute right-4 top-16 flex h-40 w-40 flex-col justify-center gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <Smartphone className="h-6 w-6 text-primary" />
            <div className="h-2 w-24 rounded-full bg-foreground/30" />
            <div className="h-2 w-20 rounded-full bg-foreground/15" />
            <div className="h-2 w-16 rounded-full bg-foreground/15" />
          </div>
        </div>
      </div>
    </div>
  );
}
