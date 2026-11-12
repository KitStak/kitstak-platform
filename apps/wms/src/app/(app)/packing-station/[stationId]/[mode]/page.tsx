import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/layout/shell-skeleton';
import { PackScreen } from '@/components/packing/pack-screen';
import { canonicalPackMode, isPackMode } from '@/components/packing/pack-types';

export const metadata: Metadata = { title: 'Pack orders' };

async function Screen({
  params,
  searchParams,
}: {
  readonly params: Promise<{ stationId: string; mode: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { stationId, mode } = await params;
  if (!isPackMode(mode)) {
    // Unknown / alias modes ("list", "cart", …) go to their canonical mode instead of a 404.
    const target = canonicalPackMode(mode);
    const sp = await searchParams;
    const qs = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]],
      ),
    );
    if (target === 'order' && mode.toLowerCase() === 'list') qs.set('list', '1');
    const q = qs.toString();
    redirect(
      `/packing-station/${encodeURIComponent(decodeURIComponent(stationId))}/${target}${q ? `?${q}` : ''}`,
    );
  }
  return <PackScreen key={`${stationId}-${mode}`} stationId={decodeURIComponent(stationId)} mode={mode} />;
}

/** Pack screen (M04 §2): `mode` = tote | location | order | putwall; `stationId` = station id or code. */
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string; mode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Screen params={params} searchParams={searchParams} />
    </Suspense>
  );
}
