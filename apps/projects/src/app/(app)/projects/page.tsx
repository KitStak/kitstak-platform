import type { Metadata } from 'next';
import { ProjectsPage } from '@/features/projects';

export const metadata: Metadata = { title: 'Projects' };

export default async function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const pick = (name: string) => (typeof params[name] === 'string' ? (params[name] as string) : undefined);
  // ?customer=<core customer id> (Portal, CRM and WMS deep links) and ?health=at_risk|off_track|on_track.
  return <ProjectsPage space={pick('space')} customer={pick('customer')} health={pick('health')} />;
}
