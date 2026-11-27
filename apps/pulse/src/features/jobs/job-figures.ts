/**
 * One source and one rounding rule for the figures a job shows in more than one place: the loss
 * at finish, the paces and the cost for one unit. The job page, the jobs list, Home and the
 * alerts all read them from here, so the same number never shows two ways. Pure, no React.
 *
 * Rules: money in a headline is whole dollars, money for one unit is to the cent, pace is to one
 * decimal. Each pace and each unit cost says which one it is (whole job, recent days, rest of the
 * job; so far or at finish), because those are different numbers.
 */
import { formatMoney } from '@/lib/format';
import { perUnitCents, toCents, type Cents } from '@/lib/money';
import { planFigures, planHasCosts, type PlanTotals } from '@/lib/profit';
import { sentenceNumber } from '@/lib/profit/words';
import type { JobStatsDTO, RiskReasonDTO } from '@/lib/types';

type Stats = Pick<JobStatsDTO, 'unitsGood' | 'uph' | 'standardUph' | 'paceUph' | 'costCents' | 'costAtFinishCents' | 'projectedProfitCents' | 'mode' | 'riskReasons'>;

const reasonOf = (reasons: readonly Pick<RiskReasonDTO, 'rule' | 'params'>[], rules: readonly string[]) =>
  reasons.find((reason) => rules.includes(reason.rule)) ?? null;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A pace to one decimal for a sentence or a card: 27.63 is "27.6", 46 is "46". */
export function paceWords(uph: number | string | null | undefined): string | null {
  if (uph === null || uph === undefined || uph === '') return null;
  const value = Number(uph);
  return Number.isFinite(value) ? sentenceNumber(value, 1) : null;
}

/** Whole dollars, the way every headline loss reads: "$2,896". */
export function headlineMoney(cents: number | bigint | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const abs = typeof cents === 'bigint' ? (cents < BigInt(0) ? -cents : cents) : Math.abs(cents);
  return formatMoney(abs, { cents: false });
}

export interface JobHeadlineFigures {
  /** The loss at finish (or the final loss), whole dollars, `null` when the job is not heading for a loss. */
  readonly loss: string | null;
  readonly lossCents: number | null;
  /** Pace over the whole job: the Pace card. */
  readonly paceWholeJob: string | null;
  /** Pace over the last evidence days, from the pace reason, with how many days. */
  readonly paceRecent: { readonly text: string; readonly days: number | null } | null;
  /** Pace assumed for the rest of the job: the estimate slider. */
  readonly paceRestOfJob: string | null;
  /** Cost for one unit so far: the "Cost for one" card. */
  readonly costPerUnitSoFarCents: Cents | null;
  /** Cost for one unit by the finish: the losing money sentence. */
  readonly costPerUnitAtFinishCents: Cents | null;
}

/** Reads every shared figure of a job from its stats. Money fields come back `null` when money is hidden. */
export function jobHeadlineFigures(stats: Stats, plannedUnits: string | number | null): JobHeadlineFigures {
  const profit = stats.projectedProfitCents;
  const lossCents = profit !== null && profit < 0 ? -profit : null;
  const pace = reasonOf(stats.riskReasons, ['R4', 'W3']);
  const recentUph = pace ? num(pace.params.uph) : null;
  const losing = reasonOf(stats.riskReasons, ['L1']);
  const fromReason = losing ? num(losing.params.costPerUnitCents) : null;
  const units = Math.max(Number(plannedUnits ?? 0) || 0, Number(stats.unitsGood) || 0);
  const atFinish =
    fromReason !== null
      ? BigInt(Math.round(fromReason))
      : stats.costAtFinishCents !== null && units > 0 && stats.mode === 'projected'
        ? perUnitCents(toCents(stats.costAtFinishCents), String(units))
        : null;
  return {
    loss: lossCents === null ? null : headlineMoney(lossCents),
    lossCents,
    paceWholeJob: paceWords(stats.uph),
    paceRecent: recentUph === null ? null : { text: paceWords(recentUph) ?? '', days: num(pace?.params.days) },
    paceRestOfJob: paceWords(stats.paceUph),
    costPerUnitSoFarCents:
      stats.costCents !== null && Number(stats.unitsGood) > 0 ? perUnitCents(toCents(stats.costCents), stats.unitsGood) : null,
    costPerUnitAtFinishCents: atFinish,
  };
}

/** The pace a plan assumed: its units over its labor hours less setup. `null` without both. */
export function planPace(plan: PlanTotals | null): number | null {
  if (!plan || !planHasCosts(plan)) return null;
  const figures = planFigures(plan);
  const hours = figures.laborHours - figures.setupHours;
  if (!(figures.units > 0) || !(hours > 0)) return null;
  return Math.round((figures.units / hours) * 1000) / 1000;
}

export interface PaceYardsticks {
  /** "against the target pace of 44", for the Pace card. */
  readonly againstTarget: string | null;
  /** "against the 68 the quote assumed", for the Plan vs actual tab. */
  readonly againstPlan: string | null;
  /** One plain line when the two yardsticks give different answers, else `null`. */
  readonly conflict: string | null;
}

/**
 * Names the yardstick each screen uses for pace. The overview compares with the target pace, the
 * Plan tab with the pace the quote or budget assumed. When the crew beats one and not the other,
 * one line says so, so the two screens never seem to disagree.
 */
export function paceYardsticks(input: {
  readonly uph: number | string | null;
  readonly targetPace: number | string | null;
  readonly planPace: number | null;
  readonly planWord: 'quote' | 'budget';
}): PaceYardsticks {
  const target = paceWords(input.targetPace);
  const assumed = paceWords(input.planPace);
  const againstTarget = target ? `against the target pace of ${target}` : null;
  const againstPlan = assumed ? `against the ${assumed} the ${input.planWord} assumed` : null;
  const uph = input.uph === null || input.uph === '' ? null : Number(input.uph);
  let conflict: string | null = null;
  if (target && assumed && uph !== null && Number.isFinite(uph) && target !== assumed) {
    const beatsTarget = uph >= Number(input.targetPace);
    const beatsPlan = uph >= (input.planPace ?? 0);
    if (beatsTarget !== beatsPlan) {
      const lead = `The ${input.planWord} assumed ${assumed} an hour. Your target pace is ${target}.`;
      conflict = beatsTarget
        ? `${lead} The crew beats the target but not the ${input.planWord}.`
        : `${lead} The crew beats the ${input.planWord} but not the target.`;
    }
  }
  return { againstTarget, againstPlan, conflict };
}
