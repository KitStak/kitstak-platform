/**
 * Words for alerts and notifications, made at read time from `{ kind, params }` (SPEC section 3).
 * Every kind has two variants: one with money and one without. Stored params are numbers and
 * ids only. Job based alerts reuse the risk sentences of `@/lib/profit`.
 */
import { formatMoney } from '@/lib/format';
import { NEXT_STEP_LABELS, riskSentence, type NextStep, type RiskRule } from '@/lib/profit';

export interface AlertWords {
  readonly title: string;
  readonly body: string;
  readonly nextStep: string | null;
}

type Params = Readonly<Record<string, unknown>>;
const text = (params: Params, key: string): string => (typeof params[key] === 'string' ? (params[key] as string) : '');
const number = (params: Params, key: string): number => (typeof params[key] === 'number' ? (params[key] as number) : Number(params[key] ?? 0) || 0);
const money = (cents: number): string => formatMoney(BigInt(Math.round(Math.abs(cents))), { cents: Math.abs(cents) < 1000 });
const percent = (bp: number): string => `${Math.round(bp / 100)}%`;

const TITLES: Readonly<Record<string, string>> = {
  job_losing: 'is losing money',
  job_at_risk: 'is at risk',
  margin_below: 'has a low margin',
  labor_over_budget: 'is over on labor',
  material_over_budget: 'is over on materials',
  productivity_below: 'is under the target pace',
  no_entry_days: 'has nothing logged',
  due_soon_behind: 'is due soon and behind',
  missing_rate: 'has hours with no labor rate',
  missing_price: 'has no price',
  missing_hours: 'has units with no hours',
  wms_shortage: 'is short on parts',
  unbilled_above: 'has work that is not billed yet',
};

/** The reason a job alert carries: the stored risk reason, worded for the reader. */
function reasonSentence(params: Params, seesMoney: boolean): string {
  const rule = text(params, 'rule');
  if (!rule) return '';
  const reasonParams = (params.reason && typeof params.reason === 'object' ? params.reason : {}) as Record<string, string | number | null>;
  try {
    return riskSentence({ rule: rule as RiskRule, params: reasonParams }, { seesMoney, unitLabel: text(params, 'unitLabel') || 'unit' });
  } catch {
    return '';
  }
}

