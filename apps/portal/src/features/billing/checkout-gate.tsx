'use client';
/**
 * The upgrade page's checkout boundary. Self-serve Stripe checkout is deferred, and
 * purchasing is an owner decision — so "Proceed to checkout" never charges anything:
 * it reveals who can actually complete the purchase.
 *
 *  - Members/admins are pointed at the organization's OWNER (name + prefilled email).
 *  - The owner sees the honest coming-soon state instead of a dead-end about themselves.
 */
import { useState } from 'react';
import { ArrowRight, Crown, Mail } from 'lucide-react';
import { Button, buttonVariants, cn } from '@/components/ui';
import type { OrgOwner } from '@/server/orgs';

export interface CheckoutGateProps {
  readonly moduleName: string;
  readonly orgName: string;
  readonly isOwner: boolean;
  /** Null when the org somehow has no active owner membership. */
  readonly owner: OrgOwner | null;
}

function mailtoHref(owner: OrgOwner, moduleName: string, orgName: string): string {
  const subject = `Add ${moduleName} to ${orgName}`;
  const body = `Hi ${owner.name.split(' ')[0] ?? owner.name},\n\nCould we add ${moduleName} to the ${orgName} plan? I'd like to use it for my work.\n\nThanks!`;
  return `mailto:${owner.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function CheckoutGate({ moduleName, orgName, isOwner, owner }: CheckoutGateProps) {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <Button size="lg" trailingIcon={<ArrowRight aria-hidden />} onClick={() => setRevealed(true)}>
        Proceed to checkout
      </Button>
    );
  }

  if (!isOwner && owner) {
    return (
      <div
        role="status"
        className="flex flex-col gap-4 rounded-xl border border-border-default bg-panel p-5 shadow-xs"
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-icon">
            <Crown aria-hidden className="size-4.5" />
          </span>
          <div>
            <h3 className="text-base font-semibold text-fg">Ask your organization owner</h3>
            <p className="mt-1 text-sm text-fg-secondary">
              Only the owner can add {moduleName} to {orgName}.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-sunken px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{owner.name}</p>
            <p className="truncate text-xs text-fg-muted">{owner.email}</p>
          </div>
          <a
            href={mailtoHref(owner, moduleName, orgName)}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
          >
            <Mail aria-hidden />
            Email {owner.name.split(' ')[0]}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-xl border border-border-default bg-panel p-5 shadow-xs"
    >
      <h3 className="text-base font-semibold text-fg">
        {isOwner ? 'Online checkout is coming soon' : 'Checkout is not available yet'}
      </h3>
      <p className="mt-1 text-sm text-fg-secondary">
        {isOwner
          ? `Until self-serve billing ships, KitStak enables modules manually. We'll confirm when ${moduleName} is live for ${orgName}.`
          : `Contact your organization's administrator to add ${moduleName}.`}
      </p>
    </div>
  );
}
