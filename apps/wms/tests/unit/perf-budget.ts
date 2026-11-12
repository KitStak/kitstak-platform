/**
 * PERF_BUDGET_SCALE scales the hard time budgets in the perf tests
 * (tests/unit/catalog/perf-6k.test.ts, tests/unit/inventory/inventory-scale.test.ts)
 * so they can run meaningfully on slower or loaded machines, e.g.
 * `PERF_BUDGET_SCALE=2 pnpm vitest run tests/unit/catalog/perf-6k.test.ts` doubles
 * every budget. It defaults to 1: the committed budgets are the real performance
 * targets and must never be weakened — the multiplier only adapts the assertion to
 * the machine running it, and any non-numeric or non-positive value falls back to 1.
 */
const parsed = Number.parseFloat(process.env.PERF_BUDGET_SCALE ?? '1');

export const PERF_BUDGET_SCALE: number = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

/** A time budget in milliseconds, scaled by PERF_BUDGET_SCALE (default 1). */
export const scaledBudgetMs = (budgetMs: number): number => budgetMs * PERF_BUDGET_SCALE;
