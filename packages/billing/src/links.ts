/**
 * Links into the portal's billing area (docs/billing/CONTRACTS.md section 4.5). PURE. Every app builds
 * its banner, lock screen and settings links here, so nobody hand builds a billing URL.
 */
import type { ProductId } from './catalog';

export type BillingLinkIntent =
  | { to: 'home' }
  | { to: 'plan' }
  | { to: 'add'; product: ProductId }
  | { to: 'checkout' }
  | { to: 'fix_payment' }
  | { to: 'seats'; seats?: number }
  | { to: 'warehouses'; warehouses?: number }
  | { to: 'invoices' }
  | { to: 'cancel' }
  | { to: 'activity' };

function wholeAtLeastOne(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  return Math.max(1, Math.round(value));
}

function pathFor(intent: BillingLinkIntent): { path: string; query: [string, string][] } {
  switch (intent.to) {
    case 'home':
      return { path: '/billing', query: [] };
    case 'plan':
      return { path: '/billing/plan', query: [] };
    case 'add':
      return { path: '/billing/plan', query: [['add', intent.product]] };
    case 'checkout':
      return { path: '/billing/checkout', query: [] };
    case 'fix_payment':
      return { path: '/billing', query: [['fix', 'payment']] };
    case 'seats': {
      const seats = wholeAtLeastOne(intent.seats);
      return { path: '/billing/plan', query: seats === null ? [['focus', 'seats']] : [['seats', String(seats)]] };
    }
    case 'warehouses': {
      const warehouses = wholeAtLeastOne(intent.warehouses);
      return {
        path: '/billing/plan',
        query: warehouses === null ? [['focus', 'warehouses']] : [['warehouses', String(warehouses)]],
      };
    }
    case 'invoices':
      return { path: '/billing/invoices', query: [] };
    case 'cancel':
      return { path: '/billing/cancel', query: [] };
    case 'activity':
      return { path: '/billing/activity', query: [] };
  }
}

/** Absolute URL on the portal. `from` is the calling app, kept so the portal can offer a way back. */
export function billingLink(portalUrl: string, intent: BillingLinkIntent, from?: ProductId): string {
  const base = portalUrl.replace(/\/+$/, '');
  const { path, query } = pathFor(intent);
  const params = new URLSearchParams(query);
  if (from) params.set('from', from);
  const search = params.toString();
  return `${base}${path}${search ? `?${search}` : ''}`;
}
