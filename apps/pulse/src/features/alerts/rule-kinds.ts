/**
 * What each alert rule watches, as plain sentences. Pure: the rule builder, the rule list and the
 * tests share it. A rule reads "Tell me when " plus `sentence(threshold)`.
 */
import type { AlertKind, AlertSeverity } from '@/lib/constants';

export type ThresholdUnit = 'percent' | 'dollars';

/** Workspace settings a rule sentence can name. None of them is money, so every reader sees them. */
export interface RuleFacts {
  /** Settings, "Nothing logged for": how many work days with no entry before the rule fires. */
  readonly noEntryDays?: number | null;
}

/** "3 work days", "1 work day", or "a few work days" when the count is not known. */
export function workDaysText(days: number | null | undefined): string {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) return 'a few work days';
  return `${days} work ${days === 1 ? 'day' : 'days'}`;
}

export interface RuleKindInfo {
  /** Short name for the picker. */
  readonly label: string;
  readonly group: 'Jobs' | 'Clients and services' | 'Company' | 'Connected apps';
  /**
   * The rest of "Tell me when ...". `number` is the typed line, already formatted ("15%", "$2,000").
   * `facts` are workspace settings a rule reads that are not money, like a count of days.
   */
  readonly sentence: (number: string | null, facts?: RuleFacts) => string;
  readonly threshold: null | { readonly unit: ThresholdUnit; readonly required: boolean; readonly fallback: string; readonly label: string; readonly hint: string };
  /** Job rules can be narrowed to one client, job type or site. */
  readonly scoped: boolean;
  readonly severity: AlertSeverity;
  readonly help: string;
}

