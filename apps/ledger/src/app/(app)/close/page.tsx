import type { Metadata } from 'next';
import Link from 'next/link';
import { Page, Panel } from '@/components/layout/page';
import { PageBlocked } from '@/features/access/page-blocked';
import { recentMonths } from '@/features/close/months';
import { listPeriods } from '@/server/domain/periods';
import { ledgerPage } from '@/server/page';

export const metadata: Metadata = { title: 'Close' };

export default async function RoutePage() {
  const page = await ledgerPage('/close', 'close');
  if (page.blocked) return <PageBlocked title="Close" role={page.access.role} />;
  const closed = new Set((await listPeriods(page.ctx)).filter((period) => period.status === 'closed').map((period) => period.periodMonth.slice(0, 7)));
  const months = recentMonths(new Date(), 6);
  return (
    <Page title="Close" subtitle="Check a month, then close it so its numbers stay put. Months close in order.">
      <Panel title="Months">
        <ul className="divide-y divide-border-subtle" data-testid="close-months">
          {months.map((month) => (
            <li key={month.key} className="flex items-center justify-between gap-3 py-2.5">
              <Link href={`/close/${month.key}`} className="font-medium text-fg hover:underline">
                {month.label}
              </Link>
              <span className="text-sm text-fg-muted">{closed.has(month.key) ? 'Closed' : 'Open'}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </Page>
  );
}
