/**
 * Reading plan state (docs/billing/CONTRACTS.md section 11.2). `getPlanState` loads the rows and
 * hands them to the pure `derivePlanState`. `getAppPlanView` is the one call a product app makes: it
 * returns the access level, the banner, the lock screen and the badges for the person looking.
 */
import { and, eq } from 'drizzle-orm';
import {
  billingAccounts,
  billingManagers,
  billingSubscriptions,
  entitlements,
  type BillingAccount,
  type BillingSubscription,
} from '@kitstak/db/schema';
import { moduleAccess, readBillingStamp, type Module, type ModuleAccess as EntitlementAccess } from '@kitstak/entitlements';
import { isProductId, PRODUCT_IDS, type ProductId } from '../catalog';
import {
  derivePlanState,
  type ModuleAccess,
  type PlanBadge,
  type PlanEntitlementInput,
  type PlanLock,
  type PlanNotice,
  type PlanState,
  type PlanStateInput,
  type PlanSubscriptionInput,
  type PlanUsage,
  type PlanViewer,
  planBadgeFor,
  planLockFor,
  planNoticeFor,
} from '../plan-state';
import { billingAccessFor, findOwnerName } from './access';
import { billingMode } from './mode';
import type { BillingReadDb, BillingRuntime } from './db';
import { countBillableSeats, countWarehouses } from './usage';

/**
 * Compile time lockstep guards: the pure modules declare `ProductId` and `ModuleAccess` again so they
 * import no database code. Drifting either side from `@kitstak/entitlements` fails typecheck here.
 */
type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : never) : never;
const _productsMatchModules: MutuallyAssignable<ProductId, Module> = true;
const _accessMatchesEntitlements: MutuallyAssignable<ModuleAccess, EntitlementAccess> = true;
void _productsMatchModules;
void _accessMatchesEntitlements;

/** A `core.billing_subscriptions` row as the pure plan input. */
export function subscriptionInput(row: BillingSubscription): PlanSubscriptionInput {
  return {
    status: row.status,
    interval: row.interval,
    seats: row.seats,
    warehouses: row.warehouses,
    items: row.items
      .filter((item) => isProductId(item.product))
      .map((item) => ({ product: item.product as ProductId, quantity: item.quantity, unitCents: item.unitCents })),
    recurringCents: row.recurringCents,
    currentPeriodEnd: row.currentPeriodEnd,
    trialEnd: row.trialEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelAt: row.cancelAt,
    canceledAt: row.canceledAt,
    endedAt: row.endedAt,
    pauseStartsAt: row.pauseStartsAt,
    pauseResumesAt: row.pauseResumesAt,
    pastDueSince: row.pastDueSince,
    amountDueCents: row.amountDueCents,
    nextPaymentAttempt: row.nextPaymentAttempt,
    paymentMethod:
      row.pmLast4 && row.pmBrand
        ? { brand: row.pmBrand, last4: row.pmLast4, expMonth: row.pmExpMonth ?? 0, expYear: row.pmExpYear ?? 0 }
        : null,
    creditCents: row.creditCents,
    nextChargeCents: row.nextChargeCents,
    nextDiscountCents: row.nextDiscountCents,
    nextDiscountLabel: row.nextDiscountLabel,
    nextCreditCents: row.nextCreditCents,
    endedReason: row.endedReason,
    endedAmountCents: row.endedAmountCents,
    endedAttempts: row.endedAttempts,
  };
}

interface PlanRows {
  readonly account: BillingAccount | null;
  readonly subscription: BillingSubscription | null;
  readonly entitlementRows: readonly {
    module: Module;
    status: PlanEntitlementInput['status'];
    source: PlanEntitlementInput['source'];
    periodEnd: Date | null;
    seats: number | null;
  }[];
  readonly usage: PlanStateInput['usage'];
}

async function loadPlanRows(db: BillingReadDb, orgId: string): Promise<PlanRows> {
  const [account] = await db.select().from(billingAccounts).where(eq(billingAccounts.orgId, orgId));
  const [subscription] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.orgId, orgId));
  const entitlementRows = await db
    .select({
      module: entitlements.module,
      status: entitlements.status,
      source: entitlements.source,
      periodEnd: entitlements.currentPeriodEnd,
      seats: entitlements.seats,
    })
    .from(entitlements)
    .where(eq(entitlements.orgId, orgId));
  const seats = await countBillableSeats(db, orgId);
  const warehousesUsed = await countWarehouses(db, orgId);
  return {
    account: account ?? null,
    subscription: subscription ?? null,
    entitlementRows,
    usage: { seatsUsed: seats.used, pendingInvites: seats.pendingInvites, warehousesUsed },
  };
}

function deriveFromRows(orgId: string, mode: PlanState['mode'], now: Date, loaded: PlanRows): PlanState {
  const byProduct = {} as Record<ProductId, PlanEntitlementInput | null>;
  for (const product of PRODUCT_IDS) byProduct[product] = null;
  for (const row of loaded.entitlementRows) {
    byProduct[row.module] = {
      status: row.status,
      source: row.source,
      periodEnd: row.periodEnd,
      access: moduleAccess(
        { status: row.status, source: row.source, periodEnd: row.periodEnd, seats: row.seats },
        now,
      ),
    };
  }
  return derivePlanState({
    orgId,
    mode,
    now,
    account: loaded.account
      ? {
          cart: loaded.account.cart,
          trialStartedAt: loaded.account.trialStartedAt,
          trialEndsAt: loaded.account.trialEndsAt,
        }
      : null,
    subscription: loaded.subscription ? subscriptionInput(loaded.subscription) : null,
    entitlements: byProduct,
    usage: loaded.usage,
  });
}

