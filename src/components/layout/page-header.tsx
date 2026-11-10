"use client";

import * as React from "react";
import { PAGE_TAB_GROUPS, type PageTabGroupKey } from "@/config/page-tabs";
import { PageTabs, UnderlineTabs as UiUnderlineTabs, type PageTabItem } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AutoBreadcrumbs, Breadcrumbs, type Crumb } from "./breadcrumbs";
import { useShellAllows } from "./shell-context";

export { Breadcrumbs, AutoBreadcrumbs, type Crumb };

function BetaTag() {
  return <span className="ml-1 rounded bg-[#efe7fb] px-1 py-px text-[9px] font-bold uppercase text-[#621db8]">Beta</span>;
}

/** Route tabs for a config group, filtered by the viewer's permissions. */
export function GroupTabs({ group, className }: { readonly group: PageTabGroupKey; readonly className?: string }) {
  const allows = useShellAllows();
  const tabs = React.useMemo<readonly PageTabItem[]>(
    () =>
      PAGE_TAB_GROUPS[group]
        .filter((t) => allows(t.permission))
        .map((t) => ({ href: t.href, exact: t.exact, match: t.match, label: t.badge ? <>{t.label}<BetaTag /></> : t.label })),
    [group, allows],
  );
  if (tabs.length < 2) return null;
  return <PageTabs tabs={tabs} className={className} ariaLabel={`${group} sections`} />;
}

export interface PageHeaderProps {
  /** Crumbs after "Home". Omit to derive them from the nav config for the current route. */
  readonly breadcrumbs?: readonly Crumb[];
  /** Replaces the last derived crumb (e.g. an order code on a detail page). */
  readonly crumbLabel?: string;
  readonly title: string;
  /** Helper sentence, left-aligned under the H1 (13px, secondary). */
  readonly helper?: string;
  /** Primary + secondary CTAs, top-right. */
  readonly actions?: React.ReactNode;
  /** Route tab strip: a `page-tabs.ts` group or explicit tabs. */
  readonly tabs?: PageTabGroupKey | readonly PageTabItem[];
  readonly className?: string;
}

/** Page chrome (BUILD_PLAN 0.3): breadcrumb, H1, centred helper text, CTAs top-right, route tabs. */
export function PageHeader({ breadcrumbs, crumbLabel, title, helper, actions, tabs, className }: PageHeaderProps) {
  return (
    <div className={cn("pt-3", className)}>
      <div className="px-6">
        {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : <AutoBreadcrumbs currentLabel={crumbLabel} />}
        {/* 0.3: H1 left, helper centred in the band, CTAs right. Below lg the helper drops under the H1. */}
        <div className="mt-1.5 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)]">
          <h1 className="min-w-0 text-xl font-semibold tracking-[-0.01em] text-foreground lg:col-start-1">{title}</h1>
          {helper ? (
            <p data-slot="page-helper" className="order-last w-full text-[13px] text-secondary lg:order-none lg:col-start-2 lg:w-auto lg:max-w-[560px] lg:text-center">
              {helper}
            </p>
          ) : null}
          {actions ? <div className="flex flex-wrap items-center gap-2 lg:col-start-3 lg:justify-self-end">{actions}</div> : null}
        </div>
      </div>
      {tabs === undefined ? null : typeof tabs === "string" ? <GroupTabs group={tabs} className="mt-2" /> : <PageTabs tabs={tabs} className="mt-2" />}
    </div>
  );
}

/** Legacy state-driven tabs (pre-F4 pages). New pages use route tabs via `tabs`. */
export function UnderlineTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return <UiUnderlineTabs tabs={tabs} active={active} onChange={onChange} className={className} />;
}
