'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Notice, type NoticeTone } from '@/components/ui';
import { clearAppReturn, readAppReturn } from '@/lib/app-return';
import { readInviteDraft } from '@/lib/invite-draft';

export interface FlashMessage {
  readonly tone: NoticeTone;
  readonly text: string;
  /** A way back to the app the person came from. */
  readonly back?: { readonly label: string; readonly href: string } | null;
}

/** Where "Back to CRM" leads, per app: the words and the app's address. From the server. */
export type FlashBackTargets = Readonly<Record<string, { readonly label: string; readonly base: string }>>;

/**
 * The one line that confirms what just happened ("Your plan is updated."). The page decides the
 * words on the server. This component only cleans the address bar, so a reload does not repeat it.
 *
 * A fix that went through the card page has lost the link's `from`. When the page names no way
 * back, a good news line offers the one this tab remembers: the invite a person was sending
 * ("Back to your invite"), or the app they came from ("Back to CRM").
 */
export function Flash({
  message,
  keys,
  backTargets,
}: {
  readonly message: FlashMessage;
  readonly keys: readonly string[];
  readonly backTargets?: FlashBackTargets;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [remembered, setRemembered] = useState<{ readonly label: string; readonly href: string } | null>(null);

  useEffect(() => {
    if (message.back || message.tone !== 'success') return;
    // The unfinished invite has its own notice with its own link, so it wins and the app waits.
    if (readInviteDraft()) return;
    const saved = readAppReturn();
    const target = saved ? backTargets?.[saved.from] : undefined;
    if (!saved || !target) return;
    const frame = window.requestAnimationFrame(() => {
      // Used once: cleared only when it is on screen (an effect can run twice in development).
      clearAppReturn();
      setRemembered({ label: target.label, href: `${target.base.replace(/\/+$/, '')}${saved.path ?? ''}` });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [message.back, message.tone, backTargets]);
  const back = message.back ?? remembered;

  const cleanUrl = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of keys) next.delete(key);
    const query = next.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
  };

  useEffect(() => {
    // Keep the message on screen, drop it from the address so a reload or a share does not repeat it.
    window.history.replaceState(window.history.state, '', cleanUrl());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the message shown
  }, []);

  return (
    <Notice
      tone={message.tone}
      testId="billing-flash"
      action={
        <>
          {back ? (
            <Link href={back.href} data-testid="billing-flash-back" className="inline-flex min-h-8 items-center text-sm font-semibold underline underline-offset-2 pointer-coarse:min-h-11">
              {back.label}
            </Link>
          ) : null}
          <button
            type="button"
            aria-label="Hide this message"
            onClick={() => router.replace(cleanUrl())}
            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <X aria-hidden className="size-4" />
          </button>
        </>
      }
    >
      {message.text}
    </Notice>
  );
}
