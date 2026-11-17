import Link from 'next/link';
import { LinkIcon, MonitorPlay } from 'lucide-react';
import { PulseMark } from '@/features/shell/logo';
import { formatLongDate, todayIso } from '@/lib/dates';
import { routes } from '@/lib/routes';
import { pulseAccessFor, toDomainContext } from '@/server/domain';
import { requirePageContext } from '@/server/session';
import { WallRefresh } from './wall-refresh';

/** Full screen frame for the floor TV: no app chrome, large type, readable from across the room. */
function WallFrame({ heading, children, footer }: { readonly heading: string; readonly children: React.ReactNode; readonly footer?: React.ReactNode }) {
  return (
    <div data-testid="wall" className="flex min-h-dvh flex-col bg-app text-fg">
      <header className="flex items-center justify-between gap-4 px-8 py-6">
        <span className="flex items-center gap-3">
          <PulseMark size={40} />
          <span className="text-2xl font-semibold tracking-[-0.01em]">{heading}</span>
        </span>
        <span className="text-xl text-fg-secondary tabular-nums">{formatLongDate(todayIso())}</span>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-10 text-center">{children}</main>
      {footer ? <footer className="flex items-center justify-center gap-4 px-8 pb-6 text-sm text-fg-muted">{footer}</footer> : null}
    </div>
  );
}

/** Wall display for signed in people. Shows today's units against the goal and pace against target, never money by default. */
export async function WallPage() {
  const context = await requirePageContext(routes.wall());
  const access = await pulseAccessFor(toDomainContext(context));
  if (access.role === 'none') {
    return (
      <WallFrame heading={context.org.name}>
        <p className="text-4xl font-semibold tracking-[-0.02em]">Ask an admin for access</p>
        <p className="max-w-2xl text-xl text-fg-secondary">You are signed in, but you do not have a Pulse role in this workspace yet.</p>
      </WallFrame>
    );
  }
  return (
    <WallFrame
      heading={context.org.name}
      footer={
        <Link href={routes.jobs()} className="rounded-md px-2 py-1 font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          Back to Pulse
        </Link>
      }
    >
      <WallRefresh />
      <span aria-hidden className="flex size-24 items-center justify-center rounded-3xl bg-primary-subtle text-primary-text">
        <MonitorPlay className="size-12" strokeWidth={1.5} />
      </span>
      <p className="text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">No jobs are running today</p>
      <p className="max-w-3xl text-xl text-fg-secondary sm:text-2xl">
        When work is logged, this screen shows each job’s units against today’s goal and the crew’s pace against the target. It refreshes on its own every minute.
      </p>
    </WallFrame>
  );
}

/** Wall display behind a device link, for a TV with no login. An unknown or expired link says so and shows nothing else. */
export async function WallLinkPage({ params }: { readonly params: Promise<{ token: string }> }) {
  await params;
  return (
    <WallFrame heading="KitStak Pulse">
      <span aria-hidden className="flex size-24 items-center justify-center rounded-3xl bg-muted text-icon">
        <LinkIcon className="size-12" strokeWidth={1.5} />
      </span>
      <p className="text-4xl font-semibold tracking-[-0.02em] sm:text-5xl">This wall link is not active</p>
      <p className="max-w-3xl text-xl text-fg-secondary sm:text-2xl">
        The link may have expired or been turned off. Ask a manager to make a new one in Pulse under Settings, Device links.
      </p>
    </WallFrame>
  );
}
