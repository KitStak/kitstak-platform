import { after } from 'next/server';
import { apiRoute } from '@/server/http/api';
import { getConnectedApps, syncIfStale } from '@/server/domain';

/** Each sibling app's connection state, the last sync and what it saw. Refreshes stale apps in the background. */
export const GET = apiRoute(async ({ ctx }) => {
  const data = await getConnectedApps(ctx);
  after(() => syncIfStale(ctx));
  return data;
});
