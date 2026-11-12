'use client';

/**
 * Help › Contact support. A `mailto:` link alone does nothing visible on machines without
 * a mail client, so the address is shown with Copy plus an "Open email app" link.
 */
import * as React from 'react';
import { Check, Copy, Mail } from 'lucide-react';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/config/brand';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

const COPIED_RESET_MS = 2000;

export function supportMailto(email: string = SUPPORT_EMAIL): string {
  return `mailto:${email}?subject=${encodeURIComponent(`${BRAND_NAME} support`)}`;
}

export function SupportContact() {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      toast.success('Success', 'Support email copied');
    } catch {
      toast.error('Could not copy', `Select the address and copy it manually: ${SUPPORT_EMAIL}`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-body">
        Email our support team. Include the order, PO or screen you were on so we can help faster.
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
        <Mail className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span
          className="min-w-0 flex-1 select-all truncate font-medium text-foreground"
          data-testid="support-email"
        >
          {SUPPORT_EMAIL}
        </span>
        <Button size="sm" variant="secondary" onClick={() => void copy()} aria-label="Copy support email">
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <a
        href={supportMailto()}
        className="self-start rounded text-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
      >
        Open email app
      </a>
    </div>
  );
}
