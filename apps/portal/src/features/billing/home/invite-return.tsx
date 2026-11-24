'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Notice } from '@/components/ui';
import { readInviteDraft } from '@/lib/invite-draft';

/**
 * A person came here from the invite form to fix a card ("Update card" in the seat offer). This is
 * the way back: one line with a link to the invite, where the addresses they typed are still in
 * the field. It shows only in the tab that holds that unfinished invite.
 */
export function InviteReturn() {
  const [waiting, setWaiting] = useState<string | null>(null);
  useEffect(() => {
    const draft = readInviteDraft();
    if (!draft) return;
    const frame = window.requestAnimationFrame(() => setWaiting(draft.emails));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  if (!waiting) return null;
  return (
    <Notice
      tone="info"
      role="status"
      testId="invite-return"
      action={
        <Link href="/settings/organization#invite" data-testid="invite-return-link" className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold underline underline-offset-2 pointer-coarse:min-h-11">
          <ArrowLeft aria-hidden className="size-4" />
          Back to your invite
        </Link>
      }
    >
      Your invite for <span className="[overflow-wrap:anywhere]">{waiting}</span> is waiting. Update your card below, then go back and send it.
    </Notice>
  );
}
