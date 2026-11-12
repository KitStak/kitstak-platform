"use client";

/**
 * Report Hub (`/reports`, BUILD_PLAN M13 §2). The catalog is the Reports mega-menu
 * (nav-config), filtered by the viewer's permissions, searchable, with per-user ★
 * favorites (stored in the viewer's grid prefs) and the viewer's real recent exports
 * (background_tasks).
 */
import * as React from "react";
import Link from "next/link";
import { ArrowRight, Download, FileSpreadsheet, Search, Star, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { NAV_ICONS } from "@/components/layout/nav-icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { DateCell } from "@/components/grid";
import { isAllowed } from "@/config/nav-access";
import { usePermissionSet } from "@/lib/permissions-client";
import { apiRequest } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { matchesReport, REPORT_CATALOG, REPORT_HUB_PREFS_KEY, type CatalogItem } from "@/lib/grid-defs/reports/catalog";
import { ScheduledReportsCard } from "./report-schedules";
import { ReportPill } from "./report-cells";

interface HubPrefs {
  readonly visible: readonly string[];
  readonly order: readonly string[];
  readonly widths: Readonly<Record<string, number>>;
  readonly density: "Large" | "Small";
  readonly pageSize: number;
  readonly pinned?: readonly string[];
}

const EMPTY_PREFS: HubPrefs = { visible: [], order: [], widths: {}, density: "Small", pageSize: 100, pinned: [] };

interface RecentExport {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly rowCount: number | null;
  readonly createdAt: string;
  readonly downloadHref: string | null;
  readonly errorMessage: string | null;
}

function useFavorites() {
  const prefs = useApiQuery<HubPrefs | null>(["grid-prefs", REPORT_HUB_PREFS_KEY], `/api/grid-prefs/${REPORT_HUB_PREFS_KEY}`);
  const [local, setLocal] = React.useState<readonly string[] | null>(null);
  const saved = prefs.data?.data?.pinned ?? [];
  const favorites = local ?? saved;
  const toggle = async (href: string, label: string) => {
    const next = favorites.includes(href) ? favorites.filter((h) => h !== href) : [...favorites, href];
    const previous = favorites;
    setLocal(next);
    try {
      await apiRequest(`/api/grid-prefs/${REPORT_HUB_PREFS_KEY}`, { method: "PUT", body: { ...(prefs.data?.data ?? EMPTY_PREFS), pinned: next } });
      toast.success("Success", next.includes(href) ? `${label} added to favorites` : `${label} removed from favorites`);
    } catch {
      setLocal(previous);
      toast.error("Error", "Could not save your favorites. Try again.");
    }
  };
  return { favorites, toggle, loading: prefs.isPending };
}

function ReportCard({ item, favorite, onToggle }: { readonly item: CatalogItem; readonly favorite: boolean; readonly onToggle: () => void }) {
  return (
    <div className="group relative flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5 transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-within:border-primary/50">
      <div className="min-w-0 flex-1">
        <Link href={item.href} className="text-base font-semibold text-foreground after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary/40">
          {item.label}
        </Link>
        <p className="mt-0.5 text-xs leading-[18px] text-secondary">{item.description || "Open the report."}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${item.label} from favorites` : `Add ${item.label} to favorites`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        className={cn(
          "relative z-10 -m-1 rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          favorite ? "text-warning" : "text-faint opacity-60 hover:text-secondary hover:opacity-100 group-hover:opacity-100",
        )}
      >
        <Star className="h-4 w-4" fill={favorite ? "currentColor" : "none"} aria-hidden />
      </button>
      <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </div>
  );
}

function RecentExports() {
  const q = useApiQuery<RecentExport[]>(["hub-recent-exports"], "/api/reports/export-history", {
    query: "sort=-createdAt&ps=10",
    // Poll only while one of the shown exports is still being generated, so the hub settles.
    refetchInterval: (query) => ((query.state.data?.data ?? []).slice(0, 6).some((r) => r.status !== "completed" && r.status !== "error") ? 5000 : false),
  });
  const rows = (q.data?.data ?? []).slice(0, 6);
  return (
    <section aria-labelledby="recent-exports" className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <h2 id="recent-exports" className="text-base font-semibold text-foreground">Recent exports</h2>
        <Link href="/reports/export-history" className="text-xs font-medium text-primary hover:underline">View all</Link>
      </div>
      {q.isPending ? (
        <div className="space-y-2 px-4 pb-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : q.error ? (
        <p className="px-4 pb-4 text-xs text-danger">Could not load your exports. <button type="button" className="font-medium underline" onClick={() => void q.refetch()}>Retry</button></p>
      ) : rows.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-secondary">No exports yet. Use Export As Excel at the bottom of any report and the file lands here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-[var(--success-text)]" aria-hidden />
              <div className="min-w-0 flex-1">
                {/* Title + status pill share the first line; the meta line below has the full width (never runs under the pill). */}
                <div className="flex min-w-0 items-start gap-2">
                  <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium leading-snug text-foreground" title={r.title}>{r.title}</span>
                  <span className="shrink-0"><ReportPill status={r.status} domain="export" /></span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-2xs text-faint" data-testid="export-meta">
                  <span className="min-w-0 truncate"><DateCell value={r.createdAt} /></span>
                  {r.rowCount !== null ? <span className="shrink-0 whitespace-nowrap">· {r.rowCount.toLocaleString("en-US")} rows</span> : null}
                </div>
              </div>
              {r.downloadHref ? (
                <a href={r.downloadHref} download className="rounded-md p-1 text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`Download ${r.title}`} title="Download">
                  <Download className="h-4 w-4" aria-hidden />
                </a>
              ) : <span className="w-6" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type View = "all" | "favorites";

export function ReportsHub({ initialPermissions = null }: { readonly initialPermissions?: readonly string[] | null } = {}) {
  const live = usePermissionSet();
  // Server-resolved permissions paint the catalog immediately; the live set replaces them once
  // /api/me arrives (a role change is picked up on the next refetch).
  const serverSet = React.useMemo(() => (initialPermissions ? new Set(initialPermissions) : null), [initialPermissions]);
  const permissions = live.isLoading && serverSet ? serverSet : live.permissions;
  const isLoading = live.isLoading && !serverSet;
  const { favorites, toggle } = useFavorites();
  const [term, setTerm] = React.useState("");
  const [view, setView] = React.useState<View>("all");

  const groups = React.useMemo(() => REPORT_CATALOG.map((g) => ({
    ...g,
    items: g.items.filter((i) => isAllowed(i.permission, permissions) && matchesReport(i, term) && (view === "all" || favorites.includes(i.href))),
  })).filter((g) => g.items.length > 0), [permissions, term, view, favorites]);

  const favoriteItems = React.useMemo(
    () => REPORT_CATALOG.flatMap((g) => g.items).filter((i) => favorites.includes(i.href) && isAllowed(i.permission, permissions)),
    [favorites, permissions],
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-10">
      <PageHeader title="Report Hub" helper="Every report you can open, grouped like the Reports menu. Star the ones you use most." />
      <div className="mx-6 mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-[420px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search reports" aria-label="Search reports" className="pl-9 pr-8" onKeyDown={(e) => { if (e.key === "Escape") setTerm(""); }} />
              {term ? (
                <button type="button" onClick={() => setTerm("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-secondary"><X className="h-3.5 w-3.5" aria-hidden /></button>
              ) : null}
            </div>
            <SegmentedControl<View>
              ariaLabel="Show"
              value={view}
              onChange={setView}
              options={[{ value: "all", label: "All reports" }, { value: "favorites", label: `Favorites (${favoriteItems.length})` }]}
            />
            <span className="ml-auto text-xs text-faint" aria-live="polite">{isLoading ? "" : `${total} report${total === 1 ? "" : "s"}`}</span>
          </div>

          {isLoading ? (
            <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={view === "favorites" && !term ? Star : Search}
              title={view === "favorites" && !term ? "No favorites yet" : "No reports match"}
              description={view === "favorites" && !term ? "Star a report to pin it here." : `Nothing matches "${term}". Try another word.`}
              action={term ? <Button onClick={() => setTerm("")}>Clear search</Button> : view === "favorites" ? <Button onClick={() => setView("all")}>Show all reports</Button> : undefined}
            />
          ) : (
            groups.map((g) => {
              const Icon = NAV_ICONS[g.icon];
              return (
                <section key={g.heading} aria-labelledby={`grp-${g.heading}`}>
                  <h2 id={`grp-${g.heading}`} className="mb-2 flex items-center gap-2 text-xs font-semibold text-secondary">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                    {g.heading}
                    <span className="font-normal normal-case tracking-normal text-faint">· {g.items.length}</span>
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {g.items.map((i) => <ReportCard key={i.href} item={i} favorite={favorites.includes(i.href)} onToggle={() => void toggle(i.href, i.label)} />)}
                  </div>
                </section>
              );
            })
          )}
        </div>
        <aside className="space-y-5">
          <section aria-labelledby="fav-list" className="rounded-lg border border-border bg-surface px-4 py-3.5">
            <h2 id="fav-list" className="mb-2 flex items-center gap-1.5 text-base font-semibold text-foreground"><Star className="h-4 w-4 text-warning" fill="currentColor" aria-hidden />Favorites</h2>
            {favoriteItems.length === 0 ? (
              <p className="text-xs text-secondary">Star any report and it shows up here, ready in one click.</p>
            ) : (
              <ul className="space-y-1">
                {favoriteItems.map((i) => (
                  <li key={i.href}><Link href={i.href} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-primary/5 hover:text-primary">{i.label}<ArrowRight className="h-3.5 w-3.5 text-faint" aria-hidden /></Link></li>
                ))}
              </ul>
            )}
          </section>
          <RecentExports />
          <ScheduledReportsCard />
        </aside>
      </div>
    </div>
  );
}
