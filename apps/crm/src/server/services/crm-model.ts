/**
 * Pure CRM computations (no I/O): stage semantics, pipeline cockpit metrics, duplicate
 * detection and lead → account/contact matching. Fully unit tested in `crm-model.test.ts`.
 */
import type {
  CrmLabelDto,
  FunnelStageDto,
  ForecastMonthDto,
  PipelinePeriod,
  PipelineSummaryDto,
  RiskReason,
  StageKind,
} from './crm-contracts';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------

export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.includes('@') ? trimmed : null;
}

const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
]);

/** Company domain of an email (null for free-mail providers, which say nothing about the company). */
export function emailDomain(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return domain && !FREE_MAIL.has(domain) ? domain : null;
}

/** Bare host of a website ("https://www.acme.com/about" → "acme.com"). */
export function domainFromUrl(value: string | null | undefined): string | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  const withoutScheme = raw.replace(/^[a-z]+:\/\//, '');
  const host = withoutScheme.split(/[/?#]/)[0]?.replace(/^www\./, '').replace(/:\d+$/, '') ?? '';
  return host.includes('.') ? host : null;
}

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|ag|sa|plc|bv|pty|group|holdings)\b\.?/g;

/** Comparable company name: lowercase, no punctuation or legal suffixes. */
export function normalizeCompanyName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Comparable person name: lowercase, accents and punctuation stripped, single spaces. */
export function normalizePersonName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Company slug used to compare a company name with a domain ("Acme Robotics" ~ "acmerobotics.com"). */
export function companySlug(value: string | null | undefined): string {
  return normalizeCompanyName(value).replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------

export interface StageLabelInput {
  readonly id: string;
  readonly name: string;
  readonly color: CrmLabelDto['color'];
  readonly position: number;
  readonly isDone?: boolean;
  readonly isDefault?: boolean;
}

export interface StageInfo {
  readonly label: CrmLabelDto;
  readonly kind: StageKind;
  readonly probability: number;
  /** Order among the pipeline stages (open stages first, then won, then lost). */
  readonly order: number;
}

function stageKindOf(label: StageLabelInput): StageKind {
  const text = `${label.id} ${label.name}`.toLowerCase();
  if (/\blost\b|closed[\s_-]?lost|\bdead\b|\bdisqualified\b/.test(text)) return 'lost';
  if (label.isDone || /\bwon\b|closed[\s_-]?won/.test(text)) return 'won';
  return 'open';
}

/** Linear default for open stages: 1/(n+1) … n/(n+1), rounded to 5%. */
function linearProbability(index: number, openCount: number): number {
  return Math.round(((index + 1) / (openCount + 1)) * 20) * 5;
}

/**
 * Classify stage labels into open/won/lost (semantic flags or naming), order them and assign
 * a probability: saved override → average observed in the data → linear default.
 */
export function buildStages(
  labels: readonly StageLabelInput[],
  overrides: Readonly<Record<string, number>> = {},
  observed: Readonly<Record<string, number>> = {},
): StageInfo[] {
  const pipeline = [...labels].filter((label) => !label.isDefault).sort((a, b) => a.position - b.position);
  const open = pipeline.filter((label) => stageKindOf(label) === 'open');
  const won = pipeline.filter((label) => stageKindOf(label) === 'won');
  const lost = pipeline.filter((label) => stageKindOf(label) === 'lost');
  const ordered = [...open, ...won, ...lost];
  return ordered.map((label, order) => {
    const kind = stageKindOf(label);
    const fallback =
      kind === 'won' ? 100 : kind === 'lost' ? 0 : linearProbability(open.indexOf(label), open.length);
    const saved = overrides[label.id];
    const seen = observed[label.id];
    const probability = clampPercent(saved ?? (kind === 'open' && seen !== undefined ? seen : fallback));
    return { label: { id: label.id, name: label.name || 'No stage', color: label.color }, kind, probability, order };
  });
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Average of a probability column per stage, from deals that have both values. */
export function observedProbabilities(
  deals: readonly { readonly stageId: string | null; readonly probability: number | null }[],
): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const deal of deals) {
    if (!deal.stageId || deal.probability === null || !Number.isFinite(deal.probability)) continue;
    const entry = sums.get(deal.stageId) ?? { total: 0, count: 0 };
    sums.set(deal.stageId, { total: entry.total + deal.probability, count: entry.count + 1 });
  }
  return Object.fromEntries([...sums].map(([id, { total, count }]) => [id, Math.round(total / count)]));
}

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Inclusive ISO date range for a period relative to `today` (UTC), null for "all". */
export function periodRange(period: PipelinePeriod, today: Date): DateRange | null {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const quarterStart = Math.floor(month / 3) * 3;
  switch (period) {
    case 'this_month':
      return { from: iso(utc(year, month, 1)), to: iso(utc(year, month + 1, 0)) };
    case 'this_quarter':
      return { from: iso(utc(year, quarterStart, 1)), to: iso(utc(year, quarterStart + 3, 0)) };
    case 'next_quarter':
      return { from: iso(utc(year, quarterStart + 3, 1)), to: iso(utc(year, quarterStart + 6, 0)) };
    case 'this_year':
      return { from: iso(utc(year, 0, 1)), to: iso(utc(year, 12, 0)) };
    case 'all':
      return null;
  }
}

export function inRange(date: string | null, range: DateRange | null): boolean {
  if (!range) return true;
  return date !== null && date >= range.from && date <= range.to;
}

/** Number of quarters a period spans (quota scaling). */
export function periodQuarters(period: PipelinePeriod): number {
  return period === 'this_month' ? 1 / 3 : period === 'this_year' ? 4 : period === 'all' ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------
// Pipeline cockpit
// ---------------------------------------------------------------------------------------------

export interface StageChange {
  readonly labelId: string;
  readonly at: string;
}

export interface DealFacts {
  readonly id: string;
  readonly name: string;
  readonly stageId: string | null;
  readonly value: number;
  readonly closeDate: string | null;
  readonly ownerIds: readonly string[];
  readonly createdAt: string;
  readonly lastActivityAt: string | null;
  /** Stage changes oldest first (from the activity log). */
  readonly history: readonly StageChange[];
}

export interface PipelineInput {
  readonly deals: readonly DealFacts[];
  readonly stages: readonly StageInfo[];
  readonly today: Date;
  readonly range: DateRange | null;
  readonly owner: string | null;
  readonly staleDays: number;
  readonly quotas: Readonly<Record<string, number>>;
  /** Quarters covered by the period (quota multiplier). */
  readonly quarters: number;
  readonly forecastMonths?: number;
}

export interface RepComputed {
  readonly userId: string;
  readonly openCount: number;
  readonly openValue: number;
  readonly weighted: number;
  readonly won: number;
  readonly quota: number | null;
  readonly attainment: number | null;
}

export interface RiskComputed {
  readonly deal: DealFacts;
  readonly daysSinceActivity: number | null;
  readonly reasons: RiskReason[];
}

export interface VelocityComputed {
  readonly label: CrmLabelDto;
  readonly avgDays: number | null;
  readonly transitions: number;
  readonly currentAvgDays: number | null;
  readonly currentCount: number;
}

export interface PipelineComputed {
  readonly summary: PipelineSummaryDto;
  readonly funnel: FunnelStageDto[];
  readonly forecast: ForecastMonthDto[];
  readonly reps: RepComputed[];
  readonly atRisk: RiskComputed[];
  readonly velocity: VelocityComputed[];
}

function daysBetween(fromIso: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - Date.parse(fromIso)) / DAY_MS));
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function addMonths(date: Date, months: number): string {
  return iso(utc(date.getUTCFullYear(), date.getUTCMonth() + months, 1)).slice(0, 7);
}

