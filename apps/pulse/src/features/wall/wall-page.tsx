import Link from 'next/link';
import { Hourglass, LinkIcon, ShieldAlert } from 'lucide-react';
import { PulseMark } from '@/features/shell/logo';
import { canPulse } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { getWallBoard, getWallForDevice, listSites, pulseAccessFor, toDomainContext } from '@/server/domain';
import { requirePageContext } from '@/server/session';
import { WallControls } from './wall-controls';
import { readPanels, readRotate } from './wall-math';
import { WallRefresh } from './wall-refresh';
import { WallScreen } from './wall-screen';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A full screen message in wall type: no app chrome, readable from across the room. */
function WallMessage({ heading, icon, title, children, footer, refresh }: { readonly heading: string; readonly icon: React.ReactNode; readonly title: string; readonly children: React.ReactNode; readonly footer?: React.ReactNode; readonly refresh?: boolean }) {
  return (
    <div data-testid="wall" className="flex min-h-dvh flex-col bg-app text-fg">
      {refresh ? <WallRefresh seconds={60} /> : null}
      <header className="flex items-center gap-3 px-8 py-6">
        <PulseMark size={40} />
        <span className="text-2xl font-semibold tracking-[-0.01em]">{heading}</span>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-10 text-center" data-testid="wall-message">
        <span aria-hidden className="flex size-24 items-center justify-center rounded-3xl bg-muted text-icon">
          {icon}
        </span>
        <h1 className="text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">{title}</h1>
        <p className="max-w-3xl text-xl text-fg-secondary sm:text-2xl">{children}</p>
      </main>
      {footer ? <footer className="flex items-center justify-center gap-4 px-8 pb-6 text-sm text-fg-muted">{footer}</footer> : null}
    </div>
  );
}

/**
 * Wall display for signed in people: `/wall?site=&panels=jobs,pace&rotate=15&money=1`.
 * Shows today's units against the goal and pace against target. Money only when asked for, and
 * only for a person who may see money.
 */
export async function WallPage({ searchParams }: { readonly searchParams?: Search }) {
  const params = (await searchParams) ?? {};
  const context = await requirePageContext(routes.wall());
  const ctx = toDomainContext(context);
  const access = await pulseAccessFor(ctx);
  if (access.role === 'none') {
    return (
      <WallMessage heading={context.org.name} icon={<ShieldAlert className="size-12" strokeWidth={1.5} />} title="Ask an admin for access">
        You are signed in, but you do not have a Pulse role in this workspace yet.
      </WallMessage>
    );
  }
  const sites = await listSites(ctx);
  const wantedSite = one(params.site);
  const siteId = wantedSite && sites.some((site) => site.id === wantedSite) ? wantedSite : null;
  const board = await getWallBoard(ctx, { siteId, showMoney: one(params.money) === '1' });
  return (
    <WallScreen
      board={board}
      panels={readPanels(one(params.panels))}
      rotateSeconds={readRotate(one(params.rotate))}
      controls={<WallControls sites={sites.map((site) => ({ id: site.id, name: site.name }))} siteId={siteId} showMoney={board.showMoney} canSeeMoney={access.seesMoney} canManageLinks={canPulse(access.role, 'device:manage')} />}
    />
  );
}

/** Wall display behind a device link, for a TV with no login. An unknown, expired or turned off link says so and shows nothing else. */
export async function WallLinkPage({ params }: { readonly params: Promise<{ token: string }> }) {
  const { token } = await params;
  const device = await getWallForDevice(token).catch(() => null);
  if (device === 'busy') {
    return (
      <WallMessage heading="KitStak Pulse" icon={<Hourglass className="size-12" strokeWidth={1.5} />} title="One moment" refresh>
        This screen was loaded too many times in a minute. It will try again on its own. If you see this often, check that the link is open on one TV only.
      </WallMessage>
    );
  }
  if (!device) {
    return (
      <WallMessage
        heading="KitStak Pulse"
        icon={<LinkIcon className="size-12" strokeWidth={1.5} />}
        title="This wall link is not active"
        footer={
          <Link href={routes.wall()} className="rounded-md px-2 py-1 font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
            Sign in to open the wall
          </Link>
        }
      >
        The link may have expired or been turned off. Ask a manager to make a new one: open the wall in Pulse and choose TV link.
      </WallMessage>
    );
  }
  return <WallScreen board={device.board} panels={device.panels} rotateSeconds={device.rotateSeconds} linkName={device.linkName} />;
}
