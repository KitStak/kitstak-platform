'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { Notice, type NoticeTone } from '@/components/ui';

export interface FlashMessage {
  readonly tone: NoticeTone;
  readonly text: string;
  /** A way back to the app the person came from. */
  readonly back?: { readonly label: string; readonly href: string } | null;
}

/**
 * The one line that confirms what just happened ("Your plan is updated."). The page decides the
 * words on the server. This component only cleans the address bar, so a reload does not repeat it.
 */
export function Flash({ message, keys }: { readonly message: FlashMessage; readonly keys: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

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
          {message.back ? (
            <Link href={message.back.href} className="text-sm font-semibold underline underline-offset-2">
              {message.back.label}
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
