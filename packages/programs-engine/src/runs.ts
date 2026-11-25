/**
 * Runs (docs/programs/SPEC.md 3.10, A14). A run is computed, never stored: the builds of one
 * container on one build date made by one schedule share the run id `run:<scheduleId>:<date>`;
 * builds made by hand share `run:manual:<date>` and show as "Unscheduled". Pure functions.
 */
import { isRealDate } from './calendar';
import { ZERO, fromScaled, quantityToScaled } from './money';
import type { IsoDate } from './types';

export type StatusCategory = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type RunState = 'planned' | 'in_progress' | 'done' | 'short' | 'cancelled';

export interface RunBuild {
  readonly buildId: string;
  readonly containerId: string;
  readonly buildDate: IsoDate;
  readonly scheduleId: string | null;
  readonly scheduleName: string | null;
  readonly statusCategory: StatusCategory;
  readonly plannedQty: string;
  readonly builtQty: string;
  readonly closedShort: boolean;
}

export interface Run {
  readonly id: string;
  readonly containerId: string;
  readonly date: IsoDate;
  readonly scheduleId: string | null;
  readonly name: string;
  readonly builds: number;
  readonly done: number;
  readonly cancelled: number;
  /** Planned units of the builds that are not cancelled. */
  readonly plannedUnits: string;
  /** Built units of every build (a cancelled build keeps what it made). */
  readonly builtUnits: string;
  readonly state: RunState;
  readonly buildIds: readonly string[];
}

/** The name of the run of builds made by hand. */
export const UNSCHEDULED_RUN_NAME = 'Unscheduled';

/** `'run:<scheduleId>:<date>'` or `'run:manual:<date>'`. */
export function runId(input: { readonly scheduleId: string | null; readonly date: IsoDate }): string {
  return `run:${input.scheduleId ?? 'manual'}:${input.date}`;
}

/** Reads a run id back. Null when it is not one. */
export function parseRunId(id: string): { scheduleId: string | null; date: IsoDate } | null {
  const match = /^run:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match || !isRealDate(match[2])) return null;
  return { scheduleId: match[1] === 'manual' ? null : (match[1] as string), date: match[2] as IsoDate };
}

/** The state of a run from its builds (3.10). */
export function runState(builds: readonly Pick<RunBuild, 'statusCategory' | 'plannedQty' | 'builtQty' | 'closedShort'>[]): RunState {
  if (builds.length === 0) return 'planned';
  const live = builds.filter((build) => build.statusCategory !== 'cancelled');
  if (live.length === 0) return 'cancelled';
  let planned = ZERO;
  let built = ZERO;
  // Planned and built come from the same live builds, so output of a cancelled build never
  // hides a short live build (the Run's `builtUnits` still totals every build).
  for (const build of live) {
    planned += quantityToScaled(build.plannedQty);
    built += quantityToScaled(build.builtQty);
  }
  if (live.every((build) => build.statusCategory === 'done')) {
    return live.some((build) => build.closedShort) || built < planned ? 'short' : 'done';
  }
  const started = builds.some((build) => quantityToScaled(build.builtQty) > ZERO || build.statusCategory === 'in_progress' || build.statusCategory === 'done');
  return started ? 'in_progress' : 'planned';
}

/** The words for a run state (UI copy). */
export const RUN_STATE_LABELS: Readonly<Record<RunState, string>> = {
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  short: 'Closed short',
  cancelled: 'Cancelled',
};

/** Groups builds into runs, sorted by date, then schedule name, with "Unscheduled" last on each date. */
export function groupRuns(builds: readonly RunBuild[]): Run[] {
  const groups = new Map<string, RunBuild[]>();
  for (const build of builds) {
    const key = `${build.containerId}|${runId({ scheduleId: build.scheduleId, date: build.buildDate })}`;
    const list = groups.get(key);
    if (list) list.push(build);
    else groups.set(key, [build]);
  }
  const runs: Run[] = [...groups.values()].map((list) => {
    const first = list[0] as RunBuild;
    const named = list.find((build) => build.scheduleName !== null && build.scheduleName.trim() !== '');
    let planned = ZERO;
    let built = ZERO;
    for (const build of list) {
      if (build.statusCategory !== 'cancelled') planned += quantityToScaled(build.plannedQty);
      built += quantityToScaled(build.builtQty);
    }
    return {
      id: runId({ scheduleId: first.scheduleId, date: first.buildDate }),
      containerId: first.containerId,
      date: first.buildDate,
      scheduleId: first.scheduleId,
      name: first.scheduleId === null ? UNSCHEDULED_RUN_NAME : (named?.scheduleName?.trim() ?? 'Scheduled run'),
      builds: list.length,
      done: list.filter((build) => build.statusCategory === 'done').length,
      cancelled: list.filter((build) => build.statusCategory === 'cancelled').length,
      plannedUnits: fromScaled(planned, 3),
      builtUnits: fromScaled(built, 3),
      state: runState(list),
      buildIds: list.map((build) => build.buildId),
    };
  });
  return runs.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const aManual = a.scheduleId === null;
    const bManual = b.scheduleId === null;
    if (aManual !== bManual) return aManual ? 1 : -1;
    const byName = a.name.localeCompare(b.name, 'en-US');
    if (byName !== 0) return byName;
    return a.containerId < b.containerId ? -1 : a.containerId > b.containerId ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