/** The plan of an org, read fresh from the database. */
export async function getPlanState(rt: Pick<BillingRuntime, 'db' | 'mode' | 'now'>, orgId: string): Promise<PlanState> {
  const loaded = await loadPlanRows(rt.db, orgId);
  return deriveFromRows(orgId, rt.mode, rt.now(), loaded);
}

/* ===== product apps ===== */

export interface AppPlanView {
  readonly access: ModuleAccess;
  readonly notice: PlanNotice | null;
  /** Set only when access is 'locked'. */
  readonly lock: PlanLock | null;
  readonly badges: Readonly<Record<ProductId, PlanBadge>>;
  readonly usage: PlanUsage;
}

interface CachedOrg {
  readonly expiresAt: number;
  readonly loaded: PlanRows;
  readonly ownerName: string | null;
  readonly managerIds: ReadonlySet<string>;
  /** The billing stamp read just before the rows. null when the stamp could not be read. */
  readonly stamp: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CachedOrg>();

/** Drops one org's cached plan rows, or the whole cache (tests, after a write). */
export function clearPlanCache(orgId?: string): void {
  if (orgId === undefined) cache.clear();
  else cache.delete(orgId);
}

async function loadCachedOrg(db: BillingReadDb, orgId: string, knownStamp?: string | null): Promise<CachedOrg> {
  // The stamp first, then the rows: a write in between costs one extra read later, never a stale copy.
  const stamp = knownStamp === undefined ? await readBillingStamp(db, orgId) : knownStamp;
  const loaded = await loadPlanRows(db, orgId);
  const ownerName = await findOwnerName(db, orgId);
  const managerRows = await db
    .select({ userId: billingManagers.userId })
    .from(billingManagers)
    .where(and(eq(billingManagers.orgId, orgId)));
  const entry: CachedOrg = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    loaded,
    ownerName,
    managerIds: new Set(managerRows.map((row) => row.userId)),
    stamp,
  };
  cache.set(orgId, entry);
  return entry;
}

function badgesFor(state: PlanState, allowAll: boolean): Record<ProductId, PlanBadge> {
  const badges = {} as Record<ProductId, PlanBadge>;
  for (const product of PRODUCT_IDS) {
    const badge = planBadgeFor(state, product);
    // Under the dev switch every app is open, so "not in your plan" and "view only" would be wrong.
    badges[product] = allowAll && (badge === 'not_in_plan' || badge === 'view_only') ? 'included' : badge;
  }
  return badges;
}

function buildView(
  entry: CachedOrg,
  input: {
    orgId: string;
    module: ProductId;
    userId: string;
    role: string;
    portalUrl: string;
    allowAll: boolean;
    timeZone?: string;
    now?: Date;
  },
): AppPlanView {
  const now = input.now ?? new Date();
  const state = deriveFromRows(input.orgId, billingMode(), now, entry.loaded);
  const access = billingAccessFor(input.role, entry.managerIds.has(input.userId), entry.ownerName);
  const viewer: PlanViewer = { canManage: access.canManage, canView: access.canView, ownerName: access.ownerName };
  const context = {
    module: input.module,
    viewer,
    portalUrl: input.portalUrl,
    // Every billing link from a product app names its organization (review round 4).
    orgId: input.orgId,
    now,
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  };
  const real = state.modules[input.module].access;

  if (input.allowAll) {
    const hasPlanFacts = state.phase !== 'none';
    return {
      access: 'full',
      // Every app is open under the switch, so the banner must not say "view only" (review round 4).
      notice: hasPlanFacts ? planNoticeFor(state, { ...context, appsOpen: true }) : null,
      lock: null,
      badges: badgesFor(state, true),
      usage: state.usage,
    };
  }
  return {
    access: real,
    notice: planNoticeFor(state, context),
    lock: real === 'locked' ? planLockFor(state, context) : null,
    badges: badgesFor(state, false),
    usage: state.usage,
  };
}

/**
 * For product apps. Reads only. The plan rows are kept for 60 seconds per process, and two rules
 * keep that copy honest:
 *
 *  1. Before the copy is used, the organization's billing stamp is read (one primary key lookup,
 *     `readBillingStamp`). Every billing write bumps it, in whichever process it was made. A new
 *     stamp means the copy is old, and the rows are read again. So a cancel, a "Keep my plan", a
 *     pause or a payment made in the Portal shows here on the very next request (review round 3).
 *  2. Any answer with a notice of tone 'warning' or 'danger', or access other than 'full', is read
 *     again before it is returned. This also covers a database that has no stamps yet.
 */
export async function getAppPlanView(
  db: BillingReadDb,
  input: {
    orgId: string;
    module: ProductId;
    userId: string;
    role: string;
    portalUrl: string;
    /** The app's own entitlementsAllowAll() answer. */
    allowAll: boolean;
    timeZone?: string;
    now?: Date;
  },
): Promise<AppPlanView> {
  const cached = cache.get(input.orgId);
  if (cached && cached.expiresAt > Date.now()) {
    const stamp = await readBillingStamp(db, input.orgId);
    if (stamp !== null && stamp !== cached.stamp) return buildView(await loadCachedOrg(db, input.orgId, stamp), input);
    const view = buildView(cached, input);
    const good = view.access === 'full' && (view.notice === null || view.notice.tone === 'info');
    if (good) return view;
  }
  return buildView(await loadCachedOrg(db, input.orgId), input);
}
