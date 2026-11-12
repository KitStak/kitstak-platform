/** M14 round 5: user save failure messaging (drawer never stays stuck busy). */
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { describeSaveError, needsRetryPanel, SAVE_TIMEOUT_MS } from '@/components/admin/users/save-error';

describe('user save failures', () => {
  it('explains timeouts, network and server errors in plain words', () => {
    expect(describeSaveError(new Error('aborted'), true)).toMatch(/didn't respond/);
    expect(describeSaveError(new ApiError({ code: 'NETWORK', message: 'x', status: 0 }), false)).toMatch(
      /reach the server/,
    );
    expect(
      describeSaveError(new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 }), false),
    ).toMatch(/server hit an error/);
    expect(
      describeSaveError(new ApiError({ code: 'FORBIDDEN', message: 'No access', status: 403 }), false),
    ).toBe('No access');
    expect(describeSaveError(new TypeError('Failed to fetch'), false)).toMatch(/reach the server/);
  });
  it('routes field errors to the form and everything else to Retry', () => {
    expect(
      needsRetryPanel(
        new ApiError({ code: 'VALIDATION', message: 'x', status: 422, fieldErrors: { email: ['Taken'] } }),
      ),
    ).toBe(false);
    expect(needsRetryPanel(new ApiError({ code: 'CONFLICT', message: 'x', status: 409 }))).toBe(false);
    expect(needsRetryPanel(new ApiError({ code: 'INTERNAL', message: 'x', status: 500 }))).toBe(true);
    expect(needsRetryPanel(new Error('x'))).toBe(true);
    expect(SAVE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
