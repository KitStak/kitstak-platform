'use client';
/**
 * Remembers, per browser tab, which organization the page on screen was made for (review round 2).
 * The signed in shell and the signup plan step render `BillingOrgScope` with the organization the
 * server used for that render. Every billing action sends the id back, and the server refuses when
 * the session's active organization is another one by now ("You switched organizations. Reload
 * this page."). The value lives in this module, so each tab has its own.
 */
import { useLayoutEffect } from 'react';

let renderedOrg: string | null = null;

/** The organization this tab's page was made for. null before the shell has rendered. */
export function renderedOrgId(): string | null {
  return renderedOrg;
}

export function BillingOrgScope({ orgId }: { readonly orgId: string | null }) {
  // A layout effect runs before the browser paints, so no button can be pressed before this is set.
  useLayoutEffect(() => {
    renderedOrg = orgId;
  }, [orgId]);
  return null;
}
