"use client";

/**
 * Printouts & Labels types page (`/settings/printouts`): category vertical nav with correct
 * counts (All / Lists / Labels / Billings / Others), search, and one card per printout type
 * with its template count, printer type and BETA badge. A card opens the per-type list.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, FileText, Printer, Receipt, Search, Tag } from "lucide-react";
import { z } from "zod";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, CATEGORY_SLUGS, type CategorySlug } from "@/lib/grid-defs/admin/printouts";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TextField } from "@/components/ui/text-field";
import { VerticalNav } from "@/components/ui/tabs";

const typeSchema = z.object({ key: z.string(), name: z.string(), category: z.string(), beta: z.boolean(), printerType: z.string(), count: z.number(), implemented: z.boolean() });
export type PrintoutTypeInfo = z.infer<typeof typeSchema>;

export function usePrintoutTypes(): { readonly types: readonly PrintoutTypeInfo[]; readonly loading: boolean; readonly error: string | null; readonly refetch: () => void } {
  const q = useApiQuery<unknown>(["printout-types"], "/api/printouts/types", { staleTime: 15_000 });
  const parsed = z.array(typeSchema).safeParse(q.data?.data);
  return { types: parsed.success ? parsed.data : [], loading: q.isPending, error: q.isError ? q.error.message : null, refetch: () => void q.refetch() };
}

const CATEGORY_ICON = { lists: FileText, labels: Tag, billings: Receipt, others: Printer } as const;

function isCategory(v: string | null): v is CategorySlug {
  return v !== null && (CATEGORY_SLUGS as readonly string[]).includes(v);
}

function TypeCard({ t }: { readonly t: PrintoutTypeInfo }) {
  const Icon = CATEGORY_ICON[t.category as keyof typeof CATEGORY_ICON] ?? FileText;
  return (
    <Link href={`/settings/printouts/${t.key}`}
      className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon className="h-5 w-5" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-base font-semibold text-foreground">{t.name}</span>
          {t.beta ? <Badge tone="info" size="sm">BETA</Badge> : null}
        </span>
        <span className="mt-0.5 block text-xs text-secondary">{t.printerType}</span>
        <span className="mt-2 flex items-center gap-2 text-xs">
          <span className={cn("tabular-nums font-medium", t.count ? "text-body" : "text-faint")}>{t.count} {t.count === 1 ? "template" : "templates"}</span>
          {!t.implemented ? <Badge tone="outline" size="sm">Generic layout</Badge> : null}
        </span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
    </Link>
  );
}

export function PrintoutTypesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("category");
  const category: CategorySlug = isCategory(raw) ? raw : "all";
  const [search, setSearch] = React.useState("");
  const { types, loading, error, refetch } = usePrintoutTypes();
  const counts = React.useMemo(() => Object.fromEntries(CATEGORY_SLUGS.map((c) => [c, c === "all" ? types.length : types.filter((t) => t.category === c).length])) as Record<CategorySlug, number>, [types]);
  const needle = search.trim().toLowerCase();
  const visible = types.filter((t) => (category === "all" || t.category === category) && (!needle || t.name.toLowerCase().includes(needle)));
  const navItems = CATEGORY_SLUGS.map((c) => ({ key: c, label: CATEGORY_LABELS[c], count: loading ? undefined : counts[c] }));
  const select = (key: string) => {
    const next = new URLSearchParams(params.toString());
    if (key === "all") next.delete("category"); else next.set("category", key);
    router.replace(`/settings/printouts${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Printouts & Labels" helper="Choose a printout type to list, design and assign its templates." />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6 pt-4 lg:flex-row lg:gap-6 lg:px-6">
        <aside className="shrink-0 lg:w-[220px]">
          <p className="mb-3 flex h-9 items-center px-3 text-2xs font-bold text-faint">Categories</p>
          <VerticalNav ariaLabel="Printout categories" items={navItems} active={category} onChange={select} />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col gap-3" aria-label={`${CATEGORY_LABELS[category]} printout types`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">{CATEGORY_LABELS[category]} <span className="font-normal text-faint">· {visible.length}</span></h2>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
              <TextField aria-label="Search printout types" placeholder="Search printout types" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-[92px] w-full" />)}</div>
          ) : error ? (
            <EmptyState title="Couldn't load printout types" description={error} action={<Button onClick={refetch}>Retry</Button>} />
          ) : visible.length === 0 ? (
            <EmptyState title="No printout types match" description="Try another name or category." action={<Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button>} />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((t) => <TypeCard key={t.key} t={t} />)}</div>
          )}
        </section>
      </div>
    </div>
  );
}
