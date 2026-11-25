import { describe, expect, it } from 'vitest';
import { draftHints, draftStartText, draftStep, draftStepText } from './drafts-strip';

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

describe('draft chips tell look alike drafts apart', () => {
  it('names how the draft started', () => {
    expect(draftStartText({ start: { mode: 'deal', crmItemTitle: 'Gripwell renewal' } })).toBe('From the deal Gripwell renewal');
    expect(draftStartText({ start: { mode: 'copy', copyKey: 'GLOVE' } })).toBe('Copy of GLOVE');
    expect(draftStartText({ start: { mode: 'scratch' } })).toBe('From scratch');
    expect(draftStartText({ start: { mode: null } })).toBe('');
  });
  it('adds the key and a short id only when two chips still match', () => {
    const hints = draftHints([
      { id: 'aaaa-1111', title: 'Glove kitting two', payload: { start: { mode: 'scratch' }, basics: { key: 'glov2' } } },
      { id: 'bbbb-2222', title: 'Glove kitting two', payload: { start: { mode: 'scratch' }, basics: { key: 'glov2' } } },
      { id: 'cccc-3333', title: 'Glove kitting two', payload: { start: { mode: 'deal' }, basics: { key: 'glov2' } } },
    ]);
    expect(hints.get('aaaa-1111')).toEqual({ text: 'GLOV2, from scratch', shortId: '#1111' });
    expect(hints.get('bbbb-2222')).toEqual({ text: 'GLOV2, from scratch', shortId: '#2222' });
    expect(hints.get('cccc-3333')).toEqual({ text: 'GLOV2, from a deal', shortId: null });
  });
});
