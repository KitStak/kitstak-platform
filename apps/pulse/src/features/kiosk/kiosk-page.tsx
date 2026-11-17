import { TabletSmartphone } from 'lucide-react';
import { PulseMark } from '@/features/shell/logo';

/**
 * Floor tablet, opened from a kiosk device link and never from a personal login. An unknown or
 * expired link says so in large type and shows nothing else: no names, no jobs, no money.
 */
export async function KioskPage({ params }: { readonly params: Promise<{ token: string }> }) {
  await params;
  return (
    <div data-testid="kiosk" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-app px-6 py-10 text-center text-fg">
      <PulseMark size={56} />
      <span aria-hidden className="flex size-24 items-center justify-center rounded-3xl bg-muted text-icon">
        <TabletSmartphone className="size-12" strokeWidth={1.5} />
      </span>
      <h1 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">This tablet link is not active</h1>
      <p className="max-w-xl text-lg text-fg-secondary sm:text-xl">
        The link may have expired or been turned off. Ask a manager to make a new one in Pulse under Settings, Device links, then open it on this tablet.
      </p>
    </div>
  );
}
