import { describe, expect, it } from 'vitest';
import { lifecycleSteps } from '@/components/shipment-plans/plan-form-model';
import { defaultPickupTime, overdueText } from '@/components/shipping/eod-automation';
import { labelOutcomeRows } from '@/components/shipping/create-label-dialog';
import { labelBlockReason } from '@/server/repositories/shipping-label-candidates';
import {
  cutoffPassed,
  pickupWindowError,
  rowsToAutoClose,
  simulateTracking,
} from '@/server/repositories/shipping-carrier-ops';
import type { EodRow } from '@/server/repositories/end-of-day';

describe('lifecycleSteps', () => {
  it('never shows Skipped for a stage with a stamped time (SP000044: shipped with loading times)', () => {
    const steps = lifecycleSteps('Shipped', new Set(['Open', 'Shipped']), {
      'Loading Started': '2026-10-31T18:55:00.000Z',
      'Loading Completed': '2026-10-31T20:55:00.000Z',
      Shipped: '2026-11-02T21:15:00.000Z',
    });
    expect(steps.map((s) => [s.stage, s.state])).toEqual([
      ['Open', 'done'],
      ['In Progress', 'skipped'],
      ['Loading Started', 'done'],
      ['Loading Completed', 'done'],
      ['Shipped', 'done'],
    ]);
    expect(steps[2]?.at).toBe('2026-10-31T18:55:00.000Z');
  });
  it('marks the current stage and leaves later ones upcoming', () => {
    const steps = lifecycleSteps('Loading Started', new Set(['Open', 'In Progress', 'Loading Started']), {
      'Loading Started': '2026-11-01T10:00:00.000Z',
    });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming']);
  });
  it('reads Skipped only with neither a stamp nor a change-log transition', () => {
    expect(
      lifecycleSteps('Shipped', new Set(['Open', 'Shipped']), {})
        .filter((s) => s.state === 'skipped')
        .map((s) => s.stage),
    ).toEqual(['In Progress', 'Loading Started', 'Loading Completed']);
  });
});

describe('simulateTracking', () => {
  const base = {
    labelCreatedAt: '2026-11-01T10:00:00.000Z',
    actualShipmentAt: null,
    actualPickupAt: null,
    scheduledPickupAt: null,
    manifestClosedAt: null,
    expectedDeliveryAt: '2026-11-05T17:00:00.000Z',
    deliveredAt: null,
  };
  const now = new Date('2026-11-10T12:00:00.000Z');
  it('stays at Label created until the carrier has the package', () => {
    expect(simulateTracking(base, now)).toMatchObject({
      status: 'Label created',
      pickupAt: null,
      deliveredAt: null,
    });
  });
  it('picks up at the manifest close and delivers at the expected date', () => {
    const r = simulateTracking({ ...base, manifestClosedAt: '2026-11-01T22:00:00.000Z' }, now);
    expect(r).toMatchObject({
      status: 'Delivered',
      pickupAt: '2026-11-01T22:00:00.000Z',
      deliveredAt: '2026-11-05T17:00:00.000Z',
    });
    expect(r.events.map((e) => e.status)).toEqual(['Label created', 'Picked up', 'Delivered']);
  });
  it('is in transit before the expected delivery', () => {
    expect(
      simulateTracking(
        {
          ...base,
          actualShipmentAt: '2026-11-09T22:00:00.000Z',
          expectedDeliveryAt: '2026-11-12T17:00:00.000Z',
        },
        now,
      ).status,
    ).toBe('In transit');
  });
  it('ignores a scheduled pickup in the future', () => {
    expect(
      simulateTracking({ ...base, scheduledPickupAt: '2026-11-11T15:00:00.000Z' }, now).pickupAt,
    ).toBeNull();
  });
});

