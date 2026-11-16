import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { NAV_ICONS, DEFAULT_NAV_ICON } from '@/components/layout/nav-icons';
import type { SettingsHubSection } from './settings-hub-data';

/** Settings overview: every section the user can open, grouped like the mega-menu. */
export function SettingsHub({ sections }: { readonly sections: readonly SettingsHubSection[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader breadcrumbs={[{ label: 'Settings' }]} title="Settings" />
      <div className="grid gap-6 px-6 pb-8 pt-2">
        {sections.map((section) => {
          const Icon = NAV_ICONS[section.icon] ?? DEFAULT_NAV_ICON;
          return (
            <section key={section.heading} aria-labelledby={`hub-${section.heading}`}>
              <h2
                id={`hub-${section.heading}`}
                className="mb-2 flex items-center gap-2 text-xs font-bold text-secondary"
              >
                <Icon className="h-4 w-4" aria-hidden />
                {section.heading}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="group flex h-full items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground">{item.label}</span>
                        {item.description ? (
                          <span className="mt-0.5 block text-xs text-secondary">{item.description}</span>
                        ) : null}
                      </span>
                      <ChevronRight
                        className="mt-0.5 h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
