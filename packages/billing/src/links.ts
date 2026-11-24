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

/**
 * The query key that names the organization a link is about (review round 4). A person can be in
 * two organizations. A link from an email or from another app must open the right one, so it
 * carries the organization's id. The Portal switches to it when the person is a member, takes the
 * key out of the address, and shows the page (`/org/switch` in the Portal).
 */
export const ORG_PARAM = 'org';

const ORG_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id when it is an organization id, else null. Nothing else is ever put in a link. */
export function orgParamValue(orgId: string | null | undefined): string | null {
  return typeof orgId === 'string' && ORG_ID_SHAPE.test(orgId) ? orgId.toLowerCase() : null;
}

/** Adds `org=<id>` to a Portal address. A bad id or a bad address gives the address back as it was. */
export function withOrgParam(url: string, orgId: string | null | undefined): string {
  const id = orgParamValue(orgId);
  if (!id) return url;
  const hashAt = url.indexOf('#');
  const head = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const queryAt = head.indexOf('?');
  const path = queryAt === -1 ? head : head.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : head.slice(queryAt + 1));
  params.set(ORG_PARAM, id);
  return `${path}?${params.toString()}${hash}`;
}

/**
 * Absolute URL on the portal. `from` is the calling app, kept so the portal can offer a way back.
 * `orgId` is the organization the link is about. Pass it from every email and from every app, so
 * the page opens for that organization and not for the one the person happened to use last.
 */
export function billingLink(portalUrl: string, intent: BillingLinkIntent, from?: ProductId, orgId?: string | null): string {
  const base = portalUrl.replace(/\/+$/, '');
  const { path, query } = pathFor(intent);
  const params = new URLSearchParams(query);
  if (from) params.set('from', from);
  const org = orgParamValue(orgId);
  if (org) params.set(ORG_PARAM, org);
  const search = params.toString();
  return `${base}${path}${search ? `?${search}` : ''}`;
}
