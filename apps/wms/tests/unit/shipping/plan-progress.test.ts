import { describe, expect, it } from 'vitest';
import {
  localizeIsoInText,
  planProgressNote,
  shippedTileNote,
  statusChoices,
} from '@/components/shipment-plans/plan-form-model';

describe('localizeIsoInText', () => {
  it('formats ISO date-times inside a change-log message', () => {
    expect(
      localizeIsoInText(
        'Loading Started At is modified. — --> 2026-11-10T04:50:27.680Z',
        () => '11/09/2026 11:50 PM',
      ),
    ).toBe('Loading Started At is modified. — --> 11/09/2026 11:50 PM');
  });
  it('leaves plain text alone', () =>
    expect(localizeIsoInText('Status is modified. Open --> In Progress', () => 'x')).toBe(
      'Status is modified. Open --> In Progress',
    ));
});

describe('planProgressNote', () => {
  it('flags a partially shipped plan', () =>
    expect(planProgressNote('Loading Started', 2, 1)).toBe('Partially shipped · 1 of 2'));
  it('is silent before anything ships', () => expect(planProgressNote('Open', 2, 0)).toBeNull());
  it('is silent once the plan is Shipped', () => expect(planProgressNote('Shipped', 2, 2)).toBeNull());
});

describe('shippedTileNote', () => {
  it('matches a partial count', () =>
    expect(shippedTileNote(1, 2, null)).toBe('1 order shipped, 1 remaining'));
  it('says not shipped yet at zero', () => expect(shippedTileNote(0, 2, null)).toBe('Not shipped yet'));
  it('dates a full ship', () =>
    expect(shippedTileNote(2, 2, '11/09/2026')).toBe('All shipped on 11/09/2026'));
});

describe('statusChoices', () => {
  it('locks a new plan to Open', () => expect(statusChoices('create', 'Open', [])).toEqual(['Open']));
});
