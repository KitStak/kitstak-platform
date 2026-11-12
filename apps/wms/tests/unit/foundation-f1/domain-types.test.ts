import { describe, expect, it } from 'vitest';
import {
  carrierSettingsSchema,
  channelSettingsSchema,
  clientSettingsSchema,
  filterConditionSchema,
  jobTypeSettingsSchema,
  parseSettings,
  ruleConditionSchema,
  userPreferencesSchema,
} from '@/lib/domain-types';
import { COUNT_LINE_STATUSES, COUNT_PLAN_STATUSES, isOneOf, SO_STATUSES, TXN_TYPES } from '@/lib/enums';

function countSwitches(value: unknown): number {
  if (typeof value === 'boolean') return 1;
  if (value && typeof value === 'object') {
    return Object.values(value).reduce<number>((n, v) => n + countSwitches(v), 0);
  }
  return 0;
}

describe('enums', () => {
  it('keeps the Logiwa-parity value counts', () => {
    expect(SO_STATUSES).toHaveLength(16);
    expect(TXN_TYPES).toHaveLength(18);
    expect(COUNT_LINE_STATUSES).toEqual([...COUNT_PLAN_STATUSES, 'Recount Created']);
  });

  it('isOneOf narrows only members', () => {
    expect(isOneOf(SO_STATUSES, 'Shipped')).toBe(true);
    expect(isOneOf(SO_STATUSES, 'shipped')).toBe(false);
    expect(isOneOf(SO_STATUSES, 3)).toBe(false);
  });
});

describe('settings schemas', () => {
  it('fills every client switch (28) from an empty stored object', () => {
    const settings = parseSettings(clientSettingsSchema, {});
    expect(countSwitches(settings)).toBe(28);
    expect(settings.packing.enablePackAll).toBe(false);
  });

  it('keeps stored client switches and treats null as empty', () => {
    expect(
      parseSettings(clientSettingsSchema, { packing: { enablePackAll: true } }).packing.enablePackAll,
    ).toBe(true);
    expect(parseSettings(clientSettingsSchema, null).advanced.keepPoNumberOnInventory).toBe(false);
  });

  it('rejects wrongly typed switches', () => {
    expect(() => parseSettings(clientSettingsSchema, { packing: { enablePackAll: 'yes' } })).toThrow();
  });

  it('defaults job type, channel and carrier settings', () => {
    const job = parseSettings(jobTypeSettingsSchema, {});
    expect(job.picking.overrideForLastJob).toBe(true);
    expect(job.batch).toEqual({ method: 'Nof Order', min: 1, max: 50 });
    expect(job.replenishment.algorithmMethod).toBe('FEFO');

    const channel = parseSettings(channelSettingsSchema, { paymentStatuses: ['Paid'] });
    expect(channel.paymentStatuses).toEqual(['Paid']);
    expect(channel.inventory.method).toBe('Available');

    const carrier = parseSettings(carrierSettingsSchema, {});
    expect(carrier.label.format).toBe('PDF');
    expect(carrier.generalMarkup).toBeNull();
    expect(() =>
      parseSettings(carrierSettingsSchema, { label: { messages: ['a', 'b', 'c', 'd'] } }),
    ).toThrow();
  });

  it('defaults user preferences to Logiwa display formats', () => {
    expect(parseSettings(userPreferencesSchema, {})).toMatchObject({
      dateFormat: 'M/D/YYYY h:mm:ss A',
      density: 'Large',
    });
  });
});

describe('condition schemas', () => {
  it('accepts grid-grammar filter conditions and rejects unknown ops', () => {
    expect(
      filterConditionSchema.parse({ field: 'status', op: 'in', value: ['Open'], label: 'Status' }).op,
    ).toBe('in');
    expect(() =>
      filterConditionSchema.parse({ field: 'status', op: 'like', value: 'x', label: 'Status' }),
    ).toThrow();
  });

  it('validates rule conditions', () => {
    expect(ruleConditionSchema.parse({ field: 'weight', comparator: 'gt', value: 5 }).value).toBe(5);
    expect(() => ruleConditionSchema.parse({ field: '', comparator: 'gt', value: 5 })).toThrow();
  });
});
