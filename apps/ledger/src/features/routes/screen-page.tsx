import 'server-only';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { EmptyState } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { ledgerPage } from '@/server/page';
import { SCREENS, type Screen, type ScreenId } from './catalog';

/** A tab strip for a list screen. Tabs are real links (`?tab=`); the lists behind them fill in phase by phase. */
function Tabs({ path, tabs, current }: { readonly path: string; readonly tabs: readonly string[]; readonly current: string }) {
  return (
    <nav aria-label="Views" className="flex gap-1 overflow-x-auto px-6">
      {tabs.map((tab) => {
        const slug = tab.toLowerCase().replace(/\s+/g, '-');
        const active = slug === current;
        return (
          <a
            key={slug}
            href={`${path}?tab=${slug}`}
            aria-current={active ? 'page' : undefined}
            className="border-b-2 border-transparent px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-secondary hover:text-fg aria-[current=page]:border-primary aria-[current=page]:text-fg"
          >
            {tab}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * One Ledger screen before it has records: the right gate (SPEC 3.3), the title, the tabs, and an
 * empty state that teaches what goes here. `path` is the route, `tab` the `?tab=` value.
 */
export async function ScreenPage({ id, path, tab }: { readonly id: ScreenId; readonly path: string; readonly tab?: string }) {
  const screen: Screen = SCREENS[id];
  const page = await ledgerPage(path, screen.nav);
  const needs = screen.needs ?? [];
  if (page.blocked || (needs.length > 0 && !needs.some((right) => page.can(right)))) {
    return <PageBlocked title={screen.title} role={page.access.role} />;
  }
  const actions = (screen.actions ?? []).filter((action) => page.can(action.needs));
  const tabs = screen.tabs ?? [];
  const currentTab = tab ?? tabs[0]?.toLowerCase().replace(/\s+/g, '-') ?? '';
  return (
    <Page title={screen.title} subtitle={screen.subtitle} tabs={tabs.length > 0 ? <Tabs path={path} tabs={tabs} current={currentTab} /> : undefined}>
      <div data-testid={`screen-${id}`}>
        <EmptyState
          title={screen.emptyTitle}
          description={screen.emptyText}
          illustration={screen.illustration}
          actions={
            actions.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {actions.map((action, index) => (
                  <ButtonLink key={action.href} href={action.href} variant={index === 0 ? 'primary' : 'secondary'}>
                    {action.label}
                  </ButtonLink>
                ))}
              </div>
            ) : undefined
          }
        />
      </div>
    </Page>
  );
}
