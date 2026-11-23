/**
 * Reminder emails that depend on the calendar, not on a gateway event (docs/billing/CONTRACTS.md
 * section 14, SPEC sections 8.2 and 8.3):
 *
 *  - free trial ending in 7, 3 and 1 days, only when no card is on file,
 *  - free trial ended with no plan,
 *  - one day left before a late payment turns the apps view only.
 *
 * Each email has a dedupe key made of the organization and the day count, so it goes out once no
 * matter how often the job runs. Access itself never depends on this job: it is worked out from the
 * dates every time it is read.
 */
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { billingAccounts, billingSubscriptions, organization } from '@kitstak/db/schema';
import { CATALOG, PRODUCT_IDS, daysLeft, type Stack } from '../catalog';
import type { PlanState } from '../plan-state';
import { quote } from '../quote';
import { errorText, logBilling, type BillingReadDb, type BillingRuntime } from '../server/db';
import { enqueueForBillingRecipients } from '../server/outbox';
import { getPlanState } from '../server/state';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The days before the end on which a reminder goes out. 0 is the "trial ended" email. */
const REMINDER_DAYS: readonly number[] = CATALOG.trialReminderDays.filter((days) => days > 0);
const MAX_ORGS_PER_RUN = 500;

async function orgName(db: BillingReadDb, orgId: string): Promise<string> {
  const [row] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, orgId));
  return row?.name ?? 'your organization';
}

function trialProducts(state: PlanState): Stack {
  return PRODUCT_IDS.filter((id) => state.modules[id].inPlan && state.modules[id].source === 'trial');
}

/**
 * Queues `trial_ending` for organizations whose free trial has 7, 3 or 1 days left, and
 * `trial_ended` for trials that ended in the last 24 hours with no plan. Returns how many emails
 * were queued for the first time.
 */
export async function queueTrialReminders(rt: BillingRuntime): Promise<number> {
  const now = rt.now();
  const maxDays = Math.max(...REMINDER_DAYS);
  // Trials that end within the reminder window, or that ended in the last day.
  const candidates = await rt.db
    .select({ orgId: billingAccounts.orgId })
    .from(billingAccounts)
    .where(
      and(
        isNotNull(billingAccounts.trialEndsAt),
        gt(billingAccounts.trialEndsAt, new Date(now.getTime() - DAY_MS)),
        sql`${billingAccounts.trialEndsAt} <= ${new Date(now.getTime() + maxDays * DAY_MS).toISOString()}::timestamptz`,
      ),
    )
    .limit(MAX_ORGS_PER_RUN);

  let queued = 0;
  for (const { orgId } of candidates) {
    try {
      const state = await getPlanState(rt, orgId);
      const products = trialProducts(state);
      if (products.length === 0 || !state.trial) continue;

      if (state.phase === 'trial' && REMINDER_DAYS.includes(state.trial.daysLeft)) {
        const selection = { ...state.selection, products };
        queued += await enqueueNew(rt, orgId, `trial:${orgId}:${state.trial.daysLeft}`, 'trial_ending', {
          orgName: await orgName(rt.db, orgId),
          portalUrl: rt.portalUrl,
          daysLeft: state.trial.daysLeft as 7 | 3 | 1,
          trialEndsAt: state.trial.endsAt.toISOString(),
          totalCents: quote(selection).totalCents,
          interval: selection.interval,
          products,
        });
      } else if (state.phase === 'trial_ended') {
        queued += await enqueueNew(rt, orgId, `trial:${orgId}:0`, 'trial_ended', {
          orgName: await orgName(rt.db, orgId),
          portalUrl: rt.portalUrl,
          trialEndedAt: state.trial.endsAt.toISOString(),
          products,
        });
      }
    } catch (error) {
      // One organization with odd data must not stop the reminders of the others.
      logBilling('error', 'trial reminder failed for one organization', { orgId, error: errorText(error) });
    }
  }
  return queued;
}

/**
 * Queues `grace_ending` for organizations with a late payment and one day or less of full access
 * left. Returns how many emails were queued for the first time.
 */
export async function queueGraceReminders(rt: BillingRuntime): Promise<number> {
  const now = rt.now();
  const candidates = await rt.db
    .select({ orgId: billingSubscriptions.orgId })
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.status, 'past_due'), isNotNull(billingSubscriptions.pastDueSince)))
    .limit(MAX_ORGS_PER_RUN);

  let queued = 0;
  for (const { orgId } of candidates) {
    try {
      const state = await getPlanState(rt, orgId);
      if (state.phase !== 'past_due' || !state.pastDue) continue;
      if (daysLeft(state.pastDue.accessChangesAt, now) !== 1) continue;
      queued += await enqueueNew(rt, orgId, `grace:${orgId}:${state.pastDue.since.toISOString()}`, 'grace_ending', {
        orgName: await orgName(rt.db, orgId),
        portalUrl: rt.portalUrl,
        amountDueCents: state.pastDue.amountDueCents,
        accessChangesAt: state.pastDue.accessChangesAt.toISOString(),
      });
    } catch (error) {
      logBilling('error', 'grace reminder failed for one organization', { orgId, error: errorText(error) });
    }
  }
  return queued;
}

type ReminderTemplate = 'trial_ending' | 'trial_ended' | 'grace_ending';

/** Queues one email per billing recipient and counts only the rows that are new. */
async function enqueueNew<T extends ReminderTemplate>(
  rt: BillingRuntime,
  orgId: string,
  dedupeKey: string,
  template: T,
  payload: import('../email-types').EmailPayloads[T],
): Promise<number> {
  const before = await countWithKey(rt.db, dedupeKey);
  await enqueueForBillingRecipients(rt.db, { orgId, template, payload, dedupeKey });
  const after = await countWithKey(rt.db, dedupeKey);
  return Math.max(0, after - before);
}

async function countWithKey(db: BillingReadDb, dedupeKey: string): Promise<number> {
  // Keys are "<key>:<address>". The escape keeps a "%" or "_" in an id from acting as a wildcard.
  const pattern = `${dedupeKey.replace(/[\\%_]/g, (char) => `\\${char}`)}:%`;
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM "core"."billing_emails" WHERE "dedupe_key" LIKE ${pattern}`,
  );
  const list = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  const first = list[0] as { count?: number } | undefined;
  return first?.count ?? 0;
}
