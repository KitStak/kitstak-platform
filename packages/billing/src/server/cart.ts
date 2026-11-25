/**
 * The saved cart (docs/billing/CONTRACTS.md section 11.4): the plan a person is looking at, kept in
 * `core.billing_accounts.cart` so closing the tab and coming back shows the same cart.
 */
import { eq } from 'drizzle-orm';
import { billingAccounts } from '@kitstak/db/schema';
import { normalizeSelection, type PlanSelection, productListLabel } from '../catalog';
import { type BillingResult, billingError, billingOk } from '../errors';
import { recordAudit } from './audit';
import type { BillingActor, BillingDb, BillingReadDb, BillingRuntime } from './db';

export async function getCart(db: BillingReadDb, orgId: string): Promise<PlanSelection> {
  const [row] = await db.select({ cart: billingAccounts.cart }).from(billingAccounts).where(eq(billingAccounts.orgId, orgId));
  return normalizeSelection(row?.cart);
}

/** Writes the cart without an audit row. For flows that audit their own step. */
export async function writeCart(db: BillingDb, orgId: string, selection: PlanSelection): Promise<void> {
  const cart = { ...selection, products: [...selection.products] } as Record<string, unknown>;
  await db
    .insert(billingAccounts)
    .values({ orgId, cart })
    .onConflictDoUpdate({ target: billingAccounts.orgId, set: { cart, updatedAt: new Date() } });
}

function sameSelection(a: PlanSelection, b: PlanSelection): boolean {
  return (
    a.seats === b.seats &&
    a.warehouses === b.warehouses &&
    a.interval === b.interval &&
    a.products.join(',') === b.products.join(',')
  );
}

/** Saves the cart. A save that changes nothing writes nothing, so the activity page stays readable. */
export async function saveCart(
  rt: BillingRuntime,
  input: { orgId: string; selection: PlanSelection; actor: BillingActor },
): Promise<BillingResult<PlanSelection>> {
  const selection = normalizeSelection(input.selection);
  if (selection.products.length === 0) return billingError('invalid_selection');
  const current = await getCart(rt.db, input.orgId);
  if (sameSelection(current, selection)) return billingOk(selection);
  await writeCart(rt.db, input.orgId, selection);
  await recordAudit(rt.db, {
    orgId: input.orgId,
    actor: input.actor,
    action: 'cart.saved',
    summary: `${input.actor.label} saved a plan to review: ${productListLabel(selection.products)}.`,
    data: { selection },
  });
  return billingOk(selection);
}
