import type { Metadata } from 'next';
import Link from 'next/link';
import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { SETTINGS_SECTIONS } from '@/features/routes/catalog';
import { ledgerPage } from '@/server/page';

export const metadata: Metadata = { title: 'Settings' };

export default async function RoutePage() {
  const page = await ledgerPage('/settings', 'settings');
  if (page.blocked) return <PageBlocked title="Settings" role={page.access.role} />;
  return (
    <Page title="Settings" subtitle={page.can('settings:manage') ? 'How Ledger works for your workspace.' : 'How Ledger is set up. Only an owner or admin can change it.'}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="settings-sections">
        {SETTINGS_SECTIONS.map((section) => (
          <li key={section.slug}>
            <Link
              href={`/settings/${section.slug}`}
              className="block h-full rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <span className="block text-base font-semibold text-fg">{section.title}</span>
              <span className="mt-1 block text-sm text-fg-secondary">{section.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
