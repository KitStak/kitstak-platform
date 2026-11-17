import type { Metadata } from 'next';
import { SettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Settings' };

export default function Page({ searchParams }: { readonly searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <SettingsPage searchParams={searchParams} />;
}
