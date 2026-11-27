'use server';
/**
 * "Ask Dana to add Projects" (review round 5). A member cannot change the plan. One click emails
 * the people who can (the owner and the billing managers), with the price and a button to the
 * picker. At most once a day per app and person. Nothing about the plan changes here.
 */
import { revalidatePath } from 'next/cache';
import { CATALOG, formatMoney, isProductId, toStack } from '@kitstak/billing/catalog';
import { sendEmailNow } from '@kitstak/billing/emails';
import { quote } from '@kitstak/billing/quote';
import { billingRecipients, enforceRateLimit } from '@kitstak/billing/server';
import { appsAskedToday, askDay, askKey } from '@/server/ask';
import { getBillingContext } from '@/server/billing/context';
import { portalUrl } from '@/server/billing/runtime';
import { db } from '@/server/db';
import { getOrgPlan } from '@/server/entitlements';
import { env } from '@/server/env';

export interface AskResult {
  readonly ok: boolean;
  readonly error?: string;
}

const SIGN_IN_AGAIN = 'Please sign in again.';
const TOO_MANY_TRIES = 'Too many tries. Wait 10 minutes and try again.';

function mailEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: env.NODE_ENV,
    EMAIL_PROVIDER: env.EMAIL_PROVIDER,
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_FROM: env.EMAIL_FROM,
    EMAIL_REPLY_TO: env.EMAIL_REPLY_TO,
  } as NodeJS.ProcessEnv;
}

/** Emails the people who manage billing that this person would like an app added. */
export async function askForAppAction(input: unknown): Promise<AskResult> {
  const context = await getBillingContext();
  if (!context) return { ok: false, error: SIGN_IN_AGAIN };
  const product = typeof input === 'object' && input !== null ? (input as { product?: unknown }).product : null;
  if (typeof product !== 'string' || !isProductId(product)) return { ok: false, error: 'Pick an app to ask for.' };
  const { org, session, access } = context;
  const name = CATALOG.products[product].shortName;

  // A person who can change the plan does not ask: they add it.
  if (access.canManage) return { ok: false, error: `You can add ${name} yourself in Billing.` };
  const plan = await getOrgPlan(org.id);
  const app = plan.modules.find((entry) => entry.module === product);
  if (!app || app.plan.inPlan || app.badge === 'included') return { ok: false, error: `${name} is already in your plan.` };

  const userId = session.user.id;
  // Asked today already: the button reads "Asked today". Nothing is sent twice.
  if ((await appsAskedToday(org.id, userId)).includes(product)) return { ok: true };
  if (!(await enforceRateLimit(db, { key: `portal:ask:${userId}`, windowSeconds: 600, max: 8 }))) return { ok: false, error: TOO_MANY_TRIES };

  const recipients = (await billingRecipients(db, org.id)).filter((to) => to !== session.user.email.trim().toLowerCase());
  if (recipients.length === 0) return { ok: false, error: 'Nobody manages billing for your organization yet. Ask your organization owner.' };

  // The price is said only for a paid plan, as a difference of two quotes. Never math of our own.
  let priceLine: string | undefined;
  if (plan.state.hasSubscription) {
    const now = quote(plan.state.selection);
    const then = quote({ ...plan.state.selection, products: toStack([...plan.state.selection.products, product]) });
    const more = then.totalCents - now.totalCents;
    if (more > 0) priceLine = `It adds ${formatMoney(more)} ${then.interval === 'yearly' ? 'per year' : 'per month'}.`;
  }

  const key = askKey(org.id, userId, product, askDay());
  let sent = 0;
  for (const to of recipients) {
    try {
      const result = await sendEmailNow(
        db,
        {
          orgId: org.id,
          to,
          template: 'app_request',
          payload: {
            orgName: org.name,
            portalUrl: portalUrl(),
            askerName: session.user.name?.trim() || session.user.email,
            product,
            ...(priceLine ? { priceLine } : {}),
          },
          dedupeKey: `${key}:${to}`,
        },
        { env: mailEnv() },
      );
      // Not out yet is still queued: the one minute job sends it. The ask counts.
      if (!result.ok) console.error(`[portal] the app request email is not out yet and stays queued: ${result.error ?? 'no detail'}`);
      sent += 1;
    } catch (error: unknown) {
      console.error('[portal] could not send the app request email', error);
    }
  }
  if (sent === 0) return { ok: false, error: 'We could not send your ask. Try again.' };
  revalidatePath('/billing');
  return { ok: true };
}
