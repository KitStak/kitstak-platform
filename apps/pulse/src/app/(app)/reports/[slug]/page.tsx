import type { Metadata } from 'next';
import { ReportPage } from '@/features/reports';
import { reportInfo } from '@/lib/reports';

interface Props {
  readonly params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const report = reportInfo(decodeURIComponent((await params).slug));
  return { title: report ? report.name : 'Report not found' };
}

export default function Page({ params }: Props) {
  return <ReportPage params={params} />;
}
