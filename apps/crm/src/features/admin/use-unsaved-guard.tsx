'use client';
/**
 * Unsaved-changes guard for settings forms: warns on tab close / reload (beforeunload) and
 * intercepts in-app link clicks while the form is dirty, asking before navigating away.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui';

/** Same-origin, same-tab navigation target of a click, or null when the click should pass through. */
export function interceptableHref(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>, anchor: HTMLAnchorElement | null, origin: string, current: string): string | null {
  if (!anchor || event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const next = `${url.pathname}${url.search}`;
  return next === current ? null : `${next}${url.hash}`;
}

export function useUnsavedChangesGuard(dirty: boolean): ReactNode {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const href = interceptableHref(event, anchor, window.location.origin, `${window.location.pathname}${window.location.search}`);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(href);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => (open ? undefined : setPending(null))}
      destructive
      title="Leave without saving?"
      description="Your changes to this page haven’t been saved and will be lost."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={() => {
        const href = pending;
        setPending(null);
        if (href) router.push(href);
      }}
    />
  );
}
