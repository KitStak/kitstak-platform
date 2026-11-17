'use client';
/** Off-canvas navigation below md: the full sidebar slides in from the left. */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { Logo } from './logo';
import { Sidebar } from './sidebar';
import { useShellStore } from './store';

export function MobileNav() {
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
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          style={{ width: 'min(300px, 86vw)' }}
          className="fixed top-0 bottom-0 left-0 z-[var(--z-modal)] flex flex-col border-r border-border-subtle bg-app shadow-modal outline-none data-[state=closed]:animate-slide-out-left data-[state=open]:animate-slide-in-left"
        >
          <div className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between px-3">
            <Logo size={22} />
            <DialogPrimitive.Close asChild>
              <IconButton label="Close navigation" icon={<X aria-hidden />} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Home, jobs, log work, profit and more</DialogPrimitive.Description>
          <div className="min-h-0 flex-1">
            <Sidebar variant="drawer" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
