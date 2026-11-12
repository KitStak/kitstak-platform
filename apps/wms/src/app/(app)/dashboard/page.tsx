import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { getAuthContext } from '@/server/auth/context';
import { getAppDb } from '@/server/api/db';
import { getLiveDashboard, type LiveDashboard } from '@/server/repositories/dashboard-live';
import DashboardLoading from './loading';

export const metadata: Metadata = { title: 'Dashboard' };

type SP = Record<string, string | string[] | undefined>;
// "all" is the explicit "every warehouse / client" choice (it overrides a saved default on the client).
const ids = (v: string | string[] | undefined): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => Boolean(s) && s !== 'all')
        .slice(0, 200)
    : [];

/**
 * Server-renders the first dashboard payload so the cards paint in the initial HTML instead of
 * waiting for hydration + `/api/me` + `/api/dashboard`. The client view then takes over
 * (60 s auto-refresh, filters). Any failure falls back to the client fetch.
 */
async function DashboardWithData({ searchParams }: { readonly searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const wh = ids(sp.wh);
  const cl = ids(sp.cl);
  let initial: LiveDashboard | null = null;
  try {
    const auth = await getAuthContext();
    if (auth)
      initial = JSON.parse(
        JSON.stringify(await getLiveDashboard(await getAppDb(), auth, { warehouseIds: wh, clientIds: cl })),
      ) as LiveDashboard;
  } catch {
    initial = null;
  }
  const qs = new URLSearchParams();
  if (wh.length) qs.set('wh', wh.join(','));
  if (cl.length) qs.set('cl', cl.join(','));
  return <DashboardView initial={initial ? { qs: qs.toString(), data: initial } : null} />;
}

export default function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardWithData searchParams={searchParams} />
    </Suspense>
  );
}
