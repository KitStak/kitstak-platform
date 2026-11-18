/**
 * Server half of Settings, Connected apps: loads the connection state and the links, starts a
 * background refresh of any app whose last sync is stale (never blocking the page), and hands
 * over to the client view.
 */
import { after } from 'next/server';
import { appUrls } from '@/server/env';
import { getConnectedApps, listLinkedJobs, syncIfStale, type DomainContext } from '@/server/domain';
import { ConnectedAppsView } from './connected-apps';

export async function ConnectedAppsBody({ ctx }: { readonly ctx: DomainContext }) {
  const [initial, links] = await Promise.all([getConnectedApps(ctx), listLinkedJobs(ctx).catch(() => [])]);
  after(() => syncIfStale(ctx));
  return <ConnectedAppsView initial={initial} initialLinks={links} portalUrl={appUrls().portal} />;
}
