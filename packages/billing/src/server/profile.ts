/**
 * The billing profile (docs/billing/CONTRACTS.md section 11.8): billing email, company name, address
 * and tax ID. Saved in `core.billing_accounts` and pushed to the gateway customer when one exists, so
 * the values show on the next invoice.
 */
import { eq } from 'drizzle-orm';
import { billingAccounts, organization, stripeCustomers, type BillingAddressJson } from '@kitstak/db/schema';
import { type BillingResult, billingError, billingOk } from '../errors';
import type { BillingAddress, ProfileInput } from '../gateway/types';
import { recordAudit } from './audit';
import { type BillingActor, type BillingReadDb, type BillingRuntime, errorText, logBilling } from './db';

export type { BillingAddress };

export interface BillingProfile {
  readonly billingEmail: string | null;
  readonly companyName: string | null;
  readonly address: BillingAddress;
  readonly taxIdType: string | null;
  readonly taxIdValue: string | null;
}

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (trimmed === '') return null;
  return trimmed.length > max ? null : trimmed;
}

function tooLong(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.trim().length > max;
}

function readAddress(raw: unknown): BillingAddress {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const key of ADDRESS_KEYS) {
    const value = text((raw as Record<string, unknown>)[key], 120);
    if (value) out[key] = key === 'country' ? value.toUpperCase() : value;
  }
  return out;
}

export async function getBillingProfile(db: BillingReadDb, orgId: string): Promise<BillingProfile> {
  const [row] = await db.select().from(billingAccounts).where(eq(billingAccounts.orgId, orgId));
  return {
    billingEmail: row?.billingEmail ?? null,
    companyName: row?.companyName ?? null,
    address: readAddress(row?.address),
    taxIdType: row?.taxIdType ?? null,
    taxIdValue: row?.taxIdValue ?? null,
  };
}

/** Checks a profile from a form. Returns the cleaned profile or the plain sentence to show. */
export function validateBillingProfile(input: unknown): { ok: true; profile: BillingProfile } | { ok: false; message: string } {
  const raw = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const emailRaw = typeof raw.billingEmail === 'string' ? raw.billingEmail.trim().toLowerCase() : '';
  if (emailRaw !== '' && (emailRaw.length > 254 || !EMAIL_RE.test(emailRaw))) {
    return { ok: false, message: 'Enter a valid billing email.' };
  }
  if (tooLong(raw.companyName, 120)) return { ok: false, message: 'Use 120 characters or fewer for the company name.' };

  const addressRaw = (raw.address !== null && typeof raw.address === 'object' ? raw.address : {}) as Record<string, unknown>;
  for (const key of ADDRESS_KEYS) {
    if (tooLong(addressRaw[key], 120)) return { ok: false, message: 'Use 120 characters or fewer in each address line.' };
  }
  const address = readAddress(addressRaw);
  if (address.country !== undefined && !/^[A-Z]{2}$/.test(address.country)) {
    return { ok: false, message: 'Pick a country from the list.' };
  }

  const taxIdType = typeof raw.taxIdType === 'string' ? raw.taxIdType.trim().toLowerCase() : '';
  const taxIdValue = typeof raw.taxIdValue === 'string' ? raw.taxIdValue.trim() : '';
  if ((taxIdType === '') !== (taxIdValue === '')) {
    return { ok: false, message: 'Enter both the tax ID type and the number, or leave both empty.' };
  }
  if (taxIdType !== '' && (!/^[a-z0-9_]{2,30}$/.test(taxIdType) || taxIdValue.length > 40)) {
    return { ok: false, message: 'That tax ID does not look right. Check it and try again.' };
  }

  return {
    ok: true,
    profile: {
      billingEmail: emailRaw === '' ? null : emailRaw,
      companyName: text(raw.companyName, 120),
      address,
      taxIdType: taxIdType === '' ? null : taxIdType,
      taxIdValue: taxIdValue === '' ? null : taxIdValue,
    },
  };
}

/** The profile in the shape a gateway customer takes. */
export function profileInput(
  profile: BillingProfile,
  fallback: { email: string; name: string },
): ProfileInput {
  return {
    email: profile.billingEmail ?? fallback.email,
    name: profile.companyName ?? fallback.name,
    address: Object.keys(profile.address).length > 0 ? profile.address : null,
    taxId: profile.taxIdType && profile.taxIdValue ? { type: profile.taxIdType, value: profile.taxIdValue } : null,
  };
}

/** Validates, pushes to the gateway customer when one exists, saves, and audits `profile.updated`. */
export async function updateBillingProfile(
  rt: BillingRuntime,
  input: { orgId: string; profile: BillingProfile; actor: BillingActor },
): Promise<BillingResult<BillingProfile>> {
  const checked = validateBillingProfile(input.profile);
  if (!checked.ok) return billingError('invalid_input', checked.message);
  const profile = checked.profile;

  const [account] = await rt.db.select().from(billingAccounts).where(eq(billingAccounts.orgId, input.orgId));
  const [customer] = await rt.db.select().from(stripeCustomers).where(eq(stripeCustomers.orgId, input.orgId));

  // The gateway goes first: if it refuses a value (a tax ID it cannot read), nothing is saved and
  // the person hears about it now, not on the next invoice.
  if (rt.gateway && customer && account?.gateway === rt.gateway.kind) {
    try {
      const [org] = await rt.db.select({ name: organization.name }).from(organization).where(eq(organization.id, input.orgId));
      // An empty email means "leave the email on the customer as it is".
      await rt.gateway.updateCustomer(
        customer.stripeCustomerId,
        profileInput(profile, { email: '', name: org?.name ?? '' }),
      );
    } catch (error) {
      logBilling('error', 'update customer failed', { orgId: input.orgId, error: errorText(error) });
      return billingError('gateway_error', 'We could not save your billing details. Check the tax ID and try again.');
    }
  }

  const values = {
    billingEmail: profile.billingEmail,
    companyName: profile.companyName,
    address: profile.address as BillingAddressJson,
    taxIdType: profile.taxIdType,
    taxIdValue: profile.taxIdValue,
  };
  await rt.db
    .insert(billingAccounts)
    .values({ orgId: input.orgId, ...values })
    .onConflictDoUpdate({ target: billingAccounts.orgId, set: { ...values, updatedAt: new Date() } });
  await recordAudit(rt.db, {
    orgId: input.orgId,
    actor: input.actor,
    action: 'profile.updated',
    summary: `${input.actor.label} updated the billing details.`,
  });
  return billingOk(profile);
}
