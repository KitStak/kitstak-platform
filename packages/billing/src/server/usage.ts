/**
 * Seats and warehouses from real counts (docs/billing/CONTRACTS.md section 11.9, SPEC 8.5). Nothing
 * here changes a charge: the counts set the floors in the picker and drive the limit checks.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { billingSubscriptions, invitation, member } from '@kitstak/db/schema';
import { findWmsTenantSchema, wmsTable } from '@kitstak/db/wms-tenants';
import {
  CATALOG,
  formatMoney,
  isBundle,
  normalizeSelection,
  type PlanSelection,
  seatLimitFor,
  unitCents,
} from '../catalog';
import { isLiveSubscriptionStatus } from '../plan-state';
import { type BillingReadDb, isUuid, rows } from './db';
import { isFreeRole, usesSeat } from './roles';

/**
 * A seat is used by each member of the org whose role does not start with `deactivated:` and is not
 * made only of free roles (guests). Pending invites count when they are pending, not expired, and
 * their role is not free.
 */
export async function countBillableSeats(
  db: BillingReadDb,
  orgId: string,
  options?: { ignoreInvitationId?: string; ignoreInviteEmail?: string; now?: Date },
): Promise<{ used: number; pendingInvites: number }> {
  const members = await db.select({ role: member.role }).from(member).where(eq(member.organizationId, orgId));
  const used = members.filter((row) => usesSeat(row.role)).length;

  const now = options?.now ?? new Date();
  const invites = await db
    .select({ id: invitation.id, role: invitation.role, email: invitation.email })
    .from(invitation)
    .where(
      and(eq(invitation.organizationId, orgId), eq(invitation.status, 'pending'), gt(invitation.expiresAt, now)),
    );
  const ignoreEmail = options?.ignoreInviteEmail?.trim().toLowerCase();
  const pendingInvites = invites.filter((row) => {
    if (options?.ignoreInvitationId && row.id === options.ignoreInvitationId) return false;
    if (ignoreEmail && row.email.trim().toLowerCase() === ignoreEmail) return false;
    return !isFreeRole(row.role ?? 'member');
  }).length;
  return { used, pendingInvites };
}

/** Active rows in the org's WMS schema (core.wms_tenants). null when the org has no active WMS schema. */
export async function countWarehouses(db: BillingReadDb, orgId: string): Promise<number | null> {
  if (!isUuid(orgId)) return null;
  try {
    // `findWmsTenantSchema` validates the schema name before it is ever used as an identifier.
    const schemaName = await findWmsTenantSchema(db as unknown as Parameters<typeof findWmsTenantSchema>[0], orgId);
    if (!schemaName) return null;
    const result = await db.execute(
      sql`SELECT count(*)::int AS "count" FROM ${wmsTable(schemaName, 'warehouses')} WHERE "is_active" = true`,
    );
    return Number(rows<{ count: number | string }>(result)[0]?.count ?? 0);
  } catch {
    // No WMS tables in this database (or not readable): the org has no warehouse to count.
    return null;
  }
}

interface LivePlan {
  readonly selection: PlanSelection;
  readonly hasWms: boolean;
}

/** The paid plan of an org when its subscription is live, else null. */
async function livePlan(db: BillingReadDb, orgId: string): Promise<LivePlan | null> {
  const [row] = await db
    .select({
      status: billingSubscriptions.status,
      interval: billingSubscriptions.interval,
      seats: billingSubscriptions.seats,
      warehouses: billingSubscriptions.warehouses,
      items: billingSubscriptions.items,
    })
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.orgId, orgId));
  if (!row || !isLiveSubscriptionStatus(row.status)) return null;
  const selection = normalizeSelection({
    products: row.items.map((item) => item.product),
    seats: row.seats,
    warehouses: row.warehouses,
    interval: row.interval,
  });
  return { selection, hasWms: selection.products.includes('wms') };
}

/**
 * May `adding` more people with this role join? Always yes for a free role, with no paid plan (no
 * limits during trials), and when the plan has no seat limit.
 */
export async function checkSeatAvailable(
  db: BillingReadDb,
  input: { orgId: string; adding: number; role: string; ignoreInvitationId?: string; ignoreInviteEmail?: string },
): Promise<
  | { ok: true }
  | { ok: false; code: 'seat_limit'; message: string; limit: number; used: number; pulseOnly: boolean }
> {
  if (isFreeRole(input.role)) return { ok: true };
  const plan = await livePlan(db, input.orgId);
  if (!plan) return { ok: true };
  const limit = seatLimitFor(plan.selection);
  if (limit === null) return { ok: true };
  const { used, pendingInvites } = await countBillableSeats(db, input.orgId, {
    ...(input.ignoreInvitationId ? { ignoreInvitationId: input.ignoreInvitationId } : {}),
    ...(input.ignoreInviteEmail ? { ignoreInviteEmail: input.ignoreInviteEmail } : {}),
  });
  if (used + pendingInvites + Math.max(0, input.adding) <= limit) return { ok: true };
  const pulseOnly = !plan.selection.products.some((id) => CATALOG.products[id].quantityFrom === 'seats');
  const message = pulseOnly
    ? `Pulse covers up to ${limit} seats. For a bigger team, talk to us.`
    : `All ${limit} ${limit === 1 ? 'seat is' : 'seats are'} in use. Add a seat in Billing, then invite again.`;
  return { ok: false, code: 'seat_limit', message, limit, used, pulseOnly };
}

/** May `adding` more warehouses be created? Always yes with no paid plan and when WMS is not paid for. */
export async function checkWarehouseAvailable(
  db: BillingReadDb,
  input: { orgId: string; adding: number },
): Promise<{ ok: true } | { ok: false; code: 'warehouse_limit'; message: string; paid: number; used: number }> {
  const plan = await livePlan(db, input.orgId);
  if (!plan || !plan.hasWms) return { ok: true };
  const paid = plan.selection.warehouses;
  const used = (await countWarehouses(db, input.orgId)) ?? 0;
  if (used + Math.max(0, input.adding) <= paid) return { ok: true };
  const unit = unitCents('wms', plan.selection.interval, isBundle(plan.selection.products));
  const period = plan.selection.interval === 'yearly' ? 'year' : 'month';
  const message = `Your plan covers ${paid} ${paid === 1 ? 'warehouse' : 'warehouses'}. Add one more for ${formatMoney(unit)} more per ${period}.`;
  return { ok: false, code: 'warehouse_limit', message, paid, used };
}
