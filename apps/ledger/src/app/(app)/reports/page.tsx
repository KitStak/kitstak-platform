import type { Metadata } from 'next';
import Link from 'next/link';
import { Page } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { REPORTS } from '@/features/routes/catalog';
import { ledgerPage } from '@/server/page';

export const metadata: Metadata = { title: 'Reports' };

export default async function RoutePage() {
  const page = await ledgerPage('/reports', 'reports');
  if (page.blocked) return <PageBlocked title="Reports" role={page.access.role} />;
  return (
    <Page title="Reports" subtitle="Each report keeps its filters in the address, prints and exports to CSV.">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reports-list">
        {REPORTS.map((report) => (
          <li key={report.slug}>
            <Link
              href={`/reports/${report.slug}`}
              className="block h-full rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus"
            >
              <span className="block text-base font-semibold text-fg">{report.title}</span>
              <span className="mt-1 block text-sm text-fg-secondary">{report.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
