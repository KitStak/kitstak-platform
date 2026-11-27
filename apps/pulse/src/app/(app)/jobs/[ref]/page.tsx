import type { Metadata } from 'next';
import { JobPage } from '@/features/jobs';
import { jobPageTitle } from '@/lib/routes';

type Params = Promise<{ ref: string }>;

export async function generateMetadata({ params }: { readonly params: Params }): Promise<Metadata> {
  return { title: jobPageTitle(decodeURIComponent((await params).ref), 'overview') };
}

export default function Page({ params, searchParams }: { readonly params: Params; readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // `?view=job` keeps a program job here instead of going to its program (PULSE_PROGRAMS_SPEC 5.3).
  return <JobPage params={params} tab="overview" searchParams={searchParams} />;
}