/** Title, body and next step for an alert or a notification of `kind`. */
export function renderAlertWords(kind: string, params: Params, seesMoney: boolean): AlertWords {
  const job = [text(params, 'jobNumber'), text(params, 'jobName')].filter(Boolean).join(' ');
  const stepKey = text(params, 'nextStep') as NextStep;
  const step = stepKey && stepKey in NEXT_STEP_LABELS ? NEXT_STEP_LABELS[stepKey] : null;
  if (kind in TITLES && job) {
    let body = reasonSentence(params, seesMoney);
    if (kind === 'unbilled_above') body = seesMoney ? `${money(number(params, 'notBilledCents'))} of finished work is not on an invoice yet.` : 'Finished work on this job is not on an invoice yet.';
    if (kind === 'margin_below') body = seesMoney ? `Margin is heading for ${percent(number(params, 'marginBp'))}. Your alert is set at ${percent(number(params, 'thresholdBp'))}.` : 'This job is under the level set in your alert rule.';
    return { title: `${job} ${TITLES[kind]}`, body: body || 'Open the job to see why.', nextStep: step ?? (kind === 'unbilled_above' ? 'Send the invoice' : null) };
  }
  switch (kind) {
    case 'client_margin_below':
      return {
        title: `${text(params, 'clientName') || 'A client'} is under your margin level`,
        body: seesMoney ? `Margin over the last 30 days is ${percent(number(params, 'marginBp'))}. Your alert is set at ${percent(number(params, 'thresholdBp'))}.` : 'This client is under the level set in your alert rule.',
        nextStep: 'Review the price with the client',
      };
    case 'vas_margin_below':
      return {
        title: `${text(params, 'serviceName') || 'A service'} is under your margin level`,
        body: seesMoney ? `Margin over the last 30 days is ${percent(number(params, 'marginBp'))}. Your alert is set at ${percent(number(params, 'thresholdBp'))}.` : 'This service is under the level set in your alert rule.',
        nextStep: 'Review the service price',
      };
    case 'missing_time_above':
      return {
        title: 'Paid time is not on any job',
        body: seesMoney ? `${money(number(params, 'missingCents'))} of paid time this month is not on a job or a reason.` : `${number(params, 'missingHours')} paid hours this month are not on a job or a reason.`,
        nextStep: 'Log the missing time',
      };
    case 'overhead_rate_off':
      return {
        title: 'Your overhead rate is off',
        body: seesMoney ? `Your overhead rate covered ${money(number(params, 'absorbedCents'))} over the last 3 months. Your real overhead was ${money(number(params, 'companyCents'))}.` : 'Your overhead rate does not match your real overhead.',
        nextStep: 'Update the overhead per hour',
      };
    case 'month_ready_to_close':
      return { title: `${text(params, 'monthName') || 'Last month'} is ready to close`, body: 'Nothing is left to fix. Close the month to lock its numbers.', nextStep: 'Close the month' };
    case 'import_failed':
      return { title: 'An import did not finish', body: `${text(params, 'fileName') || 'A file'} could not be brought in. Open it to see why.`, nextStep: 'Open the import' };
    case 'sync_failed':
      return { title: 'A connected app did not sync', body: `Pulse could not read ${text(params, 'source') || 'a connected app'}. It will try again soon.`, nextStep: 'Open connected apps' };
    case 'deal_won_no_job':
      return { title: `${text(params, 'dealName') || 'A won deal'} has no job yet`, body: 'This deal was won in the CRM and Pulse has no job for it.', nextStep: 'Create the job' };
    case 'daily_digest':
      return { title: number(params, 'count') === 1 ? '1 thing needs you today' : `${number(params, 'count')} things need you today`, body: 'Open your alerts to see them, worst first.', nextStep: 'Open alerts' };
    case 'report_ready':
      return { title: `${text(params, 'reportName') || 'Your report'} is ready`, body: 'Open it to download the file.', nextStep: 'Open the report' };
    case 'day_sent_back':
      return { title: `${text(params, 'date')} was sent back`, body: text(params, 'note') || 'A manager asked for a fix on this day.', nextStep: 'Open the day' };
    case 'day_completed':
      return { title: `${text(params, 'date')} is ready for review`, body: number(params, 'flags') > 0 ? number(params, 'flags') === 1 ? '1 row looks odd.' : `${number(params, 'flags')} rows look odd.` : 'Nothing looks odd.', nextStep: 'Review the day' };
    case 'role_changed':
      return { title: 'Your Pulse role changed', body: 'Open Pulse to see what you can do now.', nextStep: null };
    default:
      return { title: 'Something needs you in Pulse', body: job ? `Open ${job} to see more.` : 'Open your alerts to see more.', nextStep: null };
  }
}


/** A job's current risk reason, as `pulse.job_stats.risk_reasons` stores it. */
export interface LiveReason {
  readonly rule: string;
  readonly params: Record<string, unknown>;
  readonly impactCents: number | null;
}

/**
 * The live version of a stored job alert. An alert is written when it fires and refreshed when
 * alerts are checked, so between checks its money can lag the job page. When the job still has
 * the reason that raised the alert, its current numbers are used (`impactAsOf: 'live'`), so Home,
 * the job page and the alert show one figure. When the reason is gone, the stored figure stays
 * and is labeled as the one from when the alert fired.
 */
export function liveJobAlert(
  stored: { readonly params: Record<string, unknown>; readonly impactCents: bigint | null },
  live: readonly LiveReason[] | null,
): { readonly params: Record<string, unknown>; readonly impactCents: bigint | null; readonly impactAsOf: 'live' | 'fired' } {
  const rule = typeof stored.params.rule === 'string' ? stored.params.rule : null;
  const current = rule && live ? live.find((reason) => reason.rule === rule) : undefined;
  if (!current) return { params: stored.params, impactCents: stored.impactCents, impactAsOf: rule && stored.impactCents !== null ? 'fired' : 'live' };
  return {
    params: { ...stored.params, reason: current.params, nextStep: stored.params.nextStep },
    impactCents: current.impactCents === null ? null : BigInt(Math.round(current.impactCents)),
    impactAsOf: 'live',
  };
}
