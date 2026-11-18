import type { Metadata } from 'next';
import { JobPage } from '@/features/jobs';
import { jobPageTitle } from '@/lib/routes';

type Params = Promise<{ ref: string }>;

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  return { title: jobPageTitle(decodeURIComponent((await params).ref), 'overview') };
}

export default function Page({ params }: { readonly params: Params }) {
  return <JobPage params={params} tab="overview" />;
}