export const RULE_KINDS: Readonly<Record<AlertKind, RuleKindInfo>> = {
  margin_below: {
    label: 'Margin under a number',
    group: 'Jobs',
    sentence: (n) => `a job's margin is heading under ${n ?? 'a number you pick'}`,
    threshold: { unit: 'percent', required: true, fallback: '15', label: 'Margin line', hint: 'A percent, like 15.' },
    scoped: true,
    severity: 'warning',
    help: 'Looks at where the margin of each open job will land when it finishes.',
  },
  job_losing: { label: 'Job losing money', group: 'Jobs', sentence: () => 'a job is losing money', threshold: null, scoped: true, severity: 'critical', help: 'The job costs more than it earns, now or at the finish.' },
  job_at_risk: { label: 'Job at risk', group: 'Jobs', sentence: () => 'a job is at risk', threshold: null, scoped: true, severity: 'warning', help: 'The job is well under its target margin, or far over its plan.' },
  labor_over_budget: { label: 'Labor over plan', group: 'Jobs', sentence: () => 'a job goes over its labor plan', threshold: null, scoped: true, severity: 'warning', help: 'Labor cost so far is more than the plan allows for the units done.' },
  material_over_budget: { label: 'Materials over plan', group: 'Jobs', sentence: () => 'a job goes over its material plan', threshold: null, scoped: true, severity: 'warning', help: 'Material cost so far is more than the plan allows for the units done.' },
  productivity_below: { label: 'Pace under target', group: 'Jobs', sentence: () => 'a crew is under the target pace', threshold: null, scoped: true, severity: 'warning', help: 'Units per person per hour are under the target pace of the job.' },
  no_entry_days: { label: 'Nothing logged', group: 'Jobs', sentence: (_line, facts) => `an active job has nothing logged for ${workDaysText(facts?.noEntryDays)}`, threshold: null, scoped: true, severity: 'warning', help: 'An active job with no work log entries for several work days in a row.' },
  due_soon_behind: { label: 'Due soon and behind', group: 'Jobs', sentence: () => 'a job is due soon and behind', threshold: null, scoped: true, severity: 'warning', help: 'At the pace so far the job will finish after its due date.' },
  missing_rate: { label: 'Hours with no labor rate', group: 'Jobs', sentence: () => 'hours have no labor rate', threshold: null, scoped: true, severity: 'warning', help: 'Hours with no rate have no cost, so the job looks better than it is.' },
  missing_price: { label: 'Job with no price', group: 'Jobs', sentence: () => 'a job has no price', threshold: null, scoped: true, severity: 'warning', help: 'A job with no price earns nothing on paper.' },
  missing_hours: { label: 'Units with no hours', group: 'Jobs', sentence: () => 'a day has units and no hours', threshold: null, scoped: true, severity: 'warning', help: 'A day with units and no hours has no labor cost.' },
  unbilled_above: {
    label: 'Finished work not billed',
    group: 'Jobs',
    sentence: (n) => `finished work worth more than ${n ?? 'your workspace limit'} is not billed`,
    threshold: { unit: 'dollars', required: false, fallback: '', label: 'Not billed above', hint: 'Dollars, like 5000. Leave it empty to use the workspace limit.' },
    scoped: true,
    severity: 'info',
    help: 'Work that is done and not on an invoice yet.',
  },
  client_margin_below: {
    label: 'Client margin under a number',
    group: 'Clients and services',
    sentence: (n) => `a client's margin over 30 days falls under ${n ?? 'a number you pick'}`,
    threshold: { unit: 'percent', required: true, fallback: '20', label: 'Margin line', hint: 'A percent, like 20.' },
    scoped: false,
    severity: 'warning',
    help: 'Looks at every client over the last 30 days.',
  },
  vas_margin_below: {
    label: 'Extra service margin under a number',
    group: 'Clients and services',
    sentence: (n) => `an extra service's margin over 30 days falls under ${n ?? 'a number you pick'}`,
    threshold: { unit: 'percent', required: true, fallback: '20', label: 'Margin line', hint: 'A percent, like 20.' },
    scoped: false,
    severity: 'warning',
    help: 'Looks at every extra service over the last 30 days.',
  },
  missing_time_above: {
    label: 'Paid time not on a job',
    group: 'Company',
    sentence: (n) => `more than ${n ?? '$0'} of paid time this month is not on any job`,
    threshold: { unit: 'dollars', required: false, fallback: '2000', label: 'Paid time gap above', hint: 'Dollars, like 2000.' },
    scoped: false,
    severity: 'info',
    help: 'Paid hours that were not logged on a job or a reason.',
  },
  overhead_rate_off: {
    label: 'Overhead rate is off',
    group: 'Company',
    sentence: (n) => `my overhead rate is off by more than ${n ?? '$0'} over 3 months`,
    threshold: { unit: 'dollars', required: false, fallback: '1000', label: 'Gap above', hint: 'Dollars, like 1000.' },
    scoped: false,
    severity: 'info',
    help: 'Compares the overhead your labor rates covered with your real company costs.',
  },
  month_ready_to_close: { label: 'Month ready to close', group: 'Company', sentence: () => 'a month is ready to close', threshold: null, scoped: false, severity: 'info', help: 'Last month has nothing left to fix.' },
  wms_shortage: { label: 'Warehouse short on parts', group: 'Connected apps', sentence: () => 'the warehouse is short on parts for a job', threshold: null, scoped: true, severity: 'warning', help: 'Needs KitStak WMS.' },
  deal_won_no_job: { label: 'Won deal with no job', group: 'Connected apps', sentence: () => 'a deal is won and has no job yet', threshold: null, scoped: false, severity: 'info', help: 'Needs KitStak CRM.' },
  import_failed: { label: 'Import did not finish', group: 'Connected apps', sentence: () => 'an import does not finish', threshold: null, scoped: false, severity: 'warning', help: 'A CSV import stopped with an error.' },
  sync_failed: { label: 'Connected app did not sync', group: 'Connected apps', sentence: () => 'a connected app does not sync', threshold: null, scoped: false, severity: 'warning', help: 'Pulse could not read a connected app.' },
};

