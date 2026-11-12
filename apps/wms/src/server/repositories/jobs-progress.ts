/**
 * Per-phase job progress (Logiwa: PENDING PICKING TASKS / PENDING PACKING TASKS). PURE so the
 * job detail header can say "Picking 2/2 · Packing 0/2" instead of mixing picked units with
 * packing tasks (critic R1). Cancelled tasks are excluded from totals.
 */
export interface PhaseTaskInput {
  readonly taskType: string;
  readonly status: string;
  readonly plannedQty: number;
  readonly actualQty: number;
}

export interface PhaseProgress {
  readonly phase: string;
  readonly taskCount: number;
  readonly completedTasks: number;
  readonly pendingTasks: number;
  readonly startedTasks: number;
  readonly plannedUnits: number;
  readonly actualUnits: number;
}

const ORDER = ['Picking', 'Packing', 'Loading', 'Replenishment', 'Putaway', 'Count', 'Kitting'];

export function phaseProgress(tasks: readonly PhaseTaskInput[]): PhaseProgress[] {
  const map = new Map<
    string,
    {
      taskCount: number;
      completedTasks: number;
      pendingTasks: number;
      startedTasks: number;
      plannedUnits: number;
      actualUnits: number;
    }
  >();
  for (const t of tasks) {
    if (t.status === 'Cancelled') continue;
    const p = map.get(t.taskType) ?? {
      taskCount: 0,
      completedTasks: 0,
      pendingTasks: 0,
      startedTasks: 0,
      plannedUnits: 0,
      actualUnits: 0,
    };
    p.taskCount += 1;
    if (t.status === 'Completed') p.completedTasks += 1;
    else if (t.status === 'Started') p.startedTasks += 1;
    else p.pendingTasks += 1;
    p.plannedUnits += Number(t.plannedQty) || 0;
    p.actualUnits += Number(t.actualQty) || 0;
    map.set(t.taskType, p);
  }
  const rank = (k: string) => {
    const i = ORDER.indexOf(k);
    return i < 0 ? ORDER.length : i;
  };
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([phase, v]) => ({ phase, ...v }));
}
