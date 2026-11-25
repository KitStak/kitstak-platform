import { describe, expect, it } from 'vitest';
import { describeActivity } from './activity-text';
import type { ActivityDTO } from './types';

const row = (verb: string, extra: Partial<ActivityDTO> = {}): ActivityDTO => ({
  id: 'a1',
  projectId: 'p1',
  taskId: null,
  actorId: 'u1',
  actorKind: 'user',
  verb,
  entityType: 'task',
  entityId: 'b1',
  field: null,
  before: null,
  after: null,
  meta: {},
  createdAt: '2026-11-25T15:00:00.000Z',
  ...extra,
});

const lookups = { variantName: (id: string) => ({ v1: 'Small Brown', v2: 'XL Brown' })[id], unit: { singular: 'kit', plural: 'kits' } };

describe('program activity sentences (SPEC 4.10)', () => {
  it('logs output with and without money', () => {
    expect(describeActivity(row('build.output_logged', { after: { qty: '100.000', date: '2026-11-25', variant: 'v1', money: { revenueCents: '19500' } } }), lookups)).toBe('logged 100 kits on Small Brown for Nov 25 ($195.00)');
    expect(describeActivity(row('build.output_logged', { after: { qty: '1.000', date: '2026-11-25', variant: 'v1' } }), lookups)).toBe('logged 1 kit on Small Brown for Nov 25');
  });

  it('names a variant rate change, with a units only form', () => {
    expect(describeActivity(row('price_card.variant_rate_changed', { after: { variants: 1, money: { rates: [{ variantId: 'v2', unitPrice: '2.2000' }] } } }), lookups)).toBe('changed the XL Brown rate to $2.20');
    expect(describeActivity(row('price_card.variant_rate_changed', { after: { variants: 2 } }), lookups)).toBe('changed 2 variant rates');
  });

  it('describes closes, schedules, publishing and the program life cycle', () => {
    expect(describeActivity(row('program.month_closed', { after: { month: '2026-10', money: { totalCents: '1530000' } } }))).toBe('closed October at $15,300.00');
    expect(describeActivity(row('program.month_closed', { after: { month: '2026-10' } }))).toBe('closed October');
    expect(describeActivity(row('schedule.generated', { after: { count: 8, name: 'Weekday glove run' } }))).toBe('planned 8 builds from Weekday glove run');
    expect(describeActivity(row('price_card.version_published', { after: { number: 2, effectiveFrom: '2026-12-01' } }))).toBe('published price card v2 starting Dec 1');
    expect(describeActivity(row('program.status_changed', { after: { status: 'on_hold' } }))).toBe('paused this program');
    expect(describeActivity(row('build.split', { after: { qty: '20.000', toDate: '2026-11-27' } }), lookups)).toBe('moved 20 kits to Nov 27');
    expect(describeActivity(row('one_time.added', { after: { kind: 'setup', label: 'Setup fee', money: { amountCents: '25000' } } }))).toBe('added Setup fee of $250.00');
    expect(describeActivity(row('build.rate_override_set', { after: { money: { rateOverride: '2.0500' } } }))).toBe('set the build rate to $2.05');
  });

  it('never uses dashes or the program words people should not see', () => {
    const verbs = ['program.created', 'program.copied', 'variant.created', 'build.repriced', 'run.closed', 'calendar.updated', 'program.pulse_job_linked'];
    for (const verb of verbs) {
      const text = describeActivity(row(verb, { after: { rows: 3 } }));
      expect(text).not.toMatch(/[–—]|--|\breprice|\bprorat|\bpace\b|\busage\b/i);
    }
  });
});
