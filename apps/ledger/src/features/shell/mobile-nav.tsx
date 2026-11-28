'use client';
/** Below lg the top nav folds into this: a menu button in the top bar that opens a sheet from the left. */
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { CountBadge, IconButton } from '@/components/ui';
import { navMatches, type NavEntry } from '@/lib/nav';
import { NAV_ICONS } from './nav-icons';
import { badgeFor, badgeLabel, useNavGroups } from './nav-model';

const rowClass = [
  'flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-base text-fg outline-none',
  'transition-[background-color] duration-[var(--duration-instant)] ease-out',
  'hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  'aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-primary-text',
  '[&[aria-current=page]_svg]:text-primary-text',
].join(' ');

function SheetLink({ entry, badge, active }: { readonly entry: NavEntry; readonly badge: number; readonly active: boolean }) {
  const Icon = NAV_ICONS[entry.id];
  return (
    <li>
      <Link href={entry.href} aria-label={badgeLabel(entry, badge)} aria-current={active ? 'page' : undefined} data-testid={`mobile-nav-${entry.id}`} className={rowClass}>
        <Icon aria-hidden className="size-[18px] shrink-0 text-icon" />
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {badge > 0 ? <CountBadge count={badge} /> : null}
      </Link>
    </li>
  );
}

export function MobileNav() {
  const { main, more, badges } = useNavGroups();
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  if (main.length === 0 && more.length === 0) return null;

  const list = (entries: readonly NavEntry[]) => (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <SheetLink key={entry.id} entry={entry} badge={badgeFor(entry, badges)} active={navMatches(entry, pathname)} />
      ))}
    </ul>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <IconButton label="Open menu" icon={<Menu aria-hidden />} className="shrink-0 lg:hidden" data-testid="mobile-nav-trigger" />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          data-testid="mobile-nav"
          style={{ width: 'min(320px, 88vw)' }}
          className="fixed top-0 bottom-0 left-0 z-[var(--z-modal)] flex flex-col border-r border-border-subtle bg-app shadow-modal outline-none data-[state=closed]:animate-slide-out-left data-[state=open]:animate-slide-in-left"
        >
          <div className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between border-b border-border-subtle bg-panel pr-3 pl-4">
            <DialogPrimitive.Title className="text-base font-semibold text-fg">Menu</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Go to any page in Ledger</DialogPrimitive.Description>
            <DialogPrimitive.Close asChild>
              <IconButton label="Close menu" icon={<X aria-hidden />} hideTooltip />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {list(main)}
            {more.length > 0 ? (
              <div className="mt-3 border-t border-border-subtle pt-3">
                <h2 className="px-2.5 pb-1 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">More</h2>
                {list(more)}
              </div>
            ) : null}
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
