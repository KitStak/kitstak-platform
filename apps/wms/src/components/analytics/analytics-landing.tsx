"use client";

/**
 * Analytics landing (`/analytics`, `/analytics/labor`, `/analytics/operational`):
 * cards for every dashboard in the Analytics menu the viewer may open, so the
 * breadcrumb and hand-edited URLs never dead-end (critic R4).
 */
import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isAllowed } from "@/config/nav-access";
import { usePermissionSet } from "@/lib/permissions-client";
import { ANALYTICS_CATALOG } from "@/lib/grid-defs/reports/catalog";

const SECTION_HEADING = { labor: "Labor Analytics", operational: "Operational Analytics" } as const;

export function AnalyticsLanding({ section }: { readonly section?: "labor" | "operational" }) {
  const { permissions, isLoading } = usePermissionSet();
  const heading = section ? SECTION_HEADING[section] : undefined;
  const groups = ANALYTICS_CATALOG
    .filter((g) => !heading || g.heading === heading)
    .map((g) => ({ ...g, items: g.items.filter((i) => isAllowed(i.permission, permissions)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-10">
      <PageHeader
        title={heading ?? "Analytics"}
        helper="Pick a dashboard. Each chart opens the matching filtered report."
      />
      <div className="mx-6 mt-4 space-y-5">
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : groups.length === 0 ? (
          <EmptyState icon={BarChart3} title="No dashboards available" description="Your role cannot open any analytics dashboard. Ask an admin for access." />
        ) : (
          groups.map((g) => {
            const Icon = NAV_ICONS[g.icon];
            return (
              <section key={g.heading} aria-labelledby={`an-${g.heading}`}>
                <h2 id={`an-${g.heading}`} className="mb-2 flex items-center gap-2 text-xs font-semibold text-secondary">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                  {g.heading}
                  <span className="font-normal normal-case tracking-normal text-faint">· {g.items.length}</span>
                </h2>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {g.items.map((i) => (
                    <Link key={i.href} href={i.href} className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                      <div className="min-w-0 flex-1">
                        <span className="text-base font-semibold text-foreground">{i.label}</span>
                        <p className="mt-0.5 text-xs leading-[18px] text-secondary">{i.description || "Open the dashboard."}</p>
                      </div>
                      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
