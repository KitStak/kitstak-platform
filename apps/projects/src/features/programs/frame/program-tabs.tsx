'use client';
/**
 * The program tab strip (docs/programs/SPEC.md 5.5): Overview, Builds, Variants, Price card,
 * Schedule, Linked, Activity, Settings. Tabs that do not fit fold into a "More" menu (never cut at
 * the edge) and the active tab always stays visible. Same pattern as the project tabs.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, Boxes, CalendarClock, ChevronDown, LayoutDashboard, Link2, Receipt, Settings2, Shapes } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, cn } from '@/components/ui';
import { routes } from '@/lib/routes';
import type { ProgramTab } from '@/lib/program-types';

export const PROGRAM_TAB_META: Readonly<Record<ProgramTab, { readonly label: string; readonly icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }>> = {
  overview: { label: 'Overview', icon: LayoutDashboard },
  builds: { label: 'Builds', icon: Boxes },
  variants: { label: 'Variants', icon: Shapes },
  'price-card': { label: 'Price card', icon: Receipt },
  schedule: { label: 'Schedule', icon: CalendarClock },
  linked: { label: 'Linked', icon: Link2 },
  activity: { label: 'Activity', icon: Activity },
  settings: { label: 'Settings', icon: Settings2 },
};

/** The tab a path belongs to, or null (the full build page, unknown pages). */
export function programTabFor(pathname: string, key: string): ProgramTab | null {
  const base = routes.program(key);
  if (pathname === base) return 'overview';
  if (!pathname.startsWith(`${base}/`)) return null;
  const segment = pathname.slice(base.length + 1).split('/')[0] ?? '';
  return (Object.keys(PROGRAM_TAB_META) as ProgramTab[]).includes(segment as ProgramTab) && segment !== 'overview' ? (segment as ProgramTab) : null;
}

const tabClass = 'relative flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap outline-none';
const MORE_ROOM = 92;

export interface ProgramTabsProps {
  readonly programKey: string;
  readonly tabs: readonly ProgramTab[];
  readonly active: ProgramTab | null;
  /** Tabs that show a dot (Price card when a pending rate change or a draft waits for review). */
  readonly dots?: Partial<Record<ProgramTab, string>>;
  /** Where the Builds tab goes (the last used view). */
  readonly buildsHref?: string;
}

export function ProgramTabs({ programKey, tabs, active, dots = {}, buildsHref }: ProgramTabsProps) {
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const update = () => {
      const widths = (Array.from(measure.children) as HTMLElement[]).map((el) => el.offsetWidth + 4);
      const available = nav.clientWidth - 32;
      const total = widths.reduce((sum, w) => sum + w, 0);
      let count = tabs.length;
      if (total > available) {
        let used = 0;
        count = 0;
        while (count < widths.length && used + (widths[count] ?? 0) <= available - MORE_ROOM) {
          used += widths[count] ?? 0;
          count += 1;
        }
        count = Math.max(1, count);
      }
      setVisibleCount((previous) => (previous === count ? previous : count));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [tabs]);

  let shown = tabs.slice(0, visibleCount);
  if (active && !shown.includes(active) && tabs.includes(active)) shown = [...shown.slice(0, -1), active];
  const overflow = tabs.filter((t) => !shown.includes(t));
  const hrefFor = (t: ProgramTab) => (t === 'builds' && buildsHref ? buildsHref : routes.programTab(programKey, t));

  const renderInner = (t: ProgramTab) => {
    const meta = PROGRAM_TAB_META[t];
    const Icon = meta.icon;
    const dot = dots[t];
    return (
      <>
        <Icon aria-hidden className="size-4" />
        {meta.label}
        {dot ? (
          <>
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
            <span className="sr-only">{dot}</span>
          </>
        ) : null}
      </>
    );
  };

  return (
    <nav ref={navRef} aria-label="Program pages" className="relative mt-2 flex gap-1 overflow-hidden px-4" data-testid="program-tabs">
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex gap-1">
        {tabs.map((t) => (
          <span key={t} className={tabClass}>
            {renderInner(t)}
          </span>
        ))}
      </div>
      {shown.map((t) => {
        const isActive = active === t;
        return (
          <Link
            key={t}
            href={hrefFor(t)}
            prefetch={false}
            aria-current={isActive ? 'page' : undefined}
            title={dots[t]}
            data-testid={`program-tab-${t}`}
            className={cn(tabClass, 'focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus', isActive ? 'text-fg' : 'text-fg-secondary hover:text-fg')}
          >
            {renderInner(t)}
            <span aria-hidden className={cn('absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
          </Link>
        );
      })}
      {overflow.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(tabClass, 'text-fg-secondary hover:text-fg focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus data-[state=open]:text-fg')} data-testid="program-tab-more">
              More
              <ChevronDown aria-hidden className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {overflow.map((t) => {
              const Icon = PROGRAM_TAB_META[t].icon;
              return (
                <DropdownMenuItem key={t} icon={<Icon aria-hidden className="size-4" />} description={dots[t]} onSelect={() => router.push(hrefFor(t))} data-testid={`program-tab-more-${t}`}>
                  {PROGRAM_TAB_META[t].label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  );
}
