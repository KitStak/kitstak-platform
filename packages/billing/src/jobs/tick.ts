/**
 * `runBillingTick`: the one minute job (docs/billing/CONTRACTS.md section 14). In order:
 *
 *  1. send queued emails,
 *  2. queue the trial reminders and the last day reminder for late payments,
 *  3. ask the gateway again about plans a missed webhook could have left behind,
 *  4. in test gateway mode only, run what is due for the test subscriptions (the work Stripe does by
 *     itself over time),
 *  5. send the emails that steps 2 to 4 just queued, so nobody waits a minute for them.
 *
 * Every step is safe to run twice and safe to run at the same time as another tick. A step that
 * throws is logged and listed in `errors`; the other steps still run.
 */
import { deliverQueuedEmails } from '../emails/deliver';
import { resolveEmailProvider } from '../emails/provider';
import { testRunDue } from '../gateway/test';
import { errorText, logBilling, type BillingRuntime } from '../server/db';
import { reconcileSubscriptions } from './reconcile';
import { queueGraceReminders, queueTrialReminders } from './reminders';

export type TickStep = 'emails' | 'reminders' | 'reconcile' | 'test';

export interface TickReport {
  readonly emails: { sent: number; failed: number; skipped: number };
  readonly reminders: number;
  readonly reconciled: number;
  readonly testRenewals: number;
  readonly tookMs: number;
  /** One short line per step that threw. Empty when all went well. */
  readonly errors: readonly string[];
}

const EMAIL_BATCH = 50;
/**
 * The dev outbox only writes rows, so a backlog is drained in one tick. A real provider is paced
 * (Resend allows 2 requests a second), so one batch per pass keeps a tick well under a minute.
 */
const OUTBOX_MAX_BATCHES = 20;
const SECOND_PASS_BATCH = 15;
const SECOND_PASS_WITHIN_MS = 25_000;

export async function runBillingTick(
  rt: BillingRuntime,
  options?: { only?: readonly TickStep[]; env?: NodeJS.ProcessEnv },
): Promise<TickReport> {
  const started = Date.now();
  const wants = (step: TickStep): boolean => !options?.only || options.only.includes(step);
  const emails = { sent: 0, failed: 0, skipped: 0 };
  const errors: string[] = [];
  let reminders = 0;
  let reconciled = 0;
  let testRenewals = 0;

  const run = async (name: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      const text = errorText(error, 200);
      errors.push(`${name}: ${text}`);
      logBilling('error', `billing tick step failed: ${name}`, { error: text });
    }
  };

  const outbox = resolveEmailProvider(options?.env ?? process.env) === 'outbox';
  const batches = outbox ? OUTBOX_MAX_BATCHES : 1;
  const deliver = async (limit: number): Promise<void> => {
    for (let batch = 0; batch < batches; batch += 1) {
      const result = await deliverQueuedEmails(rt.db, {
        limit,
        now: rt.now(),
        ...(options?.env ? { env: options.env } : {}),
      });
      emails.sent += result.sent;
      emails.failed += result.failed;
      // Rows left waiting are the same rows on the second pass. Report them once.
      emails.skipped = Math.max(emails.skipped, result.skipped);
      if (result.sent + result.failed < limit) break;
    }
  };

  if (wants('emails')) await run('emails', () => deliver(EMAIL_BATCH));

  if (wants('reminders')) {
    await run('trial reminders', async () => {
      reminders += await queueTrialReminders(rt);
    });
    await run('grace reminders', async () => {
      reminders += await queueGraceReminders(rt);
    });
  }

  if (wants('reconcile')) {
    await run('reconcile', async () => {
      reconciled = await reconcileSubscriptions(rt, { limit: 20 });
    });
  }

  if (wants('test') && rt.mode === 'test_gateway') {
    await run('test renewals', async () => {
      const result = await testRunDue(rt);
      testRenewals = result.renewed + result.failed;
    });
  }

  // Second pass: what this tick just queued goes out now, so nobody waits a minute for it. It is
  // small and only runs while the tick is young: a paced provider must never push one tick past
  // the minute the platform gives it. Anything left goes out with the next tick.
  const queuedSomething = reminders > 0 || reconciled > 0 || testRenewals > 0;
  if (wants('emails') && queuedSomething && Date.now() - started < SECOND_PASS_WITHIN_MS) {
    await run('emails', () => deliver(outbox ? EMAIL_BATCH : SECOND_PASS_BATCH));
  }

  return { emails, reminders, reconciled, testRenewals, tookMs: Date.now() - started, errors };
}
