/**
 * Planned job window (critic R3, round 3 parity loop). PURE.
 *
 * One SLA rule for every job and its tasks, matching Logiwa iO:
 *   - job planned start = created + 1 h, planned end = created + 2 h;
 *   - every task of the job is planned inside the job window (start = job start, finish = job end),
 *     so a task can never be planned to start after, or finish after, its job.
 * The values are written once when the job is created and never recomputed at read time, so they
 * are stable across reloads.
 */
export const SLA_START_OFFSET_MINUTES = 60;
export const SLA_END_OFFSET_MINUTES = 120;

export interface PlannedWindow {
  readonly plannedStartAt: string;
  readonly plannedEndAt: string;
}

export function slaWindow(createdIso: string): PlannedWindow {
  const created = Date.parse(createdIso);
  if (Number.isNaN(created)) throw new Error(`Invalid created time: ${createdIso}`);
  return {
    plannedStartAt: new Date(created + SLA_START_OFFSET_MINUTES * 60_000).toISOString(),
    plannedEndAt: new Date(created + SLA_END_OFFSET_MINUTES * 60_000).toISOString(),
  };
}

/** Task planned start/finish derived from the job's window. */
export function taskWindow(job: PlannedWindow): {
  readonly plannedStartAt: string;
  readonly plannedFinishAt: string;
} {
  return { plannedStartAt: job.plannedStartAt, plannedFinishAt: job.plannedEndAt };
}
