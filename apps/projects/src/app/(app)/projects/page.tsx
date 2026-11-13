import type { Metadata } from 'next';
import { ProjectsPage } from '@/features/projects';

export const metadata: Metadata = { title: 'Projects' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <ProjectsPage space={typeof params.space === 'string' ? params.space : undefined} />;
}
