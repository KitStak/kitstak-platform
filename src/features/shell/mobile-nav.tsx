'use client';
/**
 * Off-canvas navigation for narrow viewports: the full sidebar slides in from the left over a
 * dimmed backdrop. Closes on route change, Escape, backdrop click or the close button.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { useCrmBoards } from '@/features/crm/api';
import { useFavorites, useFolderIcons, useWorkspaces, useWorkspaceTree } from './api';
import { Logo } from './logo';
import { useOrg } from './org-context';
import { Sidebar } from './sidebar/sidebar';
import { useShellStore } from './store';

const DRAWER_WIDTH = 300;

/**
 * Warm the drawer's queries while it is closed (the docked sidebar is not mounted on narrow
 * viewports), so the first open shows real rows instead of skeletons.
 */
function useSidebarPrefetch(): void {
  const { org } = useOrg();
  const workspaces = useWorkspaces(org.id);
  const stored = useShellStore((state) => state.activeWorkspaceByOrg[org.id]);
  const list = workspaces.data ?? [];
  const activeId = list.find((workspace) => workspace.id === stored)?.id ?? list[0]?.id ?? null;
  useFavorites(org.id);
  useFolderIcons(org.id);
  useCrmBoards();
  useWorkspaceTree(org.id, activeId);
}

export function MobileNav() {
  useSidebarPrefetch();
  const open = useShellStore((state) => state.mobileNavOpen);
  const setOpen = useShellStore((state) => state.setMobileNavOpen);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          data-testid="mobile-nav"
          tabIndex={-1}
          // Focus the drawer itself (not its first button) so no tooltip pops on open.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          style={{ width: `min(${DRAWER_WIDTH}px, 86vw)` }}
          className="fixed top-0 bottom-0 left-0 z-[var(--z-modal)] flex flex-col border-r border-border-subtle bg-app shadow-modal outline-none data-[state=closed]:animate-slide-out-left data-[state=open]:animate-slide-in-left"
        >
          <div className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between px-3">
            <Logo size={26} />
            <DialogPrimitive.Close asChild>
              <IconButton label="Close navigation" icon={<X aria-hidden />} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Home, favorites and workspace boards
          </DialogPrimitive.Description>
          <div className="min-h-0 flex-1 pb-2">
            <Sidebar variant="drawer" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
