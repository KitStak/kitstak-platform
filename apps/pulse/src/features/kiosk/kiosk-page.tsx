import { getKioskState } from '@/server/domain';
import { KioskApp, NotActive } from './kiosk-app';

/**
 * Floor tablet, opened from a kiosk device link and never from a personal login. An unknown or
 * expired link says so in large type and shows nothing else: no names, no jobs, no money.
 */
export async function KioskPage({ params }: { readonly params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await getKioskState(token).catch(() => null);
  if (!state) return <NotActive />;
  return <KioskApp token={token} initial={state} />;
}
