/**
 * Wall display rules, pure: the day's goal for a job and the green, amber or red call a person
 * can read from across the floor. No money anywhere in here.
 */
import { divRound, toScaled } from '@/lib/money';

export type WallStatus = 'green' | 'amber' | 'red' | 'none';

export const WALL_STATUS_WORDS: Readonly<Record<WallStatus, string>> = { green: 'On pace', amber: 'A bit slow', red: 'Behind', none: 'Waiting' };

export interface DailyGoalInput {
  /** People on the usual crew. */
  readonly crew: number;
  readonly shiftHours: number;
  /** Target pace: units one person finishes in an hour. */
  readonly targetUph: number | null;
  readonly unitsLeft: number | null;
  /** Work days left to the due date, the board day included. */
  readonly workDaysLeft: number | null;
}

export interface DailyGoal {
  readonly units: number;
  /** `crew`: crew times shift times target pace. `due`: units left spread over the work days left. */
  readonly basis: 'crew' | 'due';
}

/**
 * Today's goal for a job: usual crew x shift hours x target pace when both are known, else the
 * units left divided by the work days left to the due date, else none. Rounded up to a whole unit.
 */
export function dailyGoal(input: DailyGoalInput): DailyGoal | null {
  if (input.crew > 0 && input.shiftHours > 0 && input.targetUph !== null && input.targetUph > 0) {
    const scaled = toScaled(String(input.crew), 2) * toScaled(String(input.shiftHours), 2) * toScaled(String(input.targetUph), 3);
    const units = Number(divRound(scaled, BigInt(10_000_000)));
    return units > 0 ? { units, basis: 'crew' } : null;
  }
  if (input.unitsLeft !== null && input.unitsLeft > 0 && input.workDaysLeft !== null && input.workDaysLeft > 0) {
    return { units: Math.ceil(input.unitsLeft / input.workDaysLeft), basis: 'due' };
  }
  return null;
}

export interface WallCallInput {
  readonly units: number;
  /** Labor hours that count for pace (setup taken out). */
  readonly paceHours: number;
  readonly targetUph: number | null;
  readonly goalUnits: number | null;
  /** True when the board shows a day that is over, so units can be judged against the whole goal. */
  readonly dayIsOver: boolean;
  /** At or over this share of the target the call is green (basis points, default 9500). */
  readonly watchBp?: number;
  /** Under this share of the target the call is red (basis points, default 8000). */
  readonly riskBp?: number;
}

export interface WallCall {
  readonly status: WallStatus;
  /** Units per person per hour for the day, to one decimal. Null with no hours. */
  readonly uph: number | null;
  /** Pace as a share of the target pace, or units as a share of the goal when the pace cannot be read. */
  readonly scoreBp: number | null;
  readonly reason: 'pace' | 'goal' | 'no_hours' | 'nothing_logged' | 'no_target';
}

/** The call for one job. Pace decides when hours are in; a finished day with units and no hours falls back to the goal. */
export function wallCall(input: WallCallInput): WallCall {
  const watch = input.watchBp ?? 9500;
  const risk = input.riskBp ?? 8000;
  const grade = (scoreBp: number): WallStatus => (scoreBp >= watch ? 'green' : scoreBp >= risk ? 'amber' : 'red');
  const uph = input.paceHours > 0 ? Math.round((input.units / input.paceHours) * 10) / 10 : null;
  if (input.units <= 0 && input.paceHours <= 0) return { status: 'none', uph: null, scoreBp: null, reason: 'nothing_logged' };
  if (uph !== null && input.targetUph !== null && input.targetUph > 0) {
    const scoreBp = Math.round((input.units / input.paceHours / input.targetUph) * 10000);
    return { status: grade(scoreBp), uph, scoreBp, reason: 'pace' };
  }
  if (input.goalUnits !== null && input.goalUnits > 0 && (input.dayIsOver || input.units >= input.goalUnits)) {
    const scoreBp = Math.round((input.units / input.goalUnits) * 10000);
    return { status: grade(scoreBp), uph, scoreBp, reason: 'goal' };
  }
  return { status: 'none', uph, scoreBp: null, reason: uph === null ? 'no_hours' : 'no_target' };
}

export const WALL_PANELS = ['jobs', 'pace', 'totals', 'due', 'nice'] as const;
export type WallPanel = (typeof WALL_PANELS)[number];
export const WALL_PANEL_LABELS: Readonly<Record<WallPanel, string>> = { jobs: 'Units against the goal', pace: 'Pace against the target', totals: "The day's totals", due: 'Due this week', nice: 'Nice work' };

/** Reads `?panels=jobs,pace` (or a stored list). Unknown names are dropped; nothing valid means every panel. */
export function readPanels(value: unknown): WallPanel[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const picked = WALL_PANELS.filter((panel) => list.map((item) => String(item).trim()).includes(panel));
  return picked.length > 0 ? picked : [...WALL_PANELS];
}

/** Seconds a panel stays up: 5 to 120, default 15. */
export function readRotate(value: unknown): number {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) && seconds >= 5 && seconds <= 120 ? seconds : 15;
}
