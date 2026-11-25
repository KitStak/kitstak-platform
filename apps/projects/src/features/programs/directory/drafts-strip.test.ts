import { describe, expect, it } from 'vitest';
import { draftStep, draftStepText } from './drafts-strip';

describe('draft chips count steps like the stepper', () => {
  it('counts six steps while Start shows', () => {
    expect(draftStepText(0)).toBe('Step 1 of 6');
    expect(draftStepText(2)).toBe('Step 3 of 6');
  });
  it('counts five steps once a start mode was picked', () => {
    expect(draftStep({ step: 2, payload: { start: { mode: 'scratch' } } })).toBe('Step 2 of 5');
    expect(draftStep({ step: 0, payload: { start: { mode: 'scratch' } } })).toBe('Step 1 of 6');
    expect(draftStep({ step: 3, payload: { start: { mode: null } } })).toBe('Step 4 of 6');
  });
});
