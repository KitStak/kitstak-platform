"use client";

import * as React from "react";
import { PAGE_TAB_GROUPS, type PageTabGroupKey } from "@/config/page-tabs";
import { PageTabs, UnderlineTabs as UiUnderlineTabs, type PageTabItem } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AutoBreadcrumbs, Breadcrumbs, type Crumb } from "./breadcrumbs";
import { useShellAllows } from "./shell-context";

export { Breadcrumbs, AutoBreadcrumbs, type Crumb };

function BetaTag() {
  return <span className="ml-1 rounded-sm bg-muted px-1 py-px text-2xs font-medium text-fg-secondary">Beta</span>;
}

/** Route tabs for a config group, filtered by the viewer's permissions. */
export function GroupTabs({ group, className, alwaysShow = false }: { readonly group: PageTabGroupKey; readonly className?: string; /** Render a single allowed tab too, so the page shell does not shift by role. */ readonly alwaysShow?: boolean }) {
  const allows = useShellAllows();
  const tabs = React.useMemo<readonly PageTabItem[]>(
    () =>
      PAGE_TAB_GROUPS[group]
        .filter((t) => allows(t.permission))
        .map((t) => ({ href: t.href, exact: t.exact, match: t.match, label: t.badge ? <>{t.label}<BetaTag /></> : t.label })),
    [group, allows],
  );
  if (tabs.length === 0 || (tabs.length < 2 && !alwaysShow)) return null;
  return <PageTabs tabs={tabs} className={className} ariaLabel={`${group} sections`} />;
}

export interface PageHeaderProps {
  /** Crumbs after "Home". Omit to derive them from the nav config for the current route. */
  readonly breadcrumbs?: readonly Crumb[];
  /** Replaces the last derived crumb (e.g. an order code on a detail page). */
  readonly crumbLabel?: string;
  readonly title: string;
  /** Helper sentence, left-aligned under the H1 (13px, secondary). */
  readonly helper?: React.ReactNode;
  /** Contextual doc link appended to the helper ("Learn more about LP types"). */
  readonly helperLink?: { readonly href: string; readonly label: string };
  /** Keep a single-tab strip visible (see GroupTabs `alwaysShow`). */
  readonly alwaysShowTabs?: boolean;
  /** Primary + secondary CTAs, top-right. */
  readonly actions?: React.ReactNode;
  /** Route tab strip: a `page-tabs.ts` group or explicit tabs. */
  readonly tabs?: PageTabGroupKey | readonly PageTabItem[];
  readonly className?: string;
  /** Optional help/doc deep link shown next to the H1 (REQ-R7-5). */
  readonly helpHref?: string;
}

/** Page chrome (BUILD_PLAN 0.3): breadcrumb, H1, helper text under it, CTAs top-right, route tabs. */
export function PageHeader({ breadcrumbs, crumbLabel, title, helper, helperLink, alwaysShowTabs, actions, tabs, className, helpHref }: PageHeaderProps) {
  return (
    <div className={cn("pt-3", className)}>
      <div className="px-6">
        {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : <AutoBreadcrumbs currentLabel={crumbLabel} />}
        {/* H1 with the helper left-aligned beneath it; CTAs top-right (DESIGN_SPEC page header). */}
        <div className="mt-1.5 flex min-h-8 flex-wrap items-start justify-between gap-x-4 gap-y-2">
          {/* Phones: the title takes the full row so the CTAs wrap beneath it instead of squeezing the helper. */}
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
              {helpHref ? (
                <a data-slot="page-help" href={helpHref} target="_blank" rel="noopener" aria-label={`Help: ${title}`} className="rounded text-xs font-medium text-fg-secondary underline-offset-2 hover:text-fg hover:underline">
                  Help
                </a>
              ) : null}
            </div>
            {helper || helperLink ? (
              <p data-slot="page-helper" className="mt-0.5 max-w-[720px] text-sm text-fg-muted text-pretty">
                {helper}
                {helperLink ? (
                  <>
                    {helper ? " " : null}
                    <a href={helperLink.href} className="font-medium text-fg-secondary underline underline-offset-2 hover:text-fg">
                      {helperLink.label}
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      {tabs === undefined ? null : typeof tabs === "string" ? <GroupTabs group={tabs} className="mt-2" alwaysShow={alwaysShowTabs} /> : <PageTabs tabs={tabs} className="mt-2" />}
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
