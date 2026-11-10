"use client";

/** Data Setup frame: content on the left, the 19-item vertical nav (with value counts) on the right. */
import * as React from "react";
import { Hash } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { CODE_GENERATION_SLUG, LOOKUP_DEFS } from "@/lib/grid-defs/admin/lookups";
import { VerticalNav } from "@/components/ui/tabs";

export function DataSetupShell({ children }: { readonly children: React.ReactNode }) {
  const counts = useApiQuery<Record<string, number>>(["lookup-counts"], "/api/company/lookups/counts", { staleTime: 30_000 });
  const c = counts.data?.data ?? {};
  const items = [
    { key: CODE_GENERATION_SLUG, label: "Auto code generation", href: `/settings/data-setup/${CODE_GENERATION_SLUG}`, icon: Hash },
    ...LOOKUP_DEFS.map((d) => ({ key: d.slug, label: d.title, href: `/settings/data-setup/${d.slug}`, count: counts.data ? (c[d.type] ?? 0) : undefined })),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      <aside className="shrink-0 border-t border-border px-4 py-4 lg:w-[250px] lg:border-l lg:border-t-0 lg:py-3">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">Data setup</p>
        <VerticalNav ariaLabel="Data setup lookups" items={items} />
      </aside>
    </div>
  );
}
