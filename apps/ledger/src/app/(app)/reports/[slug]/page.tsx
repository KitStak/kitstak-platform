import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Page } from '@/components/layout/page';
import { ButtonLink } from '@/components/ledger/button-link';
import { EmptyState } from '@/components/ui';
import { PageBlocked } from '@/features/access/page-blocked';
import { REPORTS } from '@/features/routes/catalog';
import { ledgerPage } from '@/server/page';

export const metadata: Metadata = { title: 'Report' };

export default async function RoutePage({ params }: { readonly params: Promise<{ readonly slug: string }> }) {
  const { slug } = await params;
  const report = REPORTS.find((entry) => entry.slug === slug);
  if (!report) notFound();
  const page = await ledgerPage(`/reports/${slug}`, 'reports');
  if (page.blocked) return <PageBlocked title={report.title} role={page.access.role} />;
  return (
    <Page
      title={report.title}
      subtitle={report.description}
      actions={
        <ButtonLink href="/reports" variant="secondary">
          All reports
        </ButtonLink>
      }
    >
      <EmptyState title="No numbers yet" description="This report reads the same books as every screen. It fills in once invoices are sent, bills approved or a statement brought in." illustration="board" />
    </Page>
  );
}