describe('pickup window', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');
  it('accepts a time later today', () =>
    expect(pickupWindowError('2026-11-10T20:00:00.000Z', '2026-11-10T22:00:00.000Z', now)).toBeNull());
  it('rejects the past', () =>
    expect(pickupWindowError('2026-11-10T10:00:00.000Z', null, now)).toBe('The pickup time is in the past.'));
  it('rejects a close before the ready time', () =>
    expect(pickupWindowError('2026-11-10T20:00:00.000Z', '2026-11-10T19:00:00.000Z', now)).toContain(
      'after the ready time',
    ));
  it('rejects more than 14 days ahead', () =>
    expect(pickupWindowError('2026-12-01T20:00:00.000Z', null, now)).toContain('14 days'));
  it('defaults to 3 PM today, or the next quarter hour an hour from now', () => {
    expect(defaultPickupTime(new Date(2026, 10, 10, 9, 7)).getHours()).toBe(15);
    const late = defaultPickupTime(new Date(2026, 10, 10, 16, 7));
    expect([late.getHours(), late.getMinutes()]).toEqual([17, 15]);
  });
});

describe('auto-close', () => {
  it('is due once the warehouse-local cutoff has passed', () => {
    // 17:30 Chicago (CST, UTC-6) = 23:30 UTC.
    expect(cutoffPassed('17:30', 'America/Chicago', new Date('2026-11-10T23:00:00.000Z'))).toBeNull();
    expect(cutoffPassed('17:30', 'America/Chicago', new Date('2026-11-10T23:31:00.000Z'))?.localDay).toBe(
      '2026-11-10',
    );
  });
  it("closes only the rule's Open rows dated today or earlier with packages", () => {
    const row = (p: Partial<EodRow>): EodRow =>
      ({
        id: 'x',
        status: 'Open',
        warehouseId: 'W',
        carrierConnectionId: 'C',
        shipDate: '2026-11-10',
        totalPackages: 2,
        ...p,
      }) as EodRow;
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', shipDate: '2026-11-09' }),
      row({ id: 'c', status: 'Closed' }),
      row({ id: 'd', carrierConnectionId: 'D' }),
      row({ id: 'e', totalPackages: 0 }),
      row({ id: 'f', shipDate: '2026-11-11' }),
    ];
    expect(
      rowsToAutoClose(rows, { warehouseId: 'W', carrierConnectionId: 'C' }, '2026-11-10').map((r) => r.id),
    ).toEqual(['a', 'b']);
  });
  it('banner copy', () => {
    expect(overdueText({ count: 0, packages: 0, oldestShipDate: null })).toBeNull();
    expect(overdueText({ count: 2, packages: 7, oldestShipDate: '2026-11-05' })).toBe(
      '2 manifests from past days are still open (oldest 11/05/2026, 7 packages). Close them so the carrier gets the report.',
    );
  });
});

describe('create label', () => {
  it("explains why an order can't get a label", () => {
    expect(labelBlockReason('Ready to Ship', 0)).toBeNull();
    expect(labelBlockReason('Shipped', 0)).toBe("A label can't be created for a Shipped order");
    expect(labelBlockReason('Ready to Ship', 1)).toContain('Void it first');
  });
  it("keeps the carrier's error text in the result rows", () => {
    const rows = labelOutcomeRows(
      {
        outcomes: [
          { id: '1', code: 'SO1', ok: true, message: 'Label created', trackingNumber: '1Z1', fileIds: ['f'] },
        ],
        failed: [
          {
            id: '2',
            code: 'VALIDATION',
            message: 'Carrier error: ShipFrom PhoneNumber must be at least 10 alphanumeric characters',
          },
        ],
        fileIds: ['f'],
      },
      new Map([['2', 'SO2']]),
    );
    expect(rows).toEqual([
      { id: '1', code: 'SO1', ok: true, text: '1Z1', fileId: 'f' },
      {
        id: '2',
        code: 'SO2',
        ok: false,
        text: 'Carrier error: ShipFrom PhoneNumber must be at least 10 alphanumeric characters',
        fileId: null,
      },
    ]);
  });
});
