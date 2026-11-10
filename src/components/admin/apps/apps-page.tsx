"use client";

/**
 * Apps (`/settings/apps?tab=popular|active|all&q=`): hero with search, Popular / Active / All
 * tabs, app cards (icon, name, description, gear, Details, Activate / ✓ Activated). Activating
 * gates real features (AI Jobs, analytics, Scale, Two Boxes, SSO). Deactivation is confirmed.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ExternalLink, History, Search, Settings2 } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { APP_TABS, type AppTab } from "@/lib/grid-defs/admin/apps";
import { PageHeader } from "@/components/layout/page-header";

import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { Callout } from "@/components/ui/callout";
import type { AppRow } from "@/server/repositories/apps";
import { EntityChangeLogDrawer, NO_PERMISSION, useAction, usePagePerms } from "../admin-shared";
import { AppSettingsDrawer } from "./app-settings-drawer";
import { AppIcon } from "./app-icon";

const TAB_LABELS: Readonly<Record<AppTab, string>> = { popular: "Popular apps", active: "Active apps", all: "All apps" };

function AppCard({ app, canManage, onDetails, onSettings, onActivate, onDeactivate, busy }: {
  readonly app: AppRow; readonly canManage: boolean; readonly busy: boolean;
  readonly onDetails: () => void; readonly onSettings: () => void; readonly onActivate: () => void; readonly onDeactivate: () => void;
}) {
  const hasSettings = (app.def?.settings.length ?? 0) > 0;
  return (
    <article className={cn("group relative flex flex-col rounded-xl border bg-surface p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md", app.isActive ? "border-success/40" : "border-border")}>
      <div className="flex items-start gap-3">
        <AppIcon def={app.def} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-foreground">{app.name}</h3>
          <p className="text-[11px] uppercase tracking-wide text-faint">{app.category}</p>
        </div>
        {hasSettings ? (
          <DisabledReason reason={canManage ? null : NO_PERMISSION}>
            <Button size="icon-sm" variant="ghost" aria-label={`${app.name} settings`} disabled={!canManage} onClick={onSettings}><Settings2 className="h-4 w-4" /></Button>
          </DisabledReason>
        ) : null}
      </div>
      <p className="mt-3 line-clamp-2 min-h-[36px] text-[12.5px] leading-[18px] text-secondary">{app.description}</p>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button size="sm" variant="ghost" onClick={onDetails}>Details</Button>
        {app.isActive ? (
          canManage ? (
            <Tooltip content="Click to deactivate">
              <button type="button" disabled={busy} onClick={onDeactivate} aria-label={`${app.name} is activated. Click to deactivate`}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-semibold text-success transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-wait disabled:opacity-60">
                <Check className="h-3.5 w-3.5" aria-hidden />Activated
              </button>
            </Tooltip>
          ) : (
            <DisabledReason reason={NO_PERMISSION}>
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-semibold text-success">
                <Check className="h-3.5 w-3.5" aria-hidden />Activated
              </span>
            </DisabledReason>
          )
        ) : (
          <DisabledReason reason={canManage ? null : NO_PERMISSION}>
            <Button size="sm" variant="primary" disabled={!canManage || busy} onClick={onActivate}>Activate</Button>
          </DisabledReason>
        )}
      </div>
    </article>
  );
}

function DetailsDialog({ app, onClose, onLog, onSettings, onActivate, onDeactivate, canManage, busy }: {
  readonly app: AppRow | null; readonly onClose: () => void; readonly onLog: () => void; readonly onSettings: () => void;
  readonly onActivate: () => void; readonly onDeactivate: () => void; readonly canManage: boolean; readonly busy: boolean;
}) {
  const fmt = useFormat();
  return (
    <Dialog open={app !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        {app ? (
          <>
            <DialogHeader title={app.name} description={app.category} />
            <DialogBody className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <AppIcon def={app.def} size="lg" />
                <p className="text-[13px] text-body">{app.description}</p>
              </div>
              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-[0.06em] text-secondary">What it unlocks</h4>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {(app.def?.unlocks ?? []).map((u) => <li key={u} className="flex items-start gap-2 text-[13px] text-body"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />{u}</li>)}
                </ul>
              </section>
              <p className="rounded-lg bg-surface-sunken px-3 py-2 text-[12.5px] text-secondary">
                {app.isActive ? <>Activated {app.activatedAt ? fmt.gridDateTime(app.activatedAt) : ""}{app.activatedByName ? ` by ${app.activatedByName}` : ""}.</> : "Not activated yet."}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={onLog}><History className="h-4 w-4" aria-hidden />Change log</Button>
              <span className="flex-1" aria-hidden />
              <DisabledReason reason={canManage ? null : NO_PERMISSION}>
                {app.isActive
                  ? <Button variant="secondary" className="text-danger hover:text-danger" disabled={!canManage || busy} onClick={onDeactivate}>Deactivate</Button>
                  : <Button variant="secondary" disabled={!canManage || busy} onClick={onActivate}>Activate</Button>}
              </DisabledReason>
              {app.isActive && (app.def?.settings.length ?? 0) > 0 ? <DisabledReason reason={canManage ? null : NO_PERMISSION}><Button variant="secondary" disabled={!canManage} onClick={onSettings}><Settings2 className="h-4 w-4" aria-hidden />Settings</Button></DisabledReason> : null}
              {app.isActive && app.def?.openHref ? <Link href={app.def.openHref} className={buttonVariants({ variant: "primary" })}>{app.def.openLabel ?? "Open"}<ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link> : <Button variant="primary" onClick={onClose}>Close</Button>}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function AppsPage() {
  const perms = usePagePerms("settings.company_settings", ["update"] as const);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: AppTab = APP_TABS.find((t) => t === params.get("tab")) ?? "popular";
  const [search, setSearch] = React.useState(params.get("q") ?? "");
  const q = useApiQuery<readonly AppRow[]>(["apps"], "/api/apps", { staleTime: 0 });
  const action = useAction([["apps"], ["me"]]);
  const [details, setDetails] = React.useState<string | null>(null);
  const [settingsFor, setSettingsFor] = React.useState<string | null>(null);
  const [deactivate, setDeactivate] = React.useState<AppRow | null>(null);
  const [log, setLog] = React.useState<AppRow | null>(null);
  const apps = q.data?.data ?? [];
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  };
  const needle = search.trim().toLowerCase();
  const visible = apps
    .filter((a) => (tab === "popular" ? a.def?.popular : tab === "active" ? a.isActive : true))
    .filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.description.toLowerCase().includes(needle) || a.category.toLowerCase().includes(needle));
  const counts = { popular: apps.filter((a) => a.def?.popular).length, active: apps.filter((a) => a.isActive).length, all: apps.length };
  const byKey = (key: string | null) => apps.find((a) => a.key === key) ?? null;

  const activate = async (app: AppRow) => {
    // SSO can't go live unconfigured: open its settings first instead of a refused activation.
    const ssoReady = app.key !== "sso" || Boolean(app.secretHints?.clientSecret || (typeof app.settings.certificate === "string" && app.settings.certificate.trim()));
    if (!ssoReady) {
      toast.info("Set up single sign-on first", "Enter your identity provider details, save, then activate.");
      setSettingsFor(app.key);
      return;
    }
    const res = await action.run<AppRow>(`/api/apps/${app.key}`, "PATCH", { isActive: true });
    if (res) {
      toast.success(`${app.name} activated`, app.def?.unlocks[0] ? `${app.def.unlocks[0]} is now available.` : "The app is ready to use.");
      if ((app.def?.settings.length ?? 0) > 0) setSettingsFor(app.key);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Apps" }]} title="Apps" helper="Turn on add-ons for your account. Each app unlocks screens and actions as soon as it is activated." />
      {!perms.loading && !perms.update ? (
        <div className="mx-6 mt-2"><Callout variant="info" title="Read-only access">You can browse apps, but only users with Company Settings update permission can activate, deactivate or configure them.</Callout></div>
      ) : null}
      <div className="mx-6 mt-2 overflow-hidden rounded-2xl border border-border bg-[radial-gradient(120%_140%_at_0%_0%,#EFE7FB_0%,#E2E5FB_45%,#F5F7FA_100%)] px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#621DB8]">App directory</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-foreground">Discover apps for KitStaks</h2>
            <p className="mt-1 text-[13px] text-secondary">{q.isLoading ? "Loading the app catalog…" : q.isError ? "The app catalog could not be loaded." : counts.all === 0 ? "No apps are installed on this account yet." : <>{counts.active} of {counts.all} apps active. Activate one to unlock it for every user with access.</>}</p>
            <label className="relative mt-4 flex max-w-md items-center">
              <Search className="pointer-events-none absolute left-3 h-4 w-4 text-faint" aria-hidden />
              <span className="sr-only">Search apps</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => setParam("q", search.trim() || null)} onKeyDown={(e) => { if (e.key === "Enter") setParam("q", search.trim() || null); }}
                placeholder="Search by app" className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px] shadow-xs placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
            </label>
          </div>
          <div className="hidden grid-cols-3 gap-2 md:grid" aria-hidden>
            {apps.slice(0, 6).map((a) => <AppIcon key={a.key} def={a.def} />)}
          </div>
        </div>
      </div>
      <div role="tablist" aria-label="App lists" className="mx-6 mt-4 flex gap-5 border-b border-border">
        {APP_TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setParam("tab", t === "popular" ? null : t)}
            className={cn("-mb-px border-b-2 px-0.5 pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40", tab === t ? "border-primary text-primary" : "border-transparent text-secondary hover:text-body")}>
            {TAB_LABELS[t]} <span className="ml-1 rounded-full bg-neutral-soft px-1.5 text-[10px] text-neutral">{counts[t]}</span>
          </button>
        ))}
      </div>
      <div className="px-6 py-5">
        {q.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}</div>
        ) : q.isError ? (
          <EmptyState title="Couldn't load apps" description={q.error.message} action={<Button onClick={() => void q.refetch()}>Retry</Button>} />
        ) : visible.length === 0 ? (
          <EmptyState icon={Search} title={needle ? `No apps match "${search}"` : tab === "active" ? "No apps are active yet" : "No apps here"}
            description={tab === "active" ? "Activate an app from Popular or All apps." : "Try another search."}
            action={needle ? <Button onClick={() => { setSearch(""); setParam("q", null); }}>Clear search</Button> : tab === "active" ? <Button onClick={() => setParam("tab", "all")}>Browse all apps</Button> : undefined} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((app) => (
              <AppCard key={app.key} app={app} canManage={perms.update} busy={action.pending}
                onDetails={() => setDetails(app.key)} onSettings={() => setSettingsFor(app.key)}
                onActivate={() => void activate(app)} onDeactivate={() => setDeactivate(app)} />
            ))}
          </div>
        )}
        {!perms.update && !perms.loading ? <p className="mt-4 text-[12px] text-faint">Ask an administrator with Company Settings access to activate apps.</p> : null}
      </div>
      <DetailsDialog app={byKey(details)} canManage={perms.update} busy={action.pending}
        onActivate={() => { const a = byKey(details); setDetails(null); if (a) void activate(a); }}
        onDeactivate={() => { setDeactivate(byKey(details)); setDetails(null); }}
        onClose={() => setDetails(null)} onLog={() => { setLog(byKey(details)); setDetails(null); }} onSettings={() => { setSettingsFor(details); setDetails(null); }} />
      <AppSettingsDrawer app={byKey(settingsFor)} onClose={() => setSettingsFor(null)} />
      <EntityChangeLogDrawer open={log !== null} onOpenChange={(o) => !o && setLog(null)} path={log ? `/api/apps/${log.key}/change-log` : null} title={`App change log · ${log?.name ?? ""}`} />
      <ConfirmDialog open={deactivate !== null} onOpenChange={(o) => !o && setDeactivate(null)} variant="danger"
        title={`Deactivate ${deactivate?.name ?? ""}?`}
        description={`${(deactivate?.def?.unlocks ?? ["Its features"]).join(" · ")} will no longer be available. Settings are kept if you activate it again.`}
        confirmLabel="Yes, deactivate" cancelLabel="No"
        onConfirm={async () => {
          if (!deactivate) return;
          const res = await action.run<AppRow>(`/api/apps/${deactivate.key}`, "PATCH", { isActive: false });
          if (res) toast.success(`${deactivate.name} deactivated`, "Its screens and actions are hidden for every user.");
          setDeactivate(null);
        }} />
    </div>
  );
}
