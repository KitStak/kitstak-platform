"use client";

/**
 * Data Setup frame: content on the left, the vertical lookup nav (with value counts) on the
 * right. Below 1024px the nav collapses into a "Lookup" select above the content, so a tablet
 * user switches lookups without scrolling past the grid.
 */
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Hash } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { dataSetupNavDefs } from "@/lib/grid-defs/admin/lookups";
import { Select } from "@/components/ui/select";
import { VerticalNav } from "@/components/ui/tabs";

export function DataSetupShell({ children }: { readonly children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const counts = useApiQuery<Record<string, number>>(["lookup-counts"], "/api/company/lookups/counts", { staleTime: 30_000 });
  const c = counts.data?.data ?? {};
  const items = dataSetupNavDefs().map((d) => ({
    key: d.slug, label: d.title, href: `/settings/data-setup/${d.slug}`,
    ...(d.slug === "code-generation" ? { icon: Hash } : {}),
    count: counts.data && d.countType ? (c[d.countType] ?? 0) : undefined,
  }));
  const current = items.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))?.href ?? "";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row">
      <div className="border-b border-border px-6 py-2.5 lg:hidden">
        <div className="flex items-center gap-3 text-xs font-medium text-secondary">
          <span className="shrink-0">Data setup</span>
          <span className="min-w-0 flex-1 sm:max-w-sm">
            <Select aria-label="Data setup lookup" value={current} onChange={(v) => { if (v && v !== current) router.push(v); }}
              options={items.map((i) => ({ value: i.href, label: i.count === undefined ? i.label : `${i.label} (${i.count})` }))} />
          </span>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <aside className="hidden shrink-0 border-l border-border px-4 py-3 lg:block lg:w-[300px]">
        <p className="px-3 pb-2 text-2xs font-bold text-faint">Data setup</p>
        <VerticalNav ariaLabel="Data setup lookups" items={items} />
      </aside>
    </div>
  );
}
