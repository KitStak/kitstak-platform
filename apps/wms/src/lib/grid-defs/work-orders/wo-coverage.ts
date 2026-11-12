/**
 * Work order component coverage (M08, pure). One lock-aware reading of "can this work order build",
 * shared by the detail KPIs, the Components tab status column, the Shortage retry callout and the
 * Create Kit gates on the detail header and list toolbar. Inputs come from the detail API:
 * `availableQty` is what the work order can draw on (its chosen source, 0 while a count plan locks
 * it, else usable FEFO stock); `lockedQty` / `lockedBy` describe free stock held by count locks.
 */

export interface CoverageComponent {
  readonly sku: string;
  readonly componentQty: number;
  readonly totalQty: number;
  readonly allocatedQty: number;
  readonly consumedQty: number;
  readonly freeQty: number;
  readonly availableQty?: number;
  readonly shortQty: number;
  readonly lockedQty?: number;
  readonly lockedBy?: readonly string[];
  readonly locationId?: string | null;
  readonly locationCode?: string | null;
  readonly sourceLockedBy?: string | null;
}

export type CoverageState = 'consumed' | 'covered' | 'locked' | 'short';

export interface Coverage {
  readonly state: CoverageState;
  /** Units still missing for the open need (0 when covered). */
  readonly shortQty: number;
  /** Count plans that hold the missing stock (state "locked"). */
  readonly lockedBy: readonly string[];
}

const available = (c: CoverageComponent): number => c.availableQty ?? c.freeQty;

/** Count plans blocking this component: its chosen source's plan, else the plans locking its free stock. */
export function lockPlans(c: CoverageComponent): readonly string[] {
  if (c.locationId) return c.sourceLockedBy ? [c.sourceLockedBy] : [];
  return (c.lockedQty ?? 0) > 0 ? (c.lockedBy ?? []) : [];
}

export function componentCoverage(c: CoverageComponent): Coverage {
  if (c.totalQty - c.consumedQty <= 0) return { state: 'consumed', shortQty: 0, lockedBy: [] };
  if (c.shortQty <= 0) return { state: 'covered', shortQty: 0, lockedBy: [] };
  const plans = lockPlans(c);
  return { state: plans.length ? 'locked' : 'short', shortQty: c.shortQty, lockedBy: plans };
}

/** Kits the current stock can still build (allocated stock counts with picking). */
export function buildableKits(components: readonly CoverageComponent[], withPicking: boolean): number {
  if (components.length === 0) return 0;
  return Math.max(
    0,
    Math.min(
      ...components.map((c) =>
        c.componentQty > 0
          ? Math.floor((available(c) + (withPicking ? c.allocatedQty : 0)) / c.componentQty)
          : 0,
      ),
    ),
  );
}

export interface CoverageSummary {
  readonly short: readonly CoverageComponent[];
  readonly locked: readonly CoverageComponent[];
  readonly plans: readonly string[];
  readonly buildable: number;
}

export function coverageSummary(
  components: readonly CoverageComponent[],
  withPicking: boolean,
): CoverageSummary {
  const cov = components.map((c) => ({ c, v: componentCoverage(c) }));
  const short = cov.filter((x) => x.v.state === 'short' || x.v.state === 'locked').map((x) => x.c);
  const locked = cov.filter((x) => x.v.state === 'locked').map((x) => x.c);
  const plans = [...new Set(cov.flatMap((x) => x.v.lockedBy))].sort();
  return { short, locked, plans, buildable: buildableKits(components, withPicking) };
}

const list = (items: readonly string[], max = 3): string =>
  `${items.slice(0, max).join(', ')}${items.length > max ? ` +${items.length - max} more` : ''}`;

/**
 * Why Create Kit can't build even one kit on a work order without picking (stock gate), or null.
 * With picking the build draws on picked stock in the kitting area, so this gate doesn't apply.
 */
export function createKitStockReason(
  wo: {
    readonly type: string;
    readonly requestedQty: number;
    readonly processedQty: number;
    readonly status: string;
  },
  components: readonly CoverageComponent[],
): string | null {
  if (wo.type === 'Work Order with Picking') return null;
  if (wo.status === 'Completed' || wo.status === 'Cancelled') return null;
  if (wo.requestedQty - wo.processedQty <= 0 || components.length === 0) return null;
  const blocking = components.filter(
    (c) => c.componentQty > 0 && c.totalQty - c.consumedQty > 0 && available(c) < c.componentQty,
  );
  if (blocking.length === 0) return null;
  const locked = blocking.filter((c) => lockPlans(c).length > 0);
  if (locked.length === blocking.length) {
    const plans = [...new Set(locked.flatMap((c) => lockPlans(c)))].sort();
    return `Component stock is locked by count plan ${plans.join(', ')} (${list(locked.map((c) => c.sku))}). Finish, update or cancel the count first`;
  }
  return `Not enough stock to build one kit: ${list(blocking.map((c) => `${c.sku} needs ${c.componentQty}, ${available(c)} usable`))}`;
}

/** Retry allocation helps only when usable stock covers every short component. */
export function retryAllocationReason(summary: CoverageSummary): string | null {
  if (summary.short.length === 0) return null;
  if (summary.locked.length)
    return `Stock for ${list(summary.locked.map((c) => c.sku))} is locked by count plan ${summary.plans.join(', ')}; allocation would fail until the count is finished or cancelled`;
  return `Usable stock doesn't cover ${list(summary.short.map((c) => c.sku))} yet; receive or move stock first`;
}

/**
 * List-row flag: a Shortage work order whose usable stock (plus what it already holds) now builds
 * every remaining kit, so a planner can retry allocation without opening each row. Logiwa keeps the
 * status until re-allocation; KitStaks does too, and only flags it.
 */
export function shortageRecoverable(row: {
  readonly status: string;
  readonly buildableQty: number | null;
  readonly remainingQty: number;
}): boolean {
  return (
    row.status === 'Shortage' &&
    row.buildableQty !== null &&
    row.remainingQty > 0 &&
    row.buildableQty >= row.remainingQty
  );
}

export const SHORTAGE_RECOVERABLE_COPY =
  'Stock now available: usable stock covers every component. Retry allocation from the work order.';

/** Terminal-state copy for the "Left to build" KPI (Completed / Cancelled). */
export function terminalBuildCopy(
  wo: { readonly status: string; readonly processedQty: number; readonly requestedQty: number },
  when: string | null,
): string | null {
  if (wo.status === 'Completed')
    return `Completed${when ? ` ${when}` : ''} · ${wo.processedQty} of ${wo.requestedQty} built`;
  if (wo.status === 'Cancelled')
    return `Cancelled${when ? ` ${when}` : ''} · ${wo.processedQty} of ${wo.requestedQty} built`;
  return null;
}

/** Source column text: FEFO is only "allocated" once something was actually reserved. */
export function sourceLabel(
  c: {
    readonly locationCode: string | null;
    readonly lpNumber: string | null;
    readonly lotNumber: string | null;
    readonly allocatedQty: number;
    readonly consumedQty: number;
  },
  withPicking: boolean,
): string {
  const chosen = [
    c.locationCode,
    c.lpNumber ? `LP ${c.lpNumber}` : null,
    c.lotNumber ? `lot ${c.lotNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (chosen) return chosen;
  if (!withPicking) return 'FEFO at build';
  return c.allocatedQty > 0 || c.consumedQty > 0 ? 'Allocated FEFO' : 'FEFO at allocation';
}