/** Highest open-stage order a deal reached (history ∪ current); won reaches every open stage. */
export function reachedOrder(deal: DealFacts, stageById: ReadonlyMap<string, StageInfo>, lastOpen: number): number {
  let reached = -1;
  const visit = (labelId: string | null) => {
    if (!labelId) return;
    const stage = stageById.get(labelId);
    if (!stage) return;
    if (stage.kind === 'won') reached = Math.max(reached, lastOpen + 1);
    else if (stage.kind === 'open') reached = Math.max(reached, stage.order);
  };
  for (const change of deal.history) visit(change.labelId);
  visit(deal.stageId);
  return reached;
}

export function computePipeline(input: PipelineInput): PipelineComputed {
  const { stages, today, range, staleDays } = input;
  const todayIso = iso(today);
  const stageById = new Map(stages.map((stage) => [stage.label.id, stage]));
  const kindOf = (deal: DealFacts): StageKind => (deal.stageId ? stageById.get(deal.stageId)?.kind : undefined) ?? 'open';
  const probabilityOf = (deal: DealFacts) => (deal.stageId ? (stageById.get(deal.stageId)?.probability ?? 0) : 0);
  const owned = input.owner ? input.deals.filter((deal) => deal.ownerIds.includes(input.owner as string)) : input.deals;
  const inPeriod = owned.filter((deal) => inRange(deal.closeDate, range));

  // Summary ---------------------------------------------------------------------------------
  const open = inPeriod.filter((deal) => kindOf(deal) === 'open');
  const won = inPeriod.filter((deal) => kindOf(deal) === 'won');
  const lost = inPeriod.filter((deal) => kindOf(deal) === 'lost');
  const sum = (list: readonly DealFacts[]) => list.reduce((total, deal) => total + deal.value, 0);
  const weightedSum = (list: readonly DealFacts[]) =>
    list.reduce((total, deal) => total + (deal.value * probabilityOf(deal)) / 100, 0);
  const closed = won.length + lost.length;
  const summary: PipelineSummaryDto = {
    openCount: open.length,
    openValue: sum(open),
    weighted: Math.round(weightedSum(open)),
    wonValue: sum(won),
    wonCount: won.length,
    lostCount: lost.length,
    winRate: closed > 0 ? won.length / closed : null,
    avgDealSize: won.length > 0 ? Math.round(sum(won) / won.length) : null,
  };

  // Funnel ----------------------------------------------------------------------------------
  const openStages = stages.filter((stage) => stage.kind === 'open');
  const lastOpen = openStages.length > 0 ? Math.max(...openStages.map((stage) => stage.order)) : -1;
  const reached = new Map(inPeriod.map((deal) => [deal.id, reachedOrder(deal, stageById, lastOpen)]));
  const reachedAtLeast = (order: number) => [...reached.values()].filter((value) => value >= order).length;
  const funnel: FunnelStageDto[] = stages.map((stage, index) => {
    const here = inPeriod.filter((deal) => deal.stageId === stage.label.id);
    let conversion: number | null = null;
    if (stage.kind === 'open' && index > 0) {
      const previous = reachedAtLeast(stage.order - 1);
      conversion = previous > 0 ? reachedAtLeast(stage.order) / previous : null;
    } else if (stage.kind === 'won') {
      conversion = summary.winRate;
    }
    return {
      label: stage.label,
      kind: stage.kind,
      probability: stage.probability,
      count: here.length,
      value: sum(here),
      weighted: Math.round(weightedSum(here)),
      conversion,
    };
  });

  // Forecast by close month (independent of the period filter) --------------------------------
  const months = input.forecastMonths ?? 6;
  const monthKeys = Array.from({ length: months }, (_, index) => addMonths(today, index));
  const buckets = new Map<string, { won: number; weighted: number; bestCase: number; count: number }>(
    ['overdue', ...monthKeys].map((key) => [key, { won: 0, weighted: 0, bestCase: 0, count: 0 }]),
  );
  for (const deal of owned) {
    if (!deal.closeDate) continue;
    const kind = kindOf(deal);
    if (kind === 'lost') continue;
    const key = kind === 'open' && deal.closeDate < todayIso ? 'overdue' : monthKey(deal.closeDate);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (kind === 'won') {
      bucket.won += deal.value;
    } else {
      bucket.weighted += (deal.value * probabilityOf(deal)) / 100;
      bucket.bestCase += deal.value;
      bucket.count += 1;
    }
  }
  const forecast: ForecastMonthDto[] = [...buckets].map(([month, bucket]) => ({
    month,
    won: Math.round(bucket.won),
    weighted: Math.round(bucket.weighted),
    bestCase: Math.round(bucket.bestCase),
    count: bucket.count,
  }));

  // Reps --------------------------------------------------------------------------------------
  const repIds = new Set<string>([...inPeriod.flatMap((deal) => deal.ownerIds), ...Object.keys(input.quotas)]);
  if (input.owner) for (const id of [...repIds]) if (id !== input.owner) repIds.delete(id);
  const reps: RepComputed[] = [...repIds].map((userId) => {
    const mine = inPeriod.filter((deal) => deal.ownerIds.includes(userId));
    const mineOpen = mine.filter((deal) => kindOf(deal) === 'open');
    const mineWon = sum(mine.filter((deal) => kindOf(deal) === 'won'));
    const quarterly = input.quotas[userId];
    const quota = quarterly !== undefined && input.quarters > 0 ? Math.round(quarterly * input.quarters) : null;
    return {
      userId,
      openCount: mineOpen.length,
      openValue: sum(mineOpen),
      weighted: Math.round(weightedSum(mineOpen)),
      won: mineWon,
      quota,
      attainment: quota && quota > 0 ? mineWon / quota : null,
    };
  });
  reps.sort((a, b) => b.won - a.won || b.weighted - a.weighted);

  // At risk (all open deals of the owner, regardless of period) -------------------------------
  const atRisk: RiskComputed[] = [];
  for (const deal of owned) {
    if (kindOf(deal) !== 'open') continue;
    const reasons: RiskReason[] = [];
    const lastTouch = deal.lastActivityAt ?? deal.createdAt;
    const daysSinceActivity = daysBetween(lastTouch, today);
    if (daysSinceActivity >= staleDays) reasons.push('stale');
    if (deal.closeDate && deal.closeDate < todayIso) reasons.push('overdue');
    if (reasons.length > 0) atRisk.push({ deal, daysSinceActivity, reasons });
  }
  atRisk.sort((a, b) => b.reasons.length - a.reasons.length || b.deal.value - a.deal.value);

  // Velocity ----------------------------------------------------------------------------------
  const durations = new Map<string, number[]>();
  const current = new Map<string, number[]>();
  for (const deal of owned) {
    const history = [...deal.history].sort((a, b) => a.at.localeCompare(b.at));
    history.forEach((change, index) => {
      const next = history[index + 1];
      if (next) {
        const days = (Date.parse(next.at) - Date.parse(change.at)) / DAY_MS;
        durations.set(change.labelId, [...(durations.get(change.labelId) ?? []), Math.max(0, days)]);
      }
    });
    if (deal.stageId && kindOf(deal) === 'open') {
      const entered = [...history].reverse().find((change) => change.labelId === deal.stageId)?.at ?? deal.createdAt;
      current.set(deal.stageId, [...(current.get(deal.stageId) ?? []), daysBetween(entered, today)]);
    }
  }
  const average = (values: readonly number[] | undefined) =>
    values && values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
  const velocity: VelocityComputed[] = openStages.map((stage) => ({
    label: stage.label,
    avgDays: average(durations.get(stage.label.id)),
    transitions: durations.get(stage.label.id)?.length ?? 0,
    currentAvgDays: average(current.get(stage.label.id)),
    currentCount: current.get(stage.label.id)?.length ?? 0,
  }));

  return { summary, funnel, forecast, reps, atRisk, velocity };
}

