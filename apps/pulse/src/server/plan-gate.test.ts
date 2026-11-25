/**
 * The plan gate (docs/billing/CONTRACTS.md section 18): not in the plan refuses everything, view
 * only lets reads through and refuses every change with the one plain sentence, full access
 * passes. The access level itself is decided in `@kitstak/entitlements` (tested there).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** An en dash, an em dash, or two hyphens in a row: none may appear in UI copy. */
const DASHES = new RegExp('[\\u2013\\u2014]|-{2}');

const access = vi.hoisted(() => ({ current: 'full' as 'full' | 'read_only' | 'locked' }));
vi.mock('@/server/entitlements', () => ({
  orgPulseAccess: vi.fn(async () => access.current),
}));

const { assertPlanAllows, isPlanSafeMethod, PLAN_LOCKED_MESSAGE, PLAN_READ_ONLY_MESSAGE } = await import('./plan-gate');
const { isDomainError } = await import('./errors');

const ORG = '11111111-1111-4111-8111-111111111111';

async function caught(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

describe('assertPlanAllows', () => {
  beforeEach(() => {
    access.current = 'full';
  });

  it('lets reads and writes through with full access', async () => {
    await expect(assertPlanAllows(ORG, { write: false })).resolves.toBeUndefined();
    await expect(assertPlanAllows(ORG, { write: true })).resolves.toBeUndefined();
  });

  it('lets reads through in view only and refuses every change with the plain sentence', async () => {
    access.current = 'read_only';
    await expect(assertPlanAllows(ORG, { write: false })).resolves.toBeUndefined();
    const error = await caught(() => assertPlanAllows(ORG, { write: true }));
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'plan.read_only',
      status: 402,
      message: 'Your plan is view only right now. Pick a plan in the Portal to make changes.',
    });
    expect(PLAN_READ_ONLY_MESSAGE).toBe('Your plan is view only right now. Pick a plan in the Portal to make changes.');
  });

  it('refuses reads and writes when the app is not in the plan', async () => {
    access.current = 'locked';
    for (const write of [false, true]) {
      const error = await caught(() => assertPlanAllows(ORG, { write }));
      expect(error).toMatchObject({ code: 'NOT_ENTITLED', status: 402, message: PLAN_LOCKED_MESSAGE });
    }
  });

  it('keeps its sentences short and free of dashes', () => {
    for (const text of [PLAN_READ_ONLY_MESSAGE, PLAN_LOCKED_MESSAGE]) {
      expect(text).not.toMatch(DASHES);
      for (const sentence of text.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
    }
  });
});

describe('isPlanSafeMethod', () => {
  it('treats GET, HEAD and OPTIONS as reads and everything else as a write', () => {
    for (const method of ['GET', 'get', 'HEAD', 'OPTIONS']) expect(isPlanSafeMethod(method)).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) expect(isPlanSafeMethod(method)).toBe(false);
  });
});