export const RULE_GROUPS = ['Jobs', 'Clients and services', 'Company', 'Connected apps'] as const;

/** What a person typed for the line ("15", "$2,000", "12.5%") as the text the server stores, or null when it is not usable. */
export function readThreshold(unit: ThresholdUnit, typed: string): string | null {
  const text = typed.replace(/[$,%\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (unit === 'percent' && (value <= 0 || value >= 100)) return null;
  if (unit === 'dollars' && value < 0) return null;
  return text;
}

/** A stored line as text for a sentence: "15%", "$2,000". */
export function thresholdText(unit: ThresholdUnit, stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return null;
  const value = Number(stored);
  if (!Number.isFinite(value)) return null;
  if (unit === 'percent') return `${Number(value.toFixed(2))}%`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** What stands in for the line when the reader may not see money: "a set amount", "a set line". */
export const HIDDEN_LINE: Readonly<Record<ThresholdUnit, string>> = { dollars: 'a set amount', percent: 'a set line' };

/** True when the rule has a line (dollars or a margin percent). Lines are money: hidden from readers without money. */
export function ruleHasLine(kind: string): boolean {
  return Boolean((RULE_KINDS as Readonly<Record<string, RuleKindInfo | undefined>>)[kind]?.threshold);
}

/**
 * The whole rule as one sentence: "Tell me when a job's margin is heading under 15%."
 * With `moneyHidden` the line is left out: "Tell me when more than a set amount of paid time this
 * month is not on any job." A count of days is not money, so `facts` show for every reader:
 * "Tell me when an active job has nothing logged for 3 work days."
 */
export function ruleSentence(kind: AlertKind, threshold: string | null | undefined, options: { readonly moneyHidden?: boolean; readonly facts?: RuleFacts } = {}): string {
  const info = RULE_KINDS[kind];
  if (info.threshold && options.moneyHidden) return `Tell me when ${info.sentence(HIDDEN_LINE[info.threshold.unit], options.facts)}.`;
  const number = info.threshold ? thresholdText(info.threshold.unit, threshold) : null;
  return `Tell me when ${info.sentence(number, options.facts)}.`;
}

/**
 * The name kept in the database for a rule. It never holds the line itself (no dollars, no
 * percent), so the stored words are safe for every reader. Screens build the full sentence from
 * the kind and the line, for readers who may see money.
 */
export function storedRuleName(kind: AlertKind): string {
  return ruleSentence(kind, null, { moneyHidden: true }).replace(/\.$/, '');
}

/** Takes dollar amounts and percents out of free text ("under $2,000" reads "under a set amount"). */
export function hideLinesInText(text: string): string {
  return text.replace(/-?\$\s?\d[\d,]*(?:\.\d+)?[kKmM]?/g, HIDDEN_LINE.dollars).replace(/-?\d+(?:\.\d+)?\s?%/g, HIDDEN_LINE.percent);
}

/** A rule's name for a reader without money: the sentence with no line, or the stored name with its numbers taken out. */
export function ruleNameWithoutMoney(kind: string, name: string): string {
  if (ruleHasLine(kind)) return storedRuleName(kind as AlertKind);
  return hideLinesInText(name);
}

/** A stored line as a person would type it: "15" not "15.0000". */
export const tidyThreshold = (stored: string | null | undefined): string => (stored === null || stored === undefined || stored === '' ? '' : String(Number(stored)));

/** Who a rule tells, as words: "Owners, admins and Dana Ortiz". */
export function tellSentence(roles: readonly string[], people: readonly string[]): string {
  const ROLE_WORDS: Readonly<Record<string, string>> = { owner: 'owners', admin: 'admins', manager: 'managers', supervisor: 'supervisors', viewer: 'viewers' };
  const parts = [...roles.map((role) => ROLE_WORDS[role]).filter((word): word is string => Boolean(word)), ...people];
  if (parts.length === 0) return 'Nobody gets a message. The alert still shows in the inbox.';
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Tells ${list}.`;
}