// ---------------------------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------------------------

export interface DuplicateCandidate {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly domain: string | null;
  /** Account id for contacts (same name in the same account = strong signal). */
  readonly accountId: string | null;
  readonly linkCount: number;
  readonly filledFields: number;
  readonly createdAt: string;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Most complete, best linked, oldest record wins. */
export function suggestPrimary(records: readonly DuplicateCandidate[]): string {
  const sorted = [...records].sort(
    (a, b) =>
      b.filledFields - a.filledFields || b.linkCount - a.linkCount || a.createdAt.localeCompare(b.createdAt),
  );
  return sorted[0]?.id ?? '';
}

export interface RawCluster {
  readonly key: string;
  readonly reason: 'email' | 'domain' | 'name';
  readonly confidence: 'high' | 'medium';
  readonly records: readonly DuplicateCandidate[];
}

/** True when a group carries contradicting evidence (different email domains or accounts). */
export function hasConflictingEvidence(group: readonly DuplicateCandidate[]): boolean {
  const distinct = (values: readonly (string | null)[]) => new Set(values.filter((value): value is string => Boolean(value))).size;
  return distinct(group.map((record) => record.domain)) > 1 || distinct(group.map((record) => record.accountId)) > 1;
}

/**
 * Cluster suspected duplicates. Contacts: same email (high), same name + same account or email
 * domain (high), same name with no contradicting evidence — no differing email domains or
 * accounts — (medium). Accounts: same website domain (high), same normalized name when the
 * websites do not disagree (high). Same-name records at different companies are never
 * suggested. A record joins at most one cluster; dismissed pairs never re-cluster together.
 */
export function clusterIds(
  kind: 'contacts' | 'accounts',
  records: readonly DuplicateCandidate[],
  dismissed: ReadonlySet<string> = new Set(),
): RawCluster[] {
  const used = new Set<string>();
  const clusters: RawCluster[] = [];
  const pass = (
    reason: RawCluster['reason'],
    confidence: RawCluster['confidence'],
    keyOf: (record: DuplicateCandidate) => string | null,
    accept: (group: readonly DuplicateCandidate[]) => boolean = () => true,
  ) => {
    const groups = new Map<string, DuplicateCandidate[]>();
    for (const record of records) {
      if (used.has(record.id)) continue;
      const key = keyOf(record);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    for (const [key, group] of groups) {
      // Drop members whose every pairing in the group was dismissed.
      const members = group.filter((record) =>
        group.some((other) => other.id !== record.id && !dismissed.has(pairKey(record.id, other.id))),
      );
      if (members.length < 2 || !accept(members)) continue;
      for (const member of members) used.add(member.id);
      clusters.push({ key: `${reason}:${key}`, reason, confidence, records: members });
    }
  };
  if (kind === 'contacts') {
    pass('email', 'high', (record) => normalizeEmail(record.email));
    pass('name', 'high', (record) => {
      const name = normalizePersonName(record.name);
      const scope = record.accountId ?? record.domain;
      return name && scope ? `${name}|${scope}` : null;
    });
    pass('name', 'medium', (record) => normalizePersonName(record.name) || null, (group) => !hasConflictingEvidence(group));
  } else {
    pass('domain', 'high', (record) => record.domain);
    pass('name', 'high', (record) => normalizeCompanyName(record.name) || null, (group) => !hasConflictingEvidence(group));
  }
  return clusters.sort(
    (a, b) => (a.confidence === b.confidence ? b.records.length - a.records.length : a.confidence === 'high' ? -1 : 1),
  );
}

// ---------------------------------------------------------------------------------------------
// Lead conversion matching
// ---------------------------------------------------------------------------------------------

export interface AccountCandidate {
  readonly id: string;
  readonly name: string;
  readonly domain: string | null;
}

export interface ContactCandidate {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly accountName: string | null;
}

export interface MatchResult<T> {
  readonly record: T;
  readonly reason: 'email' | 'domain' | 'name';
  readonly confidence: 'high' | 'medium';
}

/** Accounts matching a lead's email domain or company name, strongest first. */
export function matchAccounts(
  lead: { readonly email: string | null; readonly company: string | null },
  accounts: readonly AccountCandidate[],
): MatchResult<AccountCandidate>[] {
  const domain = emailDomain(lead.email);
  const company = normalizeCompanyName(lead.company);
  const slug = companySlug(lead.company);
  const results: MatchResult<AccountCandidate>[] = [];
  for (const account of accounts) {
    if (domain && account.domain && account.domain === domain) {
      results.push({ record: account, reason: 'domain', confidence: 'high' });
    } else if (company && normalizeCompanyName(account.name) === company) {
      results.push({ record: account, reason: 'name', confidence: 'high' });
    } else if (slug.length >= 4 && account.domain && account.domain.split('.')[0] === slug) {
      results.push({ record: account, reason: 'domain', confidence: 'medium' });
    }
  }
  return results.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1)).slice(0, 5);
}

/** Contacts matching a lead's email (high) or name (medium), strongest first. */
export function matchContacts(
  lead: { readonly name: string; readonly email: string | null },
  contacts: readonly ContactCandidate[],
): MatchResult<ContactCandidate>[] {
  const email = normalizeEmail(lead.email);
  const name = normalizePersonName(lead.name);
  const results: MatchResult<ContactCandidate>[] = [];
  for (const contact of contacts) {
    if (email && normalizeEmail(contact.email) === email) {
      results.push({ record: contact, reason: 'email', confidence: 'high' });
    } else if (name && normalizePersonName(contact.name) === name) {
      results.push({ record: contact, reason: 'name', confidence: 'medium' });
    }
  }
  return results.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1)).slice(0, 5);
}

/** Group + upcoming flag for a logged activity. */
export function activityIsUpcoming(date: string, outcome: string, today: Date): boolean {
  return outcome === 'scheduled' || date > iso(today);
}
