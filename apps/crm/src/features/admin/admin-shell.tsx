'use client';
/**
 * Admin center frame: org identity header, grouped left sub-nav (a horizontally scrolling tab
 * strip under 1024px) and the section content column. Nav items the caller lacks permission
 * for are hidden; the server still enforces every request.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Building2,
  ChartColumnBig,
  KeyRound,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UsersRound,
} from 'lucide-react';
import { Avatar, cn } from '@/components/ui';
import { useOrg } from '@/features/shell/org-context';
import { ADMIN_SECTIONS, activeSection, adminHref, sectionsByGroup, type AdminSection } from './nav';

const ICONS: Readonly<Record<AdminSection['icon'], ReactNode>> = {
  building: <Building2 aria-hidden />,
  users: <Users aria-hidden />,
  teams: <UsersRound aria-hidden />,
  permissions: <SlidersHorizontal aria-hidden />,
  security: <ShieldCheck aria-hidden />,
  audit: <ScrollText aria-hidden />,
  api: <KeyRound aria-hidden />,
  usage: <ChartColumnBig aria-hidden />,
};

export function AdminShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const { org, permissions } = useOrg();
  const visible = ADMIN_SECTIONS.filter((section) => permissions.includes(section.permission));
  const current = activeSection(pathname, org.slug);

  return (
    <div className="h-full overflow-y-auto bg-app" data-testid="admin-center">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-8 lg:py-8">
        <aside className="lg:sticky lg:top-8 lg:w-60 lg:shrink-0 lg:self-start">
          <div className="mb-4 flex items-center gap-3 lg:mb-6">
            <Avatar name={org.name} src={org.logo} shape="square" size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm text-fg-muted">{org.name}</p>
              <h1 className="text-md font-semibold text-fg">
                Administration
                <span className="sr-only">: {current.key === 'users' ? 'Users and members' : current.label}</span>
              </h1>
            </div>
          </div>
          <nav aria-label="Admin sections" data-testid="admin-nav">
            {/* Mobile / tablet: horizontal strip */}
            <MobileStrip activeKey={current.key}>
              {visible.map((section) => (
                <li key={section.key} className="shrink-0" data-active={current.key === section.key || undefined}>
                  <NavLink section={section} orgSlug={org.slug} active={current.key === section.key} compact />
                </li>
              ))}
            </MobileStrip>
            {/* Desktop: grouped rail */}
            <div className="hidden flex-col gap-5 lg:flex">
              {sectionsByGroup(visible).map(({ group, sections }) => (
                <div key={group}>
                  <p className="mb-1 px-2.5 text-xs font-semibold text-fg-muted ">{group}</p>
                  <ul className="flex flex-col gap-0.5">
                    {sections.map((section) => (
                      <li key={section.key}>
                        <NavLink section={section} orgSlug={org.slug} active={current.key === section.key} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Horizontal section strip (< 1024px): scrolls the active tab into view and fades whichever
 * edge has more tabs beyond it, so it's obvious the strip scrolls.
 */
function MobileStrip({ activeKey, children }: { readonly activeKey: string; readonly children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const update = () =>
      setEdges({
        start: list.scrollLeft > 4,
        end: list.scrollLeft + list.clientWidth < list.scrollWidth - 4,
      });
    const active = list.querySelector<HTMLElement>('[data-active]');
    if (active) {
      const target = active.offsetLeft - list.clientWidth / 2 + active.clientWidth / 2;
      list.scrollTo({ left: Math.max(0, target), behavior: 'auto' });
    }
    update();
    list.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      list.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [activeKey]);

  const mask =
    edges.start && edges.end
      ? 'linear-gradient(to right, transparent, black 32px, black calc(100% - 40px), transparent)'
      : edges.end
        ? 'linear-gradient(to right, black calc(100% - 40px), transparent)'
        : edges.start
          ? 'linear-gradient(to right, transparent, black 32px)'
          : undefined;

  return (
    <div className="-mx-4 border-b border-border-subtle lg:hidden" data-testid="admin-nav-strip" data-overflow-end={edges.end || undefined}>
      <ul
        ref={ref}
        className="flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </ul>
    </div>
  );
}

function NavLink({
  section,
  orgSlug,
  active,
  compact = false,
}: {
  readonly section: AdminSection;
  readonly orgSlug: string;
  readonly active: boolean;
  readonly compact?: boolean;
}) {
  return (
    <Link
      href={adminHref(orgSlug, section.segment)}
      aria-current={active ? 'page' : undefined}
      data-testid={`admin-nav-${section.key}`}
      className={cn(
        'group flex items-center gap-2.5 rounded-md text-base transition-[background-color,color] duration-[var(--duration-instant)] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        compact ? 'h-8 px-3 whitespace-nowrap' : 'h-9 px-2.5',
        active
          ? 'bg-primary-selected font-medium text-primary-text'
          : 'text-fg-secondary hover:bg-hover hover:text-fg active:bg-pressed',
      )}
    >
      <span
        className={cn(
          'flex shrink-0 [&_svg]:size-4',
          active ? 'text-primary-text' : 'text-icon group-hover:text-icon-strong',
          compact && 'hidden sm:flex',
        )}
      >
        {ICONS[section.icon]}
      </span>
      <span className="truncate">{section.label}</span>
    </Link>
  );
}
