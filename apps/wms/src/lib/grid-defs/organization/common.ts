/**
 * Shared, PURE definitions for the organization-billing module (M11): field-def shape,
 * zod fragments and the address model used by clients, customers and retailers.
 * No React, DOM or server imports here.
 */
import { z } from 'zod';
import { ADDRESS_USAGE_TYPES } from '@/lib/enums';
import { isCountryCode, subdivisionsFor } from '@/lib/countries';

export {
  bulkIds,
  bulkSummary,
  optionalText,
  plural,
  requiredId,
  requiredText,
  round,
  versionField,
  type FacilityField as OrgField,
} from '@/lib/grid-defs/facility/common';

/** "1,234.50 USD" (grids) and "$1,234.50" (summary rails), BUILD_PLAN 0.1. */
export function moneyGrid(value: number | null | undefined, currency = 'USD'): string {
  const n = value ?? 0;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function moneyRail(value: number | null | undefined, currency = 'USD'): string {
  const n = value ?? 0;
  const symbol =
    currency === 'USD' ||
    currency === 'CAD' ||
    currency === 'AUD' ||
    currency === 'NZD' ||
    currency === 'SGD' ||
    currency === 'MXN'
      ? '$'
      : currency === 'EUR'
        ? '€'
        : currency === 'GBP'
          ? '£'
          : '';
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${symbol}${body}${symbol ? '' : ` ${currency}`}`;
}

export const optionalEmail = z
  .union([z.literal(''), z.email('Enter a valid email')])
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const txt = (max: number) => z.string().trim().max(max, `At most ${max} characters`);

/**
 * One owned address (clients, customers): Logiwa "Add Address" modal fields plus usage
 * type and default flag. State is required when the country has subdivisions.
 */
export const orgAddressSchema = z
  .object({
    id: z.string().max(64).optional().nullable(),
    name: txt(50).min(1, 'Address name is required'),
    usageType: z.enum(ADDRESS_USAGE_TYPES, { error: 'Choose a usage type' }),
    firstName: txt(60).optional().nullable(),
    lastName: txt(60).optional().nullable(),
    companyName: txt(120).optional().nullable(),
    line1: txt(256).min(1, 'Address line 1 is required'),
    line2: txt(256).optional().nullable(),
    city: txt(100).min(1, 'City is required'),
    state: txt(100).optional().nullable(),
    postalCode: txt(20).min(1, 'Postal code is required'),
    country: z.string({ error: 'Country is required' }).refine(isCountryCode, 'Choose a country'),
    phone: txt(40).optional().nullable(),
    email: optionalEmail,
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((a, ctx) => {
    const subs = subdivisionsFor(a.country);
    if (subs.length > 0 && !a.state)
      ctx.addIssue({
        code: 'custom',
        path: ['state'],
        message: a.country === 'CA' ? 'Province is required' : 'State is required',
      });
    if (subs.length > 0 && a.state && !subs.some((s) => s.code === a.state))
      ctx.addIssue({ code: 'custom', path: ['state'], message: 'Choose a valid state' });
    if (a.country === 'US' && !/^\d{5}(-\d{4})?$/.test(a.postalCode.trim()))
      ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'Use a 5-digit ZIP or ZIP+4' });
    // New shipping addresses need a contact for carrier labels (Logiwa parity); saved legacy rows stay editable.
    if (!a.id) shipmentContactIssues(a).forEach((i) => ctx.addIssue({ code: 'custom', ...i }));
  });

/** Shipping addresses print on carrier labels, so they need a contact first name, last name and email. */
export function shipmentContactIssues(a: {
  readonly usageType: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly email?: string | null;
}): { path: string[]; message: string }[] {
  if (a.usageType !== 'Shipping') return [];
  const out: { path: string[]; message: string }[] = [];
  if (!a.firstName?.trim())
    out.push({ path: ['firstName'], message: 'Contact first name is required for shipping addresses' });
  if (!a.lastName?.trim())
    out.push({ path: ['lastName'], message: 'Contact last name is required for shipping addresses' });
  if (!a.email?.trim())
    out.push({
      path: ['email'],
      message: 'Email is required for shipping addresses (carrier notifications)',
    });
  return out;
}

/** The address modal always requires the shipping contact, including when editing an older address. */
export const orgAddressModalSchema = orgAddressSchema.superRefine((a, ctx) => {
  if (a.id) shipmentContactIssues(a).forEach((i) => ctx.addIssue({ code: 'custom', ...i }));
});

export type OrgAddressInput = z.input<typeof orgAddressSchema>;
export type OrgAddress = z.output<typeof orgAddressSchema>;

export const EMPTY_ORG_ADDRESS: OrgAddressInput = {
  id: null,
  name: '',
  usageType: 'Shipping',
  firstName: '',
  lastName: '',
  companyName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'US',
  phone: '',
  email: '',
  isDefault: false,
  isActive: true,
};

/**
 * Only one default per usage type: the last address flagged default wins, and the
 * first active address of a usage type becomes default when none is flagged.
 */
export function normalizeDefaults<
  T extends { readonly usageType: string; readonly isDefault: boolean; readonly isActive: boolean },
>(list: readonly T[]): T[] {
  const lastDefault = new Map<string, number>();
  list.forEach((a, i) => {
    if (a.isDefault && a.isActive) lastDefault.set(a.usageType, i);
  });
  const firstActive = new Map<string, number>();
  list.forEach((a, i) => {
    if (a.isActive && !firstActive.has(a.usageType)) firstActive.set(a.usageType, i);
  });
  return list.map((a, i) => {
    const chosen = lastDefault.get(a.usageType) ?? firstActive.get(a.usageType);
    return { ...a, isDefault: chosen === i };
  });
}

/** "1 Main St, Austin, TX 78701, US" */
export function addressOneLine(
  a:
    | {
        readonly line1?: string | null;
        readonly line2?: string | null;
        readonly city?: string | null;
        readonly state?: string | null;
        readonly postalCode?: string | null;
        readonly country?: string | null;
      }
    | null
    | undefined,
): string {
  if (!a) return '';
  return [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(' '), a.country]
    .filter((p) => p && String(p).trim())
    .join(', ');
}

/** Change-log friendly date-only string for ISO values. */
export function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}
