import { describe, expect, it } from 'vitest';
import type { AlertDTO } from '@/lib/types';
import { applyChange, bucketOf, changeMessage, inTab, inverseChange, linkLabel, matchesSearch, snoozeChoices } from './alert-model';

const base: AlertDTO = {
  id: 'a1',
  ruleId: null,
  kind: 'job_losing',
  severity: 'critical',
  entityType: 'job',
  entityId: 'j1',
  entityLabel: 'J-1001 Holiday kits',
  title: 'J-1001 Holiday kits is losing money',
  body: 'Cost is over revenue.',
  nextStep: 'Raise the price',
  impactCents: -120000,
  url: '/jobs/J-1001',
  status: 'open',
  snoozedUntil: null,
  assignedTo: null,
  resolvedAt: null,
  resolution: null,
  firstSeenAt: '2026-11-10T10:00:00.000Z',
  lastSeenAt: '2026-11-17T10:00:00.000Z',
  pmTaskId: null,
  moneyHidden: false,
};
const NOW = '2026-11-18T12:00:00.000Z';

describe('alert changes', () => {
  it('moves an alert between lists', () => {
    expect(bucketOf(applyChange(base, { action: 'snooze', until: '2026-11-20' }, NOW))).toBe('snoozed');
    expect(bucketOf(applyChange(base, { action: 'resolve' }, NOW))).toBe('done');
    expect(bucketOf(applyChange(base, { action: 'dismiss' }, NOW))).toBe('done');
    expect(bucketOf(applyChange({ ...base, status: 'resolved' }, { action: 'reopen' }, NOW))).toBe('open');
  });
  it('undoes every change', () => {
    const changes = [{ action: 'snooze', until: '2026-11-20' }, { action: 'resolve' }, { action: 'dismiss' }, { action: 'assign', userId: 'u2' }] as const;
    for (const change of changes) {
      const after = applyChange(base, change, NOW);
      const back = applyChange(after, inverseChange(base, change), NOW);
      expect(back.status).toBe(base.status);
      expect(back.assignedTo).toBe(base.assignedTo);
      expect(back.snoozedUntil).toBe(base.snoozedUntil);
    }
    const snoozed = { ...base, status: 'snoozed' as const, snoozedUntil: '2026-11-25' };
    expect(inverseChange(snoozed, { action: 'unsnooze' })).toEqual({ action: 'snooze', until: '2026-11-25' });
    expect(inverseChange({ ...base, status: 'dismissed' }, { action: 'reopen' })).toEqual({ action: 'dismiss' });
  });
  it('knows the assigned to me tab', () => {
    expect(inTab({ ...base, assignedTo: 'me' }, 'mine', 'me')).toBe(true);
    expect(inTab({ ...base, assignedTo: 'me', status: 'snoozed' }, 'mine', 'me')).toBe(false);
    expect(inTab(base, 'open', 'me')).toBe(true);
  });
});

describe('words', () => {
  it('says what happened', () => {
    expect(changeMessage({ action: 'resolve' }, 1)).toBe('Alert marked done');
    expect(changeMessage({ action: 'snooze', until: '2026-11-20' }, 3)).toBe('3 alerts snoozed');
    expect(changeMessage({ action: 'assign', userId: 'u' }, 1, 'Dana')).toBe('Alert handed to Dana');
  });
  it('labels links by where they go', () => {
    expect(linkLabel(base)).toBe('Open the job');
    expect(linkLabel({ entityType: 'period', url: '/settings/close' })).toBe('Open month close');
    expect(linkLabel({ entityType: 'period', url: null })).toBe('Open it');
  });
  it('searches title, body and next step', () => {
    expect(matchesSearch(base, 'holiday losing')).toBe(true);
    expect(matchesSearch(base, 'raise price')).toBe(true);
    expect(matchesSearch(base, 'freight')).toBe(false);
  });
});

describe('snoozeChoices', () => {
  it('counts from today', () => {
    // 2026-11-18 is a Wednesday.
    const choices = snoozeChoices('2026-11-18');
    expect(choices.map((choice) => choice.until)).toEqual(['2026-11-19', '2026-11-21', '2026-11-23', '2026-12-02']);
  });
  it('next Monday from a Monday is a week later', () => {
    expect(snoozeChoices('2026-11-16')[2]?.until).toBe('2026-11-23');
  });
});
